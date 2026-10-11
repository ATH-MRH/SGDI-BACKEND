import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = { label: string; icon?: IconName; active?: boolean; onPress: () => void; testID?: string };

/** Bouton de filtre : ouvre un choix (site, période). Rempli quand un filtre est actif. */
export function FilterButton({ label, icon = 'options-outline', active = false, onPress, testID }: Props) {
  const fg = active ? colors.onNavy : colors.navy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, active && styles.active, pressed && styles.pressed]}>
      <Ionicons name={icon} size={16} color={fg} />
      <AppText variant="label" color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget - 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  active: { backgroundColor: colors.navy, borderColor: colors.navy },
  pressed: { opacity: 0.7 },
  label: { flexShrink: 1 },
});
