import { login, logout, parseLoginResponse, refreshSession } from '@/api/auth';
import { ApiError } from '@/api/errors';
import { fetchMobileConfig } from '@/api/mobileConfig';
import { fetchScopeSites } from '@/api/scope';
import type { ApiClient } from '@/api/client';

import { FUTURE, makeToken, makeUser } from '../helpers';

function refused(response: unknown) {
  try {
    parseLoginResponse(response);
  } catch (error) {
    return error instanceof ApiError ? error.kind : 'autre';
  }
  return 'accepté';
}

describe('parseLoginResponse', () => {
  it('accepte un jeton Bearer typé staff avec une échéance future', () => {
    const token = makeToken(FUTURE);
    expect(parseLoginResponse({ access_token: token, token_type: 'bearer', user: makeUser() })).toEqual({
      token,
      expiresAt: FUTURE * 1000,
    });
    expect(parseLoginResponse({ access_token: token, token_type: 'Bearer' }).token).toBe(token);
  });

  it("un jeton sans token_use n'ouvre pas de session", () => {
    expect(refused({ access_token: makeToken(FUTURE, {}), token_type: 'bearer' })).toBe('invalid_response');
    expect(refused({ access_token: makeToken(FUTURE, { role: 'ops', username: 'OPS1' }), token_type: 'bearer' })).toBe(
      'invalid_response',
    );
  });

  it.each([
    ['portail client', { client_portal: true, client_id: 1 }],
    ['portail employé', { portal: true }],
    ['QR de pointage', { attendance_qr: true, nonce: 'n' }],
    ['ticket SSE', { sse_ticket: true }],
    ['type inconnu', { token_use: 'client_portal' }],
  ])("refuse un jeton d'une autre famille : %s", (_label, claims) => {
    expect(refused({ access_token: makeToken(FUTURE, claims), token_type: 'bearer' })).toBe('invalid_response');
  });

  it('refuse une réponse mal formée, expirée ou sans échéance', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    for (const response of [
      null,
      {},
      { access_token: 42, token_type: 'bearer' },
      { access_token: 'pas-un-jwt', token_type: 'bearer' },
      { access_token: makeToken(FUTURE), token_type: 'mac' },
      { access_token: makeToken(FUTURE) },
      { access_token: makeToken(past), token_type: 'bearer' },
      { access_token: makeToken(0, { token_use: 'staff', exp: 'demain' }), token_type: 'bearer' },
    ]) {
      expect(refused(response)).toBe('invalid_response');
    }
  });
});

function clientReturning(routes: Record<string, unknown>) {
  const get = jest.fn(async (path: string) => {
    if (!(path in routes)) throw new ApiError({ kind: 'forbidden', status: 403 });
    return routes[path];
  });
  return { client: { get } as unknown as ApiClient, get };
}

describe('fetchScopeSites', () => {
  const rows = [
    { id: 3, name: ' Site Nord ', society: 'Societe A' },
    { id: 9, name: '', society: null },
    { id: 'x', name: 'Invalide' },
    null,
  ];

  it('utilise la liste filtrée du pointage pour les profils pointage, OPS ou DRH', async () => {
    const { client, get } = clientReturning({ '/api/attendance/sites': rows });
    const sites = await fetchScopeSites(client, makeUser({ effective_modules: ['ops'] }));
    expect(get).toHaveBeenCalledWith('/api/attendance/sites');
    expect(sites).toEqual([
      { id: 3, name: 'Site Nord', society: 'Societe A' },
      { id: 9, name: null, society: null },
    ]);
  });

  it('utilise le périmètre Site Workforce pour un responsable de site', async () => {
    const { client, get } = clientReturning({ '/api/site-workforce/scope': { societies: ['Societe A'], sites: rows } });
    const sites = await fetchScopeSites(client, makeUser({ effective_modules: ['site_workforce'] }));
    expect(get).toHaveBeenCalledWith('/api/site-workforce/scope');
    expect(sites.map((site) => site.id)).toEqual([3, 9]);
  });

  it("sans liste accessible, ne connaît que les identifiants de /me et n'appelle rien", async () => {
    const { client, get } = clientReturning({});
    const sites = await fetchScopeSites(client, makeUser({ effective_modules: ['brq'], authorized_sites: [3, 9] }));
    expect(get).not.toHaveBeenCalled();
    expect(sites).toEqual([
      { id: 3, name: null, society: null },
      { id: 9, name: null, society: null },
    ]);
  });

  it('tolère une réponse inattendue', async () => {
    const { client } = clientReturning({ '/api/attendance/sites': { erreur: true } });
    expect(await fetchScopeSites(client, makeUser({ effective_modules: ['drh'] }))).toEqual([]);
  });
});

describe('fetchMobileConfig', () => {
  it('lit versions, maintenance et liens store, en écartant toute valeur douteuse', async () => {
    const { client, get } = clientReturning({
      '/api/mobile/config': {
        min_supported_version: { ios: '1.2.0', android: 'bientôt' },
        recommended_version: { ios: '1.3', android: null },
        maintenance: { enabled: true, message: '  Retour à 14 h.  ' },
        store_urls: { ios: 'https://apps.apple.com/app/id1', android: 'https://evil.example/app.apk' },
      },
    });
    expect(await fetchMobileConfig(client)).toEqual({
      minSupportedVersion: { ios: '1.2.0', android: null },
      recommendedVersion: { ios: '1.3', android: null },
      maintenance: { enabled: true, message: 'Retour à 14 h.' },
      storeUrls: { ios: 'https://apps.apple.com/app/id1', android: null },
    });
    expect(get).toHaveBeenCalledWith('/api/mobile/config', { authenticated: false });
  });

  it("ne bloque rien sur une réponse vide ou sur un « enabled » qui n'est pas exactement true", async () => {
    const empty = {
      minSupportedVersion: { ios: null, android: null },
      recommendedVersion: { ios: null, android: null },
      maintenance: { enabled: false, message: null },
      storeUrls: { ios: null, android: null },
    };
    expect(await fetchMobileConfig(clientReturning({ '/api/mobile/config': {} }).client)).toEqual(empty);
    expect(
      await fetchMobileConfig(clientReturning({ '/api/mobile/config': { maintenance: { enabled: 'true', message: 42 } } }).client),
    ).toEqual(empty);
  });
});

describe('session renouvelable', () => {
  const session = (extra: Record<string, unknown> = {}) => ({
    access_token: makeToken(FUTURE), token_type: 'bearer', expires_in: 1800,
    refresh_token: 'refresh-opaque-0123456789', refresh_expires_in: 3600, user: makeUser(), ...extra,
  });
  const fakeClient = (post: jest.Mock) => ({ post }) as unknown as ApiClient;

  it('lit le refresh token et son échéance', () => {
    const now = 1_000_000;
    expect(parseLoginResponse(session({ access_token: makeToken(FUTURE) }), now)).toMatchObject({
      refreshToken: 'refresh-opaque-0123456789',
      refreshExpiresAt: now + 3_600_000,
    });
  });

  it('refuse une session renouvelable incomplète', () => {
    for (const extra of [{ refresh_token: '' }, { refresh_token: 42 }, { refresh_expires_in: 0 }, { refresh_expires_in: 'demain' }]) {
      expect(refused(session(extra))).toBe('invalid_response');
    }
  });

  it('ouvre une session mobile en annonçant plateforme et version, sans jeton', async () => {
    const post = jest.fn().mockResolvedValue(session());
    const result = await login(fakeClient(post), ' OPS1 ', 'secret', { platform: 'ios', appVersion: '1.0.0' });
    expect(post).toHaveBeenCalledWith(
      '/api/auth/mobile/login',
      { username: 'OPS1', password: 'secret', platform: 'ios', app_version: '1.0.0' },
      { authenticated: false },
    );
    expect(result.refreshToken).toBe('refresh-opaque-0123456789');
  });

  it("retombe sur la connexion classique si le backend n'a pas encore la route", async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: 'not_found', status: 404 }))
      .mockResolvedValueOnce({ access_token: makeToken(FUTURE), token_type: 'bearer', user: makeUser() });
    const result = await login(fakeClient(post), 'OPS1', 'secret');
    expect(post.mock.calls[1]![0]).toBe('/api/auth/login');
    expect(result.refreshToken).toBeUndefined();
  });

  it('ne retente pas la connexion classique sur des identifiants refusés', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError({ kind: 'unauthorized', status: 401 }));
    await expect(login(fakeClient(post), 'OPS1', 'faux')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('renouvelle la session et exige un nouveau refresh token', async () => {
    const post = jest.fn().mockResolvedValue(session({ refresh_token: 'refresh-suivant-0123456789' }));
    const result = await refreshSession(fakeClient(post), 'refresh-opaque-0123456789', { platform: 'android', appVersion: '1.2.0' });
    expect(post).toHaveBeenCalledWith(
      '/api/auth/refresh',
      { refresh_token: 'refresh-opaque-0123456789', app_version: '1.2.0' },
      { authenticated: false },
    );
    expect(result.refreshToken).toBe('refresh-suivant-0123456789');

    post.mockResolvedValue({ access_token: makeToken(FUTURE), token_type: 'bearer' });
    await expect(refreshSession(fakeClient(post), 'x')).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('révoque la session côté serveur avec le jeton courant', async () => {
    const post = jest.fn().mockResolvedValue({ ok: true, revoked: true });
    await logout(fakeClient(post));
    expect(post).toHaveBeenCalledWith('/api/auth/logout', undefined, { timeoutMs: 5000 });
  });
});
