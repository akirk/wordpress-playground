import { MenuItem } from '@wordpress/components';

import type { PlaygroundClient } from '@wp-playground/client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';

function formatBackupFilename(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
	const time = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS
	return `playground-backup-${date}-${time}.zip`;
}

type Props = { onClose: () => void; disabled: boolean };
export function DownloadAsZipMenuItem({ onClose, disabled }: Props) {
	const playground = usePlaygroundClient();
	const dispatch = useAppDispatch();
	const activeSite = useActiveSite();

	const handleDownload = async () => {
		if (!playground) return;

		await startDownload(playground);

		// Update backup date for persistent sites
		if (activeSite && activeSite.metadata.storage !== 'none') {
			dispatch(
				updateSiteMetadata({
					slug: activeSite.slug,
					changes: { lastBackupDate: Date.now() },
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

async function startDownload(playground: PlaygroundClient) {
	const bytes = await zipWpContent(playground, {
		selfContained: true,
	});
	saveAs(new File([bytes], formatBackupFilename()));
}
