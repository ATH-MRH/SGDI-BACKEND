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
import {
  AppText,
  AtlasHeader,
  BottomSheet,
  ChoiceGroup,
  EmployeeRow,
  FilterButton,
  HeaderAction,
  PagedList,
  RingGauge,
  SearchBar,
  Skeleton,
} from '@/components/ui';
import { access } from '@/features/access';
import { rateTone, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { presenceStatus } from '@/features/status';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { currentSiteLabel, siteLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, elevation, radius, spacing, toneColors, type Tone } from '@/theme/tokens';
import { formatDate, formatTime, localDate } from '@/utils/format';

const FILTERS = ['all', 'present', 'absent', 'non_pointe'] as const;
type Filter = (typeof FILTERS)[number];

/** Jours consultables : aujourd'hui et les six jours précédents. */
const DAYS_BACK = 7;

function Figure({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label} : ${value}`}>
      <View style={[styles.dot, { backgroundColor: tone === 'neutral' ? colors.steel : toneColors[tone].fg }]} />
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.figureLabel}>
        {label}
      </AppText>
      <AppText variant="label" color={colors.navy} style={styles.figureValue}>
        {value}
      </AppText>
    </View>
  );
}

/** Pointage : effectifs du jour (ou d'un jour récent), tels que calculés par le moteur de pointage ATLAS. */
export default function AttendanceScreen() {
  const params = useLocalSearchParams<{ status?: string; site_id?: string }>();
  const user = useCurrentUser();
  const router = useRouter();
  const { scope, ready } = useScope();
  const linkedStatus = FILTERS.includes(params.status as Filter) ? (params.status as Filter) : 'all';
  const [filter, setFilter] = useState<Filter>(linkedStatus);
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState(false);
  const [pickedSite, setPickedSite] = useState<number | null>(null);
  const [day, setDay] = useState<string>(localDate(0));
  const q = useDebouncedValue(search.trim());
  const allowed = access.attendance(user);

  // Un lien (cockpit, fiche site) impose son filtre ; la barre de navigation rouvre l'écran sans filtre.
  const link = `${linkedStatus}|${params.site_id ?? ''}`;
  const [seenLink, setSeenLink] = useState(link);
  if (seenLink !== link) {
    setSeenLink(link);
    setFilter(linkedStatus);
    setPickedSite(null);
  }

  // Un site passé par lien ou choisi n'est retenu que s'il fait partie du périmètre connu.
  const linkedSite = Number(params.site_id);
  const wanted = pickedSite ?? (Number.isFinite(linkedSite) ? linkedSite : null);
  const siteId = scope.sites.some((site) => site.id === wanted) ? (wanted as number) : scope.site?.id;
  const today = localDate(0);
  const presenceDate = day === today ? undefined : day;
  const base = { ...scopeParams(scope), site_id: siteId, presence_date: presenceDate };

  // Synthèse sur tout le périmètre, indépendante du filtre et de la recherche.
  const summary = useQuery({
    queryKey: queryKeys.scoped(scope.society, siteId ?? null, 'board', 'summary', day),
    queryFn: () => fetchBoard(api, { ...base, page_size: 1 }),
    enabled: allowed && ready,
  });
  const list = usePagedList<BoardItem>({
    queryKey: queryKeys.scoped(scope.society, siteId ?? null, 'board', filter, q, day),
    fetchPage: async (page) => {
      const board = await fetchBoard(api, { ...base, status: filter === 'all' ? undefined : filter, q: q || undefined, page, page_size: 25 });
      return { items: board.items, total: board.total, page: board.page, page_size: board.page_size, pages: board.pages };
    },
    enabled: allowed && ready,
  });
  const kpi = summary.data?.kpi ?? null;
  const rate = presenceRate(kpi);
  const siteName = scope.sites.find((site) => site.id === siteId)?.name ?? currentSiteLabel(scope);
  const filtered = siteId !== scope.site?.id || day !== today;
  const days = Array.from({ length: DAYS_BACK }, (_, index) => localDate(-index));
  const siteChoices = [
    { value: 0, label: scope.site ? siteLabel(scope.site) : t('scope.allSites') },
    ...scope.sites.filter((site) => site.id !== scope.site?.id).slice(0, 30).map((site) => ({ value: site.id, label: siteLabel(site) })),
  ];

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="attendance-screen">
        <AtlasHeader
          title={t('tabs.attendance')}
          subtitle={[siteName, formatDate(summary.data?.date)].filter(Boolean).join(' · ')}
          trailing={<HeaderAction testID="attendance-filters" icon="options-outline" label={t('common.filters')} badge={filtered} onPress={() => setSheet(true)} />}
        />
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
                  <RingGauge size={104} thickness={12} ratio={rate} tone={rateTone(rate)} label={`${kpi.present}/${kpi.expected}`} caption={t('status.present')} />
                  <View style={styles.figures}>
                    <Figure label={t('cockpit.absent')} value={kpi.absent} tone="danger" />
                    <Figure label={t('ops.late')} value={kpi.late} tone="warning" />
                    <Figure label={t('cockpit.notPointed')} value={kpi.not_pointed} tone="warning" />
                    <Figure label={t('ops.onLeave')} value={kpi.conge + kpi.maladie} tone="info" />
                  </View>
                </View>
              ) : summary.isPending ? (
                <View style={[styles.summary, elevation.card]}>
                  <Skeleton height={104} width={104} round />
                  <View style={styles.skeletonLines}>
                    <Skeleton height={12} />
                    <Skeleton height={12} width="80%" />
                    <Skeleton height={12} width="60%" />
                  </View>
                </View>
              ) : null}
              <View style={styles.searchRow}>
                <View style={styles.search}>
                  <SearchBar testID="attendance-search" value={search} onChangeText={setSearch} placeholder={t('attendance.search')} />
                </View>
                <FilterButton testID="attendance-filter-button" label={day === today ? t('attendance.today') : shortDate(day)} icon="calendar-outline" active={day !== today} onPress={() => setSheet(true)} />
              </View>
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
              position={row.position || null}
              detail={
                [
                  row.site || null,
                  row.departure ? t('attendance.departure', { time: formatTime(row.departure) || row.departure }) : null,
                  row.anomalies.length ? t('attendance.anomalies', { count: row.anomalies.length }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null
              }
              time={row.arrival ? formatTime(row.arrival) || row.arrival : null}
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
        <BottomSheet
          testID="attendance-sheet"
          visible={sheet}
          title={t('common.filters')}
          onClose={() => setSheet(false)}
          resetLabel={t('common.reset')}
          onReset={() => {
            setDay(today);
            setPickedSite(null);
            setFilter('all');
          }}
          actionLabel={t('common.apply')}
          onAction={() => setSheet(false)}>
          <ChoiceGroup
            testID="attendance-day"
            label={t('attendance.filter.date')}
            value={day}
            onChange={setDay}
            options={days.map((date) => ({ value: date, label: date === today ? t('attendance.today') : `${t(weekdayKey(date))} ${shortDate(date)}` }))}
          />
          {scope.sites.length > 1 ? (
            <ChoiceGroup
              testID="attendance-site"
              label={t('attendance.filter.site')}
              value={siteId === undefined || siteId === scope.site?.id ? 0 : siteId}
              onChange={(value) => setPickedSite(value === 0 ? null : value)}
              options={siteChoices}
            />
          ) : null}
          <ChoiceGroup
            testID="attendance-status"
            label={t('attendance.filter.status')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('alerts.filter.all') },
              { value: 'present', label: t('status.present') },
              { value: 'absent', label: t('status.absent') },
              { value: 'non_pointe', label: t('status.notPointed') },
            ]}
          />
        </BottomSheet>
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
  figures: { flex: 1, gap: spacing.sm },
  figure: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  figureLabel: { flex: 1 },
  figureValue: { fontVariant: ['tabular-nums'] },
  skeletonLines: { flex: 1, gap: spacing.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: { flex: 1 },
});
