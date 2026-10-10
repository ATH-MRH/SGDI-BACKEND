import { createApiClient, type ApiClientDeps } from '@/api/client';
import { ApiError } from '@/api/errors';

import { jsonResponse } from '../helpers';

function setup(overrides: Partial<ApiClientDeps> = {}) {
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>();
  const onUnauthorized = jest.fn();
  const client = createApiClient({
    baseUrl: 'https://atlas.example.test',
    getToken: () => 'jwt-token',
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return { client, fetchImpl, onUnauthorized };
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('une erreur était attendue');
}

describe('client API', () => {
  it('envoie le jeton Bearer et les paramètres de requête encodés', async () => {
    const { client, fetchImpl } = setup({ clientHeaders: { 'X-Atlas-Client': 'mobile-ios' } });
    fetchImpl.mockResolvedValue(jsonResponse(200, { items: [] }));

    await client.get('/api/drh/employees/page', { query: { q: 'ben ali', page: 2, society: undefined, mode: '' } });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://atlas.example.test/api/drh/employees/page?q=ben%20ali&page=2');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt-token',
      Accept: 'application/json',
      'X-Atlas-Client': 'mobile-ios',
    });
  });

  it("n'envoie aucun jeton sur un appel public", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, { access_token: 't' }));

    await client.post('/api/auth/login', { username: 'u', password: 'p' }, { authenticated: false });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ username: 'u', password: 'p' }));
  });

  it("refuse d'appeler le réseau sans jeton et ferme la session", async () => {
    const { client, fetchImpl, onUnauthorized } = setup({ getToken: () => null });
    const error = await captureError(client.get('/api/auth/me'));
    expect(error.kind).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ferme la session quand le backend refuse le jeton (invalide ou expiré)', async () => {
    const { client, fetchImpl, onUnauthorized } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(401, { detail: 'Token invalide' }));
    const error = await captureError(client.get('/api/auth/me'));
    expect(error.kind).toBe('unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ne ferme pas la session sur un 401 de login (identifiants incorrects)', async () => {
    const { client, fetchImpl, onUnauthorized } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(401, { detail: 'Identifiants incorrects' }));
    const error = await captureError(client.post('/api/auth/login', {}, { authenticated: false }));
    expect(error.serverMessage).toBe('Identifiants incorrects');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('garde la session sur un refus de permission, de société ou de site (403)', async () => {
    const { client, fetchImpl, onUnauthorized } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(403, { detail: 'Aucun périmètre société explicite' }));
    const error = await captureError(client.get('/api/ops/sites/12'));
    expect(error.kind).toBe('forbidden');
    expect(error.serverMessage).toBe('Aucun périmètre société explicite');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('remonte les erreurs de validation par champ (payload invalide)', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(
      jsonResponse(422, { detail: [{ loc: ['body', 'observation'], msg: 'String should have at least 1 character' }] }),
    );
    const error = await captureError(client.post('/api/portal/attendance-manual/abandon', {}));
    expect(error.kind).toBe('validation');
    expect(error.fieldErrors).toEqual({ observation: 'String should have at least 1 character' });
  });

  it('refuse tout chemin hors API pour ne jamais envoyer le jeton ailleurs', async () => {
    const { client, fetchImpl } = setup();
    for (const path of ['https://evil.example/api/x', '//evil.example/api/x', '/uploads/x', '/api/../admin', 'api/x']) {
      const error = await captureError(client.get(path));
      expect(error.kind).toBe('config');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signale une application non configurée sans appeler le réseau", async () => {
    const { client, fetchImpl } = setup({ baseUrl: null });
    expect((await captureError(client.get('/api/auth/me'))).kind).toBe('config');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('distingue panne réseau et dépassement de délai', async () => {
    const offline = setup();
    offline.fetchImpl.mockRejectedValue(new TypeError('Network request failed'));
    expect((await captureError(offline.client.get('/api/auth/me'))).kind).toBe('network');

    const slow = setup({ timeoutMs: 10 });
    slow.fetchImpl.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    expect((await captureError(slow.client.get('/api/auth/me'))).kind).toBe('timeout');
  });

  it('accepte une réponse vide (204) ou non JSON', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.delete('/api/x')).resolves.toBeUndefined();
    fetchImpl.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    expect((await captureError(client.get('/api/x'))).kind).toBe('server');
  });

  it('joint un identifiant de corrélation à chaque requête et le reporte sur l\'erreur', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(500, { detail: 'boom' }));
    const error = await captureError(client.get('/api/x'));
    const sent = (fetchImpl.mock.calls[0]![1].headers as Record<string, string>)['X-Correlation-Id'];
    expect(sent).toMatch(/^[0-9a-f]{32}$/);
    expect(error.correlationId).toBe(sent);

    fetchImpl.mockResolvedValue(jsonResponse(200, {}));
    await client.get('/api/x');
    const second = (fetchImpl.mock.calls[1]![1].headers as Record<string, string>)['X-Correlation-Id'];
    expect(second).not.toBe(sent);
  });

  it('signale un 403 authentifié sans fermer la session, et jamais un 403 public', async () => {
    const onForbidden = jest.fn();
    const { client, fetchImpl, onUnauthorized } = setup({ onForbidden });
    fetchImpl.mockImplementation(async () => jsonResponse(403, { detail: 'Module non autorise pour ce compte' }));
    await captureError(client.get('/api/drh/employees/page'));
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    await captureError(client.post('/api/auth/login', {}, { authenticated: false }));
    expect(onForbidden).toHaveBeenCalledTimes(1);
  });

  it('signale une version refusée par le backend (426)', async () => {
    const onUpgradeRequired = jest.fn();
    const { client, fetchImpl, onUnauthorized } = setup({ onUpgradeRequired });
    fetchImpl.mockResolvedValue(jsonResponse(426, { detail: 'Mise à jour requise' }));
    const error = await captureError(client.get('/api/auth/me'));
    expect(error.kind).toBe('upgrade_required');
    expect(onUpgradeRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  describe('renouvellement du jeton', () => {
    it("renouvelle un jeton d'accès expiré avant d'envoyer la requête", async () => {
      const refreshToken = jest.fn().mockResolvedValue('jeton-neuf');
      const { client, fetchImpl, onUnauthorized } = setup({ getToken: () => null, refreshToken });
      fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true }));

      await client.get('/api/auth/me');

      expect(refreshToken).toHaveBeenCalledWith(null);
      expect((fetchImpl.mock.calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer jeton-neuf');
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('après un 401, renouvelle puis rejoue la requête une seule fois', async () => {
      const refreshToken = jest.fn().mockResolvedValue('jeton-neuf');
      const { client, fetchImpl, onUnauthorized } = setup({ refreshToken });
      fetchImpl
        .mockResolvedValueOnce(jsonResponse(401, { detail: 'Token invalide' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

      await expect(client.post('/api/ops/events', { title: 'x' })).resolves.toEqual({ id: 1 });

      expect(refreshToken).toHaveBeenCalledWith('jwt-token');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1]![1].body).toBe(JSON.stringify({ title: 'x' }));
      expect((fetchImpl.mock.calls[1]![1].headers as Record<string, string>).Authorization).toBe('Bearer jeton-neuf');
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('ferme la session si le renouvellement est refusé ou si le nouvel essai échoue encore', async () => {
      const refused = setup({ refreshToken: jest.fn().mockRejectedValue(new ApiError({ kind: 'unauthorized', status: 401 })) });
      refused.fetchImpl.mockResolvedValue(jsonResponse(401, { detail: 'Session expirée' }));
      expect((await captureError(refused.client.get('/api/auth/me'))).kind).toBe('unauthorized');
      expect(refused.fetchImpl).toHaveBeenCalledTimes(1);
      expect(refused.onUnauthorized).toHaveBeenCalledTimes(1);

      const again = setup({ refreshToken: jest.fn().mockResolvedValue('jeton-neuf') });
      again.fetchImpl.mockResolvedValue(jsonResponse(401, { detail: 'Session expirée' }));
      expect((await captureError(again.client.get('/api/auth/me'))).kind).toBe('unauthorized');
      expect(again.fetchImpl).toHaveBeenCalledTimes(2);
      expect(again.onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('garde la session quand le renouvellement échoue faute de réseau', async () => {
      const refreshToken = jest.fn().mockRejectedValue(new ApiError({ kind: 'network' }));
      const { client, fetchImpl, onUnauthorized } = setup({ getToken: () => null, refreshToken });

      expect((await captureError(client.get('/api/auth/me'))).kind).toBe('network');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('ne tente aucun renouvellement sur un appel public', async () => {
      const refreshToken = jest.fn();
      const { client, fetchImpl } = setup({ refreshToken });
      fetchImpl.mockResolvedValue(jsonResponse(401, { detail: 'Identifiants incorrects' }));
      await captureError(client.post('/api/auth/login', {}, { authenticated: false }));
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });
});
