import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { env } from '@/config/env';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme/tokens';

import { AppText, Button } from './ui';
import { VersionLabel } from './VersionLabel';

/** `serverStoreUrl` : lien annoncé par le serveur, prioritaire sur celui fixé au build. */
export function UpdateRequiredScreen({ serverStoreUrl = null }: { serverStoreUrl?: string | null }) {
  // Le bouton n'existe que si la fiche store de cette plateforme est connue.
  const storeUrl = serverStoreUrl ?? (Platform.OS === 'ios' ? env.storeUrls.ios : env.storeUrls.android);

  return (
    <SafeAreaView style={styles.screen} testID="update-required-screen">
      <View style={styles.content}>
        <Ionicons name="cloud-download-outline" size={48} color={colors.navy} />
        <AppText variant="title" accessibilityRole="header" style={styles.centered}>
          {t('update.title')}
        </AppText>
        <AppText color={colors.textSecondary} style={styles.centered}>
          {t('update.body')}
        </AppText>
        {storeUrl ? null : (
          <AppText color={colors.textSecondary} style={styles.centered} testID="update-unavailable">
            {t('update.unavailable')}
          </AppText>
        )}
      </View>
      {storeUrl ? (
        <Button testID="update-action" label={t('update.action')} onPress={() => void Linking.openURL(storeUrl)} />
      ) : null}
      <VersionLabel />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.xxl, gap: spacing.lg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centered: { textAlign: 'center' },
});

export function MaintenanceScreen({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.screen} testID="maintenance-screen">
      <View style={styles.content}>
        <Ionicons name="construct-outline" size={48} color={colors.navy} />
        <AppText variant="title" accessibilityRole="header" style={styles.centered}>
          {t('maintenance.title')}
        </AppText>
        <AppText color={colors.textSecondary} style={styles.centered}>
          {message ?? t('maintenance.body')}
        </AppText>
      </View>
      <Button testID="maintenance-retry" variant="secondary" label={t('common.retry')} onPress={onRetry} />
    </SafeAreaView>
  );
}
