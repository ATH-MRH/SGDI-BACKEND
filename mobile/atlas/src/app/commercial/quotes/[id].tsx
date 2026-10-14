import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchQuote } from '@/api/domains/commercial';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, Card, ErrorState, InfoGrid, ListItem, Screen, SectionHeader, SkeletonDashboard } from '@/components/ui';
import { access } from '@/features/access';
import { quoteStatus } from '@/features/status';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';
import { formatDate, formatMoney } from '@/utils/format';

/** Devis : en-tête, lignes et totaux tels qu'enregistrés par le serveur (le serveur refuse un devis hors périmètre). */
export default function QuoteDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quoteId = Number(id);
  const user = useCurrentUser();
  const allowed = access.commercial(user) && Number.isInteger(quoteId) && quoteId > 0;
  const query = useQuery({ queryKey: ['quote', quoteId], queryFn: () => fetchQuote(api, quoteId), enabled: allowed });
  const quote = query.data;
  const none = t('common.none');

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="quote-detail" header={<AtlasHeader back title={quote?.number || t('quotes.detail.title')} subtitle={quote?.clientName} />}>
        {query.isPending ? (
          <SkeletonDashboard testID="quote-loading" />
        ) : query.error || !quote ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} onBack={() => router.back()} testID="quote-error" />
        ) : (
          <>
            <Card testID="quote-header">
              <View style={styles.head}>
                <SectionHeader title={t('quotes.detail.title')} />
                <StatusBadge status={quoteStatus(quote.status)} fallback={quote.status} testID="quote-status" />
              </View>
              <InfoGrid
                cells={[
                  { key: 'number', label: t('quotes.number'), value: quote.number || t('quotes.draftNumber') },
                  { key: 'client', label: t('quotes.client'), value: quote.clientName || none },
                  { key: 'date', label: t('quotes.date'), value: formatDate(quote.date) || none },
                  { key: 'valid', label: t('quotes.validity'), value: formatDate(quote.validUntil) || none },
                  { key: 'society', label: t('profile.societies'), value: quote.society ?? none },
                  { key: 'object', label: t('quotes.object'), value: quote.object ?? none, wide: true },
                ]}
              />
            </Card>

            <Card testID="quote-lines">
              <SectionHeader title={t('quotes.lines', { count: quote.lines.length })} />
              {quote.lines.length === 0 ? (
                <AppText color={colors.textSecondary}>{none}</AppText>
              ) : (
                quote.lines.map((line) => (
                  <ListItem
                    key={line.id}
                    title={line.designation}
                    subtitle={[
                      line.quantity !== null ? `${line.quantity}${line.unit ? ` ${line.unit}` : ''}` : null,
                      line.unitPrice !== null ? t('quotes.unitPrice', { price: formatMoney(line.unitPrice) }) : null,
                      line.vatRate !== null ? t('quotes.vatRate', { rate: line.vatRate }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <AppText variant="label" color={colors.text}>
                        {formatMoney(line.totalHt)}
                      </AppText>
                    }
                  />
                ))
              )}
            </Card>

            <Card testID="quote-totals">
              <InfoGrid
                cells={[
                  { key: 'ht', label: t('money.ht'), value: formatMoney(quote.totalHt) },
                  { key: 'vat', label: t('money.vat'), value: formatMoney(quote.vat) },
                  { key: 'ttc', label: t('money.ttc'), value: formatMoney(quote.totalTtc), wide: true },
                ]}
              />
            </Card>
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
