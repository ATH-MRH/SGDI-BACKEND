import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useCandidateSession } from './candidate-session';
import { AppNotification, notificationTarget, pushProblem, PushStatus } from './emploi';
import { useServer } from './server';
import { useSummary } from './summary';

type Module = typeof import('expo-notifications');
type State = { status: PushStatus; busy: boolean; enable: () => Promise<void>; unregister: () => Promise<void> };
const Context = createContext<State>({ status: 'unsupported', busy: false, enable: async () => {}, unregister: async () => {} });

// Identifiant du projet EAS : sans lui, aucun jeton de notification ne peut être demandé.
const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
// Canal Android des notifications IRON Emploi, repris par le serveur (`channelId`). Importance haute : bannière et
// son. Android ne laisse pas une application relever l'importance d'un canal existant : d'où un nouveau nom.
export const ANDROID_CHANNEL = 'iron-emploi';
// L'autorisation est demandée une seule fois, à la première ouverture de l'espace candidat.
const ASKED_KEY = 'iron-emploi-push-asked';
const blocker = pushProblem({ os: Platform.OS, expoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient, physical: Device.isDevice, projectId });

// Le module n'est chargé que là où il peut fonctionner (application installée, vrai téléphone).
let loaded: Module | null = null;
function notifications(): Module | null {
  if (blocker) return null;
  if (!loaded) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('expo-notifications') as Module;
    loaded.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
  }
  return loaded;
}

type Payload = Partial<Pick<AppNotification, 'kind' | 'application_id' | 'offer_id' | 'interview_id'>> & { notification_id?: number };

export function PushProvider({ children }: { children: ReactNode }) {
  const { session, call } = useCandidateSession();
  const { mode } = useServer();
  const { refresh, summary } = useSummary();
  const [status, setStatus] = useState<PushStatus>(blocker || 'idle'), [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null), handled = useRef<string | null>(null);
  const active = !!session && mode === 'emploi';

  useEffect(() => {
    const module = notifications();
    if (module) module.setBadgeCountAsync(active ? summary.unread_notifications : 0).catch(() => {});
  }, [active, summary.unread_notifications]);

  const register = useCallback(async (module: Module) => {
    if (Platform.OS === 'android') await module.setNotificationChannelAsync(ANDROID_CHANNEL, { name: 'IRON Emploi', importance: module.AndroidImportance.HIGH, sound: 'default', showBadge: true });
    const value = (await module.getExpoPushTokenAsync({ projectId })).data;
    await call('/public/emploi/me/push-device', { method: 'PUT', body: { token: value, platform: Platform.OS } });
    token.current = value; setStatus('registered');
  }, [call]);

  // À l'ouverture de l'espace : l'appareil est enregistré si l'autorisation est donnée. Elle est demandée une
  // seule fois sur ce téléphone ; ensuite, le candidat l'active depuis les paramètres.
  useEffect(() => {
    const module = notifications();
    if (!module || !active) return;
    let alive = true;
    (async () => {
      let permission = await module.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain && !(await SecureStore.getItemAsync(ASKED_KEY).catch(() => null))) {
        await SecureStore.setItemAsync(ASKED_KEY, '1').catch(() => {});
        if (!alive) return;
        permission = await module.requestPermissionsAsync();
      }
      if (!alive) return;
      if (permission.granted) await register(module); else setStatus(permission.canAskAgain ? 'idle' : 'denied');
    })().catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [active, register]);

  // Notification reçue application ouverte : les pastilles sont relues. Notification touchée : l'écran concerné s'ouvre.
  useEffect(() => {
    const module = notifications();
    if (!module || !active) return;
    const open = (response: { notification: { request: { identifier: string; content: { data?: unknown } } } }) => {
      const { identifier, content } = response.notification.request;
      if (handled.current === identifier) return;
      handled.current = identifier;
      const data = (content.data || {}) as Payload;
      if (data.notification_id) call(`/public/emploi/notifications/${data.notification_id}/read`, { method: 'POST' }).then(refresh).catch(() => {});
      router.push(notificationTarget({ kind: data.kind || 'application', application_id: data.application_id ?? null, offer_id: data.offer_id ?? null, interview_id: data.interview_id ?? null }) as never);
    };
    const received = module.addNotificationReceivedListener(refresh), touched = module.addNotificationResponseReceivedListener(open);
    // Application lancée en touchant une notification.
    module.getLastNotificationResponseAsync().then(response => { if (response) open(response); }).catch(() => {});
    return () => { received.remove(); touched.remove(); };
  }, [active, call, refresh]);

  const enable = useCallback(async () => {
    const module = notifications();
    if (!module || !active) return;
    setBusy(true);
    try {
      const permission = await module.requestPermissionsAsync();
      if (permission.granted) await register(module); else setStatus('denied');
    } catch { setStatus('error'); } finally { setBusy(false); }
  }, [active, register]);

  /** Avant la déconnexion : ce téléphone ne doit plus recevoir les notifications de cet espace. */
  const unregister = useCallback(async () => {
    await notifications()?.setBadgeCountAsync(0).catch(() => {});
    const value = token.current;
    if (!value) return;
    token.current = null; setStatus('idle');
    await call(`/public/emploi/me/push-device?token=${encodeURIComponent(value)}`, { method: 'DELETE' }).catch(() => {});
  }, [call]);

  const value = useMemo(() => ({ status: blocker || (active ? status : 'idle'), busy, enable, unregister }), [active, status, busy, enable, unregister]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const usePush = () => useContext(Context);
