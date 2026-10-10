import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './api';

type Settled = { run: string; error: string; status: number };

/**
 * Charge une ressource : état de chargement, erreur réseau, actualisation, abandon des requêtes obsolètes.
 * `key` identifie la ressource (par exemple `offer:12`) : la changer relance le chargement.
 */
export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, key: string, enabled = true) {
  const [{ attempt, pulled }, setRun] = useState({ attempt: 0, pulled: -1 });
  const [settled, setSettled] = useState<Settled | null>(null), [data, setData] = useState<T | null>(null);
  // L'état « en cours » se déduit : la dernière demande aboutie n'est pas celle affichée.
  const run = `${key}|${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loader(controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setSettled({ run, error: '', status: 0 }); } })
      .catch(reason => { if (!controller.signal.aborted) setSettled({ run, error: errorMessage(reason), status: typeof reason?.status === 'number' ? reason.status : 0 }); });
    return () => controller.abort();
    // `loader` est relu à chaque demande ; seule la clé décide d'une nouvelle demande.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, enabled]);
  const reload = useCallback(() => setRun(state => ({ attempt: state.attempt + 1, pulled: state.pulled })), []);
  const refresh = useCallback(() => setRun(state => ({ attempt: state.attempt + 1, pulled: state.attempt + 1 })), []);
  const pending = enabled && settled?.run !== run;
  const failed = !pending && !!settled?.error;
  return { data: failed || settled?.run.split('|')[0] !== key ? null : data, error: failed ? settled.error : '', status: failed ? settled.status : 0,
    loading: pending, refreshing: pending && pulled === attempt, reload, refresh, setData };
}
