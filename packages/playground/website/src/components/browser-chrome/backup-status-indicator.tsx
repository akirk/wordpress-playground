import { useState } from 'react';
import css from './save-status-indicator.module.css';
import classNames from 'classnames';
import {
	useAppSelector,
	getActiveClientInfo,
	useActiveSite,
	useAppDispatch,
} from '../../lib/state/redux/store';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';
import { Icon } from '@wordpress/components';
import { check, backup } from '@wordpress/icons';

function formatBackupFilename(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
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

export function BackupStatusIndicator() {
	const clientInfo = useAppSelector(getActiveClientInfo);
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const playground = usePlaygroundClient();
	const [isBackingUp, setIsBackingUp] = useState(false);

	const { lastBackupDate, lastAccessDate } = activeSite?.metadata || {};

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

			if (activeSite) {
				await dispatch(
					updateSiteMetadata({
						slug: activeSite.slug,
						changes: { lastBackupDate: Date.now() },
					})
				);
			}
		} finally {
			setIsBackingUp(false);
		}
	};

	if (isBackingUp) {
		return (
			<div className={classNames(css.indicator, css.saving)}>
				<span className={css.spinner} />
				<span className={css.label}>Backing up...</span>
			</div>
		);
	}

	if (needsBackup) {
		return (
			<div className={classNames(css.indicator, css.unsaved)}>
				<Icon icon={backup} size={18} />
				<span className={css.label}>Backup recommended</span>
				<button
					className={css.saveButton}
					onClick={handleBackup}
					type="button"
					disabled={!playground}
				>
					Backup
				</button>
			</div>
		);
	}

	return (
		<button
			className={classNames(css.indicator, css.saved)}
			onClick={handleBackup}
			type="button"
			disabled={!playground}
			style={{ cursor: 'pointer' }}
			title="Click to create a backup"
		>
			<Icon icon={check} size={18} />
			<span className={css.label}>Backed up</span>
		</button>
	);
}
