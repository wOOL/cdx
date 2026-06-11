import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db, resolveData } from './db';
import { listImplants, listMeasurements, listNerves } from './db/repo';
import type { Plan } from '$lib/types';

// ---------- types ----------

export type ContactKind = 'clinician' | 'lab';

export interface Contact {
	id: number;
	code: string;
	name: string;
	email: string;
	kind: ContactKind;
	created_at: string;
}

export type TransferDirection = 'out' | 'in';
export type TransferState = 'uploaded' | 'downloaded' | 'imported' | 'finished' | 'rejected';

export interface Transfer {
	id: number;
	number: string;
	plan_id: number | null;
	contact_id: number | null;
	direction: TransferDirection;
	state: TransferState;
	service: string;
	comment: string;
	payload_path: string;
	unread: number;
	created_at: string;
	updated_at: string;
}

export interface TransferWithContact extends Transfer {
	contact_name: string;
}

export const TRANSFER_STATES: TransferState[] = [
	'uploaded',
	'downloaded',
	'imported',
	'finished',
	'rejected'
];

export const SERVICE_TYPES = [
	'Digital surgical guide',
	'Custom',
	'Bone block design',
	'Radiographic assessment'
];

// ---------- contacts ----------

/** 7-digit pairing code, unique among contacts. */
export function generatePairingCode(): string {
	for (;;) {
		const code = String(1000000 + Math.floor(Math.random() * 9000000));
		const taken = db.query('SELECT 1 FROM contacts WHERE code = ?1').get(code);
		if (!taken) return code;
	}
}

export function listContacts(): Contact[] {
	return db.query('SELECT * FROM contacts ORDER BY kind, name').all() as Contact[];
}

export function getContact(id: number): Contact | null {
	return (db.query('SELECT * FROM contacts WHERE id = ?1').get(id) as Contact) ?? null;
}

export function getContactByCode(code: string): Contact | null {
	return (db.query('SELECT * FROM contacts WHERE code = ?1').get(code) as Contact) ?? null;
}

export function createContact(c: { name: string; email?: string; kind?: string; code?: string }): Contact {
	const kind: ContactKind = c.kind === 'lab' ? 'lab' : 'clinician';
	return db
		.query(
			`INSERT INTO contacts (code, name, email, kind) VALUES (?1, ?2, ?3, ?4) RETURNING *`
		)
		.get(c.code ?? generatePairingCode(), c.name, c.email ?? '', kind) as Contact;
}

export function deleteContact(id: number): void {
	// transfers keep their rows (contact_id is set NULL by the FK) — history stays, name disappears
	db.query('DELETE FROM contacts WHERE id = ?1').run(id);
}

// ---------- transfer payloads ----------

/** Same payload as /api/plans/[id]/export — the 'cdx-web-plan' v1 single-plan archive. */
export function buildPlanPayload(plan: Plan): Record<string, unknown> {
	return {
		version: 1,
		kind: 'cdx-web-plan',
		exported_at: new Date().toISOString(),
		plan: {
			name: plan.name,
			jaw: plan.jaw,
			pan_curve: plan.pan_curve,
			settings: plan.settings,
			approved: plan.approved
		},
		implants: listImplants(plan.id),
		nerves: listNerves(plan.id),
		measurements: listMeasurements(plan.id)
	};
}

/** Writes a payload under data/transfers/ and returns the stored RELATIVE path. */
export function writeTransferPayload(payload: Record<string, unknown>): string {
	const rel = join('transfers', `transfer_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}.json`);
	const abs = resolveData(rel);
	mkdirSync(resolveData('transfers'), { recursive: true });
	Bun.write(abs, JSON.stringify(payload, null, 1));
	return rel;
}

// ---------- transfers ----------

/** 6 random digits, unique for both the 'T-' (out) and 'R-' (in) mirrored numbers. */
export function uniqueTransferDigits(): string {
	for (;;) {
		const digits = String(100000 + Math.floor(Math.random() * 900000));
		const taken = db
			.query('SELECT 1 FROM transfers WHERE number IN (?1, ?2)')
			.get(`T-${digits}`, `R-${digits}`);
		if (!taken) return digits;
	}
}

export function createTransfer(t: {
	number: string;
	plan_id?: number | null;
	contact_id: number;
	direction: TransferDirection;
	state?: TransferState;
	service?: string;
	comment?: string;
	payload_path?: string;
	unread?: number;
}): Transfer {
	return db
		.query(
			`INSERT INTO transfers (number, plan_id, contact_id, direction, state, service, comment, payload_path, unread)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *`
		)
		.get(
			t.number,
			t.plan_id ?? null,
			t.contact_id,
			t.direction,
			t.state ?? 'uploaded',
			t.service ?? '',
			t.comment ?? '',
			t.payload_path ?? '',
			t.unread ?? 0
		) as Transfer;
}

export function getTransfer(id: number): Transfer | null {
	return (db.query('SELECT * FROM transfers WHERE id = ?1').get(id) as Transfer) ?? null;
}

export function listTransfers(
	filter: { direction?: string; state?: string; q?: string } = {}
): TransferWithContact[] {
	const where: string[] = [];
	const args: string[] = [];
	if (filter.direction === 'in' || filter.direction === 'out') {
		args.push(filter.direction);
		where.push(`t.direction = ?${args.length}`);
	}
	if (filter.state && TRANSFER_STATES.includes(filter.state as TransferState)) {
		args.push(filter.state);
		where.push(`t.state = ?${args.length}`);
	}
	if (filter.q?.trim()) {
		args.push(`%${filter.q.trim()}%`);
		const n = args.length;
		where.push(`(t.number LIKE ?${n} OR t.comment LIKE ?${n} OR COALESCE(c.name, '') LIKE ?${n})`);
	}
	return db
		.query(
			`SELECT t.*, COALESCE(c.name, '') AS contact_name
			 FROM transfers t LEFT JOIN contacts c ON c.id = t.contact_id
			 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
			 ORDER BY t.created_at DESC, t.id DESC`
		)
		.all(...args) as TransferWithContact[];
}

/** Removes a transfer's payload file unless another transfer still references it. */
export function unlinkPayloadIfOrphan(payloadPath: string): void {
	if (!payloadPath) return;
	const ref = db
		.query('SELECT COUNT(*) AS c FROM transfers WHERE payload_path = ?1')
		.get(payloadPath) as { c: number };
	if (ref.c > 0) return;
	try {
		unlinkSync(resolveData(payloadPath));
	} catch {
		// already gone
	}
}
