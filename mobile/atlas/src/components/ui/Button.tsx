import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
};

const VARIANTS: Record<Variant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surface, pressed: colors.primarySoft, fg: colors.primary, border: colors.borderStrong },
  danger: { bg: colors.surface, pressed: colors.dangerSoft, fg: colors.danger, border: colors.danger },
};

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false, testID, style }: Props) {
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
        <AppText variant="bodyStrong" color={palette.fg} numberOfLines={1}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: { opacity: 0.55 },
});
