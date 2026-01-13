import { useState, useRef } from 'react';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { importWordPressFiles } from '@wp-playground/client';
import { useActiveSite } from '../../lib/state/redux/store';
import { Icon } from '@wordpress/icons';
import { check, backup, upload } from '@wordpress/icons';
import { logger } from '@php-wasm/logger';
import css from './style.module.css';
import { useBackup } from '../../lib/hooks/use-backup';

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
	const { performBackup, isBackingUp } = useBackup();
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
						onClick={performBackup}
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
