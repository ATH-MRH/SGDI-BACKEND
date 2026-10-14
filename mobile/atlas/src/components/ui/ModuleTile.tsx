import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = {
  label: string;
  /** Sous-titre court (« Gestion du personnel »). */
  caption?: string;
  icon: IconName;
  /** Compteur réel (alertes ouvertes, congés à valider) ; 0 ou null le masque. */
  count?: number | null;
  /** Compteur à traiter en urgence : pastille rouge au lieu de bleue. */
  urgent?: boolean;
  /** Sans `onPress`, la tuile est affichée grisée, comme indisponible. */
  onPress?: () => void;
  testID?: string;
};

/** Tuile du lanceur de modules : icône, nom, sous-titre, et compteur quand il est connu. */
export function ModuleTile({ label, caption, icon, count, urgent = false, onPress, testID }: Props) {
  const enabled = Boolean(onPress);
  const shown = typeof count === 'number' && count > 0 ? (count > 99 ? '99+' : String(count)) : null;
  const a11y = [label, caption, shown].filter(Boolean).join(', ');
  const content = (
    <>
      <Ionicons name={icon} size={26} color={enabled ? colors.primary : colors.textMuted} />
      <AppText variant="label" color={enabled ? colors.navy : colors.textMuted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.label}>
        {label}
      </AppText>
      {caption ? (
        <AppText style={styles.caption} color={colors.textMuted} numberOfLines={2}>
          {caption}
        </AppText>
      ) : null}
      {shown ? (
        <View style={[styles.count, urgent && styles.countUrgent]}>
          <AppText style={styles.countText} color={colors.onPrimary}>
            {shown}
          </AppText>
        </View>
      ) : null}
    </>
  );
  if (!enabled) {
    return (
      <View testID={testID} accessible accessibilityLabel={a11y} accessibilityState={{ disabled: true }} style={[styles.tile, styles.off]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, elevation.card, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  off: { backgroundColor: colors.surfaceSecondary, borderStyle: 'dashed', borderWidth: 1 },
  pressed: { backgroundColor: colors.surfacePressed },
  label: { textAlign: 'center', marginTop: 2 },
  caption: { ...typography.micro, textAlign: 'center' },
  count: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  countUrgent: { backgroundColor: colors.danger },
  countText: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
