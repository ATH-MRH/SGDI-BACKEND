import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, touchTarget, typography } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = TextInputProps & { label: string; error?: string };

export const FormField = forwardRef<TextInput, Props>(function FormField({ label, error, style, ...rest }, ref) {
  return (
    <View style={styles.field}>
      <AppText variant="label" color={colors.textSecondary}>
        {label}
      </AppText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...rest}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    ...typography.body,
    minHeight: touchTarget + 2,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
  },
  inputError: { borderColor: colors.danger },
});
