import { useState, useRef } from 'react';
import css from './save-status-indicator.module.css';
import classNames from 'classnames';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { zipWpContent } from '@wp-playground/client';
import saveAs from 'file-saver';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';
import { Icon, Popover } from '@wordpress/components';
import { backup, info, check } from '@wordpress/icons';
import { setSiteManagerOpen } from '../../lib/state/redux/slice-ui';

function sanitizeForFilename(name: string): string {
	return name
		.trim()
		.replace(/['']/g, '') // Remove apostrophes
		.replace(/[/\\:*?"<>|]/g, '') // Remove filesystem-unsafe characters
		.replace(/\s+/g, '-'); // Replace whitespace with dashes
}

function formatBackupFilename(siteName: string): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
	const sanitized = sanitizeForFilename(siteName);
	return `${sanitized}-backup-${date}-${time}.zip`;
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
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const playground = usePlaygroundClient();
	const [isBackingUp, setIsBackingUp] = useState(false);
	const [showInfoPopover, setShowInfoPopover] = useState(false);
	const infoButtonRef = useRef<HTMLButtonElement>(null);

	const {
		backupHistory = [],
		lastAccessDate,
		whenCreated,
	} = activeSite?.metadata || {};
	const lastBackupDate = backupHistory[0]?.timestamp;

	// Only show backup indicator if user has returned after creation day
	const hasReturnedAfterCreation =
		whenCreated &&
		lastAccessDate &&
		!isSameDay(whenCreated, lastAccessDate);

	const needsBackup =
		!lastBackupDate ||
		(lastAccessDate && !isSameDay(lastBackupDate, lastAccessDate));

	const handleBackup = async () => {
		if (!playground || isBackingUp || !activeSite) return;

		setIsBackingUp(true);
		try {
			// Get site name from WordPress
			let siteName = activeSite.metadata.name;
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
					changes: { backupHistory: newHistory },
				})
			);
		} finally {
			setIsBackingUp(false);
		}
	};

	const handleOpenSettings = () => {
		setShowInfoPopover(false);
		dispatch(setSiteManagerOpen(true));
	};

	// Hide on first day - no need to prompt for backup yet
	if (!hasReturnedAfterCreation) {
		return null;
	}

	if (isBackingUp) {
		return (
			<div className={classNames(css.indicator, css.saving)}>
				<span className={css.spinner} />
				<span className={css.label}>Backing up...</span>
			</div>
		);
	}

	// Backup is current - show green checkmark
	if (!needsBackup) {
		return (
			<div
				className={classNames(css.indicator, css.saved)}
				title="Backed up"
			>
				<Icon icon={check} size={18} />
			</div>
		);
	}

	return (
		<div className={classNames(css.indicator, css.unsaved)}>
			<button
				className={css.saveButton}
				onClick={handleBackup}
				type="button"
				disabled={!playground}
			>
				<Icon icon={backup} size={16} />
				Backup
			</button>
			<button
				ref={infoButtonRef}
				className={css.infoButton}
				onClick={() => setShowInfoPopover(!showInfoPopover)}
				type="button"
				aria-label="Why backup?"
			>
				<Icon icon={info} size={18} />
			</button>
			{showInfoPopover && (
				<Popover
					anchor={infoButtonRef.current}
					placement="bottom-end"
					onClose={() => setShowInfoPopover(false)}
					className={css.infoPopover}
				>
					<div className={css.infoPopoverContent}>
						<h4>Why backup?</h4>
						<p>
							Your Playground is stored in this browser. Browser
							data can be cleared unexpectedly, so regular backups
							keep your work safe.
						</p>
						<p>
							To restore a backup, open Settings and use "Import
							backup".
						</p>
						<button
							className={css.infoPopoverLink}
							onClick={handleOpenSettings}
							type="button"
						>
							Open Settings
						</button>
					</div>
				</Popover>
			)}
		</div>
	);
}
