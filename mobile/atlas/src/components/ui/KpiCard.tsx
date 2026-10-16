import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, toneColors, typography, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';
import { IconTile, type IconName } from './IconTile';
import { ProgressBar } from './ProgressBar';
import { Skeleton } from './States';

/** Évolution mesurée par le backend (par exemple : aujourd'hui contre hier). Jamais estimée. */
export type KpiDelta = {
  value: number;
  /** Libellé court de la période comparée (« vs hier »). */
  label?: string;
  /** true : une hausse est une bonne nouvelle (présents) ; false : une mauvaise (absents). */
  upIsGood: boolean;
};

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
  delta?: KpiDelta | null;
  state?: 'ready' | 'loading' | 'error';
  unavailableLabel?: string;
  /** `compact` : tuile verticale pour une grille de quatre par ligne. */
  variant?: 'card' | 'compact';
  onPress?: () => void;
  testID?: string;
};

function DeltaLine({ delta }: { delta: KpiDelta }) {
  const flat = delta.value === 0;
  const good = flat ? null : delta.value > 0 === delta.upIsGood;
  const color = good === null ? colors.textMuted : good ? colors.success : colors.danger;
  const icon: IconName = flat ? 'remove' : delta.value > 0 ? 'arrow-up' : 'arrow-down';
  const text = `${delta.value > 0 ? '+' : ''}${delta.value}`;
  return (
    <View style={styles.delta}>
      <Ionicons name={icon} size={11} color={color} />
      <AppText style={styles.deltaText} color={color} numberOfLines={1}>
        {delta.label ? `${text} ${delta.label}` : text}
      </AppText>
    </View>
  );
}

/** Carte d'indicateur : un chiffre, son libellé, sa couleur de statut, et le détail au toucher. */
export function KpiCard({
  label,
  value,
  tone = 'neutral',
  icon,
  hint,
  ratio,
  delta,
  state = 'ready',
  unavailableLabel,
  variant = 'card',
  onPress,
  testID,
}: Props) {
  const accent = tone === 'neutral' ? colors.primary : toneColors[tone].fg;
  const failed = state === 'error';
  const shown = state === 'ready' && value !== null ? String(value) : failed ? '—' : '';
  const caption = failed && unavailableLabel ? unavailableLabel : label;
  const compact = variant === 'compact';
  const valueColor = tone === 'neutral' || failed ? colors.navy : accent;

  const body = compact ? (
    <>
      {icon ? <Ionicons name={icon} size={20} color={accent} /> : null}
      {state === 'loading' ? (
        <Skeleton height={22} width={40} />
      ) : (
        <AppText variant="kpiCompact" color={valueColor} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {shown}
        </AppText>
      )}
      <AppText style={styles.compactLabel} color={colors.textSecondary} numberOfLines={2}>
        {caption}
      </AppText>
      {delta && state === 'ready' ? <DeltaLine delta={delta} /> : null}
    </>
  ) : (
    <>
      <View style={[styles.accent, { backgroundColor: tone === 'neutral' ? colors.steel : accent }]} />
      <View style={styles.head}>
        {state === 'loading' ? (
          <Skeleton height={28} width={56} />
        ) : (
          <AppText variant="kpi" color={valueColor} numberOfLines={1} adjustsFontSizeToFit>
            {shown}
          </AppText>
        )}
        {icon ? <IconTile icon={icon} tone={tone === 'neutral' ? 'brand' : tone} size={32} /> : null}
      </View>
      <AppText variant="caption" color={colors.textSecondary} numberOfLines={2} style={styles.label}>
        {caption}
      </AppText>
      {ratio !== undefined ? <ProgressBar ratio={state === 'ready' ? ratio : null} tone={tone === 'neutral' ? 'brand' : tone} height={4} /> : null}
      {delta && state === 'ready' ? <DeltaLine delta={delta} /> : null}
      {hint && state === 'ready' ? (
        <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </>
  );
  const accessibilityLabel = failed && unavailableLabel ? `${label} : ${unavailableLabel}` : `${label} : ${shown}`;
  const shell = compact ? styles.compact : styles.card;
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={[shell, elevation.card]}>
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
      style={({ pressed }) => [shell, elevation.card, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 92,
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
  compact: {
    flex: 1,
    minHeight: 104,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: 3,
  },
  compactLabel: { ...typography.micro, minHeight: 28 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 32 },
  label: { fontWeight: '500' },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  pressed: { backgroundColor: colors.surfacePressed },
});
