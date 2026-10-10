import * as SecureStore from 'expo-secure-store';

import { clearSession, isSessionExpired, loadSession, saveSession } from '@/auth/secureStorage';
import { getSessionToken, notifySessionRejected, onSessionRejected, setSession } from '@/auth/session';
import { readTokenClaims, readTokenExpiry } from '@/auth/token';

import { makeToken } from '../helpers';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'atlas.session.v1';

beforeEach(() => {
  store.clear();
  setSession(null);
});

describe('stockage sécurisé de session', () => {
  it('écrit dans le Keychain/Keystore, lié à cet appareil uniquement', async () => {
    await saveSession({ token: 'abc', expiresAt: 9e15 });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, expect.any(String), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(await loadSession()).toEqual({ token: 'abc', expiresAt: 9e15 });
  });

  it('ne stocke que le jeton et son échéance (jamais de mot de passe ni de profil)', async () => {
    await saveSession({ token: 'abc', expiresAt: 123 });
    expect(Object.keys(JSON.parse(store.get(KEY)!)).sort()).toEqual(['expiresAt', 'token']);
  });

  it('efface et ignore une session expirée', async () => {
    await saveSession({ token: 'abc', expiresAt: 1_000 });
    expect(await loadSession(2_000)).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('efface une entrée corrompue ou de forme inattendue', async () => {
    for (const raw of ['{pas du json', '{"token":""}', '{"token":42,"expiresAt":1}', '{"token":"abc","expiresAt":null}', '{"token":"abc"}', '[]', '"abc"']) {
      store.set(KEY, raw);
      expect(await loadSession()).toBeNull();
      expect(store.has(KEY)).toBe(false);
    }
  });

  it('survit à un Keystore illisible', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Could not decrypt'));
    expect(await loadSession()).toBeNull();
  });

  it('supprime la session à la déconnexion', async () => {
    await saveSession({ token: 'abc', expiresAt: 9e15 });
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});

describe('session en mémoire', () => {
  it('ne fournit plus le jeton une fois expiré', () => {
    setSession({ token: 'abc', expiresAt: Date.now() + 60_000 });
    expect(getSessionToken()).toBe('abc');
    setSession({ token: 'abc', expiresAt: Date.now() - 1 });
    expect(getSessionToken()).toBeNull();
    expect(isSessionExpired({ token: 'abc', expiresAt: 2_000 }, 1_000)).toBe(false);
    expect(isSessionExpired({ token: 'abc', expiresAt: 2_000 }, 2_000)).toBe(true);
  });

  it('prévient les abonnés quand le jeton est refusé', () => {
    const listener = jest.fn();
    const unsubscribe = onSessionRejected(listener);
    setSession({ token: 'abc', expiresAt: Date.now() + 60_000 });
    notifySessionRejected();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSessionToken()).toBeNull();
    unsubscribe();
    notifySessionRejected();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('readTokenExpiry', () => {
  it("lit l'échéance du JWT ATLAS en millisecondes", () => {
    expect(readTokenExpiry(makeToken(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it('lit la famille du jeton sans rien en déduire sur les droits', () => {
    expect(readTokenClaims(makeToken(1_800_000_000))).toEqual({ expiresAt: 1_800_000_000_000, tokenUse: 'staff' });
    expect(readTokenClaims(makeToken(1_800_000_000, { client_portal: true }))?.tokenUse).toBeNull();
    expect(readTokenClaims(makeToken(1_800_000_000, { token_use: 42 }))?.tokenUse).toBeNull();
    expect(readTokenClaims('a.b')).toBeNull();
    expect(readTokenClaims('a.b.c.d')).toBeNull();
  });

  it('renvoie null pour un jeton illisible', () => {
    expect(readTokenExpiry('pas-un-jwt')).toBeNull();
    expect(readTokenExpiry('a.%%%.c')).toBeNull();
    expect(readTokenExpiry(makeToken(0, { exp: 'demain' }))).toBeNull();
  });
});
