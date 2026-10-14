import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchAlerts, type Alert } from '@/api/domains/alerts';
import { scopeParams } from '@/api/domains/shared';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AtlasHeader, EmptyState, IncidentRow, PagedList } from '@/components/ui';
import { access } from '@/features/access';
import { ALERT_STATUS, SEVERITY } from '@/features/status';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDateTime } from '@/utils/format';

/** « Non lues » : alertes ouvertes que personne n'a encore prises en compte. */
type Filter = 'all' | 'critical' | 'open' | 'treated';

export default function AlertsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [filter, setFilter] = useState<Filter>('open');
  const allowed = access.alerts(user);

  const list = usePagedList<Alert>({
    queryKey: queryKeys.scoped(scope.society, scope.site?.id ?? null, 'alerts', filter),
    fetchPage: (page) =>
      fetchAlerts(api, {
        ...scopeParams(scope),
        status: filter === 'open' || filter === 'treated' ? filter : undefined,
        severity: filter === 'critical' ? 'critical' : undefined,
        page,
      }),
    enabled: allowed && ready,
  });

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="alerts-screen">
        <AtlasHeader back title={t('tabs.alerts')} />
        <EmptyState icon="notifications-outline" title={t('alerts.empty.title')} body={t('alerts.none.body')} testID="alerts-no-access" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="alerts-screen">
      <AtlasHeader back title={t('tabs.alerts')} subtitle={list.total > 0 ? t('alerts.count', { count: list.total }) : undefined} />
      <PagedList
        testID="alerts-list"
        list={list}
        keyOf={(alert) => String(alert.id)}
        emptyTitle={t('alerts.empty.title')}
        emptyBody={t('alerts.empty.body')}
        header={
          <View style={styles.header}>
            <Segmented
              testID="alerts-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('alerts.filter.all') },
                { value: 'critical', label: t('alerts.filter.critical') },
                { value: 'open', label: t('alerts.filter.unread') },
                { value: 'treated', label: t('alerts.filter.treated') },
              ]}
            />
          </View>
        }
        renderItem={(alert) => (
          <IncidentRow
            testID={`alert-${alert.id}`}
            tone={SEVERITY[alert.severity].tone}
            icon="notifications-outline"
            title={alert.title}
            detail={[t(SEVERITY[alert.severity].label), formatDateTime(alert.lastDetectedAt), alert.society].filter(Boolean).join(' · ')}
            badge={<StatusBadge status={ALERT_STATUS[alert.status]} fallback={alert.status} />}
            onPress={() => router.push(`/alerts/${alert.id}` as never)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.md, marginBottom: spacing.md },
});
