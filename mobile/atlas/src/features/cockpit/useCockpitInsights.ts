import { useQueries, useQuery } from '@tanstack/react-query';

import { api } from '@/api';
import { fetchAlerts, type Alert } from '@/api/domains/alerts';
import { fetchBoard, presenceRate, type BoardKpi } from '@/api/domains/attendance';
import { fetchDrhDashboard, type DrhDashboard } from '@/api/domains/drh';
import { fetchIncidents, type Incident } from '@/api/domains/incidents';
import { fetchSitesPage } from '@/api/domains/ops';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { useScope } from '@/scope/ScopeProvider';
import { localDate } from '@/utils/format';

import { access } from '../access';

export type PresenceDay = { date: string; rate: number | null; expected: number | null; present: number | null };

export type CockpitInsights = {
  /** Présence des sept derniers jours, du plus ancien au plus récent ; null sans droit de pointage. */
  week: PresenceDay[] | null;
  /** Indicateurs de pointage du jour ; null tant qu'ils ne sont pas connus. */
  today: BoardKpi | null;
  /** Nombre de sites actifs du périmètre ; null sans droit ou tant qu'il n'est pas connu. */
  sitesTotal: number | null;
  drh: DrhDashboard | null;
  /** Alertes ouvertes les plus récentes ; null sans droit. */
  alerts: Alert[] | null;
  /** Incidents du périmètre, du plus récent au plus ancien ; null sans droit. */
  incidents: Incident[] | null;
  incidentsOpen: number | null;
  isRefreshing: boolean;
  refresh: () => void;
};

const WEEK_DAYS = 7;
const FIVE_MINUTES = 5 * 60_000;

/** Un incident reste « ouvert » tant que son statut ne dit pas qu'il est clos ou résolu. */
export function isIncidentOpen(incident: Pick<Incident, 'status'>): boolean {
  const status = incident.status.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
  return !/clos|clot|ferm|resol|termin|trait/.test(status);
}

function byRecency(a: Incident, b: Incident): number {
  return `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) || b.id - a.id;
}

/**
 * Données de pilotage de l'accueil, en plus des indicateurs du cockpit. Chaque bloc n'est
 * interrogé que si le profil a le droit de le voir, et reste `null` tant que le backend
 * n'a pas répondu : l'écran masque alors le bloc, il n'affiche jamais de valeur supposée.
 */
export function useCockpitInsights(): CockpitInsights {
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const params = scopeParams(scope);
  const scoped = (...name: (string | number)[]) => queryKeys.scoped(scope.society, scope.site?.id ?? null, 'insights', ...name);

  const showAttendance = ready && access.attendance(user);
  const showSites = ready && access.sites(user);
  const showDrh = ready && access.employees(user);
  const showAlerts = ready && access.alerts(user);
  const showIncidents = ready && access.incidents(user);

  const days = Array.from({ length: WEEK_DAYS }, (_, index) => localDate(index - (WEEK_DAYS - 1)));
  const week = useQueries({
    queries: days.map((day) => ({
      queryKey: scoped('presence', day),
      queryFn: () => fetchBoard(api, { ...params, presence_date: day, page_size: 1 }),
      enabled: showAttendance,
      staleTime: FIVE_MINUTES,
    })),
  });
  const sites = useQuery({
    queryKey: queryKeys.scoped(scope.society, null, 'insights', 'sites'),
    queryFn: () => fetchSitesPage(api, { society: scope.society ?? undefined, page_size: 1 }),
    enabled: showSites,
    staleTime: FIVE_MINUTES,
  });
  const drh = useQuery({
    queryKey: queryKeys.scoped(scope.society, null, 'insights', 'drh'),
    queryFn: () => fetchDrhDashboard(api, params.society),
    enabled: showDrh,
    staleTime: FIVE_MINUTES,
  });
  const alerts = useQuery({
    queryKey: scoped('alerts'),
    queryFn: () => fetchAlerts(api, { ...params, status: 'open', page_size: 3 }),
    enabled: showAlerts,
  });
  const incidents = useQuery({ queryKey: scoped('incidents'), queryFn: () => fetchIncidents(api), enabled: showIncidents });

  const sortedIncidents = incidents.data ? [...incidents.data].sort(byRecency) : null;
  const todayBoard = week[WEEK_DAYS - 1]?.data ?? null;
  const all = [...week, sites, drh, alerts, incidents];

  return {
    week: showAttendance
      ? days.map((date, index) => {
          const kpi = week[index]?.data?.kpi ?? null;
          return { date, rate: presenceRate(kpi), expected: kpi?.expected ?? null, present: kpi?.present ?? null };
        })
      : null,
    today: todayBoard?.kpi ?? null,
    sitesTotal: showSites && sites.data ? sites.data.total : null,
    drh: showDrh ? (drh.data ?? null) : null,
    alerts: showAlerts ? (alerts.data?.items ?? null) : null,
    incidents: showIncidents ? sortedIncidents : null,
    incidentsOpen: sortedIncidents ? sortedIncidents.filter(isIncidentOpen).length : null,
    isRefreshing: all.some((query) => query.isRefetching),
    refresh: () => {
      void Promise.all(all.filter((query) => query.fetchStatus !== 'idle' || query.isFetched).map((query) => query.refetch()));
    },
  };
}
