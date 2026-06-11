import { db } from './db';

export interface User {
	id: number;
	email: string;
	name: string;
	work_mode: 'expert' | 'easy';
	created_at: string;
}

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'cdx_session';

/** tokens are stored hashed — a leaked DB/backup cannot be replayed as a session */
function hashToken(token: string): string {
	return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

// ---- login rate limiting (in-memory, per email+IP) ----
const loginFailures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60_000;

export function loginBlocked(key: string): boolean {
	const f = loginFailures.get(key);
	if (!f) return false;
	if (f.until && Date.now() < f.until) return true;
	if (f.until && Date.now() >= f.until) loginFailures.delete(key);
	return false;
}

export function recordLoginFailure(key: string): void {
	const f = loginFailures.get(key) ?? { count: 0, until: 0 };
	f.count += 1;
	if (f.count >= MAX_FAILURES) f.until = Date.now() + LOCKOUT_MS;
	loginFailures.set(key, f);
}

export function clearLoginFailures(key: string): void {
	loginFailures.delete(key);
}

export function userCount(): number {
	const row = db.query('SELECT COUNT(*) AS n FROM users').get() as { n: number };
	return row.n;
}

export async function createUser(email: string, password: string, name: string): Promise<User | null> {
	const hash = await Bun.password.hash(password);
	try {
		return db
			.query(
				`INSERT INTO users (email, password_hash, name) VALUES (?1, ?2, ?3)
				 RETURNING id, email, name, work_mode, created_at`
			)
			.get(email.trim().toLowerCase(), hash, name.trim()) as User;
	} catch {
		return null; // duplicate email
	}
}

export async function verifyUser(email: string, password: string): Promise<User | null> {
	const row = db
		.query('SELECT * FROM users WHERE email = ?1')
		.get(email.trim().toLowerCase()) as (User & { password_hash: string }) | null;
	if (!row) return null;
	const ok = await Bun.password.verify(password, row.password_hash).catch(() => false);
	if (!ok) return null;
	const { password_hash: _discard, ...user } = row;
	return user as User;
}

export function createSession(userId: number): { token: string; expires: Date } {
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
	const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
	db.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)`).run(
		hashToken(token),
		userId,
		expires.toISOString()
	);
	return { token, expires };
}

export function getSessionUser(token: string | undefined): User | null {
	if (!token) return null;
	const hashed = hashToken(token);
	const row = db
		.query(
			`SELECT u.id, u.email, u.name, u.work_mode, u.created_at, s.expires_at
			 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1`
		)
		.get(hashed) as (User & { expires_at: string }) | null;
	if (!row) return null;
	if (new Date(row.expires_at).getTime() < Date.now()) {
		db.query('DELETE FROM sessions WHERE token = ?1').run(hashed);
		return null;
	}
	const { expires_at: _discard, ...user } = row;
	return user as User;
}

export function deleteSession(token: string | undefined): void {
	if (token) db.query('DELETE FROM sessions WHERE token = ?1').run(hashToken(token));
}

export function setWorkMode(userId: number, mode: 'expert' | 'easy'): void {
	db.query('UPDATE users SET work_mode = ?2 WHERE id = ?1').run(userId, mode);
}
