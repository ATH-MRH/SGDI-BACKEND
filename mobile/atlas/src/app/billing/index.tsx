import { useRouter } from 'expo-router';
import { RefreshControl } from 'react-native';

import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { AtlasHeader, Banner, ChartCard, Distribution, KpiCard, KpiGrid, ModuleTile, Screen, SectionHeader, StatLine } from '@/components/ui';
import { access } from '@/features/access';
import { useErpCounters, useMonthSales, useMonthSalesByStatus } from '@/features/commercial/hooks';
import { invoiceStatus, rawStatusLabel } from '@/features/status';
import { t } from '@/i18n';
import { societyLabel } from '@/scope/labels';
import { useScope } from '@/scope/ScopeProvider';
import { colors } from '@/theme/tokens';
import { formatMoney, formatMoneyShort } from '@/utils/format';

type State = 'loading' | 'error' | 'ready';
const stateOf = (query: { isPending: boolean; error: unknown }): State => (query.isPending ? 'loading' : query.error ? 'error' : 'ready');

/** Tableau de bord Facturation : uniquement des montants et des comptes calculés par le serveur. */
export default function BillingScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const counters = useErpCounters();
  const sales = useMonthSales();
  const byStatus = useMonthSalesByStatus();
  const reports = access.salesReports(user);
  const billing = counters.data?.billing ?? null;
  const state = stateOf(counters);
  const unavailable = t('cockpit.unavailable');
  const go = (route: string) => router.push(route as never);
  const top = billing ? Math.max(billing.invoicedTtc, billing.paymentsAmount, 1) : 1;
  const refresh = () => {
    void counters.refetch();
    if (reports) {
      void sales.refetch();
      void byStatus.refetch();
    }
  };

  return (
    <Gate allowed={access.billing(user)}>
      <Screen
        edges={['top', 'bottom', 'left', 'right']}
        testID="billing-screen"
        header={<AtlasHeader back title={t('billing.title')} subtitle={`${t('billing.subtitle')} · ${societyLabel(scope)}`} />}
        refreshControl={<RefreshControl refreshing={counters.isRefetching || sales.isRefetching} onRefresh={refresh} tintColor={colors.navy} />}>
        <KpiGrid testID="billing-kpis">
          <KpiCard variant="compact" testID="billing-kpi-issued" icon="receipt-outline" label={t('billing.kpi.issued')} value={billing?.invoicesIssued ?? null} state={state} unavailableLabel={unavailable} onPress={() => go('/billing/invoices')} />
          <KpiCard variant="compact" testID="billing-kpi-invoiced" icon="trending-up-outline" label={t('billing.kpi.invoiced')} value={billing ? formatMoneyShort(billing.invoicedTtc) : null} state={state} unavailableLabel={unavailable} />
          <KpiCard variant="compact" testID="billing-kpi-collected" icon="cash-outline" tone="success" label={t('billing.kpi.collected')} value={billing ? formatMoneyShort(billing.paymentsAmount) : null} state={state} unavailableLabel={unavailable} onPress={() => go('/billing/payments')} />
          <KpiCard variant="compact" testID="billing-kpi-credit-notes" icon="return-down-back-outline" label={t('billing.kpi.creditNotes')} value={billing?.creditNotesTotal ?? null} state={state} unavailableLabel={unavailable} />
          {reports ? (
            <KpiCard variant="compact" testID="billing-kpi-month-revenue" icon="stats-chart-outline" label={t('billing.kpi.monthRevenue')} value={sales.data ? formatMoneyShort(sales.data.revenueHt) : null} state={stateOf(sales)} unavailableLabel={unavailable} />
          ) : null}
          {reports ? (
            <KpiCard variant="compact" testID="billing-kpi-month-collected" icon="wallet-outline" tone="success" label={t('billing.kpi.monthCollected')} value={sales.data ? formatMoneyShort(sales.data.collected) : null} state={stateOf(sales)} unavailableLabel={unavailable} />
          ) : null}
          {reports ? (
            <KpiCard variant="compact" testID="billing-kpi-month-invoices" icon="documents-outline" label={t('billing.kpi.monthInvoices')} value={sales.data?.invoices ?? null} state={stateOf(sales)} unavailableLabel={unavailable} />
          ) : null}
          <KpiCard variant="compact" testID="billing-kpi-payments" icon="card-outline" label={t('billing.kpi.payments')} value={billing?.paymentsTotal ?? null} state={state} unavailableLabel={unavailable} onPress={() => go('/billing/payments')} />
        </KpiGrid>

        <Banner testID="billing-outstanding-note" tone="info" title={t('billing.outstanding.title')} message={t('billing.outstanding.body')} />

        {billing ? (
          <ChartCard testID="billing-invoiced-collected" title={t('billing.chart.invoicedCollected')} hint={t('billing.chart.allTime')}>
            <StatLine label={t('billing.kpi.invoiced')} value={formatMoney(billing.invoicedTtc)} ratio={billing.invoicedTtc / top} tone="brand" />
            <StatLine label={t('billing.kpi.collected')} value={formatMoney(billing.paymentsAmount)} ratio={billing.paymentsAmount / top} tone="success" />
          </ChartCard>
        ) : null}

        {reports && byStatus.data && byStatus.data.invoices.byStatus.length > 0 ? (
          <ChartCard testID="billing-by-status" title={t('billing.chart.byStatus')} hint={t('billing.chart.month')}>
            <Distribution
              segments={byStatus.data.invoices.byStatus.map((entry) => ({
                key: entry.status,
                label: invoiceStatus(entry.status) ? t(invoiceStatus(entry.status)?.label ?? 'common.none') : rawStatusLabel(entry.status),
                value: entry.count,
                tone: invoiceStatus(entry.status)?.tone,
              }))}
            />
          </ChartCard>
        ) : null}

        <SectionHeader title={t('commercial.sections')} />
        <KpiGrid columns={3}>
          <ModuleTile testID="billing-go-invoices" icon="receipt-outline" label={t('billing.invoices')} caption={t('billing.invoices.body')} onPress={() => go('/billing/invoices')} />
          <ModuleTile testID="billing-go-payments" icon="cash-outline" label={t('billing.payments')} caption={t('billing.payments.body')} onPress={() => go('/billing/payments')} />
          {access.commercial(user) ? <ModuleTile testID="billing-go-commercial" icon="briefcase-outline" label={t('commercial.title')} caption={t('commercial.subtitle')} onPress={() => go('/commercial')} /> : null}
        </KpiGrid>
      </Screen>
    </Gate>
  );
}
