import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import { Button, colors, fonts, styles } from './ui';
import { digitsOnly, formatMoney, moneyInput, Option, parseMoney, splitList } from '../lib/emploi';

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Zone cliquable d'un champ à liste ou à calendrier : même gabarit qu'un champ de saisie. */
export function FieldButton({ label, text, placeholder, icon = 'chevronDown', onPress, disabled = false }: { label: string; text: string; placeholder: string; icon?: 'chevronDown' | 'calendar' | 'search'; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} : ${text || 'non renseigné'}`} accessibilityHint="Ouvre la sélection" disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.input, field.button, disabled && styles.inputLocked, pressed && { opacity: 0.7 }]}>
        <Text style={[field.value, !text && { color: colors.soft }]} numberOfLines={2}>{text || placeholder}</Text>
        <Icon name={icon} size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

function Sheet({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View accessibilityViewIsModal style={[field.sheet, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }]}>
        <View style={field.sheetTop}>
          <Text accessibilityRole="header" style={[styles.heading, { flex: 1 }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} hitSlop={10} style={field.close}><Icon name="close" size={20} color={colors.navy} /></Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Liste à choix unique. `searchable` ajoute une recherche ; `allowCustom` permet d'enregistrer une valeur absente de la liste. */
export function SelectField({ label, value, options, onChange, placeholder = 'Choisir', searchable = false, allowCustom = false, disabled = false }:
  { label: string; value: string; options: Option[]; onChange: (value: string) => void; placeholder?: string; searchable?: boolean; allowCustom?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const shown = useMemo(() => (search.trim() ? options.filter(option => fold(option.label).includes(fold(search))) : options), [options, search]);
  const typed = search.trim(), custom = allowCustom && typed.length >= 2 && !options.some(option => fold(option.label) === fold(typed));
  const pick = (next: string) => { onChange(next); setOpen(false); };
  const current = options.find(option => option.value === value);
  return (
    <>
      <FieldButton label={label} text={value ? (current?.label || value) : ''} placeholder={placeholder} icon={searchable ? 'search' : 'chevronDown'} disabled={disabled} onPress={() => { setSearch(''); setOpen(true); }} />
      <Sheet title={label} visible={open} onClose={() => setOpen(false)}>
        {(searchable || allowCustom) && (
          <TextInput accessibilityLabel={`Rechercher : ${label}`} value={search} onChangeText={setSearch} placeholder={allowCustom ? 'Rechercher ou saisir…' : 'Rechercher…'} placeholderTextColor={colors.soft}
            autoCorrect={false} returnKeyType="search" maxLength={150} style={[styles.input, { marginHorizontal: 18 }]} />
        )}
        <FlatList data={shown} keyExtractor={option => option.value || '—'} keyboardShouldPersistTaps="handled" initialNumToRender={24}
          ListHeaderComponent={custom ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Utiliser ${typed}`} onPress={() => pick(typed)} style={({ pressed }) => [field.option, pressed && { backgroundColor: colors.surface }]}>
              <Icon name="plus" size={18} color={colors.gold} /><Text style={[field.optionText, { color: colors.goldDeep, fontFamily: fonts.semi }]}>{`Utiliser « ${typed} »`}</Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={custom ? null : <Text style={[styles.subtitle, { padding: 18 }]}>Aucun résultat.</Text>}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: item.value === value }} accessibilityLabel={item.label} onPress={() => pick(item.value)}
              style={({ pressed }) => [field.option, pressed && { backgroundColor: colors.surface }]}>
              <Text style={[field.optionText, item.value === value && { fontFamily: fonts.bold }, !item.value && { color: colors.muted }]}>{item.label}</Text>
              {item.value === value && <Icon name="check" size={20} color={colors.navy} />}
            </Pressable>
          )} />
      </Sheet>
    </>
  );
}

/** Liste à choix multiples. La valeur est une liste séparée par des virgules, comme l'attend le reste du formulaire. */
export function MultiSelectField({ label, value, options, onChange, placeholder = 'Aucune sélection', max = 12 }:
  { label: string; value: string; options: string[]; onChange: (value: string) => void; placeholder?: string; max?: number }) {
  const [open, setOpen] = useState(false);
  const selected = splitList(value);
  // Les valeurs déjà enregistrées hors de la liste restent proposées : elles ne disparaissent pas à l'ouverture.
  const all = [...options, ...selected.filter(item => !options.some(option => fold(option) === fold(item)))];
  const toggle = (item: string) => onChange((selected.includes(item) ? selected.filter(other => other !== item) : selected.length < max ? [...selected, item] : selected).join(', '));
  return (
    <>
      <FieldButton label={label} text={selected.join(', ')} placeholder={placeholder} onPress={() => setOpen(true)} />
      <Sheet title={label} visible={open} onClose={() => setOpen(false)}>
        <Text style={[styles.subtitle, { paddingHorizontal: 18 }]}>Plusieurs choix possibles.</Text>
        <FlatList data={all} keyExtractor={item => item} renderItem={({ item }) => {
          const on = selected.includes(item);
          return (
            <Pressable accessibilityRole="checkbox" aria-checked={on} accessibilityState={{ checked: on }} accessibilityLabel={item} onPress={() => toggle(item)} style={({ pressed }) => [field.option, pressed && { backgroundColor: colors.surface }]}>
              <View style={[field.box, on && field.boxOn]}>{on && <Icon name="check" size={16} color={colors.white} />}</View>
              <Text style={[field.optionText, on && { fontFamily: fonts.bold }]}>{item}</Text>
            </Pressable>
          );
        }} />
        <View style={{ paddingHorizontal: 18 }}><Button title={selected.length ? `Valider (${selected.length})` : 'Valider'} onPress={() => setOpen(false)} /></View>
      </Sheet>
    </>
  );
}

/** Montant en dinars : « 50 000,00 DA » hors saisie ; pendant la saisie, des chiffres et une virgule, sans regroupement. */
export function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const amount = parseMoney(value), valid = amount === null || Number.isFinite(amount);
  const editing = (value || '').replace('.', ',');
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint="Montant en dinars" keyboardType="decimal-pad" inputMode="decimal" maxLength={focused ? 14 : undefined}
        value={focused || !valid ? editing : formatMoney(amount)} placeholder="0,00 DA" placeholderTextColor={colors.soft}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChangeText={text => onChange(moneyInput(text, editing))} style={styles.input} />
      {!valid && <Text style={styles.error}>Montant invalide.</Text>}
    </View>
  );
}

/** Saisie de chiffres uniquement (clavier numérique) ; la valeur reste une chaîne, zéros initiaux conservés. */
export function DigitsField({ label, value, onChange, max = 18, hint }: { label: string; value: string; onChange: (value: string) => void; max?: number; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} accessibilityHint={hint} keyboardType="number-pad" inputMode="numeric" autoCorrect={false} maxLength={max}
        value={value} onChangeText={text => onChange(digitsOnly(text, max))} placeholderTextColor={colors.soft} style={styles.input} />
      {!!hint && <Text style={field.hint}>{hint}</Text>}
    </View>
  );
}

export const field = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' }, value: { flex: 1, fontSize: 18, fontFamily: fonts.sans, color: colors.ink },
  sheet: { flex: 1, backgroundColor: colors.white, gap: 12 }, sheetTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  optionText: { flex: 1, fontSize: 17, fontFamily: fonts.sans, color: colors.ink },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, boxOn: { backgroundColor: colors.navy },
  hint: { fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted },
});
