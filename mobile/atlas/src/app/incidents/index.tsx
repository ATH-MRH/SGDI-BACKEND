import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchIncidents, INCIDENT_TYPES } from '@/api/domains/incidents';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { canAccessSociety } from '@/auth/permissions';
import { sameSociety } from '@/api/domains/ops';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Loader, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { incidentSeverity } from '@/features/status';
import { t, type TranslationKey } from '@/i18n';
import { useOffline } from '@/offline/OfflineProvider';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

/** Libellé traduit d'un type connu ; une valeur libre saisie ailleurs est affichée telle quelle. */
export function incidentTypeLabel(type: string): string {
  return (INCIDENT_TYPES as readonly string[]).includes(type) ? t(`incidents.type.${type}` as TranslationKey) : type;
}

export default function IncidentsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const allowed = access.incidents(user);
  const query = useQuery({
    queryKey: queryKeys.scoped(null, null, 'incidents'),
    queryFn: () => fetchIncidents(api),
    enabled: allowed && ready,
  });

  // Le backend filtre déjà par société ; on restreint ensuite au contexte choisi.
  const incidents = (query.data ?? []).filter(
    (incident) =>
      canAccessSociety(user, incident.society) &&
      (!scope.society || sameSociety(incident.society, scope.society)) &&
      (!scope.site || incident.siteId === scope.site.id),
  );
  const siteName = (id: number | null) => scope.sites.find((site) => site.id === id)?.name ?? null;

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID="incidents-screen">
        <ScreenHeader title={t('entry.incidents')} />
        {query.isPending ? (
          <Loader />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <FlatList
            data={incidents}
            keyExtractor={(incident) => String(incident.id)}
            contentContainerStyle={styles.content}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
            ListHeaderComponent={<PendingReports />}
            ListEmptyComponent={<EmptyState icon="warning-outline" title={t('incidents.empty.title')} body={t('incidents.empty.body')} testID="incidents-empty" />}
            renderItem={({ item }) => (
              <Card testID={`incident-${item.id}`}>
                <AppText variant="bodyStrong">{item.subject || incidentTypeLabel(item.type)}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {[incidentTypeLabel(item.type), formatDate(item.date), item.time, siteName(item.siteId)].filter(Boolean).join(' · ')}
                </AppText>
                {item.description ? <AppText numberOfLines={4}>{item.description}</AppText> : null}
                <View style={styles.badges}>
                  {item.severity ? <StatusBadge status={incidentSeverity(item.severity)} fallback={item.severity} /> : null}
                  <Badge label={item.status} />
                </View>
              </Card>
            )}
          />
        )}
        {access.createIncident(user) ? (
          <View style={styles.footer}>
            <Button testID="incident-new" label={t('incidents.new')} onPress={() => router.push('/incidents/new' as never)} />
          </View>
        ) : null}
      </SafeAreaView>
    </Gate>
  );
}

const STATE_TONE = { pending: 'warning', syncing: 'info', failed: 'danger', conflict: 'danger' } as const;

/** Déclarations saisies sans réseau : visibles, mais clairement distinctes des incidents enregistrés. */
function PendingReports() {
  const offline = useOffline();
  const [discarding, setDiscarding] = useState<string | null>(null);
  if (offline.items.length === 0) return null;
  return (
    <View style={styles.pending} testID="offline-queue">
      <AppText variant="label" accessibilityRole="header">
        {t('offline.title', { count: offline.items.length })}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary}>
        {t('offline.notice')}
      </AppText>
      {offline.items.map((item) => (
        <Card key={item.id} testID={`offline-${item.id}`}>
          <AppText variant="bodyStrong">{item.payload.subject}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {[incidentTypeLabel(item.payload.type), formatDate(item.payload.date), item.payload.time].join(' · ')}
          </AppText>
          <Badge label={t(`offline.state.${item.state}`)} tone={STATE_TONE[item.state]} testID={`offline-state-${item.id}`} />
          {(item.state === 'failed' || item.state === 'conflict') && item.error ? (
            <AppText variant="caption" color={colors.danger}>
              {item.error}
            </AppText>
          ) : null}
          {item.state === 'syncing' ? null : (
            <View style={styles.badges}>
              <Button testID={`offline-retry-${item.id}`} variant="secondary" label={t('offline.retry')} onPress={() => void offline.retry(item.id)} />
              <Button testID={`offline-discard-${item.id}`} variant="danger" label={t('offline.discard')} onPress={() => setDiscarding(item.id)} />
            </View>
          )}
        </Card>
      ))}
      <ConfirmDialog
        testID="offline-discard-confirm"
        visible={discarding !== null}
        destructive
        title={t('offline.discard.confirm')}
        confirmLabel={t('offline.discard')}
        onConfirm={() => {
          if (discarding) void offline.discard(discarding);
          setDiscarding(null);
        }}
        onCancel={() => setDiscarding(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pending: { gap: spacing.sm, marginBottom: spacing.lg },
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  badges: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  footer: { padding: spacing.lg },
});
