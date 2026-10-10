import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ApiError } from '@/api/errors';
import type { AuthState } from '@/auth/AuthProvider';
import HomeScreen from '@/app/(tabs)/index';
import AlertsScreen from '@/app/(tabs)/alerts';
import TasksScreen from '@/app/(tabs)/tasks';
import NewAbandonScreen from '@/app/abandons/new';
import AbandonsScreen from '@/app/abandons/index';
import AlertDetailScreen from '@/app/alerts/[id]';
import AttendanceScreen from '@/app/attendance';
import BrqScreen from '@/app/brq';
import EmployeeDetailScreen from '@/app/drh/employees/[id]';
import EmployeesScreen from '@/app/drh/employees/index';
import LeavesScreen from '@/app/drh/leaves';
import IncidentsScreen from '@/app/incidents/index';
import NewIncidentScreen from '@/app/incidents/new';
import SiteDetailScreen from '@/app/ops/sites/[id]';
import SitesScreen from '@/app/ops/sites/index';
import RecruitmentScreen from '@/app/recruitment';
import type { ScopeSelection } from '@/scope/model';

import { makeSite, makeUser } from '../helpers';

const mock = {
  fetchBoard: jest.fn(),
  fetchAbandonEvents: jest.fn(),
  searchManualEmployees: jest.fn(),
  fetchAbandonContext: jest.fn(),
  declareAbandon: jest.fn(),
  fetchAlerts: jest.fn(),
  fetchAlertStats: jest.fn(),
  fetchAlert: jest.fn(),
  applyAlertAction: jest.fn(),
  fetchSitesPage: jest.fn(),
  fetchSiteDetail: jest.fn(),
  fetchEmployeesPage: jest.fn(),
  fetchEmployee: jest.fn(),
  fetchLeaves: jest.fn(),
  decideLeave: jest.fn(),
  fetchEmployeeDocuments: jest.fn(),
  fetchCandidatesPage: jest.fn(),
  fetchPendingLeavesCount: jest.fn(),
  fetchBrqSituation: jest.fn(),
  fetchIncidents: jest.fn(),
  createIncident: jest.fn(),
};
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockState: AuthState = { status: 'signedOut' };
let mockSaved: ScopeSelection | null = null;
const mockSites = [makeSite(1, 'Societe A', 'Site Nord'), makeSite(2, 'Societe B', 'Site Sud')];
const mockUserOf = () => (mockState.status === 'signedIn' ? mockState.user : null);

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/errors'), api: {} }));
jest.mock('@/api/domains/attendance', () => ({
  ...jest.requireActual('@/api/domains/attendance'),
  fetchBoard: (...a: unknown[]) => mock.fetchBoard(...a),
  fetchAbandonEvents: (...a: unknown[]) => mock.fetchAbandonEvents(...a),
  searchManualEmployees: (...a: unknown[]) => mock.searchManualEmployees(...a),
  fetchAbandonContext: (...a: unknown[]) => mock.fetchAbandonContext(...a),
  declareAbandon: (...a: unknown[]) => mock.declareAbandon(...a),
}));
jest.mock('@/api/domains/alerts', () => ({
  ...jest.requireActual('@/api/domains/alerts'),
  fetchAlerts: (...a: unknown[]) => mock.fetchAlerts(...a),
  fetchAlertStats: (...a: unknown[]) => mock.fetchAlertStats(...a),
  fetchAlert: (...a: unknown[]) => mock.fetchAlert(...a),
  applyAlertAction: (...a: unknown[]) => mock.applyAlertAction(...a),
}));
jest.mock('@/api/domains/ops', () => ({
  ...jest.requireActual('@/api/domains/ops'),
  fetchSitesPage: (...a: unknown[]) => mock.fetchSitesPage(...a),
  fetchSiteDetail: (...a: unknown[]) => mock.fetchSiteDetail(...a),
}));
jest.mock('@/api/domains/drh', () => ({
  ...jest.requireActual('@/api/domains/drh'),
  fetchEmployeesPage: (...a: unknown[]) => mock.fetchEmployeesPage(...a),
  fetchEmployee: (...a: unknown[]) => mock.fetchEmployee(...a),
  fetchLeaves: (...a: unknown[]) => mock.fetchLeaves(...a),
  decideLeave: (...a: unknown[]) => mock.decideLeave(...a),
  fetchEmployeeDocuments: (...a: unknown[]) => mock.fetchEmployeeDocuments(...a),
  fetchCandidatesPage: (...a: unknown[]) => mock.fetchCandidatesPage(...a),
  fetchPendingLeavesCount: (...a: unknown[]) => mock.fetchPendingLeavesCount(...a),
}));
jest.mock('@/api/domains/brq', () => ({ fetchBrqSituation: (...a: unknown[]) => mock.fetchBrqSituation(...a) }));
jest.mock('@/api/domains/incidents', () => ({
  ...jest.requireActual('@/api/domains/incidents'),
  fetchIncidents: (...a: unknown[]) => mock.fetchIncidents(...a),
  createIncident: (...a: unknown[]) => mock.createIncident(...a),
}));
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ state: mockState, signOut: jest.fn() }),
  useCurrentUser: () => mockUserOf(),
}));
jest.mock('@/scope/ScopeProvider', () => ({
  useScope: () => {
    const model = jest.requireActual('@/scope/model');
    return { scope: model.buildScope(mockUserOf(), mockSites, mockSaved), ready: true, setScope: jest.fn(), preview: jest.fn() };
  },
}));
jest.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, page_size: 25, pages: 1 });
const kpi = { expected: 12, present: 9, absent: 2, not_pointed: 1, late: 0, conge: 0, maladie: 0, repos: 0, anomalies: 0, incomplete: 0 };
const board = (items: unknown[] = []) => ({ date: '2026-10-07', kpi, total: items.length, page: 1, pages: 1, page_size: 25, items });
const alert = (overrides = {}) => ({
  id: 4, ruleKey: 'r', society: 'Societe A', siteId: 1, status: 'open', severity: 'critical', title: 'Abandon de poste', summary: 'Départ anticipé',
  lastDetectedAt: '2026-10-07T15:31:00', occurrenceCount: 1, assignedUserId: null, explanation: null, history: [], ...overrides,
});
const leave = (overrides = {}) => ({ id: 7, employeeId: 5, type: 'conge', startDate: '2026-10-10', endDate: '2026-10-12', reason: 'Famille', status: 'instance', createdAt: '2026-10-01', ...overrides });
const context = (overrides = {}) => ({
  shiftId: 77, employeeId: 5, employeeName: 'BENALI Karim', matricule: 'AGT005', society: 'Societe A', siteId: 1, siteName: 'Site Nord', position: 'Agent',
  scheduledStartAt: '2026-10-07T07:00:00+01:00', scheduledEndAt: '2026-10-07T19:00:00+01:00', departureAt: '2026-10-07T16:30:00+01:00',
  remainingMinutes: 150, thresholdMinutes: 60, applicable: true, ...overrides,
});

function signIn(modules: string[], actions: string[] = [], overrides = {}) {
  mockState = {
    status: 'signedIn',
    user: makeUser({ effective_modules: modules, authorized_actions: actions as never, authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [], ...overrides }),
  };
}

async function show(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset();
  jest.clearAllMocks();
  mockParams = {};
  mockSaved = null;
  mockState = { status: 'signedOut' };
  mock.fetchBoard.mockResolvedValue(board());
  mock.fetchAbandonEvents.mockResolvedValue({ total: 1, page: 1, items: [] });
  mock.fetchAlertStats.mockResolvedValue({ totalOpen: 5, critical: 1, unacknowledged: 3, assignedToMe: 0 });
  mock.fetchPendingLeavesCount.mockResolvedValue(4);
  mock.fetchAlerts.mockResolvedValue(page([alert()]));
  mock.fetchLeaves.mockResolvedValue([leave()]);
});

describe('cockpit', () => {
  it('un profil OPS voit ses indicateurs, calculés par le backend sur son contexte', async () => {
    signIn(['ops']);
    mockSaved = { society: 'Societe A', siteId: 1 };
    await show(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-present')).toHaveTextContent(/9/));
    expect(screen.getByTestId('kpi-expected')).toHaveTextContent(/12/);
    expect(screen.getByTestId('kpi-notPointed')).toHaveTextContent(/1/);
    expect(screen.getByTestId('kpi-abandons')).toHaveTextContent(/1/);
    expect(screen.getByTestId('kpi-alertsCritical')).toHaveTextContent(/1/);
    expect(mock.fetchBoard).toHaveBeenCalledWith({}, { society: 'Societe A', site_id: 1, page_size: 1 });
    // Aucun indicateur d'un domaine non autorisé, et aucun appel pour lui.
    expect(screen.queryByTestId('kpi-leaves')).toBeNull();
    expect(mock.fetchPendingLeavesCount).not.toHaveBeenCalled();
  });

  it('un profil DRH voit les congés à valider ; un profil BRQ ne voit aucun indicateur interdit', async () => {
    signIn(['drh']);
    const view = await show(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-leaves')).toHaveTextContent(/4/));
    await view.unmount();

    for (const fn of Object.values(mock)) fn.mockClear();
    signIn(['brq']);
    await show(<HomeScreen />);
    expect(screen.getByTestId('cockpit-empty')).toBeTruthy();
    expect(mock.fetchBoard).not.toHaveBeenCalled();
    expect(mock.fetchAlertStats).not.toHaveBeenCalled();
  });

  it("affiche « indisponible » plutôt qu'un chiffre quand un indicateur échoue", async () => {
    signIn(['ops']);
    mock.fetchBoard.mockRejectedValue(new ApiError({ kind: 'server', status: 500 }));
    await show(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('kpi-present')).toHaveTextContent(/Indisponible/));
    expect(screen.getByTestId('kpi-present')).not.toHaveTextContent(/\d/);
    await waitFor(() => expect(screen.getByTestId('kpi-alertsOpen')).toHaveTextContent(/5/));
  });
});

describe('mes tâches', () => {
  it('liste les alertes et congés à traiter et ouvre leur objet', async () => {
    signIn(['ops', 'drh'], ['read', 'update', 'validate']);
    await show(<TasksScreen />);
    await waitFor(() => expect(screen.getByTestId('task-alert-4')).toBeTruthy());
    expect(screen.getByTestId('task-leave-7')).toBeTruthy();
    expect(screen.getByText('Critique')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('task-alert-4'));
    expect(mockPush).toHaveBeenCalledWith('/alerts/4');
  });

  it("n'interroge rien pour un profil qui ne peut rien traiter", async () => {
    signIn(['ops']);
    await show(<TasksScreen />);
    expect(screen.getByTestId('tasks-no-source')).toBeTruthy();
    expect(mock.fetchAlerts).not.toHaveBeenCalled();
    expect(mock.fetchLeaves).not.toHaveBeenCalled();
  });

  it('dit clairement quand il ne reste rien à faire', async () => {
    signIn(['ops'], ['update']);
    mock.fetchAlerts.mockResolvedValue(page([]));
    await show(<TasksScreen />);
    await waitFor(() => expect(screen.getByTestId('tasks-empty')).toBeTruthy());
  });
});

describe('alertes', () => {
  it('filtre côté serveur sur le contexte courant', async () => {
    signIn(['ops']);
    mockSaved = { society: 'Societe A', siteId: null };
    await show(<AlertsScreen />);
    await waitFor(() => expect(screen.getByTestId('alert-4')).toBeTruthy());
    expect(mock.fetchAlerts).toHaveBeenLastCalledWith({}, { society: 'Societe A', site_id: undefined, status: 'open', severity: undefined, page: 1 });
    await fireEvent.press(screen.getByTestId('alerts-filter-critical'));
    await waitFor(() => expect(mock.fetchAlerts).toHaveBeenLastCalledWith({}, expect.objectContaining({ status: undefined, severity: 'critical' })));
  });

  it("n'appelle rien pour un profil sans accès aux alertes", async () => {
    signIn(['brq']);
    await show(<AlertsScreen />);
    expect(screen.getByTestId('alerts-no-access')).toBeTruthy();
    expect(mock.fetchAlerts).not.toHaveBeenCalled();
  });

  it("ne propose aucune action sans droit explicite", async () => {
    signIn(['ops'], ['read']);
    mockParams = { id: '4' };
    mock.fetchAlert.mockResolvedValue(alert());
    await show(<AlertDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('alert-status')).toHaveTextContent('Ouverte'));
    expect(screen.getByTestId('alert-severity')).toHaveTextContent('Critique');
    expect(screen.queryByTestId('alert-acknowledge')).toBeNull();
    expect(screen.queryByTestId('alert-treated')).toBeNull();
  });

  it('demande confirmation puis transmet la transition au backend', async () => {
    signIn(['ops'], ['update']);
    mockParams = { id: '4' };
    mock.fetchAlert.mockResolvedValue(alert());
    mock.applyAlertAction.mockResolvedValue(alert({ status: 'treated' }));
    await show(<AlertDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('alert-treated')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('alert-treated'));
    expect(mock.applyAlertAction).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('alert-confirm-confirm'));
    await waitFor(() => expect(mock.applyAlertAction).toHaveBeenCalledWith({}, 4, 'treated'));
  });

  it('affiche le refus du backend et masque les actions sur une alerte close', async () => {
    signIn(['ops'], ['update']);
    mockParams = { id: '4' };
    mock.fetchAlert.mockResolvedValue(alert());
    mock.applyAlertAction.mockRejectedValue(new ApiError({ kind: 'conflict', status: 409, serverMessage: 'Transition refusée : treated -> acknowledged' }));
    const view = await show(<AlertDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('alert-acknowledge')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('alert-acknowledge'));
    await fireEvent.press(screen.getByTestId('alert-confirm-confirm'));
    await waitFor(() => expect(screen.getByTestId('alert-action-error')).toHaveTextContent(/Transition refusée/));
    await view.unmount();

    mock.fetchAlert.mockResolvedValue(alert({ status: 'treated' }));
    await show(<AlertDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('alert-status')).toHaveTextContent('Traitée'));
    expect(screen.queryByTestId('alert-treated')).toBeNull();
  });

  it("refuse un identifiant d'alerte invalide sans appeler le backend", async () => {
    signIn(['ops']);
    mockParams = { id: '../../auth/users' };
    await show(<AlertDetailScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    expect(mock.fetchAlert).not.toHaveBeenCalled();
  });
});

describe('abandon de poste', () => {
  const employee = { id: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', society: 'Societe A', site: 'Site Nord' };

  it('liste les abandons et ne propose la déclaration qu\'aux profils autorisés', async () => {
    signIn(['ops'], ['create']);
    mock.fetchAbandonEvents.mockResolvedValue({ total: 1, page: 1, items: [{
      eventId: 9, employeeId: 5, employeeName: 'BENALI Karim', matricule: 'AGT005', society: 'Societe A', siteId: 1, siteName: 'Site Nord', position: 'Agent',
      scheduledStartAt: null, scheduledEndAt: '2026-10-07T19:00:00+01:00', departureAt: '2026-10-07T16:30:00+01:00', remainingMinutes: 150, observation: 'Parti sans prévenir', recordedBy: 'OPS1', createdAt: '',
    }] });
    await show(<AbandonsScreen />);
    await waitFor(() => expect(screen.getByTestId('abandon-9')).toHaveTextContent(/BENALI Karim/));
    expect(screen.getByTestId('abandon-9')).toHaveTextContent(/fin prévue 19:00 · restait 2 h 30/);
    expect(screen.getByTestId('abandon-9')).toHaveTextContent(/Déclaré par OPS1/);
    // OPS sans module pointage : consultation, pas de déclaration.
    expect(screen.queryByTestId('abandon-new')).toBeNull();
  });

  it('déclare un abandon quand le backend le juge applicable, après confirmation', async () => {
    signIn(['pointage', 'ops'], ['create']);
    mock.searchManualEmployees.mockResolvedValue([employee]);
    mock.fetchAbandonContext.mockResolvedValue(context());
    mock.declareAbandon.mockResolvedValue({ eventId: 9, duplicate: false });
    await show(<NewAbandonScreen />);
    await fireEvent.changeText(screen.getByTestId('abandon-search'), 'ben');
    await waitFor(() => expect(screen.getByTestId('abandon-employee-5')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('abandon-employee-5'));
    await waitFor(() => expect(screen.getByTestId('abandon-applicable')).toHaveTextContent('Abandon de poste déclarable'));
    expect(screen.getByTestId('abandon-context')).toHaveTextContent(/07:00 – 19:00/);
    expect(screen.getByTestId('abandon-context')).toHaveTextContent(/2 h 30/);

    // Motif obligatoire.
    expect(screen.getByTestId('abandon-submit').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('abandon-observation'), 'Parti sans prévenir');
    await fireEvent.press(screen.getByTestId('abandon-submit'));
    expect(mock.declareAbandon).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('abandon-confirm-confirm'));
    await waitFor(() => expect(mock.declareAbandon).toHaveBeenCalledWith({}, expect.objectContaining({ employeeId: 5, siteId: 1, shiftId: 77 }), 'Parti sans prévenir'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("ne permet pas de déclarer quand le backend dit que la règle n'est pas remplie", async () => {
    signIn(['pointage'], ['create']);
    mock.searchManualEmployees.mockResolvedValue([employee]);
    mock.fetchAbandonContext.mockResolvedValue(context({ applicable: false, remainingMinutes: 30 }));
    await show(<NewAbandonScreen />);
    await fireEvent.changeText(screen.getByTestId('abandon-search'), 'ben');
    await waitFor(() => expect(screen.getByTestId('abandon-employee-5')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('abandon-employee-5'));
    await waitFor(() => expect(screen.getByTestId('abandon-applicable')).toHaveTextContent(/Non déclarable : il reste moins de 60 min/));
    expect(screen.queryByTestId('abandon-observation')).toBeNull();
    expect(screen.getByTestId('abandon-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('relaie le refus métier du backend (pas de prise de service, droit manquant)', async () => {
    signIn(['pointage'], ['create']);
    mock.searchManualEmployees.mockResolvedValue([employee]);
    mock.fetchAbandonContext.mockRejectedValue(new ApiError({ kind: 'conflict', status: 409, serverMessage: 'Abandon de poste refusé : aucune prise de service ouverte' }));
    await show(<NewAbandonScreen />);
    await fireEvent.changeText(screen.getByTestId('abandon-search'), 'ben');
    await waitFor(() => expect(screen.getByTestId('abandon-employee-5')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('abandon-employee-5'));
    await waitFor(() => expect(screen.getByTestId('abandon-context-refused')).toHaveTextContent(/aucune prise de service ouverte/));
    expect(screen.queryByTestId('abandon-submit')).toBeNull();
  });

  it("refuse l'écran de déclaration à un profil sans droit de création", async () => {
    signIn(['pointage']);
    await show(<NewAbandonScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    expect(mock.searchManualEmployees).not.toHaveBeenCalled();
  });
});

describe('incidents', () => {
  it('liste les incidents du contexte et réserve la déclaration au droit de création', async () => {
    signIn(['ops']);
    mockSaved = { society: 'Societe A', siteId: null };
    mock.fetchIncidents.mockResolvedValue([
      { id: 1, date: '2026-10-07', time: '14:05', siteId: 1, type: 'vol', severity: 'elevee', subject: 'Vol de matériel', description: 'Constat', status: 'ouvert', society: 'Societe A' },
      { id: 2, date: '2026-10-06', time: '', siteId: 2, type: 'autre', severity: '', subject: 'Autre société', description: '', status: 'ouvert', society: 'Societe B' },
      { id: 3, date: '2026-10-06', time: '', siteId: null, type: 'autre', severity: '', subject: 'Hors périmètre', description: '', status: 'ouvert', society: 'Societe Z' },
    ]);
    await show(<IncidentsScreen />);
    await waitFor(() => expect(screen.getByTestId('incident-1')).toHaveTextContent(/Vol de matériel/));
    expect(screen.getByTestId('incident-1')).toHaveTextContent(/Vol · 07\/10\/2026 · 14:05 · Site Nord/);
    expect(screen.queryByTestId('incident-2')).toBeNull();
    expect(screen.queryByTestId('incident-3')).toBeNull();
    expect(screen.queryByTestId('incident-new')).toBeNull();
  });

  it('contrôle la saisie puis crée l\'incident avec la société du site choisi', async () => {
    signIn(['ops'], ['create']);
    mock.createIncident.mockResolvedValue({ id: 12 });
    await show(<NewIncidentScreen />);
    await fireEvent.press(screen.getByTestId('incident-submit'));
    expect(screen.getByTestId('incident-error-site')).toBeTruthy();
    expect(screen.getAllByText('Champ obligatoire.').length).toBe(3);
    expect(mock.createIncident).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('incident-site-2'));
    await fireEvent.press(screen.getByTestId('incident-type-vol'));
    await fireEvent.press(screen.getByTestId('incident-severity-critique'));
    await fireEvent.changeText(screen.getByTestId('incident-subject'), 'Vol de matériel');
    await fireEvent.changeText(screen.getByTestId('incident-description'), 'Constat à 14 h.');
    await fireEvent.press(screen.getByTestId('incident-submit'));
    await waitFor(() =>
      expect(mock.createIncident).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ siteId: 2, society: 'Societe B', type: 'vol', severity: 'critique', subject: 'Vol de matériel', description: 'Constat à 14 h.' }),
        expect.stringMatching(/^mobile-[0-9a-f]{32}$/),
      ),
    );
    expect(mock.createIncident.mock.calls[0]![1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('affiche le refus du backend et interdit l\'écran sans droit de création', async () => {
    signIn(['ops'], ['create'], { authorized_societies: ['Societe A'] });
    mock.createIncident.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Société non autorisée pour cet utilisateur' }));
    const view = await show(<NewIncidentScreen />);
    // Un seul site dans le périmètre : présélectionné, et le site de l'autre société n'est pas proposé.
    expect(screen.queryByTestId('incident-site-2')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('incident-subject'), 'Objet');
    await fireEvent.changeText(screen.getByTestId('incident-description'), 'Description');
    await fireEvent.press(screen.getByTestId('incident-submit'));
    await waitFor(() => expect(screen.getByTestId('incident-submit-error')).toHaveTextContent(/Société non autorisée/));
    await view.unmount();

    signIn(['ops'], ['read']);
    await show(<NewIncidentScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
  });
});

describe('OPS — sites et pointage', () => {
  it('recherche les sites côté serveur dans la société du contexte', async () => {
    signIn(['ops']);
    mockSaved = { society: 'Societe B', siteId: null };
    mock.fetchSitesPage.mockResolvedValue(page([{ id: 2, name: 'Site Sud', client: 'Client Y', commune: 'Oran', wilaya: 'Oran', society: 'Societe B' }]));
    await show(<SitesScreen />);
    await waitFor(() => expect(screen.getByTestId('site-2')).toHaveTextContent(/Site Sud/));
    await fireEvent.changeText(screen.getByTestId('sites-search'), 'sud');
    await waitFor(() => expect(mock.fetchSitesPage).toHaveBeenLastCalledWith({}, { q: 'sud', society: 'Societe B', page: 1 }));
    await fireEvent.press(screen.getByTestId('site-2'));
    expect(mockPush).toHaveBeenCalledWith('/ops/sites/2');
  });

  it('affiche le détail du site avec ses effectifs', async () => {
    signIn(['ops']);
    mockParams = { id: '1' };
    mock.fetchSiteDetail.mockResolvedValue({
      site: { id: 1, name: 'Site Nord', client: 'Client X', address: null, commune: 'Hydra', wilaya: 'Alger', society: 'Societe A' },
      contractualStaff: 12, realizedStaff: 10, missingStaff: 2, surplusStaff: 0,
      agents: [{ assignmentId: 1, employeeId: 5, code: 'AGT005', name: 'BENALI Karim', position: 'Agent', group: 'A' }],
    });
    await show(<SiteDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('site-missing')).toHaveTextContent(/2/));
    expect(screen.getByText('BENALI Karim')).toBeTruthy();
    expect(screen.getByText('Agents affectés (1)')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('site-today')).toHaveTextContent(/9/));
    expect(mock.fetchBoard).toHaveBeenCalledWith({}, { site_id: 1, page_size: 1 });
  });

  it('un site hors périmètre est refusé par le backend et rien n\'est affiché', async () => {
    signIn(['ops']);
    mockParams = { id: '999' };
    mock.fetchSiteDetail.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Site non autorisé' }));
    await show(<SiteDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('site-error')).toBeTruthy());
    expect(screen.getByTestId('error-back')).toBeTruthy();
    expect(screen.queryByTestId('site-missing')).toBeNull();
  });

  it("le pointage ignore un site passé par lien s'il n'est pas dans le périmètre", async () => {
    signIn(['pointage'], [], { authorized_societies: ['Societe A'] });
    mockParams = { site_id: '2', status: 'absent' };
    mock.fetchBoard.mockResolvedValue(board([{ employeeId: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', society: 'Societe A', siteId: 1, site: 'Site Nord', status: 'absent', arrival: '', departure: '', plannedStart: null, plannedEnd: null, anomalies: [] }]));
    await show(<AttendanceScreen />);
    await waitFor(() => expect(screen.getByTestId('attendance-5')).toBeTruthy());
    // Le libellé figure aussi dans le filtre : on vérifie le badge de la ligne.
    expect(screen.getByTestId('attendance-5')).toHaveTextContent(/Absent/);
    const query = mock.fetchBoard.mock.calls.at(-1)![1];
    expect(query.site_id).toBeUndefined();
    expect(query.status).toBe('absent');
    expect(query.society).toBe('Societe A');
  });
});

describe('BRQ', () => {
  it('affiche la situation du jour en sections', async () => {
    signIn(['brq']);
    const item = (key: string, state: string) => ({ key, employeeId: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', site: 'Site Nord', wilaya: 'Alger', state, arrival: '', departure: '', exitDate: null });
    mock.fetchBrqSituation.mockResolvedValue({
      date: '2026-10-07',
      kpis: { expected: 12, present: 9, absent: 2, notPointed: 1, abandons: 1, leaving: 0, available: 9, coveragePct: 75, gap: -3 },
      absences: [item('a', 'absent')], abandons: [item('b', 'abandon_poste')], leaving: [], notes: [],
    });
    await show(<BrqScreen />);
    await waitFor(() => expect(screen.getByTestId('brq-coverage')).toHaveTextContent(/75 %/));
    expect(screen.getByTestId('brq-item-a')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('brq-tab-abandons'));
    expect(screen.getByTestId('brq-item-b')).toHaveTextContent(/Abandon de poste/);
    await fireEvent.press(screen.getByTestId('brq-tab-leaving'));
    expect(screen.getByTestId('brq-empty')).toBeTruthy();
  });

  it('est refusé à un profil sans le module BRQ', async () => {
    signIn(['ops']);
    await show(<BrqScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    expect(mock.fetchBrqSituation).not.toHaveBeenCalled();
  });
});

describe('DRH', () => {
  const employee = { id: 5, code: 'AGT005', firstName: 'Karim', lastName: 'BENALI', position: 'Agent', society: 'Societe A', status: 'actif', contractType: 'CDD', recruitDate: '2025-01-15', contractEndDate: null, phone: null, email: null, siteId: 1, siteName: 'Site Nord', group: 'A' };

  it('recherche et pagine les employés côté serveur', async () => {
    signIn(['drh']);
    mock.fetchEmployeesPage.mockResolvedValue(page([employee]));
    await show(<EmployeesScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-5')).toHaveTextContent(/BENALI Karim/));
    expect(mock.fetchEmployeesPage).toHaveBeenLastCalledWith({}, { q: undefined, mode: 'actifs', society: undefined, page: 1 });
    await fireEvent.changeText(screen.getByTestId('employees-search'), 'ben');
    await fireEvent.press(screen.getByTestId('employees-mode-sortants'));
    await waitFor(() => expect(mock.fetchEmployeesPage).toHaveBeenLastCalledWith({}, { q: 'ben', mode: 'sortants', society: undefined, page: 1 }));
  });

  it('charge la fiche puis ses sous-sections, et rien si la fiche est refusée', async () => {
    signIn(['drh']);
    mockParams = { id: '5' };
    mock.fetchEmployee.mockResolvedValue(employee);
    mock.fetchEmployeeDocuments.mockResolvedValue([{ id: 1, label: 'Contrat', fileName: 'contrat.pdf', mimeType: 'application/pdf', createdAt: '2025-01-15T10:00:00' }]);
    const view = await show(<EmployeeDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-status')).toHaveTextContent('actif'));
    await waitFor(() => expect(screen.getByTestId('employee-documents')).toHaveTextContent(/Contrat/));
    expect(screen.getByTestId('employee-leaves')).toHaveTextContent(/10\/10\/2026 – 12\/10\/2026/);
    await view.unmount();

    for (const fn of Object.values(mock)) fn.mockClear();
    mock.fetchEmployee.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Société non autorisée' }));
    await show(<EmployeeDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-error')).toBeTruthy());
    expect(mock.fetchLeaves).not.toHaveBeenCalled();
    expect(mock.fetchEmployeeDocuments).not.toHaveBeenCalled();
  });

  it("ne propose d'approuver ou de refuser un congé qu'avec le droit de validation", async () => {
    signIn(['conges'], ['read']);
    const view = await show(<LeavesScreen />);
    await waitFor(() => expect(screen.getByTestId('leave-7')).toBeTruthy());
    expect(screen.queryByTestId('leave-approve-7')).toBeNull();
    await view.unmount();

    signIn(['conges'], ['validate']);
    mock.decideLeave.mockResolvedValue(leave({ status: 'approuve' }));
    await show(<LeavesScreen />);
    await waitFor(() => expect(screen.getByTestId('leave-approve-7')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('leave-refuse-7'));
    expect(screen.getByText('Refuser cette demande de congé ?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leave-confirm-cancel'));
    expect(mock.decideLeave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('leave-approve-7'));
    await fireEvent.press(screen.getByTestId('leave-confirm-confirm'));
    await waitFor(() => expect(mock.decideLeave).toHaveBeenCalledWith({}, 7, 'approve'));
  });

  it('affiche le refus du backend sur une décision de congé', async () => {
    signIn(['drh'], ['validate']);
    mock.decideLeave.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: "Action 'validate' requise pour approuver ou refuser un congé" }));
    await show(<LeavesScreen />);
    await waitFor(() => expect(screen.getByTestId('leave-approve-7')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('leave-approve-7'));
    await fireEvent.press(screen.getByTestId('leave-confirm-confirm'));
    await waitFor(() => expect(screen.getByTestId('leaves-error')).toHaveTextContent(/Action 'validate' requise/));
  });

  it('liste les candidats en consultation pour un profil recrutement', async () => {
    signIn(['recrute']);
    mock.fetchCandidatesPage.mockResolvedValue(page([{ id: 2, firstName: 'Lina', lastName: 'SAADI', desiredPosition: 'Agent', society: null, status: 'nouvelle', createdAt: '2026-10-01T10:00:00' }]));
    await show(<RecruitmentScreen />);
    await waitFor(() => expect(screen.getByTestId('candidate-2')).toHaveTextContent(/SAADI Lina/));
    expect(mock.fetchCandidatesPage).toHaveBeenLastCalledWith({}, { q: undefined, mode: 'new', page: 1 });
  });
});
