import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api';
import { fetchAlertStats } from '@/api/domains/alerts';
import { fetchAbandonEvents, fetchBoard } from '@/api/domains/attendance';
import { fetchPendingLeavesCount } from '@/api/domains/drh';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import type { TranslationKey } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import type { Tone } from '@/theme/tokens';

import { access } from '../access';

export type CockpitCard = {
  key: string;
  label: TranslationKey;
  /** null tant que la valeur n'est pas connue (chargement ou erreur) : jamais de chiffre inventé. */
  value: number | null;
  tone: Tone;
  route: string;
  state: 'loading' | 'ready' | 'error';
};

type Source<T> = UseQueryResult<T> | null;

function stateOf(source: Source<unknown>): CockpitCard['state'] {
  if (!source || source.isPending) return 'loading';
  return source.error ? 'error' : 'ready';
}

/**
 * Indicateurs du cockpit. Chaque carte n'existe que si le profil a le droit de
 * voir la donnée, et chaque valeur vient d'un calcul du backend sur le
 * périmètre société/site courant.
 */
export function useCockpit() {
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const params = scopeParams(scope);
  const scoped = (name: string) => queryKeys.scoped(scope.society, scope.site?.id ?? null, 'cockpit', name);

  const showAttendance = access.attendance(user);
  const showAbandons = access.abandons(user);
  const showAlerts = access.alerts(user);
  const showLeaves = access.employees(user);

  const board = useQuery({
    queryKey: scoped('board'),
    queryFn: () => fetchBoard(api, { ...params, page_size: 1 }),
    enabled: ready && showAttendance,
  });
  const abandons = useQuery({
    queryKey: scoped('abandons'),
    queryFn: () => fetchAbandonEvents(api, { ...params, page_size: 1 }),
    enabled: ready && showAbandons,
  });
  const alerts = useQuery({ queryKey: scoped('alerts'), queryFn: () => fetchAlertStats(api), enabled: ready && showAlerts });
  const leaves = useQuery({
    queryKey: scoped('leaves'),
    queryFn: () => fetchPendingLeavesCount(api, params.society),
    enabled: ready && showLeaves,
  });

  const cards: CockpitCard[] = [];
  if (showAttendance) {
    const kpi = board.data?.kpi;
    const state = stateOf(board);
    cards.push(
      { key: 'expected', label: 'cockpit.expected', value: kpi?.expected ?? null, tone: 'neutral', route: '/attendance', state },
      { key: 'present', label: 'cockpit.present', value: kpi?.present ?? null, tone: 'success', route: '/attendance?status=present', state },
      { key: 'absent', label: 'cockpit.absent', value: kpi?.absent ?? null, tone: 'danger', route: '/attendance?status=absent', state },
      { key: 'notPointed', label: 'cockpit.notPointed', value: kpi?.not_pointed ?? null, tone: 'warning', route: '/attendance?status=non_pointe', state },
    );
  }
  if (showAbandons) {
    cards.push({ key: 'abandons', label: 'cockpit.abandons', value: abandons.data?.total ?? null, tone: 'danger', route: '/abandons', state: stateOf(abandons) });
  }
  if (showAlerts) {
    const state = stateOf(alerts);
    cards.push(
      { key: 'alertsOpen', label: 'cockpit.alertsOpen', value: alerts.data?.totalOpen ?? null, tone: 'warning', route: '/alerts', state },
      { key: 'alertsCritical', label: 'cockpit.alertsCritical', value: alerts.data?.critical ?? null, tone: 'danger', route: '/alerts', state },
    );
  }
  if (showLeaves) {
    cards.push({ key: 'leaves', label: 'cockpit.leavesPending', value: leaves.data ?? null, tone: 'info', route: '/drh/leaves', state: stateOf(leaves) });
  }

  const sources = [showAttendance ? board : null, showAbandons ? abandons : null, showAlerts ? alerts : null, showLeaves ? leaves : null].filter(
    (query) => query !== null,
  );
  return {
    cards,
    date: board.data?.date ?? null,
    isRefreshing: sources.some((query) => query.isRefetching),
    refresh: () => {
      void Promise.all(sources.map((query) => query.refetch()));
    },
  };
}
