import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ApiUser } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthProvider';
import { canAccessAnyModule, type ModuleKey } from '@/auth/permissions';
import { AppText, AtlasHeader, EmptyState, KpiGrid, MetricStrip, ModuleTile, Screen, SectionHeader, type IconName } from '@/components/ui';
import { access } from '@/features/access';
import { useCockpit } from '@/features/cockpit/useCockpit';
import { useCockpitInsights } from '@/features/cockpit/useCockpitInsights';
import { useErpCounters } from '@/features/commercial/hooks';
import { visibleModules, type MobileModule } from '@/features/modules';
import { t, type TranslationKey } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';

type Tile = { key: string; label: string; caption?: string; icon: IconName; route?: string; count?: number | null; urgent?: boolean; testID?: string };

/** Écran de chaque module mobile : le tableau de bord du module quand il existe, sinon son accueil. */
const MODULE_ROUTES: Partial<Record<ModuleKey, string>> = {
  ops: '/ops',
  drh: '/drh',
  pointage: '/attendance',
  brq: '/brq',
  conges: '/drh/leaves',
  recrute: '/recruitment',
  dc: '/commercial',
  finances: '/billing',
  fac: '/billing',
};

type Soon = { key: string; label: TranslationKey; caption: TranslationKey; icon: IconName; modules: readonly ModuleKey[] };

/**
 * Briques ATLAS sans écran mobile : montrées grisées, et seulement aux comptes qui ont le
 * module correspondant sur le web. Jamais simulées.
 */
const NOT_ON_MOBILE: readonly Soon[] = [
  { key: 'documents', label: 'modules.documents', caption: 'modules.inEmployeeSheet', icon: 'folder-open-outline', modules: ['drh'] },
  { key: 'badges', label: 'modules.badges', caption: 'modules.unavailable.short', icon: 'id-card-outline', modules: ['drh', 'ops'] },
  { key: 'blacklist', label: 'modules.blacklist', caption: 'modules.unavailable.short', icon: 'ban-outline', modules: ['drh'] },
  { key: 'rounds', label: 'modules.rounds', caption: 'modules.unavailable.short', icon: 'walk-outline', modules: ['ops'] },
  { key: 'equipment', label: 'modules.equipment', caption: 'modules.unavailable.short', icon: 'cube-outline', modules: ['materiel'] },
  { key: 'finance', label: 'modules.finance', caption: 'modules.unavailable.short', icon: 'cash-outline', modules: ['finances', 'caisse'] },
  { key: 'accounting', label: 'modules.accounting', caption: 'modules.unavailable.short', icon: 'calculator-outline', modules: ['finances'] },
];

function Grid({ tiles, go }: { tiles: readonly Tile[]; go: (route: string) => void }) {
  return (
    <KpiGrid columns={3}>
      {tiles.map((tile) => (
        <ModuleTile
          key={tile.key}
          testID={tile.testID}
          label={tile.label}
          caption={tile.caption}
          icon={tile.icon}
          count={tile.count}
          urgent={tile.urgent}
          onPress={tile.route ? () => go(tile.route as string) : undefined}
        />
      ))}
    </KpiGrid>
  );
}

function moduleTile(module: MobileModule): Tile {
  const route = MODULE_ROUTES[module.key];
  return { key: module.key, testID: `module-${module.key}`, label: t(module.title), caption: t(module.body), icon: module.icon, route: route ?? `/module/${module.key}` };
}

function soonTiles(user: ApiUser | null): Tile[] {
  return NOT_ON_MOBILE.filter((item) => canAccessAnyModule(user, item.modules)).map((item) => ({
    key: item.key,
    testID: `soon-${item.key}`,
    label: t(item.label),
    caption: t(item.caption),
    icon: item.icon,
  }));
}

/**
 * Lanceur de modules. Les modules et fonctions viennent des droits du compte : ce qui n'est pas
 * accordé n'y figure pas. Les compteurs sont ceux du cockpit, calculés par le backend.
 */
export default function ModulesScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const cockpit = useCockpit();
  const insights = useCockpitInsights();
  const counters = useErpCounters();
  const modules = visibleModules(user);
  const go = (route: string) => router.push(route as never);
  const header = <AtlasHeader title={t('tabs.modules')} subtitle={t('modules.subtitle')} />;

  if (modules.length === 0) {
    return (
      <Screen scroll={false} testID="modules-screen" header={header}>
        <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="modules-empty" />
      </Screen>
    );
  }

  const count = (key: string) => cockpit.cards.find((card) => card.key === key)?.value ?? null;
  const critical = count('alertsCritical');
  const moduleTiles = modules.map((module) => (module.key === 'conges' ? { ...moduleTile(module), count: count('leaves') } : moduleTile(module)));
  const shown = new Set(modules.map((module) => MODULE_ROUTES[module.key]));
  const functions: Tile[] = [
    ...(access.employees(user) ? [{ key: 'employees', testID: 'launcher-employees', label: t('modules.employees'), caption: t('modules.employees.body'), icon: 'people-outline' as IconName, route: '/employees' }] : []),
    ...(access.sites(user) ? [{ key: 'sites', testID: 'launcher-sites', label: t('entry.sites'), caption: t('modules.sites.body'), icon: 'business-outline' as IconName, route: '/ops/sites' }] : []),
    ...(access.incidents(user)
      ? [{ key: 'incidents', testID: 'launcher-incidents', label: t('entry.incidents'), caption: t('modules.incidents.body'), icon: 'warning-outline' as IconName, route: '/incidents', count: insights.incidentsOpen }]
      : []),
    ...(access.abandons(user) ? [{ key: 'abandons', testID: 'launcher-abandons', label: t('modules.abandons'), caption: t('modules.abandons.body'), icon: 'exit-outline' as IconName, route: '/abandons', count: count('abandons'), urgent: true }] : []),
    ...(access.attendance(user) && !shown.has('/attendance') ? [{ key: 'attendance', testID: 'launcher-attendance', label: t('modules.pointage'), caption: t('modules.pointage.short'), icon: 'time-outline' as IconName, route: '/attendance' }] : []),
    ...(access.leaves(user) && !shown.has('/drh/leaves') ? [{ key: 'leaves', testID: 'launcher-leaves', label: t('entry.leaves'), caption: t('modules.conges.short'), icon: 'calendar-outline' as IconName, route: '/drh/leaves', count: count('leaves') }] : []),
    ...(access.candidates(user) && !shown.has('/recruitment') ? [{ key: 'candidates', testID: 'launcher-candidates', label: t('modules.recrute'), caption: t('entry.candidates'), icon: 'person-add-outline' as IconName, route: '/recruitment' }] : []),
    ...(access.alerts(user)
      ? [{ key: 'alerts', testID: 'launcher-alerts', label: t('tabs.alerts'), caption: t('modules.alerts.body'), icon: 'notifications-outline' as IconName, route: '/alerts', count: count('alertsOpen'), urgent: (critical ?? 0) > 0 }]
      : []),
    ...(access.commercial(user)
      ? [
          { key: 'clients', testID: 'launcher-clients', label: t('commercial.clients'), caption: t('commercial.clients.body'), icon: 'briefcase-outline' as IconName, route: '/commercial/clients', count: counters.data?.commercial?.clientsActive ?? null },
          { key: 'prospects', testID: 'launcher-prospects', label: t('commercial.prospects'), caption: t('commercial.prospects.body'), icon: 'person-add-outline' as IconName, route: '/commercial/prospects', count: counters.data?.commercial?.prospects ?? null },
          { key: 'contracts', testID: 'launcher-contracts', label: t('commercial.contracts'), caption: t('commercial.contracts.body'), icon: 'ribbon-outline' as IconName, route: '/commercial/contracts' },
        ]
      : []),
    ...(access.billing(user)
      ? [
          { key: 'invoices', testID: 'launcher-invoices', label: t('billing.invoices'), caption: t('billing.invoices.body'), icon: 'receipt-outline' as IconName, route: '/billing/invoices' },
          { key: 'payments', testID: 'launcher-payments', label: t('billing.payments'), caption: t('billing.payments.body'), icon: 'cash-outline' as IconName, route: '/billing/payments' },
        ]
      : []),
    { key: 'tasks', testID: 'launcher-tasks', label: t('tabs.tasks'), caption: t('modules.tasks.body'), icon: 'checkbox-outline', route: '/tasks' },
    { key: 'cockpit', testID: 'launcher-cockpit', label: t('modules.cockpit'), caption: t('modules.cockpit.body'), icon: 'speedometer-outline', route: '/' },
    { key: 'profile', testID: 'launcher-profile', label: t('tabs.profile'), caption: t('modules.profile.body'), icon: 'person-circle-outline', route: '/profile' },
    { key: 'settings', testID: 'launcher-settings', label: t('modules.settings'), caption: t('modules.settings.body'), icon: 'settings-outline', route: '/settings' },
  ];
  const soon = soonTiles(user);
  const drh = insights.drh;
  const active = drh?.byStatus.find((entry) => entry.status === 'actif')?.count ?? null;

  return (
    <Screen testID="modules-screen" header={header}>
      <SectionHeader title={t('modules.section.modules')} />
      <Grid tiles={moduleTiles} go={go} />

      <SectionHeader title={t('modules.section.functions')} />
      <Grid tiles={functions} go={go} />

      <Pressable
        testID="launcher-reports"
        accessibilityRole="button"
        accessibilityLabel={`${t('modules.reports')}, ${t('modules.reports.body')}`}
        onPress={() => go('/stats')}
        style={({ pressed }) => [styles.reports, elevation.card, pressed && styles.pressed]}>
        <Ionicons name="trending-up-outline" size={28} color={colors.primary} />
        <View style={styles.reportsTexts}>
          <AppText variant="bodyStrong" color={colors.navy}>
            {t('modules.reports')}
          </AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {t('modules.reports.body')}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.navy} />
      </Pressable>

      {drh ? (
        <>
          <SectionHeader title={t('modules.drhSummary')} actionLabel={t('home.seeMore')} onAction={() => go('/drh')} />
          <MetricStrip
            testID="modules-drh-summary"
            metrics={[
              { key: 'total', label: t('drh.kpi.total'), value: String(drh.employeesTotal) },
              ...(active !== null ? [{ key: 'active', label: t('drh.kpi.active'), value: String(active), tone: 'success' as const }] : []),
              ...(access.leaves(user) ? [{ key: 'leaves', label: t('cockpit.leavesPending'), value: String(drh.leavesPending) }] : []),
            ]}
          />
        </>
      ) : null}

      {soon.length > 0 ? (
        <>
          <SectionHeader title={t('modules.section.unavailable')} hint={t('modules.section.unavailable.hint')} />
          <Grid tiles={soon} go={go} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  reports: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reportsTexts: { flex: 1, gap: 2 },
  pressed: { backgroundColor: colors.surfacePressed },
});
