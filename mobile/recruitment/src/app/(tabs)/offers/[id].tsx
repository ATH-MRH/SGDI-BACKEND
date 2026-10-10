import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../components/icon';
import { Button, Card, colors, EmptyState, ErrorState, FloatingButton, fonts, Loading, styles } from '../../../components/ui';
import { useCandidateSession } from '../../../lib/candidate-session';
import { fetchOffer, formatDate, lines } from '../../../lib/emploi';
import { useFavorites } from '../../../lib/favorites';
import { useLoad } from '../../../lib/use-load';

const back = () => (router.canGoBack() ? router.back() : router.replace('/offers'));

export default function OfferScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { session } = useCandidateSession();
  const { isFavorite, toggle, remove } = useFavorites();
  const offer = useLoad(signal => fetchOffer(id, signal), `offer:${id}`, Number.isFinite(id));
  const saved = isFavorite(id);

  if (!offer.data) {
    return (
      <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
        <View style={{ padding: 18, gap: 16 }}>
          <FloatingButton icon="chevronLeft" label="Retour" onPress={back} />
          {offer.loading ? <Loading label="Chargement de l’offre…" />
            // 404 : annonce clôturée, expirée ou retirée depuis son affichage. Aucune candidature n'est proposée.
            : offer.status === 404 || !Number.isFinite(id) ? (
              <Card><EmptyState icon="clock" title="Cette offre n’est plus disponible" text="Elle a été clôturée ou sa date limite est passée : elle n’accepte plus de candidature."
                action={saved ? 'Retirer de mes favoris' : 'Voir les autres offres'} onAction={() => { if (saved) remove(id); router.replace('/offers'); }} /></Card>
            ) : <ErrorState message={offer.error} onRetry={offer.reload} />}
        </View>
      </SafeAreaView>
    );
  }

  const data = offer.data;
  const apply = () => router.push(session ? { pathname: '/offers/apply', params: { offerId: String(id) } } : { pathname: '/identify', params: { next: 'apply', offerId: String(id) } });
  const facts = [
    data.location ? `Lieu : ${data.location}` : '', data.positions > 1 ? `${data.positions} postes à pourvoir` : '',
    data.deadline ? `Candidatures jusqu’au ${formatDate(data.deadline)}` : '', data.reference ? `Référence ${data.reference}` : '',
  ].filter(Boolean);

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Photographie d'illustration (assets/photos/SOURCES.md). */}
        <SafeAreaView edges={['top', 'left', 'right']} style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <View style={detail.banner}>
            <Image accessibilityIgnoresInvertColors source={require('../../../../assets/photos/offre.jpg')} resizeMode="cover" style={detail.photo} />
            <View style={detail.tint} />
            <View style={detail.bannerRow}>
              <FloatingButton icon="chevronLeft" label="Retour" onPress={back} />
              <FloatingButton icon="bookmark" label={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} filled={saved} onPress={() => toggle(data)} />
            </View>
            {!!data.profession && <Text style={detail.sector}>{data.profession.toUpperCase()}</Text>}
          </View>
        </SafeAreaView>

        <View style={detail.body}>
          <Text accessibilityRole="header" style={styles.title}>{data.title}</Text>
          <Pressable accessibilityRole="link" accessibilityLabel={`Entreprise ${data.company.name}`} hitSlop={6} onPress={() => router.push({ pathname: '/offers/company/[id]', params: { id: String(data.company.id) } })}
            style={detail.company}>
            <Text style={detail.companyName}>{data.company.name}</Text>
            <Icon name="chevronRight" size={16} color={colors.soft} />
          </Pressable>
          <View style={detail.metaRow}>
            {!!data.wilaya && <View style={detail.metaItem}><Icon name="pin" size={18} color={colors.gold} filled /><Text style={detail.metaText}>{data.wilaya}</Text></View>}
            {!!data.contract_type && <View style={detail.metaItem}><Icon name="briefcase" size={18} color={colors.gold} filled /><Text style={detail.metaText}>{data.contract_type}</Text></View>}
          </View>
          <Section title="Vos missions" text={data.missions} />
          <Section title="Profil recherché" text={data.profile} />
          <Section title="Informations complémentaires" text={data.description} />
          {facts.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="header" style={styles.heading}>En pratique</Text>
              {facts.map(fact => <Bullet key={fact} text={fact} />)}
            </View>
          )}
        </View>
      </ScrollView>
      <View style={detail.bar}><Button title="Postuler" onPress={apply} /></View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return <View style={detail.bullet}><View style={detail.dot} /><Text style={detail.bulletText}>{text}</Text></View>;
}

function Section({ title, text }: { title: string; text: string }) {
  const items = lines(text);
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      {items.map((item, index) => <Bullet key={index} text={item} />)}
    </View>
  );
}

const detail = StyleSheet.create({
  banner: { height: 190, borderRadius: 14, overflow: 'hidden', justifyContent: 'space-between', backgroundColor: colors.navy }, photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, tint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(12,28,54,0.38)' },
  bannerRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 10 },
  sector: { color: colors.white, fontSize: 13.5, letterSpacing: 2, fontFamily: fonts.semi, paddingHorizontal: 18, paddingBottom: 14 },
  body: { padding: 18, gap: 14 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, metaItem: { flexDirection: 'row', alignItems: 'center', gap: 7 }, metaText: { fontSize: 15.5, fontFamily: fonts.sans, color: colors.ink }, company: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32, marginTop: -8 },
  companyName: { fontSize: 17.5, fontFamily: fonts.medium, color: colors.ink },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.navy, marginTop: 9 },
  bulletText: { flex: 1, fontSize: 16, lineHeight: 24.5, fontFamily: fonts.sans, color: colors.ink },
  bar: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
});
