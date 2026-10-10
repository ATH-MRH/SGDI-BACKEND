import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/errors';
import LoginScreen, { loginErrorMessage } from '@/app/login';
import HomeScreen from '@/app/(tabs)/index';
import ModulesScreen from '@/app/(tabs)/modules';
import ProfileScreen from '@/app/(tabs)/profile';
import ModuleScreen from '@/app/module/[key]';
import ScopeScreen from '@/app/scope';
import type { AuthState } from '@/auth/AuthProvider';
import { BootstrapScreen } from '@/components/BootstrapScreen';
import { LockScreen } from '@/components/LockScreen';
import { ErrorState } from '@/components/ui';
import { MaintenanceScreen, UpdateRequiredScreen } from '@/components/UpdateRequiredScreen';
import { buildScope, type ScopeSelection } from '@/scope/model';

import { makeSite, makeUser } from '../helpers';

const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetScope = jest.fn(async (_selection: ScopeSelection) => undefined);
let mockState: AuthState = { status: 'signedOut' };
let mockSites = [makeSite(1, 'Societe A'), makeSite(2, 'Societe B'), makeSite(5, 'Societe B')];
let mockSaved: ScopeSelection | null = null;
let mockScopeReady = true;
let mockRouteKey = 'ops';
let mockVariant: 'development' | 'staging' | 'production' = 'staging';
let mockStoreUrls: { ios: string | null; android: string | null } = { ios: null, android: null };
let mockCards: { key: string; label: string; value: number | null; tone: string; route: string; state: string }[] = [];

const mockLock = {
  supported: true,
  capability: 'available' as 'available' | 'notEnrolled' | 'unavailable',
  enabled: false,
  locked: false,
  failures: 0,
  enable: jest.fn(async () => 'success'),
  disable: jest.fn(async () => 'success'),
  lockNow: jest.fn(),
  unlock: jest.fn(async () => 'success'),
};

const mockUserOf = () => (mockState.status === 'signedIn' ? mockState.user : null);

jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ state: mockState, signIn: mockSignIn, signOut: mockSignOut, retry: jest.fn() }),
  useCurrentUser: () => mockUserOf(),
}));
jest.mock('@/scope/ScopeProvider', () => ({
  useScope: () => {
    const model = jest.requireActual('@/scope/model');
    return {
      scope: model.buildScope(mockUserOf(), mockSites, mockSaved),
      ready: mockScopeReady,
      setScope: mockSetScope,
      preview: (selection: ScopeSelection) => model.buildScope(mockUserOf(), mockSites, selection),
    };
  },
}));
jest.mock('@/lock/LockProvider', () => ({ useLock: () => mockLock }));
jest.mock('@/features/cockpit/useCockpit', () => ({
  useCockpit: () => ({ cards: mockCards, date: '2026-10-07', isRefreshing: false, refresh: jest.fn() }),
}));
jest.mock('@/config/env', () => ({
  get env() {
    return { variant: mockVariant, apiUrl: 'https://atlas.example.test', features: {}, lockTimeoutMs: 120_000, storeUrls: mockStoreUrls };
  },
  isFeatureEnabled: () => false,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ key: mockRouteKey }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const signIn = (overrides = {}) => {
  mockState = { status: 'signedIn', user: makeUser(overrides) };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { status: 'signedOut' };
  mockSites = [makeSite(1, 'Societe A'), makeSite(2, 'Societe B'), makeSite(5, 'Societe B')];
  mockSaved = null;
  mockScopeReady = true;
  mockRouteKey = 'ops';
  mockVariant = 'staging';
  mockStoreUrls = { ios: null, android: null };
  mockCards = [];
  Object.assign(mockLock, { supported: true, capability: 'available', enabled: false, locked: false, failures: 0 });
  mockLock.enable.mockResolvedValue('success');
  mockLock.disable.mockResolvedValue('success');
  mockLock.unlock.mockResolvedValue('success');
});

describe('écran de connexion', () => {
  it('demande identifiant et mot de passe avant tout appel', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(screen.getByTestId('login-error')).toHaveTextContent('Saisissez votre identifiant et votre mot de passe.');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('transmet les identifiants et affiche le chargement pendant la connexion', async () => {
    let finish: () => void = () => undefined;
    mockSignIn.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-username'), 'ops1');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secret');
    await fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('ops1', 'secret'));
    expect(screen.getByTestId('login-submit').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('login-username').props.editable).toBe(false);
    finish();
  });

  it('affiche une erreur claire, vide et remasque le mot de passe après un refus', async () => {
    mockSignIn.mockRejectedValue(new ApiError({ kind: 'unauthorized', status: 401 }));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-username'), 'ops1');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'faux');
    await fireEvent.press(screen.getByTestId('login-toggle-password'));
    await fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent('Identifiant ou mot de passe incorrect.'),
    );
    expect(screen.getByTestId('login-password').props.value).toBe('');
    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(true);
  });

  it('masque le mot de passe par défaut et permet de l\'afficher', async () => {
    await render(<LoginScreen />);
    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByTestId('login-toggle-password'));
    expect(screen.getByTestId('login-password').props.secureTextEntry).toBe(false);
    expect(screen.getByText('Masquer le mot de passe')).toBeTruthy();
    expect(screen.getByTestId('version-label')).toHaveTextContent(/Version 1\.0\.0 · Build 14/);
  });

  it('formule chaque échec de connexion sans détail technique', () => {
    const cases: [ApiError, string][] = [
      [new ApiError({ kind: 'unauthorized' }), 'Identifiant ou mot de passe incorrect.'],
      [new ApiError({ kind: 'forbidden', serverMessage: 'Module non autorise pour ce compte' }), 'Module non autorise pour ce compte'],
      [new ApiError({ kind: 'forbidden' }), "Ce compte n'est pas autorisé à utiliser l'application."],
      [new ApiError({ kind: 'rate_limited', retryAfterSeconds: 300 }), 'Trop de tentatives. Réessayez dans 5 min.'],
      [new ApiError({ kind: 'network' }), 'Aucune connexion. La connexion à ATLAS nécessite un accès au réseau.'],
      [new ApiError({ kind: 'timeout' }), 'Le serveur ATLAS est indisponible pour le moment. Réessayez dans quelques instants.'],
      [new ApiError({ kind: 'server', status: 500 }), 'Le serveur ATLAS a rencontré une erreur. Réessayez plus tard.'],
      [new ApiError({ kind: 'invalid_response' }), 'Le serveur ATLAS a rencontré une erreur. Réessayez plus tard.'],
    ];
    for (const [error, message] of cases) expect(loginErrorMessage(error)).toBe(message);
    expect(loginErrorMessage(new Error('TypeError: x is undefined at foo.js:12'))).toBe('Une erreur est survenue. Réessayez.');
  });
});

describe('démarrage et erreurs', () => {
  it("l'écran de restauration annonce la reprise de session", async () => {
    await render(<BootstrapScreen />);
    expect(screen.getByTestId('bootstrap-screen')).toBeTruthy();
    expect(screen.getByText('Restauration de votre session…')).toBeTruthy();
  });

  it("propose l'action adaptée à chaque erreur et jamais le texte du serveur", async () => {
    const onRetry = jest.fn();
    const onSignIn = jest.fn();
    const onBack = jest.fn();
    const view = await render(
      <ErrorState error={new ApiError({ kind: 'server', status: 500, correlationId: 'abcdef0123456789' })} onRetry={onRetry} onBack={onBack} />,
    );
    expect(screen.getByText('Le serveur a rencontré une erreur. Réessayez plus tard.')).toBeTruthy();
    expect(screen.getByText('Référence : abcdef01')).toBeTruthy();
    expect(screen.getByTestId('error-retry')).toBeTruthy();
    expect(screen.queryByTestId('error-back')).toBeNull();

    await view.rerender(<ErrorState error={new ApiError({ kind: 'forbidden', serverMessage: 'SELECT * FROM users' })} onRetry={onRetry} onBack={onBack} />);
    expect(screen.getByText("Vous n'avez pas l'autorisation d'effectuer cette action.")).toBeTruthy();
    expect(screen.queryByText(/SELECT/)).toBeNull();
    expect(screen.getByTestId('error-back')).toBeTruthy();
    expect(screen.queryByTestId('error-retry')).toBeNull();

    await view.rerender(<ErrorState error={new ApiError({ kind: 'unauthorized' })} onRetry={onRetry} onSignIn={onSignIn} />);
    expect(screen.getByTestId('error-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('error-retry')).toBeNull();
  });
});

describe('accueil et modules dynamiques', () => {
  it("l'accueil affiche le contexte de travail et permet de le changer s'il y a un choix", async () => {
    signIn({ authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [], effective_modules: ['ops'] });
    await render(<HomeScreen />);
    expect(screen.getByText('Bonjour Agent Ops')).toBeTruthy();
    expect(screen.getByText('Toutes mes sociétés')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-scope'));
    expect(mockPush).toHaveBeenCalledWith('/scope');
  });

  it("l'accueil ne propose aucun choix quand le périmètre est unique", async () => {
    signIn({ authorized_societies: ['Societe A'], authorized_sites: [1] });
    await render(<HomeScreen />);
    expect(screen.getByText('Societe A')).toBeTruthy();
    expect(screen.getByText('Site 1')).toBeTruthy();
    expect(screen.queryByText('Modifier le contexte de travail')).toBeNull();
  });

  it("l'accueil signale l'absence de module", async () => {
    signIn({ effective_modules: [] });
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-no-module')).toBeTruthy();
  });

  it('le menu ne contient que les modules autorisés et ouvre le module choisi', async () => {
    signIn({ effective_modules: ['ops', 'brq'] });
    await render(<ModulesScreen />);
    expect(screen.getByTestId('module-ops')).toBeTruthy();
    expect(screen.getByTestId('module-brq')).toBeTruthy();
    expect(screen.queryByTestId('module-drh')).toBeNull();
    expect(screen.queryByTestId('module-recrute')).toBeNull();
    await fireEvent.press(screen.getByTestId('module-brq'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/module/[key]', params: { key: 'brq' } });
  });

  it('un compte DRH seul ne voit pas OPS, et inversement', async () => {
    signIn({ effective_modules: ['drh'] });
    const view = await render(<ModulesScreen />);
    expect(screen.getByTestId('module-drh')).toBeTruthy();
    expect(screen.queryByTestId('module-ops')).toBeNull();
    signIn({ effective_modules: ['ops'] });
    await view.rerender(<ModulesScreen />);
    expect(screen.getByTestId('module-ops')).toBeTruthy();
    expect(screen.queryByTestId('module-drh')).toBeNull();
  });

  it('affiche « Aucun module » à un compte sans module', async () => {
    signIn({ effective_modules: [] });
    await render(<ModulesScreen />);
    expect(screen.getByTestId('modules-empty')).toBeTruthy();
    expect(screen.getByText('Aucun module')).toBeTruthy();
  });

  it("refuse l'entrée directe dans un module non accordé ou inconnu", async () => {
    signIn({ effective_modules: ['ops'] });
    mockRouteKey = 'drh';
    const view = await render(<ModuleScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    expect(screen.getByText('Accès non autorisé')).toBeTruthy();
    mockRouteKey = 'inconnu';
    await view.rerender(<ModuleScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
  });

  it("un module ne propose que les fonctions que le profil peut ouvrir", async () => {
    signIn({ effective_modules: ['ops'] });
    await render(<ModuleScreen />);
    for (const entry of ['sites', 'attendance', 'incidents', 'abandons']) expect(screen.getByTestId(`entry-${entry}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('entry-sites'));
    expect(mockPush).toHaveBeenCalledWith('/ops/sites');
  });

  it('un compte Pointage seul ne voit pas les abandons, réservés aux profils OPS ou DRH', async () => {
    signIn({ effective_modules: ['pointage'] });
    mockRouteKey = 'pointage';
    await render(<ModuleScreen />);
    expect(screen.getByTestId('entry-attendance')).toBeTruthy();
    expect(screen.queryByTestId('entry-abandons')).toBeNull();
    expect(screen.queryByTestId('entry-sites')).toBeNull();
  });

  it('un module sans fonction mobile affiche « bientôt »', async () => {
    signIn({ effective_modules: ['site_workforce'] });
    mockRouteKey = 'site_workforce';
    await render(<ModuleScreen />);
    expect(screen.getByTestId('module-soon')).toBeTruthy();
  });

  it('le cockpit affiche les indicateurs fournis, leur état et ouvre le détail', async () => {
    signIn({ effective_modules: ['ops'] });
    mockCards = [
      { key: 'present', label: 'cockpit.present', value: 42, tone: 'success', route: '/attendance?status=present', state: 'ready' },
      { key: 'absent', label: 'cockpit.absent', value: null, tone: 'danger', route: '/attendance?status=absent', state: 'error' },
      { key: 'alertsOpen', label: 'cockpit.alertsOpen', value: null, tone: 'warning', route: '/alerts', state: 'loading' },
    ];
    await render(<HomeScreen />);
    expect(screen.getByText('Situation du 07/10/2026')).toBeTruthy();
    expect(screen.getByTestId('kpi-present')).toHaveTextContent(/42/);
    expect(screen.getByTestId('kpi-present').props.accessibilityLabel).toBe('Présents : 42');
    // Une valeur inconnue n'est jamais remplacée par un chiffre.
    expect(screen.getByTestId('kpi-absent')).toHaveTextContent(/—.*Indisponible/);
    expect(screen.getByTestId('kpi-alertsOpen')).not.toHaveTextContent(/\d/);
    await fireEvent.press(screen.getByTestId('kpi-present'));
    expect(mockPush).toHaveBeenCalledWith('/attendance?status=present');
  });

  it("le cockpit le dit quand aucun indicateur n'est disponible pour le profil", async () => {
    signIn({ effective_modules: ['recrute'] });
    await render(<HomeScreen />);
    expect(screen.getByTestId('cockpit-empty')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-grid')).toBeNull();
  });
});

describe('contexte de travail', () => {
  it('propose les sociétés et sites autorisés, et rien d\'autre', async () => {
    signIn({ authorized_societies: ['Societe B'], authorized_sites: [] });
    await render(<ScopeScreen />);
    expect(screen.getByTestId('scope-society-fixed')).toHaveTextContent('Societe B');
    expect(screen.getByTestId('scope-site-2')).toBeTruthy();
    expect(screen.getByTestId('scope-site-5')).toBeTruthy();
    expect(screen.queryByTestId('scope-site-1')).toBeNull();
  });

  it('choisir une société restreint les sites, puis applique le choix', async () => {
    signIn({ authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [] });
    await render(<ScopeScreen />);
    expect(screen.getByTestId('scope-society-all').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('scope-society-Societe B'));
    expect(screen.queryByTestId('scope-site-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('scope-site-5'));
    expect(screen.getByTestId('scope-site-5').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('scope-apply'));
    await waitFor(() => expect(mockSetScope).toHaveBeenCalledWith({ society: 'Societe B', siteId: 5 }));
    expect(mockBack).toHaveBeenCalled();
  });

  it('changer de société abandonne un site qui ne lui appartient pas', async () => {
    signIn({ authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [] });
    mockSaved = { society: 'Societe B', siteId: 5 };
    await render(<ScopeScreen />);
    await fireEvent.press(screen.getByTestId('scope-society-Societe A'));
    await fireEvent.press(screen.getByTestId('scope-apply'));
    await waitFor(() => expect(mockSetScope).toHaveBeenCalledWith({ society: 'Societe A', siteId: null }));
  });

  it("ne demande aucun choix quand il n'y a qu'une possibilité", async () => {
    signIn({ authorized_societies: ['Societe A'], authorized_sites: [1] });
    await render(<ScopeScreen />);
    expect(screen.getByTestId('scope-society-fixed')).toHaveTextContent('Societe A');
    expect(screen.getByTestId('scope-site-fixed')).toHaveTextContent('Site 1');
    expect(screen.queryByTestId('scope-society-all')).toBeNull();
    expect(screen.queryByTestId('scope-site-all')).toBeNull();
  });

  it('nomme un site sans libellé par son numéro et signale un compte sans périmètre', async () => {
    signIn({ authorized_societies: ['Societe A'], authorized_sites: [3, 9] });
    mockSites = [makeSite(3, null, null), makeSite(9, null, null)];
    const view = await render(<ScopeScreen />);
    expect(screen.getByText('Site n° 3')).toBeTruthy();
    signIn({ authorized_societies: [] });
    await view.rerender(<ScopeScreen />);
    expect(screen.getByTestId('scope-none')).toBeTruthy();
  });

  it('attend que le périmètre soit connu', async () => {
    signIn();
    mockScopeReady = false;
    await render(<ScopeScreen />);
    expect(screen.queryByTestId('scope-apply')).toBeNull();
  });
});

describe('profil', () => {
  it('affiche identité, périmètre, modules, version et environnement', async () => {
    signIn({ authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [], effective_modules: ['ops', 'brq'] });
    await render(<ProfileScreen />);
    expect(screen.getAllByText('Agent Ops').length).toBeGreaterThan(0);
    expect(screen.getByText('OPS1')).toBeTruthy();
    expect(screen.getByTestId('profile-societies')).toHaveTextContent(/Societe A, Societe B/);
    expect(screen.getByTestId('profile-sites')).toHaveTextContent(/Site 1, Site 2, Site 5/);
    expect(screen.getByTestId('profile-modules')).toHaveTextContent(/OPS, BRQ/);
    expect(screen.getByTestId('version-label')).toHaveTextContent(/Build 14/);
    expect(screen.getByTestId('profile-environment')).toHaveTextContent('Test');
    expect(screen.queryByText('Lecture seule')).toBeNull();
  });

  it("n'affiche le diagnostic technique qu'en développement", async () => {
    signIn({ effective_modules: ['ops'], authorized_actions: ['read'] });
    const view = await render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-diagnostics')).toBeNull();
    mockVariant = 'production';
    await view.rerender(<ProfileScreen />);
    expect(screen.queryByTestId('profile-diagnostics')).toBeNull();
    expect(screen.getByTestId('profile-environment')).toHaveTextContent('Production');
    mockVariant = 'development';
    await view.rerender(<ProfileScreen />);
    expect(screen.getByTestId('profile-diagnostics')).toHaveTextContent(/atlas\.example\.test/);
  });

  it('se déconnecte', async () => {
    signIn();
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('active le verrouillage biométrique sur demande explicite', async () => {
    signIn();
    await render(<ProfileScreen />);
    expect(screen.getByTestId('profile-lock-switch').props.value).toBe(false);
    expect(screen.queryByTestId('profile-lock-now')).toBeNull();
    await fireEvent(screen.getByTestId('profile-lock-switch'), 'valueChange', true);
    await waitFor(() => expect(mockLock.enable).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('profile-lock-notice')).toBeNull();
  });

  it("explique pourquoi l'activation est impossible sans biométrie configurée", async () => {
    signIn();
    mockLock.capability = 'notEnrolled';
    await render(<ProfileScreen />);
    await fireEvent(screen.getByTestId('profile-lock-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('profile-lock-notice')).toHaveTextContent(/Aucune empreinte ni aucun visage/));
    expect(mockLock.enable).not.toHaveBeenCalled();
  });

  it('signale une vérification refusée et permet de verrouiller quand la fonction est active', async () => {
    signIn();
    mockLock.enabled = true;
    mockLock.disable.mockResolvedValue('failed');
    await render(<ProfileScreen />);
    await fireEvent(screen.getByTestId('profile-lock-switch'), 'valueChange', false);
    await waitFor(() => expect(screen.getByTestId('profile-lock-notice')).toHaveTextContent(/n’a pas abouti/));
    await fireEvent.press(screen.getByTestId('profile-lock-now'));
    expect(mockLock.lockNow).toHaveBeenCalledTimes(1);
  });

  it('masque la section sécurité quand la biométrie est absente du build', async () => {
    signIn();
    mockLock.supported = false;
    await render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-security')).toBeNull();
  });
});

describe('verrouillage', () => {
  it('demande la vérification une seule fois automatiquement', async () => {
    mockLock.unlock.mockResolvedValue('cancelled');
    const view = await render(<LockScreen />);
    await waitFor(() => expect(mockLock.unlock).toHaveBeenCalledTimes(1));
    await view.rerender(<LockScreen />);
    expect(mockLock.unlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ATLAS MOBILE est verrouillé')).toBeTruthy();
    expect(screen.queryByTestId('lock-message')).toBeNull();
  });

  it('explique un refus par un texte, indique les essais restants et permet de réessayer', async () => {
    mockLock.unlock.mockResolvedValue('failed');
    mockLock.failures = 2;
    await render(<LockScreen />);
    await waitFor(() => expect(screen.getByTestId('lock-message')).toHaveTextContent(/Identité non reconnue/));
    expect(screen.getByTestId('lock-message')).toHaveTextContent(/Essais restants avant déconnexion : 3/);
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await waitFor(() => expect(mockLock.unlock).toHaveBeenCalledTimes(2));
  });

  it('permet toujours de revenir à la connexion', async () => {
    mockLock.unlock.mockResolvedValue('unavailable');
    await render(<LockScreen />);
    await waitFor(() => expect(screen.getByTestId('lock-message')).toHaveTextContent(/n’est plus disponible/));
    expect(screen.queryByTestId('lock-unlock')).toBeNull();
    await fireEvent.press(screen.getByTestId('lock-sign-in'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('mise à jour requise', () => {
  it('préfère le lien store annoncé par le serveur', async () => {
    await render(<UpdateRequiredScreen serverStoreUrl="https://apps.apple.com/app/id999" />);
    await fireEvent.press(screen.getByTestId('update-action'));
    expect(jest.requireMock('expo-linking').openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id999');
  });

  it('la maintenance affiche le message du serveur et permet de réessayer', async () => {
    const retry = jest.fn();
    const view = await render(<MaintenanceScreen message="Retour à 14 h." onRetry={retry} />);
    expect(screen.getByText('Retour à 14 h.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('maintenance-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    await view.rerender(<MaintenanceScreen message={null} onRetry={retry} />);
    expect(screen.getByText(/momentanément indisponible/)).toBeTruthy();
  });

  it("n'affiche aucun bouton tant que la fiche store n'existe pas", async () => {
    await render(<UpdateRequiredScreen />);
    expect(screen.getByText('Mise à jour requise')).toBeTruthy();
    expect(screen.getByText('Une nouvelle version de ATLAS MOBILE est nécessaire pour continuer.')).toBeTruthy();
    expect(screen.queryByTestId('update-action')).toBeNull();
    expect(screen.getByTestId('update-unavailable')).toBeTruthy();
  });

  it('ouvre la fiche store quand elle est connue', async () => {
    mockStoreUrls = { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' };
    await render(<UpdateRequiredScreen />);
    await fireEvent.press(screen.getByTestId('update-action'));
    expect(jest.requireMock('expo-linking').openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/(apps\.apple|play\.google)\.com\//));
  });
});

it('le périmètre simulé de ces tests reste celui du modèle réel', () => {
  expect(buildScope(makeUser({ authorized_societies: ['Societe A'], authorized_sites: [] }), mockSites, null).sites).toHaveLength(1);
});
