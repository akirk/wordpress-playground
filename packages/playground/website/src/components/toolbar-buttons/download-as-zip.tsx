import { MenuItem } from '@wordpress/components';
import { useBackup } from '../../lib/hooks/use-backup';
import { useTakeover, useRemoteBackup } from '../../lib/hooks/use-takeover';

type Props = { onClose: () => void; disabled: boolean };
export function DownloadAsZipMenuItem({ onClose, disabled }: Props) {
	const { performBackup, canBackup, isBackingUp } = useBackup();
	const { isDependentMode } = useTakeover();
	const { requestBackup, isRequestingBackup } = useRemoteBackup();

	const handleDownload = async () => {
		if (isDependentMode) {
			await requestBackup();
			onClose();
			return;
		}
		await performBackup();
		onClose();
	};

	const isDisabled =
		disabled ||
		(!canBackup && !isDependentMode) ||
		isBackingUp ||
		isRequestingBackup;

	return (
		<MenuItem
			data-cy="download-as-zip"
			aria-label={
				isDependentMode
					? 'Download will occur in the main tab'
					: 'Download the current playground as a .zip file'
			}
			disabled={isDisabled}
			onClick={handleDownload}
		>
			{isRequestingBackup
				? 'Requesting...'
				: isBackingUp
					? 'Downloading...'
					: 'Download as .zip'}
		</MenuItem>
	);
}
