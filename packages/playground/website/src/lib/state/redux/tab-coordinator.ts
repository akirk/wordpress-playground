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

type TabCoordinatorMessage = PingMessage | PongMessage | ShutdownRequestMessage;

const CHANNEL_NAME = 'playground-tab-coordinator';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PING_TIMEOUT_MS = 150;

let channel: BroadcastChannel | null = null;
let currentTabInfo: TabInfo | null = null;
let shutdownCallback: ((reason: string) => void) | null = null;

/**
 * Initialize the tab coordinator for a specific site.
 *
 * @param siteSlug - The slug of the site being loaded
 * @param onShutdownRequested - Callback when this tab should shut down
 * @returns TabInfo for the current tab
 */
export function initTabCoordinator(
	siteSlug: string,
	onShutdownRequested?: (reason: string) => void
): TabInfo {
	if (currentTabInfo && currentTabInfo.siteSlug === siteSlug) {
		return currentTabInfo;
	}

	// Clean up existing if switching sites
	if (channel) {
		channel.close();
	}

	currentTabInfo = {
		tabId: crypto.randomUUID(),
		createdAt: Date.now(),
		siteSlug,
	};

	shutdownCallback = onShutdownRequested || null;

	try {
		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = handleMessage;
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
	if (!channel || !currentTabInfo) {
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
	channel.postMessage(pingMessage);

	// Wait for responses
	await new Promise((resolve) => setTimeout(resolve, PING_TIMEOUT_MS));

	channel.removeEventListener('message', pongHandler);

	const hasFreshTab = existingTabs.some(
		(tab) => now - tab.createdAt < ONE_DAY_MS
	);
	const hasStaleTab = existingTabs.some(
		(tab) => now - tab.createdAt >= ONE_DAY_MS
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
			if (message.siteSlug === currentTabInfo.siteSlug) {
				const pongMessage: PongMessage = {
					type: 'pong',
					tabInfo: currentTabInfo,
				};
				channel.postMessage(pongMessage);
			}
			break;

		case 'shutdown-request':
			// Another tab is requesting we shut down
			if (message.targetTabId === currentTabInfo.tabId) {
				const reason =
					message.reason === 'stale'
						? 'This tab has been open for over a day and a newer tab was opened.'
						: 'A newer tab has taken over this session.';
				shutdownCallback?.(reason);
			}
			break;
	}
}
