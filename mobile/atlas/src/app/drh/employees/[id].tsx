import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchEmployeeAttendance } from '@/api/domains/attendance';
import { fetchEmployee, fetchEmployeeDocuments, fetchLeaves } from '@/api/domains/drh';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Avatar, Badge, Button, Card, ErrorState, ListItem, Loader, Screen, ScreenHeader } from '@/components/ui';
import { access } from '@/features/access';
import { leaveStatus, presenceStatus } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatTime, fullName } from '@/utils/format';

export default function EmployeeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const employeeId = Number(id);
  const user = useCurrentUser();
  const allowed = access.employees(user) && Number.isInteger(employeeId) && employeeId > 0;

  const employee = useQuery({ queryKey: ['employee', employeeId], queryFn: () => fetchEmployee(api, employeeId), enabled: allowed });
  // Sous-sections chargées seulement une fois la fiche autorisée par le backend.
  const loaded = allowed && employee.isSuccess;
  const leaves = useQuery({ queryKey: ['employee', employeeId, 'leaves'], queryFn: () => fetchLeaves(api, { employee_id: employeeId }), enabled: loaded });
  const documents = useQuery({
    queryKey: ['employee', employeeId, 'documents'],
    queryFn: () => fetchEmployeeDocuments(api, employeeId),
    enabled: loaded,
  });
  const attendance = useQuery({
    queryKey: ['employee', employeeId, 'attendance'],
    queryFn: () => fetchEmployeeAttendance(api, employeeId),
    enabled: loaded && access.attendance(user),
  });
  const data = employee.data;
  const name = data ? fullName(data.lastName, data.firstName) : '';

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="employee-detail">
        <ScreenHeader title={t('employees.detail.title')} />
        {employee.isPending ? (
          <Loader />
        ) : employee.error || !data ? (
          <ErrorState error={employee.error} onRetry={() => void employee.refetch()} onBack={() => router.back()} testID="employee-error" />
        ) : (
          <>
            <View style={styles.identity}>
              <Avatar name={name} size={64} />
              <View style={styles.fill}>
                <AppText variant="heading" accessibilityRole="header">
                  {name}
                </AppText>
                <AppText color={colors.textSecondary}>{[data.code, data.position].filter(Boolean).join(' · ')}</AppText>
                <Badge label={data.status} testID="employee-status" />
              </View>
            </View>

            <Card>
              <ListItem title={t('profile.societies')} subtitle={data.society ?? t('common.none')} />
              <ListItem title={t('employees.contract')} subtitle={data.contractType ?? t('common.none')} />
              <ListItem title={t('employees.recruitDate')} subtitle={formatDate(data.recruitDate) || t('common.none')} />
              {data.contractEndDate ? <ListItem title={t('employees.contractEnd')} subtitle={formatDate(data.contractEndDate)} /> : null}
              <ListItem title={t('employees.phone')} subtitle={data.phone ?? t('common.none')} />
            </Card>

            {access.attendance(user) ? (
              <Card testID="employee-attendance">
                <AppText variant="label" color={colors.textSecondary}>
                  {t('employees.attendance')}
                </AppText>
                {attendance.isPending ? (
                  <Loader />
                ) : attendance.error ? (
                  <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
                ) : attendance.data.length === 0 ? (
                  <AppText color={colors.textSecondary}>{t('common.none')}</AppText>
                ) : (
                  attendance.data.map((day) => (
                    <ListItem
                      key={day.id || day.date}
                      title={formatDate(day.date)}
                      subtitle={
                        [
                          day.site,
                          day.arrival ? t('attendance.arrival', { time: formatTime(day.arrival) || day.arrival }) : null,
                          day.departure ? t('attendance.departure', { time: formatTime(day.departure) || day.departure }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                      trailing={<StatusBadge status={presenceStatus(day.status)} fallback={day.status} />}
                    />
                  ))
                )}
              </Card>
            ) : null}

            {access.requestLeave(user) ? (
              <Button
                testID="employee-leave-new"
                variant="secondary"
                label={t('leaves.new')}
                onPress={() => router.push(`/drh/leave-request?employee_id=${employeeId}` as never)}
              />
            ) : null}

            <Card testID="employee-leaves">
              <AppText variant="label" color={colors.textSecondary}>
                {t('entry.leaves')}
              </AppText>
              {leaves.isPending ? (
                <Loader />
              ) : leaves.error ? (
                <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
              ) : leaves.data.length === 0 ? (
                <AppText color={colors.textSecondary}>{t('common.none')}</AppText>
              ) : (
                leaves.data.slice(0, 10).map((leave) => (
                  <ListItem
                    key={leave.id}
                    title={`${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`}
                    subtitle={leave.reason ?? leave.type}
                    trailing={<StatusBadge status={leaveStatus(leave.status)} fallback={leave.status} />}
                  />
                ))
              )}
            </Card>

            <Card testID="employee-documents">
              <AppText variant="label" color={colors.textSecondary}>
                {t('employees.documents')}
              </AppText>
              {documents.isPending ? (
                <Loader />
              ) : documents.error ? (
                <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
              ) : documents.data.length === 0 ? (
                <AppText color={colors.textSecondary}>{t('common.none')}</AppText>
              ) : (
                documents.data.map((document) => (
                  <ListItem key={document.id} icon="document-outline" title={document.label} subtitle={formatDate(document.createdAt)} />
                ))
              )}
            </Card>
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  fill: { flex: 1, gap: spacing.xs },
});
