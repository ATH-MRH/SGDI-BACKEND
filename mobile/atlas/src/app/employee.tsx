import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  employeeApi,
  fetchSelfAbsences,
  fetchSelfAttendance,
  fetchSelfDocuments,
  fetchSelfLeaves,
  fetchSelfPayslips,
  fetchSelfPlanning,
} from '@/employee/api';
import { useEmployee } from '@/employee/EmployeeProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, Avatar, Button, Card, ListItem, Loader, Screen } from '@/components/ui';
import { leaveStatus, presenceStatus } from '@/features/status';
import { t, type TranslationKey } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatTime, fullName } from '@/utils/format';

/** Une section qui échoue ou reste vide n'empêche jamais les autres de s'afficher. */
function Section<T>({ title, query, testID, render }: { title: TranslationKey; query: UseQueryResult<T[]>; testID: string; render: (item: T) => ReactNode }) {
  return (
    <Card testID={testID}>
      <AppText variant="label" color={colors.textSecondary} accessibilityRole="header">
        {t(title)}
      </AppText>
      {query.isPending ? (
        <Loader />
      ) : query.error ? (
        <View style={styles.retry}>
          <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
          <Button testID={`${testID}-retry`} variant="secondary" label={t('common.retry')} onPress={() => void query.refetch()} />
        </View>
      ) : query.data.length === 0 ? (
        <AppText color={colors.textSecondary}>{t('common.none')}</AppText>
      ) : (
        query.data.map(render)
      )}
    </Card>
  );
}

/** Espace employé : uniquement les données de la personne connectée, en lecture. */
export default function EmployeeHomeScreen() {
  const { state, signOut } = useEmployee();
  const employee = state.status === 'signedIn' ? state.employee : null;
  const enabled = employee !== null;
  const key = (section: string) => ['employee-self', employee?.id ?? 0, section] as const;

  const planning = useQuery({ queryKey: key('planning'), queryFn: () => fetchSelfPlanning(employeeApi), enabled });
  const attendance = useQuery({ queryKey: key('attendance'), queryFn: () => fetchSelfAttendance(employeeApi), enabled });
  const absences = useQuery({ queryKey: key('absences'), queryFn: () => fetchSelfAbsences(employeeApi), enabled });
  const leaves = useQuery({ queryKey: key('leaves'), queryFn: () => fetchSelfLeaves(employeeApi), enabled });
  const documents = useQuery({ queryKey: key('documents'), queryFn: () => fetchSelfDocuments(employeeApi), enabled });
  const payslips = useQuery({ queryKey: key('payslips'), queryFn: () => fetchSelfPayslips(employeeApi), enabled });

  if (!employee) return null;
  const name = fullName(employee.lastName, employee.firstName);
  const day = (item: { date: string; status: string; site: string; arrival: string; departure: string }) => (
    <ListItem
      key={`${item.date}-${item.status}`}
      title={formatDate(item.date)}
      subtitle={
        [
          item.site,
          item.arrival ? t('attendance.arrival', { time: formatTime(item.arrival) || item.arrival }) : null,
          item.departure ? t('attendance.departure', { time: formatTime(item.departure) || item.departure }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      trailing={<StatusBadge status={presenceStatus(item.status)} fallback={item.status} />}
    />
  );

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="employee-home">
      <View style={styles.identity}>
        <Avatar name={name} size={56} />
        <View style={styles.fill}>
          <AppText variant="heading" accessibilityRole="header" testID="employee-name">
            {name}
          </AppText>
          <AppText color={colors.textSecondary}>{[employee.matricule, employee.position].filter(Boolean).join(' · ')}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {[employee.society, employee.siteName, employee.group ? t('sites.group', { group: employee.group }) : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      <Section
        title="employee.planning"
        testID="self-planning"
        query={planning}
        render={(shift) => (
          <ListItem key={shift.key} title={formatDate(shift.date)} subtitle={shift.rest ? t('sites.planning.rest') : `${shift.start} – ${shift.end}`} />
        )}
      />
      <Section title="employee.attendance" testID="self-attendance" query={attendance} render={day} />
      <Section title="employee.absences" testID="self-absences" query={absences} render={day} />
      <Section
        title="employee.leaves"
        testID="self-leaves"
        query={leaves}
        render={(leave) => (
          <ListItem
            key={leave.id}
            title={`${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`}
            subtitle={leave.reason ?? t(leave.type === 'maladie' ? 'leaves.type.maladie' : 'leaves.type.conge')}
            trailing={<StatusBadge status={leaveStatus(leave.status)} fallback={leave.status} />}
          />
        )}
      />
      <Section
        title="employee.documents"
        testID="self-documents"
        query={documents}
        render={(document) => <ListItem key={document.id} icon="document-outline" title={document.label} subtitle={formatDate(document.createdAt) || undefined} />}
      />
      <Section
        title="employee.payslips"
        testID="self-payslips"
        query={payslips}
        render={(slip) => <ListItem key={slip.id} icon="receipt-outline" title={slip.period} subtitle={t('employee.netToPay', { amount: slip.netToPay })} />}
      />

      <Button testID="employee-sign-out" variant="danger" label={t('profile.signOut')} onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  fill: { flex: 1, gap: spacing.xs },
  retry: { gap: spacing.sm },
});
