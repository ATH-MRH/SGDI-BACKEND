import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { presenceRate } from '@/api/domains/attendance';
import { useCurrentUser } from '@/auth/AuthProvider';
import { StatusBadge } from '@/components/StatusBadge';
import {
  ActionTile,
  AppText,
  Avatar,
  BarChart,
  Card,
  ChartCard,
  Chip,
  Distribution,
  EmptyState,
  HeaderAction,
  IncidentRow,
  KpiCard,
  RingGauge,
  SectionHeader,
  Skeleton,
  StatLine,
} from '@/components/ui';
import { access } from '@/features/access';
import { kpiIcon, percent, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { useCockpit } from '@/features/cockpit/useCockpit';
import { useCockpitInsights } from '@/features/cockpit/useCockpitInsights';
import { moduleEntries } from '@/features/entries';
import { visibleModules } from '@/features/modules';
import { incidentSeverity, SEVERITY } from '@/features/status';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatDate, formatDateTime } from '@/utils/format';

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const cockpit = useCockpit();
  const insights = useCockpitInsights();
  const modules = visibleModules(user);
  const canChangeScope = scope.canChangeSociety || scope.canChangeSite;
  const displayName = user?.full_name || user?.username || '';
  const go = (route: string) => router.push(route as never);

  // Accès rapides : toutes les fonctions que ce profil peut ouvrir, sans doublon.
  const shortcuts = [...new Map(modules.flatMap((module) => moduleEntries(user, module.key)).map((entry) => [entry.key, entry])).values()];
  const critical = cockpit.cards.find((card) => card.key === 'alertsCritical')?.value ?? 0;
  const today = insights.today;
  const rate = presenceRate(today);
  const week = insights.week;
  const weekKnown = week?.some((day) => day.rate !== null) ?? false;
  const drh = insights.drh;
  const recentIncidents = insights.incidents?.slice(0, 3) ?? [];
  const recentAlerts = insights.alerts ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="home-screen">
      <View style={styles.header}>
        <View style={styles.brand} accessibilityElementsHidden importantForAccessibility="no">
          <AppText style={styles.brandMark}>A</AppText>
        </View>
        <View style={styles.headerTexts}>
          <AppText variant="caption" color={colors.textSecondary}>
            {t('home.hello')}
          </AppText>
          <AppText variant="title" color={colors.navy} accessibilityRole="header" numberOfLines={1} accessibilityLabel={t('home.greeting', { name: displayName })}>
            {firstName(displayName) || t('app.name')}
          </AppText>
        </View>
        {access.alerts(user) ? (
          <HeaderAction testID="home-alerts" icon="notifications-outline" label={t('tabs.alerts')} badge={critical > 0} onPress={() => go('/alerts')} />
        ) : null}
        <Pressable testID="home-profile" accessibilityRole="button" accessibilityLabel={t('tabs.profile')} onPress={() => go('/profile')}>
          <Avatar name={displayName} size={40} />
        </Pressable>
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
        {ready ? (
          <Pressable
            testID="home-scope"
            accessibilityRole={canChangeScope ? 'button' : undefined}
            accessibilityLabel={`${t('home.context')} : ${societyLabel(scope)}, ${currentSiteLabel(scope)}`}
            disabled={!canChangeScope}
            onPress={() => go('/scope')}
            style={styles.scope}>
            <Chip icon="briefcase-outline" label={societyLabel(scope)} />
            <Chip icon="location-outline" label={currentSiteLabel(scope)} />
            {canChangeScope ? (
              <AppText variant="label" color={colors.primary} style={styles.scopeChange}>
                {t('home.context.change')}
              </AppText>
            ) : null}
          </Pressable>
        ) : (
          <Skeleton height={28} width="70%" />
        )}

        {modules.length === 0 ? (
          <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="home-no-module" />
        ) : (
          <>
            {cockpit.cards.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={cockpit.date ? t('cockpit.titleDated', { date: formatDate(cockpit.date) }) : t('home.cockpit.title')} />
                <View style={styles.grid} testID="cockpit-grid">
                  {insights.sitesTotal !== null ? (
                    <KpiCard testID="kpi-sites" label={t('cockpit.sites')} value={insights.sitesTotal} icon="business-outline" onPress={() => go('/ops/sites')} />
                  ) : null}
                  {drh ? (
                    <KpiCard testID="kpi-employees" label={t('cockpit.employees')} value={drh.employeesTotal} icon="people-outline" onPress={() => go('/drh/employees')} />
                  ) : null}
                  {today ? (
                    <KpiCard
                      testID="kpi-rate"
                      label={t('cockpit.rate')}
                      value={percent(rate)}
                      tone={rate === null ? 'neutral' : rate >= 0.9 ? 'success' : rate >= 0.75 ? 'warning' : 'danger'}
                      icon="pulse-outline"
                      ratio={rate}
                      onPress={() => go('/attendance')}
                    />
                  ) : null}
                  {insights.incidentsOpen !== null ? (
                    <KpiCard
                      testID="kpi-incidents"
                      label={t('cockpit.incidentsOpen')}
                      value={insights.incidentsOpen}
                      tone={insights.incidentsOpen > 0 ? 'warning' : 'neutral'}
                      icon="warning-outline"
                      onPress={() => go('/incidents')}
                    />
                  ) : null}
                  {cockpit.cards.map((card) => (
                    <KpiCard
                      key={card.key}
                      testID={`kpi-${card.key}`}
                      label={t(card.label)}
                      value={card.value}
                      tone={card.tone}
                      icon={kpiIcon(card.key)}
                      state={card.state}
                      unavailableLabel={t('cockpit.unavailable')}
                      onPress={() => go(card.route)}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <Card testID="cockpit-empty">
                <AppText variant="heading" color={colors.navy}>
                  {t('home.cockpit.title')}
                </AppText>
                <AppText color={colors.textSecondary}>{t('cockpit.none')}</AppText>
              </Card>
            )}

            {today ? (
              <ChartCard testID="home-presence" title={t('home.presence.title')} actionLabel={t('common.seeAll')} onAction={() => go('/attendance')}>
                <View style={styles.presence}>
                  <RingGauge ratio={rate} tone={rate !== null && rate < 0.75 ? 'danger' : rate !== null && rate < 0.9 ? 'warning' : 'success'} caption={t('cockpit.rate.short')} />
                  <View style={styles.presenceLines}>
                    <StatLine label={t('cockpit.present')} value={`${today.present} / ${today.expected}`} ratio={rate} tone="success" />
                    <StatLine label={t('cockpit.absent')} value={String(today.absent)} ratio={today.expected ? today.absent / today.expected : null} tone="danger" />
                    <StatLine label={t('cockpit.notPointed')} value={String(today.not_pointed)} ratio={today.expected ? today.not_pointed / today.expected : null} tone="warning" />
                  </View>
                </View>
              </ChartCard>
            ) : null}

            {week && weekKnown ? (
              <ChartCard testID="home-week" title={t('home.week.title')} hint={t('home.week.hint')}>
                <BarChart
                  unit="%"
                  max={100}
                  data={week.map((day) => ({
                    key: day.date,
                    label: `${t(weekdayKey(day.date))} ${shortDate(day.date).slice(0, 2)}`,
                    value: day.rate === null ? null : Math.round(day.rate * 100),
                    tone: day.rate === null ? 'brand' : day.rate >= 0.9 ? 'success' : day.rate >= 0.75 ? 'warning' : 'danger',
                  }))}
                />
              </ChartCard>
            ) : null}

            {drh && drh.bySite.length > 0 ? (
              <ChartCard testID="home-drh" title={t('home.drh.title')} hint={t('home.drh.hint')} actionLabel={t('common.seeAll')} onAction={() => go('/drh')}>
                <Distribution segments={drh.bySite.slice(0, 5).map((entry) => ({ key: entry.site, label: entry.site, value: entry.count }))} />
              </ChartCard>
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

            {shortcuts.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t('home.shortcuts.title')} actionLabel={t('tabs.modules')} onAction={() => go('/modules')} />
                <View style={styles.grid}>
                  {shortcuts.map((entry) => (
                    <ActionTile key={entry.key} testID={`shortcut-${entry.key}`} icon={entry.icon} label={t(entry.title)} onPress={() => go(entry.route)} />
                  ))}
                </View>
              </View>
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  brand: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  brandMark: { color: colors.onNavy, fontSize: 20, lineHeight: 24, fontWeight: '800' },
  headerTexts: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xl, paddingBottom: spacing.xxxl },
  scope: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  scopeChange: { marginLeft: spacing.xs },
  section: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  presenceLines: { flex: 1, gap: spacing.md },
});
