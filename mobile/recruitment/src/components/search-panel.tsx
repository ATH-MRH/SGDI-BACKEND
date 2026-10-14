import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PickerSheet } from './fields';
import { Icon } from './icon';
import { colors, fonts, shadow } from './ui';

/** Recherche de la maquette : texte libre, puis wilaya sélectionnable et bouton de recherche. */
export function SearchPanel({ query, onQuery, wilaya, wilayas, onWilaya, onSubmit }:
  { query: string; onQuery: (value: string) => void; wilaya: string; wilayas: string[]; onWilaya: (value: string) => void; onSubmit: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={panel.box}>
      <View style={panel.row}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput accessibilityLabel="Rechercher un poste, un métier ou une entreprise" placeholder="Quel poste recherchez-vous ?" placeholderTextColor={colors.muted} value={query}
          onChangeText={onQuery} returnKeyType="search" autoCorrect={false} onSubmitEditing={onSubmit} style={panel.input} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" hitSlop={12} onPress={() => onQuery('')}><Icon name="close" size={18} color={colors.muted} /></Pressable>}
      </View>
      <View style={panel.divider} />
      <View style={panel.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Localisation : ${wilaya || 'toute l’Algérie'}`} accessibilityHint="Ouvre la liste des wilayas" disabled={!wilayas.length} onPress={() => setOpen(true)}
          style={({ pressed }) => [panel.place, pressed && { opacity: 0.7 }]}>
          <Icon name="pin" size={20} color={colors.navy} />
          <Text style={[panel.placeText, !wilaya && { color: colors.muted }]} numberOfLines={1}>{wilaya ? `${wilaya}, Algérie` : 'Toute l’Algérie'}</Text>
          <Icon name="chevronDown" size={18} color={colors.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Lancer la recherche" onPress={onSubmit} style={({ pressed }) => [panel.go, pressed && { opacity: 0.85 }]}>
          <Icon name="search" size={22} color={colors.white} />
        </Pressable>
      </View>
      <PickerSheet title="Localisation" visible={open} value={wilaya} searchable={wilayas.length > 8} onClose={() => setOpen(false)} onPick={value => { onWilaya(value); setOpen(false); }}
        options={[{ value: '', label: 'Toute l’Algérie' }, ...wilayas.map(name => ({ value: name, label: name }))]} />
    </View>
  );
}

const panel = StyleSheet.create({
  box: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingLeft: 14, paddingRight: 6 }, divider: { height: 1, backgroundColor: colors.border },
  input: { flex: 1, fontSize: 15.5, fontFamily: fonts.sans, color: colors.ink, paddingVertical: 12 },
  place: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }, placeText: { flex: 1, fontSize: 15.5, fontFamily: fonts.sans, color: colors.ink },
  go: { width: 46, height: 44, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
