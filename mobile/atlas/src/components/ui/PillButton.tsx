import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = { label: string; icon: IconName; onPress: () => void; primary?: boolean; testID?: string };

/** Action secondaire compacte : icône et libellé court. La zone tactile est élargie au-delà du contour. */
export function PillButton({ label, icon, onPress, primary = false, testID }: Props) {
  const fg = primary ? colors.onNavy : colors.navy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, primary && styles.primary, pressed && styles.pressed]}>
      <Ionicons name={icon} size={15} color={fg} />
      <AppText variant="caption" color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  primary: { backgroundColor: colors.navy, borderColor: colors.navy },
  pressed: { opacity: 0.7 },
  label: { fontWeight: '600' },
});
