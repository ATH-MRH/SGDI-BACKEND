import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { MAX_UNLOCK_FAILURES } from '@/config/security';
import { t, type TranslationKey } from '@/i18n';
import type { UnlockResult } from '@/lock/biometrics';
import { useLock } from '@/lock/LockProvider';
import { colors, spacing } from '@/theme/tokens';

import { AppText, Button } from './ui';

const MESSAGES: Partial<Record<UnlockResult, TranslationKey>> = {
  failed: 'lock.failed',
  lockout: 'lock.lockout',
  unavailable: 'lock.unavailable',
};

export function LockScreen() {
  const { unlock, failures } = useLock();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UnlockResult | null>(null);
  const prompted = useRef(false);

  async function attempt() {
    if (busy) return;
    setBusy(true);
    const outcome = await unlock();
    setResult(outcome);
    setBusy(false);
  }

  // Une seule demande automatique par verrouillage : après un refus ou une annulation,
  // c'est l'utilisateur qui relance, pour ne jamais boucler sur la fenêtre biométrique.
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    void attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const message = result ? MESSAGES[result] : undefined;
  const remaining = MAX_UNLOCK_FAILURES - failures;

  return (
    <SafeAreaView style={styles.screen} testID="lock-screen">
      <View style={styles.content}>
        <Ionicons name="lock-closed" size={48} color={colors.navy} />
        <AppText variant="title" accessibilityRole="header" style={styles.centered}>
          {t('lock.title')}
        </AppText>
        <AppText color={colors.textSecondary} style={styles.centered}>
          {t('lock.body')}
        </AppText>
        {message ? (
          <View accessibilityRole="alert" testID="lock-message" style={styles.message}>
            <AppText variant="label" color={colors.danger} style={styles.centered}>
              {t(message)}
            </AppText>
            {failures > 0 && remaining > 0 ? (
              <AppText variant="caption" color={colors.textSecondary} style={styles.centered}>
                {t('lock.attempts', { count: remaining })}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        {result !== 'unavailable' ? (
          <Button testID="lock-unlock" label={t('lock.unlock')} loading={busy} onPress={() => void attempt()} />
        ) : null}
        <Button
          testID="lock-sign-in"
          variant="secondary"
          label={t('common.signInAgain')}
          disabled={busy}
          onPress={() => void signOut()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.xxl },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centered: { textAlign: 'center' },
  message: { gap: spacing.xs, marginTop: spacing.sm },
  actions: { gap: spacing.md },
});
