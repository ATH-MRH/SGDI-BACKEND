import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './icon';
import { colors, fonts, Monogram, shadow } from './ui';
import { logoUri, Offer, salaryLabel, sinceLabel } from '../lib/emploi';
import { useFavorites } from '../lib/favorites';

/** Carte d'offre de la maquette : logo de la société, poste, lieu et contrat, salaire s'il est renseigné, date, « Voir l'offre ». */
export function OfferCard({ offer }: { offer: Offer }) {
  const { isFavorite, toggle } = useFavorites();
  const [now] = useState(() => new Date());
  const saved = isFavorite(offer.id), salary = salaryLabel(offer.salary), since = sinceLabel(offer.published_at, now);
  return (
    // Deux zones tactiles côte à côte (ouvrir l'offre, favori) : jamais un bouton dans un bouton.
    <View style={card.box}>
      <Pressable accessibilityRole="button" accessibilityLabel={[`Voir l’offre ${offer.title}`, offer.company.name, offer.wilaya, offer.contract_type, salary].filter(Boolean).join(', ')}
        onPress={() => router.push({ pathname: '/offers/[id]', params: { id: String(offer.id) } })} style={({ pressed }) => [card.main, pressed && { opacity: 0.75 }]}>
        <View style={card.top}>
          <Monogram name={offer.company.name} uri={logoUri(offer.company)} size={46} />
          <View style={card.body}>
            <Text style={card.title} numberOfLines={2}>{offer.title}</Text>
            <Text style={card.company} numberOfLines={1}>{offer.company.name}</Text>
            <OfferMeta wilaya={offer.wilaya} contract={offer.contract_type} />
            {!!salary && <Text style={card.salary}>{salary}</Text>}
          </View>
        </View>
        <View style={card.foot}>
          <Text style={card.since} numberOfLines={1}>{since}</Text>
          <View style={card.see}><Text style={card.seeText}>Voir l’offre</Text><Icon name="arrowRight" size={16} color={colors.navy} /></View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'} accessibilityState={{ selected: saved }}
        onPress={() => toggle(offer)} style={card.bookmark}>
        <Icon name="bookmark" size={22} color={saved ? colors.gold : colors.navy} filled={saved} />
      </Pressable>
    </View>
  );
}

/** Lieu et type de contrat (pastille), puis une information complémentaire facultative. */
export function OfferMeta({ wilaya, contract, extra }: { wilaya?: string | null; contract?: string | null; extra?: string | null }) {
  if (!wilaya && !contract && !extra) return null;
  return (
    <View style={card.meta}>
      {!!wilaya && <View style={card.place}><Icon name="pin" size={15} color={colors.muted} /><Text style={card.metaText} numberOfLines={1}>{wilaya}</Text></View>}
      {!!contract && <Text style={card.contract}>{contract}</Text>}
      {!!extra && <Text style={card.metaText} numberOfLines={1}>{extra}</Text>}
    </View>
  );
}

const card = StyleSheet.create({
  box: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, ...shadow },
  main: { padding: 14, gap: 12 }, top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingRight: 34 },
  body: { flex: 1, gap: 3 }, title: { fontSize: 16, lineHeight: 21, fontFamily: fonts.bold, color: colors.ink }, company: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }, place: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
  contract: { fontSize: 12, fontFamily: fonts.semi, color: colors.ink, backgroundColor: colors.surface, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, overflow: 'hidden' },
  salary: { fontSize: 15, fontFamily: fonts.bold, color: colors.goldDeep, marginTop: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 24 }, since: { flex: 1, fontSize: 12.5, fontFamily: fonts.sans, color: colors.muted },
  see: { flexDirection: 'row', alignItems: 'center', gap: 6 }, seeText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.navy },
  bookmark: { position: 'absolute', top: 4, right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
