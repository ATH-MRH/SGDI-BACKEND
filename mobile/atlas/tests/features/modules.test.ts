import { MOBILE_MODULES, visibleModules } from '@/features/modules';
import { dictionaries } from '@/i18n';

import { makeUser } from '../helpers';

describe('modules mobiles', () => {
  it("n'affiche rien sans profil", () => {
    expect(visibleModules(null)).toEqual([]);
  });

  it("n'affiche que les modules accordés par le backend", () => {
    const keys = visibleModules(makeUser({ effective_modules: ['brq', 'drh', 'finances'] })).map((m) => m.key);
    expect(keys).toEqual(['brq', 'drh']);
  });

  it("n'affiche aucun module à un compte sans module", () => {
    expect(visibleModules(makeUser({ effective_modules: [] }))).toEqual([]);
  });

  it('a un libellé traduit pour chaque module', () => {
    for (const module of MOBILE_MODULES) {
      expect(dictionaries.fr[module.title]).toBeTruthy();
      expect(dictionaries.fr[module.body]).toBeTruthy();
    }
  });
});
