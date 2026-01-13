/**
 * Tab Coordinator
 *
 * Manages coordination between multiple browser tabs accessing the same
 * WordPress Playground site. Handles:
 *
 * 1. Detection of existing tabs with active PHP workers
 * 2. Age-based decisions (tabs > 1 day old should yield to newer tabs)
 * 3. Graceful shutdown of stale tabs
 * 4. Signaling when a new tab can reuse an existing service worker
 */

type TabInfo = {
	tabId: string;
	createdAt: number;
	siteSlug: string;
	isReady?: boolean; // True when PHP worker is fully booted and can handle service worker requests
	isDependentMode?: boolean; // True when this tab is using another tab's worker
};

type PingMessage = {
	type: 'ping';
	tabId: string;
	siteSlug: string;
};

type PongMessage = {
	type: 'pong';
	tabInfo: TabInfo;
};

type ShutdownRequestMessage = {
	type: 'shutdown-request';
	targetTabId: string;
	reason: 'stale' | 'superseded';
};

type TakeoverRequestMessage = {
	type: 'takeover-request';
	requestingTabId: string;
	siteSlug: string;
};

type TakeoverAcknowledgedMessage = {
	type: 'takeover-acknowledged';
	previousMainTabId: string;
	targetTabId: string;
	siteSlug: string;
};

type TabCoordinatorMessage =
	| PingMessage
	| PongMessage
	| ShutdownRequestMessage
	| TakeoverRequestMessage
	| TakeoverAcknowledgedMessage;

const CHANNEL_NAME = 'playground-tab-coordinator';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PING_TIMEOUT_MS = 150;

let channel: BroadcastChannel | null = null;
let currentTabInfo: TabInfo | null = null;
let shutdownCallback: ((reason: string) => void) | null = null;
let takeoverCallback: (() => void) | null = null;

// Clean up on Vite HMR to prevent duplicate listeners
// @ts-ignore
if (import.meta.hot) {
	// @ts-ignore
	import.meta.hot.dispose(() => {
		console.log('[tab-coordinator] HMR dispose: closing channel');
		if (channel) {
			channel.close();
			channel = null;
		}
		currentTabInfo = null;
	});
}

/**
 * Initialize the tab coordinator for a specific site.
 *
 * @param siteSlug - The slug of the site being loaded
 * @param onShutdownRequested - Callback when this tab should shut down
 * @param onTakeoverRequested - Callback when another tab requests to become main
 * @returns TabInfo for the current tab
 */
export function initTabCoordinator(
	siteSlug: string,
	onShutdownRequested?: (reason: string) => void,
	onTakeoverRequested?: () => void
): TabInfo {
	if (currentTabInfo && currentTabInfo.siteSlug === siteSlug) {
		console.log(
			'[tab-coordinator] Already initialized for site:',
			siteSlug,
			'tabId:',
			currentTabInfo.tabId
		);
		return currentTabInfo;
	}

	// Clean up existing if switching sites
	if (channel) {
		console.log('[tab-coordinator] Closing existing channel');
		channel.close();
	}

	currentTabInfo = {
		tabId: crypto.randomUUID(),
		createdAt: Date.now(),
		siteSlug,
	};

	console.log(
		'[tab-coordinator] Initialized new tab:',
		currentTabInfo.tabId,
		'for site:',
		siteSlug
	);

	shutdownCallback = onShutdownRequested || null;
	takeoverCallback = onTakeoverRequested || null;

	try {
		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = handleMessage;
		console.log('[tab-coordinator] BroadcastChannel created');

		// Clean up on page unload to prevent stale listeners
		window.addEventListener('beforeunload', () => {
			console.log('[tab-coordinator] Page unloading, closing channel');
			if (channel) {
				// Notify other tabs we're closing
				channel.postMessage({
					type: 'tab-closing',
					tabId: currentTabInfo?.tabId,
				});
				channel.close();
				channel = null;
			}
		});
	} catch (e) {
		console.warn(
			'BroadcastChannel not supported, tab coordination disabled'
		);
	}

	return currentTabInfo;
}

/**
 * Clean up the tab coordinator.
 */
export function destroyTabCoordinator(): void {
	if (channel) {
		channel.close();
		channel = null;
	}
	currentTabInfo = null;
	shutdownCallback = null;
	takeoverCallback = null;
}

/**
 * Check for existing tabs running the same site.
 *
 * @param siteSlug - The site to check for
 * @returns Promise resolving to info about existing tabs (if any)
 */
export async function checkForExistingTabs(siteSlug: string): Promise<{
	existingTabs: TabInfo[];
	hasFreshTab: boolean;
	hasStaleTab: boolean;
}> {
	console.log(
		'[tab-coordinator] checkForExistingTabs called for site:',
		siteSlug
	);
	if (!channel || !currentTabInfo) {
		console.log('[tab-coordinator] No channel or tabInfo, returning empty');
		return { existingTabs: [], hasFreshTab: false, hasStaleTab: false };
	}

	const existingTabs: TabInfo[] = [];
	const now = Date.now();

	const pongHandler = (event: MessageEvent<TabCoordinatorMessage>) => {
		const message = event.data;
		if (
			message.type === 'pong' &&
			message.tabInfo.siteSlug === siteSlug &&
			message.tabInfo.tabId !== currentTabInfo?.tabId
		) {
			console.log(
				'[tab-coordinator] Received pong from tab:',
				message.tabInfo.tabId
			);
			existingTabs.push(message.tabInfo);
		}
	};

	channel.addEventListener('message', pongHandler);

	// Send ping
	const pingMessage: PingMessage = {
		type: 'ping',
		tabId: currentTabInfo.tabId,
		siteSlug,
	};
	console.log(
		'[tab-coordinator] Sending ping from tab:',
		currentTabInfo.tabId
	);
	channel.postMessage(pingMessage);

	// Wait for responses
	await new Promise((resolve) => setTimeout(resolve, PING_TIMEOUT_MS));

	channel.removeEventListener('message', pongHandler);
	console.log(
		'[tab-coordinator] Ping timeout reached, found',
		existingTabs.length,
		'other tabs'
	);

	// A "fresh main" tab is one that's less than a day old AND has its own worker (not dependent)
	const hasFreshTab = existingTabs.some(
		(tab) => now - tab.createdAt < ONE_DAY_MS && !tab.isDependentMode
	);
	const hasStaleTab = existingTabs.some(
		(tab) => now - tab.createdAt >= ONE_DAY_MS && !tab.isDependentMode
	);

	return { existingTabs, hasFreshTab, hasStaleTab };
}

/**
 * Request a specific tab to shut down.
 *
 * @param targetTabId - The tab ID to shut down
 * @param reason - Why the tab should shut down
 */
export function requestTabShutdown(
	targetTabId: string,
	reason: 'stale' | 'superseded'
): void {
	if (!channel) {
		return;
	}

	const message: ShutdownRequestMessage = {
		type: 'shutdown-request',
		targetTabId,
		reason,
	};
	channel.postMessage(message);
}

/**
 * Request all stale tabs for a site to shut down.
 *
 * @param tabs - List of tabs to check
 */
export function requestStaleTabsShutdown(tabs: TabInfo[]): void {
	const now = Date.now();
	for (const tab of tabs) {
		if (now - tab.createdAt >= ONE_DAY_MS) {
			requestTabShutdown(tab.tabId, 'stale');
		}
	}
}

/**
 * Get the current tab's info.
 */
export function getCurrentTabInfo(): TabInfo | null {
	return currentTabInfo;
}

/**
 * Check if a tab is considered stale (older than 1 day).
 */
export function isTabStale(tabInfo: TabInfo): boolean {
	return Date.now() - tabInfo.createdAt >= ONE_DAY_MS;
}

/**
 * Mark the current tab as being in dependent mode.
 * This means it's using another tab's worker and shouldn't claim main status.
 */
export function setDependentMode(isDependentMode: boolean): void {
	if (currentTabInfo) {
		currentTabInfo.isDependentMode = isDependentMode;
		console.log(
			'[tab-coordinator] Set dependent mode:',
			isDependentMode,
			'for tab:',
			currentTabInfo.tabId
		);
	}
}

/**
 * Request to take over as the main tab from another tab.
 * Sends a takeover-request and waits for acknowledgment.
 *
 * @param siteSlug - The site to take over
 * @param timeoutMs - How long to wait for acknowledgment (default 2000ms)
 * @returns Promise that resolves to true if takeover was acknowledged, false otherwise
 */
export async function requestTakeover(
	siteSlug: string,
	timeoutMs: number = 2000
): Promise<boolean> {
	if (!channel || !currentTabInfo) {
		console.log(
			'[tab-coordinator] No channel or tabInfo, cannot request takeover'
		);
		return false;
	}

	console.log(
		'[tab-coordinator] Requesting takeover for site:',
		siteSlug,
		'from tab:',
		currentTabInfo.tabId
	);

	return new Promise((resolve) => {
		let resolved = false;

		const ackHandler = (event: MessageEvent<TabCoordinatorMessage>) => {
			const message = event.data;
			if (
				message.type === 'takeover-acknowledged' &&
				message.siteSlug === siteSlug &&
				message.targetTabId === currentTabInfo?.tabId
			) {
				console.log(
					'[tab-coordinator] Received takeover acknowledgment from tab:',
					message.previousMainTabId
				);
				resolved = true;
				channel?.removeEventListener('message', ackHandler);
				resolve(true);
			}
		};

		channel!.addEventListener('message', ackHandler);

		// Send takeover request
		const requestMessage: TakeoverRequestMessage = {
			type: 'takeover-request',
			requestingTabId: currentTabInfo.tabId,
			siteSlug,
		};
		channel!.postMessage(requestMessage);

		// Timeout - if no acknowledgment received, resolve false
		setTimeout(() => {
			if (!resolved) {
				console.log('[tab-coordinator] Takeover request timed out');
				channel?.removeEventListener('message', ackHandler);
				resolve(false);
			}
		}, timeoutMs);
	});
}

/**
 * Handle incoming messages from other tabs.
 */
function handleMessage(event: MessageEvent<TabCoordinatorMessage>): void {
	if (!currentTabInfo || !channel) {
		return;
	}

	const message = event.data;

	switch (message.type) {
		case 'ping':
			// Respond to pings from other tabs looking for the same site
			console.log(
				'[tab-coordinator] Received ping from tab:',
				message.tabId,
				'for site:',
				message.siteSlug
			);
			if (message.siteSlug === currentTabInfo.siteSlug) {
				console.log(
					'[tab-coordinator] Responding with pong, our tabId:',
					currentTabInfo.tabId
				);
				const pongMessage: PongMessage = {
					type: 'pong',
					tabInfo: currentTabInfo,
				};
				channel.postMessage(pongMessage);
			} else {
				console.log(
					'[tab-coordinator] Ignoring ping, different site (ours:',
					currentTabInfo.siteSlug,
					')'
				);
			}
			break;

		case 'shutdown-request':
			// Another tab is requesting we shut down
			console.log(
				'[tab-coordinator] Received shutdown request for tab:',
				message.targetTabId
			);
			if (message.targetTabId === currentTabInfo.tabId) {
				const reason =
					message.reason === 'stale'
						? 'This tab has been open for over a day and a newer tab was opened.'
						: 'A newer tab has taken over this session.';
				console.log(
					'[tab-coordinator] Shutdown request is for us, calling callback'
				);
				shutdownCallback?.(reason);
			}
			break;

		case 'takeover-request':
			// Another tab wants to become main - if we're main, switch to dependent
			console.log(
				'[tab-coordinator] Received takeover request from tab:',
				message.requestingTabId,
				'for site:',
				message.siteSlug
			);
			if (
				message.siteSlug === currentTabInfo.siteSlug &&
				!currentTabInfo.isDependentMode
			) {
				console.log(
					'[tab-coordinator] We are main, will switch to dependent mode'
				);
				// Call the takeover callback which should switch us to dependent mode
				takeoverCallback?.();
				// Send acknowledgment
				const ackMessage: TakeoverAcknowledgedMessage = {
					type: 'takeover-acknowledged',
					previousMainTabId: currentTabInfo.tabId,
					targetTabId: message.requestingTabId,
					siteSlug: message.siteSlug,
				};
				channel.postMessage(ackMessage);
			}
			break;

		case 'takeover-acknowledged':
			// The main tab has acknowledged our takeover request
			// This is handled by the waitForTakeoverAck listener in requestTakeover
			break;
	}
}
