import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { presenceRate } from '@/api/domains/attendance';
import { INCIDENT_SEVERITIES } from '@/api/domains/incidents';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Segmented } from '@/components/Segmented';
import {
  AtlasHeader,
  Banner,
  BarChart,
  ChartCard,
  Distribution,
  EmptyState,
  HeaderAction,
  KpiCard,
  KpiGrid,
  RingGauge,
  Screen,
  SkeletonDashboard,
  StatLine,
} from '@/components/ui';
import { access } from '@/features/access';
import { percent, rateTone, share, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { useCockpit } from '@/features/cockpit/useCockpit';
import { useErpCounters, useMonthSales, useMonthSalesByStatus, useMonthTopClients, useOpportunities, useQuotesSent } from '@/features/commercial/hooks';
import { isIncidentOpen, useCockpitInsights, type PresenceDay } from '@/features/cockpit/useCockpitInsights';
import { incidentSeverity, invoiceStatus, opportunityStage, quoteStatus, rawStatusLabel } from '@/features/status';
import { OPPORTUNITY_STAGES } from '@/api/domains/commercial';
import { sameSociety } from '@/api/domains/ops';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney, formatMoneyShort } from '@/utils/format';

type Section = 'global' | 'ops' | 'drh' | 'commercial' | 'billing';

function weekBars(week: readonly PresenceDay[], value: (day: PresenceDay) => number | null) {
  return week.map((day) => ({ key: day.date, label: `${t(weekdayKey(day.date))}\n${shortDate(day.date)}`, value: value(day) }));
}

/**
 * Statistiques : synthèse chiffrée du périmètre courant, en trois vues (Global, OPS, DRH).
 * Chaque bloc vient d'un calcul du backend ; un bloc sans droit ou sans donnée est masqué,
 * jamais complété par une estimation.
 */
export default function StatsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const cockpit = useCockpit();
  const insights = useCockpitInsights();
  const go = (route: string) => router.push(route as never);

  const canOps = access.attendance(user) || access.incidents(user);
  const canDrh = access.employees(user);
  const sections: { value: Section; label: string }[] = [
    { value: 'global', label: t('stats.section.global') },
    ...(canOps ? [{ value: 'ops' as const, label: t('stats.section.ops') }] : []),
    ...(canDrh ? [{ value: 'drh' as const, label: t('stats.section.drh') }] : []),
    ...(access.commercial(user) ? [{ value: 'commercial' as const, label: t('stats.section.commercial') }] : []),
    ...(access.billing(user) ? [{ value: 'billing' as const, label: t('stats.section.billing') }] : []),
  ];
  const counters = useErpCounters();
  const quotesSent = useQuotesSent();
  const opportunities = useOpportunities();
  const monthSales = useMonthSales();
  const salesByStatus = useMonthSalesByStatus();
  const topClients = useMonthTopClients();
  const commercialCounters = counters.data?.commercial ?? null;
  const billingCounters = counters.data?.billing ?? null;
  const scopedOpportunities = (opportunities.data ?? []).filter((row) => !scope.society || sameSociety(row.society, scope.society));
  const [section, setSection] = useState<Section>('global');

  const today = insights.today;
  const rate = presenceRate(today);
  const week = insights.week;
  const weekKnown = week?.some((day) => day.rate !== null) ?? false;
  const drh = insights.drh;
  const open = insights.incidents?.filter(isIncidentOpen) ?? null;
  const card = (key: string) => cockpit.cards.find((entry) => entry.key === key) ?? null;
  const abandons = card('abandons');
  const leaves = card('leaves');
  const todayKey = week?.[week.length - 1]?.date;
  const nothing = !access.attendance(user) && !access.incidents(user) && !canDrh && !access.alerts(user) && !access.commercial(user) && !access.billing(user);
  const loading = !ready || (section !== 'commercial' && section !== 'billing' && access.attendance(user) && today === null && card('expected')?.state === 'loading');

  const refresh = () => {
    cockpit.refresh();
    insights.refresh();
    if (access.commercial(user) || access.billing(user)) void counters.refetch();
  };
  const unavailable = t('cockpit.unavailable');
  const counterState = counters.isPending ? 'loading' : counters.error ? 'error' : 'ready';

  const presenceCard = today ? (
    <ChartCard testID="stats-presence" title={t('home.presence.title')} actionLabel={access.attendance(user) ? t('common.seeAll') : undefined} onAction={() => go('/attendance')}>
      <View style={styles.presence}>
        <RingGauge ratio={rate} tone={rateTone(rate)} caption={t('cockpit.rate.short')} />
        <View style={styles.lines}>
          <StatLine label={t('cockpit.present')} value={`${today.present} / ${today.expected}`} ratio={rate} tone="success" />
          <StatLine label={t('cockpit.absent')} value={String(today.absent)} ratio={share(today.absent, today.expected)} tone="danger" />
          <StatLine label={t('cockpit.notPointed')} value={String(today.not_pointed)} ratio={share(today.not_pointed, today.expected)} tone="warning" />
        </View>
      </View>
    </ChartCard>
  ) : null;

  const weekCard =
    week && weekKnown ? (
      <ChartCard testID="stats-week" title={t('home.week.title')} hint={t('home.week.hint')}>
        <BarChart unit="%" max={100} highlight={todayKey} data={weekBars(week, (day) => (day.rate === null ? null : Math.round(day.rate * 100)))} />
      </ChartCard>
    ) : null;

  return (
    <Screen
      testID="stats-screen"
      header={
        <>
          <AtlasHeader
            title={t('stats.title')}
            subtitle={`${societyLabel(scope)} · ${currentSiteLabel(scope)}`}
            trailing={<HeaderAction testID="stats-refresh" icon="refresh-outline" label={t('common.refresh')} onPress={refresh} />}
          />
          {sections.length > 1 ? (
            <View style={styles.tabs}>
              <Segmented testID="stats-section" value={section} onChange={setSection} options={sections} />
            </View>
          ) : null}
        </>
      }
      refreshControl={<RefreshControl refreshing={cockpit.isRefreshing || insights.isRefreshing} onRefresh={refresh} tintColor={colors.navy} />}>
      {nothing ? (
        <EmptyState icon="stats-chart-outline" title={t('stats.empty.title')} body={t('stats.empty.body')} testID="stats-empty" />
      ) : loading ? (
        <SkeletonDashboard testID="stats-loading" />
      ) : null}

      {!nothing && !loading && section === 'global' ? (
        <>
          <KpiGrid testID="stats-global-kpis">
            {drh ? <KpiCard variant="compact" testID="stats-kpi-headcount" label={t('stats.headcount')} value={drh.employeesTotal} icon="people-outline" onPress={() => go('/employees')} /> : null}
            {today ? <KpiCard variant="compact" testID="stats-kpi-rate" label={t('cockpit.rate')} value={percent(rate)} tone={rateTone(rate)} icon="pulse-outline" onPress={() => go('/attendance')} /> : null}
            {today ? (
              <KpiCard
                variant="compact"
                testID="stats-kpi-absenteeism"
                label={t('stats.absenteeism')}
                value={percent(share(today.absent, today.expected))}
                tone={today.absent > 0 ? 'danger' : 'neutral'}
                icon="person-remove-outline"
                onPress={() => go('/attendance?status=absent')}
              />
            ) : null}
            {insights.incidentsOpen !== null ? (
              <KpiCard variant="compact" testID="stats-kpi-incidents" label={t('cockpit.incidentsOpen')} value={insights.incidentsOpen} tone={insights.incidentsOpen > 0 ? 'warning' : 'neutral'} icon="warning-outline" onPress={() => go('/incidents')} />
            ) : null}
            {leaves ? (
              <KpiCard variant="compact" testID="stats-kpi-leaves" label={t('cockpit.leavesPending')} value={leaves.value} state={leaves.state} unavailableLabel={t('cockpit.unavailable')} icon="calendar-outline" onPress={() => go('/drh/leaves')} />
            ) : null}
            {drh && access.candidates(user) ? (
              <KpiCard variant="compact" testID="stats-kpi-candidates" label={t('drh.kpi.candidates')} value={drh.candidatesTotal} icon="person-add-outline" onPress={() => go('/recruitment')} />
            ) : null}
          </KpiGrid>
          {presenceCard}
          {weekCard}
        </>
      ) : null}

      {!nothing && !loading && section === 'ops' ? (
        <>
          {today ? (
            <KpiGrid testID="stats-ops-kpis">
              <KpiCard variant="compact" label={t('cockpit.expected')} value={today.expected} icon="people-outline" />
              <KpiCard variant="compact" label={t('cockpit.present')} value={today.present} tone="success" icon="checkmark-circle-outline" />
              <KpiCard variant="compact" label={t('cockpit.absent')} value={today.absent} tone="danger" icon="close-circle-outline" />
              <KpiCard variant="compact" label={t('cockpit.notPointed')} value={today.not_pointed} tone="warning" icon="help-circle-outline" />
              <KpiCard variant="compact" label={t('ops.late')} value={today.late} tone={today.late > 0 ? 'warning' : 'neutral'} icon="alarm-outline" />
              <KpiCard variant="compact" label={t('stats.anomalies')} value={today.anomalies} tone={today.anomalies > 0 ? 'warning' : 'neutral'} icon="alert-circle-outline" />
              {abandons ? <KpiCard variant="compact" label={t('cockpit.abandons')} value={abandons.value} state={abandons.state} unavailableLabel={t('cockpit.unavailable')} tone="danger" icon="exit-outline" onPress={() => go('/abandons')} /> : null}
              {open ? <KpiCard variant="compact" label={t('cockpit.incidentsOpen')} value={open.length} tone={open.length > 0 ? 'warning' : 'neutral'} icon="warning-outline" onPress={() => go('/incidents')} /> : null}
            </KpiGrid>
          ) : null}
          {today ? (
            <ChartCard testID="stats-attendance-split" title={t('stats.attendanceSplit')} hint={formatDate(cockpit.date)}>
              <Distribution
                segments={[
                  { key: 'present', label: t('cockpit.present'), value: today.present, tone: 'success' },
                  { key: 'absent', label: t('cockpit.absent'), value: today.absent, tone: 'danger' },
                  { key: 'notPointed', label: t('cockpit.notPointed'), value: today.not_pointed, tone: 'warning' },
                  { key: 'leave', label: t('ops.onLeave'), value: today.conge + today.maladie, tone: 'info' },
                  { key: 'rest', label: t('status.rest'), value: today.repos, tone: 'steel' },
                ]}
              />
            </ChartCard>
          ) : null}
          {week && weekKnown ? (
            <ChartCard testID="stats-week-present" title={t('stats.weekPresent')} hint={t('home.week.hint')}>
              <BarChart highlight={todayKey} data={weekBars(week, (day) => day.present)} />
            </ChartCard>
          ) : null}
          {open ? (
            <ChartCard testID="stats-incidents" title={t('stats.incidentsBySeverity')} actionLabel={t('common.seeAll')} onAction={() => go('/incidents')}>
              {open.length > 0 ? (
                <Distribution
                  segments={[...INCIDENT_SEVERITIES].reverse().map((severity) => ({
                    key: severity,
                    label: t(incidentSeverity(severity)?.label ?? 'incidents.severity.faible'),
                    value: open.filter((incident) => incident.severity === severity).length,
                    tone: incidentSeverity(severity)?.tone ?? 'neutral',
                  }))}
                />
              ) : (
                <EmptyState icon="shield-checkmark-outline" title={t('stats.incidents.none')} />
              )}
            </ChartCard>
          ) : null}
        </>
      ) : null}

      {!nothing && !loading && section === 'drh' ? (
        drh ? (
          <>
            <KpiGrid testID="stats-drh-kpis">
              <KpiCard variant="compact" label={t('drh.kpi.total')} value={drh.employeesTotal} icon="people-outline" onPress={() => go('/employees')} />
              <KpiCard
                variant="compact"
                label={t('drh.kpi.active')}
                value={drh.byStatus.find((entry) => entry.status === 'actif')?.count ?? 0}
                tone="success"
                icon="checkmark-circle-outline"
              />
              {access.leaves(user) ? <KpiCard variant="compact" label={t('cockpit.leavesPending')} value={drh.leavesPending} tone={drh.leavesPending > 0 ? 'info' : 'neutral'} icon="calendar-outline" onPress={() => go('/drh/leaves')} /> : null}
              {access.candidates(user) ? <KpiCard variant="compact" label={t('drh.kpi.candidates')} value={drh.candidatesTotal} icon="person-add-outline" onPress={() => go('/recruitment')} /> : null}
              <KpiCard variant="compact" label={t('drh.kpi.trials')} value={drh.trialPeriods.length} tone={drh.trialPeriods.length > 0 ? 'warning' : 'neutral'} icon="hourglass-outline" />
              <KpiCard variant="compact" label={t('drh.kpi.unassigned')} value={drh.withoutSite} tone={drh.withoutSite > 0 ? 'warning' : 'neutral'} icon="location-outline" />
            </KpiGrid>
            {drh.byStatus.length > 0 ? (
              <ChartCard testID="stats-drh-status" title={t('drh.byStatus.title')}>
                <Distribution segments={drh.byStatus.map((entry) => ({ key: entry.status, label: rawStatusLabel(entry.status), value: entry.count, tone: entry.status === 'actif' ? 'navy' : undefined }))} />
              </ChartCard>
            ) : null}
            {drh.bySite.length > 0 ? (
              <ChartCard testID="stats-drh-sites" title={t('home.drh.title')} hint={t('home.drh.hint')}>
                <Distribution segments={drh.bySite.map((entry) => ({ key: entry.site, label: entry.site, value: entry.count }))} />
              </ChartCard>
            ) : null}
            {access.candidates(user) && drh.candidatesByStatus.length > 0 ? (
              <ChartCard testID="stats-drh-recruitment" title={t('drh.candidates.title')} actionLabel={t('common.seeAll')} onAction={() => go('/recruitment')}>
                <Distribution segments={drh.candidatesByStatus.map((entry) => ({ key: entry.status, label: rawStatusLabel(entry.status), value: entry.count }))} />
              </ChartCard>
            ) : null}
          </>
        ) : insights.drhStatus === 'error' ? (
          <EmptyState icon="cloud-offline-outline" title={t('cockpit.unavailable')} body={t('stats.drh.unavailable')} testID="stats-drh-unavailable" />
        ) : (
          <SkeletonDashboard testID="stats-drh-loading" />
        )
      ) : null}
      {!nothing && !loading && section === 'commercial' ? (
        <>
          <KpiGrid testID="stats-commercial-kpis">
            <KpiCard variant="compact" label={t('commercial.kpi.prospects')} value={commercialCounters?.prospects ?? null} state={counterState} unavailableLabel={unavailable} icon="person-add-outline" onPress={() => go('/commercial/prospects')} />
            <KpiCard variant="compact" label={t('commercial.kpi.clients')} value={commercialCounters?.clientsActive ?? null} state={counterState} unavailableLabel={unavailable} icon="briefcase-outline" onPress={() => go('/commercial/clients')} />
            <KpiCard variant="compact" label={t('commercial.kpi.opportunities')} value={commercialCounters?.opportunitiesOpen ?? null} state={counterState} unavailableLabel={unavailable} icon="trending-up-outline" />
            <KpiCard variant="compact" label={t('commercial.kpi.quotesSent')} value={quotesSent.data?.total ?? null} state={quotesSent.isPending ? 'loading' : quotesSent.error ? 'error' : 'ready'} unavailableLabel={unavailable} icon="document-text-outline" />
            <KpiCard variant="compact" label={t('commercial.kpi.contracts')} value={commercialCounters?.contractsActive ?? null} state={counterState} unavailableLabel={unavailable} icon="ribbon-outline" />
            <KpiCard variant="compact" label={t('commercial.kpi.ending')} value={commercialCounters?.contractsEnding30d ?? null} state={counterState} unavailableLabel={unavailable} icon="hourglass-outline" tone={commercialCounters && commercialCounters.contractsEnding30d > 0 ? 'warning' : 'neutral'} />
            {access.salesReports(user) ? (
              <KpiCard variant="compact" label={t('commercial.kpi.revenue')} value={monthSales.data ? formatMoneyShort(monthSales.data.revenueHt) : null} state={monthSales.isPending ? 'loading' : monthSales.error ? 'error' : 'ready'} unavailableLabel={unavailable} icon="cash-outline" />
            ) : null}
          </KpiGrid>
          {scopedOpportunities.length > 0 ? (
            <ChartCard testID="stats-opportunity-stages" title={t('stats.opportunityStages')}>
              <Distribution
                segments={OPPORTUNITY_STAGES.map((stage) => ({
                  key: stage,
                  label: t(opportunityStage(stage)?.label ?? 'common.none'),
                  value: scopedOpportunities.filter((row) => row.stage === stage).length,
                  tone: stage === 'gagnee' ? 'success' : stage === 'perdue' ? 'steel' : undefined,
                }))}
              />
            </ChartCard>
          ) : null}
          {salesByStatus.data && salesByStatus.data.quotes.byStatus.length > 0 ? (
            <ChartCard testID="stats-quote-status" title={t('stats.quoteStatus')} hint={t('billing.chart.month')}>
              <Distribution
                segments={salesByStatus.data.quotes.byStatus.map((entry) => ({
                  key: entry.status,
                  label: quoteStatus(entry.status) ? t(quoteStatus(entry.status)?.label ?? 'common.none') : rawStatusLabel(entry.status),
                  value: entry.count,
                }))}
              />
            </ChartCard>
          ) : null}
          {topClients.data && topClients.data.length > 0 ? (
            <ChartCard testID="stats-top-clients" title={t('stats.topClients')} hint={t('billing.chart.month')}>
              {topClients.data.map((row) => (
                <StatLine key={row.client} label={row.client} value={formatMoney(row.totalTtc)} ratio={row.totalTtc / Math.max(topClients.data[0]?.totalTtc ?? 1, 1)} />
              ))}
            </ChartCard>
          ) : null}
        </>
      ) : null}

      {!nothing && !loading && section === 'billing' ? (
        <>
          <KpiGrid testID="stats-billing-kpis">
            <KpiCard variant="compact" label={t('billing.kpi.issued')} value={billingCounters?.invoicesIssued ?? null} state={counterState} unavailableLabel={unavailable} icon="receipt-outline" onPress={() => go('/billing/invoices')} />
            <KpiCard variant="compact" label={t('billing.kpi.invoiced')} value={billingCounters ? formatMoneyShort(billingCounters.invoicedTtc) : null} state={counterState} unavailableLabel={unavailable} icon="trending-up-outline" />
            <KpiCard variant="compact" label={t('billing.kpi.collected')} value={billingCounters ? formatMoneyShort(billingCounters.paymentsAmount) : null} state={counterState} unavailableLabel={unavailable} icon="cash-outline" tone="success" onPress={() => go('/billing/payments')} />
            <KpiCard variant="compact" label={t('billing.kpi.creditNotes')} value={billingCounters?.creditNotesTotal ?? null} state={counterState} unavailableLabel={unavailable} icon="return-down-back-outline" />
          </KpiGrid>
          {billingCounters ? (
            <ChartCard testID="stats-invoiced-collected" title={t('billing.chart.invoicedCollected')} hint={t('billing.chart.allTime')}>
              <StatLine label={t('billing.kpi.invoiced')} value={formatMoney(billingCounters.invoicedTtc)} ratio={billingCounters.invoicedTtc / Math.max(billingCounters.invoicedTtc, billingCounters.paymentsAmount, 1)} />
              <StatLine label={t('billing.kpi.collected')} value={formatMoney(billingCounters.paymentsAmount)} ratio={billingCounters.paymentsAmount / Math.max(billingCounters.invoicedTtc, billingCounters.paymentsAmount, 1)} tone="success" />
            </ChartCard>
          ) : null}
          {monthSales.data ? (
            <ChartCard testID="stats-month-sales" title={t('stats.monthSales')} hint={t('billing.chart.month')}>
              <StatLine label={t('money.revenueHt')} value={formatMoney(monthSales.data.revenueHt)} />
              <StatLine label={t('money.revenueTtc')} value={formatMoney(monthSales.data.revenueTtc)} />
              <StatLine label={t('billing.kpi.monthCollected')} value={formatMoney(monthSales.data.collected)} />
            </ChartCard>
          ) : null}
          {salesByStatus.data && salesByStatus.data.invoices.byStatus.length > 0 ? (
            <ChartCard testID="stats-invoice-status" title={t('billing.chart.byStatus')} hint={t('billing.chart.month')}>
              <Distribution
                segments={salesByStatus.data.invoices.byStatus.map((entry) => ({
                  key: entry.status,
                  label: invoiceStatus(entry.status) ? t(invoiceStatus(entry.status)?.label ?? 'common.none') : rawStatusLabel(entry.status),
                  value: entry.count,
                  tone: invoiceStatus(entry.status)?.tone,
                }))}
              />
            </ChartCard>
          ) : null}
          <Banner tone="info" title={t('billing.outstanding.title')} message={t('billing.outstanding.body')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  lines: { flex: 1, gap: spacing.md },
});
