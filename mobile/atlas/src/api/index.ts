import { Platform } from 'react-native';

import { getSessionToken, notifyForbidden, notifySessionRejected, notifyUpgradeRequired, renewSession } from '@/auth/session';
import { env } from '@/config/env';
import { getAppVersion } from '@/config/version';

import { refreshSession, type ClientInfo } from './auth';
import { createApiClient, type ApiClient } from './client';

const { version, build } = getAppVersion();

export const clientInfo: ClientInfo = { platform: Platform.OS, appVersion: version };

/** Client API unique de l'application : tous les appels ATLAS passent par ici. */
export const api: ApiClient = createApiClient({
  baseUrl: env.apiUrl,
  getToken: getSessionToken,
  refreshToken: (staleToken) => renewSession((refreshToken) => refreshSession(api, refreshToken, clientInfo), staleToken),
  onUnauthorized: notifySessionRejected,
  onForbidden: notifyForbidden,
  onUpgradeRequired: notifyUpgradeRequired,
  clientHeaders: {
    'X-Atlas-Client': `mobile-${Platform.OS}`,
    'X-Atlas-App-Version': version,
    'X-Atlas-App-Build': build,
  },
});

/**
 * Jeton d'accès valide pour une ressource chargée hors du client HTTP (image). Renouvelle la
 * session si le jeton a expiré ; null si elle n'est pas renouvelable ou si le réseau manque.
 */
export async function ensureAccessToken(): Promise<string | null> {
  const token = getSessionToken();
  if (token) return token;
  try {
    return await renewSession((refreshToken) => refreshSession(api, refreshToken, clientInfo), null);
  } catch {
    return null;
  }
}

export { ApiError, errorAction, errorMessageKey } from './errors';
export type { ApiUser, LoginResponse, Page, ScopeSite } from './types';
