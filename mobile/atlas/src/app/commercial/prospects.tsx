import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OPPORTUNITY_STAGES, PROSPECT_STATUSES, type Opportunity, type Prospect } from '@/api/domains/commercial';
import { sameSociety } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AtlasHeader, BottomSheet, ChoiceGroup, HeaderAction, QueryList, RecordRow, SearchBar, TabStrip } from '@/components/ui';
import { access } from '@/features/access';
import { useOpportunities, useProspects } from '@/features/commercial/hooks';
import { opportunityStage, prospectStatus } from '@/features/status';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney } from '@/utils/format';

type Tab = 'prospects' | 'opportunities';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/**
 * Prospects et opportunités du périmètre. Le serveur renvoie la collection entière, déjà
 * restreinte aux sociétés du compte ; l'écran la limite au contexte choisi et la filtre.
 */
export default function ProspectsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const user = useCurrentUser();
  const { scope } = useScope();
  const [tab, setTab] = useState<Tab>(params.tab === 'opportunities' ? 'opportunities' : 'prospects');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sheet, setSheet] = useState(false);
  const prospects = useProspects();
  const opportunities = useOpportunities();
  const needle = normalize(search.trim());
  const inScope = (society: string | null) => !scope.society || sameSociety(society, scope.society);

  const shownProspects = (prospects.data ?? []).filter(
    (row: Prospect) =>
      inScope(row.society) &&
      (status === 'all' || row.status === status) &&
      (!needle || normalize([row.name, row.contact, row.source].filter(Boolean).join(' ')).includes(needle)),
  );
  const shownOpportunities = (opportunities.data ?? []).filter(
    (row: Opportunity) =>
      inScope(row.society) &&
      (status === 'all' || row.stage === status) &&
      (!needle || normalize([row.title, row.target].filter(Boolean).join(' ')).includes(needle)),
  );
  const choices =
    tab === 'prospects'
      ? PROSPECT_STATUSES.map((value) => ({ value, label: t(prospectStatus(value)?.label ?? 'common.none') }))
      : OPPORTUNITY_STAGES.map((value) => ({ value, label: t(opportunityStage(value)?.label ?? 'common.none') }));

  const header = (
    <View style={styles.header}>
      <SearchBar testID="prospects-search" value={search} onChangeText={setSearch} placeholder={t(tab === 'prospects' ? 'prospects.search' : 'opportunities.search')} />
      <Segmented
        testID="prospects-status"
        value={status}
        onChange={setStatus}
        options={[{ value: 'all', label: t('alerts.filter.all') }, ...choices.slice(0, 4)]}
      />
    </View>
  );

  return (
    <Gate allowed={access.commercial(user)}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="prospects-screen">
        <AtlasHeader
          back
          title={t(tab === 'prospects' ? 'commercial.prospects' : 'commercial.opportunities')}
          subtitle={t('list.count', { shown: tab === 'prospects' ? shownProspects.length : shownOpportunities.length, total: tab === 'prospects' ? (prospects.data?.length ?? 0) : (opportunities.data?.length ?? 0) })}
          trailing={<HeaderAction testID="prospects-filters" icon="options-outline" label={t('common.filters')} badge={status !== 'all'} onPress={() => setSheet(true)} />}
        />
        <TabStrip
          fill
          testID="prospects-tabs"
          value={tab}
          onChange={(next) => {
            setTab(next);
            setStatus('all');
          }}
          options={[
            { value: 'prospects', label: t('commercial.prospects') },
            { value: 'opportunities', label: t('commercial.opportunities') },
          ]}
        />
        {tab === 'prospects' ? (
          <QueryList
            testID="prospects-list"
            state={prospects}
            items={shownProspects}
            keyOf={(row) => row.id}
            header={header}
            emptyTitle={t('prospects.empty.title')}
            emptyBody={needle ? t('search.noResult', { q: search.trim() }) : undefined}
            renderItem={(row) => (
              <RecordRow
                testID={`prospect-${row.id}`}
                icon="person-add-outline"
                title={row.name}
                subtitle={[row.contact, row.phone ?? row.email].filter(Boolean).join(' · ') || null}
                detail={[row.source, row.society, row.createdAt ? formatDate(row.createdAt) : null].filter(Boolean).join(' · ') || null}
                badge={<StatusBadge status={prospectStatus(row.status)} fallback={row.status} />}
              />
            )}
          />
        ) : (
          <QueryList
            testID="opportunities-list"
            state={opportunities}
            items={shownOpportunities}
            keyOf={(row) => row.id}
            header={header}
            emptyTitle={t('opportunities.empty.title')}
            emptyBody={needle ? t('search.noResult', { q: search.trim() }) : undefined}
            renderItem={(row) => (
              <RecordRow
                testID={`opportunity-${row.id}`}
                icon="trending-up-outline"
                title={row.title}
                subtitle={[row.target, row.createdBy].filter(Boolean).join(' · ') || null}
                detail={
                  [
                    row.probability !== null ? t('opportunities.probability', { value: Math.round(row.probability) }) : null,
                    row.closeDate ? t('opportunities.closing', { date: formatDate(row.closeDate) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                }
                amount={row.amount !== null ? formatMoney(row.amount) : null}
                badge={<StatusBadge status={opportunityStage(row.stage)} fallback={row.stage} />}
              />
            )}
          />
        )}
        <BottomSheet
          testID="prospects-sheet"
          visible={sheet}
          title={t('common.filters')}
          onClose={() => setSheet(false)}
          resetLabel={t('common.reset')}
          onReset={() => setStatus('all')}
          actionLabel={t('common.apply')}
          onAction={() => setSheet(false)}>
          <ChoiceGroup
            testID="prospects-sheet-status"
            label={t(tab === 'prospects' ? 'attendance.filter.status' : 'opportunities.stage')}
            value={status}
            onChange={setStatus}
            options={[{ value: 'all', label: t('alerts.filter.all') }, ...choices]}
          />
        </BottomSheet>
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.md, marginBottom: spacing.md },
});
