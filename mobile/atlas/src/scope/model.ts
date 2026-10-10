import type { ApiUser, ScopeSite } from '@/api/types';
import { authorizedSiteIds, canAccessSite, societyKey, societyScope } from '@/auth/permissions';

/** Choix de l'utilisateur, tel qu'il est mémorisé : identifiants uniquement. */
export type ScopeSelection = { society: string | null; siteId: number | null };

/**
 * Contexte de travail courant. `society` ou `site` à null signifie « tout ce que
 * le compte est autorisé à voir » — jamais « tout ATLAS » : le backend filtre.
 */
export type CurrentScope = {
  society: string | null;
  site: ScopeSite | null;
  /** Sociétés proposables à ce compte. */
  societies: string[];
  /** Sites proposables pour la société sélectionnée. */
  sites: ScopeSite[];
  canChangeSociety: boolean;
  canChangeSite: boolean;
  /** Le compte voit toutes les sociétés d'ATLAS (accès global). */
  globalAccess: boolean;
};

export const EMPTY_SCOPE: CurrentScope = {
  society: null,
  site: null,
  societies: [],
  sites: [],
  canChangeSociety: false,
  canChangeSite: false,
  globalAccess: false,
};

function byLabel(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' });
}

function uniqueSites(sites: readonly ScopeSite[]): ScopeSite[] {
  const seen = new Set<number>();
  return sites.filter((site) => (seen.has(site.id) ? false : (seen.add(site.id), true)));
}

/**
 * Calcule le contexte valide pour ce profil.
 *
 * Tout part de ce que le backend a renvoyé (/me et listes de sites). Une
 * sélection mémorisée n'est reprise que si elle est encore autorisée ; sinon
 * elle est abandonnée au profit d'une valeur valide.
 */
export function buildScope(
  user: ApiUser | null | undefined,
  knownSites: readonly ScopeSite[],
  saved: ScopeSelection | null,
): CurrentScope {
  const scope = societyScope(user);
  if (!user || scope.kind === 'none') return EMPTY_SCOPE;

  const allowedSites = uniqueSites(knownSites.filter((site) => canAccessSite(user, site))).sort((a, b) =>
    byLabel(a.name ?? String(a.id), b.name ?? String(b.id)),
  );

  let societies: string[];
  if (scope.kind === 'limited') {
    societies = [...scope.societies].sort(byLabel);
  } else {
    const labels = new Map<string, string>();
    for (const site of allowedSites) {
      const key = societyKey(site.society);
      if (key && site.society && !labels.has(key)) labels.set(key, site.society);
    }
    societies = [...labels.values()].sort(byLabel);
  }

  const savedKey = societyKey(saved?.society);
  let society = savedKey ? (societies.find((label) => societyKey(label) === savedKey) ?? null) : null;
  // Une seule société autorisée : rien à choisir.
  if (scope.kind === 'limited' && societies.length === 1) society = societies[0] ?? null;

  const selectedKey = societyKey(society);
  const sites = selectedKey
    ? allowedSites.filter((site) => !site.society || societyKey(site.society) === selectedKey)
    : allowedSites;

  let site = saved?.siteId != null ? (sites.find((entry) => entry.id === saved.siteId) ?? null) : null;
  // Un seul site explicitement autorisé : rien à choisir.
  if (authorizedSiteIds(user).length > 0 && sites.length === 1) site = sites[0] ?? null;

  return {
    society,
    site,
    societies,
    sites,
    canChangeSociety: societies.length > 1,
    canChangeSite: sites.length > 1,
    globalAccess: scope.kind === 'global',
  };
}

export function selectionOf(scope: CurrentScope): ScopeSelection {
  return { society: scope.society, siteId: scope.site?.id ?? null };
}

export function sameSelection(a: ScopeSelection | null, b: ScopeSelection | null): boolean {
  return (a?.society ?? null) === (b?.society ?? null) && (a?.siteId ?? null) === (b?.siteId ?? null);
}
