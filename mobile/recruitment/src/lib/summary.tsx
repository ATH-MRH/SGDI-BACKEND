import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useCandidateSession } from './candidate-session';
import { Summary } from './emploi';
import { useServer } from './server';

// Compteurs des pastilles (messages non lus, notifications, entretiens à venir), lus sur le serveur.
const EMPTY: Summary = { unread_messages: 0, unread_notifications: 0, upcoming_interviews: 0 };
const Context = createContext<{ summary: Summary; refresh: () => void }>({ summary: EMPTY, refresh: () => {} });

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { session, call } = useCandidateSession();
  const { mode } = useServer();
  const [loaded, setLoaded] = useState<Summary>(EMPTY), [tick, setTick] = useState(0);
  const active = !!session && mode === 'emploi';
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    call<Summary>('/public/emploi/summary', { signal: controller.signal }).then(setLoaded).catch(() => {});
    // Relecture périodique tant que l'application est ouverte : il n'y a pas de push dans cette version.
    const timer = setInterval(() => setTick(value => value + 1), 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, call, tick]);
  const refresh = useCallback(() => setTick(value => value + 1), []);
  const value = useMemo(() => ({ summary: active ? loaded : EMPTY, refresh }), [active, loaded, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useSummary = () => useContext(Context);
