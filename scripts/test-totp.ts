// RFC 6238 conformance + round-trip checks for src/lib/server/totp.ts
// Run: bun scripts/test-totp.ts   (exit 0 = all pass)
import { generateSecret, otpauthUrl, totpCode, verifyCode } from '../src/lib/server/totp';

let failures = 0;

function check(name: string, ok: boolean): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
	if (!ok) failures++;
}

// RFC 6238 Appendix B (SHA-1): ASCII secret '12345678901234567890'
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

check("RFC vector T=59s → '287082'", totpCode(RFC_SECRET, 59_000) === '287082');
check("RFC vector T=1111111109s → '081804'", totpCode(RFC_SECRET, 1_111_111_109_000) === '081804');
check("RFC vector T=1234567890s → '005924'", totpCode(RFC_SECRET, 1_234_567_890_000) === '005924');
check("RFC vector T=2000000000s → '279037'", totpCode(RFC_SECRET, 2_000_000_000_000) === '279037');

check('verifyCode accepts exact step', verifyCode(RFC_SECRET, '287082', 59_000));
check('verifyCode tolerates -1 step (code from previous window)', verifyCode(RFC_SECRET, '287082', 89_000));
check('verifyCode tolerates +1 step (code from next window)', verifyCode(RFC_SECRET, '287082', 29_000));
check('verifyCode rejects beyond ±1 step', !verifyCode(RFC_SECRET, '287082', 149_000));
check('verifyCode rejects a wrong code', !verifyCode(RFC_SECRET, '000000', 59_000));
check("verifyCode ignores pasted spaces ('287 082')", verifyCode(RFC_SECRET, '287 082', 59_000));
check('verifyCode rejects non-numeric input', !verifyCode(RFC_SECRET, 'abcdef', 59_000));
check('verifyCode rejects an empty secret', !verifyCode('', '287082', 59_000));

// round trip: generate → code → verify
const secret = generateSecret();
check('generateSecret: 32 chars of base32 (160-bit)', /^[A-Z2-7]{32}$/.test(secret));
check('round trip: generated secret verifies its own current code', verifyCode(secret, totpCode(secret)));
check('round trip: a second secret rejects that code', !verifyCode(generateSecret(), totpCode(secret)));

const url = otpauthUrl('cdx@surrey.ac', secret);
check(
	'otpauthUrl shape',
	url.startsWith('otpauth://totp/') &&
		url.includes(`secret=${secret}`) &&
		url.includes('issuer=coDiagnostiX') &&
		url.includes('digits=6') &&
		url.includes('period=30')
);

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll TOTP checks passed');
