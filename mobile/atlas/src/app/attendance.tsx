import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchBoard, presenceRate, type BoardItem } from '@/api/domains/attendance';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, EmployeeRow, PagedList, RingGauge, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { presenceStatus } from '@/features/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { currentSiteLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, elevation, radius, spacing, toneColors, type Tone } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

const FILTERS = ['all', 'present', 'absent', 'non_pointe'] as const;
type Filter = (typeof FILTERS)[number];

function Figure({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label} : ${value}`}>
      <AppText variant="kpi" color={tone === 'neutral' ? colors.navy : toneColors[tone].fg} style={styles.figureValue}>
        {value}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

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

  // Synthèse du jour sur tout le périmètre, indépendante du filtre et de la recherche.
  const summary = useQuery({
    queryKey: queryKeys.scoped(scope.society, siteId ?? null, 'board', 'summary'),
    queryFn: () => fetchBoard(api, { ...base, page_size: 1 }),
    enabled: allowed && ready,
  });
  const list = usePagedList<BoardItem>({
    queryKey: queryKeys.scoped(scope.society, siteId ?? null, 'board', filter, q),
    fetchPage: async (page) => {
      const board = await fetchBoard(api, { ...base, status: filter === 'all' ? undefined : filter, q: q || undefined, page, page_size: 25 });
      return { items: board.items, total: board.total, page: board.page, page_size: board.page_size, pages: board.pages };
    },
    enabled: allowed && ready,
  });
  const kpi = summary.data?.kpi ?? null;
  const rate = presenceRate(kpi);
  const siteName = scope.sites.find((site) => site.id === siteId)?.name ?? currentSiteLabel(scope);

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="attendance-screen">
        <AtlasHeader back title={t('entry.attendance')} subtitle={[siteName, formatDate(summary.data?.date)].filter(Boolean).join(' · ')} />
        <PagedList
          testID="attendance-list"
          list={list}
          keyOf={(row) => `${row.employeeId}-${row.siteId}`}
          emptyTitle={t('attendance.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          header={
            <View style={styles.top}>
              {kpi ? (
                <View style={[styles.summary, elevation.card]} testID="attendance-summary">
                  <RingGauge
                    size={104}
                    thickness={11}
                    ratio={rate}
                    tone={rate !== null && rate < 0.75 ? 'danger' : rate !== null && rate < 0.9 ? 'warning' : 'success'}
                    label={`${kpi.present}/${kpi.expected}`}
                    caption={t('status.present')}
                  />
                  <View style={styles.figures}>
                    <Figure label={t('cockpit.absent')} value={kpi.absent} tone="danger" />
                    <Figure label={t('ops.late')} value={kpi.late} tone="warning" />
                    <Figure label={t('cockpit.notPointed')} value={kpi.not_pointed} tone="warning" />
                    <Figure label={t('ops.onLeave')} value={kpi.conge + kpi.maladie} tone="info" />
                  </View>
                </View>
              ) : null}
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
          }
          renderItem={(row) => (
            <EmployeeRow
              testID={`attendance-${row.employeeId}`}
              employeeId={access.employees(user) ? row.employeeId : null}
              name={row.name}
              code={row.matricule}
              position={row.position || row.site}
              detail={
                [
                  row.arrival ? t('attendance.arrival', { time: row.arrival }) : null,
                  row.departure ? t('attendance.departure', { time: row.departure }) : null,
                  row.anomalies.length ? t('attendance.anomalies', { count: row.anomalies.length }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null
              }
              badge={<StatusBadge status={presenceStatus(row.status)} fallback={row.status} />}
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
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { gap: spacing.md, marginBottom: spacing.md },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  figures: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  figure: { width: '50%', gap: 2 },
  figureValue: { fontSize: 22, lineHeight: 26 },
});
