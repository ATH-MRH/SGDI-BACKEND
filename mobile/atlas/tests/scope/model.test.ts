import { buildScope, EMPTY_SCOPE, sameSelection, selectionOf } from '@/scope/model';

import { makeSite, makeUser } from '../helpers';

const A = 'Societe A';
const B = 'Societe B';

describe('buildScope — sociétés', () => {
  it('sélectionne automatiquement la seule société autorisée, sans choix possible', () => {
    const scope = buildScope(makeUser({ authorized_societies: [A], authorized_sites: [] }), [makeSite(1), makeSite(2)], null);
    expect(scope.society).toBe(A);
    expect(scope.canChangeSociety).toBe(false);
    expect(scope.societies).toEqual([A]);
  });

  it('propose un choix quand plusieurs sociétés sont autorisées', () => {
    const user = makeUser({ authorized_societies: [B, A], authorized_sites: [] });
    const scope = buildScope(user, [makeSite(1, A), makeSite(2, B)], null);
    expect(scope.societies).toEqual([A, B]);
    expect(scope.canChangeSociety).toBe(true);
    expect(scope.society).toBeNull();
    expect(scope.sites.map((site) => site.id)).toEqual([1, 2]);
  });

  it("pour un accès global, ne propose que les sociétés présentes dans les données du backend", () => {
    const user = makeUser({ global_society_access: true, authorized_societies: [], authorized_sites: [] });
    const scope = buildScope(user, [makeSite(1, A), makeSite(2, B), makeSite(3, 'societe a')], null);
    expect(scope.globalAccess).toBe(true);
    expect(scope.societies).toEqual([A, B]);
    expect(scope.society).toBeNull();
  });

  it('ne donne aucun périmètre à un compte sans société', () => {
    expect(buildScope(makeUser({ authorized_societies: [] }), [makeSite(1)], { society: A, siteId: 1 })).toEqual(EMPTY_SCOPE);
    expect(buildScope(null, [makeSite(1)], null)).toEqual(EMPTY_SCOPE);
  });
});

describe('buildScope — sites', () => {
  it('ne présente jamais un site hors de la liste explicite du compte', () => {
    const user = makeUser({ authorized_societies: [A], authorized_sites: [3, 9] });
    const scope = buildScope(user, [makeSite(3), makeSite(4), makeSite(9), makeSite(10, B)], null);
    expect(scope.sites.map((site) => site.id)).toEqual([3, 9]);
    expect(scope.canChangeSite).toBe(true);
    expect(scope.site).toBeNull();
  });

  it('ne présente jamais un site d\'une société non autorisée', () => {
    const user = makeUser({ authorized_societies: [A], authorized_sites: [] });
    const scope = buildScope(user, [makeSite(1, A), makeSite(2, B), makeSite(3, null)], null);
    expect(scope.sites.map((site) => site.id)).toEqual([1]);
  });

  it('sélectionne automatiquement le seul site explicitement autorisé', () => {
    const user = makeUser({ authorized_societies: [A], authorized_sites: [3] });
    const scope = buildScope(user, [makeSite(3), makeSite(4)], null);
    expect(scope.site?.id).toBe(3);
    expect(scope.canChangeSite).toBe(false);
  });

  it("n'impose pas un site unique quand le compte n'a pas de restriction par site", () => {
    const user = makeUser({ authorized_societies: [A], authorized_sites: [] });
    expect(buildScope(user, [makeSite(1)], null).site).toBeNull();
  });

  it('filtre les sites selon la société choisie', () => {
    const user = makeUser({ authorized_societies: [A, B], authorized_sites: [] });
    const scope = buildScope(user, [makeSite(1, A), makeSite(2, B), makeSite(5, B)], { society: B, siteId: null });
    expect(scope.society).toBe(B);
    expect(scope.sites.map((site) => site.id)).toEqual([2, 5]);
  });

  it('dédoublonne et trie les sites par nom', () => {
    const user = makeUser({ authorized_societies: [A], authorized_sites: [] });
    const scope = buildScope(user, [makeSite(2, A, 'Zeta'), makeSite(1, A, 'alpha'), makeSite(2, A, 'Zeta')], null);
    expect(scope.sites.map((site) => site.name)).toEqual(['alpha', 'Zeta']);
  });
});

describe('buildScope — sélection mémorisée revalidée', () => {
  const user = makeUser({ authorized_societies: [A, B], authorized_sites: [] });
  const sites = [makeSite(1, A), makeSite(2, B)];

  it('reprend une sélection encore autorisée', () => {
    const scope = buildScope(user, sites, { society: 'societe b', siteId: 2 });
    expect(scope.society).toBe(B);
    expect(scope.site?.id).toBe(2);
  });

  it('abandonne une société qui n\'est plus autorisée', () => {
    const scope = buildScope(makeUser({ authorized_societies: [A], authorized_sites: [] }), sites, { society: B, siteId: 2 });
    expect(scope.society).toBe(A);
    expect(scope.site).toBeNull();
  });

  it('abandonne un site qui n\'est plus autorisé ou qui n\'appartient pas à la société choisie', () => {
    expect(buildScope(user, sites, { society: A, siteId: 2 }).site).toBeNull();
    expect(buildScope(user, sites, { society: null, siteId: 99 }).site).toBeNull();
    const restricted = makeUser({ authorized_societies: [A, B], authorized_sites: [1] });
    expect(buildScope(restricted, sites, { society: null, siteId: 2 }).site?.id).toBe(1);
  });

  it('abandonne une société inconnue du compte', () => {
    expect(buildScope(user, sites, { society: 'Societe Z', siteId: null }).society).toBeNull();
  });
});

describe('sélections', () => {
  it('compare et extrait les sélections', () => {
    const scope = buildScope(makeUser({ authorized_societies: [A], authorized_sites: [3] }), [makeSite(3)], null);
    expect(selectionOf(scope)).toEqual({ society: A, siteId: 3 });
    expect(sameSelection({ society: A, siteId: 3 }, { society: A, siteId: 3 })).toBe(true);
    expect(sameSelection({ society: A, siteId: 3 }, { society: A, siteId: null })).toBe(false);
    expect(sameSelection(null, { society: null, siteId: null })).toBe(true);
  });
});
