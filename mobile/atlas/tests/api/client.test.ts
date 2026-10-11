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

describe('client API — image authentifiée', () => {
  const PIXELS = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const BASE64 = '/9j/4AAQSkZJRg==';
  const image = (status = 200, type = 'image/jpeg', bytes: Uint8Array = PIXELS) =>
    new Response(status === 200 ? (bytes as unknown as BodyInit) : JSON.stringify({ detail: 'refus' }), { status, headers: { 'Content-Type': status === 200 ? type : 'application/json' } });
  const PATH = '/api/drh/employees/5/portrait';

  it('200 : renvoie une URI data: et demande une image avec le jeton courant', async () => {
    const { client, fetchImpl, onUnauthorized } = setup();
    fetchImpl.mockResolvedValue(image());
    expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://atlas.example.test/api/drh/employees/5/portrait');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-token', Accept: 'image/jpeg, image/png, image/webp' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('reconnaît JPEG, PNG et WebP à leur signature, quel que soit le Content-Type annoncé', async () => {
    const { client, fetchImpl } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    fetchImpl.mockResolvedValueOnce(image(200, 'image/png; charset=binary', png));
    expect(await client.getImage(PATH)).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    fetchImpl.mockResolvedValueOnce(image(200, 'application/octet-stream', webp));
    expect(await client.getImage(PATH)).toBe(`data:image/webp;base64,${Buffer.from(webp).toString('base64')}`);
    fetchImpl.mockResolvedValueOnce(new Response(PIXELS as unknown as BodyInit, { status: 200 }));
    expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
  });

  it('lit les octets de la réponse sans passer par blob() ni FileReader', async () => {
    const { client, fetchImpl } = setup();
    const response = image();
    const blob = jest.spyOn(response, 'blob');
    fetchImpl.mockResolvedValue(response);
    expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
    expect(blob).not.toHaveBeenCalled();
  });

  it('une réponse dont le corps ne peut pas être lu est refusée', async () => {
    const { client, fetchImpl } = setup();
    const response = image();
    jest.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('lecture'));
    fetchImpl.mockResolvedValue(response);
    const error = await captureError(client.getImage(PATH));
    expect(error.kind).toBe('invalid_response');
    expect(error.status).toBe(200);
  });

  it('401 puis renouvellement puis 200 : un seul nouvel essai, avec le nouveau jeton', async () => {
    const refreshToken = jest.fn(async () => 'jeton-renouvele');
    const { client, fetchImpl, onUnauthorized } = setup({ refreshToken });
    fetchImpl.mockResolvedValueOnce(image(401)).mockResolvedValueOnce(image());
    expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
    expect(refreshToken).toHaveBeenCalledWith('jwt-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1].headers).toMatchObject({ Authorization: 'Bearer jeton-renouvele' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("jeton d'accès expiré : la session est renouvelée avant la demande", async () => {
    const refreshToken = jest.fn(async () => 'jeton-renouvele');
    const { client, fetchImpl } = setup({ getToken: () => null, refreshToken });
    fetchImpl.mockResolvedValue(image());
    expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
    expect(refreshToken).toHaveBeenCalledWith(null);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer jeton-renouvele' });
  });

  it('401 persistant : une erreur, un seul nouvel essai, et la session n’est pas fermée pour une photo', async () => {
    const refreshToken = jest.fn(async () => 'jeton-renouvele');
    const { client, fetchImpl, onUnauthorized } = setup({ refreshToken });
    fetchImpl.mockResolvedValue(image(401));
    const error = await captureError(client.getImage(PATH));
    expect(error.kind).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('session non renouvelable : aucune requête ne part', async () => {
    const { client, fetchImpl, onUnauthorized } = setup({ getToken: () => null, refreshToken: async () => null });
    expect((await captureError(client.getImage(PATH))).kind).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'server'],
  ] as const)('%i : erreur typée, sans recharger le profil ni fermer la session', async (status, kind) => {
    const onForbidden = jest.fn();
    const { client, fetchImpl, onUnauthorized } = setup({ onForbidden });
    fetchImpl.mockResolvedValue(image(status));
    const error = await captureError(client.getImage(PATH));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(onForbidden).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    ['du HTML', new Response('<html>connexion</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['du JSON', new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })],
    ['un SVG', new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })],
    ['du texte annoncé comme une image', new Response('Service indisponible', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })],
    ['une image tronquée', new Response(PIXELS.slice(0, 2) as unknown as BodyInit, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })],
    ['une image vide', new Response(new Uint8Array(0) as unknown as BodyInit, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })],
  ])('refuse %s à la place d’une image', async (_label, response) => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(response);
    expect((await captureError(client.getImage(PATH))).kind).toBe('invalid_response');
  });

  it('refuse une image trop lourde pour être gardée en mémoire', async () => {
    const { client, fetchImpl } = setup();
    const heavy = new Uint8Array(2_000_001);
    heavy.set(PIXELS);
    fetchImpl.mockResolvedValue(image(200, 'image/jpeg', heavy));
    expect((await captureError(client.getImage(PATH))).kind).toBe('invalid_response');
  });

  it("n'envoie jamais le jeton vers un autre hôte ni hors de /api/", async () => {
    const { client, fetchImpl } = setup();
    for (const path of ['https://ailleurs.example/portrait.jpg', '/uploads/photos/a.jpg', '/api/../uploads/a.jpg']) {
      expect((await captureError(client.getImage(path))).kind).toBe('config');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('une panne réseau est signalée comme telle', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new TypeError('Network request failed'));
    expect((await captureError(client.getImage(PATH))).kind).toBe('network');
  });

  it('lit le blob par FileReader quand la plateforme en fournit un (React Native)', async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    class FakeReader {
      result: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        // Android renvoie parfois un type générique : seul le contenu est repris.
        this.result = `data:application/octet-stream;base64,${BASE64}`;
        this.onload?.();
      }
    }
    (globalThis as { FileReader?: unknown }).FileReader = FakeReader;
    try {
      const { client, fetchImpl } = setup();
      fetchImpl.mockResolvedValue(image());
      expect(await client.getImage(PATH)).toBe(`data:image/jpeg;base64,${BASE64}`);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});
