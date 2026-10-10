import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { api, ApiError, clientInfo, type ApiUser } from '@/api';
import { fetchProfile, login, logout } from '@/api/auth';
import { PROFILE_REFRESH_MIN_INTERVAL_MS } from '@/config/security';

import { clearLocalUserData } from './localData';
import { clearSession, loadSession, saveSession, type StoredSession } from './secureStorage';
import { hasUsableSession, onForbidden, onSessionRejected, onSessionRenewed, setSession } from './session';

export type AuthState =
  /** Session en cours de restauration : aucun écran protégé n'est monté. */
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** Session présente mais profil injoignable (réseau) : on propose de réessayer. */
  | { status: 'unavailable'; error: ApiError }
  | { status: 'signedIn'; user: ApiUser };

type AuthContextValue = {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
  /** Recharge /me ; `force` ignore le délai minimal entre deux rechargements. */
  refreshProfile: (force?: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({ kind: 'unknown' });
}

/**
 * Ouvre une session : /me recalcule modules effectifs et périmètre, c'est lui
 * qui fait foi. Lève l'erreur si le backend refuse le compte (401/403).
 */
async function resolveState(session: StoredSession): Promise<AuthState> {
  setSession(session);
  try {
    return { status: 'signedIn', user: await fetchProfile(api) };
  } catch (error) {
    const apiError = asApiError(error);
    if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
      setSession(null);
      throw apiError;
    }
    return { status: 'unavailable', error: apiError };
  }
}

async function restoreState(): Promise<AuthState> {
  const session = await loadSession();
  if (!session) {
    setSession(null);
    return { status: 'signedOut' };
  }
  try {
    return await resolveState(session);
  } catch {
    await clearSession().catch(() => undefined);
    return { status: 'signedOut' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const signedIn = state.status === 'signedIn';
  const lastProfileAt = useRef(0);
  const refreshing = useRef(false);

  const closeSession = useCallback(async () => {
    setSession(null);
    queryClient.clear();
    setState({ status: 'signedOut' });
    await Promise.all([clearSession().catch(() => undefined), clearLocalUserData()]);
  }, [queryClient]);

  const applyState = useCallback((next: AuthState) => {
    if (next.status === 'signedIn') lastProfileAt.current = Date.now();
    setState(next);
  }, []);

  useEffect(() => {
    let active = true;
    void restoreState().then((next) => {
      if (active) applyState(next);
    });
    return () => {
      active = false;
    };
  }, [applyState]);

  useEffect(() => onSessionRejected(() => void closeSession()), [closeSession]);

  // Le refresh token est à usage unique : chaque renouvellement est réécrit aussitôt.
  useEffect(() => onSessionRenewed((session) => void saveSession(session).catch(() => undefined)), []);

  const signOut = useCallback(async () => {
    // Révocation serveur au mieux ; hors ligne, la session locale est fermée quand même.
    if (hasUsableSession()) await logout(api).catch(() => undefined);
    await closeSession();
  }, [closeSession]);

  const retry = useCallback(async () => {
    setState({ status: 'loading' });
    applyState(await restoreState());
  }, [applyState]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      // Le mot de passe n'est jamais conservé : il ne sert qu'à cet appel.
      const session: StoredSession = await login(api, username, password, clientInfo);
      let next: AuthState;
      try {
        next = await resolveState(session);
      } catch (error) {
        await closeSession();
        throw error;
      }
      await saveSession(session);
      applyState(next);
    },
    [applyState, closeSession],
  );

  const refreshProfile = useCallback(
    async (force = false) => {
      if (!signedIn || refreshing.current) return;
      if (!force && Date.now() - lastProfileAt.current < PROFILE_REFRESH_MIN_INTERVAL_MS) return;
      // Session arrivée à échéance pendant que l'application était en arrière-plan.
      if (!hasUsableSession()) {
        await closeSession();
        return;
      }
      refreshing.current = true;
      try {
        const user = await fetchProfile(api);
        lastProfileAt.current = Date.now();
        setState((current) => (current.status === 'signedIn' ? { status: 'signedIn', user } : current));
      } catch {
        // 401 : la session est fermée par le client API. Réseau : on garde le profil connu,
        // chaque action reste de toute façon contrôlée par le backend.
      } finally {
        refreshing.current = false;
      }
    },
    [closeSession, signedIn],
  );

  // Retour au premier plan : échéance, puis droits et périmètre à jour.
  useEffect(() => {
    if (!signedIn) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshProfile();
    });
    return () => subscription.remove();
  }, [refreshProfile, signedIn]);

  // Un 403 signale peut-être des droits retirés : on recharge le profil, au plus une fois par minute.
  useEffect(() => onForbidden(() => void refreshProfile()), [refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, retry, refreshProfile }),
    [state, signIn, signOut, retry, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé sous <AuthProvider>.');
  return value;
}

/** Profil courant, ou null hors session. */
export function useCurrentUser(): ApiUser | null {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.user : null;
}
