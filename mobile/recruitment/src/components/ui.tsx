import React from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, IconName } from './icon';
import { initials } from '../lib/emploi';

// Système de styles IRON Emploi (planche de référence) : bleu marine, doré, blanc et gris clair ;
// grands titres avec empattements (Source Serif 4), texte courant sans empattements (Noto Sans).
export const colors = {
  ink: '#13284B', navy: '#13284B', navyDeep: '#0C1C36', muted: '#66758C', soft: '#8E9AAD', background: '#FFFFFF', surface: '#F4F6F9',
  gold: '#B88A3B', goldDeep: '#96702A', goldSoft: '#F6EEDD', white: '#FFFFFF', border: '#E2E7EE', red: '#B3293A', redSoft: '#FBECEE',
  green: '#1E8E4E', greenSoft: '#E4F4EA', blue: '#2E6BD9', blueSoft: '#E8F0FC', field: '#F4F6F9',
};
export const fonts = {
  serif: 'SourceSerif4_700Bold', serifSemi: 'SourceSerif4_600SemiBold',
  sans: 'NotoSans_400Regular', medium: 'NotoSans_500Medium', semi: 'NotoSans_600SemiBold', bold: 'NotoSans_700Bold',
};
export const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: '#13284B', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 3px 10px rgba(19,40,75,0.07)' } as ViewStyle,
}) as ViewStyle;

export function Page({ title, subtitle, children }: {title: string; subtitle?: string; children: React.ReactNode}) {
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
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
      {icon && <Icon name={icon} size={15} color={selected ? colors.white : colors.gold} />}
      <Text style={[styles.chipText, selected && { color: colors.white }]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} hitSlop={4}>{body}</Pressable> : body;
}

export type Tone = 'neutral' | 'gold' | 'green' | 'red' | 'blue';
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const palette = { neutral: [colors.surface, colors.navy], gold: [colors.goldSoft, colors.goldDeep], green: [colors.green, colors.white], red: [colors.redSoft, colors.red], blue: [colors.blue, colors.white] }[tone];
  return <Text style={[styles.badgePill, { backgroundColor: palette[0], color: palette[1] }]}>{label}</Text>;
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
      <View style={[styles.stateIcon, tone === 'error' && { backgroundColor: colors.redSoft }]}><Icon name={icon} size={26} color={tone === 'error' ? colors.red : colors.gold} /></View>
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
      <View style={styles.listIcon}><Icon name={icon} size={27} color={colors.navy} /></View>
      <View style={{ flex: 1, gap: 1 }}><Text style={styles.listTitle}>{title}</Text>{!!subtitle && <Text style={styles.listSubtitle}>{subtitle}</Text>}</View>
      {right || (onPress && <Icon name="chevronRight" size={20} color={colors.navy} />)}
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
  eyebrow: {fontSize: 12.5, letterSpacing: 1.6, fontFamily: fonts.bold, color: colors.gold},
  title: {fontSize: 31.5, lineHeight: 38, fontFamily: fonts.serif, color: colors.ink},
  subtitle: {fontSize: 16, lineHeight: 23.5, fontFamily: fonts.sans, color: colors.muted},
  text: {fontSize: 17, lineHeight: 24.5, fontFamily: fonts.sans, color: colors.ink},
  card: {padding: 16, borderRadius: 14, backgroundColor: colors.white, gap: 12, borderWidth: 1, borderColor: colors.border, ...shadow},
  label: {fontSize: 15, color: colors.ink, fontFamily: fonts.semi}, field: {gap: 7},
  input: {minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 13, color: colors.ink, backgroundColor: colors.white, fontSize: 18, fontFamily: fonts.sans},
  inputLocked: {backgroundColor: colors.surface, color: colors.muted},
  button: {minHeight: 52, borderRadius: 10, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 16},
  buttonRow: {flexDirection: 'row', alignItems: 'center', gap: 8}, secondary: {backgroundColor: colors.white, borderWidth: 1.2, borderColor: colors.border},
  danger: {backgroundColor: colors.white, borderWidth: 1.2, borderColor: '#E7C2C7'}, buttonText: {color: colors.white, fontSize: 17.5, fontFamily: fonts.semi, textAlign: 'center'},
  error: {color: colors.red, lineHeight: 23.5, fontSize: 15.5, fontFamily: fonts.medium}, heading: {fontSize: 19, color: colors.ink, fontFamily: fonts.bold, flexShrink: 1},
  headingRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  badge: {color: colors.ink, backgroundColor: colors.goldSoft, padding: 8, borderRadius: 7, alignSelf: 'flex-start', overflow: 'hidden', fontFamily: fonts.medium},
  badgePill: {fontSize: 13, fontFamily: fonts.semi, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7, alignSelf: 'flex-start', overflow: 'hidden'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12}, link: {color: colors.gold, fontFamily: fonts.semi, fontSize: 15.5}, photo: {width: 90, height: 90, borderRadius: 16},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 38},
  chipSelected: {backgroundColor: colors.navy, borderColor: colors.navy}, chipText: {fontSize: 15, color: colors.ink, fontFamily: fonts.medium},
  segmented: {flexDirection: 'row', gap: 6}, segment: {flex: 1, minHeight: 40, borderRadius: 9, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3},
  segmentActive: {backgroundColor: colors.navy}, segmentText: {fontSize: 14.5, fontFamily: fonts.semi, color: colors.muted},
  state: {alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 18}, stateIcon: {width: 54, height: 54, borderRadius: 27, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center'},
  stateTitle: {fontSize: 18, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center'}, stateText: {fontSize: 15.5, lineHeight: 23.5, fontFamily: fonts.sans, color: colors.muted, textAlign: 'center'},
  monogram: {backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center'}, monogramText: {color: colors.gold, fontFamily: fonts.serif, letterSpacing: 0.5},
  listRow: {flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66}, listIcon: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center'},
  listTitle: {fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink}, listSubtitle: {fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted, lineHeight: 20},
  divider: {height: 1, backgroundColor: colors.border},
  floating: {width: 42, height: 42, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow},
});
