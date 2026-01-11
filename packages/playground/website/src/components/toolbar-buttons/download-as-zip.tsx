import { MenuItem } from '@wordpress/components';
import { useBackup } from '../../lib/hooks/use-backup';

type Props = { onClose: () => void; disabled: boolean };
export function DownloadAsZipMenuItem({ onClose, disabled }: Props) {
	const { performBackup, canBackup } = useBackup();

	const handleDownload = async () => {
		await performBackup();
		onClose();
	};

	return (
		<MenuItem
			data-cy="download-as-zip"
			aria-label="Download the current playground as a .zip file"
			disabled={disabled || !canBackup}
			onClick={handleDownload}
		>
			Download as .zip
		</MenuItem>
	);
}
