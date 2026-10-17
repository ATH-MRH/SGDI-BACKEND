import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useCandidateSession } from './candidate-session';
import { Summary } from './emploi';
import { useServer } from './server';

// Compteurs des pastilles (messages non lus, notifications, entretiens à venir), lus sur le serveur.
const EMPTY: Summary = { unread_messages: 0, unread_notifications: 0, upcoming_interviews: 0 };
const Context = createContext<{ summary: Summary; refresh: () => void }>({ summary: EMPTY, refresh: () => {} });

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { session, call } = useCandidateSession();
  const { mode } = useServer();
  const [loaded, setLoaded] = useState<{ token: string; value: Summary } | null>(null), [tick, setTick] = useState(0);
  const sessionToken = session?.token;
  const active = !!sessionToken && mode === 'emploi';
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    call<Summary>('/public/emploi/summary', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setLoaded({ token: sessionToken!, value }); }).catch(() => {});
    // Relecture périodique tant que l'application est ouverte : le push, quand il est actif, ne fait qu'accélérer cette relecture.
    const timer = setInterval(() => setTick(value => value + 1), 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, call, tick, sessionToken]);
  const refresh = useCallback(() => setTick(value => value + 1), []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => listener.remove();
  }, [refresh]);
  const value = useMemo(() => ({ summary: active && loaded?.token === sessionToken ? loaded!.value : EMPTY, refresh }), [active, loaded, sessionToken, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useSummary = () => useContext(Context);
