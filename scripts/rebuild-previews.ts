/**
 * Regenerate the 3D-render preview volumes (vol_*_preview.u8) for all
 * datasets from their stored int16 HU volumes, using the current
 * buildPreview (box-averaged since the CBCT speckle fix).
 *   bun run scripts/rebuild-previews.ts
 */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { buildPreview } from '../src/lib/server/dicom/import';

const DATA = join(import.meta.dir, '..', 'data');
const db = new Database(join(DATA, 'codiagnostix.db'));

const rows = db
	.query(
		`SELECT id, case_id, cols, rows, slices, volume_path, preview_path,
		        preview_cols, preview_rows, preview_slices
		 FROM datasets WHERE volume_path != '' AND preview_path != ''`
	)
	.all() as {
	id: number;
	case_id: number;
	cols: number;
	rows: number;
	slices: number;
	volume_path: string;
	preview_path: string;
	preview_cols: number;
	preview_rows: number;
	preview_slices: number;
}[];

let done = 0;
for (const d of rows) {
	const volFile = Bun.file(join(DATA, d.volume_path));
	if (!(await volFile.exists())) {
		console.log(`dataset ${d.id}: volume file missing, skipped`);
		continue;
	}
	const buf = await volFile.arrayBuffer();
	if (buf.byteLength !== d.cols * d.rows * d.slices * 2) {
		console.log(`dataset ${d.id}: size mismatch (${buf.byteLength} bytes), skipped`);
		continue;
	}
	const volume = new Int16Array(buf);
	const preview = buildPreview({
		volume,
		cols: d.cols,
		rows: d.rows,
		slices: d.slices
	} as Parameters<typeof buildPreview>[0]);
	if (
		preview.cols !== d.preview_cols ||
		preview.rows !== d.preview_rows ||
		preview.slices !== d.preview_slices
	) {
		// dims derive only from volume dims, so this indicates a logic change — update the row
		db.query(
			`UPDATE datasets SET preview_cols=?2, preview_rows=?3, preview_slices=?4 WHERE id=?1`
		).run(d.id, preview.cols, preview.rows, preview.slices);
		console.log(`dataset ${d.id}: preview dims changed to ${preview.cols}×${preview.rows}×${preview.slices}`);
	}
	await Bun.write(join(DATA, d.preview_path), preview.data);
	done++;
	console.log(`dataset ${d.id} (case ${d.case_id}): preview rebuilt (${preview.cols}×${preview.rows}×${preview.slices})`);
}
console.log(`done: ${done}/${rows.length} previews rebuilt`);
