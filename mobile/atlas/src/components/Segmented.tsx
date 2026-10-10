import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './ui';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { value: T; onChange: (value: T) => void; options: readonly Option<T>[]; testID?: string };

/** Filtre exclusif compact (onglets). L'état est annoncé, pas seulement coloré. */
export function Segmented<T extends string>({ value, onChange, options, testID }: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="tablist" testID={testID}>
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
            <AppText variant="label" color={selected ? colors.onPrimary : colors.textSecondary} numberOfLines={1}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  option: {
    minHeight: touchTarget - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
});
