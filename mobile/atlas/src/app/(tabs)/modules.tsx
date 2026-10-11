import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { AppText, AtlasHeader, EmptyState, IconTile, Screen, SectionHeader, type IconName } from '@/components/ui';
import { access } from '@/features/access';
import { moduleEntries } from '@/features/entries';
import { visibleModules } from '@/features/modules';
import { t, type TranslationKey } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';

type Tile = { key: string; label: string; icon: IconName; onPress?: () => void; testID?: string; caption?: string };

function Launcher({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <View style={styles.grid}>
      {tiles.map((tile) =>
        tile.onPress ? (
          <Pressable
            key={tile.key}
            testID={tile.testID}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            onPress={tile.onPress}
            style={({ pressed }) => [styles.tile, elevation.card, pressed && styles.pressed]}>
            <IconTile icon={tile.icon} size={44} />
            <AppText variant="caption" color={colors.navy} numberOfLines={2} style={styles.tileLabel}>
              {tile.label}
            </AppText>
          </Pressable>
        ) : (
          <View key={tile.key} testID={tile.testID} accessible accessibilityLabel={`${tile.label}, ${tile.caption ?? ''}`} style={[styles.tile, styles.tileOff]}>
            <IconTile icon={tile.icon} tone="neutral" size={44} />
            <AppText variant="caption" color={colors.textMuted} numberOfLines={2} style={styles.tileLabel}>
              {tile.label}
            </AppText>
          </View>
        ),
      )}
    </View>
  );
}

/** Briques ATLAS qui n'ont pas encore d'écran mobile : affichées comme telles, jamais simulées. */
const NOT_ON_MOBILE: readonly { key: string; label: TranslationKey; icon: IconName }[] = [
  { key: 'documents', label: 'modules.documents', icon: 'folder-open-outline' },
  { key: 'rounds', label: 'modules.rounds', icon: 'walk-outline' },
  { key: 'equipment', label: 'modules.equipment', icon: 'cube-outline' },
  { key: 'finance', label: 'modules.finance', icon: 'cash-outline' },
  { key: 'reporting', label: 'modules.reporting', icon: 'bar-chart-outline' },
];

/**
 * Lanceur de modules. Les modules et fonctions viennent des droits du compte : ce qui n'est pas
 * accordé n'y figure pas. Les briques sans écran mobile sont listées à part, grisées.
 */
export default function ModulesScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const modules = visibleModules(user);
  const go = (route: string) => router.push(route as never);

  if (modules.length === 0) {
    return (
      <Screen scroll={false} testID="modules-screen" header={<AtlasHeader title={t('tabs.modules')} subtitle={t('modules.subtitle')} />}>
        <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="modules-empty" />
      </Screen>
    );
  }

  const moduleTiles: Tile[] = modules.map((module) => ({
    key: module.key,
    testID: `module-${module.key}`,
    label: t(module.title),
    icon: module.icon,
    onPress: () => router.push({ pathname: '/module/[key]', params: { key: module.key } }),
  }));
  const entries = [...new Map(modules.flatMap((module) => moduleEntries(user, module.key)).map((entry) => [entry.key, entry])).values()];
  const functionTiles: Tile[] = [
    { key: 'cockpit', label: t('modules.cockpit'), icon: 'speedometer-outline', onPress: () => go('/') },
    ...entries.map((entry) => ({ key: entry.key, testID: `launcher-${entry.key}`, label: t(entry.title), icon: entry.icon, onPress: () => go(entry.route) })),
    ...(access.alerts(user) ? [{ key: 'alerts', testID: 'launcher-alerts', label: t('tabs.alerts'), icon: 'notifications-outline' as IconName, onPress: () => go('/alerts') }] : []),
    { key: 'tasks', testID: 'launcher-tasks', label: t('tabs.tasks'), icon: 'checkbox-outline', onPress: () => go('/tasks') },
    { key: 'settings', testID: 'launcher-settings', label: t('modules.settings'), icon: 'settings-outline', onPress: () => go('/profile') },
  ];
  const unavailable: Tile[] = NOT_ON_MOBILE.map((item) => ({ key: item.key, label: t(item.label), icon: item.icon, caption: t('modules.unavailable') }));

  return (
    <Screen testID="modules-screen" header={<AtlasHeader title={t('tabs.modules')} subtitle={t('modules.subtitle')} />}>
      <SectionHeader title={t('modules.section.modules')} />
      <Launcher tiles={moduleTiles} />
      <SectionHeader title={t('modules.section.functions')} />
      <Launcher tiles={functionTiles} />
      <SectionHeader title={t('modules.section.unavailable')} hint={t('modules.section.unavailable.hint')} />
      <Launcher tiles={unavailable} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexBasis: '22%',
    flexGrow: 1,
    maxWidth: '31.5%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileOff: { backgroundColor: colors.surfaceSecondary, borderStyle: 'dashed', borderWidth: 1 },
  tileLabel: { textAlign: 'center', fontWeight: '600' },
  pressed: { backgroundColor: colors.surfacePressed },
});
