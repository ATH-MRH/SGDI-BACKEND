import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { fetchCandidatesPage, type Candidate, type CandidateMode } from '@/api/domains/drh';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { Badge, Card, ListItem, PagedList, ScreenHeader, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePagedList } from '@/hooks/usePagedList';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, fullName } from '@/utils/format';

/** Candidats du recrutement, en consultation. Les décisions se prennent dans ATLAS Web. */
export default function RecruitmentScreen() {
  const user = useCurrentUser();
  const [mode, setMode] = useState<CandidateMode>('new');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim());
  const allowed = access.candidates(user);

  const list = usePagedList<Candidate>({
    queryKey: ['candidates', mode, q],
    fetchPage: (page) => fetchCandidatesPage(api, { q: q || undefined, mode, page }),
    enabled: allowed,
  });

  return (
    <Gate allowed={allowed}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="recruitment-screen">
        <ScreenHeader title={t('entry.candidates')} />
        <View style={styles.filters}>
          <SearchBar testID="candidates-search" value={search} onChangeText={setSearch} placeholder={t('candidates.search')} />
          <Segmented
            testID="candidates-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'new', label: t('candidates.mode.new') },
              { value: 'reserve', label: t('candidates.mode.reserve') },
              { value: 'recruited', label: t('candidates.mode.recruited') },
              { value: 'all', label: t('alerts.filter.all') },
            ]}
          />
        </View>
        <PagedList
          testID="candidates-list"
          list={list}
          keyOf={(candidate) => String(candidate.id)}
          emptyTitle={t('candidates.empty.title')}
          emptyBody={q ? t('search.noResult', { q }) : undefined}
          renderItem={(candidate) => (
            <Card>
              <ListItem
                testID={`candidate-${candidate.id}`}
                title={fullName(candidate.lastName, candidate.firstName)}
                subtitle={[candidate.desiredPosition, candidate.society, formatDate(candidate.createdAt)].filter(Boolean).join(' · ')}
                trailing={<Badge label={candidate.status} />}
              />
            </Card>
          )}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
});
