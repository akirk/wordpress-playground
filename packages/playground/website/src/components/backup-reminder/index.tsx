import { useState } from 'react';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';
import { Icon } from '@wordpress/icons';
import { check, backup } from '@wordpress/icons';
import css from './style.module.css';

function formatBackupFilename(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
	const time = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS
	return `playground-backup-${date}-${time}.zip`;
}

function isSameDay(timestamp1: number, timestamp2: number): boolean {
	const d1 = new Date(timestamp1);
	const d2 = new Date(timestamp2);
	return (
		d1.getFullYear() === d2.getFullYear() &&
		d1.getMonth() === d2.getMonth() &&
		d1.getDate() === d2.getDate()
	);
}

function formatRelativeDate(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) {
		return 'today';
	} else if (diffDays === 1) {
		return 'yesterday';
	} else if (diffDays < 7) {
		return `${diffDays} days ago`;
	} else {
		return new Date(timestamp).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}
}

export function BackupReminder() {
	const playground = usePlaygroundClient();
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const [isBackingUp, setIsBackingUp] = useState(false);

	if (!activeSite || activeSite.metadata.storage === 'none') {
		return null;
	}

	const { lastBackupDate, lastAccessDate } = activeSite.metadata;

	// Determine if backup is needed:
	// - Never backed up, OR
	// - Site accessed on a different day than last backup
	const needsBackup =
		!lastBackupDate ||
		(lastAccessDate && !isSameDay(lastBackupDate, lastAccessDate));

	const handleBackup = async () => {
		if (!playground || isBackingUp) return;

		setIsBackingUp(true);
		try {
			const bytes = await zipWpContent(playground, {
				selfContained: true,
			});
			const filename = formatBackupFilename();
			saveAs(new File([bytes], filename));

			// Update last backup date
			await dispatch(
				updateSiteMetadata({
					slug: activeSite.slug,
					changes: { lastBackupDate: Date.now() },
				})
			);
		} finally {
			setIsBackingUp(false);
		}
	};

	const lastBackupText = lastBackupDate
		? `Last backup: ${formatRelativeDate(lastBackupDate)}`
		: 'Never backed up';

	return (
		<div className={css.backupReminder}>
			<div className={css.backupContent}>
				<div className={css.backupStatus}>
					{needsBackup ? (
						<>
							<Icon icon={backup} className={css.backupIcon} />
							<div className={css.statusInfo}>
								<span className={css.statusText}>
									Backup recommended
								</span>
								<span className={css.lastBackupDate}>
									{lastBackupText}
								</span>
							</div>
						</>
					) : (
						<>
							<Icon icon={check} className={css.checkIcon} />
							<div className={css.statusInfo}>
								<span className={css.statusText}>
									Up to date
								</span>
								<span className={css.lastBackupDate}>
									{lastBackupText}
								</span>
							</div>
						</>
					)}
				</div>
				<button
					className={css.backupButton}
					onClick={handleBackup}
					disabled={!playground || isBackingUp}
				>
					{isBackingUp ? 'Backing up...' : 'Download backup'}
				</button>
			</div>
			<p className={css.backupDescription}>
				Download a .zip backup of your Playground to keep your work
				safe. You can restore it later using "Import .zip".
			</p>
		</div>
	);
}
