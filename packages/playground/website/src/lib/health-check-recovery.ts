//
// The Health Check MU-plugin requires a database option 'health-check-disable-plugin-hash'
// that matches: cookieValue + md5(REMOTE_ADDR). We add an earlier MU-plugin (alphabetically)
// that uses pre_option filter to return the expected hash, bypassing the database check.
export const healthCheckRecoveryBlueprint = {
	steps: [
		{
			step: 'installPlugin',
			pluginData: {
				resource: 'wordpress.org/plugins',
				slug: 'health-check',
			},
			options: {
				activate: false,
			},
		},
		{
			step: 'mkdir',
			path: '/wordpress/wp-content/mu-plugins',
		},
		{
			step: 'cp',
			fromPath:
				'/wordpress/wp-content/plugins/health-check/mu-plugin/health-check-troubleshooting-mode.php',
			toPath: '/wordpress/wp-content/mu-plugins/health-check-troubleshooting-mode.php',
		},
		{
			// Add an MU-plugin that loads before health-check (alphabetically: "0" < "h")
			// to provide the expected hash via pre_option filter
			step: 'writeFile',
			path: '/wordpress/wp-content/mu-plugins/0-health-check-hash-bypass.php',
			data: `<?php
// Bypass Health Check hash verification by setting both the GET param and option.
// Self-delete when user disables troubleshooting mode via Health Check UI.
if (isset($_GET['health-check-disable-troubleshooting'])) {
    @unlink(__FILE__);
} else {
    $_GET['health-check-disable-plugin-hash'] = 'playground-recovery';
    add_filter('pre_option_health-check-disable-plugin-hash', function() {
        return 'playground-recovery';
    });
    // Don't try to switch to a default theme
    add_filter('pre_option_health-check-default-theme', function() {
        return 'no';
    });
    // Add admin notice with guidance
    add_action('admin_notices', function() {
        $ai_assistant_installed = file_exists(WP_PLUGIN_DIR . '/playground-ai-assistant/playground-ai-assistant.php');

        // Find recently modified plugins (within last 10 minutes)
        $recent_plugins = [];
        $threshold = time() - 600;
        foreach (glob(WP_PLUGIN_DIR . '/*', GLOB_ONLYDIR) as $plugin_dir) {
            $plugin_slug = basename($plugin_dir);
            $main_file = $plugin_dir . '/' . $plugin_slug . '.php';
            if (file_exists($main_file) && filemtime($main_file) > $threshold) {
                if (!function_exists('get_plugin_data')) {
                    require_once ABSPATH . 'wp-admin/includes/plugin.php';
                }
                $plugin_data = get_plugin_data($main_file);
                $recent_plugins[] = $plugin_data['Name'] ?: $plugin_slug;
            }
        }
        ?>
        <div class="notice notice-warning">
            <p><strong>Troubleshooting Mode Active</strong></p>
            <p>You cannot deactivate plugins in this mode.</p>
            <?php if (!empty($recent_plugins)): ?>
            <p><strong>Recently modified plugins that may be causing issues:</strong></p>
            <ul>
                <?php foreach ($recent_plugins as $plugin_name): ?>
                <li><?php echo esc_html($plugin_name); ?></li>
                <?php endforeach; ?>
            </ul>
            <?php endif; ?>
            <?php if ($ai_assistant_installed): ?>
            <p>If you made changes using the AI Assistant that caused issues, you can:</p>
            <ol>
                <li>Activate the <strong>Playground AI Assistant</strong> plugin below</li>
                <li>Go to <strong>Tools &rarr; AI Changes</strong> to revert any problematic changes</li>
            </ol>
            <?php else: ?>
            <p>Need help fixing broken code? Install the <strong>Playground AI Assistant</strong> from the <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="vertical-align: text-bottom"><path d="M6 5.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5zM4 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm11-.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5zM13 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V6zm5 8.5h-3a.5.5 0 00-.5.5v3a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-3a.5.5 0 00-.5-.5zM15 13a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2v-3a2 2 0 00-2-2h-3zm-9 1.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5zM4 15a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3z" fill-rule="evenodd" clip-rule="evenodd"></path></svg> grid icon in the top bar to get AI-powered help reverting problematic changes.</p>
            <?php endif; ?>
            <p>Once fixed, disable troubleshooting mode via <a href="<?php echo admin_url('site-health.php?tab=troubleshoot'); ?>">Site Health &rarr; Troubleshoot</a>.</p>
        </div>
        <?php
    });
}
`,
		},
		{
			step: 'login',
		},
	],
	landingPage:
		'/wp-admin/plugins.php?health-check-disable-plugin-hash=playground-recovery',
};

export function getBlueprintUrl(blueprint: object): string {
	const url = new URL(window.location.href);
	url.hash = '';
	const jsonStr = JSON.stringify(blueprint);
	const encoded = btoa(
		encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) =>
			String.fromCharCode(parseInt(p1, 16))
		)
	);
	url.searchParams.set(
		'blueprint-url',
		`data:application/json;base64,${encoded}`
	);
	return url.toString();
}

export function getHealthCheckRecoveryUrl(): string {
	return getBlueprintUrl(healthCheckRecoveryBlueprint);
}
