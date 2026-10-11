import { StyleSheet, View } from 'react-native';

import { radius, spacing, toneColors, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { label: string; tone?: Tone; testID?: string };

/** Le statut est toujours porté par le libellé : la couleur et la pastille ne font que le renforcer. */
export function Badge({ label, tone = 'neutral', testID }: Props) {
  const palette = toneColors[tone];
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: palette.bg }]}>
      <View style={[styles.dot, { backgroundColor: palette.fg }]} />
      <AppText variant="caption" color={palette.fg} style={styles.label} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontWeight: '600', flexShrink: 1 },
});
