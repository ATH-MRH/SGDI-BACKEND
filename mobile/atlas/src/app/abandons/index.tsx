import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchAbandonEvents } from '@/api/domains/attendance';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AppText, Button, Card, EmptyState, ErrorState, Loader, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDateTime, formatMinutes, formatTime } from '@/utils/format';

export default function AbandonsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const allowed = access.abandons(user);
  const query = useQuery({
    queryKey: queryKeys.scoped(scope.society, scope.site?.id ?? null, 'abandons', 'list'),
    queryFn: () => fetchAbandonEvents(api, { ...scopeParams(scope), page_size: 50 }),
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID="abandons-screen">
        <ScreenHeader title={t('entry.abandons')} />
        {query.isPending ? (
          <Loader />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <FlatList
            data={query.data.items}
            keyExtractor={(event) => String(event.eventId)}
            contentContainerStyle={styles.content}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState icon="exit-outline" title={t('abandons.empty.title')} body={t('abandons.empty.body')} testID="abandons-empty" />}
            renderItem={({ item }) => (
              <Card testID={`abandon-${item.eventId}`}>
                <AppText variant="bodyStrong">{item.employeeName || item.matricule || t('abandons.employee', { id: item.employeeId })}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {[item.matricule, item.position, item.siteName].filter(Boolean).join(' · ')}
                </AppText>
                <AppText>
                  {t('abandons.line', {
                    departure: formatDateTime(item.departureAt),
                    end: formatTime(item.scheduledEndAt) || '—',
                    remaining: formatMinutes(item.remainingMinutes) || '—',
                  })}
                </AppText>
                {item.observation ? <AppText color={colors.textSecondary}>{item.observation}</AppText> : null}
                {item.recordedBy ? (
                  <AppText variant="caption" color={colors.textMuted}>
                    {t('abandons.declaredBy', { name: item.recordedBy })}
                  </AppText>
                ) : null}
              </Card>
            )}
          />
        )}
        {access.declareAbandon(user) ? (
          <View style={styles.footer}>
            <Button testID="abandon-new" label={t('abandons.declare')} onPress={() => router.push('/abandons/new' as never)} />
          </View>
        ) : null}
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  footer: { padding: spacing.lg },
});
