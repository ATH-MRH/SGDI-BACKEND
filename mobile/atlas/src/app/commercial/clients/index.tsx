import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchClientsPage, type Client } from '@/api/domains/commercial';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AtlasHeader, Badge, PagedList, RecordRow, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { clientStatusTone, rawStatusLabel } from '@/features/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

type Filter = 'all' | 'actif' | 'inactif';

/** Clients du périmètre : recherche, statut et pagination faits par le serveur. */
export default function ClientsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const allowed = access.commercial(user);

  const list = usePagedList<Client>({
    queryKey: queryKeys.scoped(scope.society, null, 'clients', filter, q),
    fetchPage: (page) => fetchClientsPage(api, { q: q || undefined, status: filter === 'all' ? undefined : filter, society: scope.society ?? undefined, page }),
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="clients-screen">
        <AtlasHeader back title={t('commercial.clients')} subtitle={list.total > 0 ? t('clients.count', { count: list.total, society: societyLabel(scope) }) : societyLabel(scope)} />
        <PagedList
          testID="clients-list"
          list={list}
          keyOf={(row) => String(row.id)}
          emptyTitle={t('clients.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          header={
            <View style={styles.header}>
              <SearchBar testID="clients-search" value={search} onChangeText={setSearch} placeholder={t('clients.search')} />
              <Segmented
                testID="clients-filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('alerts.filter.all') },
                  { value: 'actif', label: t('clients.status.active') },
                  { value: 'inactif', label: t('clients.status.inactive') },
                ]}
              />
            </View>
          }
          renderItem={(row) => (
            <RecordRow
              testID={`client-${row.id}`}
              icon="briefcase-outline"
              title={row.name}
              subtitle={[row.contactName, row.phone ?? row.email].filter(Boolean).join(' · ') || row.society}
              detail={[row.society, row.sitesCount !== null ? t('clients.sites', { count: row.sitesCount }) : null].filter(Boolean).join(' · ') || null}
              badge={<Badge label={rawStatusLabel(row.status)} tone={clientStatusTone(row.status)} />}
              onPress={() => router.push(`/commercial/clients/${row.id}` as never)}
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
