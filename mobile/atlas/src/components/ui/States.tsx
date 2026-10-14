import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiError, errorAction, errorMessageKey, type ApiErrorKind } from '@/api/errors';
import { t, type TranslationKey } from '@/i18n';
import { colors, elevation, radius, spacing } from '@/theme/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Loader({ label = t('common.loading') }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.navy} />
    </View>
  );
}

type EmptyProps = { title: string; body?: string; icon?: IconName; testID?: string };

export function EmptyState({ title, body, icon = 'file-tray-outline', testID }: EmptyProps) {
  return (
    <View style={styles.center} testID={testID}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={28} color={colors.steel} />
      </View>
      <AppText variant="heading" color={colors.navy} style={styles.centered}>
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

type ErrorLook = { icon: IconName; title: TranslationKey };

/** Icône et titre de chaque famille d'erreur : réseau, session, serveur, droits. */
const ERROR_LOOK: Partial<Record<ApiErrorKind, ErrorLook>> = {
  network: { icon: 'cloud-offline-outline', title: 'errors.title.network' },
  timeout: { icon: 'hourglass-outline', title: 'errors.title.server' },
  server: { icon: 'server-outline', title: 'errors.title.server' },
  invalid_response: { icon: 'server-outline', title: 'errors.title.server' },
  unauthorized: { icon: 'key-outline', title: 'errors.title.session' },
  forbidden: { icon: 'lock-closed-outline', title: 'errors.title.forbidden' },
  not_found: { icon: 'search-outline', title: 'errors.title.notFound' },
};

function lookOf(error: unknown): ErrorLook {
  return (error instanceof ApiError ? ERROR_LOOK[error.kind] : undefined) ?? { icon: 'alert-circle-outline', title: 'errors.title.generic' };
}

/**
 * Affichage unique des erreurs : message générique traduit, jamais le détail
 * technique, et l'action adaptée (réessayer, se reconnecter, revenir).
 */
export function ErrorState({ error, title, onRetry, onSignIn, onBack, testID }: ErrorProps) {
  const action = errorAction(error);
  const reference = error instanceof ApiError && error.kind === 'server' ? error.correlationId : undefined;
  const look = lookOf(error);
  return (
    <View style={styles.center} testID={testID} accessibilityRole="alert">
      <View style={[styles.iconWrap, styles.iconDanger]}>
        <Ionicons name={look.icon} size={28} color={colors.danger} />
      </View>
      <AppText variant="heading" color={colors.navy} style={styles.centered}>
        {title ?? t(look.title)}
      </AppText>
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

export function Skeleton({ height = 16, width = '100%', round = false }: { height?: number; width?: number | `${number}%`; round?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.skeleton, { height, width }, round && { borderRadius: height / 2 }]}
    />
  );
}

/** Carte fantôme : la forme d'une ligne de liste pendant le chargement. */
export function SkeletonRow() {
  return (
    <View style={[styles.skeletonRow, elevation.card]}>
      <Skeleton height={44} width={44} round />
      <View style={styles.skeletonTexts}>
        <Skeleton height={14} width="62%" />
        <Skeleton height={11} width="40%" />
      </View>
      <Skeleton height={20} width={56} round />
    </View>
  );
}

/** Liste en cours de chargement : quelques lignes fantômes plutôt qu'un écran blanc. */
export function SkeletonList({ rows = 6, testID }: { rows?: number; testID?: string }) {
  return (
    <View style={styles.skeletonList} testID={testID} accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

/** Tableau de bord en cours de chargement : rangée d'indicateurs puis cartes. */
export function SkeletonDashboard({ testID }: { testID?: string }) {
  return (
    <View style={styles.skeletonList} testID={testID} accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
      <View style={styles.skeletonKpis}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={[styles.skeletonKpi, elevation.card]}>
            <Skeleton height={18} width={18} round />
            <Skeleton height={20} width="60%" />
            <Skeleton height={10} width="80%" />
          </View>
        ))}
      </View>
      {[0, 1].map((index) => (
        <View key={index} style={[styles.skeletonCard, elevation.card]}>
          <Skeleton height={12} width="35%" />
          <Skeleton height={96} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  centered: { textAlign: 'center' },
  skeleton: { backgroundColor: colors.divider, borderRadius: radius.sm },
  skeletonList: { gap: spacing.sm, padding: spacing.lg },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  skeletonTexts: { flex: 1, gap: spacing.sm },
  skeletonKpis: { flexDirection: 'row', gap: spacing.sm },
  skeletonKpi: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.sm,
    minHeight: 96,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  skeletonCard: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
});
