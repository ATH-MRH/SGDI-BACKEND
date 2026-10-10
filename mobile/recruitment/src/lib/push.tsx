import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
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
const blocker = pushProblem({ os: Platform.OS, expoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient, physical: Device.isDevice, projectId });

// Le module n'est chargé que là où il peut fonctionner (application installée, vrai téléphone).
let loaded: Module | null = null;
function notifications(): Module | null {
  if (blocker) return null;
  if (!loaded) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('expo-notifications') as Module;
    loaded.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  }
  return loaded;
}

type Payload = Partial<Pick<AppNotification, 'kind' | 'application_id' | 'offer_id'>> & { notification_id?: number };

export function PushProvider({ children }: { children: ReactNode }) {
  const { session, call } = useCandidateSession();
  const { mode } = useServer();
  const { refresh } = useSummary();
  const [status, setStatus] = useState<PushStatus>(blocker || 'idle'), [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null), handled = useRef<string | null>(null);
  const active = !!session && mode === 'emploi';

  const register = useCallback(async (module: Module) => {
    if (Platform.OS === 'android') await module.setNotificationChannelAsync('default', { name: 'IRON Emploi', importance: module.AndroidImportance.DEFAULT });
    const value = (await module.getExpoPushTokenAsync({ projectId })).data;
    await call('/public/emploi/me/push-device', { method: 'PUT', body: { token: value, platform: Platform.OS } });
    token.current = value; setStatus('registered');
  }, [call]);

  // À l'ouverture de l'espace : l'appareil est enregistré si l'autorisation a déjà été donnée. Elle
  // n'est jamais demandée d'office ; le candidat la donne depuis les paramètres.
  useEffect(() => {
    const module = notifications();
    if (!module || !active) return;
    let alive = true;
    module.getPermissionsAsync().then(async permission => {
      if (!alive) return;
      if (permission.granted) await register(module); else setStatus(permission.canAskAgain ? 'idle' : 'denied');
    }).catch(() => { if (alive) setStatus('error'); });
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
      router.push(notificationTarget({ kind: data.kind || 'application', application_id: data.application_id ?? null, offer_id: data.offer_id ?? null }) as never);
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
    const value = token.current;
    if (!value) return;
    token.current = null; setStatus('idle');
    await call(`/public/emploi/me/push-device?token=${encodeURIComponent(value)}`, { method: 'DELETE' }).catch(() => {});
  }, [call]);

  const value = useMemo(() => ({ status: blocker || (active ? status : 'idle'), busy, enable, unregister }), [active, status, busy, enable, unregister]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const usePush = () => useContext(Context);
