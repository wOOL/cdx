import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { migrate } from './migrations';

export const DATA_DIR = process.env.CDX_DATA_DIR ?? 'data';
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'codiagnostix.db'), { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
migrate(db);

/**
 * File paths are stored RELATIVE to DATA_DIR so the data directory is portable
 * (backup/restore, CDX_DATA_DIR moves). Legacy rows that still carry the old
 * prefix are normalized once at startup below.
 */
export function resolveData(p: string): string {
	if (!p) return p;
	if (isAbsolute(p)) return p; // legacy absolute path
	if (p === DATA_DIR || p.startsWith(`${DATA_DIR}/`)) return p; // legacy prefixed path
	return join(DATA_DIR, p);
}

/** stored (relative) directory for a case's files; ensures it exists on disk */
export function caseRel(caseId: number): string {
	const rel = join('cases', String(caseId));
	mkdirSync(join(DATA_DIR, rel), { recursive: true });
	return rel;
}

/** absolute directory for a case's files (legacy callers) */
export function caseDir(caseId: number): string {
	return join(DATA_DIR, caseRel(caseId));
}

// one-time normalization of legacy prefixed paths → relative
{
	const prefix = `${DATA_DIR}/`;
	for (const [table, cols] of [
		['datasets', ['volume_path', 'preview_path']],
		['models', ['file_path']],
		['images', ['file_path']]
	] as [string, string[]][]) {
		for (const col of cols) {
			db.query(
				`UPDATE ${table} SET ${col} = substr(${col}, ${prefix.length + 1})
				 WHERE ${col} LIKE ?1`
			).run(`${prefix}%`);
		}
	}
}
