import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useAuth, useCurrentUser } from '@/auth/AuthProvider';
import { env, isFeatureEnabled } from '@/config/env';
import { MAX_UNLOCK_FAILURES } from '@/config/security';
import { t } from '@/i18n';

import { authenticate, getBiometricCapability, type BiometricCapability, type UnlockResult } from './biometrics';
import { shouldLockOnForeground } from './policy';
import { clearLockEnabled, isLockEnabled, saveLockEnabled } from './storage';

type LockContextValue = {
  /** La fonction est incluse dans ce build (drapeau `biometrics`). */
  supported: boolean;
  capability: BiometricCapability;
  enabled: boolean;
  locked: boolean;
  failures: number;
  /** Active le verrouillage après une vérification biométrique réussie. */
  enable: () => Promise<UnlockResult>;
  /** Désactive le verrouillage ; exige aussi une vérification réussie. */
  disable: () => Promise<UnlockResult>;
  lockNow: () => void;
  unlock: () => Promise<UnlockResult>;
};

const noop = async (): Promise<UnlockResult> => 'unavailable';

const LockContext = createContext<LockContextValue>({
  supported: false,
  capability: 'unavailable',
  enabled: false,
  locked: false,
  failures: 0,
  enable: noop,
  disable: noop,
  lockNow: () => undefined,
  unlock: noop,
});

type Props = { children: ReactNode; lockScreen: ReactNode; loadingScreen: ReactNode };

export function LockProvider({ children, lockScreen, loadingScreen }: Props) {
  const supported = isFeatureEnabled('biometrics');
  const user = useCurrentUser();
  const { signOut } = useAuth();
  const userId = user?.id ?? null;

  const [capability, setCapability] = useState<BiometricCapability>('unavailable');
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [failures, setFailures] = useState(0);
  const [unlockedOnce, setUnlockedOnce] = useState(false);

  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  // Chargement du choix de l'utilisateur. À froid, une session verrouillable démarre verrouillée.
  useEffect(() => {
    if (!supported || userId === null) return undefined;
    let active = true;
    void Promise.all([isLockEnabled(userId), getBiometricCapability()]).then(([isEnabled, device]) => {
      if (!active) return;
      setCapability(device);
      setEnabled(isEnabled);
      setLocked(isEnabled);
      setUnlockedOnce(!isEnabled);
      setFailures(0);
      setLoadedFor(userId);
    });
    return () => {
      active = false;
    };
  }, [supported, userId]);

  const ready = !supported || userId === null || loadedFor === userId;

  useEffect(() => {
    if (!supported || userId === null) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      // La fenêtre biométrique du système fait elle-même perdre le focus : on l'ignore.
      if (prompting.current) return;
      if (next === 'background') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active') {
        const mustLock = shouldLockOnForeground({
          enabled,
          backgroundedAt: backgroundedAt.current,
          now: Date.now(),
          timeoutMs: env.lockTimeoutMs,
        });
        backgroundedAt.current = null;
        if (mustLock) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [enabled, supported, userId]);

  const prompt = useCallback(async (message: string): Promise<UnlockResult> => {
    if (prompting.current) return 'cancelled';
    prompting.current = true;
    try {
      return await authenticate(message, t('common.cancel'));
    } finally {
      prompting.current = false;
      backgroundedAt.current = null;
    }
  }, []);

  const enable = useCallback(async (): Promise<UnlockResult> => {
    if (!supported || userId === null) return 'unavailable';
    const device = await getBiometricCapability();
    setCapability(device);
    if (device !== 'available') return 'unavailable';
    const result = await prompt(t('lock.prompt.enable'));
    if (result === 'success') {
      await saveLockEnabled(userId);
      setEnabled(true);
      setUnlockedOnce(true);
    }
    return result;
  }, [prompt, supported, userId]);

  const disable = useCallback(async (): Promise<UnlockResult> => {
    if (!enabled) return 'success';
    const result = await prompt(t('lock.prompt.disable'));
    if (result === 'success') {
      await clearLockEnabled();
      setEnabled(false);
      setLocked(false);
    }
    return result;
  }, [enabled, prompt]);

  const lockNow = useCallback(() => {
    if (enabled) setLocked(true);
  }, [enabled]);

  const unlock = useCallback(async (): Promise<UnlockResult> => {
    if (!locked) return 'success';
    const result = await prompt(t('lock.prompt.unlock'));
    if (result === 'success') {
      setLocked(false);
      setFailures(0);
      setUnlockedOnce(true);
    } else if (result === 'failed' || result === 'lockout') {
      const count = failures + 1;
      setFailures(count);
      // Trop d'échecs : la session est fermée, il faudra se reconnecter à ATLAS.
      if (count >= MAX_UNLOCK_FAILURES) await signOut();
    }
    return result;
  }, [failures, locked, prompt, signOut]);

  const value = useMemo<LockContextValue>(
    () => ({ supported, capability, enabled, locked, failures, enable, disable, lockNow, unlock }),
    [supported, capability, enabled, locked, failures, enable, disable, lockNow, unlock],
  );

  const isLocked = supported && userId !== null && locked;
  // À froid, les écrans protégés ne sont pas montés avant le premier déverrouillage.
  // Ensuite ils restent montés mais masqués, pour retrouver l'écran où l'on était.
  const mountChildren = ready && (!isLocked || unlockedOnce);

  return (
    <LockContext.Provider value={value}>
      {!ready ? loadingScreen : null}
      {mountChildren ? (
        <View
          style={isLocked ? styles.hidden : styles.fill}
          accessibilityElementsHidden={isLocked}
          importantForAccessibility={isLocked ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
      ) : null}
      {ready && isLocked ? lockScreen : null}
    </LockContext.Provider>
  );
}

export function useLock(): LockContextValue {
  return useContext(LockContext);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
});
