import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { api } from '@/api';
import { createIncident, type NewIncident } from '@/api/domains/incidents';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { isFeatureEnabled } from '@/config/env';

import { loadQueue, queueIncident, QUEUE_LIMIT, saveQueue, type QueuedIncident } from './queue';
import { syncQueue } from './sync';

const RETRY_INTERVAL_MS = 60_000;

type OfflineContextValue = {
  /** Fonction activée pour ce build ET utilisateur connecté. */
  enabled: boolean;
  items: readonly QueuedIncident[];
  /**
   * Met une déclaration en attente ; false si la file est pleine. `clientId` reprend
   * l'identifiant de la tentative directe : si elle a abouti malgré tout, pas de doublon.
   */
  enqueueIncident: (payload: NewIncident, clientId?: string) => Promise<boolean>;
  discard: (id: string) => Promise<void>;
  /** Remet en attente une saisie refusée puis relance l'envoi. */
  retry: (id?: string) => Promise<void>;
};

const DISABLED: OfflineContextValue = {
  enabled: false,
  items: [],
  enqueueIncident: async () => false,
  discard: async () => undefined,
  retry: async () => undefined,
};

const OfflineContext = createContext<OfflineContextValue>(DISABLED);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const enabled = isFeatureEnabled('offline') && userId !== null;
  // La file affichée est toujours celle du compte courant : rien ne subsiste d'un compte précédent.
  const [stored, setStored] = useState<{ userId: number | null; items: QueuedIncident[] }>({ userId: null, items: [] });
  const items = useMemo(() => (stored.userId === userId ? stored.items : []), [stored, userId]);
  const latest = useRef<QueuedIncident[]>([]);
  const running = useRef(false);

  const commit = useCallback(
    async (next: QueuedIncident[]) => {
      latest.current = next;
      setStored({ userId, items: next });
      if (userId !== null) await saveQueue(userId, next).catch(() => undefined);
    },
    [userId],
  );

  const sync = useCallback(async () => {
    if (!enabled || running.current || !latest.current.some((item) => item.state === 'pending')) return;
    running.current = true;
    try {
      const { synced } = await syncQueue(
        latest.current,
        // L'identifiant client rend l'envoi rejouable : un doublon côté serveur est impossible.
        (item) => createIncident(api, item.payload, item.id),
        commit,
      );
      if (synced > 0) await invalidateScopedQueries(queryClient);
    } finally {
      running.current = false;
    }
  }, [commit, enabled, queryClient]);

  useEffect(() => {
    latest.current = [];
    if (!enabled || userId === null) return undefined;
    let active = true;
    void loadQueue(userId).then((loaded) => {
      if (!active) return;
      latest.current = loaded;
      setStored({ userId, items: loaded });
      void sync();
    });
    return () => {
      active = false;
    };
  }, [enabled, sync, userId]);

  const waiting = items.some((item) => item.state === 'pending');
  useEffect(() => {
    if (!enabled || !waiting) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sync();
    });
    const timer = setInterval(() => void sync(), RETRY_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [enabled, sync, waiting]);

  const value = useMemo<OfflineContextValue>(() => {
    if (!enabled) return DISABLED;
    return {
      enabled,
      items,
      enqueueIncident: async (payload, clientId) => {
        if (latest.current.length >= QUEUE_LIMIT) return false;
        if (clientId && latest.current.some((item) => item.id === clientId)) return true;
        await commit([...latest.current, queueIncident(payload, clientId)]);
        return true;
      },
      discard: (id) => commit(latest.current.filter((item) => item.id !== id || item.state === 'syncing')),
      retry: async (id) => {
        await commit(
          latest.current.map((item) =>
            (id === undefined || item.id === id) && (item.state === 'failed' || item.state === 'conflict')
              ? { ...item, state: 'pending' as const, error: null }
              : item,
          ),
        );
        await sync();
      },
    };
  }, [commit, enabled, items, sync]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}
