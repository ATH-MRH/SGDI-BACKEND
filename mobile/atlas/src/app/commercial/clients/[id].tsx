import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { fetchQuotesPage } from '@/api/domains/commercial';
import { useCurrentUser } from '@/auth/AuthProvider';
import { Gate } from '@/components/Gate';
import { StatusBadge } from '@/components/StatusBadge';
import { AppText, AtlasHeader, Badge, Button, Card, EmptyState, ErrorState, IconTile, InfoGrid, ListItem, PillButton, RecordRow, Screen, SectionHeader, SkeletonDashboard, SkeletonLines } from '@/components/ui';
import { access } from '@/features/access';
import { useAllClients } from '@/features/commercial/hooks';
import { clientStatusTone, quoteStatus, rawStatusLabel } from '@/features/status';
import { t } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';
import { formatDate, formatMoney } from '@/utils/format';

/**
 * Fiche client. Le backend n'expose pas de lecture par identifiant : la fiche est prise dans la
 * liste des clients du périmètre (filtrée par le serveur), donc un client hors périmètre est introuvable.
 */
export default function ClientDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clientId = Number(id);
  const user = useCurrentUser();
  const allowed = access.commercial(user) && Number.isInteger(clientId) && clientId > 0;
  const clients = useAllClients();
  const row = clients.data?.find((entry) => entry.id === clientId) ?? null;
  const quotes = useQuery({
    queryKey: ['client', clientId, 'quotes'],
    queryFn: () => fetchQuotesPage(api, { client_id: clientId, page_size: 10 }),
    enabled: allowed && row !== null,
  });
  const none = t('common.none');

  return (
    <Gate allowed={allowed}>
      <Screen edges={['top', 'bottom', 'left', 'right']} testID="client-detail" header={<AtlasHeader back title={t('clients.detail.title')} />}>
        {clients.isPending ? (
          <SkeletonDashboard testID="client-loading" />
        ) : clients.error ? (
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} onBack={() => router.back()} testID="client-error" />
        ) : !row ? (
          <EmptyState icon="briefcase-outline" title={t('clients.notFound.title')} body={t('clients.notFound.body')} testID="client-not-found" />
        ) : (
          <>
            <View style={[styles.identity, elevation.card]} testID="client-identity">
              <IconTile icon="briefcase-outline" size={56} />
              <View style={styles.texts}>
                <AppText variant="heading" color={colors.navy} accessibilityRole="header" numberOfLines={2} style={styles.name}>
                  {row.name}
                </AppText>
                {row.legalName && row.legalName !== row.name ? (
                  <AppText variant="caption" color={colors.textSecondary} numberOfLines={2}>
                    {row.legalName}
                  </AppText>
                ) : null}
                <Badge label={rawStatusLabel(row.status)} tone={clientStatusTone(row.status)} testID="client-status" />
              </View>
            </View>

            <Card testID="client-info">
              <SectionHeader title={t('clients.identity')} />
              <InfoGrid
                cells={[
                  { key: 'society', label: t('profile.societies'), value: row.society ?? none },
                  { key: 'structure', label: t('clients.structure'), value: row.structure ?? none },
                  { key: 'services', label: t('clients.services'), value: row.services ?? none, wide: true },
                  { key: 'address', label: t('sites.location'), value: row.address ?? none, wide: true },
                ]}
              />
            </Card>

            <Card testID="client-contact">
              <SectionHeader title={t('clients.contact')} />
              <InfoGrid
                cells={[
                  { key: 'name', label: t('clients.contactName'), value: row.contactName ?? none },
                  { key: 'position', label: t('clients.contactPosition'), value: row.contactPosition ?? none },
                  { key: 'phone', label: t('employees.phone'), value: row.phone ?? none },
                  { key: 'email', label: t('profile.email'), value: row.email ?? none },
                ]}
              />
              {row.phone || row.email ? (
                <View style={styles.actions}>
                  {row.phone ? <PillButton testID="client-call" primary icon="call-outline" label={t('employees.call')} onPress={() => void Linking.openURL(`tel:${row.phone}`)} /> : null}
                  {row.email ? <PillButton testID="client-mail" icon="mail-outline" label={t('employees.mail')} onPress={() => void Linking.openURL(`mailto:${row.email}`)} /> : null}
                </View>
              ) : null}
            </Card>

            <Card testID="client-contract">
              <SectionHeader title={t('clients.contract')} />
              <InfoGrid
                cells={[
                  { key: 'start', label: t('contracts.start'), value: formatDate(row.contractStart) || none },
                  { key: 'end', label: t('contracts.end'), value: formatDate(row.contractEnd) || none },
                  { key: 'duration', label: t('contracts.duration'), value: row.contractDuration ?? none },
                  { key: 'status', label: t('contracts.status'), value: row.contractStatus ? rawStatusLabel(row.contractStatus) : none },
                ]}
              />
            </Card>

            <Card testID="client-sites">
              <SectionHeader title={t('clients.sitesTitle', { count: row.sitesCount ?? row.siteNames.length })} />
              {row.siteNames.length === 0 ? (
                <AppText color={colors.textSecondary}>{none}</AppText>
              ) : (
                row.siteNames.map((name) => <ListItem key={name} icon="business-outline" title={name} />)
              )}
            </Card>

            <View style={styles.section} testID="client-quotes">
              <SectionHeader title={t('commercial.quotes')} actionLabel={t('common.seeAll')} onAction={() => router.push(`/commercial/quotes?client_id=${row.id}` as never)} />
              {quotes.isPending ? (
                <SkeletonLines />
              ) : quotes.error ? (
                <AppText color={colors.textSecondary}>{t('section.unavailable')}</AppText>
              ) : quotes.data.items.length === 0 ? (
                <AppText color={colors.textSecondary}>{none}</AppText>
              ) : (
                quotes.data.items.map((quote) => (
                  <RecordRow
                    key={quote.id}
                    icon="document-text-outline"
                    title={quote.number || t('quotes.draftNumber')}
                    subtitle={formatDate(quote.date)}
                    amount={formatMoney(quote.totalTtc)}
                    badge={<StatusBadge status={quoteStatus(quote.status)} fallback={quote.status} />}
                    onPress={() => router.push(`/commercial/quotes/${quote.id}` as never)}
                  />
                ))
              )}
            </View>

            {access.billing(user) ? (
              <Button
                testID="client-invoices"
                variant="secondary"
                icon="receipt-outline"
                label={t('clients.invoices')}
                onPress={() => router.push(`/billing/invoices?q=${encodeURIComponent(row.name)}` as never)}
              />
            ) : null}
          </>
        )}
      </Screen>
    </Gate>
  );
}

const styles = StyleSheet.create({
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
  texts: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  name: { fontSize: 19, lineHeight: 24 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
});
