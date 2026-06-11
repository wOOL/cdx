import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createLodPreset,
	deleteLodPreset,
	listLodPresets,
	updateLodPreset
} from '$lib/server/segLod';

/**
 * Settings-backed CRUD for segmentation level-of-detail presets:
 *   { id, name, resolution: 'full'|'half', smoothing: 0–3, reduction: 0–0.9,
 *     noise: 0|1, isDefault }
 *
 * GET            → { presets: LodPreset[] }
 * POST   body    { name, resolution?, smoothing?, reduction?, noise?, isDefault? } → { preset }
 * PATCH  body    { id, ...partial fields } → { preset }
 * DELETE body    { id } → { ok: true }
 *
 * Setting isDefault=true on a preset clears the flag on all others.
 */
export const GET: RequestHandler = async () => {
	return json({ presets: listLodPresets() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const preset = createLodPreset(body);
	if (!preset) error(400, 'Invalid preset');
	return json({ preset });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.id !== 'string') error(400, 'Missing preset id');
	const preset = updateLodPreset(body.id, body);
	if (!preset) error(404, 'Preset not found or invalid fields');
	return json({ preset });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.id !== 'string') error(400, 'Missing preset id');
	if (!deleteLodPreset(body.id)) error(404, 'Preset not found');
	return json({ ok: true });
};
