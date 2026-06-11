import { error } from '@sveltejs/kit';
import { unzipSync } from 'fflate';

export const LIMITS = {
	/** DICOM zip / file set (raw CBCT can be a few hundred MB) */
	dicom: 900 * 1024 * 1024,
	/** surface scans */
	model: 150 * 1024 * 1024,
	/** snapshots / logo */
	image: 15 * 1024 * 1024,
	/** case archives (volume + meshes) */
	archive: 1200 * 1024 * 1024,
	/** plan JSON */
	plan: 10 * 1024 * 1024
} as const;

export function assertSize(files: { size: number }[] | { size: number }, limit: number): void {
	const total = Array.isArray(files) ? files.reduce((a, f) => a + f.size, 0) : files.size;
	if (total > limit) {
		error(413, `Upload too large (${Math.round(total / 1e6)} MB > ${Math.round(limit / 1e6)} MB limit)`);
	}
}

const MAX_UNZIPPED = 2.5 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 4096;

/** unzip with expansion caps — guards against zip bombs */
export function unzipGuarded(bytes: Uint8Array): Record<string, Uint8Array> {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes);
	} catch {
		error(400, 'Could not read zip archive');
	}
	const names = Object.keys(entries);
	if (names.length > MAX_ENTRIES) error(413, `Archive has too many entries (${names.length})`);
	let total = 0;
	for (const name of names) {
		total += entries[name].length;
		if (total > MAX_UNZIPPED) error(413, 'Archive expands beyond the allowed size');
	}
	return entries;
}
