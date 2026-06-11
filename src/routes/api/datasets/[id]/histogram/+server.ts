import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';

const LO = -1000;
const HI = 3000;
const BINS = 128;

/** Volume HU histogram (128 bins over [-1000, 3000]), subsampled for speed. */
export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const vol = await loadVolume(ds);

	const bins = new Array(BINS).fill(0);
	const stride = Math.max(1, Math.floor(vol.length / 2_000_000));
	const scale = BINS / (HI - LO);
	for (let i = 0; i < vol.length; i += stride) {
		let b = ((vol[i] - LO) * scale) | 0;
		if (b < 0) b = 0;
		else if (b >= BINS) b = BINS - 1;
		bins[b]++;
	}
	return json({ lo: LO, hi: HI, bins });
};
