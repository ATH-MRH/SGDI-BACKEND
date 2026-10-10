import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchBoard, type BoardItem } from '@/api/domains/attendance';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, ListItem, PagedList, ScreenHeader, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { presenceStatus } from '@/features/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';

const FILTERS = ['all', 'present', 'absent', 'non_pointe'] as const;
type Filter = (typeof FILTERS)[number];

/** Effectifs et pointage du jour, tels que calculés par le moteur de pointage ATLAS. */
export default function AttendanceScreen() {
  const params = useLocalSearchParams<{ status?: string; site_id?: string }>();
  const user = useCurrentUser();
  const router = useRouter();
  const { scope, ready } = useScope();
  const initial = FILTERS.includes(params.status as Filter) ? (params.status as Filter) : 'all';
  const [filter, setFilter] = useState<Filter>(initial);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const allowed = access.attendance(user);

  // Un site passé par lien n'est retenu que s'il fait partie du périmètre connu.
  const linkedSite = Number(params.site_id);
  const siteId = scope.sites.some((site) => site.id === linkedSite) ? linkedSite : scope.site?.id;
  const base = { ...scopeParams(scope), site_id: siteId };

  const list = usePagedList<BoardItem>({
    queryKey: queryKeys.scoped(scope.society, siteId ?? null, 'board', filter, q),
    fetchPage: async (page) => {
      const board = await fetchBoard(api, { ...base, status: filter === 'all' ? undefined : filter, q: q || undefined, page, page_size: 25 });
      return { items: board.items, total: board.total, page: board.page, page_size: board.page_size, pages: board.pages };
    },
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="attendance-screen">
        <ScreenHeader title={t('entry.attendance')} subtitle={scope.sites.find((site) => site.id === siteId)?.name ?? undefined} />
        <View style={styles.filters}>
          <SearchBar testID="attendance-search" value={search} onChangeText={setSearch} placeholder={t('attendance.search')} />
          <Segmented
            testID="attendance-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('alerts.filter.all') },
              { value: 'present', label: t('status.present') },
              { value: 'absent', label: t('status.absent') },
              { value: 'non_pointe', label: t('status.notPointed') },
            ]}
          />
        </View>
        <PagedList
          testID="attendance-list"
          list={list}
          keyOf={(row) => `${row.employeeId}-${row.siteId}`}
          emptyTitle={t('attendance.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          renderItem={(row) => (
            <Card>
              <ListItem
                testID={`attendance-${row.employeeId}`}
                title={row.name}
                subtitle={[
                  row.matricule,
                  row.site,
                  row.arrival ? t('attendance.arrival', { time: row.arrival }) : null,
                  row.departure ? t('attendance.departure', { time: row.departure }) : null,
                  row.anomalies.length ? t('attendance.anomalies', { count: row.anomalies.length }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={<StatusBadge status={presenceStatus(row.status)} fallback={row.status} />}
                onPress={
                  row.presenceId !== null && access.correctAttendance(user, row.closed)
                    ? () =>
                        router.push({
                          pathname: '/attendance-correct',
                          params: { presence_id: String(row.presenceId), name: row.name, status: row.status, closed: row.closed ? '1' : '' },
                        } as never)
                    : undefined
                }
              />
            </Card>
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
});
