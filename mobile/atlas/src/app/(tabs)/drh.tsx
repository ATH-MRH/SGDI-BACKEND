import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchDrhDashboard, fetchLeaves } from '@/api/domains/drh';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import {
  ActionTile,
  AtlasHeader,
  ChartCard,
  Distribution,
  EmployeeRow,
  ErrorState,
  HeaderAction,
  KpiCard,
  ListItem,
  Loader,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { access } from '@/features/access';
import { leaveStatus } from '@/features/status';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

/** Libellé d'un statut renvoyé tel quel par le backend : première lettre en capitale, rien d'interprété. */
export function rawStatusLabel(status: string): string {
  const text = status.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : t('common.none');
}

const LEAVES_SHOWN = 4;
const TRIALS_SHOWN = 4;

/** Tableau de bord RH : effectifs, répartition et demandes en attente, sur le périmètre du compte. */
export default function DrhDashboardScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const allowed = access.employees(user);
  const go = (route: string) => router.push(route as never);

  const dashboard = useQuery({
    queryKey: queryKeys.scoped(scope.society, null, 'drh-dashboard'),
    queryFn: () => fetchDrhDashboard(api, scope.society ?? undefined),
    enabled: allowed && ready,
  });
  const withLeaves = allowed && ready && access.leaves(user);
  const leaves = useQuery({
    queryKey: queryKeys.scoped(null, null, 'drh-dashboard', 'leaves'),
    queryFn: () => fetchLeaves(api, { status: 'instance' }),
    enabled: withLeaves,
  });
  const refresh = () => {
    void dashboard.refetch();
    if (withLeaves) void leaves.refetch();
  };
  const data = dashboard.data;
  const active = data?.byStatus.find((entry) => entry.status === 'actif')?.count ?? null;

  return (
    <Gate allowed={allowed}>
      <Screen
        testID="drh-dashboard"
        header={
          <AtlasHeader
            title={t('drh.title')}
            subtitle={t('drh.subtitle')}
            trailing={<HeaderAction testID="drh-refresh" icon="refresh-outline" label={t('common.refresh')} onPress={refresh} />}
          />
        }
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching || leaves.isRefetching} onRefresh={refresh} tintColor={colors.navy} />}>
        {dashboard.isPending ? (
          <Loader />
        ) : dashboard.error || !data ? (
          <ErrorState error={dashboard.error} onRetry={refresh} testID="drh-error" />
        ) : (
          <>
            <SectionHeader title={t('drh.kpi.title')} hint={societyLabel(scope)} />
            <View style={styles.grid}>
              <KpiCard testID="drh-kpi-total" label={t('drh.kpi.total')} value={data.employeesTotal} icon="people-outline" onPress={() => go('/drh/employees')} />
              <KpiCard
                testID="drh-kpi-active"
                label={t('drh.kpi.active')}
                value={active}
                tone="success"
                icon="checkmark-circle-outline"
                ratio={active !== null && data.employeesTotal > 0 ? active / data.employeesTotal : null}
                state={active === null ? 'error' : 'ready'}
                unavailableLabel={t('cockpit.unavailable')}
                onPress={() => go('/drh/employees')}
              />
              {access.leaves(user) ? (
                <KpiCard testID="drh-kpi-leaves" label={t('cockpit.leavesPending')} value={data.leavesPending} tone={data.leavesPending > 0 ? 'info' : 'neutral'} icon="calendar-outline" onPress={() => go('/drh/leaves')} />
              ) : null}
              {access.candidates(user) ? (
                <KpiCard testID="drh-kpi-candidates" label={t('drh.kpi.candidates')} value={data.candidatesTotal} icon="person-add-outline" onPress={() => go('/recruitment')} />
              ) : null}
              <KpiCard testID="drh-kpi-trials" label={t('drh.kpi.trials')} value={data.trialPeriods.length} tone={data.trialPeriods.length > 0 ? 'warning' : 'neutral'} icon="hourglass-outline" />
              <KpiCard testID="drh-kpi-unassigned" label={t('drh.kpi.unassigned')} value={data.withoutSite} tone={data.withoutSite > 0 ? 'warning' : 'neutral'} icon="location-outline" />
            </View>

            {data.byStatus.length > 0 ? (
              <ChartCard testID="drh-by-status" title={t('drh.byStatus.title')}>
                <Distribution
                  segments={data.byStatus.map((entry) => ({
                    key: entry.status,
                    label: rawStatusLabel(entry.status),
                    value: entry.count,
                    tone: entry.status === 'actif' ? 'navy' : undefined,
                  }))}
                />
              </ChartCard>
            ) : null}

            {data.bySite.length > 0 ? (
              <ChartCard testID="drh-by-site" title={t('home.drh.title')} hint={t('home.drh.hint')}>
                <Distribution segments={data.bySite.map((entry) => ({ key: entry.site, label: entry.site, value: entry.count }))} />
              </ChartCard>
            ) : null}

            {access.candidates(user) && data.candidatesByStatus.length > 0 ? (
              <ChartCard testID="drh-candidates" title={t('drh.candidates.title')} actionLabel={t('common.seeAll')} onAction={() => go('/recruitment')}>
                <Distribution segments={data.candidatesByStatus.map((entry) => ({ key: entry.status, label: rawStatusLabel(entry.status), value: entry.count }))} />
              </ChartCard>
            ) : null}

            {withLeaves && leaves.data && leaves.data.length > 0 ? (
              <View style={styles.section} testID="drh-leaves">
                <SectionHeader title={t('drh.leaves.title')} actionLabel={t('common.seeAll')} onAction={() => go('/drh/leaves')} />
                {leaves.data.slice(0, LEAVES_SHOWN).map((leave) => (
                  <EmployeeRow
                    key={leave.id}
                    employeeId={leave.employeeId}
                    name={t('leaves.employee', { id: leave.employeeId })}
                    position={t(leave.type === 'maladie' ? 'leaves.type.maladie' : 'leaves.type.conge')}
                    detail={`${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`}
                    badge={<StatusBadge status={leaveStatus(leave.status)} fallback={leave.status} />}
                    onPress={() => go('/drh/leaves')}
                  />
                ))}
              </View>
            ) : null}

            {data.trialPeriods.length > 0 ? (
              <ChartCard testID="drh-trials" title={t('drh.trials.title')}>
                {data.trialPeriods.slice(0, TRIALS_SHOWN).map((trial) => (
                  <ListItem
                    key={trial.id}
                    icon="hourglass-outline"
                    iconTone="warning"
                    title={trial.name}
                    subtitle={[trial.code, t('drh.trials.until', { date: formatDate(trial.endDate) })].filter(Boolean).join(' · ')}
                    onPress={() => go(`/drh/employees/${trial.id}`)}
                  />
                ))}
              </ChartCard>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title={t('home.shortcuts.title')} />
              <View style={styles.grid}>
                <ActionTile testID="drh-action-employees" icon="people-outline" label={t('entry.employees')} onPress={() => go('/drh/employees')} />
                {access.leaves(user) ? <ActionTile testID="drh-action-leaves" icon="calendar-outline" label={t('entry.leaves')} onPress={() => go('/drh/leaves')} /> : null}
                {access.candidates(user) ? <ActionTile testID="drh-action-candidates" icon="person-add-outline" label={t('entry.candidates')} onPress={() => go('/recruitment')} /> : null}
                {access.attendance(user) ? <ActionTile testID="drh-action-attendance" icon="time-outline" label={t('entry.attendance')} onPress={() => go('/attendance')} /> : null}
                <ActionTile icon="folder-open-outline" label={t('modules.documents')} caption={t('modules.inEmployeeSheet')} />
              </View>
            </View>
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  section: { gap: spacing.md },
});
