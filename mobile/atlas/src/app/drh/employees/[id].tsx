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
  KpiCard,
  KpiGrid,
  Badge,
  Button,
  Card,
  EmployeeHeader,
  ErrorState,
  InfoGrid,
  ListItem,
  Loader,
  PillButton,
  Screen,
  SectionHeader,
  SkeletonDashboard,
  TabStrip,
} from '@/components/ui';
import { env } from '@/config/env';
import { access } from '@/features/access';
import type { PortraitIssue } from '@/features/employees/usePortrait';
import { employeeStatusTone, leaveStatus, presenceStatus } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatTime, fullName, localDate } from '@/utils/format';

type Tab = 'overview' | 'position' | 'attendance' | 'planning' | 'documents';

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
  const [photoIssue, setPhotoIssue] = useState<PortraitIssue | null>(null);
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
  const withPlanning = withAttendance && siteId !== null;
  const planning = useQuery({
    queryKey: ['employee', employeeId, 'planning', siteId],
    queryFn: () => fetchSitePlanning(api, siteId ?? 0, localDate(0), localDate(6)),
    enabled: loaded && withPlanning && (tab === 'position' || tab === 'planning'),
  });

  const name = data ? fullName(data.lastName, data.firstName) : '';
  const stats = attendance.data ? summarize(attendance.data) : null;
  const today = attendance.data?.find((day) => day.date === localDate(0)) ?? null;
  const shifts = planning.data?.filter((shift) => !data?.group || !shift.group || shift.group === data.group) ?? [];
  const worked = shifts.filter((shift) => !shift.rest);
  const nextShift = worked[0] ?? null;
  const na = t('common.notAvailable');
  const none = t('common.none');
  const todayBadge = today ? <StatusBadge status={presenceStatus(today.status)} fallback={today.status} /> : <Badge label={t('employees.today.none')} />;

  const metrics = stats ? (
    <View testID="employee-stats" style={styles.stats}>
      <KpiGrid columns={3}>
        <KpiCard variant="compact" icon="checkmark-circle-outline" label={t('employees.stats.presence')} value={`${stats.present}/${stats.total}`} tone="success" />
        <KpiCard variant="compact" icon="close-circle-outline" label={t('employees.stats.absences')} value={stats.absent} tone={stats.absent > 0 ? 'danger' : 'neutral'} />
        <KpiCard variant="compact" icon="help-circle-outline" label={t('cockpit.notPointed')} value={stats.notPointed} tone={stats.notPointed > 0 ? 'warning' : 'neutral'} />
      </KpiGrid>
      <AppText variant="caption" color={colors.textMuted} style={styles.period}>
        {t('employees.stats.period', { days: stats.total })}
      </AppText>
    </View>
  ) : null;

  return (
    <Gate allowed={allowed}>
      <Screen
        edges={['top', 'bottom', 'left', 'right']}
        testID="employee-detail"
        header={
          <>
            <AtlasHeader back title={t('employees.detail.title')} />
            {data ? (
              <TabStrip
                fill
                testID="employee-tabs"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'overview', label: t('employees.tab.overview') },
                  { value: 'position', label: t('employees.tab.position') },
                  ...(withAttendance ? [{ value: 'attendance' as const, label: t('employees.tab.attendance') }] : []),
                  { value: 'planning', label: t('employees.tab.planning') },
                  { value: 'documents', label: t('employees.tab.documents') },
                ]}
              />
            ) : null}
          </>
        }>
        {employee.isPending ? (
          <SkeletonDashboard testID="employee-loading" />
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
              hasPhoto={data.hasPhoto}
              onPhotoUnavailable={setPhotoIssue}
              status={<Badge label={data.status} tone={employeeStatusTone(data.status)} testID="employee-status" />}
              actions={
                <>
                  {data.phone ? <PillButton testID="employee-call" primary icon="call-outline" label={t('employees.call')} onPress={() => void Linking.openURL(`tel:${data.phone}`)} /> : null}
                  {data.email ? <PillButton testID="employee-mail" icon="mail-outline" label={t('employees.mail')} onPress={() => void Linking.openURL(`mailto:${data.email}`)} /> : null}
                  {withAttendance ? <PillButton testID="employee-go-attendance" icon="time-outline" label={t('employees.tab.attendance')} onPress={() => setTab('attendance')} /> : null}
                  <PillButton testID="employee-go-planning" icon="calendar-outline" label={t('employees.tab.planning')} onPress={() => setTab('planning')} />
                  <PillButton testID="employee-go-documents" icon="document-outline" label={t('employees.tab.documents')} onPress={() => setTab('documents')} />
                </>
              }
            />
            {/* Diagnostic réservé au build de développement : la fiche a une photo, elle n'a pas pu être chargée. */}
            {env.variant === 'development' && data.hasPhoto && photoIssue ? (
              <AppText variant="caption" color={colors.warning} testID="employee-photo-diagnostic" selectable>
                {t(photoIssue.kind === 'none' ? 'employees.photo.missingFile' : 'employees.photo.failed', {
                  status: photoIssue.status === null ? '—' : String(photoIssue.status),
                  reason: photoIssue.reason,
                })}
              </AppText>
            ) : null}

            {tab === 'overview' ? (
              <>
                {metrics}
                <Card testID="employee-info">
                  <SectionHeader title={t('employees.overview.title')} />
                  <InfoGrid
                    cells={[
                      { key: 'society', label: t('profile.societies'), value: data.society ?? none },
                      { key: 'site', label: t('employees.position.site'), value: data.siteName ?? t('employees.position.unassigned') },
                      { key: 'position', label: t('employees.position.post'), value: data.position ?? none },
                      { key: 'contract', label: t('employees.contract'), value: data.contractType ?? none },
                      { key: 'recruit', label: t('employees.recruitDate'), value: formatDate(data.recruitDate) || none },
                      ...(data.contractEndDate ? [{ key: 'end', label: t('employees.contractEnd'), value: formatDate(data.contractEndDate) }] : []),
                      { key: 'phone', label: t('employees.phone'), value: data.phone ?? none },
                      { key: 'email', label: t('profile.email'), value: data.email ?? none },
                    ]}
                  />
                  {withAttendance ? (
                    <View style={styles.todayLine} testID="employee-today-status">
                      <AppText variant="caption" color={colors.textMuted}>
                        {t('employees.today.statusOf')}
                      </AppText>
                      {attendance.isPending ? <Badge label={t('common.loading')} /> : attendance.error ? <Badge label={na} /> : todayBadge}
                    </View>
                  ) : null}
                </Card>
              </>
            ) : null}

            {tab === 'position' ? (
              <>
                <Card testID="employee-position">
                  <SectionHeader title={t('employees.position.block')} />
                  <InfoGrid
                    cells={[
                      { key: 'society', label: t('profile.societies'), value: data.society ?? none },
                      { key: 'site', label: t('employees.position.site'), value: data.siteName ?? t('employees.position.unassigned') },
                      { key: 'post', label: t('employees.position.post'), value: data.position ?? none },
                      { key: 'team', label: t('employees.position.team'), value: data.group ? t('sites.group', { group: data.group }) : none },
                      { key: 'department', label: t('employees.position.departmentOnly'), value: na, muted: true },
                      { key: 'service', label: t('employees.position.service'), value: na, muted: true },
                      { key: 'manager', label: t('employees.position.manager'), value: na, muted: true, wide: true },
                    ]}
                  />
                </Card>

                {withPlanning ? (
                  <Card testID="employee-schedule">
                    <SectionHeader title={t('employees.schedule.block')} hint={t('employees.planning.hint')} />
                    {planning.isPending ? (
                      <Loader />
                    ) : planning.error ? (
                      <Unavailable />
                    ) : (
                      <InfoGrid
                        cells={[
                          { key: 'shift', label: t('employees.schedule.shift'), value: data.group ? t('sites.group', { group: data.group }) : none },
                          { key: 'hours', label: t('employees.schedule.hours'), value: nextShift ? `${nextShift.start} – ${nextShift.end}` : none },
                          { key: 'days', label: t('employees.schedule.days'), value: shifts.length ? t('employees.schedule.daysValue', { worked: worked.length, total: shifts.length }) : none },
                          { key: 'next', label: t('employees.schedule.next'), value: nextShift ? formatDate(nextShift.date) : none },
                        ]}
                      />
                    )}
                  </Card>
                ) : null}

                {withAttendance ? (
                  <Card testID="employee-today">
                    <SectionHeader title={t('employees.today.block')} hint={formatDate(localDate(0))} />
                    {attendance.isPending ? (
                      <Loader />
                    ) : attendance.error ? (
                      <Unavailable />
                    ) : (
                      <>
                        <View style={styles.todayLine}>
                          <AppText variant="caption" color={colors.textMuted}>
                            {t('employees.today.status')}
                          </AppText>
                          {todayBadge}
                        </View>
                        <InfoGrid
                          cells={[
                            { key: 'arrival', label: t('employees.today.arrival'), value: formatTime(today?.arrival) || today?.arrival || '—' },
                            { key: 'departure', label: t('employees.today.departure'), value: formatTime(today?.departure) || today?.departure || '—' },
                            { key: 'late', label: t('employees.today.late'), value: na, muted: true, wide: true },
                          ]}
                        />
                      </>
                    )}
                  </Card>
                ) : null}

                <Card testID="employee-mission">
                  <SectionHeader title={t('employees.mission.block')} />
                  <AppText variant="caption" color={colors.textMuted} style={styles.italic}>
                    {t('employees.mission.unavailable')}
                  </AppText>
                </Card>
              </>
            ) : null}

            {withAttendance && tab === 'attendance' ? (
              <>
                {metrics}
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
              </>
            ) : null}

            {tab === 'planning' ? (
              <>
                {withPlanning ? (
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
                {access.requestLeave(user) ? (
                  <Button
                    testID="employee-leave-new"
                    variant="secondary"
                    icon="add-circle-outline"
                    label={t('leaves.new')}
                    onPress={() => router.push(`/drh/leave-request?employee_id=${employeeId}` as never)}
                  />
                ) : null}
              </>
            ) : null}

            {tab === 'documents' ? (
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
  todayLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  italic: { fontStyle: 'italic' },
  stats: { gap: spacing.xs },
  period: { textAlign: 'center' },
});
