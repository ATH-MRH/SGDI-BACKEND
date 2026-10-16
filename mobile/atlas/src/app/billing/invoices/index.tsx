import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Invoice } from '@/api/domains/billing';
import { sameSociety } from '@/api/domains/ops';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { Segmented } from '@/components/Segmented';
import { StatusBadge } from '@/components/StatusBadge';
import { AtlasHeader, BottomSheet, ChoiceGroup, HeaderAction, QueryList, RecordRow, SearchBar } from '@/components/ui';
import { access } from '@/features/access';
import { useInvoices } from '@/features/commercial/hooks';
import { invoiceStatus, rawStatusLabel } from '@/features/status';
import { t } from '@/i18n';
import { useScope } from '@/scope/ScopeProvider';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney, localDate } from '@/utils/format';

type Period = 'all' | 'month' | 'quarter' | 'year';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/** Date de début de chaque période, au format "2026-10-01". */
function periodStart(period: Period): string | null {
  const today = localDate(0);
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  if (period === 'quarter') return localDate(-90);
  if (period === 'year') return `${today.slice(0, 4)}-01-01`;
  return null;
}

/**
 * Factures du périmètre. Le serveur renvoie la collection entière, déjà restreinte aux sociétés
 * du compte ; recherche, statut, période et société du contexte sont des filtres d'affichage.
 * Le statut est celui enregistré par ATLAS : le paiement n'est pas déduit sur le téléphone.
 */
export default function InvoicesScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const { scope } = useScope();
  const invoices = useInvoices();
  const [search, setSearch] = useState(params.q ?? '');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [sheet, setSheet] = useState(false);
  const needle = normalize(search.trim());
  const from = periodStart(period);
  const statuses = [...new Set((invoices.data ?? []).map((row) => row.status))].sort();
  const label = (value: string) => (invoiceStatus(value) ? t(invoiceStatus(value)?.label ?? 'common.none') : rawStatusLabel(value));

  const rows = (invoices.data ?? [])
    .filter((row: Invoice) => !scope.society || sameSociety(row.society, scope.society))
    .filter((row) => status === 'all' || row.status === status)
    .filter((row) => !from || (row.date ?? '') >= from)
    .filter((row) => !needle || normalize([row.number, row.client, row.object, row.site].filter(Boolean).join(' ')).includes(needle))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const filtered = status !== 'all' || period !== 'all';

  return (
    <Gate allowed={access.billing(user)}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID="invoices-screen">
        <AtlasHeader
          back
          title={t('billing.invoices')}
          subtitle={t('list.count', { shown: rows.length, total: invoices.data?.length ?? 0 })}
          trailing={<HeaderAction testID="invoices-filters" icon="options-outline" label={t('common.filters')} badge={filtered} onPress={() => setSheet(true)} />}
        />
        <QueryList
          testID="invoices-list"
          state={invoices}
          items={rows}
          keyOf={(row) => row.id}
          emptyTitle={t('invoices.empty.title')}
          emptyBody={needle ? t('search.noResult', { q: search.trim() }) : undefined}
          header={
            <View style={styles.header}>
              <SearchBar testID="invoices-search" value={search} onChangeText={setSearch} placeholder={t('invoices.search')} />
              <Segmented
                testID="invoices-period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'all', label: t('alerts.filter.all') },
                  { value: 'month', label: t('period.month') },
                  { value: 'quarter', label: t('period.quarter') },
                  { value: 'year', label: t('period.year') },
                ]}
              />
            </View>
          }
          renderItem={(row) => (
            <RecordRow
              testID={`invoice-${row.id}`}
              icon="receipt-outline"
              title={row.number || t('invoices.draftNumber')}
              subtitle={[row.client, formatDate(row.date)].filter(Boolean).join(' · ') || null}
              detail={row.dueDate ? t('invoices.due', { date: formatDate(row.dueDate) || row.dueDate }) : row.society}
              amount={formatMoney(row.totalTtc)}
              badge={<StatusBadge status={invoiceStatus(row.status)} fallback={rawStatusLabel(row.status)} />}
              onPress={() => router.push(`/billing/invoices/${encodeURIComponent(row.id)}` as never)}
            />
          )}
        />
        <BottomSheet
          testID="invoices-sheet"
          visible={sheet}
          title={t('common.filters')}
          onClose={() => setSheet(false)}
          resetLabel={t('common.reset')}
          onReset={() => {
            setStatus('all');
            setPeriod('all');
          }}
          actionLabel={t('common.apply')}
          onAction={() => setSheet(false)}>
          <ChoiceGroup
            testID="invoices-status"
            label={t('attendance.filter.status')}
            value={status}
            onChange={setStatus}
            options={[{ value: 'all', label: t('alerts.filter.all') }, ...statuses.map((value) => ({ value, label: label(value) }))]}
          />
          <ChoiceGroup
            testID="invoices-sheet-period"
            label={t('period.label')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'all', label: t('alerts.filter.all') },
              { value: 'month', label: t('period.month') },
              { value: 'quarter', label: t('period.quarter') },
              { value: 'year', label: t('period.year') },
            ]}
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
