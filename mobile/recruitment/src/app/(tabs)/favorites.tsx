import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '../../components/icon';
import { Card, colors, EmptyState, Loading, Monogram, Screen, styles } from '../../components/ui';
import { useFavorites } from '../../lib/favorites';

export default function Favorites() {
  const { ready, items, remove } = useFavorites();
  return (
    <Screen>
      <Text accessibilityRole="header" style={styles.title}>Mes favoris</Text>
      <Text style={styles.subtitle}>Offres enregistrées sur ce téléphone. Elles ne sont pas partagées avec votre espace candidat.</Text>
      {!ready ? <Loading /> : !items.length ? (
        <Card><EmptyState icon="bookmark" title="Aucun favori" text="Touchez le signet d’une offre pour la retrouver ici." action="Explorer les offres" onAction={() => router.push('/offers')} /></Card>
      ) : items.map(item => (
        <View key={item.id} style={row.box}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.company}`} onPress={() => router.push({ pathname: '/offer/[id]', params: { id: String(item.id) } })}
            style={({ pressed }) => [row.main, pressed && { opacity: 0.7 }]}>
            <Monogram name={item.company} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={row.title} numberOfLines={2}>{item.title}</Text>
              <Text style={row.meta} numberOfLines={1}>{[item.company, item.wilaya, item.contract_type].filter(Boolean).join(' · ')}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${item.title} des favoris`} onPress={() => remove(item.id)} style={row.bookmark}>
            <Icon name="bookmark" size={22} color={colors.gold} filled />
          </Pressable>
        </View>
      ))}
    </Screen>
  );
}

const row = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }, bookmark: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink, lineHeight: 21 }, meta: { fontSize: 13, color: colors.muted },
});
