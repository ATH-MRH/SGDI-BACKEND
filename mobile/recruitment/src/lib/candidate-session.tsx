import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiError, request } from './api';
import { Account } from './emploi';

export type CandidateIdentity = {first_name: string; last_name: string; phone: string};
export type PendingCode = {identity: CandidateIdentity; challengeId: string; expiresAt: number; resendAt: number};
/** Accès court délivré par la validation SMS (deux heures, en mémoire uniquement). */
export type CandidateAccess = {identity: CandidateIdentity; token: string; expiresAt: number};
/** Session de l'espace candidat, conservée dans le stockage sécurisé du téléphone. */
export type CandidateSession = {identity: CandidateIdentity; token: string; expiresAt: number};
type CallOptions = { body?: unknown; method?: 'POST' | 'PUT' | 'DELETE'; signal?: AbortSignal };
type State = {
  ready: boolean; pending: PendingCode | null; access: CandidateAccess | null; session: CandidateSession | null; expired: boolean;
  setPending: (value: PendingCode | null) => void; setAccess: (value: CandidateAccess | null) => void;
  openSession: (access: CandidateAccess) => Promise<void>; signOut: () => Promise<void>; forget: () => Promise<void>;
  /** Appel authentifié à l'espace candidat ; une session refusée (401) est fermée localement. */
  call: <T>(path: string, options?: CallOptions) => Promise<T>;
};

const KEY = 'iron.emploi.candidate.session';
const Context = createContext<State | null>(null);

// Sur iOS et Android : stockage sécurisé du téléphone. Dans l'aperçu web (revue d'interface
// uniquement), la session ne vit que le temps de l'onglet du navigateur.
const secure = Platform.OS === 'ios' || Platform.OS === 'android';
async function load(): Promise<CandidateSession | null> {
  try {
    const text = secure ? await SecureStore.getItemAsync(KEY) : globalThis.sessionStorage?.getItem(KEY);
    const saved = JSON.parse(text || 'null') as CandidateSession | null;
    return saved && typeof saved.token === 'string' && saved.expiresAt > Date.now() ? saved : null;
  } catch { return null; }
}
async function save(value: CandidateSession | null) {
  try {
    if (!secure) { if (value) globalThis.sessionStorage?.setItem(KEY, JSON.stringify(value)); else globalThis.sessionStorage?.removeItem(KEY); }
    else if (value) await SecureStore.setItemAsync(KEY, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    else await SecureStore.deleteItemAsync(KEY);
  } catch { /* stockage refusé : la session reste valable jusqu'à la fermeture de l'application */ }
}

export function CandidateSessionProvider({ children }: {children: ReactNode}) {
  const [pending, setPending] = useState<PendingCode | null>(null), [access, setAccess] = useState<CandidateAccess | null>(null);
  const [session, setSession] = useState<CandidateSession | null>(null), [ready, setReady] = useState(false), [expired, setExpired] = useState(false);
  // Copie lue par les appels réseau, mise à jour en même temps que l'état.
  const current = useRef<CandidateSession | null>(null);
  const store = useCallback((value: CandidateSession | null) => { current.current = value; setSession(value); }, []);

  useEffect(() => { let active = true; load().then(saved => { if (active) { store(saved); setReady(true); } }); return () => { active = false; }; }, [store]);

  const forget = useCallback(async () => { store(null); setAccess(null); setPending(null); await save(null); }, [store]);

  const openSession = useCallback(async (verified: CandidateAccess) => {
    const result = await request<{session_token: string; expires_in: number; account: Account}>('/public/emploi/session', { token: verified.token, method: 'POST' });
    const opened = { token: result.session_token, expiresAt: Date.now() + result.expires_in * 1000,
      identity: { first_name: result.account.first_name, last_name: result.account.last_name, phone: result.account.phone } };
    store(opened); setExpired(false); await save(opened);
  }, [store]);

  const signOut = useCallback(async () => {
    const token = current.current?.token;
    await forget();
    // La fermeture côté serveur est tentée sans bloquer : le téléphone a déjà oublié la session.
    if (token) request('/public/emploi/session', { token, method: 'DELETE' }).catch(() => {});
  }, [forget]);

  const call = useCallback(async <T,>(path: string, options: CallOptions = {}): Promise<T> => {
    const active = current.current;
    if (!active || active.expiresAt <= Date.now()) { await forget(); setExpired(true); throw new ApiError(401, 'Votre session a expiré. Identifiez-vous à nouveau par SMS.'); }
    try { return await request<T>(path, { ...options, token: active.token }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { await forget(); setExpired(true); }
      throw error;
    }
  }, [forget]);

  const value = useMemo(() => ({ ready, pending, access, session, expired, setPending, setAccess, openSession, signOut, forget, call }),
    [ready, pending, access, session, expired, openSession, signOut, forget, call]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCandidateSession() { const value = useContext(Context); if (!value) throw new Error('CandidateSessionProvider absent'); return value; }
