/**
 * Uploaded implant-catalog versions. The `catalogs` table (migration 14) stores
 * one row per uploaded version; the line data itself lives as a JSON file under
 * DATA_DIR/catalogs and the row's `data` column holds { file, count, active }.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db, resolveData } from './db';
import type { ImplantLine, LineKind } from '$lib/implantLibrary';

interface CatalogRow {
	id: number;
	kind: string;
	name: string;
	version: string;
	data: string;
	outdated: number;
	created_at: string;
}

export interface CatalogSummary {
	id: number;
	name: string;
	version: string;
	count: number;
	file: string;
	active: boolean;
	outdated: boolean;
	uploaded_at: string;
}

interface CatalogMeta {
	file: string;
	count: number;
	active: boolean;
}

function meta(row: CatalogRow): CatalogMeta {
	try {
		const m = JSON.parse(row.data);
		return {
			file: typeof m.file === 'string' ? m.file : '',
			count: Number.isFinite(m.count) ? Number(m.count) : 0,
			active: m.active !== false
		};
	} catch {
		return { file: '', count: 0, active: false };
	}
}

function summarize(row: CatalogRow): CatalogSummary {
	const m = meta(row);
	return {
		id: row.id,
		name: row.name,
		version: row.version,
		count: m.count,
		file: m.file,
		active: m.active,
		outdated: !!row.outdated,
		uploaded_at: row.created_at
	};
}

export function listCatalogs(): CatalogSummary[] {
	const rows = db
		.query(`SELECT * FROM catalogs WHERE kind = 'implant' ORDER BY id DESC`)
		.all() as CatalogRow[];
	return rows.map(summarize);
}

export function getCatalog(id: number): CatalogSummary | null {
	const row = db
		.query(`SELECT * FROM catalogs WHERE id = ?1 AND kind = 'implant'`)
		.get(id) as CatalogRow | null;
	return row ? summarize(row) : null;
}

const KINDS: LineKind[] = ['implant', 'pin', 'endoDrill'];
const MAX_LINES = 2000;

function numArray(v: unknown): number[] | null {
	if (!Array.isArray(v) || v.length === 0 || v.length > 64) return null;
	const out: number[] = [];
	for (const n of v) {
		const x = Number(n);
		if (!Number.isFinite(x) || x <= 0 || x > 100) return null;
		out.push(x);
	}
	return out;
}

function optStr(v: unknown, max = 500): string | undefined {
	return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

/** Validate an uploaded payload of ImplantLine-shaped records; returns normalized lines or an error. */
export function validateLines(input: unknown): { lines: ImplantLine[] } | { error: string } {
	const arr = Array.isArray(input)
		? input
		: input && typeof input === 'object' && Array.isArray((input as { lines?: unknown }).lines)
			? (input as { lines: unknown[] }).lines
			: null;
	if (!arr) return { error: 'Catalog must be a JSON array of implant lines' };
	if (arr.length === 0) return { error: 'Catalog contains no lines' };
	if (arr.length > MAX_LINES) return { error: `Catalog exceeds ${MAX_LINES} lines` };

	const lines: ImplantLine[] = [];
	for (let i = 0; i < arr.length; i++) {
		const r = arr[i] as Record<string, unknown>;
		if (!r || typeof r !== 'object') return { error: `Line ${i + 1}: not an object` };
		const manufacturer = optStr(r.manufacturer, 80);
		const lineName = optStr(r.line, 120);
		if (!manufacturer) return { error: `Line ${i + 1}: missing manufacturer` };
		if (!lineName) return { error: `Line ${i + 1}: missing line name` };
		const diameters = numArray(r.diameters);
		const lengths = numArray(r.lengths);
		if (!diameters) return { error: `Line ${i + 1}: diameters must be a non-empty number array` };
		if (!lengths) return { error: `Line ${i + 1}: lengths must be a non-empty number array` };
		const taper = r.taper == null ? 0 : Number(r.taper);
		if (!Number.isFinite(taper) || taper < 0 || taper > 1)
			return { error: `Line ${i + 1}: taper must be 0..1` };
		const kind = r.kind == null ? undefined : (r.kind as LineKind);
		if (kind !== undefined && !KINDS.includes(kind))
			return { error: `Line ${i + 1}: kind must be implant | pin | endoDrill` };
		const out: ImplantLine = { manufacturer, line: lineName, diameters, lengths, taper };
		if (kind && kind !== 'implant') out.kind = kind;
		const region = optStr(r.region, 24);
		if (region) out.region = region;
		const techInfo = optStr(r.techInfo);
		if (techInfo) out.techInfo = techInfo;
		const docUrl = optStr(r.docUrl);
		if (docUrl) out.docUrl = docUrl;
		const article = optStr(r.article, 60);
		if (article) out.article = article;
		lines.push(out);
	}
	return { lines };
}

export function createCatalog(name: string, version: string, lines: ImplantLine[]): CatalogSummary {
	mkdirSync(join(DATA_DIR, 'catalogs'), { recursive: true });
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'catalog';
	const rel = join('catalogs', `${Date.now()}-${slug}.json`);
	writeFileSync(join(DATA_DIR, rel), JSON.stringify(lines, null, '\t'));
	const data = JSON.stringify({ file: rel, count: lines.length, active: true });
	const row = db
		.query(
			`INSERT INTO catalogs (kind, name, version, data, outdated) VALUES ('implant', ?1, ?2, ?3, 0)
			 RETURNING *`
		)
		.get(name, version, data) as CatalogRow;
	return summarize(row);
}

export function patchCatalog(
	id: number,
	fields: { active?: boolean; outdated?: boolean }
): CatalogSummary | null {
	const row = db
		.query(`SELECT * FROM catalogs WHERE id = ?1 AND kind = 'implant'`)
		.get(id) as CatalogRow | null;
	if (!row) return null;
	const m = meta(row);
	if (fields.active !== undefined) m.active = fields.active;
	const outdated = fields.outdated !== undefined ? (fields.outdated ? 1 : 0) : row.outdated;
	const updated = db
		.query(`UPDATE catalogs SET data = ?2, outdated = ?3 WHERE id = ?1 RETURNING *`)
		.get(id, JSON.stringify(m), outdated) as CatalogRow;
	return summarize(updated);
}

export function deleteCatalog(id: number): boolean {
	const row = db
		.query(`SELECT * FROM catalogs WHERE id = ?1 AND kind = 'implant'`)
		.get(id) as CatalogRow | null;
	if (!row) return false;
	const m = meta(row);
	if (m.file) {
		try {
			unlinkSync(resolveData(m.file));
		} catch {
			// file already gone — still drop the row
		}
	}
	db.query(`DELETE FROM catalogs WHERE id = ?1`).run(id);
	return true;
}

/** All lines from active catalog versions, marked custom (+ outdated when the version is flagged). */
export function activeLines(): ImplantLine[] {
	const out: ImplantLine[] = [];
	for (const row of db
		.query(`SELECT * FROM catalogs WHERE kind = 'implant' ORDER BY id`)
		.all() as CatalogRow[]) {
		const m = meta(row);
		if (!m.active || !m.file) continue;
		const abs = resolveData(m.file);
		if (!existsSync(abs)) continue;
		try {
			const parsed = validateLines(JSON.parse(readFileSync(abs, 'utf8')));
			if ('error' in parsed) continue;
			for (const l of parsed.lines) {
				out.push(row.outdated ? { ...l, custom: true, outdated: true } : { ...l, custom: true });
			}
		} catch {
			// unreadable file — skip this version
		}
	}
	return out;
}
