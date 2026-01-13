import { useState, useEffect } from 'react';
import {
	useActiveSite,
	useAppSelector,
	getActiveClientInfo,
} from '../../lib/state/redux/store';
import {
	getCurrentTabInfo,
	checkForExistingTabs,
	type TabInfo,
} from '../../lib/state/redux/tab-coordinator';
import css from './style.module.css';

function formatLoadTime(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffMinutes = Math.floor(diffMs / (1000 * 60));

	if (diffMinutes < 1) {
		return 'just now';
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
	} else {
		const diffHours = Math.floor(diffMinutes / 60);
		if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else {
			const diffDays = Math.floor(diffHours / 24);
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		}
	}
}

export function TabInfoWindow() {
	const activeSite = useActiveSite();
	const clientInfo = useAppSelector(getActiveClientInfo);
	const [tabInfo, setTabInfo] = useState<TabInfo | null>(null);
	const [otherTabs, setOtherTabs] = useState<TabInfo[]>([]);
	const [loadTime, setLoadTime] = useState<Date | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);

	const hasOwnWorker = !!clientInfo;

	useEffect(() => {
		const currentTab = getCurrentTabInfo();
		if (currentTab) {
			setTabInfo(currentTab);
			setLoadTime(new Date(currentTab.createdAt));
		}
	}, []);

	useEffect(() => {
		if (!activeSite || !tabInfo) return;

		const knownTabs = new Map<string, TabInfo>();

		async function checkTabs() {
			try {
				const { existingTabs } = await checkForExistingTabs(
					activeSite.slug
				);
				knownTabs.clear();
				existingTabs.forEach((tab) => knownTabs.set(tab.tabId, tab));
				setOtherTabs(Array.from(knownTabs.values()));
			} catch (error) {
				console.error('Failed to check for existing tabs:', error);
			}
		}

		checkTabs();

		let channel: BroadcastChannel | null = null;
		try {
			channel = new BroadcastChannel('playground-tab-coordinator');

			const handleMessage = (event: MessageEvent) => {
				const message = event.data;

				if (message.type === 'pong' && message.tabInfo) {
					const otherTabId = message.tabInfo.tabId;
					if (otherTabId !== tabInfo.tabId) {
						knownTabs.set(otherTabId, message.tabInfo);
						setOtherTabs(Array.from(knownTabs.values()));
					}
				} else if (
					message.type === 'tab-closing' &&
					message.tabId !== tabInfo.tabId
				) {
					knownTabs.delete(message.tabId);
					setOtherTabs(Array.from(knownTabs.values()));
				}
			};

			channel.addEventListener('message', handleMessage);

			const handleBeforeUnload = () => {
				if (channel) {
					channel.postMessage({
						type: 'tab-closing',
						tabId: tabInfo.tabId,
					});
				}
			};

			window.addEventListener('beforeunload', handleBeforeUnload);

			const refreshInterval = setInterval(checkTabs, 60000);

			return () => {
				if (channel) {
					channel.postMessage({
						type: 'tab-closing',
						tabId: tabInfo.tabId,
					});
					channel.removeEventListener('message', handleMessage);
					channel.close();
				}
				window.removeEventListener('beforeunload', handleBeforeUnload);
				clearInterval(refreshInterval);
			};
		} catch (error) {
			console.warn('BroadcastChannel not supported:', error);
			const fallbackInterval = setInterval(checkTabs, 60000);
			return () => clearInterval(fallbackInterval);
		}
	}, [activeSite, tabInfo]);

	if (!tabInfo || !loadTime) {
		return null;
	}

	const sortedOtherTabs = [...otherTabs].sort(
		(a, b) => b.createdAt - a.createdAt
	);

	const oldestTabId =
		sortedOtherTabs.length > 0
			? sortedOtherTabs[sortedOtherTabs.length - 1].tabId
			: null;

	const workerTabId = hasOwnWorker ? tabInfo.tabId : oldestTabId;

	return (
		<div className={css.tabInfoWindow}>
			<div className={css.infoRow}>
				<span className={css.label}>WordPress loaded:</span>
				<span className={css.value} title={loadTime.toLocaleString()}>
					{formatLoadTime(tabInfo.createdAt)}
				</span>
			</div>
			{otherTabs.length > 0 && (
				<>
					<div className={css.accordionSection}>
						<div
							className={`${css.infoRow} ${css.clickable}`}
							onClick={() => setIsExpanded(!isExpanded)}
						>
							<span className={css.label}>Other tabs:</span>
							<span className={css.value}>
								{otherTabs.length}
								<span className={css.expandIcon}>
									{isExpanded ? ' ▼' : ' ▶'}
								</span>
							</span>
						</div>
						{isExpanded && (
							<div className={css.tabList}>
								{sortedOtherTabs.map((tab) => {
									const isWorkerTab =
										tab.tabId === workerTabId;
									return (
										<div
											key={tab.tabId}
											className={css.tabItem}
										>
											<span
												className={css.tabTime}
												title={new Date(
													tab.createdAt
												).toLocaleString()}
											>
												{formatLoadTime(tab.createdAt)}
											</span>
											{isWorkerTab && (
												<span
													className={css.workerBadge}
													title="This tab has the active worker"
												>
													Worker
												</span>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
					<div
						className={css.infoRow}
						title={
							hasOwnWorker
								? 'This tab has its own PHP worker'
								: 'This tab is reusing a worker from another tab (dependent mode)'
						}
					>
						<span className={css.label}>Worker:</span>
						<span className={css.value}>
							{hasOwnWorker ? 'Own' : 'Shared'}
						</span>
					</div>
				</>
			)}
		</div>
	);
}
