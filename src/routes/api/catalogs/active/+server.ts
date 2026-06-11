import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { activeLines } from '$lib/server/catalogs';

/**
 * Merged custom lines from all active catalog versions, each marked
 * `custom: true` (and `outdated: true` when the version is flagged).
 * Clients merge them into the built-in library via mergeCatalog(lines).
 */
export const GET: RequestHandler = () => json({ lines: activeLines() });
