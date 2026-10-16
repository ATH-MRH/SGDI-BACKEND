import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';
import type { IconName } from './IconTile';

type Props = {
  title: string;
  subtitle?: string;
  /** Petite ligne au-dessus du titre (« Bonjour, »). */
  eyebrow?: string;
  /** Affiche la flèche de retour : écran de détail. */
  back?: boolean;
  trailing?: ReactNode;
  testID?: string;
};

/** En-tête clair commun : titre fort, sous-titre discret, actions à droite. */
export function AtlasHeader({ title, subtitle, eyebrow, back = false, trailing, testID }: Props) {
  const router = useRouter();
  return (
    <View style={styles.header} testID={testID}>
      {back ? (
        <Pressable
          testID="header-back"
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={colors.navy} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        {eyebrow ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant={back ? 'heading' : 'screenTitle'} color={colors.navy} accessibilityRole="header" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

type ActionProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Pastille rouge : `true` sans chiffre, ou le nombre d'éléments critiques (0 la masque). */
  badge?: boolean | number;
  testID?: string;
};

/** Bouton d'action rond de l'en-tête (notifications, filtre, actualiser). */
export function HeaderAction({ icon, label, onPress, badge = false, testID }: ActionProps) {
  const count = typeof badge === 'number' ? badge : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label} (${count})` : label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.navy} />
      {count ? (
        <View style={styles.counter} testID={testID ? `${testID}-count` : undefined}>
          <AppText style={styles.counterText} color={colors.onPrimary}>
            {count > 99 ? '99+' : String(count)}
          </AppText>
        </View>
      ) : badge === true ? (
        <View style={styles.badge} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  back: { width: touchTarget - 4, height: touchTarget - 4, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  titles: { flex: 1, gap: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.surface },
  counter: {
    position: 'absolute',
    top: -3,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  counterText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  pressed: { backgroundColor: colors.surfacePressed },
});
