import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from './migrations';

export const DATA_DIR = process.env.CDX_DATA_DIR ?? 'data';
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'codiagnostix.db'), { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
migrate(db);

export function caseDir(caseId: number): string {
	const dir = join(DATA_DIR, 'cases', String(caseId));
	mkdirSync(dir, { recursive: true });
	return dir;
}
