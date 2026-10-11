import { StyleSheet, View } from 'react-native';

import { colors, radius, toneColors, type Tone } from '@/theme/tokens';

type Props = { ratio: number | null; tone?: Tone | 'brand'; height?: number; track?: string };

/** Barre de proportion. Une valeur inconnue laisse la piste vide : jamais de niveau inventé. */
export function ProgressBar({ ratio, tone = 'brand', height = 6, track = colors.divider }: Props) {
  const safe = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const fill = tone === 'brand' ? colors.primary : toneColors[tone].fg;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.track, { height, backgroundColor: track }]}>
      <View style={[styles.fill, { width: `${Math.round(safe * 100)}%`, backgroundColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: radius.pill, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: radius.pill },
});
