import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
};

const VARIANTS: Record<Variant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: colors.navy, pressed: colors.navyDeep, fg: colors.onNavy, border: colors.navy },
  secondary: { bg: colors.surface, pressed: colors.surfacePressed, fg: colors.navy, border: colors.borderStrong },
  danger: { bg: colors.surface, pressed: colors.dangerSoft, fg: colors.danger, border: colors.danger },
};

export function Button({ label, onPress, variant = 'primary', icon, loading = false, disabled = false, testID, style }: Props) {
  const palette = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
        inactive && styles.inactive,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <AppText variant="bodyStrong" color={palette.fg} numberOfLines={1} style={styles.label}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1 },
  inactive: { opacity: 0.5 },
});
