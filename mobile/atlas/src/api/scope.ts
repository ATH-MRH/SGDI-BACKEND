import { canAccessModule } from '@/auth/permissions';

import type { ApiClient } from './client';
import type { ApiUser, ScopeSite } from './types';

type RawSite = { id?: unknown; name?: unknown; society?: unknown };

function toScopeSite(raw: RawSite): ScopeSite | null {
  if (typeof raw.id !== 'number' || !Number.isInteger(raw.id)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  const society = typeof raw.society === 'string' && raw.society.trim() ? raw.society.trim() : null;
  return { id: raw.id, name, society };
}

function toScopeSites(rows: unknown): ScopeSite[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => toScopeSite((row ?? {}) as RawSite)).filter((site): site is ScopeSite => site !== null);
}

/**
 * Sites que le backend reconnaît dans le périmètre de l'utilisateur.
 *
 * Il n'existe pas d'endpoint de périmètre commun à tous les profils : on utilise
 * la liste déjà filtrée côté serveur à laquelle les modules du compte donnent
 * accès. Sans liste accessible, seuls les identifiants de /me sont connus.
 */
export async function fetchScopeSites(client: ApiClient, user: ApiUser): Promise<ScopeSite[]> {
  if (canAccessModule(user, 'pointage') || canAccessModule(user, 'ops') || canAccessModule(user, 'drh')) {
    return toScopeSites(await client.get<unknown>('/api/attendance/sites'));
  }
  if (canAccessModule(user, 'site_workforce')) {
    const scope = await client.get<{ sites?: unknown }>('/api/site-workforce/scope');
    return toScopeSites(scope?.sites);
  }
  return (user.authorized_sites ?? [])
    .filter((id) => Number.isInteger(id))
    .map((id) => ({ id, name: null, society: null }));
}
