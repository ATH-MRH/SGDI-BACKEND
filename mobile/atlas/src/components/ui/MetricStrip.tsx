import { StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';

export type Metric = { key: string; label: string; value: string; tone?: Tone };

type Props = { metrics: readonly Metric[]; caption?: string; testID?: string };

/** Bandeau compact d'indicateurs : trois ou quatre chiffres sur une seule ligne, séparés par un filet. */
export function MetricStrip({ metrics, caption, testID }: Props) {
  return (
    <View testID={testID} style={[styles.strip, elevation.card]}>
      <View style={styles.row}>
        {metrics.map((metric, index) => (
          <View key={metric.key} style={[styles.metric, index > 0 && styles.divider]} accessible accessibilityLabel={`${metric.label} : ${metric.value}`}>
            <AppText style={[styles.value, { color: !metric.tone || metric.tone === 'neutral' ? colors.navy : toneColors[metric.tone].fg }]} numberOfLines={1} adjustsFontSizeToFit>
              {metric.value}
            </AppText>
            <AppText variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.label}>
              {metric.label}
            </AppText>
          </View>
        ))}
      </View>
      {caption ? (
        <AppText variant="caption" color={colors.textMuted} style={styles.caption} numberOfLines={1}>
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row' },
  metric: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs, gap: 1 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  value: { fontSize: 20, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { fontSize: 12, lineHeight: 16 },
  caption: { textAlign: 'center', fontSize: 11, lineHeight: 14 },
});
