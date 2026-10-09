import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './icon';
import { colors, Monogram } from './ui';
import { formatDate, logoUri, Offer } from '../lib/emploi';
import { useFavorites } from '../lib/favorites';

export function OfferCard({ offer }: { offer: Offer }) {
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(offer.id);
  const place = [offer.wilaya, offer.contract_type].filter(Boolean).join('  ·  ');
  return (
    // Deux zones tactiles côte à côte (ouvrir l'offre, favori) : jamais un bouton dans un bouton.
    <View style={card.box}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${offer.title}, ${offer.company.name}${place ? ', ' + place : ''}`}
        onPress={() => router.push({ pathname: '/offer/[id]', params: { id: String(offer.id) } })}
        style={({ pressed }) => [card.main, pressed && { opacity: 0.7 }]}>
        <Monogram name={offer.company.name} uri={logoUri(offer.company)} />
        <View style={card.body}>
          <Text style={card.title} numberOfLines={2}>{offer.title}</Text>
          <Text style={card.company} numberOfLines={1}>{offer.company.name}</Text>
          {!!place && <View style={card.meta}><Icon name="pin" size={14} color={colors.goldDeep} /><Text style={card.metaText} numberOfLines={1}>{place}</Text></View>}
          {!!offer.deadline && <Text style={card.deadline}>Jusqu’au {formatDate(offer.deadline)}</Text>}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} accessibilityState={{ selected: saved }}
        onPress={() => toggle(offer)} style={card.bookmark}>
        <Icon name="bookmark" size={22} color={saved ? colors.gold : colors.muted} filled={saved} />
      </Pressable>
    </View>
  );
}

const card = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-start' },
  main: { flex: 1, flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  body: { flex: 1, gap: 3 }, title: { fontSize: 16, fontWeight: '700', color: colors.ink, lineHeight: 21 }, company: { fontSize: 13, color: colors.muted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }, metaText: { fontSize: 13, color: colors.ink, flexShrink: 1 },
  deadline: { fontSize: 12, color: colors.muted, marginTop: 2 }, bookmark: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginRight: 4 },
});
