import type { ApiUser, ScopeSite } from '@/api/types';

/**
 * Couche RBAC unique du mobile. Aucun écran ne décide seul de ce qu'il affiche.
 *
 * Ces fonctions servent à MASQUER ce que le profil ne permet pas. Ce n'est pas
 * une sécurité : le backend contrôle chaque requête et reste seul juge.
 *
 * Refus par défaut : une information absente, vide ou ambiguë masque l'action.
 */

/** Clés de modules telles que le backend les applique (User.authorized_modules). */
export type ModuleKey =
  | 'drh'
  | 'ops'
  | 'pointage'
  | 'pointeur'
  | 'brq'
  | 'site_workforce'
  | 'recrute'
  | 'conges'
  | 'finances'
  | 'dc'
  | 'materiel'
  | 'pret'
  | 'caisse'
  | 'secretariat';

export type Action = 'read' | 'create' | 'update' | 'validate' | 'delete' | 'export' | 'unlock' | 'admin';

const ACTIONS: readonly string[] = ['read', 'create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin'];

type MaybeUser = ApiUser | null | undefined;

function isUsable(user: MaybeUser): user is ApiUser {
  return Boolean(user) && user?.is_active === true;
}

/** Même normalisation que le backend (app/core/scope_policy.py, society_key). */
export function societyKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function canAccessModule(user: MaybeUser, module: ModuleKey): boolean {
  if (!isUsable(user)) return false;
  if (user.module_access_global === true) return true;
  // Seuls les modules CALCULÉS par /me comptent ; `authorized_modules` brut peut être
  // null (compte historique) et ne dit rien de fiable à lui seul.
  return Array.isArray(user.effective_modules) && user.effective_modules.includes(module);
}

export function canAccessAnyModule(user: MaybeUser, modules: readonly ModuleKey[]): boolean {
  return modules.some((module) => canAccessModule(user, module));
}

/** Actions explicitement accordées au compte, normalisées. */
export function grantedActions(user: MaybeUser): Action[] {
  if (!isUsable(user)) return [];
  const values = (user.authorized_actions ?? []).map((value) => String(value).trim().toLowerCase());
  return ACTIONS.filter((action) => values.includes(action)) as Action[];
}

/**
 * Une action n'est proposée que si le module est accordé ET l'action explicite.
 * Sans action explicite, seul l'accès en consultation est proposé.
 */
export function canPerform(user: MaybeUser, module: ModuleKey, action: Action): boolean {
  if (!canAccessModule(user, module)) return false;
  const granted = grantedActions(user);
  if (granted.includes('admin')) return true;
  if (action === 'read') return granted.length === 0 || granted.includes('read');
  return granted.includes(action);
}

export type SocietyScope =
  | { kind: 'global' }
  | { kind: 'limited'; societies: string[] }
  | { kind: 'none' };

export function societyScope(user: MaybeUser): SocietyScope {
  if (!isUsable(user)) return { kind: 'none' };
  if (user.global_society_access === true) return { kind: 'global' };
  const seen = new Set<string>();
  const societies: string[] = [];
  for (const value of user.authorized_societies ?? []) {
    const label = String(value ?? '').trim();
    const key = societyKey(label);
    if (key && !seen.has(key)) {
      seen.add(key);
      societies.push(label);
    }
  }
  return societies.length ? { kind: 'limited', societies } : { kind: 'none' };
}

export function canAccessSociety(user: MaybeUser, society: string | null | undefined): boolean {
  const scope = societyScope(user);
  if (scope.kind === 'global') return true;
  if (scope.kind === 'none') return false;
  const key = societyKey(society);
  return key.length > 0 && scope.societies.some((allowed) => societyKey(allowed) === key);
}

/** Identifiants de sites explicitement autorisés ; vide = pas de restriction par site. */
export function authorizedSiteIds(user: MaybeUser): number[] {
  if (!isUsable(user)) return [];
  return (user.authorized_sites ?? []).filter((id): id is number => Number.isInteger(id));
}

/**
 * Un site n'est présentable que s'il est dans la liste explicite du compte, ou,
 * à défaut de liste, s'il appartient à une société autorisée. Un site dont la
 * société est inconnue n'est jamais présenté à un compte limité.
 */
export function canAccessSite(user: MaybeUser, site: Pick<ScopeSite, 'id' | 'society'> | null | undefined): boolean {
  if (!isUsable(user) || !site || !Number.isInteger(site.id)) return false;
  const scope = societyScope(user);
  if (scope.kind === 'none') return false;
  const explicit = authorizedSiteIds(user);
  if (explicit.length > 0) return explicit.includes(site.id);
  return scope.kind === 'global' || canAccessSociety(user, site.society);
}
