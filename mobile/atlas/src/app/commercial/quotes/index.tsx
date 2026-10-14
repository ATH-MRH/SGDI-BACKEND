import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchQuotesPage, QUOTE_STATUSES, type Quote } from '@/api/domains/commercial';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AtlasHeader, PagedList, RecordRow, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { quoteStatus } from '@/features/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney } from '@/utils/format';

/** Devis (offres) du périmètre : statut, client, recherche et pagination appliqués par le serveur. */
export default function QuotesScreen() {
  const params = useLocalSearchParams<{ status?: string; client_id?: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const linked = (QUOTE_STATUSES as readonly string[]).includes(params.status ?? '') ? (params.status as string) : 'all';
  const [status, setStatus] = useState(linked);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const clientId = Number(params.client_id) > 0 ? Number(params.client_id) : undefined;
  const allowed = access.commercial(user);

  const list = usePagedList<Quote>({
    queryKey: queryKeys.scoped(scope.society, null, 'quotes', status, clientId ?? '*', q),
    fetchPage: (page) =>
      fetchQuotesPage(api, { q: q || undefined, status: status === 'all' ? undefined : status, client_id: clientId, society: scope.society ?? undefined, page }),
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="quotes-screen">
        <AtlasHeader back title={t('commercial.quotes')} subtitle={list.total > 0 ? t('quotes.count', { count: list.total, society: societyLabel(scope) }) : societyLabel(scope)} />
        <PagedList
          testID="quotes-list"
          list={list}
          keyOf={(row) => String(row.id)}
          emptyTitle={t('quotes.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          header={
            <View style={styles.header}>
              <SearchBar testID="quotes-search" value={search} onChangeText={setSearch} placeholder={t('quotes.search')} />
              <Segmented
                testID="quotes-status"
                value={status}
                onChange={setStatus}
                options={[{ value: 'all', label: t('alerts.filter.all') }, ...QUOTE_STATUSES.map((value) => ({ value, label: t(quoteStatus(value)?.label ?? 'common.none') }))]}
              />
            </View>
          }
          renderItem={(row) => (
            <RecordRow
              testID={`quote-${row.id}`}
              icon="document-text-outline"
              title={row.number || t('quotes.draftNumber')}
              subtitle={[row.clientName, formatDate(row.date)].filter(Boolean).join(' · ') || null}
              detail={row.validUntil ? t('quotes.validUntil', { date: formatDate(row.validUntil) }) : row.object}
              amount={formatMoney(row.totalTtc)}
              badge={<StatusBadge status={quoteStatus(row.status)} fallback={row.status} />}
              onPress={() => router.push(`/commercial/quotes/${row.id}` as never)}
            />
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.md, marginBottom: spacing.md },
});
