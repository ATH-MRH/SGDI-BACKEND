import type { StoredSession } from '@/auth/secureStorage';
import { getSessionToken, hasUsableSession, onSessionRenewed, renewSession, setSession } from '@/auth/session';

const NOW = Date.now();
const live = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  token: 'acces-1', expiresAt: NOW + 60_000, refreshToken: 'refresh-1', refreshExpiresAt: NOW + 600_000, ...overrides,
});
const next: StoredSession = { token: 'acces-2', expiresAt: NOW + 120_000, refreshToken: 'refresh-2', refreshExpiresAt: NOW + 900_000 };

afterEach(() => setSession(null));

describe('renouvellement de session', () => {
  it('distingue jeton expiré et session perdue', () => {
    setSession(live({ expiresAt: NOW - 1 }));
    expect(getSessionToken()).toBeNull();
    expect(hasUsableSession()).toBe(true);

    setSession(live({ expiresAt: NOW - 1, refreshExpiresAt: NOW - 1 }));
    expect(hasUsableSession()).toBe(false);

    setSession({ token: 'acces', expiresAt: NOW - 1 });
    expect(hasUsableSession()).toBe(false);
  });

  it('installe la nouvelle session et prévient les abonnés', async () => {
    setSession(live());
    const renewed = jest.fn();
    const unsubscribe = onSessionRenewed(renewed);
    const renew = jest.fn().mockResolvedValue(next);

    await expect(renewSession(renew)).resolves.toBe('acces-2');

    expect(renew).toHaveBeenCalledWith('refresh-1');
    expect(getSessionToken()).toBe('acces-2');
    expect(renewed).toHaveBeenCalledWith(next);
    unsubscribe();
  });

  it("n'échange le refresh token qu'une fois pour des appels concurrents", async () => {
    setSession(live());
    const renew = jest.fn().mockResolvedValue(next);
    const results = await Promise.all([renewSession(renew, 'acces-1'), renewSession(renew, 'acces-1'), renewSession(renew, 'acces-1')]);
    expect(results).toEqual(['acces-2', 'acces-2', 'acces-2']);
    expect(renew).toHaveBeenCalledTimes(1);
    // Un appel tardif, refusé avec l'ancien jeton, reçoit le jeton déjà renouvelé.
    await expect(renewSession(renew, 'acces-1')).resolves.toBe('acces-2');
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('ne renouvelle rien sans refresh token utilisable', async () => {
    const renew = jest.fn();
    await expect(renewSession(renew)).resolves.toBeNull();
    setSession({ token: 'acces', expiresAt: NOW + 60_000 });
    await expect(renewSession(renew, 'acces')).resolves.toBeNull();
    setSession(live({ refreshExpiresAt: NOW - 1 }));
    await expect(renewSession(renew, 'acces-1')).resolves.toBeNull();
    expect(renew).not.toHaveBeenCalled();
  });

  it("n'installe pas le nouveau jeton si la session a été fermée pendant l'échange", async () => {
    setSession(live());
    let release: (session: StoredSession) => void = () => undefined;
    const pending = renewSession(() => new Promise<StoredSession>((resolve) => { release = resolve; }));
    setSession(null);
    release(next);
    await expect(pending).resolves.toBeNull();
    expect(getSessionToken()).toBeNull();
  });

  it('laisse remonter une panne réseau sans perdre la session', async () => {
    const session = live();
    setSession(session);
    await expect(renewSession(() => Promise.reject(new Error('réseau')))).rejects.toThrow('réseau');
    expect(getSessionToken()).toBe('acces-1');
    // Un nouvel essai reste possible.
    await expect(renewSession(jest.fn().mockResolvedValue(next))).resolves.toBe('acces-2');
  });
});
