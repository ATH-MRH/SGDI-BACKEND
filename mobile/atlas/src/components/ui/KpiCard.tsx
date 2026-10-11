import { Pressable, StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';
import { IconTile, type IconName } from './IconTile';
import { ProgressBar } from './ProgressBar';
import { Skeleton } from './States';

type Props = {
  label: string;
  /** null : valeur inconnue (chargement ou erreur). Jamais remplacée par un chiffre. */
  value: string | number | null;
  tone?: Tone;
  icon?: IconName;
  /** Précision sous le libellé : part du total, tendance, unité. */
  hint?: string;
  /** Proportion 0–1 affichée sous la valeur. */
  ratio?: number | null;
  state?: 'ready' | 'loading' | 'error';
  unavailableLabel?: string;
  onPress?: () => void;
  testID?: string;
};

/** Carte d'indicateur : un chiffre, son libellé, sa couleur de statut, et le détail au toucher. */
export function KpiCard({ label, value, tone = 'neutral', icon, hint, ratio, state = 'ready', unavailableLabel, onPress, testID }: Props) {
  const accent = tone === 'neutral' ? colors.steel : toneColors[tone].fg;
  const failed = state === 'error';
  const shown = state === 'ready' && value !== null ? String(value) : failed ? '—' : '';
  const caption = failed && unavailableLabel ? unavailableLabel : label;
  const body = (
    <>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.head}>
        {state === 'loading' ? (
          <Skeleton height={28} width={56} />
        ) : (
          <AppText variant="kpi" color={tone === 'neutral' || failed ? colors.text : accent} numberOfLines={1} adjustsFontSizeToFit>
            {shown}
          </AppText>
        )}
        {icon ? <IconTile icon={icon} tone={tone === 'neutral' ? 'brand' : tone} size={32} /> : null}
      </View>
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={2} style={styles.label}>
        {caption}
      </AppText>
      {ratio !== undefined ? <ProgressBar ratio={state === 'ready' ? ratio : null} tone={tone === 'neutral' ? 'brand' : tone} height={4} /> : null}
      {hint && state === 'ready' ? (
        <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </>
  );
  const accessibilityLabel = failed && unavailableLabel ? `${label} : ${unavailableLabel}` : `${label} : ${shown}`;
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={[styles.card, elevation.card]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, elevation.card, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 96,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    paddingLeft: spacing.lg,
    gap: spacing.xs,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 32 },
  label: { fontWeight: '500' },
  pressed: { backgroundColor: colors.surfacePressed },
});
