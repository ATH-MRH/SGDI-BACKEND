import { useRouter } from 'expo-router';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AtlasHeader, EmptyState, KpiCard, KpiGrid, ModuleTile, RecordRow, Screen, SectionHeader, SkeletonList } from '@/components/ui';
import { access } from '@/features/access';
import { useErpCounters, useMonthSales, useQuotesSent, useRecentQuotes } from '@/features/commercial/hooks';
import { quoteStatus } from '@/features/status';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney, formatMoneyShort } from '@/utils/format';

type State = 'loading' | 'error' | 'ready';
const stateOf = (query: { isPending: boolean; error: unknown }): State => (query.isPending ? 'loading' : query.error ? 'error' : 'ready');

/** Tableau de bord Commercial : compteurs calculés par le serveur, accès aux listes, derniers devis. */
export default function CommercialScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const counters = useErpCounters();
  const sent = useQuotesSent();
  const recent = useRecentQuotes();
  const sales = useMonthSales();
  const go = (route: string) => router.push(route as never);
  const commercial = counters.data?.commercial ?? null;
  const counterState = stateOf(counters);
  const unavailable = t('cockpit.unavailable');
  const refresh = () => {
    void counters.refetch();
    void sent.refetch();
    void recent.refetch();
    if (access.salesReports(user)) void sales.refetch();
  };

  return (
    <Gate allowed={access.commercial(user)}>
      <Screen
        edges={['top', 'bottom', 'left', 'right']}
        testID="commercial-screen"
        header={<AtlasHeader back title={t('commercial.title')} subtitle={`${t('commercial.subtitle')} · ${societyLabel(scope)}`} />}
        refreshControl={<RefreshControl refreshing={counters.isRefetching || recent.isRefetching} onRefresh={refresh} tintColor={colors.navy} />}>
        <KpiGrid testID="commercial-kpis">
          <KpiCard variant="compact" testID="commercial-kpi-prospects" icon="person-add-outline" label={t('commercial.kpi.prospects')} value={commercial?.prospects ?? null} state={counterState} unavailableLabel={unavailable} onPress={() => go('/commercial/prospects')} />
          <KpiCard variant="compact" testID="commercial-kpi-clients" icon="briefcase-outline" label={t('commercial.kpi.clients')} value={commercial?.clientsActive ?? null} state={counterState} unavailableLabel={unavailable} onPress={() => go('/commercial/clients')} />
          <KpiCard variant="compact" testID="commercial-kpi-opportunities" icon="trending-up-outline" label={t('commercial.kpi.opportunities')} value={commercial?.opportunitiesOpen ?? null} state={counterState} unavailableLabel={unavailable} onPress={() => go('/commercial/prospects?tab=opportunities')} />
          <KpiCard variant="compact" testID="commercial-kpi-quotes" icon="document-text-outline" label={t('commercial.kpi.quotesSent')} value={sent.data?.total ?? null} state={stateOf(sent)} unavailableLabel={unavailable} onPress={() => go('/commercial/quotes?status=envoyé')} />
          <KpiCard variant="compact" testID="commercial-kpi-contracts" icon="ribbon-outline" label={t('commercial.kpi.contracts')} value={commercial?.contractsActive ?? null} state={counterState} unavailableLabel={unavailable} onPress={() => go('/commercial/contracts')} />
          <KpiCard
            variant="compact"
            testID="commercial-kpi-ending"
            icon="hourglass-outline"
            label={t('commercial.kpi.ending')}
            value={commercial?.contractsEnding30d ?? null}
            tone={commercial && commercial.contractsEnding30d > 0 ? 'warning' : 'neutral'}
            state={counterState}
            unavailableLabel={unavailable}
            onPress={() => go('/commercial/contracts')}
          />
          <KpiCard variant="compact" testID="commercial-kpi-sites" icon="business-outline" label={t('commercial.kpi.sites')} value={commercial?.sitesTotal ?? null} state={counterState} unavailableLabel={unavailable} />
          {access.salesReports(user) ? (
            <KpiCard variant="compact" testID="commercial-kpi-revenue" icon="cash-outline" label={t('commercial.kpi.revenue')} value={sales.data ? formatMoneyShort(sales.data.revenueHt) : null} state={stateOf(sales)} unavailableLabel={unavailable} />
          ) : null}
        </KpiGrid>

        <SectionHeader title={t('commercial.sections')} />
        <KpiGrid columns={3}>
          <ModuleTile testID="commercial-go-clients" icon="briefcase-outline" label={t('commercial.clients')} caption={t('commercial.clients.body')} onPress={() => go('/commercial/clients')} />
          <ModuleTile testID="commercial-go-prospects" icon="person-add-outline" label={t('commercial.prospects')} caption={t('commercial.prospects.body')} onPress={() => go('/commercial/prospects')} />
          <ModuleTile testID="commercial-go-opportunities" icon="trending-up-outline" label={t('commercial.opportunities')} caption={t('commercial.opportunities.body')} onPress={() => go('/commercial/prospects?tab=opportunities')} />
          <ModuleTile testID="commercial-go-quotes" icon="document-text-outline" label={t('commercial.quotes')} caption={t('commercial.quotes.body')} onPress={() => go('/commercial/quotes')} />
          <ModuleTile testID="commercial-go-contracts" icon="ribbon-outline" label={t('commercial.contracts')} caption={t('commercial.contracts.body')} onPress={() => go('/commercial/contracts')} />
          {access.billing(user) ? (
            <ModuleTile testID="commercial-go-billing" icon="receipt-outline" label={t('billing.title')} caption={t('billing.subtitle')} onPress={() => go('/billing')} />
          ) : null}
        </KpiGrid>

        <View style={styles.section} testID="commercial-recent">
          <SectionHeader title={t('commercial.recentQuotes')} actionLabel={t('common.seeAll')} onAction={() => go('/commercial/quotes')} />
          {recent.isPending ? (
            <SkeletonList rows={3} />
          ) : recent.data && recent.data.items.length > 0 ? (
            recent.data.items.map((quote) => (
              <RecordRow
                key={quote.id}
                testID={`commercial-quote-${quote.id}`}
                icon="document-text-outline"
                title={quote.number || t('quotes.draftNumber')}
                subtitle={[quote.clientName, formatDate(quote.date)].filter(Boolean).join(' · ')}
                amount={formatMoney(quote.totalTtc)}
                badge={<StatusBadge status={quoteStatus(quote.status)} fallback={quote.status} />}
                onPress={() => go(`/commercial/quotes/${quote.id}`)}
              />
            ))
          ) : (
            <EmptyState icon="document-text-outline" title={recent.error ? unavailable : t('quotes.empty.title')} />
          )}
        </View>
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
});
