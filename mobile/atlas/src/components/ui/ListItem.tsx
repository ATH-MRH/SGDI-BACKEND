import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = {
  title: string;
  subtitle?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
};

export function ListItem({ title, subtitle, icon, trailing, onPress, testID }: Props) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={22} color={colors.primary} /> : null}
      <View style={styles.texts}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  texts: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
});
