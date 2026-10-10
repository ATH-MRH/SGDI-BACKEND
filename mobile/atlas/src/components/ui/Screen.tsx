import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  /** false pour les écrans dont le contenu gère lui-même son défilement (listes). */
  scroll?: boolean;
  edges?: readonly Edge[];
  testID?: string;
};

export function Screen({ children, scroll = true, edges = ['top', 'left', 'right'], testID }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  fill: { flex: 1 },
});
