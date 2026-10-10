import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@/api';
import { useCurrentUser } from '@/auth/AuthProvider';
import { env, isFeatureEnabled } from '@/config/env';
import { getAppVersion } from '@/config/version';

import { pushTarget } from './links';
import { devicePushToken, pushStatus, registerDevice, requestPush, type PushStatus } from './registration';

type PushContextValue = {
  /** Fonction incluse dans ce build. */
  available: boolean;
  status: PushStatus;
  /** Demande l'autorisation système puis enregistre l'appareil. */
  enable: () => Promise<PushStatus>;
};

const DISABLED: PushContextValue = { available: false, status: 'unsupported', enable: async () => 'unsupported' };
const PushContext = createContext<PushContextValue>(DISABLED);

/**
 * Notifications push : enregistrement de l'appareil auprès du backend et ouverture
 * du bon écran au toucher. Le texte des notifications est composé par le backend ;
 * l'application n'y ajoute aucune donnée.
 */
export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const available = isFeatureEnabled('push');
  const active = available && userId !== null;
  const [status, setStatus] = useState<PushStatus>('unsupported');
  const registered = useRef<string | null>(null);

  const register = useCallback(async () => {
    const token = await devicePushToken();
    if (!token) return;
    const key = `${userId}:${token}`;
    if (registered.current === key) return;
    try {
      await registerDevice(api, { token, platform: Platform.OS, variant: env.variant, appVersion: getAppVersion().version });
      registered.current = key;
    } catch {
      // Réseau ou refus : nouvel essai au prochain retour au premier plan.
    }
  }, [userId]);

  const apply = useCallback(
    (next: PushStatus) => {
      setStatus(next);
      if (next === 'granted') void register();
    },
    [register],
  );

  useEffect(() => {
    if (!active) return undefined;
    registered.current = null;
    const check = () => void pushStatus().catch((): PushStatus => 'unsupported').then(apply);
    check();
    // L'autorisation peut être modifiée dans les réglages du téléphone.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => subscription.remove();
  }, [active, apply]);

  useEffect(() => {
    if (!active) return undefined;
    // Application au premier plan : la notification est tout de même affichée.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = pushTarget(response?.notification.request.content.data);
      if (target) router.push(target as never);
    };
    // Application lancée par le toucher d'une notification.
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [active, router]);

  const value = useMemo<PushContextValue>(() => {
    if (!active) return DISABLED;
    return {
      available: true,
      status,
      enable: async () => {
        const next = await requestPush().catch((): PushStatus => 'unsupported');
        setStatus(next);
        if (next === 'granted') await register();
        return next;
      },
    };
  }, [active, register, status]);

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushContextValue {
  return useContext(PushContext);
}
