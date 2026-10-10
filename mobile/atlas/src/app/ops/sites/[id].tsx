import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchBoard } from '@/api/domains/attendance';
import { fetchSiteDetail, fetchSitePlanning } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AppText, Button, Card, ErrorState, Kpi, ListItem, Loader, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, localDate } from '@/utils/format';

export default function SiteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const siteId = Number(id);
  const user = useCurrentUser();
  const allowed = access.sites(user) && Number.isInteger(siteId) && siteId > 0;

  const detail = useQuery({ queryKey: ['site', siteId], queryFn: () => fetchSiteDetail(api, siteId), enabled: allowed });
  const board = useQuery({
    queryKey: ['site', siteId, 'board'],
    queryFn: () => fetchBoard(api, { site_id: siteId, page_size: 1 }),
    enabled: allowed && access.attendance(user),
  });
  const planning = useQuery({
    queryKey: ['site', siteId, 'planning'],
    queryFn: () => fetchSitePlanning(api, siteId, localDate(0), localDate(6)),
    enabled: allowed && detail.isSuccess && access.attendance(user),
  });
  const data = detail.data;
  const kpi = board.data?.kpi;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="site-detail">
        <ScreenHeader title={data?.site.name ?? t('entry.sites')} subtitle={data?.site.society ?? undefined} />
        {detail.isPending ? (
          <Loader />
        ) : detail.error || !data ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} onBack={() => router.back()} testID="site-error" />
        ) : (
          <>
            <Card>
              <ListItem title={t('sites.client')} subtitle={data.site.client ?? t('common.none')} />
              <ListItem title={t('sites.location')} subtitle={[data.site.address, data.site.commune, data.site.wilaya].filter(Boolean).join(', ') || t('common.none')} />
            </Card>

            <View style={styles.kpis}>
              <Kpi testID="site-contractual" label={t('sites.contractual')} value={data.contractualStaff} />
              <Kpi testID="site-realized" label={t('sites.realized')} value={data.realizedStaff} />
              <Kpi testID="site-missing" label={t('sites.missing')} value={data.missingStaff} tone={data.missingStaff > 0 ? 'danger' : 'neutral'} />
            </View>

            {kpi ? (
              <View style={styles.kpis} testID="site-today">
                <Kpi label={t('cockpit.present')} value={kpi.present} tone="success" />
                <Kpi label={t('cockpit.absent')} value={kpi.absent} tone="danger" />
                <Kpi label={t('cockpit.notPointed')} value={kpi.not_pointed} tone="warning" />
              </View>
            ) : null}

            {access.attendance(user) ? (
              <Button testID="site-attendance" variant="secondary" label={t('sites.openAttendance')} onPress={() => router.push(`/attendance?site_id=${siteId}` as never)} />
            ) : null}

            <Card>
              <AppText variant="label" color={colors.textSecondary}>
                {t('sites.agents', { count: data.agents.length })}
              </AppText>
              {data.agents.length === 0 ? <AppText color={colors.textSecondary}>{t('common.none')}</AppText> : null}
              {data.agents.map((agent) => (
                <ListItem
                  key={agent.assignmentId}
                  title={agent.name}
                  subtitle={[agent.code, agent.position, t('sites.group', { group: agent.group })].filter(Boolean).join(' · ')}
                />
              ))}
            </Card>

            {access.attendance(user) ? (
              <Card testID="site-planning">
                <AppText variant="label" color={colors.textSecondary}>
                  {t('sites.planning')}
                </AppText>
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
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
