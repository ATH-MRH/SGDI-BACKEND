import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchBrqSituation, type BrqItem } from '@/api/domains/brq';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Card, EmptyState, ErrorState, Kpi, ListItem, Loader, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { presenceStatus } from '@/features/status';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

type Tab = 'absences' | 'abandons' | 'leaving';

/** Bulletin de renseignement quotidien : sections verticales, pas de tableau large. */
export default function BrqScreen() {
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [tab, setTab] = useState<Tab>('absences');
  const allowed = access.brq(user);
  const query = useQuery({
    queryKey: queryKeys.scoped(scope.society, scope.site?.id ?? null, 'brq'),
    queryFn: () => fetchBrqSituation(api, scopeParams(scope)),
    enabled: allowed && ready,
  });
  const data = query.data;
  const items: BrqItem[] = data ? data[tab] : [];

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="brq-screen">
        <ScreenHeader title={t('entry.brq')} subtitle={data ? formatDate(data.date) : undefined} />
        {query.isPending ? (
          <Loader />
        ) : query.error || !data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} testID="brq-error" />
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
            <View style={styles.kpis} testID="brq-kpis">
              <Kpi testID="brq-expected" label={t('cockpit.expected')} value={data.kpis.expected} />
              <Kpi testID="brq-present" label={t('cockpit.present')} value={data.kpis.present} tone="success" />
              <Kpi testID="brq-absent" label={t('cockpit.absent')} value={data.kpis.absent} tone="danger" />
              <Kpi label={t('cockpit.notPointed')} value={data.kpis.notPointed} tone="warning" />
              <Kpi label={t('cockpit.abandons')} value={data.kpis.abandons} tone="danger" />
              <Kpi
                testID="brq-coverage"
                label={t('brq.coverage')}
                value={data.kpis.coveragePct === null ? '—' : `${data.kpis.coveragePct} %`}
              />
            </View>

            {data.notes.map((note) => (
              <AppText key={note} variant="caption" color={colors.textSecondary}>
                {note}
              </AppText>
            ))}

            <Segmented
              testID="brq-tab"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'absences', label: t('brq.tab.absences', { count: data.absences.length }) },
                { value: 'abandons', label: t('brq.tab.abandons', { count: data.abandons.length }) },
                { value: 'leaving', label: t('brq.tab.leaving', { count: data.leaving.length }) },
              ]}
            />

            {items.length === 0 ? (
              <EmptyState title={t('brq.empty')} testID="brq-empty" />
            ) : (
              <Card>
                {items.map((item) => (
                  <ListItem
                    key={item.key}
                    testID={`brq-item-${item.key}`}
                    title={item.name || item.matricule}
                    subtitle={[item.matricule, item.position, item.site, item.exitDate ? formatDate(item.exitDate) : null].filter(Boolean).join(' · ')}
                    trailing={<StatusBadge status={presenceStatus(item.state)} fallback={item.state} />}
                  />
                ))}
              </Card>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
