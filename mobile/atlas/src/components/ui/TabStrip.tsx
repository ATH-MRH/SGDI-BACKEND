import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  /** Onglets de largeur égale sur toute la ligne, sans défilement : aucun titre n'est coupé au bord. */
  fill?: boolean;
  testID?: string;
};

/** Onglets soulignés d'un écran. En mode `fill`, cinq onglets au plus, aux libellés courts. */
export function TabStrip<T extends string>({ value, onChange, options, fill = false, testID }: Props<T>) {
  const tabs = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        testID={testID ? `${testID}-${option.value}` : undefined}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={option.label}
        onPress={() => onChange(option.value)}
        style={[styles.tab, fill && styles.tabFill, selected && styles.selected]}>
        <AppText
          variant="label"
          color={selected ? colors.navy : colors.textMuted}
          numberOfLines={1}
          adjustsFontSizeToFit={fill}
          minimumFontScale={0.8}
          style={fill ? styles.labelFill : undefined}>
          {option.label}
        </AppText>
      </Pressable>
    );
  });
  return (
    <View style={styles.wrap}>
      {fill ? (
        <View style={styles.rowFill} accessibilityRole="tablist" testID={testID}>
          {tabs}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist" testID={testID}>
          {tabs}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { paddingHorizontal: spacing.md, gap: spacing.xs },
  rowFill: { flexDirection: 'row', paddingHorizontal: spacing.sm },
  tab: {
    minHeight: touchTarget - 4,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabFill: { flex: 1, paddingHorizontal: 2, alignItems: 'center' },
  labelFill: { fontSize: 13, textAlign: 'center' },
  selected: { borderBottomColor: colors.navy },
});
