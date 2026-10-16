import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { presenceRate } from '@/api/domains/attendance';
import { useCurrentUser } from '@/auth/AuthProvider';
import { StatusBadge } from '@/components/StatusBadge';
import {
  AppText,
  AtlasLogo,
  Avatar,
  BarChart,
  Card,
  ChartCard,
  Distribution,
  EmptyState,
  HeaderAction,
  IncidentRow,
  KpiCard,
  KpiGrid,
  RingGauge,
  SectionHeader,
  Skeleton,
  type IconName,
} from '@/components/ui';
import { access } from '@/features/access';
import { dayOverDay, kpiIcon, rateTone, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { useCockpit, type CockpitCard } from '@/features/cockpit/useCockpit';
import { useCockpitInsights } from '@/features/cockpit/useCockpitInsights';
import { useErpCounters, useQuotesSent } from '@/features/commercial/hooks';
import { visibleModules } from '@/features/modules';
import { incidentSeverity, SEVERITY } from '@/features/status';
import { t, type TranslationKey } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, elevation, spacing, typography } from '@/theme/tokens';
import { formatDate, formatDateTime, formatMoneyShort } from '@/utils/format';

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/** Ordre des indicateurs du cockpit : présence d'abord, puis les signaux à traiter. */
const KPI_ORDER = ['present', 'absent', 'notPointed', 'expected', 'incidents', 'abandons', 'leaves', 'alertsOpen'] as const;
const KPI_MAX = 8;

type QuickAction = { key: string; label: TranslationKey; icon: IconName; route: string; tone?: 'brand' | 'warning' | 'danger' };

/** Accueil : le cockpit du périmètre courant. Chaque bloc n'existe que si le compte a le droit de voir sa donnée. */
export default function HomeScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const cockpit = useCockpit();
  const insights = useCockpitInsights();
  const counters = useErpCounters();
  const quotesSent = useQuotesSent();
  const modules = visibleModules(user);
  const canChangeScope = scope.canChangeSociety || scope.canChangeSite;
  const displayName = user?.full_name || user?.username || '';
  const go = (route: string) => router.push(route as never);

  const card = (key: string): CockpitCard | null => cockpit.cards.find((entry) => entry.key === key) ?? null;
  const critical = card('alertsCritical')?.value ?? 0;
  const today = insights.today;
  const yesterday = insights.yesterday ?? null;
  const rate = presenceRate(today);
  const week = insights.week;
  const weekKnown = week?.some((day) => day.rate !== null) ?? false;
  const drh = insights.drh;
  const recentIncidents = insights.incidents?.slice(0, 3) ?? [];
  const recentAlerts = insights.alerts ?? [];
  const vsYesterday = t('home.vsYesterday');

  // Indicateurs : ceux du cockpit (pointage, abandons, congés, alertes) et les incidents ouverts.
  const tiles: Record<string, ReactElement | null> = {};
  for (const entry of cockpit.cards) {
    if (entry.key === 'alertsCritical') continue;
    const delta =
      entry.key === 'present'
        ? dayOverDay(yesterday?.present, today?.present, vsYesterday, true)
        : entry.key === 'absent'
          ? dayOverDay(yesterday?.absent, today?.absent, vsYesterday, false)
          : null;
    tiles[entry.key] = (
      <KpiCard
        variant="compact"
        key={entry.key}
        testID={`kpi-${entry.key}`}
        label={t(entry.key === 'alertsOpen' ? 'tabs.alerts' : entry.label)}
        value={entry.value}
        tone={entry.tone === 'info' || entry.key === 'expected' ? 'neutral' : entry.tone}
        icon={kpiIcon(entry.key)}
        state={entry.state}
        delta={delta}
        unavailableLabel={t('cockpit.unavailable')}
        onPress={() => go(entry.route)}
      />
    );
  }
  if (insights.incidentsOpen !== null) {
    tiles.incidents = (
      <KpiCard
        variant="compact"
        key="incidents"
        testID="kpi-incidents"
        label={t('home.kpi.incidents')}
        value={insights.incidentsOpen}
        tone={insights.incidentsOpen > 0 ? 'warning' : 'neutral'}
        icon="warning-outline"
        onPress={() => go('/incidents')}
      />
    );
  }
  const grid = KPI_ORDER.map((key) => tiles[key]).filter((tile): tile is ReactElement => Boolean(tile));
  // Profil sans pointage : l'effectif et les sites complètent la rangée.
  if (grid.length < KPI_MAX && drh) {
    grid.push(<KpiCard variant="compact" key="employees" testID="kpi-employees" label={t('cockpit.employees')} value={drh.employeesTotal} icon="people-outline" onPress={() => go('/employees')} />);
  }
  if (grid.length < KPI_MAX && insights.sitesTotal !== null) {
    grid.push(<KpiCard variant="compact" key="sites" testID="kpi-sites" label={t('cockpit.sites')} value={insights.sitesTotal} icon="business-outline" onPress={() => go('/ops/sites')} />);
  }

  // Commercial et Facturation : compteurs du serveur, seulement pour les comptes qui ont le module.
  const commercial = access.commercial(user) ? (counters.data?.commercial ?? null) : null;
  const billing = access.billing(user) ? (counters.data?.billing ?? null) : null;
  const sales: ReactElement[] = [];
  if (commercial) {
    sales.push(
      <KpiCard variant="compact" key="clients" testID="kpi-clients" label={t('commercial.kpi.clients')} value={commercial.clientsActive} icon="briefcase-outline" onPress={() => go('/commercial/clients')} />,
      <KpiCard variant="compact" key="opportunities" testID="kpi-opportunities" label={t('commercial.kpi.opportunities')} value={commercial.opportunitiesOpen} icon="trending-up-outline" onPress={() => go('/commercial/prospects?tab=opportunities')} />,
    );
    if (quotesSent.data) {
      sales.push(<KpiCard variant="compact" key="quotes" testID="kpi-quotes" label={t('commercial.kpi.quotesSent')} value={quotesSent.data.total} icon="document-text-outline" onPress={() => go('/commercial/quotes?status=envoyé')} />);
    }
  }
  if (billing) {
    sales.push(
      <KpiCard variant="compact" key="invoiced" testID="kpi-invoiced" label={t('billing.kpi.invoiced')} value={formatMoneyShort(billing.invoicedTtc)} icon="receipt-outline" onPress={() => go('/billing')} />,
      <KpiCard variant="compact" key="collected" testID="kpi-collected" label={t('billing.kpi.collected')} value={formatMoneyShort(billing.paymentsAmount)} tone="success" icon="cash-outline" onPress={() => go('/billing/payments')} />,
    );
  }

  const quick: QuickAction[] = [
    ...(access.attendance(user) ? [{ key: 'attendance', label: 'home.quick.attendance', icon: 'time-outline', route: '/attendance' } as const] : []),
    ...(access.createIncident(user) ? [{ key: 'incident', label: 'home.quick.incident', icon: 'warning-outline', route: '/incidents/new', tone: 'warning' } as const] : []),
    ...(access.leaves(user) ? [{ key: 'leaves', label: 'home.quick.leaves', icon: 'calendar-outline', route: '/drh/leaves' } as const] : []),
    ...(access.sites(user) ? [{ key: 'sites', label: 'home.quick.site', icon: 'business-outline', route: '/ops/sites' } as const] : []),
    ...(access.employees(user) ? [{ key: 'employees', label: 'home.quick.employee', icon: 'people-outline', route: '/employees' } as const] : []),
    ...(access.declareAbandon(user) && access.abandons(user) ? [{ key: 'abandon', label: 'abandons.declare', icon: 'exit-outline', route: '/abandons/new', tone: 'danger' } as const] : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="home-screen">
      <View style={styles.header}>
        <AtlasLogo testID="home-logo" />
        <View style={styles.headerActions}>
          {access.alerts(user) ? (
            <HeaderAction testID="home-alerts" icon="notifications-outline" label={t('tabs.alerts')} badge={critical ?? 0} onPress={() => go('/alerts')} />
          ) : null}
          <Pressable testID="home-profile" accessibilityRole="button" accessibilityLabel={t('tabs.profile')} onPress={() => go('/profile')} hitSlop={6}>
            <Avatar name={displayName} size={40} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={cockpit.isRefreshing || insights.isRefreshing}
            onRefresh={() => {
              cockpit.refresh();
              insights.refresh();
            }}
            tintColor={colors.navy}
          />
        }>
        <View style={styles.greeting}>
          <AppText variant="screenTitle" color={colors.navy} accessibilityRole="header" numberOfLines={1} accessibilityLabel={t('home.greeting', { name: displayName })}>
            {t('home.greeting', { name: firstName(displayName) || t('app.name') })}
          </AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {t('home.welcomeBack')}
          </AppText>
        </View>

        {ready ? (
          <Pressable
            testID="home-scope"
            accessibilityRole={canChangeScope ? 'button' : undefined}
            accessibilityLabel={`${t('home.context')} : ${societyLabel(scope)}, ${currentSiteLabel(scope)}`}
            disabled={!canChangeScope}
            onPress={() => go('/scope')}
            style={({ pressed }) => [styles.scope, pressed && styles.pressed]}>
            <Ionicons name="location" size={16} color={colors.navy} />
            <AppText variant="label" color={colors.text} numberOfLines={1} style={styles.scopeText}>
              {`${currentSiteLabel(scope)} – ${societyLabel(scope)}`}
            </AppText>
            {canChangeScope ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
          </Pressable>
        ) : (
          <Skeleton height={22} width="70%" />
        )}

        {modules.length === 0 ? (
          <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="home-no-module" />
        ) : (
          <>
            {grid.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={cockpit.date ? t('cockpit.titleDated', { date: formatDate(cockpit.date) }) : t('home.cockpit.title')} />
                <KpiGrid testID="cockpit-grid">{grid}</KpiGrid>
              </View>
            ) : (
              <Card testID="cockpit-empty">
                <AppText variant="heading" color={colors.navy}>
                  {t('home.cockpit.title')}
                </AppText>
                <AppText color={colors.textSecondary}>{t('cockpit.none')}</AppText>
              </Card>
            )}

            {sales.length > 0 ? (
              <View style={styles.section} testID="home-sales">
                <SectionHeader
                  title={t('home.sales.title')}
                  actionLabel={t('home.seeMore')}
                  onAction={() => go(commercial ? '/commercial' : '/billing')}
                />
                <KpiGrid>{sales}</KpiGrid>
              </View>
            ) : null}

            {today ? (
              <ChartCard testID="home-presence" title={t('cockpit.rate')} actionLabel={t('home.seeDetail')} onAction={() => go('/attendance')}>
                <View style={styles.presence}>
                  <RingGauge ratio={rate} tone={rateTone(rate)} size={116} thickness={14} />
                  <View style={styles.legend}>
                    <Distribution
                      showBar={false}
                      segments={[
                        { key: 'present', label: t('cockpit.present'), value: today.present, tone: 'success' },
                        { key: 'absent', label: t('cockpit.absent'), value: today.absent, tone: 'danger' },
                        { key: 'notPointed', label: t('cockpit.notPointed'), value: today.not_pointed, tone: 'warning' },
                        { key: 'other', label: t('home.presence.other'), value: today.conge + today.maladie + today.repos, tone: 'steel' },
                      ]}
                    />
                  </View>
                </View>
              </ChartCard>
            ) : null}

            {week && weekKnown ? (
              <ChartCard testID="home-week" title={t('home.week.title')} hint={t('home.week.hint')} actionLabel={t('home.seeMore')} onAction={() => go('/stats')}>
                <BarChart
                  unit="%"
                  max={100}
                  highlight={week[week.length - 1]?.date}
                  data={week.map((day) => ({
                    key: day.date,
                    label: `${t(weekdayKey(day.date))}\n${shortDate(day.date)}`,
                    value: day.rate === null ? null : Math.round(day.rate * 100),
                  }))}
                />
              </ChartCard>
            ) : null}

            {quick.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t('home.quick.title')} hint={t('home.quick.hint')} />
                <View style={styles.quick}>
                  {quick.slice(0, 4).map((action) => (
                    <Pressable
                      key={action.key}
                      testID={`quick-${action.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={t(action.label)}
                      onPress={() => go(action.route)}
                      style={({ pressed }) => [styles.quickTile, elevation.card, pressed && styles.pressed]}>
                      <Ionicons
                        name={action.icon}
                        size={24}
                        color={action.tone === 'danger' ? colors.danger : action.tone === 'warning' ? colors.warning : colors.primary}
                      />
                      <AppText style={styles.quickLabel} color={colors.text} numberOfLines={2}>
                        {t(action.label)}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {recentAlerts.length > 0 ? (
              <View style={styles.section} testID="home-alerts-recent">
                <SectionHeader title={t('home.alerts.title')} actionLabel={t('common.seeAll')} onAction={() => go('/alerts')} />
                {recentAlerts.map((alert) => (
                  <IncidentRow
                    key={alert.id}
                    testID={`home-alert-${alert.id}`}
                    tone={SEVERITY[alert.severity].tone}
                    icon="notifications-outline"
                    title={alert.title}
                    detail={[alert.society, formatDateTime(alert.lastDetectedAt)].filter(Boolean).join(' · ')}
                    badge={<StatusBadge status={SEVERITY[alert.severity]} fallback={alert.severity} />}
                    onPress={() => go(`/alerts/${alert.id}`)}
                  />
                ))}
              </View>
            ) : null}

            {recentIncidents.length > 0 ? (
              <View style={styles.section} testID="home-incidents-recent">
                <SectionHeader title={t('home.incidents.title')} actionLabel={t('common.seeAll')} onAction={() => go('/incidents')} />
                {recentIncidents.map((incident) => {
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

            {drh && drh.bySite.length > 0 ? (
              <ChartCard testID="home-drh" title={t('home.drh.title')} hint={t('home.drh.hint')} actionLabel={access.employees(user) ? t('common.seeAll') : undefined} onAction={() => go('/drh')}>
                <Distribution segments={drh.bySite.slice(0, 5).map((entry) => ({ key: entry.site, label: entry.site, value: entry.count }))} />
              </ChartCard>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg, paddingBottom: spacing.xxl },
  greeting: { gap: 2 },
  scope: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: spacing.xs },
  scopeText: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  section: { gap: spacing.md },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  legend: { flex: 1 },
  quick: { flexDirection: 'row', gap: spacing.sm },
  quickTile: {
    flex: 1,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  quickLabel: { ...typography.micro, fontWeight: '600', textAlign: 'center' },
});
