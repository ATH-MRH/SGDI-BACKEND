import * as SecureStore from 'expo-secure-store';

export type StoredSession = {
  token: string;
  /** Échéance du jeton en millisecondes Unix. */
  expiresAt: number;
  /** Refresh token à usage unique ; absent si le backend n'ouvre pas de session renouvelable. */
  refreshToken?: string;
  refreshExpiresAt?: number;
};

const SESSION_KEY = 'atlas.session.v1';

// Keychain iOS / Keystore Android. Le jeton reste sur cet appareil : il n'est ni
// synchronisé iCloud ni restauré depuis une sauvegarde sur un autre téléphone.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const { token, expiresAt, refreshToken, refreshExpiresAt } = value as Record<string, unknown>;
  const refreshAbsent = refreshToken === undefined && refreshExpiresAt === undefined;
  const refreshValid =
    typeof refreshToken === 'string' &&
    refreshToken.length > 0 &&
    typeof refreshExpiresAt === 'number' &&
    Number.isFinite(refreshExpiresAt);
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    typeof expiresAt === 'number' &&
    Number.isFinite(expiresAt) &&
    (refreshAbsent || refreshValid)
  );
}

/** Le jeton d'accès est arrivé à échéance (la session peut rester renouvelable). */
export function isSessionExpired(session: StoredSession, now: number = Date.now()): boolean {
  return session.expiresAt <= now;
}

export function canRefreshSession(session: StoredSession, now: number = Date.now()): boolean {
  return Boolean(session.refreshToken) && (session.refreshExpiresAt ?? 0) > now;
}

/** Ni jeton d'accès valide, ni refresh token utilisable : il faut se reconnecter. */
export function isSessionDead(session: StoredSession, now: number = Date.now()): boolean {
  return isSessionExpired(session, now) && !canRefreshSession(session, now);
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
}

/** Session stockée, ou null si absente, illisible ou définitivement expirée (alors effacée). */
export async function loadSession(now: number = Date.now()): Promise<StoredSession | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
  } catch {
    // Entrée devenue illisible (clé Keystore invalidée, restauration) : on repart de zéro.
    raw = null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!isStoredSession(parsed) || isSessionDead(parsed, now)) {
    await clearSession().catch(() => undefined);
    return null;
  }
  return parsed;
}
