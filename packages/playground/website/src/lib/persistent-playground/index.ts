import type { BlueprintV1 } from '@wp-playground/client';
import {
	type ResolvedBlueprint,
	resolveBlueprintFromURL,
} from '../state/url/resolve-blueprint-from-url';
import { addBrowserLanguageSteps } from './i18n';
import { logger } from '@php-wasm/logger';

export { addBrowserLanguageSteps };

/**
 * Checks if this URL should use the persistent blueprint path.
 */
export function shouldUsePersistentBlueprint(
	url: URL,
	defaultBlueprintUrl?: string
): boolean {
	const query = url.searchParams;
	const fragment = (url.hash || '#').substring(1);

	return (
		window.self === window.top &&
		!query.size &&
		!fragment.length &&
		!!defaultBlueprintUrl?.startsWith('/')
	);
}

/**
 * Check if the URL contains actionable parameters that should be applied
 * as a blueprint to an existing persistent site.
 */
function hasActionableUrlParams(url: URL): boolean {
	const query = url.searchParams;
	return !!(
		query.has('plugin') ||
		query.has('theme') ||
		query.has('blueprint-url') ||
		query.has('import-site') ||
		query.has('import-wxr') ||
		query.has('import-content') ||
		query.has('gutenberg-pr') ||
		query.has('gutenberg-branch') ||
		query.has('core-pr')
	);
}

/**
 * Resolves URL params as a blueprint to apply to an existing persistent site.
 * Returns null if there are no actionable URL params.
 */
export async function resolveUrlParamsForExistingSite(
	url: URL
): Promise<BlueprintV1 | null> {
	if (!hasActionableUrlParams(url)) {
		return null;
	}

	try {
		const resolved = await resolveBlueprintFromURL(url, undefined);
		return resolved.blueprint;
	} catch (e) {
		logger.error('Error resolving URL blueprint for existing site:', e);
		return null;
	}
}

/**
 * Loads the persistent blueprint.
 * - Fetches the blueprint JSON
 * - Resolves relative URLs
 * - Adds browser language detection steps
 */
export async function loadPersistentBlueprint(
	blueprintUrl: string
): Promise<ResolvedBlueprint> {
	const response = await fetch(blueprintUrl);
	const blueprint = await response.json();

	const absoluteUrl = new URL(blueprintUrl, window.location.origin).href;
	resolveRelativeUrls(blueprint, absoluteUrl);
	await addBrowserLanguageSteps(blueprint, absoluteUrl);

	return {
		blueprint,
		source: {
			type: 'persistent-blueprint',
			url: blueprintUrl,
		},
	};
}

/**
 * Recursively resolves relative URLs in a blueprint object.
 * Finds all { resource: "url", url: "./..." } and converts to absolute URLs.
 */
function resolveRelativeUrls(obj: any, baseUrl: string): void {
	if (!obj || typeof obj !== 'object') {
		return;
	}

	if (Array.isArray(obj)) {
		for (const item of obj) {
			resolveRelativeUrls(item, baseUrl);
		}
		return;
	}

	if (
		obj.resource === 'url' &&
		typeof obj.url === 'string' &&
		(obj.url.startsWith('./') || obj.url.startsWith('../'))
	) {
		obj.url = new URL(obj.url, baseUrl).href;
	}

	for (const key of Object.keys(obj)) {
		resolveRelativeUrls(obj[key], baseUrl);
	}
}
