import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = { label: string; value: string; icon?: IconName; last?: boolean; testID?: string };

/** Ligne « libellé — valeur » d'une fiche. La valeur peut être sélectionnée pour être copiée. */
export function InfoRow({ label, value, icon, last = false, testID }: Props) {
  return (
    <View testID={testID} accessible accessibilityLabel={`${label} : ${value}`} style={[styles.row, !last && styles.divider]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.steel} style={styles.icon} /> : null}
      <AppText variant="caption" color={colors.textSecondary} style={styles.label} numberOfLines={2}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.valueText} selectable>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md - 2, minHeight: 44 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  icon: { width: 20 },
  label: { flex: 2 },
  valueText: { flex: 3, textAlign: 'right' },
});
