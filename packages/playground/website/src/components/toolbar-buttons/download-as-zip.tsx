import { MenuItem } from '@wordpress/components';
import { useBackup } from '../../lib/hooks/use-backup';
import {
	useTakeover,
	usePendingTakeoverAction,
} from '../../lib/hooks/use-takeover';

type Props = { onClose: () => void; disabled: boolean };
export function DownloadAsZipMenuItem({ onClose, disabled }: Props) {
	const { performBackup, canBackup, isBackingUp } = useBackup();
	const { performTakeover, isTakingOver, isDependentMode } = useTakeover();

	// Auto-trigger backup after takeover + reload
	usePendingTakeoverAction(performBackup);

	const handleDownload = async () => {
		if (isDependentMode) {
			await performTakeover('backup');
			// Page will reload, no need to call onClose
			return;
		}
		await performBackup();
		onClose();
	};

	const isDisabled =
		disabled ||
		(!canBackup && !isDependentMode) ||
		isBackingUp ||
		isTakingOver;

	return (
		<MenuItem
			data-cy="download-as-zip"
			aria-label={
				isDependentMode
					? 'Reload to enable download'
					: 'Download the current playground as a .zip file'
			}
			disabled={isDisabled}
			onClick={handleDownload}
		>
			{isTakingOver
				? 'Reloading...'
				: isBackingUp
					? 'Downloading...'
					: 'Download as .zip'}
		</MenuItem>
	);
}
