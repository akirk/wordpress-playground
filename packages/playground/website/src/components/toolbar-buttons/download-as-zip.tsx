import { MenuItem } from '@wordpress/components';

import type { PlaygroundClient } from '@wp-playground/client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';

function sanitizeForFilename(name: string): string {
	return name
		.trim()
		.replace(/['']/g, '') // Remove apostrophes
		.replace(/[/\\:*?"<>|]/g, '') // Remove filesystem-unsafe characters
		.replace(/\s+/g, '-'); // Replace whitespace with dashes
}

function formatBackupFilename(siteName: string): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
	const time = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS
	const sanitized = sanitizeForFilename(siteName);
	return `${sanitized}-backup-${date}-${time}.zip`;
}

type Props = { onClose: () => void; disabled: boolean };
export function DownloadAsZipMenuItem({ onClose, disabled }: Props) {
	const playground = usePlaygroundClient();
	const dispatch = useAppDispatch();
	const activeSite = useActiveSite();

	const handleDownload = async () => {
		if (!playground) return;

		// Get site name from WordPress
		let siteName = activeSite?.metadata.name || 'playground';
		try {
			const response = await playground.run({
				code: `<?php
					require_once '/wordpress/wp-load.php';
					echo get_option('blogname', 'WordPress');
				`,
			});
			const wpSiteName = response.text.trim();
			if (wpSiteName) {
				siteName = wpSiteName;
			}
		} catch (e) {
			// Fall back to metadata name
		}

		const filename = await startDownload(playground, siteName);

		// Update backup history for persistent sites
		if (activeSite && activeSite.metadata.storage !== 'none') {
			const backupHistory = activeSite.metadata.backupHistory || [];
			const newHistory = [
				{ filename, timestamp: Date.now() },
				...backupHistory.slice(0, 9),
			];
			dispatch(
				updateSiteMetadata({
					slug: activeSite.slug,
					changes: {
						backupHistory: newHistory,
						daysUsedSinceLastBackup: 0,
					},
				})
			);
		}

		onClose();
	};

	return (
		<MenuItem
			data-cy="download-as-zip"
			aria-label="Download the current playground as a .zip file"
			disabled={disabled}
			onClick={handleDownload}
		>
			Download as .zip
		</MenuItem>
	);
}

async function startDownload(
	playground: PlaygroundClient,
	siteName: string
): Promise<string> {
	const bytes = await zipWpContent(playground, {
		selfContained: true,
	});
	const filename = formatBackupFilename(siteName);
	saveAs(new File([bytes], filename));
	return filename;
}
