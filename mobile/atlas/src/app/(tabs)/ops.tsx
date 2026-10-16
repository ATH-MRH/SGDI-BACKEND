import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchAbandonEvents, fetchBoard, presenceRate } from '@/api/domains/attendance';
import { fetchIncidents } from '@/api/domains/incidents';
import { fetchSitesPage } from '@/api/domains/ops';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import {
  ActionTile,
  AtlasHeader,
  ChartCard,
  HeaderAction,
  IncidentRow,
  KpiCard,
  KpiGrid,
  RingGauge,
  Screen,
  SectionHeader,
  SiteRow,
  StatLine,
} from '@/components/ui';
import { access } from '@/features/access';
import { rateTone, share } from '@/features/cockpit/presentation';
import { isIncidentOpen } from '@/features/cockpit/useCockpitInsights';
import { incidentSeverity } from '@/features/status';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

const SITES_SHOWN = 5;

/** Tableau de bord OPS : la situation du terrain sur le périmètre courant, calculée par le backend. */
export default function OpsDashboardScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const allowed = access.sites(user);
  const params = scopeParams(scope);
  const scoped = (name: string) => queryKeys.scoped(scope.society, scope.site?.id ?? null, 'ops-dashboard', name);
  const go = (route: string) => router.push(route as never);

  const withAttendance = allowed && ready && access.attendance(user);
  const board = useQuery({ queryKey: scoped('board'), queryFn: () => fetchBoard(api, { ...params, page_size: 1 }), enabled: withAttendance });
  const sites = useQuery({
    queryKey: queryKeys.scoped(scope.society, null, 'ops-dashboard', 'sites'),
    queryFn: () => fetchSitesPage(api, { society: scope.society ?? undefined, page_size: SITES_SHOWN }),
    enabled: allowed && ready,
  });
  const incidents = useQuery({ queryKey: scoped('incidents'), queryFn: () => fetchIncidents(api), enabled: allowed && ready && access.incidents(user) });
  const abandons = useQuery({
    queryKey: scoped('abandons'),
    queryFn: () => fetchAbandonEvents(api, { ...params, page_size: 1 }),
    enabled: allowed && ready && access.abandons(user),
  });
  const queries = [board, sites, incidents, abandons];

  const kpi = board.data?.kpi ?? null;
  const rate = presenceRate(kpi);
  const open = incidents.data?.filter(isIncidentOpen) ?? null;
  const bySeverity = (severity: string) => open?.filter((incident) => incident.severity === severity).length ?? 0;
  const recent = open ? [...open].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 3) : [];
  const state = (query: { isPending: boolean; error: unknown }) => (query.isPending ? 'loading' : query.error ? 'error' : 'ready');
  const unavailable = t('cockpit.unavailable');

  return (
    <Gate allowed={allowed}>
      <Screen
        testID="ops-dashboard"
        header={
          <>
            <AtlasHeader
              title={t('ops.title')}
              subtitle={t('ops.subtitle')}
              trailing={<HeaderAction testID="ops-refresh" icon="refresh-outline" label={t('common.refresh')} onPress={() => queries.forEach((query) => void query.refetch())} />}
            />
            <View style={styles.nav}>
              <Segmented
                testID="ops-nav"
                value="field"
                onChange={(value) => {
                  if (value !== 'field') go(value);
                }}
                options={[
                  { value: 'field', label: t('ops.nav.field') },
                  ...(access.attendance(user) ? [{ value: '/attendance', label: t('tabs.attendance') }] : []),
                  ...(access.incidents(user) ? [{ value: '/incidents', label: t('entry.incidents') }] : []),
                  { value: '/ops/sites', label: t('entry.sites') },
                ]}
              />
            </View>
          </>
        }
        refreshControl={
          <RefreshControl refreshing={queries.some((query) => query.isRefetching)} onRefresh={() => queries.forEach((query) => void query.refetch())} tintColor={colors.navy} />
        }>
        <SectionHeader title={t('ops.kpi.title')} hint={`${societyLabel(scope)} · ${currentSiteLabel(scope)}`} />
        <KpiGrid>
          <KpiCard
            variant="compact"
            testID="ops-kpi-sites"
            label={t('cockpit.sites')}
            value={sites.data?.total ?? null}
            icon="business-outline"
            state={state(sites)}
            unavailableLabel={unavailable}
            onPress={() => go('/ops/sites')}
          />
          {withAttendance ? <KpiCard variant="compact" testID="ops-kpi-expected" label={t('cockpit.expected')} value={kpi?.expected ?? null} icon="people-outline" state={state(board)} unavailableLabel={unavailable} onPress={() => go('/attendance')} /> : null}
          {withAttendance ? <KpiCard variant="compact" testID="ops-kpi-present" label={t('cockpit.present')} value={kpi?.present ?? null} tone="success" icon="checkmark-circle-outline" state={state(board)} unavailableLabel={unavailable} onPress={() => go('/attendance?status=present')} /> : null}
          {withAttendance ? <KpiCard variant="compact" testID="ops-kpi-absent" label={t('cockpit.absent')} value={kpi?.absent ?? null} tone="danger" icon="close-circle-outline" state={state(board)} unavailableLabel={unavailable} onPress={() => go('/attendance?status=absent')} /> : null}
          {withAttendance ? <KpiCard variant="compact" testID="ops-kpi-not-pointed" label={t('cockpit.notPointed')} value={kpi?.not_pointed ?? null} tone="warning" icon="help-circle-outline" state={state(board)} unavailableLabel={unavailable} onPress={() => go('/attendance?status=non_pointe')} /> : null}
          {withAttendance && kpi ? <KpiCard variant="compact" testID="ops-kpi-late" label={t('ops.late')} value={kpi.late} tone={kpi.late > 0 ? 'warning' : 'neutral'} icon="alarm-outline" /> : null}
          {access.incidents(user) ? (
            <KpiCard variant="compact" testID="ops-kpi-incidents" label={t('cockpit.incidentsOpen')} value={open?.length ?? null} tone={open && open.length > 0 ? 'warning' : 'neutral'} icon="warning-outline" state={state(incidents)} unavailableLabel={unavailable} onPress={() => go('/incidents')} />
          ) : null}
          {access.abandons(user) ? (
            <KpiCard variant="compact" testID="ops-kpi-abandons" label={t('cockpit.abandons')} value={abandons.data?.total ?? null} tone="danger" icon="exit-outline" state={state(abandons)} unavailableLabel={unavailable} onPress={() => go('/abandons')} />
          ) : null}
        </KpiGrid>

        {kpi ? (
          <ChartCard testID="ops-presence" title={t('home.presence.title')} hint={formatDate(board.data?.date)} actionLabel={t('common.seeAll')} onAction={() => go('/attendance')}>
            <View style={styles.presence}>
              <RingGauge ratio={rate} tone={rateTone(rate)} caption={t('cockpit.rate.short')} />
              <View style={styles.lines}>
                <StatLine label={t('cockpit.present')} value={`${kpi.present} / ${kpi.expected}`} ratio={rate} tone="success" />
                <StatLine label={t('ops.late')} value={String(kpi.late)} ratio={share(kpi.late, kpi.expected)} tone="warning" />
                <StatLine label={t('ops.onLeave')} value={String(kpi.conge + kpi.maladie)} ratio={share(kpi.conge + kpi.maladie, kpi.expected)} tone="info" />
              </View>
            </View>
          </ChartCard>
        ) : null}

        {sites.data && sites.data.items.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={t('ops.sites.title')} hint={t('ops.sites.hint', { shown: sites.data.items.length, total: sites.data.total })} actionLabel={t('common.seeAll')} onAction={() => go('/ops/sites')} />
            {sites.data.items.map((site) => (
              <SiteRow
                key={site.id}
                testID={`ops-site-${site.id}`}
                name={site.name}
                detail={[site.client, site.commune, site.wilaya].filter(Boolean).join(' · ') || null}
                society={site.society}
                staff={site.contractualStaff > 0 ? site.contractualStaff : null}
                staffLabel={t('sites.staff', { count: site.contractualStaff })}
                onPress={() => go(`/ops/sites/${site.id}`)}
              />
            ))}
          </View>
        ) : null}

        {open ? (
          <View style={styles.section}>
            <SectionHeader title={t('ops.incidents.title')} actionLabel={t('common.seeAll')} onAction={() => go('/incidents')} />
            <KpiGrid columns={3}>
              <KpiCard variant="compact" icon="alert-circle-outline" label={t('incidents.severity.critique')} value={bySeverity('critique')} tone="danger" />
              <KpiCard variant="compact" icon="warning-outline" label={t('incidents.severity.elevee')} value={bySeverity('elevee')} tone="warning" />
              <KpiCard variant="compact" icon="information-circle-outline" label={t('ops.incidents.other')} value={open.length - bySeverity('critique') - bySeverity('elevee')} />
            </KpiGrid>
            {recent.map((incident) => {
              const severity = incidentSeverity(incident.severity);
              return (
                <IncidentRow
                  key={incident.id}
                  tone={severity?.tone ?? 'neutral'}
                  title={incident.subject || t('entry.incidents')}
                  detail={[formatDate(incident.date), incident.time, incident.society].filter(Boolean).join(' · ')}
                  badge={<StatusBadge status={severity} fallback={incident.severity || incident.status} />}
                  onPress={() => go('/incidents')}
                />
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title={t('ops.actions.title')} />
          <View style={styles.grid}>
            {access.createIncident(user) ? <ActionTile testID="ops-action-incident" icon="add-circle-outline" tone="warning" label={t('incidents.new')} onPress={() => go('/incidents/new')} /> : null}
            {access.declareAbandon(user) && access.abandons(user) ? <ActionTile testID="ops-action-abandon" icon="exit-outline" tone="danger" label={t('abandons.declare')} onPress={() => go('/abandons/new')} /> : null}
            {access.attendance(user) ? <ActionTile testID="ops-action-attendance" icon="time-outline" label={t('entry.attendance')} onPress={() => go('/attendance')} /> : null}
            {access.brq(user) ? <ActionTile testID="ops-action-brq" icon="document-text-outline" label={t('entry.brq')} onPress={() => go('/brq')} /> : null}
            <ActionTile icon="walk-outline" label={t('modules.rounds')} caption={t('modules.unavailable')} />
          </View>
        </View>
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  nav: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  section: { gap: spacing.md },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  lines: { flex: 1, gap: spacing.md },
});
