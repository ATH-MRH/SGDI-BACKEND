import type { ApiUser, ScopeSite } from '@/api/types';

export function makeUser(overrides: Partial<ApiUser> = {}): ApiUser {
  return {
    id: 7,
    username: 'OPS1',
    email: 'ops1@example.test',
    full_name: 'Agent Ops',
    role: 'ops',
    access_level: 'H3',
    is_active: true,
    authorized_societies: ['Societe A'],
    authorized_sites: [3, 9],
    global_society_access: false,
    authorized_structures: [],
    authorized_actions: [],
    authorized_modules: ['ops'],
    supervisor_read_only: false,
    effective_modules: ['ops'],
    module_access_global: false,
    ...overrides,
  };
}

/** Fabrique un JWT staff de test (signature factice) expirant à `expSeconds`. */
export function makeToken(expSeconds: number, claims: Record<string, unknown> = { token_use: 'staff' }): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ typ: 'JWT', alg: 'HS256' })}.${encode({ sub: '7', exp: expSeconds, ...claims })}.signature`;
}

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function makeSite(id: number, society: string | null = 'Societe A', name: string | null = `Site ${id}`): ScopeSite {
  return { id, name, society };
}

/** Échéance dans une heure, en secondes Unix. */
export const FUTURE = Math.floor(Date.now() / 1000) + 3600;

export function storedSession(expSeconds: number = FUTURE): string {
  return JSON.stringify({ token: makeToken(expSeconds), expiresAt: expSeconds * 1000 });
}
