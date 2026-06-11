import { db } from './db';

export interface User {
	id: number;
	email: string;
	name: string;
	work_mode: 'expert' | 'easy';
	tier: 'pro' | 'viewer';
	credits: number;
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
				 RETURNING id, email, name, work_mode, tier, credits, created_at`
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
	const { password_hash: _discard, totp_secret: _discard2, ...user } = row as User & {
		password_hash: string;
		totp_secret: string;
	};
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
			`SELECT u.id, u.email, u.name, u.work_mode, u.tier, u.credits, u.created_at, s.expires_at
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

// ---- tiers & export credits ----

export function setTier(userId: number, tier: 'pro' | 'viewer'): void {
	db.query('UPDATE users SET tier = ?2 WHERE id = ?1').run(userId, tier);
}

/** Atomically spend one export credit. Returns the remaining balance, or null when none left. */
export function spendCredit(userId: number): number | null {
	const row = db
		.query('UPDATE users SET credits = credits - 1 WHERE id = ?1 AND credits > 0 RETURNING credits')
		.get(userId) as { credits: number } | null;
	return row ? row.credits : null;
}

export function addCredits(userId: number, amount: number): number {
	const row = db
		.query('UPDATE users SET credits = credits + ?2 WHERE id = ?1 RETURNING credits')
		.get(userId, amount) as { credits: number } | null;
	return row?.credits ?? 0;
}

// ---- profile ----

export function updateName(userId: number, name: string): void {
	db.query('UPDATE users SET name = ?2 WHERE id = ?1').run(userId, name.trim());
}

export async function verifyPassword(userId: number, password: string): Promise<boolean> {
	const row = db.query('SELECT password_hash FROM users WHERE id = ?1').get(userId) as {
		password_hash: string;
	} | null;
	if (!row) return false;
	return Bun.password.verify(password, row.password_hash).catch(() => false);
}

export async function changePassword(userId: number, newPassword: string): Promise<void> {
	const hash = await Bun.password.hash(newPassword);
	db.query('UPDATE users SET password_hash = ?2 WHERE id = ?1').run(userId, hash);
}

// ---- TOTP ----

export function getTotpSecret(userId: number): string {
	const row = db.query('SELECT totp_secret FROM users WHERE id = ?1').get(userId) as {
		totp_secret: string;
	} | null;
	return row?.totp_secret ?? '';
}

export function setTotpSecret(userId: number, secret: string): void {
	db.query('UPDATE users SET totp_secret = ?2 WHERE id = ?1').run(userId, secret);
}

// ---- pending MFA logins (password OK, waiting for a TOTP code) ----

const MFA_PENDING_TTL_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;
const mfaPending = new Map<string, { userId: number; expires: number; attempts: number }>();

/** Stash a half-finished login; the returned token must come back with a valid TOTP code. */
export function createMfaPending(userId: number): string {
	// opportunistic sweep so abandoned logins don't pile up
	for (const [t, p] of mfaPending) if (Date.now() > p.expires) mfaPending.delete(t);
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
	mfaPending.set(token, { userId, expires: Date.now() + MFA_PENDING_TTL_MS, attempts: 0 });
	return token;
}

/** Returns the pending user id, or null when the token is unknown/expired/exhausted. */
export function peekMfaPending(token: string): number | null {
	const p = mfaPending.get(token);
	if (!p) return null;
	if (Date.now() > p.expires) {
		mfaPending.delete(token);
		return null;
	}
	return p.userId;
}

/** Count a wrong code; after too many the pending login is voided. */
export function recordMfaFailure(token: string): void {
	const p = mfaPending.get(token);
	if (!p) return;
	p.attempts += 1;
	if (p.attempts >= MFA_MAX_ATTEMPTS) mfaPending.delete(token);
}

export function consumeMfaPending(token: string): void {
	mfaPending.delete(token);
}
