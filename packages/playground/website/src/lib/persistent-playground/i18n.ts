// @ts-ignore
import { corsProxyUrl } from 'virtual:cors-proxy-url';

/**
 * Map of browser language codes to WordPress locale codes.
 */
const browserToWordPressLocale: Record<string, string> = {
	de: 'de_DE',
	'de-DE': 'de_DE',
	'de-AT': 'de_AT',
	'de-CH': 'de_CH',
};

interface TranslationsManifest {
	available: Record<string, { contentDir?: string }>;
	fallbacks: Record<string, string>;
}

let cachedManifest: TranslationsManifest | null = null;

async function fetchTranslationsManifest(
	blueprintBaseUrl: string
): Promise<TranslationsManifest | null> {
	if (cachedManifest) {
		return cachedManifest;
	}

	try {
		const manifestUrl = new URL(
			'../plugins/playground-welcome/translations.json',
			blueprintBaseUrl
		).href;
		const response = await fetch(manifestUrl);
		if (!response.ok) {
			return null;
		}
		cachedManifest = await response.json();
		return cachedManifest;
	} catch {
		return null;
	}
}

/**
 * Detects the browser language and adds appropriate language steps to the blueprint.
 * This includes setting the WordPress site language and adding plugin translation files.
 */
export async function addBrowserLanguageSteps(
	blueprint: any,
	blueprintBaseUrl: string
): Promise<void> {
	const browserLang =
		navigator.language || (navigator.languages && navigator.languages[0]);
	if (!browserLang) {
		return;
	}

	// Try exact match first, then base language
	let wpLocale = browserToWordPressLocale[browserLang];
	if (!wpLocale) {
		const baseLang = browserLang.split('-')[0];
		wpLocale = browserToWordPressLocale[baseLang];
	}

	if (!wpLocale || wpLocale === 'en_US') {
		return;
	}

	if (!blueprint.steps) {
		blueprint.steps = [];
	}

	// Add setSiteLanguage step at the beginning
	blueprint.steps.unshift({
		step: 'setSiteLanguage',
		language: wpLocale,
		corsProxy: corsProxyUrl,
	});

	// Fetch the translations manifest to determine available translations
	const manifest = await fetchTranslationsManifest(blueprintBaseUrl);
	if (!manifest) {
		return;
	}

	// Resolve the locale - check if available directly or via fallback
	let resolvedLocale = wpLocale;
	if (!manifest.available[wpLocale]) {
		if (manifest.fallbacks[wpLocale]) {
			resolvedLocale = manifest.fallbacks[wpLocale];
		} else {
			// No translation available for this locale
			return;
		}
	}

	const translation = manifest.available[resolvedLocale];
	if (!translation) {
		return;
	}

	const pluginsBaseUrl = new URL(
		'../plugins/playground-welcome/',
		blueprintBaseUrl
	).href;

	// Find the activatePlugin step to insert translation files before it
	const activateIndex = blueprint.steps.findIndex(
		(step: any) => step?.step === 'activatePlugin'
	);
	const insertIndex =
		activateIndex > 0 ? activateIndex : blueprint.steps.length;

	const translationSteps = [
		{
			step: 'mkdir',
			path: '/wordpress/wp-content/plugins/playground-welcome/languages',
		},
		{
			step: 'writeFile',
			path: `/wordpress/wp-content/plugins/playground-welcome/languages/playground-welcome-${resolvedLocale}.mo`,
			data: {
				resource: 'url',
				url: `${pluginsBaseUrl}languages/playground-welcome-${resolvedLocale}.mo`,
			},
		},
	];

	// Add content directory if available
	if (translation.contentDir) {
		translationSteps.push(
			{
				step: 'mkdir',
				path: `/wordpress/wp-content/plugins/playground-welcome/${translation.contentDir}`,
			},
			{
				step: 'writeFile',
				path: `/wordpress/wp-content/plugins/playground-welcome/${translation.contentDir}/welcome-post.html`,
				data: {
					resource: 'url',
					url: `${pluginsBaseUrl}${translation.contentDir}/welcome-post.html`,
				},
			}
		);
	}

	blueprint.steps.splice(insertIndex, 0, ...translationSteps);
}
