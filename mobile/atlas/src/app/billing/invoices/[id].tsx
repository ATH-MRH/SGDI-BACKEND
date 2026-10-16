import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchInvoice } from '@/api/domains/billing';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, Banner, Card, ErrorState, InfoGrid, ListItem, Screen, SectionHeader, SkeletonDashboard, SkeletonLines } from '@/components/ui';
import { access } from '@/features/access';
import { usePayments } from '@/features/commercial/hooks';
import { invoiceStatus, rawStatusLabel } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney } from '@/utils/format';

/**
 * Fiche facture. Le serveur ne renvoie la facture que si elle appartient au périmètre du compte
 * (404 sinon). Les règlements enregistrés sont listés tels quels ; le payé et le reste à payer ne
 * sont pas publiés par le serveur et ne sont pas recalculés ici.
 */
export default function InvoiceDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = typeof id === 'string' ? id : '';
  const user = useCurrentUser();
  const allowed = access.billing(user) && invoiceId.length > 0;
  const query = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => fetchInvoice(api, invoiceId), enabled: allowed });
  const payments = usePayments();
  const invoice = query.data;
  const linked = invoice ? (payments.data ?? []).filter((payment) => payment.invoiceId === invoice.id) : [];
  const none = t('common.none');

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="invoice-detail" header={<AtlasHeader back title={invoice?.number || t('invoices.detail.title')} subtitle={invoice?.client} />}>
        {query.isPending ? (
          <SkeletonDashboard testID="invoice-loading" />
        ) : query.error || !invoice ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} onBack={() => router.back()} testID="invoice-error" />
        ) : (
          <>
            <Card testID="invoice-header">
              <View style={styles.head}>
                <SectionHeader title={t('invoices.detail.title')} />
                <StatusBadge status={invoiceStatus(invoice.status)} fallback={rawStatusLabel(invoice.status)} testID="invoice-status" />
              </View>
              <InfoGrid
                cells={[
                  { key: 'number', label: t('quotes.number'), value: invoice.number || t('invoices.draftNumber') },
                  { key: 'client', label: t('quotes.client'), value: invoice.client || none },
                  { key: 'date', label: t('quotes.date'), value: formatDate(invoice.date) || none },
                  { key: 'due', label: t('invoices.dueDate'), value: formatDate(invoice.dueDate) || invoice.dueDate || none },
                  { key: 'society', label: t('profile.societies'), value: invoice.society ?? none },
                  { key: 'mode', label: t('invoices.paymentMode'), value: invoice.paymentMode ?? none },
                  ...(invoice.periodStart || invoice.periodEnd
                    ? [{ key: 'period', label: t('invoices.period'), value: [formatDate(invoice.periodStart), formatDate(invoice.periodEnd)].filter(Boolean).join(' – '), wide: true }]
                    : []),
                  ...(invoice.site ? [{ key: 'site', label: t('employees.position.site'), value: invoice.site, wide: true }] : []),
                  ...(invoice.object ? [{ key: 'object', label: t('quotes.object'), value: invoice.object, wide: true }] : []),
                ]}
              />
            </Card>

            <Card testID="invoice-lines">
              <SectionHeader title={t('quotes.lines', { count: invoice.lines.length })} />
              {invoice.lines.length === 0 ? (
                <AppText color={colors.textSecondary}>{none}</AppText>
              ) : (
                invoice.lines.map((line) => (
                  <ListItem
                    key={line.key}
                    title={line.designation}
                    subtitle={
                      [
                        line.quantity !== null ? `${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : null,
                        line.unitPrice !== null ? t('quotes.unitPrice', { price: formatMoney(line.unitPrice) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    trailing={
                      line.totalHt !== null ? (
                        <AppText variant="label" color={colors.text}>
                          {formatMoney(line.totalHt)}
                        </AppText>
                      ) : undefined
                    }
                  />
                ))
              )}
            </Card>

            <Card testID="invoice-totals">
              <InfoGrid
                cells={[
                  { key: 'ht', label: t('money.ht'), value: formatMoney(invoice.totalHt) },
                  { key: 'vat', label: t('money.vat'), value: formatMoney(invoice.vat) },
                  { key: 'ttc', label: t('money.ttc'), value: formatMoney(invoice.totalTtc), wide: true },
                  { key: 'paid', label: t('invoices.paid'), value: t('common.notAvailable'), muted: true },
                  { key: 'remaining', label: t('invoices.remaining'), value: t('common.notAvailable'), muted: true },
                ]}
              />
            </Card>

            <Card testID="invoice-payments">
              <SectionHeader title={t('invoices.payments', { count: linked.length })} />
              {payments.isPending ? (
                <SkeletonLines />
              ) : payments.error ? (
                <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
              ) : linked.length === 0 ? (
                <AppText color={colors.textSecondary}>{none}</AppText>
              ) : (
                linked.map((payment) => (
                  <ListItem
                    key={payment.id}
                    icon="cash-outline"
                    iconTone="success"
                    title={formatMoney(payment.amount)}
                    subtitle={[formatDate(payment.date), payment.mode, payment.reference].filter(Boolean).join(' · ') || undefined}
                  />
                ))
              )}
            </Card>

            <Banner tone="info" message={t('invoices.webOnly')} testID="invoice-web-only" />
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
