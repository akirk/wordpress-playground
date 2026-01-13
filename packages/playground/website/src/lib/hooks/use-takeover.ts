import { useCallback, useState, useEffect } from 'react';
import { usePlaygroundClientInfo } from '../use-playground-client';
import { useActiveSite } from '../state/redux/store';
import { requestTakeover } from '../state/redux/tab-coordinator';

const PENDING_ACTION_KEY = 'playground-pending-takeover-action';

export type PendingAction = 'backup' | null;

/**
 * Store a pending action to execute after takeover + reload
 */
function setPendingAction(action: PendingAction): void {
	if (action) {
		sessionStorage.setItem(PENDING_ACTION_KEY, action);
	} else {
		sessionStorage.removeItem(PENDING_ACTION_KEY);
	}
}

/**
 * Get and clear the pending action (if any)
 */
export function consumePendingAction(): PendingAction {
	const action = sessionStorage.getItem(PENDING_ACTION_KEY) as PendingAction;
	if (action) {
		sessionStorage.removeItem(PENDING_ACTION_KEY);
	}
	return action;
}

/**
 * Hook to request taking over as the main tab from a dependent tab.
 * After successful takeover, the page will reload and boot as main.
 *
 * @param pendingAction - Optional action to execute after reload (e.g., 'backup')
 */
export function useTakeover() {
	const clientInfo = usePlaygroundClientInfo();
	const activeSite = useActiveSite();
	const [isTakingOver, setIsTakingOver] = useState(false);

	const isDependentMode = clientInfo?.isDependentMode ?? false;

	const performTakeover = useCallback(
		async (pendingAction?: PendingAction): Promise<boolean> => {
			if (!activeSite || !isDependentMode || isTakingOver) {
				return false;
			}

			setIsTakingOver(true);
			try {
				// Store the pending action before reload
				if (pendingAction) {
					setPendingAction(pendingAction);
				}

				const acknowledged = await requestTakeover(activeSite.slug);

				if (acknowledged) {
					// Takeover was acknowledged, reload to boot as main
					window.location.reload();
					return true;
				}

				// No main tab responded (maybe it closed?) - reload anyway
				// to let this tab become main through normal boot
				window.location.reload();
				return true;
			} finally {
				setIsTakingOver(false);
			}
		},
		[activeSite, isDependentMode, isTakingOver]
	);

	return {
		performTakeover,
		isTakingOver,
		isDependentMode,
		canTakeover: isDependentMode && !!activeSite,
	};
}

/**
 * Hook to check for and execute pending actions after takeover + reload
 */
export function usePendingTakeoverAction(onBackup: () => void) {
	const clientInfo = usePlaygroundClientInfo();
	const isMainMode = clientInfo && !clientInfo.isDependentMode;

	useEffect(() => {
		if (!isMainMode) return;

		const pendingAction = consumePendingAction();
		if (pendingAction === 'backup') {
			// Small delay to ensure everything is fully initialized
			const timer = setTimeout(() => {
				onBackup();
			}, 500);
			return () => clearTimeout(timer);
		}
	}, [isMainMode, onBackup]);
}
