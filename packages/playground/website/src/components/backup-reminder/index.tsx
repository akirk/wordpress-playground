import { useState, useRef } from 'react';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { zipWpContent, importWordPressFiles } from '@wp-playground/client';
import saveAs from 'file-saver';
import { useActiveSite, useAppDispatch } from '../../lib/state/redux/store';
import { updateSiteMetadata } from '../../lib/state/redux/slice-sites';
import { Icon } from '@wordpress/icons';
import { check, backup, upload } from '@wordpress/icons';
import { logger } from '@php-wasm/logger';
import css from './style.module.css';

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

interface BackupReminderProps {
	wpSiteName?: string | null;
}

export function BackupReminder({ wpSiteName }: BackupReminderProps = {}) {
	const playground = usePlaygroundClient();
	const activeSite = useActiveSite();
	const dispatch = useAppDispatch();
	const [isBackingUp, setIsBackingUp] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [showHistory, setShowHistory] = useState(false);
	const importInputRef = useRef<HTMLInputElement>(null);

	if (!activeSite || activeSite.metadata.storage === 'none') {
		return null;
	}

	const { backupHistory = [], lastAccessDate } = activeSite.metadata;
	const lastBackup = backupHistory[0];
	const lastBackupDate = lastBackup?.timestamp;

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
			const siteName = wpSiteName || activeSite.metadata.name;
			const bytes = await zipWpContent(playground, {
				selfContained: true,
			});
			const filename = formatBackupFilename(siteName);
			const timestamp = Date.now();
			saveAs(new File([bytes], filename));

			const newHistory = [
				{ filename, timestamp },
				...backupHistory.slice(0, 9), // Keep max 10 entries
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

	const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !playground) return;

		const proceed = window.confirm(
			'Importing a backup will replace all current content. Are you sure you want to continue?'
		);
		if (!proceed) {
			if (importInputRef.current) {
				importInputRef.current.value = '';
			}
			return;
		}

		setIsImporting(true);
		try {
			await importWordPressFiles(playground, { wordPressFilesZip: file });
			await playground.goTo('/');
			alert('Backup imported successfully! The page will now refresh.');
			window.location.reload();
		} catch (error) {
			logger.error(error);
			alert(
				'Unable to import backup. Is it a valid WordPress Playground export?'
			);
		} finally {
			setIsImporting(false);
			if (importInputRef.current) {
				importInputRef.current.value = '';
			}
		}
	};

	const hasHistory = backupHistory.length > 0;
	const lastBackupText = lastBackup
		? `Downloaded ${formatRelativeDate(lastBackup.timestamp)}`
		: 'Never backed up';

	const renderLastBackupDate = () => {
		if (!hasHistory) {
			return <span className={css.lastBackupDate}>{lastBackupText}</span>;
		}
		return (
			<button
				className={css.lastBackupDateButton}
				onClick={() => setShowHistory(!showHistory)}
			>
				{lastBackupText}
				<span className={css.historyIndicator}>
					{showHistory ? '▲' : '▼'}
				</span>
			</button>
		);
	};

	return (
		<div className={css.backupReminder}>
			<input
				type="file"
				ref={importInputRef}
				onChange={handleImport}
				accept=".zip,application/zip"
				style={{ display: 'none' }}
			/>
			<div className={css.backupContent}>
				<div className={css.backupStatus}>
					{needsBackup ? (
						<>
							<Icon icon={backup} className={css.backupIcon} />
							<div className={css.statusInfo}>
								<span className={css.statusText}>
									Backup recommended
								</span>
								{renderLastBackupDate()}
							</div>
						</>
					) : (
						<>
							<Icon icon={check} className={css.checkIcon} />
							<div className={css.statusInfo}>
								<span className={css.statusText}>
									Up to date
								</span>
								{renderLastBackupDate()}
							</div>
						</>
					)}
				</div>
				<div className={css.backupActions}>
					<button
						className={css.backupButton}
						onClick={handleBackup}
						disabled={!playground || isBackingUp || isImporting}
					>
						{isBackingUp ? 'Backing up...' : 'Download backup'}
					</button>
					<button
						className={css.importButton}
						onClick={() => importInputRef.current?.click()}
						disabled={!playground || isBackingUp || isImporting}
					>
						<Icon icon={upload} size={16} />
						{isImporting ? 'Importing...' : 'Import backup'}
					</button>
				</div>
			</div>
			{showHistory && (
				<ul className={css.backupHistoryList}>
					{backupHistory.map((entry, index) => (
						<li key={index} className={css.backupHistoryItem}>
							<span className={css.backupFilename}>
								{entry.filename}
							</span>
							<span className={css.backupDate}>
								{formatRelativeDate(entry.timestamp)}
							</span>
						</li>
					))}
				</ul>
			)}
			<p className={css.backupDescription}>
				Your Playground is stored in this browser. Browser data can be
				cleared unexpectedly, so regular backups keep your work safe.
			</p>
		</div>
	);
}
