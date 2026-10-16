import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '@/api';
import { decideLeave, fetchLeaves, type Leave } from '@/api/domains/drh';
import { errorMessageKey } from '@/api/errors';
import { invalidateScopedQueries, queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, Banner, Button, Card, Chip, ConfirmDialog, EmployeePhoto, EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { access } from '@/features/access';
import { leaveStatus } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

type Filter = 'instance' | 'all';
type Decision = { leave: Leave; decision: 'approve' | 'refuse' };

/** Nombre de jours calendaires d'une demande, bornes comprises. */
function leaveDays(start: string, end: string): number {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 1;
}

export default function LeavesScreen() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('instance');
  const [pending, setPending] = useState<Decision | null>(null);
  const allowed = access.leaves(user);
  const canDecide = access.decideLeaves(user);

  const query = useQuery({
    queryKey: queryKeys.scoped(null, null, 'leaves', filter),
    queryFn: () => fetchLeaves(api, { status: filter === 'instance' ? 'instance' : undefined }),
    enabled: allowed,
  });
  const mutation = useMutation({
    mutationFn: ({ leave, decision }: Decision) => decideLeave(api, leave.id, decision),
    onSuccess: async () => {
      setPending(null);
      await invalidateScopedQueries(queryClient);
    },
    onError: () => setPending(null),
  });
  const failure = mutation.error
    ? mutation.error instanceof ApiError && mutation.error.kind !== 'server' && mutation.error.serverMessage
      ? mutation.error.serverMessage
      : t(errorMessageKey(mutation.error))
    : null;

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="leaves-screen">
        <AtlasHeader back title={t('entry.leaves')} subtitle={query.data ? t('leaves.count', { count: query.data.length }) : undefined} />
        <View style={styles.filters}>
          <Segmented
            testID="leaves-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'instance', label: t('leaves.filter.pending') },
              { value: 'all', label: t('alerts.filter.all') },
            ]}
          />
          {failure ? <Banner tone="danger" message={failure} testID="leaves-error" /> : null}
        </View>
        {query.isPending ? (
          <SkeletonList />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <FlatList
            data={query.data}
            keyExtractor={(leave) => String(leave.id)}
            contentContainerStyle={styles.content}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState icon="calendar-outline" title={t('leaves.empty.title')} testID="leaves-empty" />}
            renderItem={({ item }) => (
              <Card testID={`leave-${item.id}`}>
                <View style={styles.head}>
                  <EmployeePhoto employeeId={item.employeeId} name={t('leaves.employee', { id: item.employeeId })} size={46} />
                  <View style={styles.headTexts}>
                    <AppText variant="bodyStrong" color={colors.navy}>
                      {formatDate(item.startDate)} – {formatDate(item.endDate)}
                    </AppText>
                    <AppText variant="caption" color={colors.textSecondary}>
                      {[t('leaves.employee', { id: item.employeeId }), item.type].join(' · ')}
                    </AppText>
                  </View>
                  <StatusBadge status={leaveStatus(item.status)} fallback={item.status} />
                </View>
                <View style={styles.chips}>
                  <Chip icon="time-outline" label={t('leaves.duration', { days: leaveDays(item.startDate, item.endDate) })} />
                </View>
                {item.reason ? <AppText color={colors.textSecondary}>{item.reason}</AppText> : null}
                {canDecide && item.status === 'instance' ? (
                  <View style={styles.actions}>
                    <Button
                      testID={`leave-approve-${item.id}`}
                      label={t('leaves.approve')}
                      style={styles.action}
                      onPress={() => setPending({ leave: item, decision: 'approve' })}
                    />
                    <Button
                      testID={`leave-refuse-${item.id}`}
                      variant="danger"
                      label={t('leaves.refuse')}
                      style={styles.action}
                      onPress={() => setPending({ leave: item, decision: 'refuse' })}
                    />
                  </View>
                ) : null}
              </Card>
            )}
          />
        )}
        <ConfirmDialog
          testID="leave-confirm"
          visible={pending !== null}
          destructive={pending?.decision === 'refuse'}
          title={pending?.decision === 'refuse' ? t('leaves.confirm.refuse') : t('leaves.confirm.approve')}
          message={pending ? `${formatDate(pending.leave.startDate)} – ${formatDate(pending.leave.endDate)}` : undefined}
          confirmLabel={pending?.decision === 'refuse' ? t('leaves.refuse') : t('leaves.approve')}
          busy={mutation.isPending}
          onConfirm={() => pending && mutation.mutate(pending)}
          onCancel={() => setPending(null)}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  content: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headTexts: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flex: 1 },
});
