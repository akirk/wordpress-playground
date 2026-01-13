import { useState, useEffect } from 'react';
import {
	useActiveSite,
	useAppSelector,
	getActiveClientInfo,
} from '../../lib/state/redux/store';
import {
	getCurrentTabInfo,
	checkForExistingTabs,
} from '../../lib/state/redux/tab-coordinator';
import css from './worker-status-indicator.module.css';

export function WorkerStatusIndicator() {
	const activeSite = useActiveSite();
	const clientInfo = useAppSelector(getActiveClientInfo);
	const [otherTabCount, setOtherTabCount] = useState(0);
	const [workerLost, setWorkerLost] = useState(false);

	const hasOwnWorker = !!clientInfo;

	useEffect(() => {
		if (!activeSite) {
			return;
		}

		const tabInfo = getCurrentTabInfo();
		if (!tabInfo) {
			return;
		}

		let isActive = true;

		async function checkTabs() {
			try {
				const { existingTabs } = await checkForExistingTabs(
					activeSite.slug
				);
				if (!isActive) return;

				setOtherTabCount(existingTabs.length);

				if (!hasOwnWorker && existingTabs.length === 0) {
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

				if (message.type === 'pong' || message.type === 'tab-closing') {
					setTimeout(() => {
						if (isActive) {
							checkTabs();
						}
					}, 200);
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
				Reload required
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
		>
			{hasOwnWorker ? 'Main' : 'Dependent'}
		</div>
	);
}
