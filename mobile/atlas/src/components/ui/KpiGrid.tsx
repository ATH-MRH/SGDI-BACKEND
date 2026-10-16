import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme/tokens';

type Props = { children: ReactNode; columns?: 2 | 3 | 4; testID?: string };

const GAP = spacing.sm;

/**
 * Grille d'indicateurs à colonnes fixes (quatre par ligne au plus) : chaque tuile garde
 * la même largeur, même sur la dernière ligne incomplète.
 */
export function KpiGrid({ children, columns = 4, testID }: Props) {
  const items = Children.toArray(children).filter(Boolean);
  const width = `${100 / columns}%` as const;
  return (
    <View style={styles.grid} testID={testID}>
      {items.map((child, index) => (
        <View key={index} style={[styles.cell, { width }]}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -GAP / 2, rowGap: GAP },
  cell: { paddingHorizontal: GAP / 2, flexDirection: 'row' },
});
