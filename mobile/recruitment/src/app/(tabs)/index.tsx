import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/icon';
import { OfferCard } from '../../components/offer-card';
import { Button, Card, Chip, colors, EmptyState, ErrorState, Heading, Loading, Row, styles } from '../../components/ui';
import { fetchOffers } from '../../lib/emploi';
import { useServer } from '../../lib/server';
import { TIPS } from '../../lib/tips';
import { useLoad } from '../../lib/use-load';

export default function Home() {
  const { mode, retry } = useServer();
  const [query, setQuery] = useState('');
  const offers = useLoad(signal => fetchOffers({}, 1, signal, 5), 'home-offers', mode === 'emploi');
  const search = (params: Record<string, string>) => router.push({ pathname: '/offers', params });
  const facets = offers.data?.facets;

  return (
    <SafeAreaView style={styles.page} edges={['left', 'right']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={offers.refreshing} onRefresh={mode === 'emploi' ? offers.refresh : retry} tintColor={colors.navy} />}>
        <SafeAreaView edges={['top']} style={home.hero}>
          <Text accessibilityRole="header" style={home.brand}>IRON <Text style={{ color: colors.gold }}>EMPLOI</Text></Text>
          <Text style={home.tagline}>Votre espace emploi</Text>
          <View style={home.rule} />
          <Text style={home.headline}>Trouvez votre{'\n'}prochain emploi</Text>
          <View style={home.search}>
            <Icon name="search" size={20} color={colors.muted} />
            <TextInput accessibilityLabel="Rechercher un métier ou une société" placeholder="Métier, société…" placeholderTextColor={colors.muted} value={query}
              onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => search(query.trim() ? { q: query.trim() } : {})} style={home.searchInput} />
          </View>
        </SafeAreaView>

        <View style={home.body}>
          {mode === 'emploi' && !!facets && (facets.wilayas.length > 0 || facets.professions.length > 0) && (
            <View style={home.chips}>
              {facets.wilayas.slice(0, 3).map(value => <Chip key={'w' + value} icon="pin" label={value} onPress={() => search({ wilaya: value })} />)}
              {facets.professions.slice(0, 3).map(value => <Chip key={'p' + value} icon="briefcase" label={value} onPress={() => search({ profession: value })} />)}
            </View>
          )}

          <Heading action={mode === 'emploi' && offers.data?.total ? `Voir tout (${offers.data.total})` : undefined} onAction={() => search({})}>Offres récentes</Heading>
          {mode === 'loading' || (mode === 'emploi' && offers.loading && !offers.data) ? <Loading label="Chargement des offres…" />
            : mode === 'offline' ? <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />
            : mode === 'legacy' ? <Card><EmptyState icon="briefcase" title="Offres bientôt disponibles" text="Le service des annonces n’est pas encore ouvert. Vous pouvez dès maintenant déposer une candidature spontanée." /></Card>
            : offers.error && !offers.data ? <ErrorState message={offers.error} onRetry={offers.reload} />
            : offers.data && offers.data.items.length ? offers.data.items.map(offer => <OfferCard key={offer.id} offer={offer} />)
            : <Card><EmptyState icon="briefcase" title="Aucune offre pour le moment" text="Aucune annonce n’est publiée actuellement. Vous pouvez déposer une candidature spontanée." /></Card>}

          <Card style={home.spontaneous}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={home.spontaneousIcon}><Icon name="send" size={22} color={colors.gold} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={home.spontaneousTitle}>Candidature spontanée</Text>
                <Text style={home.spontaneousText}>Aucune offre ne vous correspond ? Présentez-vous au service recrutement.</Text>
              </View>
            </View>
            <Button title="Déposer ma candidature" icon="send" onPress={() => router.push('/apply')} />
          </Card>

          <Heading action="Tous les conseils" onAction={() => router.push('/tips')}>Conseils emploi</Heading>
          <Card style={{ gap: 4 }}>
            <Text style={home.editorial}>CONSEILS · CONTENU ÉDITORIAL</Text>
            {TIPS.slice(0, 2).map((tip, index) => (
              <View key={tip.id}>
                {index > 0 && <View style={styles.divider} />}
                <Row icon="bulb" title={tip.title} subtitle={tip.summary} onPress={() => router.push({ pathname: '/tips/[id]', params: { id: tip.id } })} />
              </View>
            ))}
          </Card>

          <Pressable accessibilityRole="link" accessibilityLabel="Accès administration" onPress={() => router.push('/login')} hitSlop={8} style={home.admin}>
            <Text style={home.adminText}>Accès adm.</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const home = StyleSheet.create({
  hero: { backgroundColor: colors.navy, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  brand: { color: colors.white, fontSize: 24, fontWeight: '800', letterSpacing: 1.5, marginTop: 8 }, tagline: { color: colors.gold, fontSize: 13, marginTop: 2 },
  rule: { width: 44, height: 4, borderRadius: 4, backgroundColor: colors.gold, marginTop: 18 },
  headline: { color: colors.white, fontSize: 27, lineHeight: 33, fontWeight: '700', marginTop: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 14, paddingHorizontal: 14, marginTop: 18, minHeight: 52 },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  body: { padding: 18, gap: 14 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spontaneous: { backgroundColor: colors.goldSoft, borderColor: '#EBDDB6' }, spontaneousIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  spontaneousTitle: { fontSize: 16, fontWeight: '700', color: colors.ink }, spontaneousText: { fontSize: 13, lineHeight: 19, color: colors.ink },
  editorial: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.goldDeep, marginBottom: 2 },
  admin: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 18, marginTop: 6 }, adminText: { fontSize: 12, color: colors.muted },
});
