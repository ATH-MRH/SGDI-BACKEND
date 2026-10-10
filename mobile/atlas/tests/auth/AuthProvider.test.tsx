import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState, Text } from 'react-native';

import { ApiError } from '@/api/errors';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { getSessionToken, notifyForbidden, notifySessionRejected, renewSession, setSession } from '@/auth/session';

import { FUTURE, makeToken, makeUser, storedSession } from '../helpers';

const mockLogin = jest.fn();
const mockFetchProfile = jest.fn();
const mockLogout = jest.fn();

jest.mock('@/api', () => ({
  api: {},
  ApiError: jest.requireActual('@/api/errors').ApiError,
}));
jest.mock('@/api/auth', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'atlas.session.v1';

let auth: ReturnType<typeof useAuth>;

function Probe() {
  auth = useAuth();
  const { state } = auth;
  return <Text testID="status">{state.status === 'signedIn' ? `signedIn:${state.user.username}` : state.status}</Text>;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

const status = () => screen.getByTestId('status').props.children as string;

beforeEach(() => {
  store.clear();
  mockLogin.mockReset();
  mockFetchProfile.mockReset();
  mockLogout.mockReset().mockResolvedValue(undefined);
});

describe('AuthProvider', () => {
  it('démarre déconnecté sans session stockée', async () => {
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('connecte, charge le profil via /me et stocke uniquement le jeton', async () => {
    const token = makeToken(FUTURE);
    mockLogin.mockResolvedValue({ token, expiresAt: FUTURE * 1000 });
    mockFetchProfile.mockResolvedValue(makeUser());
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(() => auth.signIn('ops1', 'secret-password'));

    expect(status()).toBe('signedIn:OPS1');
    expect(getSessionToken()).toBe(token);
    const stored = store.get(KEY)!;
    expect(JSON.parse(stored)).toEqual({ token, expiresAt: FUTURE * 1000 });
    expect(stored).not.toContain('secret-password');
  });

  it('laisse déconnecté et ne stocke rien si les identifiants sont refusés', async () => {
    mockLogin.mockRejectedValue(new ApiError({ kind: 'unauthorized', status: 401 }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await expect(act(() => auth.signIn('ops1', 'faux'))).rejects.toMatchObject({ kind: 'unauthorized' });

    expect(status()).toBe('signedOut');
    expect(store.has(KEY)).toBe(false);
    expect(getSessionToken()).toBeNull();
  });

  it('ferme la session si le profil est refusé juste après le login (403)', async () => {
    mockLogin.mockResolvedValue({ token: makeToken(FUTURE), expiresAt: FUTURE * 1000 });
    mockFetchProfile.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));

    await expect(act(() => auth.signIn('ops1', 'secret'))).rejects.toMatchObject({ kind: 'forbidden' });

    expect(status()).toBe('signedOut');
    expect(store.has(KEY)).toBe(false);
  });

  it('restaure une session stockée au démarrage', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockResolvedValue(makeUser({ username: 'DRH1' }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedIn:DRH1'));
  });

  it('efface une session stockée dont le jeton est refusé par le backend', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockRejectedValue(new ApiError({ kind: 'unauthorized', status: 401 }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(store.has(KEY)).toBe(false);
  });

  it('ignore une session stockée expirée sans appeler le backend', async () => {
    store.set(KEY, JSON.stringify({ token: makeToken(1), expiresAt: 1_000 }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it('garde la session et propose de réessayer quand le réseau est coupé', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockRejectedValueOnce(new ApiError({ kind: 'network' }));
    await mount();
    await waitFor(() => expect(status()).toBe('unavailable'));
    expect(store.has(KEY)).toBe(true);

    mockFetchProfile.mockResolvedValue(makeUser());
    await act(() => auth.retry());
    expect(status()).toBe('signedIn:OPS1');
  });

  it('déconnecte : efface le jeton, la mémoire et le cache de données', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockResolvedValue(makeUser());
    const client = await mount();
    await waitFor(() => expect(status()).toBe('signedIn:OPS1'));
    client.setQueryData(['employees'], [{ id: 1 }]);
    store.set('atlas.scope.v1', JSON.stringify({ userId: 7, society: 'Societe A', siteId: 3 }));
    store.set('atlas.lock.v1', JSON.stringify({ userId: 7, enabled: true }));

    await act(() => auth.signOut());

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(status()).toBe('signedOut');
    expect(store.size).toBe(0);
    expect(store.has(KEY)).toBe(false);
    expect(getSessionToken()).toBeNull();
    expect(client.getQueryData(['employees'])).toBeUndefined();
  });

  it('déconnecte localement même si la révocation serveur échoue (hors ligne)', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockResolvedValue(makeUser());
    mockLogout.mockRejectedValue(new ApiError({ kind: 'network' }));
    await mount();
    await waitFor(() => expect(status()).toBe('signedIn:OPS1'));

    await act(() => auth.signOut());

    expect(status()).toBe('signedOut');
    expect(store.has(KEY)).toBe(false);
  });

  it('restaure une session dont le jeton a expiré mais reste renouvelable', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    store.set(KEY, JSON.stringify({ token: makeToken(past), expiresAt: past * 1000, refreshToken: 'r'.repeat(40), refreshExpiresAt: Date.now() + 60_000 }));
    mockFetchProfile.mockResolvedValue(makeUser());
    await mount();
    await waitFor(() => expect(status()).toBe('signedIn:OPS1'));
    expect(store.has(KEY)).toBe(true);
  });

  it('réécrit la session dans le stockage sécurisé à chaque renouvellement', async () => {
    store.set(KEY, JSON.stringify({ token: makeToken(FUTURE), expiresAt: FUTURE * 1000, refreshToken: 'ancien-refresh-token', refreshExpiresAt: Date.now() + 60_000 }));
    mockFetchProfile.mockResolvedValue(makeUser());
    await mount();
    await waitFor(() => expect(status()).toBe('signedIn:OPS1'));

    const next = { token: makeToken(FUTURE + 10), expiresAt: (FUTURE + 10) * 1000, refreshToken: 'nouveau-refresh-token', refreshExpiresAt: Date.now() + 120_000 };
    await act(async () => {
      await renewSession(async (refreshToken) => {
        expect(refreshToken).toBe('ancien-refresh-token');
        return next;
      });
    });

    await waitFor(() => expect(JSON.parse(store.get(KEY)!)).toEqual(next));
    expect(getSessionToken()).toBe(next.token);
  });

  it('ferme la session quand un appel ultérieur est refusé (jeton expiré ou révoqué)', async () => {
    store.set(KEY, storedSession());
    mockFetchProfile.mockResolvedValue(makeUser());
    await mount();
    await waitFor(() => expect(status()).toBe('signedIn:OPS1'));

    await act(async () => notifySessionRejected());

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(store.has(KEY)).toBe(false);
  });

  describe('retour au premier plan et droits modifiés', () => {
    let listeners: ((state: string) => void)[];
    let now: number;

    beforeEach(() => {
      listeners = [];
      now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
        const handler = listener as (state: string) => void;
        listeners.push(handler);
        return {
          remove: () => {
            listeners = listeners.filter((entry) => entry !== handler);
          },
        } as ReturnType<typeof AppState.addEventListener>;
      });
    });
    afterEach(() => jest.restoreAllMocks());

    const foreground = () => act(async () => [...listeners].forEach((listener) => listener('active')));

    async function signedIn() {
      store.set(KEY, storedSession());
      mockFetchProfile.mockResolvedValue(makeUser());
      await mount();
      await waitFor(() => expect(status()).toBe('signedIn:OPS1'));
      mockFetchProfile.mockClear();
    }

    it('recharge le profil au retour au premier plan, pas plus d\'une fois par minute', async () => {
      await signedIn();
      await foreground();
      expect(mockFetchProfile).not.toHaveBeenCalled();

      now += 61_000;
      mockFetchProfile.mockResolvedValue(makeUser({ username: 'OPS1', effective_modules: [] }));
      await foreground();
      await waitFor(() => expect(mockFetchProfile).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(auth.state.status === 'signedIn' && auth.state.user.effective_modules).toEqual([]));
    });

    it('ferme la session si le jeton a expiré pendant l\'arrière-plan, sans appeler le backend', async () => {
      await signedIn();
      setSession({ token: makeToken(1), expiresAt: now - 1 });
      now += 61_000;
      await foreground();
      await waitFor(() => expect(status()).toBe('signedOut'));
      expect(mockFetchProfile).not.toHaveBeenCalled();
      expect(store.has(KEY)).toBe(false);
    });

    it('garde le profil connu si le réseau manque au retour au premier plan', async () => {
      await signedIn();
      now += 61_000;
      mockFetchProfile.mockRejectedValue(new ApiError({ kind: 'network' }));
      await foreground();
      await waitFor(() => expect(mockFetchProfile).toHaveBeenCalledTimes(1));
      expect(status()).toBe('signedIn:OPS1');
    });

    it('recharge le profil après un refus 403, sans boucler sur des refus répétés', async () => {
      await signedIn();
      now += 61_000;
      mockFetchProfile.mockResolvedValue(makeUser());
      await act(async () => {
        notifyForbidden();
        notifyForbidden();
        notifyForbidden();
      });
      await waitFor(() => expect(mockFetchProfile).toHaveBeenCalledTimes(1));
      await act(async () => notifyForbidden());
      expect(mockFetchProfile).toHaveBeenCalledTimes(1);
      expect(status()).toBe('signedIn:OPS1');
    });
  });
});
