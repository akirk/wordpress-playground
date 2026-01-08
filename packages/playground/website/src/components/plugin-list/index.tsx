import { useState, useEffect } from 'react';
import { usePlaygroundClient } from '../../lib/use-playground-client';
import { logger } from '@php-wasm/logger';
import css from './style.module.css';

interface PluginListProps {
	activePlugins: string[];
	pluginNames: Record<string, string>;
	isLoading: boolean;
}

export function PluginList({
	activePlugins,
	pluginNames,
	isLoading,
}: PluginListProps) {
	const playground = usePlaygroundClient();
	const [pluginsToKeep, setPluginsToKeep] = useState<Set<string>>(new Set());

	useEffect(() => {
		setPluginsToKeep(new Set(activePlugins));
	}, [activePlugins]);
	const [isSaving, setIsSaving] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);

	function togglePlugin(pluginPath: string) {
		setPluginsToKeep((prev) => {
			const next = new Set(prev);
			if (next.has(pluginPath)) {
				next.delete(pluginPath);
			} else {
				next.add(pluginPath);
			}
			return next;
		});
	}

	async function handleSaveAndReboot() {
		if (!playground || isSaving) {
			return;
		}

		setIsSaving(true);
		try {
			const pluginsToDeactivate = activePlugins.filter(
				(p) => !pluginsToKeep.has(p)
			);
			logger.log('Deactivating plugins:', pluginsToDeactivate);
			const deactivateJson = JSON.stringify(pluginsToDeactivate);

			const response = await playground.run({
				code: `<?php
					// Prevent plugins from loading (like WP-CLI --skip-plugins)
					define('WP_INSTALLING', true);

					require_once '/wordpress/wp-load.php';
					require_once ABSPATH . 'wp-admin/includes/plugin.php';

					$before_plugins = get_option('active_plugins', []);

					$to_deactivate = json_decode(getenv('DEACTIVATE_JSON'), true);
					if (!is_array($to_deactivate)) {
						echo json_encode(['error' => 'Failed to parse DEACTIVATE_JSON']);
						exit;
					}

					// Use WordPress's deactivate_plugins function
					deactivate_plugins($to_deactivate, true); // true = silent, no hooks

					// Clear any plugin-related caches/transients
					wp_cache_delete('alloptions', 'options');
					delete_transient('plugin_slugs');

					$after_plugins = get_option('active_plugins', []);

					// Double-check by reading directly from database
					global $wpdb;
					$db_value = $wpdb->get_var("SELECT option_value FROM {$wpdb->options} WHERE option_name = 'active_plugins'");
					$db_plugins = maybe_unserialize($db_value);

					echo json_encode([
						'success' => true,
						'before' => $before_plugins,
						'after' => $after_plugins,
						'after_from_db' => $db_plugins,
						'deactivated' => $to_deactivate
					]);
				`,
				env: { DEACTIVATE_JSON: deactivateJson },
			});

			const result = JSON.parse(response.text);
			if (result.error) {
				throw new Error(result.error);
			}

			logger.log('Plugin save result:', result);
			window.location.reload();
		} catch (error) {
			logger.error('Failed to save plugins:', error);
			alert('Failed to save plugin changes. Please try again.');
			setIsSaving(false);
		}
	}

	const hasChanges =
		activePlugins.length !== pluginsToKeep.size ||
		activePlugins.some((p) => !pluginsToKeep.has(p));

	return (
		<div className={css.pluginListContainer}>
			<p className={css.description}>
				If a plugin is causing issues,{' '}
				<button
					className={css.textButton}
					onClick={() => setIsExpanded(!isExpanded)}
				>
					you can disable it here
				</button>
				.
			</p>
			{isExpanded &&
				(isLoading ? (
					<p className={css.description}>Loading plugins...</p>
				) : activePlugins.length === 0 ? (
					<p className={css.description}>No active plugins</p>
				) : (
					<>
						<div className={css.pluginList}>
							{activePlugins.map((plugin) => (
								<label key={plugin} className={css.pluginItem}>
									<input
										type="checkbox"
										checked={pluginsToKeep.has(plugin)}
										onChange={() => togglePlugin(plugin)}
									/>
									<span className={css.pluginName}>
										{pluginNames[plugin] || plugin}
									</span>
								</label>
							))}
						</div>
						{hasChanges && (
							<button
								className={css.primaryButton}
								onClick={handleSaveAndReboot}
								disabled={isSaving}
							>
								{isSaving ? 'Saving...' : 'Save and reboot'}
							</button>
						)}
					</>
				))}
		</div>
	);
}
