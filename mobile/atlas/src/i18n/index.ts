import { getLocales } from 'expo-localization';

import { ar } from './locales/ar';
import { fr, type TranslationKey } from './locales/fr';

export type { TranslationKey };
export type Locale = 'fr' | 'ar';

export const DEFAULT_LOCALE: Locale = 'fr';

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = { fr, ar };

export function resolveLocale(languageCodes: readonly (string | null | undefined)[]): Locale {
  for (const code of languageCodes) {
    if (code && code in dictionaries) return code as Locale;
  }
  return DEFAULT_LOCALE;
}

let activeLocale: Locale | null = null;

export function getLocale(): Locale {
  if (!activeLocale) {
    activeLocale = resolveLocale(getLocales().map((locale) => locale.languageCode));
  }
  return activeLocale;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template: string = dictionaries[locale][key] ?? fr[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Tous les textes de l'interface passent par ici : aucune chaîne en dur dans les écrans. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(getLocale(), key, params);
}
