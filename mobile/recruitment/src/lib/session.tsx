import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ApiError, request } from './api';
const KEY = 'iron.recruitment.staff.token';
type User = { username: string; full_name: string; recruitment_access?: boolean };
type Session = { token: string | null; user: User | null; ready: boolean; login: (username: string, password: string) => Promise<void>; logout: () => Promise<void> };
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null), [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false);
  useEffect(() => { let active = true; (async () => {
    try { const saved = await SecureStore.getItemAsync(KEY); if (saved) { const profile = await request<User>('/auth/me', { token: saved }); if (active && profile.recruitment_access) { setToken(saved); setUser(profile); } else if (!profile.recruitment_access) await SecureStore.deleteItemAsync(KEY); } }
    catch (error) { if (error instanceof ApiError && (error.status === 401 || error.status === 403)) await SecureStore.deleteItemAsync(KEY); }
    finally { if (active) setReady(true); }
  })(); return () => { active = false; }; }, []);
  const logout = useCallback(async () => { setToken(null); setUser(null); await SecureStore.deleteItemAsync(KEY); }, []);
  const login = async (username: string, password: string) => {
    const result = await request<{access_token: string}>('/auth/login', { body: { username: username.trim(), password } });
    const profile = await request<User>('/auth/me', { token: result.access_token });
    if (!profile.recruitment_access) throw new Error('Votre compte ne dispose pas de l’accès au recrutement.');
    await SecureStore.setItemAsync(KEY, result.access_token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    setToken(result.access_token); setUser(profile);
  };
  return <Context.Provider value={{token, user, ready, login, logout}}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error('SessionProvider absent'); return value; }
