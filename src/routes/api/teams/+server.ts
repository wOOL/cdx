import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { getTeams, nextTeamId, saveTeams, type Team } from '$lib/server/teams';

function listUsers(): { id: number; email: string; name: string }[] {
	return db.query('SELECT id, email, name FROM users ORDER BY id').all() as {
		id: number;
		email: string;
		name: string;
	}[];
}

/** Teams plus a compact user list for member pickers. */
export const GET: RequestHandler = async () => {
	return json({ teams: getTeams(), users: listUsers() });
};

/** Body: { name } — creates a team; the calling user becomes its owner. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const name = String(body.name ?? '').trim();
	if (!name) error(400, 'Team name is required');
	if (!locals.user) error(401, 'Not authenticated');

	const teams = getTeams();
	const team: Team = {
		id: nextTeamId(teams),
		name,
		members: [{ userId: locals.user.id, role: 'owner' }]
	};
	teams.push(team);
	saveTeams(teams);
	logAudit(locals.user, 'team.create', `team:${team.id}`, name);
	return json({ team });
};
