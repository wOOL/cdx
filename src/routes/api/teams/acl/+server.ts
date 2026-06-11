import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import {
	OVERRIDE_LEVELS,
	getAcl,
	getTeam,
	saveAcl,
	type AccessLevel,
	type AclEntry
} from '$lib/server/teams';

/** Full patient access list: { [patientId]: { teamId, overrides? } }. */
export const GET: RequestHandler = async () => {
	return json({ acl: getAcl() });
};

/**
 * Body: { patientId, teamId|null, overrides?: { [userId]: 'read'|'modify'|'delete' } }
 * — assigns a team (with optional per-user overrides) to a patient, or clears
 * the entry when teamId is null (back to the full-access default).
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const patientId = Number(body.patientId);
	const patient = db.query('SELECT id FROM patients WHERE id = ?1').get(patientId);
	if (!patient) error(404, 'Patient not found');

	const acl = getAcl();

	if (body.teamId === null) {
		delete acl[String(patientId)];
		saveAcl(acl);
		logAudit(locals.user, 'team.acl', `patient:${patientId}`, 'access list cleared');
		return json({ acl });
	}

	const teamId = Number(body.teamId);
	if (!getTeam(teamId)) error(404, 'Team not found');

	const entry: AclEntry = { teamId };
	if (body.overrides !== undefined) {
		if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
			error(400, 'overrides must be an object of userId → level');
		}
		const overrides: Record<string, AccessLevel> = {};
		for (const [userId, level] of Object.entries(body.overrides as Record<string, unknown>)) {
			if (!Number.isInteger(Number(userId))) error(400, `Invalid user id: ${userId}`);
			if (!OVERRIDE_LEVELS.includes(level as AccessLevel)) {
				error(400, `Invalid override level: ${String(level)}`);
			}
			overrides[String(Number(userId))] = level as AccessLevel;
		}
		if (Object.keys(overrides).length) entry.overrides = overrides;
	}

	acl[String(patientId)] = entry;
	saveAcl(acl);
	logAudit(
		locals.user,
		'team.acl',
		`patient:${patientId}`,
		`team:${teamId}${entry.overrides ? `; ${Object.keys(entry.overrides).length} override(s)` : ''}`
	);
	return json({ acl });
};
