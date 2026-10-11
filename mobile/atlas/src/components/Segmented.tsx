import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './ui';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { value: T; onChange: (value: T) => void; options: readonly Option<T>[]; testID?: string };

/** Filtre exclusif compact, en pastilles. L'état est annoncé, pas seulement coloré. */
export function Segmented<T extends string>({ value, onChange, options, testID }: Props<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={testID ? `${testID}-${option.value}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && styles.selected]}>
            <AppText variant="label" color={selected ? colors.onNavy : colors.textSecondary} numberOfLines={1}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  option: {
    minHeight: touchTarget - 10,
    paddingHorizontal: spacing.lg - 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.navy, borderColor: colors.navy },
});
