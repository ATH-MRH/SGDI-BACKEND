/**
 * Tests d'intégration contre un VRAI backend ATLAS (jetable, jamais la production).
 *
 * Ignorés par `npm test`. Lancés par `npm run test:integration`, qui démarre le
 * backend du dépôt sur une base SQLite temporaire (scripts/integration.mjs).
 */
import http from 'node:http';

import { fetchProfile, login, logout, parseLoginResponse, refreshSession } from '@/api/auth';
import { createApiClient } from '@/api/client';
import { createIncident, fetchIncidents } from '@/api/domains/incidents';
import { ApiError } from '@/api/errors';
import type { Page } from '@/api/types';
import { canAccessModule, canAccessSite, canAccessSociety, societyScope } from '@/auth/permissions';
import { fetchMobileConfig } from '@/api/mobileConfig';
import { fetchScopeSites } from '@/api/scope';
import { readTokenClaims } from '@/auth/token';
import {
  employeeLogin,
  fetchSelfAbsences,
  fetchSelfAttendance,
  fetchSelfDocuments,
  fetchSelfLeaves,
  fetchSelfPayslips,
  fetchSelfPlanning,
  fetchSelfProfile,
} from '@/employee/api';
import { newClientId } from '@/offline/queue';
import { registerDevice } from '@/push/registration';

const baseUrl = process.env.ATLAS_IT_URL;
const describeIntegration = baseUrl ? describe : describe.skip;

function credentials(name: string): [string, string] {
  const [username = '', password = ''] = (process.env[name] ?? ':').split(':');
  return [username, password];
}

/** Transport HTTP réel : le `fetch` de l'environnement Jest Expo n'atteint pas le réseau. */
const nodeFetch = ((url: string, init: RequestInit = {}) =>
  new Promise<Response>((resolve, reject) => {
    const request = http.request(
      url,
      { method: init.method, headers: init.headers as Record<string, string> },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const body = status === 204 ? null : Buffer.concat(chunks).toString('utf8');
          resolve(new Response(body, { status, headers: response.headers as Record<string, string> }));
        });
      },
    );
    request.on('error', reject);
    if (typeof init.body === 'string') request.write(init.body);
    request.end();
  })) as unknown as typeof fetch;

function session(clientHeaders?: Record<string, string>) {
  let token: string | null = null;
  const onUnauthorized = jest.fn(() => {
    token = null;
  });
  const client = createApiClient({
    baseUrl: baseUrl ?? null,
    getToken: () => token,
    onUnauthorized,
    fetchImpl: nodeFetch,
    clientHeaders,
  });
  return {
    client,
    onUnauthorized,
    setToken: (value: string | null) => {
      token = value;
    },
    async signIn(name: string) {
      const staff = await login(client, ...credentials(name));
      token = staff.token;
      return staff;
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('une erreur API était attendue');
}

describeIntegration('backend ATLAS réel', () => {
  it('connecte un administrateur et lit son profil global', async () => {
    const s = session();
    const staff = await s.signIn('ATLAS_IT_ADMIN');
    expect(staff.expiresAt).toBeGreaterThan(Date.now());
    const user = await fetchProfile(s.client);
    expect(user.module_access_global).toBe(true);
    expect(societyScope(user)).toEqual({ kind: 'global' });
    expect(canAccessModule(user, 'drh')).toBe(true);
  });

  it("connecte un compte OPS limité : modules et périmètre viennent du backend", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const user = await fetchProfile(s.client);
    expect(user.effective_modules).toEqual(['ops']);
    expect(canAccessModule(user, 'ops')).toBe(true);
    expect(canAccessModule(user, 'drh')).toBe(false);
    expect(societyScope(user)).toEqual({ kind: 'limited', societies: ['Societe A'] });
  });

  it('refuse un mot de passe incorrect sans ouvrir de session', async () => {
    const s = session();
    const [username] = credentials('ATLAS_IT_OPS');
    const error = await failure(login(s.client, username, 'mauvais-mot-de-passe'));
    expect(error.kind).toBe('unauthorized');
    expect(error.serverMessage).toBe('Identifiants incorrects');
    expect(s.onUnauthorized).not.toHaveBeenCalled();
  });

  it('refuse un compte désactivé', async () => {
    const s = session();
    const error = await failure(s.signIn('ATLAS_IT_INACTIVE'));
    expect(['unauthorized', 'forbidden']).toContain(error.kind);
  });

  it('rejette un payload de connexion invalide avec des erreurs par champ', async () => {
    const s = session();
    const error = await failure(s.client.post('/api/auth/login', {}, { authenticated: false }));
    expect(error.kind).toBe('validation');
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(['password', 'username']);
  });

  it('rejette un jeton invalide et ferme la session', async () => {
    const s = session();
    s.setToken('jeton.totalement.invalide');
    const error = await failure(fetchProfile(s.client));
    expect(error.kind).toBe('unauthorized');
    expect(s.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('rejette un jeton expiré et ferme la session', async () => {
    const s = session();
    s.setToken(process.env.ATLAS_IT_EXPIRED_TOKEN ?? '');
    const error = await failure(fetchProfile(s.client));
    expect(error.kind).toBe('unauthorized');
    expect(s.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('après déconnexion, plus aucun appel authentifié ne part', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    await fetchProfile(s.client);
    s.setToken(null);
    expect((await failure(fetchProfile(s.client))).kind).toBe('unauthorized');
  });

  it("refuse côté serveur un module non autorisé (le masquage n'est pas la sécurité)", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const error = await failure(s.client.get('/api/drh/employees/page', { query: { page: 1 } }));
    expect(error.kind).toBe('forbidden');
    expect(s.onUnauthorized).not.toHaveBeenCalled();
  });

  it('refuse côté serveur un compte sans aucun module', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_NOMODULE');
    const user = await fetchProfile(s.client);
    expect(user.effective_modules).toEqual([]);
    expect((await failure(s.client.get('/api/ops/sites/page'))).kind).toBe('forbidden');
  });

  it('refuse côté serveur un compte sans périmètre société', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_NOSCOPE');
    const error = await failure(s.client.get('/api/ops/sites/page'));
    expect(error.kind).toBe('forbidden');
    expect(error.serverMessage).toBe('Aucun périmètre société explicite');
  });

  it("n'expose aucune donnée d'une société hors périmètre", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    // Le backend peut refuser (403) ou répondre par une liste vide : jamais de données.
    try {
      const page = await s.client.get<Page<unknown>>('/api/ops/sites/page', { query: { society: 'Societe Interdite' } });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).kind).toBe('forbidden');
    }
  });

  it('refuse un site inexistant ou hors périmètre sans divulguer de données', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const error = await failure(s.client.get('/api/ops/sites/999999'));
    expect(['forbidden', 'not_found']).toContain(error.kind);
  });

  it('liste les sites autorisés avec la pagination serveur', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const page = await s.client.get<Page<unknown>>('/api/ops/sites/page', { query: { page: 1, page_size: 5 } });
    expect(Array.isArray(page.items)).toBe(true);
    expect(page).toMatchObject({ page: 1, page_size: 5 });
    expect(typeof page.total).toBe('number');
  });

  it('reçoit du backend un jeton typé staff (token_use = staff)', async () => {
    const s = session();
    const staff = await s.signIn('ATLAS_IT_OPS');
    expect(readTokenClaims(staff.token)).toEqual({ expiresAt: staff.expiresAt, tokenUse: 'staff' });
  });

  it.each(['CLIENT_PORTAL', 'EMPLOYEE_PORTAL', 'ATTENDANCE_QR', 'SSE_TICKET'])(
    "un jeton %s est refusé par le backend (401) et ferme la session, sans jamais d'erreur serveur",
    async (family) => {
      const s = session();
      s.setToken(process.env[`ATLAS_IT_TOKEN_${family}`] ?? '');
      for (const path of ['/api/auth/me', '/api/ops/sites/page', '/api/attendance/sites']) {
        const error = await failure(s.client.get(path));
        expect(error.kind).toBe('unauthorized');
        expect(error.status).toBe(401);
        s.setToken(process.env[`ATLAS_IT_TOKEN_${family}`] ?? '');
      }
      expect(s.onUnauthorized).toHaveBeenCalledTimes(3);
    },
  );

  it('le périmètre de sites vient du backend et ne contient que des sites autorisés', async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const user = await fetchProfile(s.client);
    const sites = await fetchScopeSites(s.client, user);
    expect(sites.map((site) => site.name).sort()).toEqual(['IT Site A1', 'IT Site A2']);
    for (const site of sites) {
      expect(canAccessSite(user, site)).toBe(true);
      expect(canAccessSociety(user, site.society)).toBe(true);
    }
  });

  it("un compte limité à un site n'obtient que ce site, et le backend refuse les autres", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_ONESITE');
    const user = await fetchProfile(s.client);
    const sites = await fetchScopeSites(s.client, user);
    expect(sites).toHaveLength(1);
    expect(user.authorized_sites).toEqual([sites[0]!.id]);
    const other = Number(process.env.ATLAS_IT_OTHER_SITE_ID);
    expect(canAccessSite(user, { id: other, society: 'Societe A' })).toBe(false);
    expect((await failure(s.client.get(`/api/ops/sites/${other}`))).kind).toBe('forbidden');
    expect((await failure(s.client.get(`/api/ops/sites/${process.env.ATLAS_IT_FOREIGN_SITE_ID}`))).kind).toBe('forbidden');
  });

  it("un administrateur global voit les sites de toutes les sociétés", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_ADMIN');
    const sites = await fetchScopeSites(s.client, await fetchProfile(s.client));
    expect(new Set(sites.map((site) => site.society))).toEqual(new Set(['Societe A', 'Societe B']));
  });

  // Le backend filtre les comptes par sous-domaine (app/modules/auth/routes.py,
  // enforce_subdomain_login_scope) : l'API mobile doit être servie sur un hôte neutre.
  it.each([
    ['atlas.example.test', true],
    ['api.example.test', false],
    ['192.168.1.20:8000', false],
  ])("hôte %s : connexion d'un compte à modules explicites acceptée = %s", async (host, accepted) => {
    const s = session({ Host: host });
    if (accepted) {
      await expect(s.signIn('ATLAS_IT_OPS')).resolves.toMatchObject({ token: expect.any(String) });
    } else {
      expect((await failure(s.signIn('ATLAS_IT_OPS'))).kind).toBe('forbidden');
    }
  });

  describe('session renouvelable', () => {
    it('ouvre une session avec refresh token, la renouvelle, puis la révoque à la déconnexion', async () => {
      const s = session();
      const first = await s.signIn('ATLAS_IT_OPS');
      expect(first.refreshToken).toBeTruthy();
      // Jeton d'accès court : bien en deçà des 12 h du jeton web.
      expect(first.expiresAt - Date.now()).toBeLessThan(2 * 3600 * 1000);

      const second = await refreshSession(s.client, first.refreshToken!);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      s.setToken(second.token);
      expect((await fetchProfile(s.client)).username.toLowerCase()).toBe('itops');

      await logout(s.client);
      expect((await failure(fetchProfile(s.client))).status).toBe(401);
      expect((await failure(refreshSession(s.client, second.refreshToken!))).status).toBe(401);
    });

    it("rejouer un refresh token déjà consommé coupe toute la session", async () => {
      const s = session();
      const first = await s.signIn('ATLAS_IT_OPS');
      const second = await refreshSession(s.client, first.refreshToken!);
      expect((await failure(refreshSession(s.client, first.refreshToken!))).status).toBe(401);
      s.setToken(second.token);
      expect((await failure(fetchProfile(s.client))).status).toBe(401);
    });

    it('le client renouvelle seul un jeton refusé et rejoue la requête', async () => {
      const s = session();
      const staff = await s.signIn('ATLAS_IT_OPS');
      let token: string | null = process.env.ATLAS_IT_EXPIRED_TOKEN ?? '';
      const onUnauthorized = jest.fn();
      const client = createApiClient({
        baseUrl: baseUrl ?? null,
        getToken: () => token,
        refreshToken: async () => {
          token = (await refreshSession(s.client, staff.refreshToken!)).token;
          return token;
        },
        onUnauthorized,
        fetchImpl: nodeFetch,
      });
      expect((await fetchProfile(client)).username.toLowerCase()).toBe('itops');
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("un refresh token n'est pas un jeton d'accès, et un jeton d'accès n'est pas un refresh token", async () => {
      const s = session();
      const staff = await s.signIn('ATLAS_IT_OPS');
      s.setToken(staff.refreshToken!);
      expect((await failure(fetchProfile(s.client))).status).toBe(401);
      expect((await failure(refreshSession(s.client, staff.token.slice(0, 190)))).status).toBe(401);
    });
  });

  it("rejouer une déclaration d'incident avec le même identifiant client ne crée pas de doublon", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_ADMIN');
    const sites = await fetchScopeSites(s.client, await fetchProfile(s.client));
    const site = sites.find((entry) => entry.society);
    expect(site).toBeDefined();
    const subject = `Rejeu ${Date.now()}`;
    const draft = {
      siteId: site!.id, society: site!.society!, type: 'autre', severity: 'faible', subject, description: 'Envoi rejoué après coupure réseau.',
      date: '2026-10-08', time: '10:00',
    } as const;
    const clientId = newClientId();

    const first = await createIncident(s.client, draft, clientId);
    const second = await createIncident(s.client, draft, clientId);

    expect(second.id).toBe(first.id);
    expect((await fetchIncidents(s.client)).filter((incident) => incident.subject === subject)).toHaveLength(1);
  });

  it("enregistre l'appareil du compte connecté, puis le rend muet à la déconnexion", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const device = { token: `ExponentPushToken[${newClientId().slice(-22)}]`, platform: 'ios', variant: 'staging', appVersion: '1.0.0' } as const;
    await registerDevice(s.client, device);
    await registerDevice(s.client, device);
    await logout(s.client);
    expect((await failure(registerDevice(s.client, device))).status).toBe(401);
  });

  it("refuse un jeton d'appareil mal formé", async () => {
    const s = session();
    await s.signIn('ATLAS_IT_OPS');
    const error = await failure(registerDevice(s.client, { token: 'pas-un-jeton', platform: 'ios', variant: 'staging', appVersion: '1.0.0' }));
    expect(error.kind).toBe('validation');
  });

  /**
   * Le backend de production actuel ne connaît pas encore les routes mobiles. Un relais
   * local le reproduit : il répond 404 sur ces routes et transmet tout le reste au vrai backend.
   */
  describe('backend sans les routes mobiles (production actuelle)', () => {
    const MOBILE_ONLY = /^\/api\/(auth\/(mobile\/|refresh$|logout$)|mobile\/)/;
    let relay: http.Server;
    let relayUrl = '';

    beforeAll(async () => {
      relay = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          if (MOBILE_ONLY.test((request.url ?? '').split('?')[0]!)) {
            response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"detail":"Not Found"}');
            return;
          }
          const upstream = http.request(`${baseUrl}${request.url}`, { method: request.method, headers: { ...request.headers, host: 'localhost' } }, (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
          });
          upstream.on('error', () => response.writeHead(502).end());
          upstream.end(Buffer.concat(chunks));
        });
      });
      await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
      relayUrl = `http://localhost:${(relay.address() as { port: number }).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => void relay.close(() => resolve())));

    function legacySession() {
      let token: string | null = null;
      const onUnauthorized = jest.fn();
      const client = createApiClient({ baseUrl: relayUrl, getToken: () => token, onUnauthorized, fetchImpl: nodeFetch });
      return { client, onUnauthorized, use: (value: string | null) => void (token = value) };
    }

    it('se connecte par la route classique, sans session renouvelable', async () => {
      const s = legacySession();
      const staff = await login(s.client, ...credentials('ATLAS_IT_OPS'), { platform: 'ios', appVersion: '1.0.0' });
      expect(staff.refreshToken).toBeUndefined();
      expect(readTokenClaims(staff.token)?.tokenUse).toBe('staff');
      s.use(staff.token);
      expect((await fetchProfile(s.client)).username.toLowerCase()).toBe('itops');
      expect((await fetchScopeSites(s.client, await fetchProfile(s.client))).length).toBeGreaterThan(0);
    });

    it('signale des identifiants refusés comme tels, pas comme une route manquante', async () => {
      const s = legacySession();
      const [username] = credentials('ATLAS_IT_OPS');
      const error = await failure(login(s.client, username, 'mot-de-passe-faux'));
      expect([error.kind, error.status]).toEqual(['unauthorized', 401]);
    });

    it("la déconnexion, l'appareil et la configuration absents ne ferment ni ne bloquent rien", async () => {
      const s = legacySession();
      const staff = await login(s.client, ...credentials('ATLAS_IT_OPS'));
      s.use(staff.token);
      expect((await failure(logout(s.client))).kind).toBe('not_found');
      expect((await failure(registerDevice(s.client, { token: 'ExponentPushToken[abcdefghijklmnopqrstuv]', platform: 'ios', variant: 'production', appVersion: '1.0.0' }))).kind).toBe('not_found');
      expect((await failure(fetchMobileConfig(s.client))).kind).toBe('not_found');
      // Aucune de ces absences n'est prise pour un refus de session.
      expect(s.onUnauthorized).not.toHaveBeenCalled();
      expect((await fetchProfile(s.client)).username.toLowerCase()).toBe('itops');
    });
  });

  describe('accès employé (jeton employee_mobile)', () => {
    function employeeSession() {
      let token: string | null = null;
      const onUnauthorized = jest.fn();
      const client = createApiClient({ baseUrl: baseUrl ?? null, getToken: () => token, onUnauthorized, fetchImpl: nodeFetch });
      return { client, onUnauthorized, use: (value: string | null) => void (token = value) };
    }

    it('connecte un employé et ne lui montre que ses propres données', async () => {
      const s = employeeSession();
      const { session: opened, employee } = await employeeLogin(s.client, ...credentials('ATLAS_IT_EMPLOYEE'));
      expect(readTokenClaims(opened.token)?.tokenUse).toBe('employee_mobile');
      expect(employee.matricule).toBe('ITEMP1');
      s.use(opened.token);

      expect((await fetchSelfProfile(s.client)).siteName).toBe('IT Site A1');
      expect((await fetchSelfLeaves(s.client)).map((leave) => leave.reason)).toEqual(['Motif un']);
      expect(Array.isArray(await fetchSelfPlanning(s.client))).toBe(true);
      expect(await fetchSelfAttendance(s.client)).toEqual([]);
      expect(await fetchSelfAbsences(s.client)).toEqual([]);
      expect(await fetchSelfDocuments(s.client)).toEqual([]);
      expect(await fetchSelfPayslips(s.client)).toEqual([]);
    });

    it('refuse des identifiants incorrects', async () => {
      const s = employeeSession();
      const [username] = credentials('ATLAS_IT_EMPLOYEE');
      expect((await failure(employeeLogin(s.client, username, 'faux'))).status).toBe(403);
    });

    it("le jeton employé n'ouvre aucune route staff, et le jeton staff aucune route employé", async () => {
      const worker = employeeSession();
      const { session: opened } = await employeeLogin(worker.client, ...credentials('ATLAS_IT_EMPLOYEE'));
      worker.use(opened.token);
      for (const path of ['/api/auth/me', '/api/ops/sites/page', '/api/drh/employees/page', '/api/attendance/board']) {
        expect((await failure(worker.client.get(path))).status).toBe(401);
        worker.use(opened.token);
      }
      // La session staff du téléphone refuserait de toute façon ce jeton.
      expect(() => parseLoginResponse({ access_token: opened.token, token_type: 'bearer' })).toThrow(ApiError);

      const staff = session();
      await staff.signIn('ATLAS_IT_ADMIN');
      expect((await failure(fetchSelfProfile(staff.client))).status).toBe(401);
      expect((await failure(fetchSelfLeaves(staff.client))).status).toBe(401);
    });

    it("un jeton d'une autre famille est refusé sur le libre-service", async () => {
      for (const family of ['CLIENT_PORTAL', 'EMPLOYEE_PORTAL', 'ATTENDANCE_QR', 'SSE_TICKET']) {
        const s = employeeSession();
        s.use(process.env[`ATLAS_IT_TOKEN_${family}`] ?? '');
        expect((await failure(fetchSelfProfile(s.client))).status).toBe(401);
      }
    });
  });
});
