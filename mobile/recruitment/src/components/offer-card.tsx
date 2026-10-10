import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './icon';
import { colors, fonts, JobIcon, shadow } from './ui';
import { jobIcon, Offer } from '../lib/emploi';
import { useFavorites } from '../lib/favorites';

/** Carte compacte de la planche : icône de métier, poste, société, lieu • contrat, favori. */
export function OfferCard({ offer }: { offer: Offer }) {
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(offer.id);
  return (
    // Deux zones tactiles côte à côte (ouvrir l'offre, favori) : jamais un bouton dans un bouton.
    <View style={card.box}>
      <Pressable accessibilityRole="button" accessibilityLabel={[offer.title, offer.company.name, offer.wilaya, offer.contract_type].filter(Boolean).join(', ')}
        onPress={() => router.push({ pathname: '/offers/[id]', params: { id: String(offer.id) } })}
        style={({ pressed }) => [card.main, pressed && { opacity: 0.7 }]}>
        <JobIcon name={jobIcon(offer)} />
        <View style={card.body}>
          <Text style={card.title} numberOfLines={2}>{offer.title}</Text>
          <Text style={card.company} numberOfLines={1}>{offer.company.name}</Text>
          <OfferMeta wilaya={offer.wilaya} contract={offer.contract_type} />
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} accessibilityState={{ selected: saved }}
        onPress={() => toggle(offer)} style={card.bookmark}>
        <Icon name="bookmark" size={24} color={saved ? colors.gold : colors.navy} filled={saved} />
      </Pressable>
    </View>
  );
}

export function OfferMeta({ wilaya, contract, extra }: { wilaya?: string | null; contract?: string | null; extra?: string | null }) {
  const parts = [contract, extra].filter(Boolean) as string[];
  if (!wilaya && !parts.length) return null;
  return (
    <View style={card.meta}>
      {!!wilaya && <><Icon name="pin" size={16} color={colors.gold} filled /><Text style={card.metaText} numberOfLines={1}>{wilaya}</Text></>}
      {parts.map(part => <Text key={part} style={card.metaText} numberOfLines={1}>{wilaya || part !== parts[0] ? '•  ' : ''}{part}</Text>)}
    </View>
  );
}

const card = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-start', ...shadow },
  main: { flex: 1, flexDirection: 'row', gap: 14, paddingVertical: 16, paddingLeft: 14, alignItems: 'center' },
  body: { flex: 1, gap: 2 }, title: { fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink, lineHeight: 22.5 }, company: { fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }, metaText: { fontSize: 14, fontFamily: fonts.sans, color: colors.muted },
  bookmark: { minWidth: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
