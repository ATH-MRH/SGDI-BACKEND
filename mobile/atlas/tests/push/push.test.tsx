import { act, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { ApiError } from '@/api/errors';
import { pushTarget } from '@/push/links';
import { PushProvider, usePush } from '@/push/PushProvider';

import { makeUser } from '../helpers';

const mockPost = jest.fn();
const mockPush = jest.fn();
let mockEnabled = true;
let mockUser: ReturnType<typeof makeUser> | null = null;
let mockProjectId: string | undefined = 'projet-eas';

jest.mock('@/api', () => ({ api: { post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('@/config/env', () => ({ env: { variant: 'staging' }, isFeatureEnabled: (key: string) => key === 'push' && mockEnabled }));
jest.mock('@/auth/AuthProvider', () => ({ useCurrentUser: () => mockUser }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { get expoConfig() { return { version: '1.0.0', extra: { eas: { projectId: mockProjectId } } }; } },
}));

const notifications = Notifications as jest.Mocked<typeof Notifications>;
const permission = (granted: boolean, canAskAgain = true) => ({ granted, canAskAgain }) as never;

let push: ReturnType<typeof usePush>;
function Probe() {
  push = usePush();
  return null;
}
const mount = () => render(<PushProvider><Probe /></PushProvider>);

beforeEach(() => {
  mockEnabled = true;
  mockProjectId = 'projet-eas';
  mockUser = makeUser({ id: 7 });
  mockPost.mockReset().mockResolvedValue({ ok: true });
  mockPush.mockReset();
  notifications.getPermissionsAsync.mockResolvedValue(permission(false));
  notifications.requestPermissionsAsync.mockResolvedValue(permission(true));
  notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  notifications.getExpoPushTokenAsync.mockClear();
  notifications.requestPermissionsAsync.mockClear();
});

describe('cible d\'une notification', () => {
  it.each(['/alerts/4', '/ops/sites/12', '/drh/employees/5', '/incidents', '/brq', '/drh/leaves', '/(tabs)/tasks'])('accepte la route interne %s', (route) => {
    expect(pushTarget({ route })).toBe(route);
  });

  it.each([
    'https://exemple.test/alerts/4', '//exemple.test', 'atlas://alerts/4', '/alerts/4/../../login', '/alerts/abc', '/login', '/scope',
    '/alerts/4?next=https://exemple.test', '/module/finances', '', 42, null, '/alerts/' + '9'.repeat(80),
  ])('refuse %p', (route) => {
    expect(pushTarget({ route })).toBeNull();
  });

  it('ignore une notification sans données exploitables', () => {
    for (const data of [null, undefined, 'texte', [], { url: '/alerts/4' }]) expect(pushTarget(data)).toBeNull();
  });
});

describe('PushProvider', () => {
  it('reste inerte quand la fonction est absente du build', async () => {
    mockEnabled = false;
    notifications.getPermissionsAsync.mockResolvedValue(permission(true));
    await mount();
    expect(push.available).toBe(false);
    expect(await push.enable()).toBe('unsupported');
    expect(mockPost).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("ne demande jamais l'autorisation sans geste de l'utilisateur", async () => {
    await mount();
    await waitFor(() => expect(push.status).toBe('undetermined'));
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("enregistre l'appareil une fois l'autorisation accordée, sans donnée superflue", async () => {
    await mount();
    await waitFor(() => expect(push.status).toBe('undetermined'));
    await act(async () => {
      expect(await push.enable()).toBe('granted');
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/mobile/devices', {
      push_token: 'ExponentPushToken[abcdefghijklmnopqrstuv]', provider: 'expo', platform: 'ios', environment: 'staging', app_version: '1.0.0',
    });
  });

  it("réenregistre au démarrage si l'autorisation est déjà accordée, et retente après un échec réseau", async () => {
    notifications.getPermissionsAsync.mockResolvedValue(permission(true));
    mockPost.mockRejectedValueOnce(new ApiError({ kind: 'network' }));
    await mount();
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    await act(async () => {
      await push.enable();
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
    await act(async () => {
      await push.enable();
    });
    // Déjà enregistré pour ce compte : pas d'appel de plus.
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('signale un refus définitif et un build sans projet de notifications', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(permission(false, false));
    const view = await mount();
    await waitFor(() => expect(push.status).toBe('denied'));
    await view.unmount();

    mockProjectId = undefined;
    await mount();
    await waitFor(() => expect(push.available).toBe(true));
    expect(push.status).toBe('unsupported');
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("ouvre l'écran visé au toucher, et seulement s'il s'agit d'une route interne connue", async () => {
    await mount();
    await waitFor(() => expect(notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const listener = notifications.addNotificationResponseReceivedListener.mock.calls.at(-1)![0];
    const response = (data: unknown) => ({ notification: { request: { content: { data } } } }) as never;
    listener(response({ route: '/alerts/4' }));
    listener(response({ route: 'https://exemple.test' }));
    listener(response({}));
    expect(mockPush.mock.calls).toEqual([['/alerts/4']]);
  });

  it("ouvre l'écran d'une notification qui a lancé l'application", async () => {
    notifications.getLastNotificationResponseAsync.mockResolvedValue({ notification: { request: { content: { data: { route: '/incidents' } } } } } as never);
    await mount();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/incidents'));
  });

  it('ne fait rien hors session', async () => {
    mockUser = null;
    notifications.getPermissionsAsync.mockResolvedValue(permission(true));
    await mount();
    expect(push.available).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
