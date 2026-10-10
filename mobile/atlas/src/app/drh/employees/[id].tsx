import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchEmployeeAttendance, type AttendanceDay } from '@/api/domains/attendance';
import { fetchEmployee, fetchEmployeeDocuments, fetchLeaves } from '@/api/domains/drh';
import { fetchSitePlanning } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import {
  AppText,
  AtlasHeader,
  Badge,
  Button,
  Card,
  EmployeeHeader,
  ErrorState,
  InfoRow,
  KpiCard,
  ListItem,
  Loader,
  Screen,
  SectionHeader,
  TabStrip,
} from '@/components/ui';
import { access } from '@/features/access';
import { employeeStatusTone, leaveStatus, presenceStatus } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatTime, fullName, localDate } from '@/utils/format';

type Tab = 'overview' | 'info' | 'position' | 'attendance' | 'leaves' | 'documents';

const PRESENT = ['present', 'presence_hors_planning'];

/** Décompte des journées de pointage renvoyées par le backend ; aucun jour n'est supposé. */
function summarize(days: readonly AttendanceDay[]) {
  return {
    total: days.length,
    present: days.filter((day) => PRESENT.includes(day.status)).length,
    absent: days.filter((day) => day.status === 'absent' || day.status === 'abandon_poste').length,
    notPointed: days.filter((day) => day.status === 'non_pointe').length,
  };
}

function Unavailable() {
  return <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>;
}

function None() {
  return <AppText color={colors.textSecondary}>{t('common.none')}</AppText>;
}

export default function EmployeeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const employeeId = Number(id);
  const user = useCurrentUser();
  const [tab, setTab] = useState<Tab>('overview');
  const allowed = access.employees(user) && Number.isInteger(employeeId) && employeeId > 0;
  const withAttendance = access.attendance(user);

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
    enabled: loaded && withAttendance,
  });
  const data = employee.data;
  const siteId = data?.siteId ?? null;
  // Horaires de l'équipe de l'employé, projetés par le backend à partir de la rotation du site.
  const planning = useQuery({
    queryKey: ['employee', employeeId, 'planning', siteId],
    queryFn: () => fetchSitePlanning(api, siteId ?? 0, localDate(0), localDate(6)),
    enabled: loaded && withAttendance && siteId !== null && (tab === 'position' || tab === 'overview'),
  });
  const name = data ? fullName(data.lastName, data.firstName) : '';
  const shows = (section: Exclude<Tab, 'overview'>) => tab === 'overview' || tab === section;
  const stats = attendance.data ? summarize(attendance.data) : null;
  const today = attendance.data?.find((day) => day.date === localDate(0)) ?? null;
  const shifts = planning.data?.filter((shift) => !data?.group || !shift.group || shift.group === data.group) ?? [];
  const na = t('common.notAvailable');

  return (
    <Gate allowed={allowed}>
      <Screen
        edges={['top', 'bottom', 'left', 'right']}
        testID="employee-detail"
        header={
          <>
            <AtlasHeader back title={t('employees.detail.title')} subtitle={data?.code || undefined} />
            {data ? (
              <TabStrip
                testID="employee-tabs"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'overview', label: t('employees.tab.overview') },
                  { value: 'info', label: t('employees.tab.info') },
                  { value: 'position', label: t('employees.tab.position') },
                  ...(withAttendance ? [{ value: 'attendance' as const, label: t('employees.tab.attendance') }] : []),
                  { value: 'leaves', label: t('employees.tab.leaves') },
                  { value: 'documents', label: t('employees.tab.documents') },
                ]}
              />
            ) : null}
          </>
        }>
        {employee.isPending ? (
          <Loader />
        ) : employee.error || !data ? (
          <ErrorState error={employee.error} onRetry={() => void employee.refetch()} onBack={() => router.back()} testID="employee-error" />
        ) : (
          <>
            <EmployeeHeader
              testID="employee-header"
              employeeId={data.id}
              name={name}
              code={data.code}
              position={data.position}
              society={data.society}
              site={data.siteName}
              status={<Badge label={data.status} tone={employeeStatusTone(data.status)} testID="employee-status" />}
              actions={
                data.phone || data.email ? (
                  <>
                    {data.phone ? (
                      <Button testID="employee-call" variant="secondary" icon="call-outline" label={t('employees.call')} style={styles.action} onPress={() => void Linking.openURL(`tel:${data.phone}`)} />
                    ) : null}
                    {data.email ? (
                      <Button testID="employee-mail" variant="secondary" icon="mail-outline" label={t('employees.mail')} style={styles.action} onPress={() => void Linking.openURL(`mailto:${data.email}`)} />
                    ) : null}
                  </>
                ) : undefined
              }
            />

            {stats && shows('attendance') ? (
              <View style={styles.grid} testID="employee-stats">
                <KpiCard label={t('employees.stats.present', { days: stats.total })} value={stats.present} tone="success" ratio={stats.total ? stats.present / stats.total : null} />
                <KpiCard label={t('cockpit.absent')} value={stats.absent} tone={stats.absent > 0 ? 'danger' : 'neutral'} />
                <KpiCard label={t('cockpit.notPointed')} value={stats.notPointed} tone={stats.notPointed > 0 ? 'warning' : 'neutral'} />
              </View>
            ) : null}

            {shows('info') ? (
              <Card testID="employee-info">
                <SectionHeader title={t('employees.tab.info')} />
                <View>
                  <InfoRow icon="briefcase-outline" label={t('profile.societies')} value={data.society ?? t('common.none')} />
                  <InfoRow icon="document-text-outline" label={t('employees.contract')} value={data.contractType ?? t('common.none')} />
                  <InfoRow icon="calendar-outline" label={t('employees.recruitDate')} value={formatDate(data.recruitDate) || t('common.none')} />
                  {data.contractEndDate ? <InfoRow icon="calendar-clear-outline" label={t('employees.contractEnd')} value={formatDate(data.contractEndDate)} /> : null}
                  <InfoRow icon="call-outline" label={t('employees.phone')} value={data.phone ?? t('common.none')} />
                  <InfoRow icon="mail-outline" label={t('profile.email')} value={data.email ?? t('common.none')} last />
                </View>
              </Card>
            ) : null}

            {shows('position') ? (
              <>
                <Card testID="employee-position">
                  <SectionHeader title={t('employees.position.title')} />
                  <View>
                    <InfoRow icon="ribbon-outline" label={t('employees.position.post')} value={data.position ?? t('common.none')} />
                    <InfoRow icon="briefcase-outline" label={t('profile.societies')} value={data.society ?? t('common.none')} />
                    <InfoRow icon="location-outline" label={t('employees.position.site')} value={data.siteName ?? t('employees.position.unassigned')} />
                    <InfoRow icon="people-outline" label={t('employees.position.team')} value={data.group ? t('sites.group', { group: data.group }) : t('common.none')} />
                    <InfoRow icon="git-network-outline" label={t('employees.position.department')} value={na} />
                    <InfoRow icon="person-outline" label={t('employees.position.manager')} value={na} />
                    <InfoRow icon="flag-outline" label={t('employees.position.mission')} value={na} />
                    <InfoRow icon="shield-checkmark-outline" label={t('employees.position.clearances')} value={na} last />
                  </View>
                </Card>

                {withAttendance ? (
                  <Card testID="employee-today">
                    <SectionHeader title={t('employees.today.title')} hint={formatDate(localDate(0))} />
                    {attendance.isPending ? (
                      <Loader />
                    ) : attendance.error ? (
                      <Unavailable />
                    ) : (
                      <View>
                        <View style={styles.todayStatus}>
                          <AppText variant="caption" color={colors.textSecondary}>
                            {t('employees.today.status')}
                          </AppText>
                          {today ? <StatusBadge status={presenceStatus(today.status)} fallback={today.status} /> : <Badge label={t('employees.today.none')} />}
                        </View>
                        <InfoRow icon="log-in-outline" label={t('employees.today.arrival')} value={formatTime(today?.arrival) || today?.arrival || '—'} />
                        <InfoRow icon="log-out-outline" label={t('employees.today.departure')} value={formatTime(today?.departure) || today?.departure || '—'} last />
                      </View>
                    )}
                  </Card>
                ) : null}

                {withAttendance && siteId !== null ? (
                  <Card testID="employee-planning">
                    <SectionHeader title={t('employees.planning.title')} hint={t('employees.planning.hint')} />
                    {planning.isPending ? (
                      <Loader />
                    ) : planning.error ? (
                      <Unavailable />
                    ) : shifts.length === 0 ? (
                      <None />
                    ) : (
                      shifts.slice(0, 7).map((shift) => (
                        <ListItem
                          key={shift.key}
                          icon={shift.rest ? 'moon-outline' : 'time-outline'}
                          iconTone={shift.rest ? 'neutral' : 'brand'}
                          title={[formatDate(shift.date), shift.rest ? t('sites.planning.rest') : `${shift.start} – ${shift.end}`].join(' · ')}
                          subtitle={shift.group ? t('sites.group', { group: shift.group }) : undefined}
                        />
                      ))
                    )}
                  </Card>
                ) : null}
              </>
            ) : null}

            {withAttendance && shows('attendance') ? (
              <Card testID="employee-attendance">
                <SectionHeader title={t('employees.attendance')} />
                {attendance.isPending ? (
                  <Loader />
                ) : attendance.error ? (
                  <Unavailable />
                ) : attendance.data.length === 0 ? (
                  <None />
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

            {shows('leaves') ? (
              <>
                {access.requestLeave(user) ? (
                  <Button
                    testID="employee-leave-new"
                    variant="secondary"
                    icon="add-circle-outline"
                    label={t('leaves.new')}
                    onPress={() => router.push(`/drh/leave-request?employee_id=${employeeId}` as never)}
                  />
                ) : null}
                <Card testID="employee-leaves">
                  <SectionHeader title={t('entry.leaves')} />
                  {leaves.isPending ? (
                    <Loader />
                  ) : leaves.error ? (
                    <Unavailable />
                  ) : leaves.data.length === 0 ? (
                    <None />
                  ) : (
                    leaves.data.slice(0, 10).map((leave) => (
                      <ListItem
                        key={leave.id}
                        icon="calendar-outline"
                        title={`${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}`}
                        subtitle={leave.reason ?? leave.type}
                        trailing={<StatusBadge status={leaveStatus(leave.status)} fallback={leave.status} />}
                      />
                    ))
                  )}
                </Card>
              </>
            ) : null}

            {shows('documents') ? (
              <Card testID="employee-documents">
                <SectionHeader title={t('employees.documents')} hint={t('employees.documents.hint')} />
                {documents.isPending ? (
                  <Loader />
                ) : documents.error ? (
                  <Unavailable />
                ) : documents.data.length === 0 ? (
                  <None />
                ) : (
                  documents.data.map((document) => (
                    <ListItem key={document.id} icon="document-outline" title={document.label} subtitle={formatDate(document.createdAt)} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  action: { flex: 1 },
  todayStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm },
});
