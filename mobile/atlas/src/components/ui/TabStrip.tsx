import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { value: T; onChange: (value: T) => void; options: readonly Option<T>[]; testID?: string };

/** Onglets soulignés d'un écran (Informations, Position, Pointage…). Défilent si nécessaire. */
export function TabStrip<T extends string>({ value, onChange, options, testID }: Props<T>) {
  return (
    <View style={styles.wrap}>
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
              style={[styles.tab, selected && styles.selected]}>
              <AppText variant="label" color={selected ? colors.navy : colors.textMuted} numberOfLines={1}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { paddingHorizontal: spacing.md, gap: spacing.xs },
  tab: {
    minHeight: touchTarget - 4,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  selected: { borderBottomColor: colors.navy },
});
