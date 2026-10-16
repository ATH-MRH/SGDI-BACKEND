import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { AppText, AtlasLogo, Avatar, Button, Card, KpiGrid, ListItem, ModuleTile, SkeletonLines, type IconName } from '@/components/ui';
import { leaveStatus, presenceStatus } from '@/features/status';
import { t, type TranslationKey } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';
import { formatDate, formatTime, fullName } from '@/utils/format';

/** Une section qui échoue ou reste vide n'empêche jamais les autres de s'afficher. */
type SectionProps<T> = {
  title: TranslationKey;
  query: UseQueryResult<T[]>;
  testID: string;
  render: (item: T) => ReactNode;
  /** Position de la section, pour que les tuiles du haut y fassent défiler. */
  onPlace: (testID: string, y: number) => void;
};

function Section<T>({ title, query, testID, render, onPlace }: SectionProps<T>) {
  return (
    <Card testID={testID} onLayout={(event) => onPlace(testID, event.nativeEvent.layout.y)}>
      <AppText style={styles.sectionTitle} color={colors.navy} accessibilityRole="header">
        {t(title)}
      </AppText>
      {query.isPending ? (
        <SkeletonLines />
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

  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  if (!employee) return null;
  const name = fullName(employee.lastName, employee.firstName);
  const place = (testID: string, y: number) => {
    offsets.current[testID] = y;
  };
  const jump = (id: string) => scroll.current?.scrollTo({ y: Math.max(0, (offsets.current[`self-${id}`] ?? 0) - spacing.md), animated: true });
  const count = (query: UseQueryResult<unknown[]>) => (query.data ? query.data.length : null);
  const tiles: { id: string; label: TranslationKey; icon: IconName; count: number | null }[] = [
    { id: 'planning', label: 'employee.planning', icon: 'calendar-outline', count: count(planning) },
    { id: 'attendance', label: 'employee.attendance', icon: 'time-outline', count: count(attendance) },
    { id: 'absences', label: 'employee.absences', icon: 'person-remove-outline', count: count(absences) },
    { id: 'leaves', label: 'employee.leaves', icon: 'airplane-outline', count: count(leaves) },
    { id: 'documents', label: 'employee.documents', icon: 'folder-open-outline', count: count(documents) },
    { id: 'payslips', label: 'employee.payslips', icon: 'receipt-outline', count: count(payslips) },
  ];
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} testID="employee-home">
      <View style={styles.header}>
        <AtlasLogo />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View style={[styles.identity, elevation.card]} testID="self-profile">
        <Avatar name={name} size={64} />
        <View style={styles.fill}>
          <AppText variant="caption" color={colors.textSecondary}>
            {t('employee.profile')}
          </AppText>
          <AppText variant="heading" color={colors.navy} accessibilityRole="header" testID="employee-name" numberOfLines={2}>
            {name}
          </AppText>
          <AppText variant="label" color={colors.textSecondary}>{[employee.matricule, employee.position].filter(Boolean).join(' · ')}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            {[employee.society, employee.siteName, employee.group ? t('sites.group', { group: employee.group }) : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      <KpiGrid columns={3} testID="self-tiles">
        {tiles.map((tile) => (
          <ModuleTile key={tile.id} testID={`self-tile-${tile.id}`} label={t(tile.label)} icon={tile.icon} count={tile.count} onPress={() => jump(tile.id)} />
        ))}
      </KpiGrid>

      <Section
        title="employee.planning"
        testID="self-planning"
        onPlace={place}
        query={planning}
        render={(shift) => (
          <ListItem key={shift.key} title={formatDate(shift.date)} subtitle={shift.rest ? t('sites.planning.rest') : `${shift.start} – ${shift.end}`} />
        )}
      />
      <Section title="employee.attendance" testID="self-attendance"
        onPlace={place} query={attendance} render={day} />
      <Section title="employee.absences" testID="self-absences"
        onPlace={place} query={absences} render={day} />
      <Section
        title="employee.leaves"
        testID="self-leaves"
        onPlace={place}
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
        onPlace={place}
        query={documents}
        render={(document) => <ListItem key={document.id} icon="document-outline" title={document.label} subtitle={formatDate(document.createdAt) || undefined} />}
      />
      <Section
        title="employee.payslips"
        testID="self-payslips"
        onPlace={place}
        query={payslips}
        render={(slip) => <ListItem key={slip.id} icon="receipt-outline" title={slip.period} subtitle={t('employee.netToPay', { amount: slip.netToPay })} />}
      />

      <Button testID="employee-sign-out" variant="danger" icon="log-out-outline" label={t('profile.signOut')} onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fill: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  retry: { gap: spacing.sm },
});
