import { readTokenClaims, STAFF_TOKEN_USE } from '@/auth/token';

import type { ApiClient } from './client';
import { ApiError } from './errors';
import type { ApiUser, LoginResponse, SessionResponse } from './types';

export type StaffSession = { token: string; expiresAt: number; refreshToken?: string; refreshExpiresAt?: number };

/**
 * Vérifie la FORME de la réponse de connexion : un jeton Bearer, typé staff
 * (`token_use = "staff"`), avec une échéance future. Ce contrôle évite d'ouvrir
 * une session sur une réponse inattendue ; il n'autorise rien par lui-même.
 */
export function parseLoginResponse(response: unknown, now: number = Date.now()): StaffSession {
  const { access_token: token, token_type: type } = (response ?? {}) as Partial<LoginResponse>;
  const claims = typeof token === 'string' ? readTokenClaims(token) : null;
  if (
    typeof token !== 'string' ||
    String(type ?? '').toLowerCase() !== 'bearer' ||
    !claims ||
    claims.tokenUse !== STAFF_TOKEN_USE ||
    claims.expiresAt === null ||
    claims.expiresAt <= now
  ) {
    throw new ApiError({ kind: 'invalid_response' });
  }
  const { refresh_token: refreshToken, refresh_expires_in: refreshExpiresIn } = response as Partial<SessionResponse>;
  if (refreshToken === undefined) return { token, expiresAt: claims.expiresAt };
  // Session renouvelable annoncée : elle doit être complète, sinon la réponse est refusée.
  if (typeof refreshToken !== 'string' || !refreshToken || typeof refreshExpiresIn !== 'number' || !(refreshExpiresIn > 0)) {
    throw new ApiError({ kind: 'invalid_response' });
  }
  return { token, expiresAt: claims.expiresAt, refreshToken, refreshExpiresAt: now + refreshExpiresIn * 1000 };
}

export type ClientInfo = { platform: string; appVersion: string };

/**
 * Authentification officielle ATLAS (app/modules/auth/routes.py).
 *
 * Ouvre une session renouvelable quand le backend la propose ; sinon — backend
 * antérieur à cette route — retombe sur la connexion classique, sans refresh token.
 */
export async function login(client: ApiClient, username: string, password: string, info?: ClientInfo): Promise<StaffSession> {
  const credentials = { username: username.trim(), password };
  let response: unknown;
  try {
    response = await client.post<unknown>(
      '/api/auth/mobile/login',
      { ...credentials, platform: info?.platform, app_version: info?.appVersion },
      { authenticated: false },
    );
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) throw error;
    response = await client.post<unknown>('/api/auth/login', credentials, { authenticated: false });
  }
  return parseLoginResponse(response);
}

/** Échange un refresh token (à usage unique) contre une nouvelle session. */
export async function refreshSession(client: ApiClient, refreshToken: string, info?: ClientInfo): Promise<StaffSession> {
  const response = await client.post<unknown>(
    '/api/auth/refresh',
    { refresh_token: refreshToken, app_version: info?.appVersion },
    { authenticated: false },
  );
  const session = parseLoginResponse(response);
  if (!session.refreshToken) throw new ApiError({ kind: 'invalid_response' });
  return session;
}

/** Révoque la session côté serveur. Au mieux : la déconnexion locale ne dépend pas du réseau. */
export async function logout(client: ApiClient): Promise<void> {
  await client.post<unknown>('/api/auth/logout', undefined, { timeoutMs: 5_000 });
}

/** Profil, modules effectifs et périmètre société/site calculés par le backend. */
export function fetchProfile(client: ApiClient): Promise<ApiUser> {
  return client.get<ApiUser>('/api/auth/me');
}
