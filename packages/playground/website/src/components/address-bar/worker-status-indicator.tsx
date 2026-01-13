import { useState, useEffect, useRef } from 'react';
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
import css from './worker-status-indicator.module.css';

interface WorkerStatusIndicatorProps {
	onOpenOverlay?: () => void;
}

export function WorkerStatusIndicator({
	onOpenOverlay,
}: WorkerStatusIndicatorProps) {
	const activeSite = useActiveSite();
	const clientInfo = useAppSelector(getActiveClientInfo);
	const [otherTabCount, setOtherTabCount] = useState(0);
	const [workerLost, setWorkerLost] = useState(false);
	const knownTabsRef = useRef<Map<string, TabInfo>>(new Map());

	// In dependent mode, we have a clientInfo but it's using another tab's worker
	const hasOwnWorker = !!clientInfo && !clientInfo.isDependentMode;

	useEffect(() => {
		if (!activeSite) {
			return;
		}

		const tabInfo = getCurrentTabInfo();
		if (!tabInfo) {
			return;
		}

		let isActive = true;
		const knownTabs = knownTabsRef.current;

		async function checkTabs() {
			try {
				const { existingTabs } = await checkForExistingTabs(
					activeSite.slug
				);
				if (!isActive) return;

				knownTabs.clear();
				existingTabs.forEach((tab) => knownTabs.set(tab.tabId, tab));
				setOtherTabCount(knownTabs.size);

				if (!hasOwnWorker && knownTabs.size === 0) {
					setWorkerLost(true);
				}
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
						setOtherTabCount(knownTabs.size);
					}
				} else if (
					message.type === 'tab-closing' &&
					message.tabId !== tabInfo.tabId
				) {
					knownTabs.delete(message.tabId);
					setOtherTabCount(knownTabs.size);
					if (!hasOwnWorker && knownTabs.size === 0) {
						setWorkerLost(true);
					}
				}
			};

			channel.addEventListener('message', handleMessage);

			const refreshInterval = setInterval(checkTabs, 60000);

			return () => {
				isActive = false;
				if (channel) {
					channel.removeEventListener('message', handleMessage);
					channel.close();
				}
				clearInterval(refreshInterval);
			};
		} catch (error) {
			console.warn('BroadcastChannel not supported:', error);
			return () => {
				isActive = false;
			};
		}
	}, [activeSite, hasOwnWorker]);

	if (otherTabCount === 0 && !workerLost) {
		return null;
	}

	if (workerLost) {
		return (
			<div
				className={`${css.badge} ${css.workerLost}`}
				title="Worker connection lost. Click to reload."
				onClick={() => window.location.reload()}
			>
				<span className={css.reloadText}>Reload required</span>
				<svg
					className={css.reloadIcon}
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="currentColor"
				>
					<path d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0.01 3.58 0.01 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z" />
				</svg>
			</div>
		);
	}

	return (
		<div
			className={css.badge}
			title={
				hasOwnWorker
					? `This tab has its own worker (${otherTabCount} other tab${otherTabCount === 1 ? '' : 's'})`
					: `This tab depends on another tab's worker (${otherTabCount} other tab${otherTabCount === 1 ? '' : 's'})`
			}
			onClick={onOpenOverlay}
			style={{ cursor: onOpenOverlay ? 'pointer' : 'default' }}
		>
			{hasOwnWorker ? 'Main' : 'Dependent'}
		</div>
	);
}
