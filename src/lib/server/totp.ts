// RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits) — no dependencies.
// Bun.CryptoHasher supports keyed (HMAC) hashing via its second constructor argument;
// verified against the RFC 2104 test vectors.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const DRIFT_STEPS = 1; // accept ±1 step of clock drift

function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

function base32Decode(secret: string): Uint8Array {
	const clean = secret.toUpperCase().replace(/[=\s]/g, '');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const ch of clean) {
		const idx = BASE32_ALPHABET.indexOf(ch);
		if (idx === -1) throw new Error('Invalid base32 character');
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

function hotp(key: Uint8Array, counter: number): string {
	const msg = new Uint8Array(8);
	// 8-byte big-endian counter; >>> 0 keeps the high word integral for counters > 2^32
	new DataView(msg.buffer).setUint32(0, Math.floor(counter / 0x100000000));
	new DataView(msg.buffer).setUint32(4, counter >>> 0);
	const mac = new Bun.CryptoHasher('sha1', key).update(msg).digest() as Uint8Array;
	const offset = mac[mac.length - 1] & 0x0f;
	const code =
		(((mac[offset] & 0x7f) << 24) |
			((mac[offset + 1] & 0xff) << 16) |
			((mac[offset + 2] & 0xff) << 8) |
			(mac[offset + 3] & 0xff)) %
		10 ** DIGITS;
	return String(code).padStart(DIGITS, '0');
}

/** A fresh 160-bit base32 secret (the size the RFC 6238 SHA-1 vectors use). */
export function generateSecret(): string {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	return base32Encode(bytes);
}

/** Provisioning URI for authenticator apps (renderable as a QR code or pasted manually). */
export function otpauthUrl(email: string, secret: string): string {
	const issuer = 'coDiagnostiX';
	return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** The code valid at `nowMs` — exported for tests and the enable round-trip. */
export function totpCode(secret: string, nowMs = Date.now()): string {
	return hotp(base32Decode(secret), Math.floor(nowMs / 1000 / STEP_SECONDS));
}

/** Constant pattern check + ±1 step tolerance; tolerant of pasted spaces. */
export function verifyCode(secret: string, code: string, nowMs = Date.now()): boolean {
	const normalized = code.replace(/\s+/g, '');
	if (!/^\d{6}$/.test(normalized)) return false;
	let key: Uint8Array;
	try {
		key = base32Decode(secret);
	} catch {
		return false;
	}
	if (key.length === 0) return false;
	const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
	for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
		if (counter + drift < 0) continue;
		if (hotp(key, counter + drift) === normalized) return true;
	}
	return false;
}
