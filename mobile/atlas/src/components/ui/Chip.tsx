import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = { label: string; icon?: IconName; onDark?: boolean; testID?: string };

/** Étiquette d'information courte (site, matricule, groupe). Ce n'est pas un statut : voir Badge. */
export function Chip({ label, icon, onDark = false, testID }: Props) {
  const fg = onDark ? colors.onNavy : colors.textSecondary;
  return (
    <View testID={testID} style={[styles.chip, onDark ? styles.dark : styles.light]}>
      {icon ? <Ionicons name={icon} size={13} color={fg} /> : null}
      <AppText variant="caption" color={fg} numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  light: { backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  dark: { backgroundColor: '#FFFFFF1F' },
  label: { fontWeight: '600', flexShrink: 1 },
});
