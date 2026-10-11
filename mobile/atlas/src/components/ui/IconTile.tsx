import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, toneColors, type Tone } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = { icon: IconName; tone?: Tone | 'brand'; size?: number };

/** Icône dans un carré teinté : le repère visuel commun des listes, tuiles et indicateurs. */
export function IconTile({ icon, tone = 'brand', size = 40 }: Props) {
  const palette = tone === 'brand' ? { fg: colors.navy, bg: colors.primarySoft } : toneColors[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.tile, { width: size, height: size, backgroundColor: palette.bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={palette.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
