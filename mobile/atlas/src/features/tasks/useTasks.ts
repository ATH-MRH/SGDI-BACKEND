import { useQuery } from '@tanstack/react-query';

import { api } from '@/api';
import { fetchAlerts } from '@/api/domains/alerts';
import { fetchLeaves } from '@/api/domains/drh';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { useScope } from '@/scope/ScopeProvider';

import { access } from '../access';
import { buildTasks } from './model';

/** Tâches en attente : seules les sources que le profil peut traiter sont interrogées. */
export function useTasks() {
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const withAlerts = ready && access.alerts(user) && access.actOnAlerts(user);
  const withLeaves = ready && access.leaves(user) && access.decideLeaves(user);
  const params = scopeParams(scope);

  const alerts = useQuery({
    queryKey: queryKeys.scoped(scope.society, scope.site?.id ?? null, 'tasks', 'alerts'),
    queryFn: () => fetchAlerts(api, { ...params, status: 'open', page_size: 50 }),
    enabled: withAlerts,
  });
  const leaves = useQuery({
    queryKey: queryKeys.scoped(null, null, 'tasks', 'leaves'),
    queryFn: () => fetchLeaves(api, { status: 'instance' }),
    enabled: withLeaves,
  });

  const sources = [withAlerts ? alerts : null, withLeaves ? leaves : null].filter((query) => query !== null);
  return {
    hasSource: sources.length > 0,
    isLoading: sources.some((query) => query.isPending),
    error: sources.find((query) => query.error)?.error ?? null,
    tasks: buildTasks({ alerts: alerts.data?.items, leaves: leaves.data }),
    refresh: () => {
      void Promise.all(sources.map((query) => query.refetch()));
    },
    isRefreshing: sources.some((query) => query.isRefetching),
  };
}
