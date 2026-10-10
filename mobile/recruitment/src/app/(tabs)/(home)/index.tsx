import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../components/icon';
import { OfferCard } from '../../../components/offer-card';
import { Chip, colors, EmptyState, ErrorState, fonts, Heading, Loading, shadow, styles } from '../../../components/ui';
import { fetchOffers, jobIcon } from '../../../lib/emploi';
import { useServer } from '../../../lib/server';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

export default function Home() {
  const { mode, retry } = useServer();
  const { summary } = useSummary();
  const [query, setQuery] = useState('');
  const offers = useLoad(signal => fetchOffers({}, 1, signal, 4), 'home-offers', mode === 'emploi');
  const search = (params: Record<string, string>) => router.push({ pathname: '/offers', params });
  const facets = offers.data?.facets;

  return (
    <View style={styles.page}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}
        refreshControl={<RefreshControl refreshing={offers.refreshing} onRefresh={mode === 'emploi' ? offers.refresh : retry} tintColor={colors.navy} />}>
        {/* Photographie d'illustration (voir assets/photos/SOURCES.md) : ce n'est pas un bâtiment du groupe. */}
        <View style={home.hero}>
          <Image accessibilityIgnoresInvertColors source={require('../../../../assets/photos/accueil.jpg')} resizeMode="cover" style={home.photo} />
          <LinearGradient colors={['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.88)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.2)', '#FFFFFF']} locations={[0, 0.2, 0.38, 0.62, 0.9]} style={home.fade} />
          <SafeAreaView edges={['top', 'left', 'right']} style={home.heroInner}>
            <View style={home.topRow}>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" accessibilityLabel="IRON EMPLOI" style={home.brand}>IRON <Text style={home.brandLight}>EMPLOI</Text></Text>
                <Text style={home.tagline}>Votre espace emploi</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Mes opportunités : favoris et alertes" hitSlop={8} onPress={() => router.push('/offers/opportunities')} style={home.round}>
                <Icon name="bookmark" size={20} color={colors.navy} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={summary.unread_notifications ? `Notifications et conseils, ${summary.unread_notifications} non lues` : 'Notifications et conseils'}
                hitSlop={8} onPress={() => router.push('/espace')} style={home.round}>
                <Icon name="bell" size={20} color={colors.navy} />
                {summary.unread_notifications > 0 && <View style={home.dot} />}
              </Pressable>
            </View>
            <Text style={home.headline}>Trouvez votre{'\n'}prochain emploi</Text>
          </SafeAreaView>
        </View>

        <View style={home.body}>
          <View style={home.search}>
            <Icon name="search" size={20} color={colors.navy} />
            <TextInput accessibilityLabel="Rechercher un métier ou une entreprise" placeholder="Métier, entreprise…" placeholderTextColor={colors.muted} value={query}
              onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => search(query.trim() ? { q: query.trim() } : {})} style={home.searchInput} />
          </View>

          {mode === 'emploi' && !!facets && (facets.wilayas.length > 0 || facets.professions.length > 0) && (
            <View style={home.chips}>
              {facets.wilayas.slice(0, 2).map(value => <Chip key={'w' + value} icon="pin" label={value} onPress={() => search({ wilaya: value })} />)}
              {facets.professions.slice(0, 2).map(value => <Chip key={'p' + value} icon={jobIcon({ profession: value, title: '' })} label={value} onPress={() => search({ profession: value })} />)}
            </View>
          )}

          <Heading action={mode === 'emploi' && offers.data?.total ? 'Tout voir' : undefined} onAction={() => search({})}>Offres à la une</Heading>
          {mode === 'loading' || (mode === 'emploi' && offers.loading && !offers.data) ? <Loading label="Chargement des offres…" />
            : mode === 'offline' ? <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />
            : mode === 'legacy' ? <EmptyState icon="briefcase" title="Offres bientôt disponibles" text="Le service des annonces n’est pas encore ouvert. Vous pouvez dès maintenant déposer une candidature spontanée." />
            : offers.error && !offers.data ? <ErrorState message={offers.error} onRetry={offers.reload} />
            : offers.data && offers.data.items.length ? offers.data.items.map(offer => <OfferCard key={offer.id} offer={offer} />)
            : <EmptyState icon="briefcase" title="Aucune offre pour le moment" text="Aucune annonce n’est publiée actuellement. Vous pouvez déposer une candidature spontanée." />}

          <Pressable accessibilityRole="button" accessibilityLabel="Déposer une candidature spontanée" onPress={() => router.push('/offers/apply')} style={({ pressed }) => [home.spontaneous, pressed && { opacity: 0.85 }]}>
            <Icon name="send" size={20} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={home.spontaneousTitle}>Candidature spontanée</Text>
              <Text style={home.spontaneousText}>Présentez-vous au service recrutement.</Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.soft} />
          </Pressable>

          <Pressable accessibilityRole="link" accessibilityLabel="Accès administration" onPress={() => router.push('/login')} hitSlop={10} style={home.admin}>
            <Icon name="lock" size={13} color={colors.muted} />
            <Text style={home.adminText}>Accès adm.</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const home = StyleSheet.create({
  hero: { height: 300, backgroundColor: colors.white, overflow: 'hidden' }, photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: 250 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 }, heroInner: { flex: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  brand: { color: colors.navy, fontSize: 30, fontFamily: fonts.serif, letterSpacing: 0.8 }, brandLight: { fontFamily: fonts.serifSemi }, tagline: { color: colors.goldDeep, fontSize: 15.5, fontFamily: fonts.medium, marginTop: 1 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', ...shadow },
  dot: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold, borderWidth: 1.5, borderColor: colors.white },
  headline: { color: colors.navy, fontSize: 30, lineHeight: 35, fontFamily: fonts.serif },
  body: { paddingHorizontal: 18, gap: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, minHeight: 52, ...shadow },
  searchInput: { flex: 1, fontSize: 17.5, fontFamily: fonts.sans, color: colors.ink, paddingVertical: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spontaneous: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, minHeight: 60 },
  spontaneousTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink }, spontaneousText: { fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted },
  admin: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 18 }, adminText: { fontSize: 14, fontFamily: fonts.sans, color: colors.muted },
});
