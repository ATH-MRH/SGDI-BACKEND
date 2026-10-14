import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sameSociety } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { AtlasHeader, Badge, QueryList, RecordRow, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useInvoices, usePayments } from '@/features/commercial/hooks';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney, localDate } from '@/utils/format';

type Period = 'all' | 'month' | 'year';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/** Règlements enregistrés dans ATLAS, du plus récent au plus ancien, avec la facture qu'ils soldent. */
export default function PaymentsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const payments = usePayments();
  const invoices = useInvoices();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const needle = normalize(search.trim());
  const today = localDate(0);
  const from = period === 'month' ? `${today.slice(0, 7)}-01` : period === 'year' ? `${today.slice(0, 4)}-01-01` : null;
  const numbers = new Map((invoices.data ?? []).map((invoice) => [invoice.id, invoice.number]));

  const rows = (payments.data ?? [])
    .filter((row) => !scope.society || sameSociety(row.society, scope.society))
    .filter((row) => !from || (row.date ?? '') >= from)
    .filter((row) => !needle || normalize([row.client, row.reference, row.mode, row.invoiceId ? numbers.get(row.invoiceId) : null].filter(Boolean).join(' ')).includes(needle))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return (
    <Gate allowed={access.billing(user)}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="payments-screen">
        <AtlasHeader back title={t('billing.payments')} subtitle={t('list.count', { shown: rows.length, total: payments.data?.length ?? 0 })} />
        <QueryList
          testID="payments-list"
          state={payments}
          items={rows}
          keyOf={(row) => row.id}
          emptyTitle={t('payments.empty.title')}
          emptyBody={needle ? t('search.noResult', { q: search.trim() }) : undefined}
          header={
            <View style={styles.header}>
              <SearchBar testID="payments-search" value={search} onChangeText={setSearch} placeholder={t('payments.search')} />
              <Segmented
                testID="payments-period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'all', label: t('alerts.filter.all') },
                  { value: 'month', label: t('period.month') },
                  { value: 'year', label: t('period.year') },
                ]}
              />
            </View>
          }
          renderItem={(row) => {
            const number = row.invoiceId ? numbers.get(row.invoiceId) : undefined;
            return (
              <RecordRow
                testID={`payment-${row.id}`}
                icon="cash-outline"
                title={row.client || t('payments.unknownClient')}
                subtitle={[formatDate(row.date), number ? t('payments.invoice', { number }) : null].filter(Boolean).join(' · ') || null}
                detail={[row.reference, row.society].filter(Boolean).join(' · ') || null}
                amount={formatMoney(row.amount)}
                badge={row.mode ? <Badge label={row.mode} /> : null}
                onPress={row.invoiceId ? () => router.push(`/billing/invoices/${encodeURIComponent(row.invoiceId ?? '')}` as never) : undefined}
              />
            );
          }}
        />
      </SafeAreaView>
    </Gate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.md, marginBottom: spacing.md },
});
