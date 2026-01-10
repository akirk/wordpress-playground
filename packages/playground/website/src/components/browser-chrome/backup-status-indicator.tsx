import { useState } from 'react';
import css from './save-status-indicator.module.css';
import classNames from 'classnames';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { Icon, Spinner } from '@wordpress/components';
import { backup } from '@wordpress/icons';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';

function isSameDay(timestamp1: number, timestamp2: number): boolean {
	const d1 = new Date(timestamp1);
	const d2 = new Date(timestamp2);
	return (
		d1.getFullYear() === d2.getFullYear() &&
		d1.getMonth() === d2.getMonth() &&
		d1.getDate() === d2.getDate()
	);
}

function formatUsageDays(days: number): string {
	if (days === 1) return '1 day since backup';
	return `${days} days since backup`;
}

type BackupUrgency = 'current' | 'due' | 'overdue';

function getBackupUrgency(daysUsed: number): BackupUrgency {
	if (daysUsed <= 1) return 'current';
	if (daysUsed <= 4) return 'due';
	return 'overdue';
}

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

export function BackupStatusIndicator() {
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const playground = usePlaygroundClient();
	const [isBackingUp, setIsBackingUp] = useState(false);

	const {
		lastAccessDate,
		whenCreated,
		daysUsedSinceLastBackup = 0,
		backupHistory = [],
	} = activeSite?.metadata || {};

	// Only show backup indicator if user has returned after creation day
	const hasReturnedAfterCreation =
		whenCreated &&
		lastAccessDate &&
		!isSameDay(whenCreated, lastAccessDate);

	const handleBackup = async () => {
		if (!playground || !activeSite || isBackingUp) return;

		setIsBackingUp(true);
		try {
			const siteName = activeSite.metadata.name;
			const bytes = await zipWpContent(playground, {
				selfContained: true,
			});
			const filename = formatBackupFilename(siteName);
			const timestamp = Date.now();
			saveAs(new File([bytes], filename));

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
		} finally {
			setIsBackingUp(false);
		}
	};

	// Hide on first day - no need to prompt for backup yet
	if (!hasReturnedAfterCreation) {
		return null;
	}

	// Hide if no usage since last backup (or site is new with 0 days tracked)
	if (daysUsedSinceLastBackup === 0) {
		return null;
	}

	const urgency = getBackupUrgency(daysUsedSinceLastBackup);
	const buttonText = isBackingUp
		? 'Backing up...'
		: formatUsageDays(daysUsedSinceLastBackup);
	const tooltipText =
		'Your Playground is stored in this browser. Browser data can be cleared unexpectedly. Click to download a backup.';

	return (
		<div className={classNames(css.indicator, css[urgency])}>
			<button
				className={classNames(css.saveButton, css[`${urgency}Button`])}
				onClick={handleBackup}
				disabled={isBackingUp}
				type="button"
				title={tooltipText}
			>
				{isBackingUp ? <Spinner /> : <Icon icon={backup} size={16} />}
				{buttonText}
			</button>
		</div>
	);
}
