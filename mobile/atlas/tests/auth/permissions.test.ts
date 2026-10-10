import {
  authorizedSiteIds,
  canAccessAnyModule,
  canAccessModule,
  canAccessSite,
  canAccessSociety,
  canPerform,
  grantedActions,
  societyKey,
  societyScope,
} from '@/auth/permissions';

import { makeSite, makeUser } from '../helpers';

describe('canAccessModule', () => {
  it('refuse par défaut sans profil ou pour un compte inactif', () => {
    expect(canAccessModule(null, 'ops')).toBe(false);
    expect(canAccessModule(undefined, 'drh')).toBe(false);
    expect(canAccessModule(makeUser({ is_active: false, module_access_global: true }), 'ops')).toBe(false);
  });

  it("n'accorde que les modules effectifs calculés par le backend", () => {
    const user = makeUser({ effective_modules: ['ops', 'brq'] });
    expect(canAccessModule(user, 'ops')).toBe(true);
    expect(canAccessModule(user, 'drh')).toBe(false);
    expect(canAccessAnyModule(user, ['drh', 'brq'])).toBe(true);
    expect(canAccessAnyModule(user, ['drh', 'finances'])).toBe(false);
  });

  it('refuse quand les modules effectifs sont absents, même si la liste brute en contient', () => {
    expect(canAccessModule(makeUser({ effective_modules: null, authorized_modules: ['drh'] }), 'drh')).toBe(false);
    expect(canAccessModule(makeUser({ effective_modules: undefined as never }), 'ops')).toBe(false);
  });

  it('accorde tout module à un accès global', () => {
    expect(canAccessModule(makeUser({ effective_modules: [], module_access_global: true }), 'finances')).toBe(true);
  });
});

describe('canPerform — refus par défaut', () => {
  it('refuse toute action sans le module', () => {
    const user = makeUser({ effective_modules: ['ops'], authorized_actions: ['admin'] });
    expect(canPerform(user, 'drh', 'read')).toBe(false);
    expect(canPerform(user, 'drh', 'update')).toBe(false);
    expect(canPerform(null, 'ops', 'read')).toBe(false);
  });

  it("n'accorde que les actions explicites", () => {
    const user = makeUser({ authorized_actions: ['read', 'EXPORT ', 'inconnue'] as never });
    expect(grantedActions(user)).toEqual(['read', 'export']);
    expect(canPerform(user, 'ops', 'read')).toBe(true);
    expect(canPerform(user, 'ops', 'export')).toBe(true);
    expect(canPerform(user, 'ops', 'validate')).toBe(false);
    expect(canPerform(user, 'ops', 'delete')).toBe(false);
  });

  it('sans action explicite, consultation seule', () => {
    for (const actions of [[], null]) {
      const user = makeUser({ authorized_actions: actions as never });
      expect(canPerform(user, 'ops', 'read')).toBe(true);
      for (const action of ['create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin'] as const) {
        expect(canPerform(user, 'ops', action)).toBe(false);
      }
    }
  });

  it('ne déduit pas la consultation quand la liste explicite ne la contient pas', () => {
    expect(canPerform(makeUser({ authorized_actions: ['export'] }), 'ops', 'read')).toBe(false);
  });

  it('traite "admin" comme toutes les actions, mais seulement sur les modules accordés', () => {
    const user = makeUser({ authorized_actions: ['admin'] });
    expect(canPerform(user, 'ops', 'delete')).toBe(true);
    expect(canPerform(user, 'drh', 'delete')).toBe(false);
  });

  it("n'accorde pas les écritures à un administrateur sans action explicite", () => {
    const admin = makeUser({ module_access_global: true, authorized_actions: [] });
    expect(canPerform(admin, 'drh', 'read')).toBe(true);
    expect(canPerform(admin, 'drh', 'update')).toBe(false);
  });
});

describe('sociétés', () => {
  it('normalise comme le backend (accents, casse, espaces)', () => {
    expect(societyKey('  Iron  Global Sécurité ')).toBe('IRON GLOBAL SECURITE');
    expect(societyKey(null)).toBe('');
  });

  it('distingue périmètre global, limité et absent, en dédoublonnant', () => {
    expect(societyScope(makeUser({ global_society_access: true }))).toEqual({ kind: 'global' });
    expect(societyScope(makeUser({ authorized_societies: ['A', ' ', 'B', 'a'] }))).toEqual({
      kind: 'limited',
      societies: ['A', 'B'],
    });
    expect(societyScope(makeUser({ authorized_societies: [] }))).toEqual({ kind: 'none' });
    expect(societyScope(makeUser({ authorized_societies: null }))).toEqual({ kind: 'none' });
    expect(societyScope(null)).toEqual({ kind: 'none' });
  });

  it("n'autorise que les sociétés du compte", () => {
    const user = makeUser({ authorized_societies: ['Iron Global Sécurité'] });
    expect(canAccessSociety(user, 'IRON GLOBAL SECURITE')).toBe(true);
    expect(canAccessSociety(user, 'Autre Société')).toBe(false);
    expect(canAccessSociety(user, '')).toBe(false);
    expect(canAccessSociety(user, null)).toBe(false);
    expect(canAccessSociety(makeUser({ authorized_societies: [] }), 'Iron Global Sécurité')).toBe(false);
    expect(canAccessSociety(makeUser({ global_society_access: true, authorized_societies: [] }), 'Autre')).toBe(true);
  });
});

describe('sites', () => {
  it('avec une liste explicite, seuls ces sites sont présentables', () => {
    const user = makeUser({ authorized_sites: [3, 9] });
    expect(authorizedSiteIds(user)).toEqual([3, 9]);
    expect(canAccessSite(user, makeSite(3))).toBe(true);
    expect(canAccessSite(user, makeSite(4))).toBe(false);
  });

  it('sans liste explicite, la société du site doit être autorisée', () => {
    const user = makeUser({ authorized_sites: [], authorized_societies: ['Societe A'] });
    expect(canAccessSite(user, makeSite(1, 'Societe A'))).toBe(true);
    expect(canAccessSite(user, makeSite(2, 'Societe B'))).toBe(false);
    expect(canAccessSite(user, makeSite(3, null))).toBe(false);
  });

  it('refuse tout site à un compte sans périmètre, sans profil ou pour une entrée invalide', () => {
    expect(canAccessSite(makeUser({ authorized_societies: [], authorized_sites: [3] }), makeSite(3))).toBe(false);
    expect(canAccessSite(null, makeSite(3))).toBe(false);
    expect(canAccessSite(makeUser(), null)).toBe(false);
    expect(canAccessSite(makeUser(), { id: 1.5, society: 'Societe A' })).toBe(false);
  });

  it('un accès global sans liste explicite voit tous les sites', () => {
    const user = makeUser({ global_society_access: true, authorized_societies: [], authorized_sites: [] });
    expect(canAccessSite(user, makeSite(42, 'Nimporte'))).toBe(true);
    expect(canAccessSite(user, makeSite(43, null))).toBe(true);
  });
});
