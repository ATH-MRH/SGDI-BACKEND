import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCurrentUser } from '@/auth/AuthProvider';
import { AppText, Card, EmptyState, ListItem, Skeleton } from '@/components/ui';
import { useCockpit, type CockpitCard } from '@/features/cockpit/useCockpit';
import { visibleModules } from '@/features/modules';
import { t } from '@/i18n';
import { currentSiteLabel, societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, radius, spacing, toneColors } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

function KpiCard({ card, onPress }: { card: CockpitCard; onPress: () => void }) {
  const label = t(card.label);
  const value = card.state === 'ready' && card.value !== null ? String(card.value) : card.state === 'error' ? '—' : '';
  return (
    <Pressable
      testID={`kpi-${card.key}`}
      accessibilityRole="button"
      accessibilityLabel={card.state === 'error' ? `${label} : ${t('cockpit.unavailable')}` : `${label} : ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.kpi, pressed && styles.pressed]}>
      {card.state === 'loading' ? (
        <Skeleton height={30} width="50%" />
      ) : (
        <AppText variant="title" color={card.tone === 'neutral' ? colors.text : toneColors[card.tone].fg} numberOfLines={1}>
          {value}
        </AppText>
      )}
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={2}>
        {card.state === 'error' ? t('cockpit.unavailable') : label}
      </AppText>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const cockpit = useCockpit();
  const modules = visibleModules(user);
  const canChangeScope = scope.canChangeSociety || scope.canChangeSite;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={cockpit.isRefreshing} onRefresh={cockpit.refresh} tintColor={colors.primary} />}>
        <AppText variant="title" accessibilityRole="header">
          {t('home.greeting', { name: user?.full_name || user?.username || '' })}
        </AppText>

        <Card>
          <AppText variant="label" color={colors.textSecondary}>
            {t('home.context')}
          </AppText>
          {ready ? (
            <ListItem
              testID="home-scope"
              icon="business-outline"
              title={societyLabel(scope)}
              subtitle={currentSiteLabel(scope)}
              onPress={canChangeScope ? () => router.push('/scope') : undefined}
              trailing={
                canChangeScope ? (
                  <AppText variant="label" color={colors.primary}>
                    {t('home.context.change')}
                  </AppText>
                ) : undefined
              }
            />
          ) : (
            <Skeleton height={40} />
          )}
        </Card>

        {modules.length === 0 ? (
          <EmptyState icon="grid-outline" title={t('modules.empty.title')} body={t('modules.empty.body')} testID="home-no-module" />
        ) : cockpit.cards.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="heading" accessibilityRole="header">
              {cockpit.date ? t('cockpit.titleDated', { date: formatDate(cockpit.date) }) : t('home.cockpit.title')}
            </AppText>
            <View style={styles.grid} testID="cockpit-grid">
              {cockpit.cards.map((card) => (
                <KpiCard key={card.key} card={card} onPress={() => router.push(card.route as never)} />
              ))}
            </View>
          </View>
        ) : (
          <Card testID="cockpit-empty">
            <AppText variant="heading">{t('home.cockpit.title')}</AppText>
            <AppText color={colors.textSecondary}>{t('cockpit.none')}</AppText>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  kpi: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 88,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
