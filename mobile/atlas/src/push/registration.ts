import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ApiClient } from '@/api/client';
import type { AppVariant } from '@/config/env';

export type PushStatus =
  /** Simulateur, ou build sans projet de notifications configuré. */
  | 'unsupported'
  | 'undetermined'
  | 'denied'
  | 'granted';

const ANDROID_CHANNEL = 'atlas-alerts';

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId;
  return typeof id === 'string' && id ? id : null;
}

export function pushSupported(): boolean {
  return Device.isDevice && projectId() !== null;
}

function toStatus(permission: { granted: boolean; canAskAgain: boolean }): PushStatus {
  if (permission.granted) return 'granted';
  return permission.canAskAgain ? 'undetermined' : 'denied';
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  return toStatus(await Notifications.getPermissionsAsync());
}

/** Demande l'autorisation système. Appelée uniquement sur un geste explicite de l'utilisateur. */
export async function requestPush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  return toStatus(await Notifications.requestPermissionsAsync());
}

/** Jeton de l'appareil, ou null s'il ne peut pas être obtenu (réseau, service indisponible). */
export async function devicePushToken(): Promise<string | null> {
  const id = projectId();
  if (!Device.isDevice || !id) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'ATLAS',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

export type DeviceRegistration = { token: string; platform: string; variant: AppVariant; appVersion: string };

export async function registerDevice(client: ApiClient, device: DeviceRegistration): Promise<void> {
  await client.post<unknown>('/api/mobile/devices', {
    push_token: device.token,
    provider: 'expo',
    platform: device.platform,
    environment: device.variant,
    app_version: device.appVersion,
  });
}
