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

export { ApiError, errorAction, errorMessageKey } from './errors';
export type { ApiUser, LoginResponse, Page, ScopeSite } from './types';
