import { Pressable, StyleSheet, View } from 'react-native';

import { colors, elevation, radius, spacing, type Tone } from '@/theme/tokens';

import { AppText } from './AppText';
import { IconTile, type IconName } from './IconTile';

type Props = {
  label: string;
  icon: IconName;
  tone?: Tone | 'brand';
  /** Texte court sous le libellé (statut, précision). */
  caption?: string;
  /** Sans `onPress`, la tuile est affichée comme indisponible. */
  onPress?: () => void;
  testID?: string;
};

/** Tuile d'accès rapide : une icône, un libellé, une cible large pour le terrain. */
export function ActionTile({ label, icon, tone = 'brand', caption, onPress, testID }: Props) {
  const content = (
    <>
      <IconTile icon={icon} tone={onPress ? tone : 'neutral'} size={42} />
      <View style={styles.texts}>
        <AppText variant="label" numberOfLines={2} color={onPress ? colors.text : colors.textMuted}>
          {label}
        </AppText>
        {caption ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
            {caption}
          </AppText>
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={caption ? `${label}, ${caption}` : label} style={[styles.tile, styles.disabled]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, elevation.card, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  texts: { flex: 1, gap: 2 },
  disabled: { backgroundColor: colors.surfaceSecondary, borderStyle: 'dashed', borderWidth: 1 },
  pressed: { backgroundColor: colors.surfacePressed },
});
