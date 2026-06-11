import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAiSegState, startAiSegmentation } from '$lib/server/aiSeg';
import { getDataset } from '$lib/server/db/repo';

/**
 * AI segmentation (see $lib/server/aiSeg.ts). Backend is chosen by env: the
 * real vendor model when CDX_AISEG_* creds are set, otherwise the offline
 * heuristic. The async-job + {status, models} contract is identical either way
 * (the vendor path additionally streams the volume to an external service,
 * which is why this is an explicit, audited user action).
 *
 * POST → { jobId } immediately; the job runs async in-process. Posting while
 * a job for this dataset is still running returns the running job's id.
 *
 * GET → { status: 'idle'|'running'|'done'|'error', jobId?, backend?, models?, error? }
 * where models = [{ id, name, class, color, triangles, ok }] — entries with
 * 0 triangles have ok:false (review dialog renders them unselectable). The
 * case page deletes unimported model rows after review.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	return json(startAiSegmentation(ds, locals.user));
};

export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	return json(getAiSegState(ds.id));
};
