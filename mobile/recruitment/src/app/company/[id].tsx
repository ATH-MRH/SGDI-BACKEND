import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Icon } from '../../components/icon';
import { OfferCard } from '../../components/offer-card';
import { Card, colors, EmptyState, ErrorState, Heading, Loading, Monogram, styles } from '../../components/ui';
import { fetchCompany, logoUri } from '../../lib/emploi';
import { useLoad } from '../../lib/use-load';

export default function CompanyScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const company = useLoad(signal => fetchCompany(id, signal), `company:${id}`, Number.isFinite(id));
  if (company.loading && !company.data) return <Loading label="Chargement de la société…" />;
  if (!company.data) {
    return company.status === 404 || !Number.isFinite(id)
      ? <View style={{ padding: 18 }}><Card><EmptyState icon="building" title="Société introuvable" text="Cette société n’a pas d’annonce publiée." /></Card></View>
      : <ErrorState message={company.error} onRetry={company.reload} />;
  }
  const data = company.data;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.name }} />
      <Card>
        <View style={page.head}>
          <Monogram name={data.name} uri={logoUri(data)} size={64} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text accessibilityRole="header" style={page.name}>{data.name}</Text>
            {!!data.sector && <Text style={styles.subtitle}>{data.sector}</Text>}
          </View>
        </View>
        {!!data.city && <View style={page.fact}><Icon name="pin" size={18} color={colors.goldDeep} /><Text style={page.factText}>{data.city}</Text></View>}
      </Card>
      {!!data.description.trim() && (
        <Card>
          <Text accessibilityRole="header" style={styles.heading}>À propos</Text>
          <Text style={page.about}>{data.description.trim()}</Text>
        </Card>
      )}
      <Heading>{`Offres disponibles (${data.offers.length})`}</Heading>
      {data.offers.length ? data.offers.map(offer => <OfferCard key={offer.id} offer={offer} />)
        : <Card><EmptyState icon="briefcase" title="Aucune offre ouverte" text="Cette société n’a pas d’annonce ouverte pour le moment." /></Card>}
    </ScrollView>
  );
}

const page = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 }, name: { fontSize: 20, fontWeight: '700', color: colors.ink },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 }, factText: { fontSize: 14, color: colors.ink }, about: { fontSize: 15, lineHeight: 23, color: colors.ink },
});
