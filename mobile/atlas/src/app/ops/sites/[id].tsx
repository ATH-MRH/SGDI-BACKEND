import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchBoard, presenceRate } from '@/api/domains/attendance';
import { fetchSiteDetail, fetchSitePlanning } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import {
  ActionTile,
  AppText,
  AtlasHeader,
  Card,
  ChartCard,
  Chip,
  EmployeeRow,
  ErrorState,
  IconTile,
  InfoRow,
  KpiCard,
  ListItem,
  Loader,
  RingGauge,
  Screen,
  SectionHeader,
  StatLine,
} from '@/components/ui';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';
import { formatDate, localDate } from '@/utils/format';

const AGENTS_SHOWN = 12;

export default function SiteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const siteId = Number(id);
  const user = useCurrentUser();
  const allowed = access.sites(user) && Number.isInteger(siteId) && siteId > 0;
  const withAttendance = access.attendance(user);
  const go = (route: string) => router.push(route as never);

  const detail = useQuery({ queryKey: ['site', siteId], queryFn: () => fetchSiteDetail(api, siteId), enabled: allowed });
  const board = useQuery({
    queryKey: ['site', siteId, 'board'],
    queryFn: () => fetchBoard(api, { site_id: siteId, page_size: 1 }),
    enabled: allowed && withAttendance,
  });
  const planning = useQuery({
    queryKey: ['site', siteId, 'planning'],
    queryFn: () => fetchSitePlanning(api, siteId, localDate(0), localDate(6)),
    enabled: allowed && detail.isSuccess && withAttendance,
  });
  const data = detail.data;
  const kpi = board.data?.kpi;
  const rate = presenceRate(kpi);
  const coverage = data && data.contractualStaff > 0 ? Math.min(1, data.realizedStaff / data.contractualStaff) : null;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="site-detail" header={<AtlasHeader back title={data?.site.name ?? t('entry.sites')} subtitle={data?.site.society ?? undefined} />}>
        {detail.isPending ? (
          <Loader />
        ) : detail.error || !data ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} onBack={() => router.back()} testID="site-error" />
        ) : (
          <>
            <View style={[styles.identity, elevation.card]}>
              <IconTile icon="business-outline" size={64} />
              <View style={styles.identityTexts}>
                <AppText variant="title" color={colors.navy} numberOfLines={2}>
                  {data.site.name}
                </AppText>
                <AppText color={colors.textSecondary} numberOfLines={2}>
                  {[data.site.commune, data.site.wilaya].filter(Boolean).join(', ') || t('common.none')}
                </AppText>
                <View style={styles.chips}>
                  {data.site.society ? <Chip icon="briefcase-outline" label={data.site.society} /> : null}
                  {data.site.indicatif ? <Chip icon="pricetag-outline" label={data.site.indicatif} /> : null}
                </View>
              </View>
            </View>

            <SectionHeader title={t('sites.staffing.title')} />
            <View style={styles.kpis}>
              <KpiCard testID="site-contractual" label={t('sites.contractual')} value={data.contractualStaff} icon="document-text-outline" />
              <KpiCard testID="site-realized" label={t('sites.realized')} value={data.realizedStaff} icon="people-outline" ratio={coverage} />
              <KpiCard testID="site-missing" label={t('sites.missing')} value={data.missingStaff} tone={data.missingStaff > 0 ? 'danger' : 'neutral'} icon="remove-circle-outline" />
            </View>

            {kpi ? (
              <ChartCard testID="site-today" title={t('home.presence.title')} hint={formatDate(board.data?.date)}>
                <View style={styles.presence}>
                  <RingGauge ratio={rate} tone={rate !== null && rate < 0.75 ? 'danger' : rate !== null && rate < 0.9 ? 'warning' : 'success'} caption={t('cockpit.rate.short')} />
                  <View style={styles.lines}>
                    <StatLine label={t('cockpit.present')} value={String(kpi.present)} ratio={rate} tone="success" />
                    <StatLine label={t('cockpit.absent')} value={String(kpi.absent)} ratio={kpi.expected ? kpi.absent / kpi.expected : null} tone="danger" />
                    <StatLine label={t('cockpit.notPointed')} value={String(kpi.not_pointed)} ratio={kpi.expected ? kpi.not_pointed / kpi.expected : null} tone="warning" />
                  </View>
                </View>
              </ChartCard>
            ) : null}

            <Card testID="site-info">
              <SectionHeader title={t('sites.info.title')} />
              <View>
                <InfoRow icon="person-circle-outline" label={t('sites.client')} value={data.site.client ?? t('common.none')} />
                <InfoRow icon="location-outline" label={t('sites.location')} value={[data.site.address, data.site.commune, data.site.wilaya].filter(Boolean).join(', ') || t('common.none')} />
                <InfoRow icon="person-outline" label={t('sites.manager')} value={t('common.notAvailable')} last />
              </View>
            </Card>

            <View style={styles.section}>
              <SectionHeader title={t('ops.actions.title')} />
              <View style={styles.kpis}>
                {withAttendance ? <ActionTile testID="site-attendance" icon="time-outline" label={t('sites.openAttendance')} onPress={() => go(`/attendance?site_id=${siteId}`)} /> : null}
                {access.incidents(user) ? <ActionTile testID="site-incidents" icon="warning-outline" tone="warning" label={t('entry.incidents')} onPress={() => go('/incidents')} /> : null}
                {access.brq(user) ? <ActionTile testID="site-brq" icon="document-text-outline" label={t('entry.brq')} onPress={() => go('/brq')} /> : null}
                <ActionTile icon="walk-outline" label={t('modules.rounds')} caption={t('modules.unavailable')} />
              </View>
            </View>

            <View style={styles.section} testID="site-agents">
              <SectionHeader
                title={t('sites.agents', { count: data.agents.length })}
                hint={data.agents.length > AGENTS_SHOWN ? t('list.count', { shown: AGENTS_SHOWN, total: data.agents.length }) : undefined}
              />
              {data.agents.length === 0 ? <AppText color={colors.textSecondary}>{t('common.none')}</AppText> : null}
              {data.agents.slice(0, AGENTS_SHOWN).map((agent) => (
                <EmployeeRow
                  key={agent.assignmentId}
                  employeeId={access.employees(user) ? agent.employeeId : null}
                  name={agent.name}
                  code={agent.code}
                  position={agent.position}
                  detail={t('sites.group', { group: agent.group })}
                  onPress={access.employees(user) ? () => go(`/drh/employees/${agent.employeeId}`) : undefined}
                />
              ))}
            </View>

            {withAttendance ? (
              <Card testID="site-planning">
                <SectionHeader title={t('sites.planning')} />
                {planning.isPending ? (
                  <Loader />
                ) : planning.error ? (
                  <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
                ) : planning.data.length === 0 ? (
                  <AppText color={colors.textSecondary}>{t('common.none')}</AppText>
                ) : (
                  planning.data.map((shift) => (
                    <ListItem
                      key={shift.key}
                      icon={shift.rest ? 'moon-outline' : 'time-outline'}
                      iconTone={shift.rest ? 'neutral' : 'brand'}
                      title={[formatDate(shift.date), shift.rest ? t('sites.planning.rest') : `${shift.start} – ${shift.end}`].join(' · ')}
                      subtitle={[
                        shift.group ? t('sites.group', { group: shift.group }) : null,
                        shift.rest ? null : t('sites.planning.expected', { count: shift.expectedCount }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  ))
                )}
              </Card>
            ) : null}
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  identityTexts: { flex: 1, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  section: { gap: spacing.md },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  lines: { flex: 1, gap: spacing.md },
});
