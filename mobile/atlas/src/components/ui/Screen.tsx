import type { ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  /** false pour les écrans dont le contenu gère lui-même son défilement (listes). */
  scroll?: boolean;
  edges?: readonly Edge[];
  /** En-tête fixe, hors de la zone qui défile. */
  header?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  testID?: string;
};

export function Screen({ children, scroll = true, edges = ['top', 'left', 'right'], header, refreshControl, testID }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges} testID={testID}>
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
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
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  fill: { flex: 1 },
});
