import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from '@/api/errors';
import { readTokenClaims } from '@/auth/token';
import { isFeatureEnabled } from '@/config/env';

import {
  EMPLOYEE_TOKEN_USE,
  employeeApi,
  employeeLogin,
  fetchSelfProfile,
  onEmployeeSessionRejected,
  setEmployeeSession,
  type EmployeeProfile,
  type EmployeeSession,
} from './api';

export const EMPLOYEE_SESSION_KEY = 'atlas.employee.v1';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type EmployeeState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; employee: EmployeeProfile };

type EmployeeContextValue = {
  /** Espace employé inclus dans ce build. */
  available: boolean;
  state: EmployeeState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const DISABLED: EmployeeContextValue = {
  available: false,
  state: { status: 'signedOut' },
  signIn: async () => {
    throw new ApiError({ kind: 'config' });
  },
  signOut: async () => undefined,
};

const EmployeeContext = createContext<EmployeeContextValue>(DISABLED);

/** Jeton stocké, s'il est bien de la famille employé et non expiré ; sinon il est effacé. */
async function loadStored(): Promise<EmployeeSession | null> {
  try {
    const parsed: unknown = JSON.parse((await SecureStore.getItemAsync(EMPLOYEE_SESSION_KEY, OPTIONS)) ?? 'null');
    const token = (parsed as { token?: unknown } | null)?.token;
    const claims = typeof token === 'string' ? readTokenClaims(token) : null;
    if (typeof token === 'string' && claims?.tokenUse === EMPLOYEE_TOKEN_USE && claims.expiresAt && claims.expiresAt > Date.now()) {
      return { token, expiresAt: claims.expiresAt };
    }
  } catch {
    // illisible : traité comme absent
  }
  await SecureStore.deleteItemAsync(EMPLOYEE_SESSION_KEY, OPTIONS).catch(() => undefined);
  return null;
}

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const available = isFeatureEnabled('employeePortal');
  const queryClient = useQueryClient();
  const [state, setState] = useState<EmployeeState>(available ? { status: 'loading' } : { status: 'signedOut' });

  const close = useCallback(async () => {
    setEmployeeSession(null);
    queryClient.clear();
    setState({ status: 'signedOut' });
    await SecureStore.deleteItemAsync(EMPLOYEE_SESSION_KEY, OPTIONS).catch(() => undefined);
  }, [queryClient]);

  useEffect(() => {
    if (!available) return undefined;
    let active = true;
    void loadStored().then(async (session) => {
      if (!session) return active && setState({ status: 'signedOut' });
      setEmployeeSession(session);
      try {
        const employee = await fetchSelfProfile(employeeApi);
        if (active) setState({ status: 'signedIn', employee });
      } catch (error) {
        // Refus du backend : session effacée. Panne réseau : le jeton reste pour le prochain lancement.
        const refused = error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'forbidden');
        setEmployeeSession(null);
        if (refused) await SecureStore.deleteItemAsync(EMPLOYEE_SESSION_KEY, OPTIONS).catch(() => undefined);
        if (active) setState({ status: 'signedOut' });
      }
      return undefined;
    });
    return () => {
      active = false;
    };
  }, [available]);

  useEffect(() => (available ? onEmployeeSessionRejected(() => void close()) : undefined), [available, close]);

  const value = useMemo<EmployeeContextValue>(() => {
    if (!available) return DISABLED;
    return {
      available,
      state,
      signIn: async (username, password) => {
        // Le mot de passe ne sert qu'à cet appel ; seul le jeton est conservé.
        const { session, employee } = await employeeLogin(employeeApi, username, password);
        setEmployeeSession(session);
        await SecureStore.setItemAsync(EMPLOYEE_SESSION_KEY, JSON.stringify({ token: session.token }), OPTIONS);
        setState({ status: 'signedIn', employee });
      },
      signOut: close,
    };
  }, [available, close, state]);

  return <EmployeeContext.Provider value={value}>{children}</EmployeeContext.Provider>;
}

export function useEmployee(): EmployeeContextValue {
  return useContext(EmployeeContext);
}
