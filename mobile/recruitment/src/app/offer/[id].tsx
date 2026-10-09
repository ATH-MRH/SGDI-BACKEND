import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, IconName } from '../../components/icon';
import { Button, Card, colors, EmptyState, ErrorState, Loading, Monogram, styles } from '../../components/ui';
import { useCandidateSession } from '../../lib/candidate-session';
import { fetchOffer, formatDate, lines, logoUri } from '../../lib/emploi';
import { useFavorites } from '../../lib/favorites';
import { useLoad } from '../../lib/use-load';

export default function OfferScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { session } = useCandidateSession();
  const { isFavorite, toggle, remove } = useFavorites();
  const offer = useLoad(signal => fetchOffer(id, signal), `offer:${id}`, Number.isFinite(id));
  const saved = isFavorite(id);

  if (offer.loading && !offer.data) return <Loading label="Chargement de l’offre…" />;
  if (!offer.data) {
    // 404 : annonce clôturée, expirée ou retirée depuis son affichage.
    return offer.status === 404 || !Number.isFinite(id) ? (
      <View style={{ padding: 18 }}>
        <Card><EmptyState icon="clock" title="Cette offre n’est plus disponible" text="Elle a été pourvue ou clôturée par la société."
          action={saved ? 'Retirer de mes favoris' : 'Voir les autres offres'} onAction={() => { if (saved) remove(id); router.replace('/offers'); }} /></Card>
      </View>
    ) : <ErrorState message={offer.error} onRetry={offer.reload} />;
  }

  const data = offer.data;
  const apply = () => router.push(session ? { pathname: '/apply', params: { offerId: String(id) } } : { pathname: '/identify', params: { next: 'apply', offerId: String(id) } });
  const facts: { icon: IconName; label: string; value: string }[] = [
    { icon: 'pin', label: 'Lieu', value: [data.wilaya, data.location].filter(Boolean).join(' · ') },
    { icon: 'file', label: 'Contrat', value: data.contract_type || '' },
    { icon: 'users', label: 'Postes à pourvoir', value: data.positions > 1 ? String(data.positions) : '' },
    { icon: 'calendar', label: 'Date limite', value: formatDate(data.deadline) },
  ].filter(fact => fact.value) as { icon: IconName; label: string; value: string }[];

  return (
    <SafeAreaView style={styles.page} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} accessibilityState={{ selected: saved }} hitSlop={12} onPress={() => toggle(data)}>
          <Icon name="bookmark" size={24} color={saved ? colors.gold : colors.navy} filled={saved} />
        </Pressable>
      ) }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Pressable accessibilityRole="link" accessibilityLabel={`Société ${data.company.name}`} onPress={() => router.push({ pathname: '/company/[id]', params: { id: String(data.company.id) } })} style={detail.company}>
            <Monogram name={data.company.name} uri={logoUri(data.company)} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={detail.companyName}>{data.company.name}</Text>
              {!!data.company.sector && <Text style={detail.companyMeta}>{data.company.sector}</Text>}
            </View>
            <Icon name="chevronRight" size={18} color={colors.muted} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{data.title}</Text>
          {!!data.profession && <Text style={styles.subtitle}>{data.profession}</Text>}
          {facts.map(fact => (
            <View key={fact.label} style={detail.fact}>
              <Icon name={fact.icon} size={18} color={colors.goldDeep} />
              <Text style={detail.factLabel}>{fact.label}</Text>
              <Text style={detail.factValue}>{fact.value}</Text>
            </View>
          ))}
        </Card>
        <Section title="Vos missions" text={data.missions} />
        <Section title="Profil recherché" text={data.profile} />
        <Section title="Informations complémentaires" text={data.description} />
        {(!!data.published_at || !!data.reference) && (
          <Text style={detail.footnote}>{[data.published_at ? `Publiée le ${formatDate(data.published_at)}` : '', data.reference ? `Réf. ${data.reference}` : ''].filter(Boolean).join(' · ')}</Text>
        )}
      </ScrollView>
      <View style={detail.bar}><Button title="Postuler" icon="send" onPress={apply} /></View>
    </SafeAreaView>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  const items = lines(text);
  if (!items.length) return null;
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      {items.map((item, index) => (
        <View key={index} style={detail.bullet}><View style={detail.dot} /><Text style={detail.bulletText}>{item}</Text></View>
      ))}
    </Card>
  );
}

const detail = StyleSheet.create({
  company: { flexDirection: 'row', alignItems: 'center', gap: 12 }, companyName: { fontSize: 15, fontWeight: '700', color: colors.ink }, companyMeta: { fontSize: 13, color: colors.muted },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 }, factLabel: { fontSize: 14, color: colors.muted, width: 128 }, factValue: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold, marginTop: 8 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.ink }, footnote: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  bar: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
});
