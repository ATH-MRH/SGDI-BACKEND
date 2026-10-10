import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';

export type InfoCell = { key: string; label: string; value: string; wide?: boolean; muted?: boolean };

type Props = { cells: readonly InfoCell[]; testID?: string };

/** Grille dense « libellé / valeur » sur deux colonnes. Une cellule `wide` occupe la ligne entière. */
export function InfoGrid({ cells, testID }: Props) {
  return (
    <View testID={testID} style={styles.grid}>
      {cells.map((cell) => (
        <View key={cell.key} style={[styles.cell, cell.wide && styles.wide]} accessible accessibilityLabel={`${cell.label} : ${cell.value}`}>
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={styles.label}>
            {cell.label}
          </AppText>
          <AppText variant="label" color={cell.muted ? colors.textMuted : colors.text} numberOfLines={2} selectable style={cell.muted ? styles.muted : undefined}>
            {cell.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.md },
  cell: { width: '47%', flexGrow: 1, gap: 1 },
  wide: { width: '100%' },
  label: { fontSize: 12, lineHeight: 16 },
  muted: { fontWeight: '400', fontStyle: 'italic' },
});
