import { useState, useCallback, useEffect } from 'react';
import {
	usePlaygroundClient,
	usePlaygroundClientInfo,
} from '../use-playground-client';
import { useActiveSite, useAppDispatch } from '../state/redux/store';
import { updateSiteMetadata } from '../state/redux/slice-sites';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { setBackupRequestCallback } from '../state/redux/tab-coordinator';

function sanitizeForFilename(name: string): string {
	return name
		.trim()
		.replace(/['']/g, '')
		.replace(/[/\\:*?"<>|]/g, '')
		.replace(/\s+/g, '-');
}

function formatBackupFilename(siteName: string): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
	const sanitized = sanitizeForFilename(siteName);
	return `${sanitized}-backup-${date}-${time}.zip`;
}

async function getWordPressSiteName(
	playground: NonNullable<ReturnType<typeof usePlaygroundClient>>
): Promise<string | null> {
	try {
		const response = await playground.run({
			code: `<?php
				require_once '/wordpress/wp-load.php';
				echo html_entity_decode(get_option('blogname', 'WordPress'), ENT_QUOTES, 'UTF-8');
			`,
		});
		const name = response.text.trim();
		return name || null;
	} catch {
		return null;
	}
}

export function useBackup() {
	const playground = usePlaygroundClient();
	const clientInfo = usePlaygroundClientInfo();
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const [isBackingUp, setIsBackingUp] = useState(false);

	const isMainMode = clientInfo && !clientInfo.isDependentMode;

	const performBackup = useCallback(async (): Promise<boolean> => {
		if (!playground || !activeSite || isBackingUp) {
			return false;
		}

		setIsBackingUp(true);
		try {
			// Get site name from WordPress, fall back to metadata
			const wpSiteName = await getWordPressSiteName(playground);
			const siteName =
				wpSiteName || activeSite.metadata.name || 'playground';

			const bytes = await zipWpContent(playground, {
				selfContained: true,
			});
			const filename = formatBackupFilename(siteName);
			const timestamp = Date.now();
			saveAs(new File([bytes], filename));

			// Update backup history for persistent sites
			if (activeSite.metadata.storage !== 'none') {
				const backupHistory = activeSite.metadata.backupHistory || [];
				const newHistory = [
					{ filename, timestamp },
					...backupHistory.slice(0, 9),
				];
				await dispatch(
					updateSiteMetadata({
						slug: activeSite.slug,
						changes: {
							backupHistory: newHistory,
							daysUsedSinceLastBackup: 0,
						},
					})
				);
			}

			return true;
		} finally {
			setIsBackingUp(false);
		}
	}, [playground, activeSite, isBackingUp, dispatch]);

	// Register this tab as the backup handler when in main mode
	useEffect(() => {
		if (isMainMode && playground && activeSite) {
			setBackupRequestCallback(performBackup);
			return () => {
				setBackupRequestCallback(null);
			};
		}
	}, [isMainMode, playground, activeSite, performBackup]);

	return {
		performBackup,
		isBackingUp,
		canBackup: !!playground && !!activeSite,
	};
}
