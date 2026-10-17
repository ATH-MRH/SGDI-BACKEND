import React from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View, ViewStyle } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from './icon';
import { initials } from '../lib/emploi';

// Système de styles IRON Emploi (planche de référence) : bleu marine, doré, blanc et gris clair ;
// tous les textes en Arial (voir `fonts` ci-dessous).
// Palette de la maquette : bleu nuit et doré (accents seulement) sur fond gris très clair, cartes blanches.
// Les états utilisent des teintes discrètes, toujours accompagnées d'un libellé.
export const colors = {
  ink: '#14243B', navy: Platform.OS === 'web' ? '#235CCC' : '#14243B', navyDeep: Platform.OS === 'web' ? '#194BA9' : '#0D1929', muted: '#667085', soft: '#98A2B3', background: Platform.OS === 'web' ? '#FFFFFF' : '#F5F6F8', surface: '#F2F4F7',
  gold: '#B48C42', goldDeep: '#8C6A2C', goldSoft: '#F7F1E3', white: '#FFFFFF', border: '#E4E7EC', red: '#B42318', redSoft: '#FEF3F2',
  green: '#1B7F4B', greenSoft: '#EAF6EF', blue: '#2F5FB3', blueSoft: '#EAF1FB', field: '#FFFFFF',
};
/** Rayons, espacements (grille de 4/8) et tailles de texte communs à tous les écrans. */
export const radius = { card: Platform.OS === 'web' ? 12 : 16, control: Platform.OS === 'web' ? 8 : 12, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
export const type = { title: 28, heading: 19, body: 15.5, small: 13.5, tiny: 12 };
// Police de toute l'application : Arial.
// - iOS : Arial est fournie par le système (ArialMT, Arial-BoldMT).
// - Android : Arial n'est pas installée et sa licence n'autorise pas de l'embarquer sans accord. L'application y utilise
//   Arimo (licence libre OFL), dessinée avec les mêmes largeurs de caractères qu'Arial : ce n'est pas Arial. Pour y afficher
//   Arial, déposer des fichiers dont les droits sont établis (voir assets/fonts/LISEZ-MOI.md).
// - Aperçu web : Arial du poste, déclarée dans src/app/_layout.tsx.
const regular = Platform.select({ ios: 'ArialMT', android: 'Arimo_400Regular', default: 'AppArial' }) as string;
const strong = Platform.select({ ios: 'Arial-BoldMT', android: 'Arimo_700Bold', default: 'AppArialBold' }) as string;
// Arial n'a que deux graisses : les anciens niveaux intermédiaires se rangent sur l'une ou l'autre.
export const fonts = { serif: strong, serifSemi: strong, sans: regular, medium: regular, semi: strong, bold: strong };
export const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: '#14243B', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 1 },
  default: { boxShadow: '0 2px 8px rgba(20,36,59,0.05)' } as ViewStyle,
}) as ViewStyle;

export function Page({ title, subtitle, children }: {title: string; subtitle?: string; children: React.ReactNode}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}>
      {/* Le titre est porté par l'en-tête, sur la ligne de la flèche de retour. */}
      <Stack.Screen options={{ title }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: 8 }]}>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Écran d'onglet : zone sûre, défilement, tirer pour actualiser. */
export function Screen({ children, onRefresh, refreshing = false, padded = true }: { children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; padded?: boolean }) {
  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, !padded && { padding: 0 }]}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} /> : undefined}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: {children: React.ReactNode; style?: ViewStyle}) { return <View style={[styles.card, style]}>{children}</View>; }

export function Field({ label, ...props }: TextInputProps & {label: string}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.soft} style={[styles.input, props.editable === false && styles.inputLocked]} {...props} />
    </View>
  );
}

export function Button({ title, onPress, busy = false, secondary = false, disabled = false, danger = false, icon }: { title: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean; danger?: boolean; icon?: IconName }) {
  const tint = danger ? colors.red : secondary ? colors.navy : colors.white;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, danger && styles.danger, (busy || disabled) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={tint} /> : (
        <View style={styles.buttonRow}>
          {icon && <Icon name={icon} size={18} color={tint} />}
          <Text style={[styles.buttonText, { color: tint }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: {message?: string}) { return message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null; }

export function Heading({ children, action, onAction }: { children: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.headingRow}>
      <Text accessibilityRole="header" style={styles.heading}>{children}</Text>
      {action && onAction && <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}><Text style={styles.link}>{action}</Text></Pressable>}
    </View>
  );
}

export function Chip({ label, selected = false, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const body = (
    <View style={[styles.chip, selected && styles.chipSelected]}>
      {icon && <Icon name={icon} size={15} color={selected ? colors.white : colors.navy} />}
      <Text style={[styles.chipText, selected && { color: colors.white }]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}

export type Tone = 'neutral' | 'gold' | 'green' | 'red' | 'blue';
const TONES: Record<Tone, [string, string, string]> = {
  neutral: [colors.surface, colors.ink, colors.soft], gold: [colors.goldSoft, colors.goldDeep, colors.gold], green: [colors.greenSoft, colors.green, colors.green],
  red: [colors.redSoft, colors.red, colors.red], blue: [colors.blueSoft, colors.blue, colors.blue],
};
/** État : fond discret, point de couleur et libellé explicite (la couleur seule ne porte jamais l'information). */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const [background, text, dot] = TONES[tone];
  return <View style={[styles.badgePill, { backgroundColor: background }]}><View style={[styles.badgeDot, { backgroundColor: dot }]} /><Text style={[styles.badgeText, { color: text }]}>{label}</Text></View>;
}

/** Sélecteur à segments (filtres de liste), comme sur la planche. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  // Sur les écrans étroits, les libellés gardent leur texte entier dans une taille réduite.
  const narrow = useWindowDimensions().width < 360;
  return (
    <View accessibilityRole="tablist" style={styles.segmented}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable key={option.value} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: active }} onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, narrow && { fontSize: 11.5, letterSpacing: -0.3 }, active && { color: colors.white }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.state}><ActivityIndicator color={colors.navy} /><Text style={styles.stateText}>{label}</Text></View>;
}

export function StateBox({ icon, title, text, action, onAction, tone = 'neutral' }: { icon: IconName; title: string; text?: string; action?: string; onAction?: () => void; tone?: 'neutral' | 'error' }) {
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={styles.state}>
      <View style={[styles.stateIcon, tone === 'error' && { backgroundColor: colors.redSoft }]}><Icon name={icon} size={24} color={tone === 'error' ? colors.red : colors.navy} /></View>
      <Text style={styles.stateTitle}>{title}</Text>
      {!!text && <Text style={styles.stateText}>{text}</Text>}
      {action && onAction && <View style={{ alignSelf: 'stretch', marginTop: 6 }}><Button title={action} secondary onPress={onAction} /></View>}
    </View>
  );
}

export const EmptyState = (props: { icon?: IconName; title: string; text?: string; action?: string; onAction?: () => void }) => <StateBox icon={props.icon || 'inbox'} {...props} />;
export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
  <StateBox icon="alert" tone="error" title="Impossible de charger" text={message} action={onRetry ? 'Réessayer' : undefined} onAction={onRetry} />;

/** Logo de marque servi par le serveur, sinon initiales : aucun logo n'est inventé. */
export function Monogram({ name, uri, size = 44, round = false }: { name: string; uri?: string | null; size?: number; round?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  const radius = round ? size / 2 : size * 0.2;
  if (uri && !failed) return <Image accessibilityIgnoresInvertColors source={{ uri }} onError={() => setFailed(true)} resizeMode="contain" style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.white }} />;
  return <View style={[styles.monogram, { width: size, height: size, borderRadius: radius }]}><Text style={[styles.monogramText, { fontSize: size * 0.36 }]}>{initials(name)}</Text></View>;
}

/** Icône de métier dorée des cartes d'offre. */
export function JobIcon({ name, size = 46 }: { name: IconName; size?: number }) {
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={size * 0.82} color={colors.gold} filled={name === 'shield' || name === 'sparkles'} /></View>;
}

export function Row({ icon, title, subtitle, onPress, right }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode }) {
  const body = (
    <View style={styles.listRow}>
      <View style={styles.listIcon}><Icon name={icon} size={24} color={colors.navy} /></View>
      <View style={{ flex: 1, gap: 1 }}><Text style={styles.listTitle}>{title}</Text>{!!subtitle && <Text style={styles.listSubtitle}>{subtitle}</Text>}</View>
      {right || (onPress && <Icon name="chevronRight" size={18} color={colors.muted} />)}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>{body}</Pressable> : body;
}

/** Bouton rond posé sur une bannière (retour, favori). */
export function FloatingButton({ icon, label, onPress, filled = false }: { icon: IconName; label: string; onPress: () => void; filled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.floating, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} size={22} color={filled ? colors.gold : colors.navy} filled={filled} />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: colors.background}, content: {padding: 18, gap: 16, paddingBottom: 40},
  eyebrow: {fontSize: 12, letterSpacing: 1.2, fontFamily: fonts.bold, color: colors.gold},
  title: {fontSize: 28, lineHeight: 34, fontFamily: fonts.bold, color: colors.ink},
  subtitle: {fontSize: 14.5, lineHeight: 21, fontFamily: fonts.sans, color: colors.muted},
  text: {fontSize: 15.5, lineHeight: 22.5, fontFamily: fonts.sans, color: colors.ink},
  card: {padding: 16, borderRadius: 16, backgroundColor: colors.white, gap: 12, borderWidth: 1, borderColor: colors.border, ...shadow},
  label: {fontSize: 14, color: colors.ink, fontFamily: fonts.semi}, field: {gap: 6},
  input: {minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14, color: colors.ink, backgroundColor: colors.white, fontSize: 16, fontFamily: fonts.sans},
  inputLocked: {backgroundColor: colors.surface, color: colors.muted},
  button: {minHeight: 50, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16},
  buttonRow: {flexDirection: 'row', alignItems: 'center', gap: 8}, secondary: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border},
  danger: {backgroundColor: colors.white, borderWidth: 1, borderColor: '#F4C7C3'}, buttonText: {color: colors.white, fontSize: 16, fontFamily: fonts.semi, textAlign: 'center'},
  error: {color: colors.red, lineHeight: 20, fontSize: 14, fontFamily: fonts.medium}, heading: {fontSize: 19, lineHeight: 24, color: colors.ink, fontFamily: fonts.bold, flexShrink: 1},
  headingRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  badge: {color: colors.ink, backgroundColor: colors.goldSoft, padding: 8, borderRadius: 8, alignSelf: 'flex-start', overflow: 'hidden', fontFamily: fonts.medium},
  badgePill: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, alignSelf: 'flex-start'},
  badgeDot: {width: 7, height: 7, borderRadius: 4}, badgeText: {fontSize: 13, fontFamily: fonts.semi},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12}, link: {color: colors.navy, fontFamily: fonts.semi, fontSize: 14.5}, photo: {width: 90, height: 90, borderRadius: 16},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 40},
  chipSelected: {backgroundColor: colors.navy, borderColor: colors.navy}, chipText: {fontSize: 14, color: colors.ink, fontFamily: fonts.medium},
  segmented: {flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 3}, segment: {flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  segmentActive: {backgroundColor: colors.navy}, segmentText: {fontSize: 14.5, fontFamily: fonts.semi, color: colors.ink},
  state: {alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 16}, stateIcon: {width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  stateTitle: {fontSize: 17, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center'}, stateText: {fontSize: 14.5, lineHeight: 21, fontFamily: fonts.sans, color: colors.muted, textAlign: 'center'},
  monogram: {backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center'}, monogramText: {color: colors.white, fontFamily: fonts.bold, letterSpacing: 0.3},
  listRow: {flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60}, listIcon: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center'},
  listTitle: {fontSize: 15.5, fontFamily: fonts.semi, color: colors.ink}, listSubtitle: {fontSize: 13.5, fontFamily: fonts.sans, color: colors.muted, lineHeight: 19},
  divider: {height: 1, backgroundColor: colors.border},
  floating: {width: 44, height: 44, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow},
});
