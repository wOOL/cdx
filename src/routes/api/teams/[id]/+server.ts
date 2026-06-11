import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import {
	TEAM_ROLES,
	getAcl,
	getTeams,
	ownerCount,
	saveAcl,
	saveTeams,
	type Team,
	type TeamRole
} from '$lib/server/teams';

function findTeam(teams: Team[], id: string | undefined): Team {
	const team = teams.find((t) => t.id === Number(id));
	if (!team) error(404, 'Team not found');
	return team;
}

function validRole(role: unknown): TeamRole {
	if (!TEAM_ROLES.includes(role as TeamRole)) error(400, 'Unknown role');
	return role as TeamRole;
}

/**
 * Body: { name?, addMember?: {userId, role}, removeMember?: userId,
 *         setRole?: {userId, role} } — partial team update.
 * The last owner can neither be removed nor demoted (409).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const teams = getTeams();
	const team = findTeam(teams, params.id);
	const body = await request.json().catch(() => ({}));
	const changes: string[] = [];

	if (body.name !== undefined) {
		const name = String(body.name).trim();
		if (!name) error(400, 'Team name is required');
		team.name = name;
		changes.push(`renamed to ${name}`);
	}

	if (body.addMember !== undefined) {
		const userId = Number(body.addMember?.userId);
		const role = validRole(body.addMember?.role);
		const user = db.query('SELECT id FROM users WHERE id = ?1').get(userId);
		if (!user) error(404, 'User not found');
		if (team.members.some((m) => Number(m.userId) === userId)) {
			error(409, 'User is already a member of this team');
		}
		team.members.push({ userId, role });
		changes.push(`added user:${userId} as ${role}`);
	}

	if (body.removeMember !== undefined) {
		const userId = Number(body.removeMember);
		const member = team.members.find((m) => Number(m.userId) === userId);
		if (!member) error(404, 'User is not a member of this team');
		if (member.role === 'owner' && ownerCount(team) <= 1) {
			error(409, 'Cannot remove the last owner of a team');
		}
		team.members = team.members.filter((m) => Number(m.userId) !== userId);
		changes.push(`removed user:${userId}`);
	}

	if (body.setRole !== undefined) {
		const userId = Number(body.setRole?.userId);
		const role = validRole(body.setRole?.role);
		const member = team.members.find((m) => Number(m.userId) === userId);
		if (!member) error(404, 'User is not a member of this team');
		if (member.role === 'owner' && role !== 'owner' && ownerCount(team) <= 1) {
			error(409, 'Cannot demote the last owner of a team');
		}
		member.role = role;
		changes.push(`user:${userId} → ${role}`);
	}

	saveTeams(teams);
	if (changes.length) logAudit(locals.user, 'team.update', `team:${team.id}`, changes.join('; '));
	return json({ team });
};

/** Deletes a team and clears every patient-ACL entry that referenced it. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const teams = getTeams();
	const team = findTeam(teams, params.id);

	saveTeams(teams.filter((t) => t.id !== team.id));

	const acl = getAcl();
	let cleared = 0;
	for (const [patientId, entry] of Object.entries(acl)) {
		if (Number(entry.teamId) === team.id) {
			delete acl[patientId];
			cleared++;
		}
	}
	if (cleared) saveAcl(acl);

	logAudit(locals.user, 'team.delete', `team:${team.id}`, `${team.name}; ${cleared} ACL entries cleared`);
	return json({ ok: true, clearedAclEntries: cleared });
};
