import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../components/icon';
import { OfferCard } from '../../../components/offer-card';
import { SearchPanel } from '../../../components/search-panel';
import { Chip, colors, EmptyState, ErrorState, fonts, Heading, Loading, shadow, styles } from '../../../components/ui';
import { useCandidateSession } from '../../../lib/candidate-session';
import { fetchOffers, Offer } from '../../../lib/emploi';
import { useFavorites } from '../../../lib/favorites';
import { useLiveRefresh } from '../../../lib/live-refresh';
import { useServer } from '../../../lib/server';
import { useSummary } from '../../../lib/summary';
import { useLoad } from '../../../lib/use-load';

export default function Home() {
  const { mode, retry } = useServer();
  const { summary } = useSummary();
  const { session } = useCandidateSession();
  const [query, setQuery] = useState(''), [wilaya, setWilaya] = useState('');
  const offers = useLoad(signal => fetchOffers({}, 1, signal, 4), 'home-offers', mode === 'emploi');
  // Une offre publiée apparaît sans geste du candidat ; un échec réseau garde la liste affichée.
  useLiveRefresh(() => { fetchOffers({}, 1, undefined, 4).then(offers.setData).catch(() => {}); }, mode === 'emploi' && !!offers.data);
  const open = (params: Record<string, string>) => router.push({ pathname: '/offers', params });
  const search = () => open({ ...(query.trim() ? { q: query.trim() } : {}), ...(wilaya ? { wilaya } : {}) });
  const facets = offers.data?.facets, items = offers.data?.items || [];

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={home.content}
        refreshControl={<RefreshControl refreshing={offers.refreshing} onRefresh={mode === 'emploi' ? offers.refresh : retry} tintColor={colors.navy} />}>
        <View style={home.top}>
          <Text accessibilityRole="header" accessibilityLabel="IRON EMPLOI" style={home.brand}>IRON <Text style={{ color: colors.gold }}>EMPLOI</Text></Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Mes opportunités : favoris et alertes" hitSlop={6} onPress={() => router.push('/offers/opportunities')} style={home.round}>
            <Icon name="bookmark" size={22} color={colors.navy} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={summary.unread_notifications ? `Notifications et conseils, ${summary.unread_notifications} non lues` : 'Notifications et conseils'}
            hitSlop={6} onPress={() => router.push('/espace')} style={home.round}>
            <Icon name="bell" size={23} color={colors.navy} />
            {summary.unread_notifications > 0 && <View style={home.dot} />}
          </Pressable>
        </View>

        <View style={{ gap: 2 }}>
          {/* Salutation seulement pour un candidat identifié : rien n'est supposé sinon. */}
          {!!session && <Text style={home.hello}>{`Bonjour ${session.identity.first_name}`}</Text>}
          <Text style={home.headline}>Votre prochain emploi commence ici.</Text>
        </View>

        <SearchPanel query={query} onQuery={setQuery} wilaya={wilaya} wilayas={facets?.wilayas || []} onWilaya={setWilaya} onSubmit={search} />

        {mode === 'emploi' && !!facets && facets.professions.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={home.chips} style={home.chipsRow}>
            <Chip label="Toutes" selected onPress={() => open({})} />
            {facets.professions.slice(0, 6).map(value => <Chip key={value} label={value} onPress={() => open({ profession: value })} />)}
          </ScrollView>
        )}

        <Heading action={mode === 'emploi' && offers.data?.total ? 'Voir tout' : undefined} onAction={() => open({})}>À découvrir</Heading>
        {mode === 'loading' || (mode === 'emploi' && offers.loading && !offers.data) ? <Loading label="Chargement des offres…" />
          : mode === 'offline' ? <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />
          : mode === 'legacy' ? <View style={home.empty}><EmptyState icon="briefcase" title="Offres bientôt disponibles" text="Le service des annonces n’est pas encore ouvert. Vous pouvez dès maintenant déposer une candidature spontanée." /></View>
          : offers.error && !offers.data ? <ErrorState message={offers.error} onRetry={offers.reload} />
          : items.length ? <>
            <Featured offer={items[0]} />
            {items.slice(1, 3).map(offer => <OfferCard key={offer.id} offer={offer} />)}
          </>
          : <View style={home.empty}><EmptyState icon="briefcase" title="Aucune offre pour le moment" text="Aucune annonce n’est publiée actuellement. Vous pouvez déposer une candidature spontanée." /></View>}

        <Pressable accessibilityRole="button" accessibilityLabel="Vous avez du talent ? Déposez une candidature spontanée" onPress={() => router.push('/offers/apply')} style={({ pressed }) => [home.spontaneous, pressed && { opacity: 0.85 }]}>
          <View style={home.spontaneousIcon}><Icon name="file" size={22} color={colors.navy} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={home.spontaneousTitle}>Vous avez du talent ?</Text>
            <Text style={home.spontaneousText}>Déposez une candidature spontanée</Text>
          </View>
          <Icon name="chevronRight" size={18} color={colors.navy} />
        </Pressable>

        <Pressable accessibilityRole="link" accessibilityLabel="Accès administration" onPress={() => router.push('/login')} hitSlop={12} style={home.admin}>
          <Icon name="lock" size={14} color={colors.muted} />
          <Text style={home.adminText}>Accès adm.</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Offre mise en avant : la plus récente, sur une illustration (assets/photos/SOURCES.md). Une seule action, « Voir l'offre ». */
function Featured({ offer }: { offer: Offer }) {
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(offer.id);
  const see = () => router.push({ pathname: '/offers/[id]', params: { id: String(offer.id) } });
  return (
    <View style={home.featured}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Voir l’offre ${[offer.title, offer.company.name, offer.wilaya, offer.contract_type].filter(Boolean).join(', ')}`} onPress={see}
        style={({ pressed }) => pressed && { opacity: 0.9 }}>
        <Image accessibilityIgnoresInvertColors source={require('../../../../assets/photos/agent.jpg')} resizeMode="cover" style={home.photo} />
        <View style={home.panel}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={home.featuredTitle} numberOfLines={2}>{offer.title}</Text>
            <Text style={home.featuredCompany} numberOfLines={1}>{offer.company.name}</Text>
            <View style={home.featuredMeta}>
              <Icon name="pin" size={15} color={colors.white} />
              <Text style={home.featuredMetaText} numberOfLines={1}>{[offer.wilaya, offer.contract_type].filter(Boolean).join('  ·  ')}</Text>
            </View>
          </View>
          <View style={home.see}><Text style={home.seeText}>Voir l’offre</Text><Icon name="arrowRight" size={16} color={colors.navy} /></View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} accessibilityState={{ selected: saved }} onPress={() => toggle(offer)} style={home.save}>
        <Icon name="bookmark" size={22} color={saved ? colors.gold : colors.white} filled={saved} />
      </Pressable>
    </View>
  );
}


const home = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 20, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 4 }, brand: { flex: 1, color: colors.navy, fontSize: 24, fontFamily: fonts.bold, letterSpacing: 0.2 },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold, borderWidth: 1.5, borderColor: colors.background },
  hello: { fontSize: 16, fontFamily: fonts.sans, color: colors.muted }, headline: { color: colors.navy, fontSize: 28, lineHeight: 33, fontFamily: fonts.bold },
  chipsRow: { marginHorizontal: -18 }, chips: { gap: 8, paddingHorizontal: 18 }, empty: { ...styles.card },
  featured: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.navy, ...shadow }, photo: { width: '100%', height: 158, backgroundColor: colors.surface },
  panel: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 14, backgroundColor: colors.navy },
  featuredTitle: { color: colors.white, fontSize: 17, lineHeight: 22, fontFamily: fonts.bold }, featuredCompany: { color: '#D0D5DD', fontSize: 14, fontFamily: fonts.sans },
  featuredMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }, featuredMetaText: { flex: 1, color: colors.white, fontSize: 13.5, fontFamily: fonts.sans },
  see: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.white }, seeText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.navy },
  save: { position: 'absolute', top: 6, right: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(20,36,59,0.35)' },
  spontaneous: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 12, ...shadow },
  spontaneousIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  spontaneousTitle: { fontSize: 15.5, fontFamily: fonts.bold, color: colors.ink }, spontaneousText: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  admin: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36 }, adminText: { fontSize: 13, fontFamily: fonts.sans, color: colors.muted },
});
