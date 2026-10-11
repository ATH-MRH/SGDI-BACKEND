import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';

/** Graphiques simples, dessinés avec des vues : aucune dépendance native, lisibles sur petit écran. */

export type BarDatum = { key: string; label: string; value: number | null; tone?: Tone | 'brand' };

type BarChartProps = { data: readonly BarDatum[]; max?: number; height?: number; unit?: string; testID?: string };

/** Barres verticales. Une valeur inconnue (null) est affichée comme un trait, jamais comme un zéro. */
export function BarChart({ data, max, height = 96, unit = '', testID }: BarChartProps) {
  const known = data.map((datum) => datum.value).filter((value): value is number => typeof value === 'number');
  const top = Math.max(max ?? 0, ...known, 1);
  return (
    <View testID={testID} style={styles.bars} accessible accessibilityLabel={data.map((d) => `${d.label} ${d.value ?? '—'}${unit}`).join(', ')}>
      {data.map((datum) => {
        const color = !datum.tone || datum.tone === 'brand' ? colors.primary : toneColors[datum.tone].fg;
        const amount = datum.value;
        const filled = amount === null ? 0 : Math.max(2, Math.round((amount / top) * height));
        const barColor = amount === null ? colors.border : color;
        return (
          <View key={datum.key} style={styles.barColumn}>
            <AppText variant="caption" color={colors.textSecondary} style={styles.barValue} numberOfLines={1}>
              {datum.value === null ? '—' : `${datum.value}${unit}`}
            </AppText>
            <View style={[styles.barTrack, { height }]}>
              <View style={[styles.bar, { height: filled, backgroundColor: barColor }]} />
            </View>
            <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
              {datum.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

type RingProps = { ratio: number | null; size?: number; thickness?: number; tone?: Tone | 'brand'; label?: string; caption?: string; testID?: string };

/**
 * Anneau de proportion (taux de présence, couverture). Un demi-anneau coloré (bordures gauche
 * et basse d'un cercle) tourne derrière chaque moitié de l'anneau : la moitié droite montre
 * 0–180°, la moitié gauche 180–360°, dans le sens horaire depuis le haut. Une proportion
 * inconnue laisse l'anneau vide et affiche « — ».
 */
export function RingGauge({ ratio, size = 112, thickness = 12, tone = 'success', label, caption, testID }: RingProps) {
  const known = typeof ratio === 'number' && Number.isFinite(ratio);
  const safe = known ? Math.min(1, Math.max(0, ratio)) : 0;
  const color = tone === 'brand' ? colors.primary : toneColors[tone].fg;
  const degrees = safe * 360;
  const half = size / 2;
  const halfDisc = { width: size, height: size, borderRadius: half, borderWidth: thickness };
  return (
    <View testID={testID} style={{ width: size, height: size }} accessible accessibilityLabel={[label, caption].filter(Boolean).join(' ')}>
      <View style={[styles.ringBase, halfDisc, { borderColor: colors.divider }]} />
      {/* Première moitié (0–180°) */}
      <View style={[styles.ringClip, { width: half, height: size, left: half }]}>
        <View
          style={[
            styles.ringBase,
            halfDisc,
            { left: -half, borderColor: 'transparent', borderLeftColor: color, borderBottomColor: color, transform: [{ rotate: `${45 + Math.min(degrees, 180)}deg` }] },
            degrees === 0 && styles.hidden,
          ]}
        />
      </View>
      {/* Seconde moitié (180–360°) */}
      <View style={[styles.ringClip, { width: half, height: size, left: 0 }]}>
        <View
          style={[
            styles.ringBase,
            halfDisc,
            { borderColor: 'transparent', borderLeftColor: color, borderBottomColor: color, transform: [{ rotate: `${Math.max(degrees - 180, 0) - 135}deg` }] },
            degrees <= 180 && styles.hidden,
          ]}
        />
      </View>
      <View style={styles.ringCenter}>
        <AppText variant="kpi" color={colors.navy} numberOfLines={1} adjustsFontSizeToFit>
          {label ?? (known ? `${Math.round(safe * 100)} %` : '—')}
        </AppText>
        {caption ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {caption}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export type Segment = { key: string; label: string; value: number; tone?: Tone | 'brand' | 'steel' | 'navy' };

const SEGMENT_COLORS = [colors.navy, colors.primary, '#4F8BEF', colors.steel, '#8FB4F5', colors.info, '#B9CBE2', colors.textMuted];

function segmentColor(segment: Segment, index: number): string {
  if (segment.tone === 'navy') return colors.navy;
  if (segment.tone === 'steel') return colors.steel;
  if (segment.tone === 'brand') return colors.primary;
  if (segment.tone) return toneColors[segment.tone].fg;
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length] ?? colors.steel;
}

type DistributionProps = { segments: readonly Segment[]; showBar?: boolean; testID?: string };

/** Répartition : une barre empilée et sa légende chiffrée (valeur et part du total). */
export function Distribution({ segments, showBar = true, testID }: DistributionProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <View testID={testID} style={styles.distribution}>
      {showBar && total > 0 ? (
        <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no">
          {segments.map((segment, index) => {
            // La part est lue hors de l'objet de style : le plugin Babel de Reanimated traite
            // toute lecture de `.value` dans un style en ligne comme une valeur animée.
            const share = segment.value;
            return share > 0 ? <View key={segment.key} style={{ flex: share, backgroundColor: segmentColor(segment, index) }} /> : null;
          })}
        </View>
      ) : null}
      {segments.map((segment, index) => (
        <View key={segment.key} style={styles.legendRow} accessible accessibilityLabel={`${segment.label} : ${segment.value}`}>
          <View style={[styles.legendDot, { backgroundColor: segmentColor(segment, index) }]} />
          <AppText variant="caption" color={colors.text} style={styles.legendLabel} numberOfLines={1}>
            {segment.label}
          </AppText>
          <AppText variant="label" color={colors.navy} style={styles.legendValue}>
            {segment.value}
          </AppText>
          <AppText variant="caption" color={colors.textMuted} style={styles.legendShare}>
            {total > 0 ? `${Math.round((segment.value / total) * 100)} %` : '—'}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  barColumn: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { fontWeight: '600', fontSize: 11, lineHeight: 14 },
  barTrack: { width: '100%', maxWidth: 28, justifyContent: 'flex-end', backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, overflow: 'hidden' },
  bar: { width: '100%', borderRadius: radius.sm },
  ringBase: { position: 'absolute', top: 0 },
  ringClip: { position: 'absolute', top: 0, overflow: 'hidden' },
  ringCenter: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  hidden: { opacity: 0 },
  distribution: { gap: spacing.sm },
  stack: { flexDirection: 'row', height: 10, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.divider, marginBottom: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1 },
  legendValue: { minWidth: 36, textAlign: 'right' },
  legendShare: { minWidth: 44, textAlign: 'right' },
});
