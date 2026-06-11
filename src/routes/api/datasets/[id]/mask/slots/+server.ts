import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import {
	countMaskRange,
	listSlotNames,
	loadMask,
	loadSlotRoles,
	normalizeSlot,
	setSlotRole,
	type SlotRole
} from '$lib/server/segMask';
import type { Dataset } from '$lib/types';

async function slotList(
	ds: Dataset
): Promise<{ name: string; voxels: number; role: SlotRole }[]> {
	const roles = await loadSlotRoles(ds);
	const out: { name: string; voxels: number; role: SlotRole }[] = [];
	for (const name of await listSlotNames(ds)) {
		const mask = await loadMask(ds, name);
		out.push({ name, voxels: countMaskRange(mask), role: roles[name] ?? 'none' });
	}
	return out;
}

/** GET → { slots: [{ name, voxels, role }] } — every known mask slot. */
export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	return json({ slots: await slotList(ds) });
};

/**
 * PATCH body: { name, role: 'target'|'source'|'exclude'|'none' } → set a
 * slot's role. Only one slot can be 'source'; assigning it demotes the
 * previous source slot to 'none'. Response: { slots } (updated list).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const name = normalizeSlot(typeof body?.name === 'string' ? body.name : null);
	if (!name || typeof body?.name !== 'string') error(400, 'Invalid slot name');
	const role = body?.role;
	if (role !== 'target' && role !== 'source' && role !== 'exclude' && role !== 'none') {
		error(400, 'Invalid role');
	}

	await setSlotRole(ds, name, role);
	return json({ slots: await slotList(ds) });
};
