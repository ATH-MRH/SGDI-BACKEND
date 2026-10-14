import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError } from './api';
import { EmploiConfig, fetchConfig } from './emploi';
import { LIVE_REFRESH_MS } from './live-refresh';

// Le serveur de recrutement peut ne pas encore proposer les annonces (API IRON Emploi absente).
// Dans ce cas l'application reste utilisable : candidature spontanée par le parcours déjà en service.
export type ServerMode = 'loading' | 'emploi' | 'legacy' | 'offline';
type State = { mode: ServerMode; config: EmploiConfig | null; retry: () => void };
const Context = createContext<State>({ mode: 'loading', config: null, retry: () => {} });

export function ServerProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ServerMode>('loading'), [config, setConfig] = useState<EmploiConfig | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(result => { setConfig(result); setMode('emploi'); })
      .catch(error => { if (!controller.signal.aborted) setMode(error instanceof ApiError && error.status === 404 ? 'legacy' : 'offline'); });
    return () => controller.abort();
  }, [attempt]);
  // Annonces pas encore ouvertes ou réseau absent : nouvel essai discret au retour dans l'application et toutes
  // les minutes, pour passer en mode annonces dès leur mise en service, sans redémarrer l'application.
  useEffect(() => {
    if (mode !== 'legacy' && mode !== 'offline') return;
    const again = () => setAttempt(value => value + 1);
    const timer = setInterval(() => { if (AppState.currentState === 'active') again(); }, LIVE_REFRESH_MS);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') again(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [mode]);
  const retry = useCallback(() => { setMode('loading'); setAttempt(value => value + 1); }, []);
  return <Context.Provider value={{ mode, config, retry }}>{children}</Context.Provider>;
}
export const useServer = () => useContext(Context);
