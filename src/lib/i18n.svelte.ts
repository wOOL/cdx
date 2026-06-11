/**
 * Tiny runes-based i18n framework.
 *
 * - `i18n.locale` is reactive ($state): any template expression that calls
 *   `t(...)` re-renders when the locale changes.
 * - `t(key, vars)` looks up the active locale, falls back to English, then to
 *   the key itself; `{var}` placeholders are interpolated from `vars`.
 * - `setLocale(code)` switches the locale and persists it to
 *   localStorage('cdx_locale'); the saved choice is restored on module init.
 *
 * On the server the locale is always 'en' (no localStorage); pages render
 * English HTML and the client re-applies the saved locale during hydration.
 */
import en from './locales/en';
import de from './locales/de';
import fr from './locales/fr';
import it from './locales/it';
import nl from './locales/nl';
import hu from './locales/hu';

export const LOCALES: Record<string, Record<string, string>> = { en, de, fr, it, nl, hu };

export const AVAILABLE_LOCALES = [
	{ code: 'en', name: 'English' },
	{ code: 'de', name: 'Deutsch' },
	{ code: 'fr', name: 'Français' },
	{ code: 'it', name: 'Italiano' },
	{ code: 'nl', name: 'Nederlands' },
	{ code: 'hu', name: 'Magyar' }
] as const;

export const i18n = $state({ locale: 'en' });

// restore the persisted choice (client only)
if (typeof localStorage !== 'undefined') {
	const saved = localStorage.getItem('cdx_locale');
	if (saved && LOCALES[saved]) i18n.locale = saved;
}

/** Translate `key` in the active locale with `{var}` interpolation. */
export function t(key: string, vars?: Record<string, string | number>): string {
	let s = LOCALES[i18n.locale]?.[key] ?? LOCALES.en[key] ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			s = s.replaceAll(`{${k}}`, String(v));
		}
	}
	return s;
}

/** Switch the UI locale and persist it to localStorage('cdx_locale'). */
export function setLocale(l: string): void {
	if (!LOCALES[l]) return;
	i18n.locale = l;
	if (typeof localStorage !== 'undefined') localStorage.setItem('cdx_locale', l);
}
