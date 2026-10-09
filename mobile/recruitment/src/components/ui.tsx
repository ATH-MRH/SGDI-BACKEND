import React from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, IconName } from './icon';
import { initials } from '../lib/emploi';

// Direction visuelle IRON Emploi : bleu marine, doré, fonds clairs.
export const colors = {
  ink: '#0E2747', navy: '#0E2747', navyDeep: '#0A1D36', muted: '#5E6E84', background: '#F4F6FA', gold: '#C8A04A', goldDeep: '#9A7527',
  goldSoft: '#F7EFD9', white: '#FFFFFF', border: '#DFE5EE', red: '#A52632', redSoft: '#FBECEE', green: '#1F7A46', greenSoft: '#E6F4EC',
  blueSoft: '#E9EEF6', field: '#FAFBFD',
};

export function Page({ title, subtitle, children }: {title: string; subtitle?: string; children: React.ReactNode}) {
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>IRON EMPLOI</Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
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
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={[styles.input, props.editable === false && styles.inputLocked]} {...props} />
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
      {icon && <Icon name={icon} size={14} color={selected ? colors.white : colors.goldDeep} />}
      <Text style={[styles.chipText, selected && { color: colors.white }]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}>{body}</Pressable> : body;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'gold' | 'green' | 'red' }) {
  const palette = { neutral: [colors.blueSoft, colors.navy], gold: [colors.goldSoft, colors.goldDeep], green: [colors.greenSoft, colors.green], red: [colors.redSoft, colors.red] }[tone];
  return <Text style={[styles.badgePill, { backgroundColor: palette[0], color: palette[1] }]}>{label}</Text>;
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.state}><ActivityIndicator color={colors.navy} /><Text style={styles.stateText}>{label}</Text></View>;
}

export function StateBox({ icon, title, text, action, onAction, tone = 'neutral' }: { icon: IconName; title: string; text?: string; action?: string; onAction?: () => void; tone?: 'neutral' | 'error' }) {
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={styles.state}>
      <View style={[styles.stateIcon, tone === 'error' && { backgroundColor: colors.redSoft }]}><Icon name={icon} size={26} color={tone === 'error' ? colors.red : colors.goldDeep} /></View>
      <Text style={styles.stateTitle}>{title}</Text>
      {text && <Text style={styles.stateText}>{text}</Text>}
      {action && onAction && <View style={{ alignSelf: 'stretch', marginTop: 6 }}><Button title={action} secondary onPress={onAction} /></View>}
    </View>
  );
}

export const EmptyState = (props: { icon?: IconName; title: string; text?: string; action?: string; onAction?: () => void }) => <StateBox icon={props.icon || 'inbox'} {...props} />;
export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
  <StateBox icon="alert" tone="error" title="Impossible de charger" text={message} action={onRetry ? 'Réessayer' : undefined} onAction={onRetry} />;

export function Monogram({ name, uri, size = 44 }: { name: string; uri?: string | null; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  if (uri && !failed) return <Image accessibilityIgnoresInvertColors source={{ uri }} onError={() => setFailed(true)} resizeMode="contain" style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: colors.white }} />;
  return <View style={[styles.monogram, { width: size, height: size, borderRadius: size * 0.22 }]}><Text style={[styles.monogramText, { fontSize: size * 0.36 }]}>{initials(name)}</Text></View>;
}

export function Row({ icon, title, subtitle, onPress, right }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode }) {
  const body = (
    <View style={styles.listRow}>
      <View style={styles.listIcon}><Icon name={icon} size={20} color={colors.navy} /></View>
      <View style={{ flex: 1, gap: 2 }}><Text style={styles.listTitle}>{title}</Text>{subtitle && <Text style={styles.listSubtitle}>{subtitle}</Text>}</View>
      {right || (onPress && <Icon name="chevronRight" size={18} color={colors.muted} />)}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>{body}</Pressable> : body;
}

export const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: colors.background}, content: {padding: 18, gap: 16, paddingBottom: 40},
  eyebrow: {fontSize: 11, letterSpacing: 2, fontWeight: '700', color: colors.goldDeep}, title: {fontSize: 27, lineHeight: 33, fontWeight: '700', color: colors.ink},
  subtitle: {fontSize: 15, lineHeight: 22, color: colors.muted},
  card: {padding: 16, borderRadius: 16, backgroundColor: colors.white, gap: 12, borderWidth: 1, borderColor: colors.border},
  label: {fontSize: 13, color: colors.ink, fontWeight: '600'}, field: {gap: 7},
  input: {minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 13, color: colors.ink, backgroundColor: colors.field, fontSize: 16},
  inputLocked: {backgroundColor: colors.blueSoft, color: colors.muted},
  button: {minHeight: 50, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 16},
  buttonRow: {flexDirection: 'row', alignItems: 'center', gap: 8}, secondary: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border},
  danger: {backgroundColor: colors.white, borderWidth: 1, borderColor: '#E7C2C7'}, buttonText: {color: colors.white, fontSize: 15, fontWeight: '700', textAlign: 'center'},
  error: {color: colors.red, lineHeight: 21, fontSize: 14}, heading: {fontSize: 18, color: colors.ink, fontWeight: '700', flexShrink: 1},
  headingRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  badge: {color: colors.ink, backgroundColor: colors.goldSoft, padding: 8, borderRadius: 7, alignSelf: 'flex-start', overflow: 'hidden'},
  badgePill: {fontSize: 12, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start', overflow: 'hidden'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12}, link: {color: colors.goldDeep, fontWeight: '700', fontSize: 14}, photo: {width: 90, height: 90, borderRadius: 16},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 36},
  chipSelected: {backgroundColor: colors.navy, borderColor: colors.navy}, chipText: {fontSize: 13, color: colors.ink, fontWeight: '600'},
  state: {alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 18}, stateIcon: {width: 54, height: 54, borderRadius: 27, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center'},
  stateTitle: {fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center'}, stateText: {fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center'},
  monogram: {backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center'}, monogramText: {color: colors.gold, fontWeight: '800', letterSpacing: 0.5},
  listRow: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52}, listIcon: {width: 38, height: 38, borderRadius: 10, backgroundColor: colors.blueSoft, alignItems: 'center', justifyContent: 'center'},
  listTitle: {fontSize: 15, fontWeight: '600', color: colors.ink}, listSubtitle: {fontSize: 13, color: colors.muted, lineHeight: 18},
  divider: {height: 1, backgroundColor: colors.border},
});
