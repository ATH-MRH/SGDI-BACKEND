import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchEmployeesPage, type Employee, type EmployeeMode } from '@/api/domains/drh';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { Avatar, Card, ListItem, PagedList, ScreenHeader, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { fullName } from '@/utils/format';

export default function EmployeesScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const [mode, setMode] = useState<EmployeeMode>('actifs');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const allowed = access.employees(user);

  // Recherche et pagination côté serveur : jamais la liste complète sur le téléphone.
  const list = usePagedList<Employee>({
    queryKey: queryKeys.scoped(scope.society, null, 'employees', mode, q),
    fetchPage: (page) => fetchEmployeesPage(api, { q: q || undefined, mode, society: scope.society ?? undefined, page }),
    enabled: allowed && ready,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="employees-screen">
        <ScreenHeader title={t('entry.employees')} />
        <View style={styles.filters}>
          <SearchBar testID="employees-search" value={search} onChangeText={setSearch} placeholder={t('employees.search')} />
          <Segmented
            testID="employees-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'actifs', label: t('employees.mode.active') },
              { value: 'absents', label: t('employees.mode.absent') },
              { value: 'sortants', label: t('employees.mode.leaving') },
              { value: 'all', label: t('alerts.filter.all') },
            ]}
          />
        </View>
        <PagedList
          testID="employees-list"
          list={list}
          keyOf={(employee) => String(employee.id)}
          emptyTitle={t('employees.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          renderItem={(employee) => {
            const name = fullName(employee.lastName, employee.firstName);
            return (
              <Card>
                <View style={styles.row}>
                  <Avatar name={name} size={40} />
                  <View style={styles.fill}>
                    <ListItem
                      testID={`employee-${employee.id}`}
                      title={name}
                      subtitle={[employee.code, employee.position, employee.siteName].filter(Boolean).join(' · ')}
                      onPress={() => router.push(`/drh/employees/${employee.id}` as never)}
                      trailing={<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
                    />
                  </View>
                </View>
              </Card>
            );
          }}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fill: { flex: 1 },
});
