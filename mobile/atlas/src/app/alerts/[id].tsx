import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError } from '@/api';
import { ACTIONABLE_STATUSES, applyAlertAction, fetchAlert, type AlertAction } from '@/api/domains/alerts';
import { invalidateScopedQueries } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Button, Card, ConfirmDialog, ErrorState, ListItem, Loader, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { ALERT_STATUS, SEVERITY } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDateTime } from '@/utils/format';

export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alertId = Number(id);
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<AlertAction | null>(null);
  const allowed = access.alerts(user) && Number.isInteger(alertId) && alertId > 0;

  const query = useQuery({ queryKey: ['alert', alertId], queryFn: () => fetchAlert(api, alertId), enabled: allowed });
  const mutation = useMutation({
    mutationFn: (action: AlertAction) => applyAlertAction(api, alertId, action),
    onSuccess: async () => {
      setPending(null);
      await Promise.all([query.refetch(), invalidateScopedQueries(queryClient)]);
    },
    onError: () => setPending(null),
  });

  const alert = query.data;
  const canAct = access.actOnAlerts(user) && alert !== undefined && ACTIONABLE_STATUSES.includes(alert.status);
  const failure = mutation.error instanceof ApiError ? (mutation.error.serverMessage ?? t('errors.conflict')) : null;

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="alert-detail">
        <ScreenHeader title={t('alerts.detail.title')} />
        {query.isPending ? (
          <Loader />
        ) : query.error || !alert ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <Card>
              <AppText variant="heading">{alert.title}</AppText>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <StatusBadge status={SEVERITY[alert.severity]} fallback={alert.severity} testID="alert-severity" />
                <StatusBadge status={ALERT_STATUS[alert.status]} fallback={alert.status} testID="alert-status" />
              </View>
              {alert.summary ? <AppText color={colors.textSecondary}>{alert.summary}</AppText> : null}
              {alert.explanation ? <AppText color={colors.textSecondary}>{alert.explanation}</AppText> : null}
            </Card>
            <Card>
              <ListItem title={t('profile.societies')} subtitle={alert.society || t('common.none')} />
              <ListItem title={t('alerts.detail.detected')} subtitle={formatDateTime(alert.lastDetectedAt)} />
              <ListItem title={t('alerts.detail.occurrences')} subtitle={String(alert.occurrenceCount)} />
            </Card>
            {failure ? (
              <AppText variant="label" color={colors.danger} accessibilityRole="alert" testID="alert-action-error">
                {failure}
              </AppText>
            ) : null}
            {canAct ? (
              <>
                {alert.status === 'open' ? (
                  <Button testID="alert-acknowledge" variant="secondary" label={t('alerts.action.acknowledge')} onPress={() => setPending('acknowledge')} />
                ) : null}
                <Button testID="alert-treated" label={t('alerts.action.treated')} onPress={() => setPending('treated')} />
              </>
            ) : null}
          </>
        )}
        <ConfirmDialog
          testID="alert-confirm"
          visible={pending !== null}
          title={pending === 'treated' ? t('alerts.confirm.treated') : t('alerts.confirm.acknowledge')}
          confirmLabel={pending === 'treated' ? t('alerts.action.treated') : t('alerts.action.acknowledge')}
          busy={mutation.isPending}
          onConfirm={() => pending && mutation.mutate(pending)}
          onCancel={() => setPending(null)}
        />
      </Screen>
    </Gate>
  );
}
