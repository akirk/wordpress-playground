import { directoryHandleFromMountDevice } from '@wp-playground/storage';
import { loadDirectoryHandle } from '../opfs/opfs-directory-handle-storage';
import {
	getDirectoryPathForSlug,
	legacyOpfsPathSymbol,
} from '../opfs/opfs-site-storage';
import {
	addClientInfo,
	removeClientInfo,
	updateClientInfo,
} from './slice-clients';
import { logBlueprintEvents, logTrackingEvent } from '../../tracking';
import {
	type Blueprint,
	type StepDefinition,
	BlueprintFilesystemRequiredError,
	InvalidBlueprintError,
} from '@wp-playground/blueprints';
import { logger } from '@php-wasm/logger';
import { setupPostMessageRelay } from '@php-wasm/web';
import {
	startPlaygroundWeb,
	resolveRemoteBlueprint,
	getBlueprintDeclaration,
} from '@wp-playground/client';
import type { PlaygroundClient } from '@wp-playground/remote';
import { getRemoteUrl } from '../../config';
import {
	setActiveModal,
	setActiveSiteError,
	setGitHubAuthRepoUrl,
} from './slice-ui';
import type { PlaygroundDispatch, PlaygroundReduxState } from './store';
import {
	selectSiteBySlug,
	updateSiteMetadata,
	selectPendingUrlBlueprint,
	setPendingUrlBlueprint,
} from './slice-sites';
// @ts-ignore
import { corsProxyUrl } from 'virtual:cors-proxy-url';
import { modalSlugs } from './slice-ui';
import {
	createGitAuthHeaders,
	shouldShowGitHubAuthModal,
} from '../../../github/git-auth-helpers';
import { findFirewallErrorInCauseChain } from './error-utils';
import {
	initTabCoordinator,
	checkForExistingTabs,
	requestStaleTabsShutdown,
} from './tab-coordinator';

export function bootSiteClient(
	siteSlug: string,
	iframe: HTMLIFrameElement,
	{ signal }: { signal: AbortSignal }
) {
	return async (
		dispatch: PlaygroundDispatch,
		getState: () => PlaygroundReduxState
	) => {
		console.log('[bootSiteClient] Starting boot for site:', siteSlug);
		signal.onabort = () => {
			dispatch(removeClientInfo(siteSlug));
		};
		const site = selectSiteBySlug(getState(), siteSlug);
		console.log(
			'[bootSiteClient] Site storage type:',
			site.metadata.storage
		);

		let mountDescriptor = undefined;
		if (site.metadata.storage === 'opfs') {
			mountDescriptor = {
				device: {
					type: 'opfs',
					// @TODO: Remove backcompat code after 2024-12-01.
					path: (site.metadata as any)[legacyOpfsPathSymbol]
						? (site.metadata as any)[legacyOpfsPathSymbol]
						: getDirectoryPathForSlug(site.slug),
				},
				mountpoint: '/wordpress',
			} as const;
		} else if (site.metadata.storage === 'local-fs') {
			let localDirectoryHandle;
			try {
				localDirectoryHandle = await loadDirectoryHandle(site.slug);
			} catch (e) {
				logger.error(e);
				dispatch(
					setActiveSiteError({
						error: 'directory-handle-not-found-in-indexeddb',
						details: e,
					})
				);
				return;
			}
			mountDescriptor = {
				device: {
					type: 'local-fs',
					handle: localDirectoryHandle,
				},
				mountpoint: '/wordpress',
			} as const;
		}

		let isWordPressInstalled = false;
		if (mountDescriptor) {
			try {
				isWordPressInstalled = await playgroundAvailableInOpfs(
					await directoryHandleFromMountDevice(mountDescriptor.device)
				);
			} catch (e) {
				logger.error(e);
				if (e instanceof DOMException && e.name === 'NotFoundError') {
					dispatch(
						setActiveSiteError({
							error: 'directory-handle-not-found-in-indexeddb',
							details: e,
						})
					);
					return;
				}
				dispatch(
					setActiveSiteError({
						error: 'directory-handle-unknown-error',
						details: e,
					})
				);
				return;
			}
		}

		console.log(
			'[bootSiteClient] isWordPressInstalled:',
			isWordPressInstalled
		);
		logTrackingEvent('load');

		// Initialize tab coordinator for multi-tab detection
		// Only for persistent sites - temporary sites don't need coordination
		if (site.metadata.storage !== 'none') {
			console.log(
				'[boot-site-client] Initializing tab coordinator for site:',
				site.slug
			);
			initTabCoordinator(site.slug, (reason) => {
				// This callback is called when another tab requests we shut down
				console.log(
					'[boot-site-client] Received shutdown request:',
					reason
				);
				dispatch(
					setActiveSiteError({
						error: 'tab-superseded',
						details: new Error(reason),
					})
				);
			});

			console.log('[boot-site-client] Checking for existing tabs...');
			const { existingTabs, hasFreshTab, hasStaleTab } =
				await checkForExistingTabs(site.slug);
			console.log(
				'[boot-site-client] Found existing tabs:',
				existingTabs.length,
				{ hasFreshTab, hasStaleTab, existingTabs }
			);

			if (hasStaleTab) {
				// Request stale tabs (> 1 day old) to shut down
				console.log(
					'[boot-site-client] Requesting stale tabs to shut down'
				);
				requestStaleTabsShutdown(existingTabs);
			}

			if (hasFreshTab) {
				// A fresh tab (< 1 day old) already has this site open.
				// Instead of spawning a new PHP worker, just load the iframe
				// directly - the existing service worker will serve the request.
				console.log(
					'[boot-site-client] Entering DEPENDENT mode - fresh tab exists'
				);
				const remoteUrl = getRemoteUrl();
				const scopedSiteUrl = `/scope:${encodeURIComponent(site.slug)}/`;
				const scopedUrl = new URL(scopedSiteUrl, remoteUrl);

				// Add landing page from site metadata or URL parameter
				const urlParams = new URLSearchParams(window.location.search);
				const landingPage =
					urlParams.get('url') ||
					site.metadata.lastUrl ||
					'/wp-admin/';
				scopedUrl.pathname += landingPage.replace(/^\//, '');

				console.log(
					'[boot-site-client] Setting iframe.src to:',
					scopedUrl.toString()
				);
				iframe.src = scopedUrl.toString();

				// Create a minimal "client" for dependent mode that can navigate
				const dependentModeClient = {
					goTo: async (path: string) => {
						const newUrl = new URL(
							scopedSiteUrl + path.replace(/^\//, ''),
							remoteUrl
						);
						iframe.src = newUrl.toString();
					},
					// Stub out other methods that might be called
					getCurrentURL: async () => {
						try {
							const iframeUrl = new URL(
								iframe.contentWindow?.location?.href || ''
							);
							return iframeUrl.pathname.replace(
								new RegExp(
									`^${scopedSiteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
								),
								'/'
							);
						} catch {
							return '/';
						}
					},
				} as any;

				// Add client info for dependent mode so the address bar can show the URL
				dispatch(
					addClientInfo({
						siteSlug: site.slug,
						url: landingPage,
						client: dependentModeClient,
						opfsMountDescriptor: undefined,
						isDependentMode: true,
					})
				);

				// Track iframe navigation in dependent mode
				const handleIframeNavigation = () => {
					try {
						const iframeHref = iframe.contentWindow?.location?.href;
						if (iframeHref) {
							// Extract the path from the scoped URL
							const iframeUrl = new URL(iframeHref);
							// Remove the /scope:slug/ prefix to get the WordPress path
							const path = iframeUrl.pathname.replace(
								new RegExp(
									`^${scopedSiteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
								),
								'/'
							);
							dispatch(
								updateClientInfo({
									siteSlug: site.slug,
									changes: { url: path },
								})
							);
						}
					} catch {
						// Cross-origin access denied - can't track navigation
					}
				};

				iframe.addEventListener('load', handleIframeNavigation);

				// Clean up on abort
				signal.onabort = () => {
					iframe.removeEventListener('load', handleIframeNavigation);
					dispatch(removeClientInfo(site.slug));
				};

				// Track site access even in dependent mode
				const now = Date.now();
				const lastAccess = site.metadata.lastAccessDate;
				const isNewDay =
					!lastAccess ||
					new Date(lastAccess).toDateString() !==
						new Date(now).toDateString();

				const changes: {
					lastAccessDate: number;
					daysUsedSinceLastBackup?: number;
				} = {
					lastAccessDate: now,
				};

				if (isNewDay) {
					changes.daysUsedSinceLastBackup =
						(site.metadata.daysUsedSinceLastBackup || 0) + 1;
				}

				dispatch(
					updateSiteMetadata({
						slug: site.slug,
						changes,
					})
				);

				// Note: In dependent mode, we don't have a PlaygroundClient.
				// The UI should handle this gracefully (backup buttons etc. won't work).
				// The user can close the other tab if they need full functionality.
				console.log(
					'[boot-site-client] DEPENDENT mode setup complete, returning early (no worker spawn)'
				);
				logger.info(
					'Playground running in dependent mode - reusing existing service worker from another tab'
				);
				return;
			}
			console.log(
				'[boot-site-client] No fresh tab found, will spawn own worker (MAIN mode)'
			);
		}

		// Check for pending URL blueprint from redux (set by resolveSiteFromUrl)
		const pendingBlueprint = selectPendingUrlBlueprint(getState());
		const hasPendingBlueprint =
			pendingBlueprint && pendingBlueprint.siteSlug === site.slug;

		// Also check if there's a blueprint-url parameter to apply additional steps
		// (handles base64 data URLs that may not go through resolveSiteFromUrl)
		const urlParams = new URLSearchParams(window.location.search);
		const blueprintUrl = urlParams.get('blueprint-url');
		const urlParamLandingPage = urlParams.get('url');
		let additionalSteps: StepDefinition[] = [];
		let additionalLandingPage: string | undefined;

		console.log(
			'[bootSiteClient] blueprintUrl:',
			blueprintUrl ? 'present' : 'none'
		);
		console.log(
			'[bootSiteClient] Will process blueprint:',
			blueprintUrl && isWordPressInstalled
		);

		if (blueprintUrl && isWordPressInstalled) {
			try {
				let blueprintDeclaration;
				console.log('[bootSiteClient] Parsing blueprint URL...');

				// Check if it's a base64 data URL
				if (blueprintUrl.startsWith('data:application/json;base64,')) {
					const base64Data = blueprintUrl.replace(
						'data:application/json;base64,',
						''
					);
					// Decode base64 to UTF-8 string
					const decoded = decodeURIComponent(
						atob(base64Data)
							.split('')
							.map(
								(c) =>
									'%' +
									('00' + c.charCodeAt(0).toString(16)).slice(
										-2
									)
							)
							.join('')
					);
					blueprintDeclaration = JSON.parse(decoded);
				} else {
					// Fetch from remote URL
					const blueprintBundle =
						await resolveRemoteBlueprint(blueprintUrl);
					blueprintDeclaration =
						await getBlueprintDeclaration(blueprintBundle);
				}

				additionalSteps = (blueprintDeclaration.steps ||
					[]) as StepDefinition[];
				additionalLandingPage = blueprintDeclaration.landingPage;
				console.log(
					'[bootSiteClient] Parsed blueprint steps:',
					additionalSteps.map((s) => (s as any).step)
				);
				console.log(
					'[bootSiteClient] Landing page:',
					additionalLandingPage
				);
				// Clear the blueprint-url from the URL after reading it
				urlParams.delete('blueprint-url');
				const newUrl = new URL(window.location.href);
				newUrl.search = urlParams.toString();
				window.history.replaceState({}, '', newUrl.toString());
			} catch (e) {
				console.error(
					'[bootSiteClient] Failed to process blueprint:',
					e
				);
				logger.error('Failed to process blueprint:', e);
			}
		}

		let blueprint: Blueprint;
		if (isWordPressInstalled) {
			// Check if additional steps already include a login step.
			// If so, don't auto-prepend login (this allows recovery blueprints
			// to run filesystem steps BEFORE WordPress boots).
			const additionalStepsHaveLogin = additionalSteps.some(
				(s) => (s as any).step === 'login'
			);

			// For persisted sites, use runtime config and restore the user's last position
			blueprint = {
				preferredVersions: {
					php: site.metadata.runtimeConfiguration.phpVersion,
					wp: site.metadata.runtimeConfiguration.wpVersion,
				},
				features: {
					intl: site.metadata.runtimeConfiguration.intl,
					networking: site.metadata.runtimeConfiguration.networking,
				},
				extraLibraries: site.metadata.runtimeConfiguration
					.extraLibraries as any[],
				constants: site.metadata.runtimeConfiguration.constants,
				// Auto-login unless additional steps handle login themselves
				...(!additionalStepsHaveLogin && { login: true }),
				// Use URL param or blueprint landing page if present, otherwise restore last URL
				landingPage:
					urlParamLandingPage ||
					additionalLandingPage ||
					site.metadata.lastUrl,
				// Include additional steps from blueprint if present
				...(additionalSteps.length > 0 && { steps: additionalSteps }),
			};

			// Merge pending URL blueprint (e.g., ?plugin=friends) into boot blueprint
			// so the plugin installation shows on the boot screen
			if (hasPendingBlueprint) {
				const pending = pendingBlueprint.blueprint;
				blueprint = {
					...blueprint,
					plugins: [
						...((blueprint as any).plugins || []),
						...((pending as any).plugins || []),
					],
					steps: [
						...((blueprint as any).steps || []),
						...((pending as any).steps || []),
					],
				};
			}
		} else {
			blueprint = site.metadata.originalBlueprint;
		}

		let playground: PlaygroundClient | undefined = undefined;
		console.log(
			'[boot-site-client] About to call startPlaygroundWeb (spawning worker)'
		);
		console.log(
			'[bootSiteClient] Final blueprint steps:',
			(blueprint as any).steps?.map((s: any) => s.step) || 'none'
		);

		// Check if we're in recovery mode (Health Check troubleshooting).
		// If so, skip the isWordPressInstalled() check that loads WordPress
		// to prevent crashes from broken plugins.
		const isRecoveryMode = additionalLandingPage?.includes(
			'health-check-disable-plugin-hash'
		);
		console.log('[bootSiteClient] Recovery mode:', isRecoveryMode);
		console.log('[bootSiteClient] Calling startPlaygroundWeb...');
		try {
			await startPlaygroundWeb({
				iframe: iframe!,
				remoteUrl: getRemoteUrl().toString(),
				scope: site.slug,
				blueprint,
				experimentalBlueprintsV2Runner:
					!isWordPressInstalled &&
					new URLSearchParams(window.location.search).get(
						'experimental-blueprints-v2-runner'
					) === 'yes',
				// Skip the WordPress install check in recovery mode to avoid
				// loading WordPress before blueprint steps run.
				skipWordPressInstallCheck: isRecoveryMode,
				// Intercept the Playground client even if the
				// Blueprint fails.
				onClientConnected: (playgroundClient) => {
					console.log('[bootSiteClient] Client connected!');
					playground = (window as any)['playground'] =
						playgroundClient;
				},
				// Log Blueprint events
				onBlueprintStepCompleted: (result, step) => {
					console.log(
						'[bootSiteClient] Step completed:',
						(step as any)?.step,
						result
					);
				},
				onBlueprintValidated: logBlueprintEvents,
				mounts: mountDescriptor
					? [
							{
								...mountDescriptor,
								initialSyncDirection: 'opfs-to-memfs',
							},
						]
					: [],
				shouldInstallWordPress: !isWordPressInstalled,
				corsProxy: corsProxyUrl,
				gitAdditionalHeadersCallback: createGitAuthHeaders(),
			});
			console.log(
				'[bootSiteClient] startPlaygroundWeb completed successfully'
			);
		} catch (e) {
			console.error(
				'[bootSiteClient] startPlaygroundWeb threw an error:',
				e
			);
			logger.error(e);
			logTrackingEvent('error', { source: 'bootSiteClient' });

			const firewallError = findFirewallErrorInCauseChain(e);
			if (
				(e as any).name === 'ArtifactExpiredError' ||
				(e as any).originalErrorClassName === 'ArtifactExpiredError'
			) {
				dispatch(
					setActiveSiteError({
						error: 'github-artifact-expired',
						details: e,
					})
				);
			} else if (e instanceof BlueprintFilesystemRequiredError) {
				dispatch(
					setActiveSiteError({
						error: 'blueprint-filesystem-required',
						details: e,
					})
				);
			} else if (e instanceof InvalidBlueprintError) {
				dispatch(
					setActiveSiteError({
						error: 'blueprint-validation-failed',
						details: e,
					})
				);
			} else if (firewallError) {
				dispatch(
					setActiveSiteError({
						error: 'network-firewall-interference',
						details: firewallError,
					})
				);
			} else if (
				(e as any).name === 'GitAuthenticationError' ||
				(e as any).originalErrorClassName ===
					'GitAuthenticationError' ||
				(e as any).cause?.name === 'GitAuthenticationError'
			) {
				const repoUrl =
					(e as any).repoUrl ||
					(e as any).cause?.repoUrl ||
					undefined;

				if (shouldShowGitHubAuthModal(repoUrl)) {
					if (repoUrl) {
						dispatch(setGitHubAuthRepoUrl(repoUrl));
					}
					dispatch(
						setActiveModal(modalSlugs.GITHUB_PRIVATE_REPO_AUTH)
					);
				} else {
					dispatch(
						setActiveSiteError({
							error: 'site-boot-failed',
							details: e,
						})
					);
					dispatch(setActiveModal(modalSlugs.ERROR_REPORT));
				}
			} else {
				dispatch(
					setActiveSiteError({
						error: 'site-boot-failed',
						details: e,
					})
				);
			}
		}

		if (signal.aborted || !playground) {
			return;
		}

		setupPostMessageRelay(iframe, document.location.origin);

		dispatch(
			addClientInfo({
				siteSlug: site.slug,
				url: '/',
				client: playground,
				opfsMountDescriptor: mountDescriptor,
			})
		);

		// Track site access for persistent sites (used for backup reminders)
		if (site.metadata.storage !== 'none') {
			const now = Date.now();
			const lastAccess = site.metadata.lastAccessDate;
			const isNewDay =
				!lastAccess ||
				new Date(lastAccess).toDateString() !==
					new Date(now).toDateString();

			const changes: {
				lastAccessDate: number;
				daysUsedSinceLastBackup?: number;
			} = {
				lastAccessDate: now,
			};

			if (isNewDay) {
				changes.daysUsedSinceLastBackup =
					(site.metadata.daysUsedSinceLastBackup || 0) + 1;
			}

			dispatch(
				updateSiteMetadata({
					slug: site.slug,
					changes,
				})
			);
		}

		(playground as PlaygroundClient).onNavigation((url) => {
			dispatch(
				updateClientInfo({
					siteSlug: site.slug,
					changes: {
						url,
					},
				})
			);
			// Persist the last URL for persistent sites so we can restore it on next visit
			if (site.metadata.storage !== 'none') {
				dispatch(
					updateSiteMetadata({
						slug: site.slug,
						changes: { lastUrl: url },
					})
				);
			}
		});

		// Clear pending blueprint and URL params after successful boot
		// (the blueprint was already merged into boot above)
		if (hasPendingBlueprint) {
			dispatch(setPendingUrlBlueprint(null));
			const url = new URL(window.location.href);
			url.search = '';
			window.history.replaceState({}, '', url.toString());
		}

		signal.onabort = null;
	};
}

/**
 * Check if the given directory handle directory is a Playground directory.
 *
 * @TODO: Create a shared package like @wp-playground/wordpress for such utilities
 * and bring in the context detection logic from wp-now – only express it in terms of
 * either abstract FS operations or isomorphic PHP FS operations.
 * (we can't just use Node.js require('fs') in the browser, for example)
 *
 * @TODO: Reuse the "isWordPressInstalled" logic implemented in the boot protocol.
 *        Perhaps mount OPFS first, and only then check for the presence of the
 *        WordPress installation? Or, if not, perhaps implement a shared file access
 * 		  abstraction that can be used both with the PHP module and OPFS directory handles?
 *
 * @param dirHandle
 */
export async function playgroundAvailableInOpfs(
	dirHandle: FileSystemDirectoryHandle
) {
	// Run this loop just to trigger an exception if the directory handle is no good.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	for await (const _ of dirHandle.keys()) {
		break;
	}

	try {
		/**
		 * Assume it's a Playground directory if these files exist:
		 * - wp-config.php
		 * - wp-content/database/.ht.sqlite
		 */
		await dirHandle.getFileHandle('wp-config.php', { create: false });
		const wpContent = await dirHandle.getDirectoryHandle('wp-content', {
			create: false,
		});
		const database = await wpContent.getDirectoryHandle('database', {
			create: false,
		});
		await database.getFileHandle('.ht.sqlite', { create: false });
	} catch {
		return false;
	}
	return true;
}
