import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, spacing, touchTarget } from '@/theme/tokens';

import { AppText } from './AppText';

type Props = { title: string; subtitle?: string; trailing?: ReactNode };

/** En-tête d'un écran de détail : retour, titre, contexte. */
export function ScreenHeader({ title, subtitle, trailing }: Props) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        testID="header-back"
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={8}
        onPress={() => router.back()}
        style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
      </Pressable>
      <View style={styles.titles}>
        <AppText variant="heading" accessibilityRole="header" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  back: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.md },
  titles: { flex: 1 },
});
