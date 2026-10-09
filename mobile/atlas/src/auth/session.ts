import { canRefreshSession, isSessionDead, isSessionExpired, type StoredSession } from './secureStorage';

/**
 * Session en mémoire, lue par le client API. La persistance est assurée par
 * secureStorage ; le jeton n'est jamais écrit ailleurs ni journalisé.
 */
let current: StoredSession | null = null;
const rejectionListeners = new Set<() => void>();
const forbiddenListeners = new Set<() => void>();
const upgradeListeners = new Set<() => void>();

function subscribe(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSession(session: StoredSession | null): void {
  current = session;
}

export function getSessionToken(): string | null {
  if (!current || isSessionExpired(current)) return null;
  return current.token;
}

/** Une session existe et peut encore servir, directement ou après renouvellement. */
export function hasUsableSession(): boolean {
  return current !== null && !isSessionDead(current);
}

/** Échange le refresh token contre une nouvelle session ; lève si le backend refuse ou est injoignable. */
export type SessionRenewer = (refreshToken: string) => Promise<StoredSession>;

let renewing: Promise<string | null> | null = null;

/**
 * Renouvelle la session avec son refresh token. Un seul renouvellement à la fois :
 * le refresh token est à usage unique, deux appels concurrents révoqueraient la session.
 *
 * `staleToken` est le jeton d'accès que le backend vient de refuser ; s'il a déjà été
 * remplacé entre-temps, le jeton courant est renvoyé sans nouvel échange.
 * Renvoie null quand la session n'est pas renouvelable ; laisse remonter l'erreur
 * réseau, qui ne doit pas fermer la session.
 */
export function renewSession(renew: SessionRenewer, staleToken?: string | null): Promise<string | null> {
  if (renewing) return renewing;
  const session = current;
  if (!session) return Promise.resolve(null);
  if (staleToken && session.token !== staleToken && !isSessionExpired(session)) return Promise.resolve(session.token);
  if (!session.refreshToken || !canRefreshSession(session)) return Promise.resolve(null);

  const pending = renew(session.refreshToken)
    .then((next) => {
      // Session fermée pendant l'échange : le nouveau jeton n'est pas installé.
      if (current !== session) return null;
      current = next;
      for (const listener of renewalListeners) listener(next);
      return next.token;
    })
    .finally(() => {
      renewing = null;
    });
  renewing = pending;
  return pending;
}

const renewalListeners = new Set<(session: StoredSession) => void>();

/** La session a été renouvelée : elle doit être réécrite dans le stockage sécurisé. */
export function onSessionRenewed(listener: (session: StoredSession) => void): () => void {
  renewalListeners.add(listener);
  return () => {
    renewalListeners.delete(listener);
  };
}

/** Le backend a refusé le jeton (ou il a expiré) : la session doit être fermée. */
export function notifySessionRejected(): void {
  current = null;
  for (const listener of rejectionListeners) listener();
}

export function onSessionRejected(listener: () => void): () => void {
  rejectionListeners.add(listener);
  return () => {
    rejectionListeners.delete(listener);
  };
}

/** Un appel authentifié a été refusé (403) : le profil mérite d'être rechargé. */
export function notifyForbidden(): void {
  for (const listener of forbiddenListeners) listener();
}

export function onForbidden(listener: () => void): () => void {
  return subscribe(forbiddenListeners, listener);
}

/** Le backend a répondu 426 : cette version de l'application n'est plus acceptée. */
export function notifyUpgradeRequired(): void {
  for (const listener of upgradeListeners) listener();
}

export function onUpgradeRequired(listener: () => void): () => void {
  return subscribe(upgradeListeners, listener);
}
