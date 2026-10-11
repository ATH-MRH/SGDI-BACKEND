import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { title: string; hint?: string; actionLabel?: string; onAction?: () => void; testID?: string };

/** Titre de section, avec un lien d'action facultatif à droite. */
export function SectionHeader({ title, hint, actionLabel, onAction, testID }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <AppText variant="overline" color={colors.textSecondary} accessibilityRole="header">
          {title}
        </AppText>
        {hint ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
            {hint}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={12} onPress={onAction}>
          <AppText variant="label" color={colors.primary}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.xs },
  titles: { flex: 1, gap: 2 },
});
