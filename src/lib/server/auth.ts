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
		token,
		userId,
		expires.toISOString()
	);
	return { token, expires };
}

export function getSessionUser(token: string | undefined): User | null {
	if (!token) return null;
	const row = db
		.query(
			`SELECT u.id, u.email, u.name, u.work_mode, u.created_at, s.expires_at
			 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1`
		)
		.get(token) as (User & { expires_at: string }) | null;
	if (!row) return null;
	if (new Date(row.expires_at).getTime() < Date.now()) {
		db.query('DELETE FROM sessions WHERE token = ?1').run(token);
		return null;
	}
	const { expires_at: _discard, ...user } = row;
	return user as User;
}

export function deleteSession(token: string | undefined): void {
	if (token) db.query('DELETE FROM sessions WHERE token = ?1').run(token);
}

export function setWorkMode(userId: number, mode: 'expert' | 'easy'): void {
	db.query('UPDATE users SET work_mode = ?2 WHERE id = ?1').run(userId, mode);
}
