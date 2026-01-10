import css from './save-status-indicator.module.css';
import classNames from 'classnames';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { Icon } from '@wordpress/components';
import { backup } from '@wordpress/icons';
import { setSiteManagerOpen } from '../../lib/state/redux/slice-ui';

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

export function BackupStatusIndicator() {
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();

	const {
		lastAccessDate,
		whenCreated,
		daysUsedSinceLastBackup = 0,
	} = activeSite?.metadata || {};

	// Only show backup indicator if user has returned after creation day
	const hasReturnedAfterCreation =
		whenCreated &&
		lastAccessDate &&
		!isSameDay(whenCreated, lastAccessDate);

	const handleOpenSettings = () => {
		dispatch(setSiteManagerOpen(true));
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
	const buttonText = formatUsageDays(daysUsedSinceLastBackup);
	const tooltipText =
		'Your Playground is stored in this browser. Browser data can be cleared unexpectedly, so regular backups keep your work safe.';

	return (
		<div className={classNames(css.indicator, css[urgency])}>
			<button
				className={classNames(css.saveButton, css[`${urgency}Button`])}
				onClick={handleOpenSettings}
				type="button"
				title={tooltipText}
			>
				<Icon icon={backup} size={16} />
				{buttonText}
			</button>
		</div>
	);
}
