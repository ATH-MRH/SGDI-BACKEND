import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, elevation, radius, spacing } from '@/theme/tokens';

type Props = ViewProps & {
  /** `flat` : sans ombre, pour une carte posée dans une autre surface. */
  flat?: boolean;
  padded?: boolean;
};

export function Card({ style, flat = false, padded = true, ...rest }: Props) {
  return <View {...rest} style={[styles.card, !flat && elevation.card, padded && styles.padded, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  padded: { padding: spacing.lg },
});
