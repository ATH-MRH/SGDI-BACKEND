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
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, Badge, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorState, IncidentRow, SearchBar, SkeletonList } from '@/components/ui';
import { access } from '@/features/access';
import { isIncidentOpen } from '@/features/cockpit/useCockpitInsights';
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

type Filter = 'all' | 'open' | 'critique' | 'elevee';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

export default function IncidentsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
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
  // Toute la liste du périmètre est déjà chargée : recherche et filtres s'appliquent sur l'appareil.
  const needle = normalize(search.trim());
  const shown = incidents.filter(
    (incident) =>
      (filter === 'all' || (filter === 'open' ? isIncidentOpen(incident) : incident.severity === filter)) &&
      (!needle || normalize([incident.subject, incident.description, incidentTypeLabel(incident.type), siteName(incident.siteId) ?? ''].join(' ')).includes(needle)),
  );

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID="incidents-screen">
        <AtlasHeader back title={t('entry.incidents')} subtitle={t('incidents.subtitle')} />
        {query.isPending ? (
          <SkeletonList />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(incident) => String(incident.id)}
            contentContainerStyle={styles.content}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={styles.header}>
                <PendingReports />
                <SearchBar testID="incidents-search" value={search} onChangeText={setSearch} placeholder={t('incidents.search')} />
                <Segmented
                  testID="incidents-filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: t('alerts.filter.all') },
                    { value: 'open', label: t('incidents.filter.open') },
                    { value: 'critique', label: t('incidents.severity.critique') },
                    { value: 'elevee', label: t('incidents.severity.elevee') },
                  ]}
                />
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                icon="warning-outline"
                title={t('incidents.empty.title')}
                body={needle ? t('search.noResult', { q: search.trim() }) : t('incidents.empty.body')}
                testID="incidents-empty"
              />
            }
            renderItem={({ item }) => (
              <IncidentRow
                testID={`incident-${item.id}`}
                tone={incidentSeverity(item.severity)?.tone ?? 'neutral'}
                title={item.subject || incidentTypeLabel(item.type)}
                detail={[incidentTypeLabel(item.type), formatDate(item.date), item.time, siteName(item.siteId)].filter(Boolean).join(' · ')}
                footer={
                  <>
                    {item.description ? (
                      <AppText variant="caption" color={colors.text} numberOfLines={4}>
                        {item.description}
                      </AppText>
                    ) : null}
                    <View style={styles.badges}>
                      {item.severity ? <StatusBadge status={incidentSeverity(item.severity)} fallback={item.severity} /> : null}
                      <Badge label={item.status} />
                    </View>
                  </>
                }
              />
            )}
          />
        )}
        {access.createIncident(user) ? (
          <View style={styles.footer}>
            <Button testID="incident-new" icon="add" label={t('incidents.new')} onPress={() => router.push('/incidents/new' as never)} />
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
      <Banner tone="warning" message={t('offline.notice')} />
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
  header: { gap: spacing.md, marginBottom: spacing.md },
  pending: { gap: spacing.sm },
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  badges: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  footer: { padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
