import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Client } from '@/api/domains/commercial';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AtlasHeader, Badge, QueryList, RecordRow, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useAllClients } from '@/features/commercial/hooks';
import { rawStatusLabel } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

type Filter = 'all' | 'valide' | 'brouillon';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

const hasContract = (row: Client) => Boolean(row.contractStart || row.contractEnd || row.contractStatus);

/**
 * Contrats clients. ATLAS range le contrat dans la fiche client (dates, statut DC, sites) :
 * l'écran liste les clients qui en portent un, triés par date de fin.
 */
export default function ContractsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const clients = useAllClients();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const needle = normalize(search.trim());
  const rows = (clients.data ?? [])
    .filter(hasContract)
    .filter((row) => filter === 'all' || row.contractStatus === filter)
    .filter((row) => !needle || normalize([row.name, row.society, ...row.siteNames].filter(Boolean).join(' ')).includes(needle))
    .sort((a, b) => (a.contractEnd ?? '9999').localeCompare(b.contractEnd ?? '9999'));

  return (
    <Gate allowed={access.commercial(user)}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="contracts-screen">
        <AtlasHeader back title={t('commercial.contracts')} subtitle={t('contracts.subtitle')} />
        <QueryList
          testID="contracts-list"
          state={clients}
          items={rows}
          keyOf={(row) => String(row.id)}
          emptyTitle={t('contracts.empty.title')}
          emptyBody={needle ? t('search.noResult', { q: search.trim() }) : undefined}
          header={
            <View style={styles.header}>
              <SearchBar testID="contracts-search" value={search} onChangeText={setSearch} placeholder={t('contracts.search')} />
              <Segmented
                testID="contracts-filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('alerts.filter.all') },
                  { value: 'valide', label: t('contracts.validated') },
                  { value: 'brouillon', label: t('quotes.status.draft') },
                ]}
              />
            </View>
          }
          renderItem={(row) => (
            <RecordRow
              testID={`contract-${row.id}`}
              icon="ribbon-outline"
              title={row.name}
              subtitle={[row.society, row.sitesCount !== null ? t('clients.sites', { count: row.sitesCount }) : null].filter(Boolean).join(' · ') || null}
              detail={
                [row.contractStart ? t('contracts.from', { date: formatDate(row.contractStart) }) : null, row.contractEnd ? t('contracts.until', { date: formatDate(row.contractEnd) }) : null, row.contractDuration]
                  .filter(Boolean)
                  .join(' · ') || null
              }
              badge={row.contractStatus ? <Badge label={rawStatusLabel(row.contractStatus)} tone={row.contractStatus === 'valide' ? 'success' : 'neutral'} /> : null}
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
