import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiError, errorAction, errorMessageKey } from '@/api/errors';
import { t } from '@/i18n';
import { colors, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Loader({ label = t('common.loading') }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

type EmptyProps = { title: string; body?: string; icon?: IconName; testID?: string };

export function EmptyState({ title, body, icon = 'file-tray-outline', testID }: EmptyProps) {
  return (
    <View style={styles.center} testID={testID}>
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      {body ? (
        <AppText color={colors.textSecondary} style={styles.centered}>
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

type ErrorProps = {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  onSignIn?: () => void;
  onBack?: () => void;
  testID?: string;
};

/**
 * Affichage unique des erreurs : message générique traduit, jamais le détail
 * technique, et l'action adaptée (réessayer, se reconnecter, revenir).
 */
export function ErrorState({ error, title, onRetry, onSignIn, onBack, testID }: ErrorProps) {
  const action = errorAction(error);
  const reference = error instanceof ApiError && error.kind === 'server' ? error.correlationId : undefined;
  return (
    <View style={styles.center} testID={testID} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={40} color={colors.danger} />
      {title ? (
        <AppText variant="heading" style={styles.centered}>
          {title}
        </AppText>
      ) : null}
      <AppText color={colors.textSecondary} style={styles.centered}>
        {t(errorMessageKey(error))}
      </AppText>
      {reference ? (
        <AppText variant="caption" color={colors.textMuted} selectable>
          {t('errors.reference', { id: reference.slice(0, 8) })}
        </AppText>
      ) : null}
      {onRetry && action === 'retry' ? (
        <Button testID="error-retry" label={t('common.retry')} variant="secondary" onPress={onRetry} />
      ) : null}
      {onSignIn && (action === 'signIn' || action === 'retry') ? (
        <Button testID="error-sign-in" label={t('common.signInAgain')} variant="secondary" onPress={onSignIn} />
      ) : null}
      {onBack && action === 'back' ? (
        <Button testID="error-back" label={t('common.back')} variant="secondary" onPress={onBack} />
      ) : null}
    </View>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | `${number}%` }) {
  return <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.skeleton, { height, width }]} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  centered: { textAlign: 'center' },
  skeleton: { backgroundColor: colors.border, borderRadius: radius.sm },
});
