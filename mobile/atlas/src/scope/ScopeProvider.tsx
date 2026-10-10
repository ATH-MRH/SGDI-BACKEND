import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api } from '@/api';
import { invalidateScopedQueries, queryKeys } from '@/api/queryKeys';
import { fetchScopeSites } from '@/api/scope';
import type { ScopeSite } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthProvider';
import { authorizedSiteIds } from '@/auth/permissions';

import { buildScope, EMPTY_SCOPE, sameSelection, selectionOf, type CurrentScope, type ScopeSelection } from './model';
import { loadScopeSelection, saveScopeSelection } from './storage';

type ScopeContextValue = {
  scope: CurrentScope;
  /** false tant que la sélection mémorisée et la liste des sites ne sont pas connues. */
  ready: boolean;
  /** Applique un choix ; il est revalidé contre le périmètre avant d'être retenu. */
  setScope: (selection: ScopeSelection) => Promise<void>;
  /** Contexte qui résulterait d'un choix, sans l'appliquer (pour l'écran de sélection). */
  preview: (selection: ScopeSelection) => CurrentScope;
};

const ScopeContext = createContext<ScopeContextValue>({
  scope: EMPTY_SCOPE,
  ready: false,
  setScope: async () => undefined,
  preview: () => EMPTY_SCOPE,
});

type Loaded = { userId: number; selection: ScopeSelection | null };

export function ScopeProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (userId === null) return undefined;
    let active = true;
    void loadScopeSelection(userId).then((selection) => {
      if (active) setLoaded({ userId, selection });
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const sitesQuery = useQuery({
    queryKey: queryKeys.scopeSites(userId ?? 0),
    queryFn: () => fetchScopeSites(api, user!),
    enabled: user !== null,
    staleTime: 5 * 60_000,
  });

  // Liste de sites indisponible (réseau, module) : on ne connaît que les identifiants de /me.
  const fallbackSites = useMemo<ScopeSite[]>(
    () => authorizedSiteIds(user).map((id) => ({ id, name: null, society: null })),
    [user],
  );
  const knownSites = sitesQuery.data ?? fallbackSites;
  const saved = loaded && loaded.userId === userId ? loaded.selection : null;
  const selectionReady = loaded !== null && loaded.userId === userId;

  const scope = useMemo(() => buildScope(user, knownSites, saved), [user, knownSites, saved]);
  const ready = user !== null && selectionReady && !sitesQuery.isPending;

  // Une sélection mémorisée devenue invalide (droits retirés) est remplacée sur le disque.
  // L'état affiché, lui, est toujours recalculé : il ne peut pas rester sur un ancien périmètre.
  const persisted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || userId === null) return;
    const valid = selectionOf(scope);
    const signature = JSON.stringify([userId, valid]);
    if (!sameSelection(valid, saved) && persisted.current !== signature) {
      persisted.current = signature;
      void saveScopeSelection(userId, valid);
    }
  }, [ready, saved, scope, userId]);

  const preview = useCallback(
    (selection: ScopeSelection) => buildScope(user, knownSites, selection),
    [knownSites, user],
  );

  const setScope = useCallback(
    async (selection: ScopeSelection) => {
      if (userId === null) return;
      const next = selectionOf(buildScope(user, knownSites, selection));
      if (sameSelection(next, saved)) return;
      persisted.current = JSON.stringify([userId, next]);
      setLoaded({ userId, selection: next });
      await saveScopeSelection(userId, next);
      // Seules les données dépendantes du contexte sont rechargées.
      await invalidateScopedQueries(queryClient);
    },
    [knownSites, queryClient, saved, user, userId],
  );

  const value = useMemo(
    () => ({ scope: user ? scope : EMPTY_SCOPE, ready, setScope, preview }),
    [preview, ready, scope, setScope, user],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeContextValue {
  return useContext(ScopeContext);
}
