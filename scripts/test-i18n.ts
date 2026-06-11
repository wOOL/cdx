/**
 * i18n framework tests:
 *  - all six locales export exactly the same key set as en (no missing/extra)
 *  - t() falls back to English for an unknown locale, and to the key itself
 *    for an unknown key
 *  - {var} interpolation works
 *
 *   bun run scripts/test-i18n.ts
 */
import en from '../src/lib/locales/en';
import de from '../src/lib/locales/de';
import fr from '../src/lib/locales/fr';
import it from '../src/lib/locales/it';
import nl from '../src/lib/locales/nl';
import hu from '../src/lib/locales/hu';

// i18n.svelte.ts uses the $state rune; outside the Svelte compiler the call
// resolves through the global scope, so shim it as the identity function
// before importing the module.
(globalThis as Record<string, unknown>).$state = <T>(v: T) => v;
const { t, setLocale, i18n, AVAILABLE_LOCALES, LOCALES } = await import('../src/lib/i18n.svelte');

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- key-set parity ----
const refKeys = Object.keys(en).sort();
check('en defines a substantial key set', refKeys.length >= 100, `${refKeys.length} keys`);

const locales: [string, Record<string, string>][] = [
	['de', de],
	['fr', fr],
	['it', it],
	['nl', nl],
	['hu', hu]
];
for (const [code, table] of locales) {
	const keys = new Set(Object.keys(table));
	const missing = refKeys.filter((k) => !keys.has(k));
	const extra = Object.keys(table).filter((k) => !(k in en));
	check(
		`${code} has the exact en key set`,
		missing.length === 0 && extra.length === 0,
		`missing=${missing.slice(0, 3).join(',') || 'none'} extra=${extra.slice(0, 3).join(',') || 'none'}`
	);
	const empty = Object.entries(table).filter(([, v]) => !v.trim());
	check(`${code} has no empty translations`, empty.length === 0);
}

// AVAILABLE_LOCALES matches LOCALES
check(
	'AVAILABLE_LOCALES lists exactly the bundled locales',
	AVAILABLE_LOCALES.length === 6 && AVAILABLE_LOCALES.every((l) => l.code in LOCALES)
);

// ---- t() basics ----
check('default locale is en', i18n.locale === 'en');
check("t('auth.signIn') in en", t('auth.signIn') === 'Sign in', t('auth.signIn'));

setLocale('de');
check('setLocale switches locale', i18n.locale === 'de');
check("t('auth.signIn') in de", t('auth.signIn') === 'Anmelden', t('auth.signIn'));

setLocale('xx'); // unknown locale must be rejected
check('setLocale ignores unknown locale', i18n.locale === 'de');

// force an unknown locale directly: t() must fall back to en
i18n.locale = 'xx';
check('unknown locale falls back to en', t('auth.signIn') === 'Sign in', t('auth.signIn'));

// unknown key falls back to the key itself
check(
	'unknown key falls back to the key',
	t('does.not.exist') === 'does.not.exist',
	t('does.not.exist')
);

// ---- interpolation ----
i18n.locale = 'en';
check(
	'interpolation replaces {var}s',
	t('viewer.sliceOf', { n: 42, total: 160 }) === 'Slice 42 of 160',
	t('viewer.sliceOf', { n: 42, total: 160 })
);
check(
	'interpolation with multiple vars',
	t('warn.safetyDistance', { label: '36', dist: '1.4', min: 2 }) ===
		'Implant 36 is 1.4 mm from the nerve — below the 2 mm safety distance.',
	t('warn.safetyDistance', { label: '36', dist: '1.4', min: 2 })
);
i18n.locale = 'hu';
check(
	'interpolation works in hu too',
	t('viewer.sliceOf', { n: 3, total: 9 }) === '3. szelet, összesen 9',
	t('viewer.sliceOf', { n: 3, total: 9 })
);

// missing vars leave the placeholder untouched (documented behaviour)
i18n.locale = 'en';
check(
	'unreferenced placeholders stay literal',
	t('viewer.sliceOf', { n: 1 }) === 'Slice 1 of {total}',
	t('viewer.sliceOf', { n: 1 })
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
