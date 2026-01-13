// @ts-ignore
import { corsProxyUrl } from 'virtual:cors-proxy-url';
import type { StepDefinition } from '@wp-playground/client';

/**
 * Converts a browser language code to a WordPress locale code.
 * Examples: 'pl' -> 'pl_PL', 'de-AT' -> 'de_AT', 'en-US' -> 'en_US'
 */
function browserLangToWpLocale(browserLang: string): string {
	const parts = browserLang.split('-');
	const lang = parts[0].toLowerCase();
	const country = parts[1]?.toUpperCase() || lang.toUpperCase();
	return `${lang}_${country}`;
}

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

	const wpLocale = browserLangToWpLocale(browserLang);
	if (wpLocale === 'en_US') {
		return;
	}

	if (!blueprint.steps) {
		blueprint.steps = [];
	}

	blueprint.steps.unshift({
		step: 'setSiteLanguage',
		language: wpLocale,
		corsProxy: corsProxyUrl,
	});

	const manifest = await fetchTranslationsManifest(blueprintBaseUrl);
	if (!manifest) {
		return;
	}

	let resolvedLocale = wpLocale;
	if (!manifest.available[wpLocale]) {
		if (manifest.fallbacks[wpLocale]) {
			resolvedLocale = manifest.fallbacks[wpLocale];
		} else {
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

	const translationSteps: StepDefinition[] = [
		{
			step: 'mkdir',
			path: '/wordpress/wp-content/plugins/playground-welcome/languages',
		},
		{
			step: 'writeFile',
			path: `/wordpress/wp-content/plugins/playground-welcome/languages/playground-welcome-${wpLocale}.mo`,
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
			},
			{
				step: 'writeFile',
				path: `/wordpress/wp-content/plugins/playground-welcome/${translation.contentDir}/vision-page.html`,
				data: {
					resource: 'url',
					url: `${pluginsBaseUrl}${translation.contentDir}/vision-page.html`,
				},
			}
		);
	}

	blueprint.steps.splice(insertIndex, 0, ...translationSteps);
}
