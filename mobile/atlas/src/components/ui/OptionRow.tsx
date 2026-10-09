import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { label: string; selected: boolean; onPress: () => void; testID?: string };

/** Ligne de choix exclusif. L'état est annoncé et marqué par une coche, pas seulement par la couleur. */
export function OptionRow({ label, selected, onPress, testID }: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={selected ? `${label}, ${t('scope.selected')}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}>
      <View style={styles.label}>
        <AppText variant={selected ? 'bodyStrong' : 'body'} numberOfLines={2}>
          {label}
        </AppText>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? colors.primary : colors.borderStrong}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.7 },
  label: { flex: 1 },
});
