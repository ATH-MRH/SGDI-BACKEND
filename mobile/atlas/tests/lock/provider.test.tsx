import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState, Text } from 'react-native';

import type { ApiUser } from '@/api/types';
import { authenticate, getBiometricCapability } from '@/lock/biometrics';
import { LockProvider, useLock } from '@/lock/LockProvider';

import { makeUser } from '../helpers';

let mockUser: ApiUser | null = makeUser();
let mockBiometricsFeature = true;
const mockSignOut = jest.fn(async () => undefined);

jest.mock('@/auth/AuthProvider', () => ({
  useCurrentUser: () => mockUser,
  useAuth: () => ({ signOut: mockSignOut }),
}));
jest.mock('@/config/env', () => ({
  env: { lockTimeoutMs: 120_000 },
  isFeatureEnabled: (key: string) => key === 'biometrics' && mockBiometricsFeature,
}));

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'atlas.lock.v1';

let lock: ReturnType<typeof useLock>;
let listeners: ((state: string) => void)[];
let now: number;

function Protected() {
  lock = useLock();
  return <Text testID="protected">contenu protégé</Text>;
}

async function mount() {
  await render(
    <LockProvider lockScreen={<Text testID="lock">verrouillé</Text>} loadingScreen={<Text testID="loading">…</Text>}>
      <Protected />
    </LockProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
}

const emit = (state: string) => act(async () => [...listeners].forEach((listener) => listener(state)));
const fail = (error: string) => auth.authenticateAsync.mockResolvedValueOnce({ success: false, error } as never);

beforeEach(() => {
  store.clear();
  mockUser = makeUser();
  mockBiometricsFeature = true;
  mockSignOut.mockClear();
  listeners = [];
  now = 1_000_000;
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
  auth.hasHardwareAsync.mockResolvedValue(true);
  auth.isEnrolledAsync.mockResolvedValue(true);
  auth.authenticateAsync.mockReset();
  auth.authenticateAsync.mockResolvedValue({ success: true });
});
afterEach(() => jest.restoreAllMocks());

describe('capacité biométrique', () => {
  it("distingue appareil compatible, non configuré et incompatible", async () => {
    expect(await getBiometricCapability()).toBe('available');
    auth.isEnrolledAsync.mockResolvedValueOnce(false);
    expect(await getBiometricCapability()).toBe('notEnrolled');
    auth.hasHardwareAsync.mockResolvedValueOnce(false);
    expect(await getBiometricCapability()).toBe('unavailable');
    auth.hasHardwareAsync.mockRejectedValueOnce(new Error('module absent'));
    expect(await getBiometricCapability()).toBe('unavailable');
  });

  it("traduit le résultat du système sans jamais manipuler de donnée biométrique", async () => {
    expect(await authenticate('m', 'c')).toBe('success');
    for (const [error, expected] of [
      ['user_cancel', 'cancelled'],
      ['system_cancel', 'cancelled'],
      ['authentication_failed', 'failed'],
      ['lockout', 'lockout'],
      ['not_enrolled', 'unavailable'],
      ['passcode_not_set', 'unavailable'],
    ] as const) {
      fail(error);
      expect(await authenticate('m', 'c')).toBe(expected);
    }
    auth.authenticateAsync.mockRejectedValueOnce(new Error('boom'));
    expect(await authenticate('m', 'c')).toBe('failed');
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'm', disableDeviceFallback: false }),
    );
  });
});

describe('LockProvider', () => {
  it("n'est jamais activé silencieusement : désactivé par défaut", async () => {
    await mount();
    expect(lock.supported).toBe(true);
    expect(lock.enabled).toBe(false);
    expect(lock.locked).toBe(false);
    expect(screen.getByTestId('protected')).toBeTruthy();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it("s'active seulement après une vérification réussie et ne mémorise que le choix", async () => {
    await mount();
    await act(async () => expect(await lock.enable()).toBe('success'));
    expect(lock.enabled).toBe(true);
    expect(lock.locked).toBe(false);
    expect(JSON.parse(store.get(KEY)!)).toEqual({ userId: 7, enabled: true });
  });

  it("ne s'active pas si la vérification est refusée ou annulée", async () => {
    await mount();
    for (const error of ['authentication_failed', 'user_cancel']) {
      fail(error);
      await act(async () => expect(await lock.enable()).not.toBe('success'));
      expect(lock.enabled).toBe(false);
      expect(store.has(KEY)).toBe(false);
    }
  });

  it("ne s'active pas sur un appareil sans biométrie ou non configuré", async () => {
    auth.isEnrolledAsync.mockResolvedValue(false);
    await mount();
    expect(lock.capability).toBe('notEnrolled');
    await act(async () => expect(await lock.enable()).toBe('unavailable'));
    expect(lock.enabled).toBe(false);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('démarre verrouillé à froid et ne monte aucun écran protégé avant le déverrouillage', async () => {
    store.set(KEY, JSON.stringify({ userId: 7, enabled: true }));
    await mount();
    expect(screen.getByTestId('lock')).toBeTruthy();
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it("ignore le réglage de verrouillage d'un autre utilisateur", async () => {
    store.set(KEY, JSON.stringify({ userId: 99, enabled: true }));
    await mount();
    expect(lock.enabled).toBe(false);
    expect(screen.getByTestId('protected')).toBeTruthy();
  });

  describe('une fois activé', () => {
    beforeEach(async () => {
      await mount();
      await act(async () => {
        await lock.enable();
      });
      auth.authenticateAsync.mockClear();
    });

    it('verrouille au retour au premier plan après le délai, pas avant', async () => {
      await emit('background');
      now += 119_000;
      await emit('active');
      expect(lock.locked).toBe(false);

      await emit('background');
      now += 121_000;
      await emit('active');
      expect(lock.locked).toBe(true);
      expect(screen.getByTestId('lock')).toBeTruthy();
    });

    it("ne verrouille pas sur une simple perte de focus (fenêtre système)", async () => {
      await emit('inactive');
      now += 600_000;
      await emit('active');
      expect(lock.locked).toBe(false);
    });

    it('déverrouille après une vérification réussie et garde les écrans montés', async () => {
      await act(async () => lock.lockNow());
      expect(lock.locked).toBe(true);
      await act(async () => expect(await lock.unlock()).toBe('success'));
      expect(lock.locked).toBe(false);
      expect(screen.queryByTestId('lock')).toBeNull();
      expect(screen.getByTestId('protected')).toBeTruthy();
    });

    it('reste verrouillé après un refus et compte les échecs, pas les annulations', async () => {
      await act(async () => lock.lockNow());
      fail('authentication_failed');
      await act(async () => expect(await lock.unlock()).toBe('failed'));
      expect(lock.locked).toBe(true);
      expect(lock.failures).toBe(1);
      fail('user_cancel');
      await act(async () => expect(await lock.unlock()).toBe('cancelled'));
      expect(lock.failures).toBe(1);
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('ferme la session après trop d\'échecs consécutifs', async () => {
      await act(async () => lock.lockNow());
      for (let attempt = 0; attempt < 5; attempt += 1) {
        fail('authentication_failed');
        await act(async () => {
          await lock.unlock();
        });
      }
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it("ne relance pas de verrouillage à cause de la fenêtre biométrique elle-même", async () => {
      await act(async () => lock.lockNow());
      let resolvePrompt: (value: { success: true }) => void = () => undefined;
      auth.authenticateAsync.mockImplementationOnce(() => new Promise((resolve) => (resolvePrompt = resolve)));
      let pending: Promise<unknown> = Promise.resolve();
      await act(async () => {
        pending = lock.unlock();
      });
      // Pendant la fenêtre système, l'application perd puis reprend le focus.
      await emit('background');
      now += 600_000;
      await emit('active');
      await act(async () => {
        resolvePrompt({ success: true });
        await pending;
      });
      expect(lock.locked).toBe(false);
      await emit('active');
      expect(lock.locked).toBe(false);
      expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    });

    it('exige une vérification pour désactiver le verrouillage', async () => {
      fail('authentication_failed');
      await act(async () => expect(await lock.disable()).toBe('failed'));
      expect(lock.enabled).toBe(true);
      await act(async () => expect(await lock.disable()).toBe('success'));
      expect(lock.enabled).toBe(false);
      expect(store.has(KEY)).toBe(false);
    });
  });

  it('est totalement inactif quand la fonction est absente du build', async () => {
    mockBiometricsFeature = false;
    store.set(KEY, JSON.stringify({ userId: 7, enabled: true }));
    await mount();
    expect(lock.supported).toBe(false);
    expect(lock.locked).toBe(false);
    expect(screen.getByTestId('protected')).toBeTruthy();
    await act(async () => expect(await lock.enable()).toBe('unavailable'));
    expect(auth.hasHardwareAsync).not.toHaveBeenCalled();
  });
});
