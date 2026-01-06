import css from './style.module.css';
import classNames from 'classnames';
import {
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
	FlexItem,
	Button,
} from '@wordpress/components';
import { close, external, trash } from '@wordpress/icons';
import { Icon } from '@wordpress/icons';
import { useState, useEffect, useCallback } from 'react';
import { logger } from '@php-wasm/logger';
import { useActiveSite } from '../../lib/state/redux/store';
import store from '../../lib/state/redux/store';
import { opfsSiteStorage } from '../../lib/state/opfs/opfs-site-storage';
import { WordPressIcon } from '@wp-playground/components';
import { BackupReminder } from '../backup-reminder';
import { usePlaygroundClient } from '../../lib/use-playground-client';

type PluginBlueprint = {
	title: string;
	description: string;
	blueprint: object;
};

const pluginBlueprints: PluginBlueprint[] = [
	{
		title: 'RSS Reader',
		description:
			'Follow friends and consume their content in your WordPress',
		blueprint: {
			landingPage: '/friends/?refresh&welcome',
			steps: [
				{
					step: 'installPlugin',
					pluginData: {
						resource: 'wordpress.org/plugins',
						slug: 'friends',
					},
					options: {
						activate: true,
					},
				},
				{
					step: 'runPHP',
					code: "<?php require_once '/wordpress/wp-load.php';if(class_exists('Friends\\Import')){$feeds=array(array('https://alex.kirk.at','Alex Kirk'),array('https://adamadam.blog','Adam Zieliński'));$x=new SimpleXMLElement('<opml/>');$a='addAttribute';$c='addChild';$x->$a('version','2.0');$h=$x->$c('head');$h->$c('title','Subscriptions');$b=$x->$c('body');$s=$b->$c('outline');$s->$a('text','Subscriptions');$s->$a('title','Subscriptions');foreach($feeds as $f){list($u,$t)=$f;$o=$s->$c('outline');$o->$a('type','rss');$o->$a('text',$t);$o->$a('title',$t);$o->$a('xmlUrl',$u);$o->$a('htmlUrl',$u);}Friends\\Import::opml($x->asXML());}",
					progress: {
						caption: 'Importing feeds to Friends plugin',
					},
				},
			],
			$schema: 'https://playground.wordpress.net/blueprint-schema.json',
			meta: {
				title: 'Load Feeds into the Friends plugin',
				author: 'https://github.com/akirk/playground-step-library',
			},
		},
	},
	{
		title: 'Personal CRM',
		description:
			'Manage your contacts and relationships directly from WordPress',
		blueprint: {
			landingPage: '/crm/welcome',
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/pcrm-beeper.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'personal-crm/personal-crm.php',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'keeping-contact/keeping-contact.php',
				},
				{
					step: 'activatePlugin',
					pluginPath:
						'contact-sync-personal-crm/contact-sync-personal-crm.php',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'a8c-team/a8c-team.php',
				},
			],
		},
	},
	{
		title: 'Collect Posts from the Web',
		description:
			'Use the Post Collection Plugin to save articles from around the web',
		blueprint: {
			landingPage: '/wp-admin/admin.php?page=post-collection-settings',
			steps: [
				{
					step: 'unzip',
					zipFile: {
						resource: 'url',
						url: 'https://alex.kirk.at/wp-content/uploads/sites/2/post-collection.zip',
					},
					extractToPath: '/wordpress/wp-content/plugins',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'post-collection/post-collection.php',
				},
				{
					step: 'activatePlugin',
					pluginPath: 'send-to-e-reader/send-to-e-reader.php',
				},
			],
		},
	},
];

function PlaygroundLogo() {
	return (
		<div className={css.logo}>
			<svg
				viewBox="0 0 124 124"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				className={css.logoIcon}
			>
				<path
					fillRule="evenodd"
					clipRule="evenodd"
					d="M14.755 45.1665C12.0512 48.8962 10.6245 53.4789 10.3951 58.5153C10.358 59.3301 10.3522 60.1566 10.3774 60.9934C10.7191 72.3238 16.7432 85.5209 27.6103 96.388C44.2413 113.019 66.3294 118.307 78.8323 109.243C73.5732 108.004 68.2526 106.073 63.0136 103.496C61.6689 103.437 60.222 103.262 58.6713 102.952C56.0196 102.421 53.2158 101.511 50.3594 100.216C50.3593 100.216 50.3592 100.215 50.359 100.215C45.1354 97.8469 39.7361 94.1934 34.7704 89.2277C29.8052 84.2625 26.1519 78.8637 23.784 73.6406C23.7838 73.6405 23.7836 73.6405 23.7834 73.6404C22.4884 70.7839 21.5779 67.9798 21.0476 65.3279C20.7375 63.7776 20.5621 62.3309 20.5032 60.9865C17.9263 55.7471 15.9944 50.426 14.755 45.1665ZM4.33861 76.7002C4.71713 76.3217 5.11425 75.9686 5.52862 75.6407C6.7468 79.1965 8.35436 82.7444 10.3249 86.214C10.06 87.3833 10.0041 88.9848 10.4335 91.1319C11.2858 95.3936 13.9437 100.626 18.659 105.341C23.3743 110.056 28.6064 112.714 32.8681 113.567C35.0158 113.996 36.6176 113.94 37.787 113.675C41.2566 115.645 44.8043 117.252 48.36 118.47C48.0319 118.885 47.6786 119.283 47.2998 119.661C39.3909 127.57 23.3622 124.365 11.4988 112.501C-0.364596 100.638 -3.57033 84.6091 4.33861 76.7002ZM43.7198 80.2786C67.4466 104.005 99.5039 110.417 115.322 94.599C121.041 88.8798 123.854 81.0375 123.994 72.2337C124.239 56.6885 116.149 38.1454 101.001 22.9976C77.2746 -0.729192 45.2173 -7.14065 29.3994 8.67722C23.6725 14.4041 20.8595 22.2597 20.7271 31.078C20.4941 46.6158 28.5836 65.1423 43.7198 80.2786ZM77.1341 84.4888C77.5747 86.6917 77.7433 88.6853 77.6924 90.4738C68.7821 87.3724 59.3392 81.5782 50.88 73.119C42.4208 64.6598 36.6267 55.2171 33.5253 46.3068C35.3138 46.2559 37.3074 46.4245 39.5104 46.8651C47.0115 48.3653 55.7301 52.9069 63.4112 60.588C71.0923 68.2691 75.6339 76.9877 77.1341 84.4888ZM36.5596 15.8374C32.2725 20.1245 29.985 27.0976 31.1373 36.3235C43.2662 35.1444 58.3841 41.2404 70.5714 53.4278C82.7587 65.6151 88.8548 80.7329 87.6757 92.8617C96.9016 94.014 103.875 91.7265 108.162 87.4394C112.932 82.6694 115.226 74.5742 113.061 63.7503C110.913 53.0099 104.488 40.8048 93.8412 30.1578C83.1942 19.5108 70.9891 13.0857 60.2487 10.9376C49.4248 8.7728 41.3296 11.0674 36.5596 15.8374Z"
					fill="#e5e6e6"
				/>
			</svg>
			<span className={css.logoText}>Playground</span>
		</div>
	);
}

interface PersistentPlaygroundOverlayProps {
	onClose: () => void;
}

export function PersistentPlaygroundOverlay({
	onClose,
}: PersistentPlaygroundOverlayProps) {
	const activeSite = useActiveSite();
	const playground = usePlaygroundClient();

	const [isClosing, setIsClosing] = useState(false);
	const [showDeleteButton, setShowDeleteButton] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const [activePlugins, setActivePlugins] = useState<string[]>([]);
	const [pluginsToKeep, setPluginsToKeep] = useState<Set<string>>(new Set());
	const [isLoadingPlugins, setIsLoadingPlugins] = useState(true);
	const [isSavingPlugins, setIsSavingPlugins] = useState(false);
	const [showPluginList, setShowPluginList] = useState(false);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				const currentActiveModal = store.getState().ui.activeModal;
				if (currentActiveModal) {
					return;
				}
				onClose();
			}
		},
		[onClose]
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown, true);
		return () => {
			document.removeEventListener('keydown', handleKeyDown, true);
		};
	}, [handleKeyDown]);

	const [pluginNames, setPluginNames] = useState<Record<string, string>>({});

	useEffect(() => {
		async function fetchPlugins() {
			if (!playground) {
				return;
			}
			try {
				const response = await playground.run({
					code: `<?php
						// Prevent plugins from loading
						define('WP_INSTALLING', true);
						require_once '/wordpress/wp-load.php';
						require_once ABSPATH . 'wp-admin/includes/plugin.php';

						$active = get_option('active_plugins', []);
						$result = [];

						foreach ($active as $plugin_file) {
							$plugin_path = WP_PLUGIN_DIR . '/' . $plugin_file;
							if (file_exists($plugin_path)) {
								$data = get_plugin_data($plugin_path, false, false);
								$result[$plugin_file] = $data['Name'] ?: $plugin_file;
							} else {
								$result[$plugin_file] = $plugin_file;
							}
						}

						echo json_encode($result);
					`,
				});
				const pluginsWithNames = JSON.parse(response.text);
				const pluginPaths = Object.keys(pluginsWithNames);
				setActivePlugins(pluginPaths);
				setPluginsToKeep(new Set(pluginPaths));
				setPluginNames(pluginsWithNames);
			} catch (error) {
				logger.error('Failed to fetch plugins:', error);
				setActivePlugins([]);
			} finally {
				setIsLoadingPlugins(false);
			}
		}
		fetchPlugins();
	}, [playground]);

	function togglePlugin(pluginPath: string) {
		setPluginsToKeep((prev) => {
			const next = new Set(prev);
			if (next.has(pluginPath)) {
				next.delete(pluginPath);
			} else {
				next.add(pluginPath);
			}
			return next;
		});
	}

	async function handleSaveAndReboot() {
		if (!playground || isSavingPlugins) {
			return;
		}

		setIsSavingPlugins(true);
		try {
			const pluginsToDeactivate = activePlugins.filter(
				(p) => !pluginsToKeep.has(p)
			);
			logger.log('Deactivating plugins:', pluginsToDeactivate);
			const deactivateJson = JSON.stringify(pluginsToDeactivate);

			const response = await playground.run({
				code: `<?php
					// Prevent plugins from loading (like WP-CLI --skip-plugins)
					define('WP_INSTALLING', true);

					require_once '/wordpress/wp-load.php';
					require_once ABSPATH . 'wp-admin/includes/plugin.php';

					$before_plugins = get_option('active_plugins', []);

					$to_deactivate = json_decode(getenv('DEACTIVATE_JSON'), true);
					if (!is_array($to_deactivate)) {
						echo json_encode(['error' => 'Failed to parse DEACTIVATE_JSON']);
						exit;
					}

					// Use WordPress's deactivate_plugins function
					deactivate_plugins($to_deactivate, true); // true = silent, no hooks

					// Clear any plugin-related caches/transients
					wp_cache_delete('alloptions', 'options');
					delete_transient('plugin_slugs');

					$after_plugins = get_option('active_plugins', []);

					// Double-check by reading directly from database
					global $wpdb;
					$db_value = $wpdb->get_var("SELECT option_value FROM {$wpdb->options} WHERE option_name = 'active_plugins'");
					$db_plugins = maybe_unserialize($db_value);

					echo json_encode([
						'success' => true,
						'before' => $before_plugins,
						'after' => $after_plugins,
						'after_from_db' => $db_plugins,
						'deactivated' => $to_deactivate
					]);
				`,
				env: { DEACTIVATE_JSON: deactivateJson },
			});

			const result = JSON.parse(response.text);
			if (result.error) {
				throw new Error(result.error);
			}

			logger.log('Plugin save result:', result);
			logger.log('Before:', result.before);
			logger.log('After (get_option):', result.after);
			logger.log('After (direct DB):', result.after_from_db);

			window.location.reload();
		} catch (error) {
			logger.error('Failed to save plugins:', error);
			alert('Failed to save plugin changes. Please try again.');
			setIsSavingPlugins(false);
		}
	}

	const hasPluginChanges =
		activePlugins.length !== pluginsToKeep.size ||
		activePlugins.some((p) => !pluginsToKeep.has(p));

	async function handleStartOver() {
		if (!activeSite || activeSite.metadata.storage === 'none') {
			return;
		}

		const proceed = window.confirm(
			'Are you sure you want to start over? This will delete all your data and reset WordPress to a fresh install.'
		);
		if (!proceed) {
			return;
		}

		setIsDeleting(true);
		try {
			await opfsSiteStorage?.delete(activeSite.slug);
			// Reload to the base URL without any site-slug
			window.location.href =
				window.location.origin + window.location.pathname;
		} catch (error) {
			logger.error(error);
			alert('Failed to reset. Please try again.');
			setIsDeleting(false);
		}
	}

	return (
		<div
			className={classNames(css.overlay, {
				[css.overlayClosing]: isClosing,
			})}
		>
			<VStack className={css.fullscreenContent} spacing={0}>
				<HStack
					className={css.header}
					alignment="center"
					justify="space-between"
				>
					<FlexItem className={css.headerSpacer} />
					<PlaygroundLogo />
					<Button
						icon={close}
						label="Close"
						onClick={onClose}
						className={css.closeButton}
					/>
				</HStack>

				<div className={css.body}>
					<section className={css.section}>
						<h2 className={css.sectionTitle}>Install Apps</h2>
						<div className={css.featuresList}>
							{pluginBlueprints.map((plugin, index) => {
								const url = new URL(window.location.href);
								url.hash = '';
								// Encode UTF-8 string to base64
								const jsonStr = JSON.stringify(
									plugin.blueprint
								);
								const encoded = btoa(
									encodeURIComponent(jsonStr).replace(
										/%([0-9A-F]{2})/g,
										(_, p1) =>
											String.fromCharCode(
												parseInt(p1, 16)
											)
									)
								);
								url.searchParams.set(
									'blueprint-url',
									`data:application/json;base64,${encoded}`
								);
								return (
									<a
										key={index}
										className={css.featureItem}
										href={url.toString()}
									>
										<span className={css.featureIcon}>
											<WordPressIcon />
										</span>
										<span className={css.featureContent}>
											<span className={css.featureTitle}>
												{plugin.title}
											</span>
											<span
												className={
													css.featureDescription
												}
											>
												{plugin.description}
											</span>
										</span>
									</a>
								);
							})}
						</div>
					</section>

					<section className={css.section}>
						<h2 className={css.sectionTitle}>Backup</h2>
						<BackupReminder />
					</section>

					<div className={css.bottomRow}>
						<section className={css.section}>
							<h2 className={css.sectionTitle}>
								More Playgrounds
							</h2>
							<p className={css.sectionDescription}>
								Want multiple Playgrounds? Visit
								playground.wordpress.net for temporary
								instances.
							</p>
							<a
								href="https://playground.wordpress.net"
								target="_blank"
								rel="noopener noreferrer"
								className={css.externalLink}
							>
								<Icon icon={external} size={20} />
								<span>Open playground.wordpress.net</span>
							</a>
						</section>

						<section className={css.section}>
							<h2 className={css.sectionTitle}>Start over</h2>
							<p className={css.sectionDescription}>
								If you want to start over,{' '}
								<button
									className={css.textButton}
									onClick={() =>
										setShowDeleteButton(!showDeleteButton)
									}
								>
									you can reset this WordPress
								</button>
								.
							</p>
							{showDeleteButton && (
								<button
									className={css.dangerButton}
									onClick={handleStartOver}
									disabled={isDeleting}
								>
									<Icon icon={trash} size={20} />
									<span>
										{isDeleting
											? 'Deleting...'
											: 'Delete everything'}
									</span>
								</button>
							)}
						</section>
					</div>

					<section className={css.section}>
						<h2 className={css.sectionTitle}>Recovery</h2>
						<p className={css.sectionDescription}>
							If a plugin is causing issues,{' '}
							<button
								className={css.textButton}
								onClick={() =>
									setShowPluginList(!showPluginList)
								}
							>
								you can disable it here
							</button>
							.
						</p>
						{showPluginList &&
							(isLoadingPlugins ? (
								<p className={css.sectionDescription}>
									Loading plugins...
								</p>
							) : activePlugins.length === 0 ? (
								<p className={css.sectionDescription}>
									No active plugins
								</p>
							) : (
								<>
									<div className={css.pluginList}>
										{activePlugins.map((plugin) => (
											<label
												key={plugin}
												className={css.pluginItem}
											>
												<input
													type="checkbox"
													checked={pluginsToKeep.has(
														plugin
													)}
													onChange={() =>
														togglePlugin(plugin)
													}
												/>
												<span
													className={css.pluginName}
												>
													{pluginNames[plugin] ||
														plugin}
												</span>
											</label>
										))}
									</div>
									{hasPluginChanges && (
										<button
											className={css.primaryButton}
											onClick={handleSaveAndReboot}
											disabled={isSavingPlugins}
										>
											{isSavingPlugins
												? 'Saving...'
												: 'Save and reboot'}
										</button>
									)}
								</>
							))}
					</section>
				</div>
			</VStack>
		</div>
	);
}
