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
}
`,
		},
		{
			step: 'login',
		},
	],
	landingPage:
		'/wp-admin/site-health.php?tab=troubleshoot&health-check-disable-plugin-hash=playground-recovery',
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
