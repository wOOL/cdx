import { db } from './db';
import { setSetting } from './db/repo';

/**
 * Teams & per-patient access (SPEC §13.2) — model layer.
 *
 * No new tables: teams live in the settings table under the 'teams' key,
 * per-patient access lists under 'patient_acl'. Server-wide enforcement is
 * wired separately; this module owns the data model and resolveAccess().
 */

// ---------- types ----------

export type TeamRole = 'owner' | 'editor' | 'reader';

export const TEAM_ROLES: TeamRole[] = ['owner', 'editor', 'reader'];

export interface TeamMember {
	userId: number;
	role: TeamRole;
}

export interface Team {
	id: number;
	name: string;
	members: TeamMember[];
}

export type AccessLevel = 'none' | 'read' | 'modify' | 'delete';

/** Override levels assignable per user in a patient ACL entry. */
export const OVERRIDE_LEVELS: AccessLevel[] = ['read', 'modify', 'delete'];

export interface AclEntry {
	teamId: number;
	overrides?: Record<string, AccessLevel>;
}

/** patientId (as string key) → ACL entry */
export type PatientAcl = Record<string, AclEntry>;

const TEAMS_KEY = 'teams';
const ACL_KEY = 'patient_acl';

// ---------- storage ----------

function readJson<T>(key: string, fallback: T): T {
	const row = db.query('SELECT value FROM settings WHERE key = ?1').get(key) as {
		value: string;
	} | null;
	if (!row?.value) return fallback;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

export function getTeams(): Team[] {
	const raw = readJson<unknown>(TEAMS_KEY, []);
	if (!Array.isArray(raw)) return [];
	return raw as Team[];
}

export function saveTeams(teams: Team[]): void {
	setSetting(TEAMS_KEY, JSON.stringify(teams));
}

export function getAcl(): PatientAcl {
	const raw = readJson<unknown>(ACL_KEY, {});
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	return raw as PatientAcl;
}

export function saveAcl(acl: PatientAcl): void {
	setSetting(ACL_KEY, JSON.stringify(acl));
}

export function getTeam(id: number): Team | null {
	return getTeams().find((t) => t.id === id) ?? null;
}

export function nextTeamId(teams: Team[]): number {
	return teams.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

/** Number of members holding the 'owner' role. */
export function ownerCount(team: Team): number {
	return team.members.filter((m) => m.role === 'owner').length;
}

// ---------- access resolution ----------

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, modify: 2, delete: 3 };

const ROLE_ACCESS: Record<TeamRole, AccessLevel> = {
	owner: 'delete',
	editor: 'modify',
	reader: 'read'
};

/**
 * Resolves the effective access a user has on a patient.
 *
 * Policy (most restrictive wins):
 * - No ACL entry for the patient → 'delete' (full access — the single-practice
 *   default where permissions are not in use; same applies when the entry
 *   points at a team that no longer exists).
 * - Entry present → the user's team role is mapped to a base level:
 *   owner → 'delete', editor → 'modify', reader → 'read'.
 * - Non-members of the assigned team get a 'read' base level (the patient is
 *   visible but read-only).
 * - A per-user override in the entry combines with the base level and the
 *   MOST RESTRICTIVE of the two wins — overrides can narrow a role (an editor
 *   overridden to 'read' reads only) but never widen it (a reader overridden
 *   to 'delete' still only reads).
 */
export function resolveAccess(userId: number, patientId: number): AccessLevel {
	const entry = getAcl()[String(patientId)];
	if (!entry) return 'delete';
	const team = getTeam(Number(entry.teamId));
	if (!team) return 'delete';

	const member = team.members.find((m) => Number(m.userId) === userId);
	const base: AccessLevel = member ? (ROLE_ACCESS[member.role] ?? 'read') : 'read';

	const override = entry.overrides?.[String(userId)];
	if (override && override in RANK) {
		return RANK[override] < RANK[base] ? override : base;
	}
	return base;
}
