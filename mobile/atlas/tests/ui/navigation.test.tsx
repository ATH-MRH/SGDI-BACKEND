import * as SecureStore from 'expo-secure-store';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { ApiError } from '@/api/errors';
import { notifySessionRejected } from '@/auth/session';

import { makeSite, makeUser, storedSession } from '../helpers';

const mockLogin = jest.fn();
const mockFetchProfile = jest.fn();
const mockLogout = jest.fn();

jest.mock('@/api/auth', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));
const mockFetchScopeSites = jest.fn();
let mockBiometrics = false;

jest.mock('@/api/scope', () => ({ fetchScopeSites: (...args: unknown[]) => mockFetchScopeSites(...args) }));
jest.mock('@/features/cockpit/useCockpit', () => ({
  useCockpit: () => ({ cards: [], date: null, isRefreshing: false, refresh: jest.fn() }),
}));
jest.mock('@/features/tasks/useTasks', () => ({
  useTasks: () => ({ tasks: [], hasSource: false, isLoading: false, isRefreshing: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  env: {
    variant: 'staging',
    apiUrl: 'https://atlas.example.test',
    features: {},
    lockTimeoutMs: 120_000,
    storeUrls: { ios: null, android: null },
  },
  isFeatureEnabled: (key: string) => key === 'biometrics' && mockBiometrics,
}));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

/** Arborescence réelle de src/app. */
function renderApp() {
  return renderRouter({
    _layout: require('@/app/_layout').default,
    login: require('@/app/login').default,
    '(tabs)/_layout': require('@/app/(tabs)/_layout').default,
    '(tabs)/index': require('@/app/(tabs)/index').default,
    '(tabs)/tasks': require('@/app/(tabs)/tasks').default,
    '(tabs)/alerts': require('@/app/(tabs)/alerts').default,
    '(tabs)/modules': require('@/app/(tabs)/modules').default,
    '(tabs)/profile': require('@/app/(tabs)/profile').default,
    scope: require('@/app/scope').default,
    'module/[key]': require('@/app/module/[key]').default,
    'alerts/[id]': require('@/app/alerts/[id]').default,
    'ops/sites/index': require('@/app/ops/sites/index').default,
    'ops/sites/[id]': require('@/app/ops/sites/[id]').default,
    attendance: require('@/app/attendance').default,
    'abandons/index': require('@/app/abandons/index').default,
    'abandons/new': require('@/app/abandons/new').default,
    'incidents/index': require('@/app/incidents/index').default,
    'incidents/new': require('@/app/incidents/new').default,
    brq: require('@/app/brq').default,
    'drh/employees/index': require('@/app/drh/employees/index').default,
    'drh/employees/[id]': require('@/app/drh/employees/[id]').default,
    'drh/leaves': require('@/app/drh/leaves').default,
    recruitment: require('@/app/recruitment').default,
  });
}

/** La bibliothèque de test du routeur utilise des minuteurs simulés : on les fait avancer. */
async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  store.clear();
  mockLogin.mockReset();
  mockFetchProfile.mockReset();
  mockLogout.mockReset().mockResolvedValue(undefined);
  mockFetchScopeSites.mockReset();
  mockFetchScopeSites.mockResolvedValue([makeSite(3), makeSite(9)]);
  mockBiometrics = false;
});

describe('navigation protégée', () => {
  it("affiche la connexion et aucun écran applicatif sans session", async () => {
    await renderApp();
    await settle();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it("ouvre l'accueil et les cinq onglets avec une session valide", async () => {
    store.set('atlas.session.v1', storedSession());
    mockFetchProfile.mockResolvedValue(makeUser());
    await renderApp();
    await settle();
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.queryByTestId('login-screen')).toBeNull();
    for (const label of ['Accueil', 'Tâches', 'Alertes', 'Modules', 'Profil']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('renvoie à la connexion dès que le backend refuse le jeton', async () => {
    store.set('atlas.session.v1', storedSession());
    mockFetchProfile.mockResolvedValue(makeUser());
    await renderApp();
    await settle();
    expect(screen.getByTestId('home-screen')).toBeTruthy();

    await act(async () => notifySessionRejected());
    await settle();

    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(store.has('atlas.session.v1')).toBe(false);
  });

  it('propose de réessayer quand le serveur est injoignable au démarrage', async () => {
    store.set('atlas.session.v1', storedSession());
    mockFetchProfile.mockRejectedValue(new ApiError({ kind: 'network' }));
    await renderApp();
    await settle();
    expect(screen.getByText('Connexion au serveur impossible')).toBeTruthy();
    expect(screen.getByText('Réessayer')).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it("montre l'écran de restauration, jamais un écran protégé, tant que le backend n'a pas validé la session", async () => {
    store.set('atlas.session.v1', storedSession());
    let answer: (user: unknown) => void = () => undefined;
    mockFetchProfile.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await renderApp();
    await settle();
    expect(screen.getByTestId('bootstrap-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(screen.queryByTestId('login-screen')).toBeNull();

    await act(async () => answer(makeUser()));
    await settle();
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.queryByTestId('bootstrap-screen')).toBeNull();
  });

  it('retourne à la connexion sans appeler le backend quand la session stockée a expiré', async () => {
    store.set('atlas.session.v1', storedSession(Math.floor(Date.now() / 1000) - 60));
    await renderApp();
    await settle();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(mockFetchProfile).not.toHaveBeenCalled();
    expect(store.has('atlas.session.v1')).toBe(false);
  });

  it('permet de se reconnecter quand le serveur reste injoignable', async () => {
    store.set('atlas.session.v1', storedSession());
    mockFetchProfile.mockRejectedValue(new ApiError({ kind: 'timeout' }));
    await renderApp();
    await settle();
    expect(screen.getByTestId('session-unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('error-sign-in'));
    await settle();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(store.has('atlas.session.v1')).toBe(false);
  });

  it('démarre verrouillé quand le verrouillage biométrique est activé : aucun écran protégé avant déverrouillage', async () => {
    mockBiometrics = true;
    store.set('atlas.session.v1', storedSession());
    store.set('atlas.lock.v1', JSON.stringify({ userId: 7, enabled: true }));
    mockFetchProfile.mockResolvedValue(makeUser());
    const biometrics = jest.requireMock('expo-local-authentication');
    biometrics.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await renderApp();
    await settle();
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();

    biometrics.authenticateAsync.mockResolvedValueOnce({ success: true });
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });
});
