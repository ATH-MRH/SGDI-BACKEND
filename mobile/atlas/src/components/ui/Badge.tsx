import { StyleSheet, View } from 'react-native';

import { radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { label: string; tone?: Tone; testID?: string };

/** Le statut est toujours porté par le libellé : la couleur ne fait que le renforcer. */
export function Badge({ label, tone = 'neutral', testID }: Props) {
  const palette = toneColors[tone];
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.fg }]}>
      <AppText variant="caption" color={palette.fg} style={styles.label} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: { fontWeight: '600' },
});
