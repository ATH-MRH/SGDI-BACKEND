import { dictionaries, resolveLocale, translate } from '@/i18n';
import { fr } from '@/i18n/locales/fr';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('i18n', () => {
  it.each(Object.keys(dictionaries))('la langue %s couvre toutes les clés françaises', (locale) => {
    const dictionary = dictionaries[locale as keyof typeof dictionaries];
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(fr).sort());
    for (const [key, text] of Object.entries(dictionary)) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(placeholders(text)).toEqual(placeholders(fr[key as keyof typeof fr]));
    }
  });

  it('choisit la première langue supportée, sinon le français', () => {
    expect(resolveLocale(['en', 'ar', 'fr'])).toBe('ar');
    expect(resolveLocale(['de', null, undefined])).toBe('fr');
    expect(resolveLocale([])).toBe('fr');
  });

  it('interpole les paramètres et laisse intact un paramètre manquant', () => {
    expect(translate('fr', 'app.version', { version: '1.0.0' })).toBe('Version 1.0.0');
    expect(translate('fr', 'app.build', { build: 14 })).toBe('Build 14');
    expect(translate('fr', 'home.greeting')).toBe('Bonjour {name}');
  });
});
