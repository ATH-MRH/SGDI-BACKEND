import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { colors, radius, spacing } from '@/theme/tokens';

import { AppText } from './ui';

/** Affiché pendant la restauration de session : aucun écran protégé n'est encore monté. */
export function BootstrapScreen({ label = t('bootstrap.restoring') }: { label?: string }) {
  return (
    <View style={styles.screen} testID="bootstrap-screen" accessibilityRole="progressbar" accessibilityLabel={label}>
      <View style={styles.mark}>
        <AppText variant="title" color={colors.onPrimary}>
          A
        </AppText>
      </View>
      <ActivityIndicator size="large" color={colors.primary} />
      <AppText color={colors.textSecondary} style={styles.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { textAlign: 'center' },
});
