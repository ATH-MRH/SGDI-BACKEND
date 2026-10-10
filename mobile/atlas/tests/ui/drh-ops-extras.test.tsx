import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ApiError } from '@/api/errors';
import { validateLeave } from '@/api/domains/drh';
import EmployeeDetailScreen from '@/app/drh/employees/[id]';
import LeaveRequestScreen from '@/app/drh/leave-request';
import SiteDetailScreen from '@/app/ops/sites/[id]';
import { localDate, parseDateInput } from '@/utils/format';

import { makeUser } from '../helpers';

const mock = {
  fetchEmployee: jest.fn(), fetchLeaves: jest.fn(), fetchEmployeeDocuments: jest.fn(), createLeave: jest.fn(),
  fetchEmployeeAttendance: jest.fn(), fetchBoard: jest.fn(), fetchSiteDetail: jest.fn(), fetchSitePlanning: jest.fn(),
};
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockUser: ReturnType<typeof makeUser> | null = null;

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/errors'), api: {} }));
jest.mock('@/api/domains/drh', () => ({
  ...jest.requireActual('@/api/domains/drh'),
  fetchEmployee: (...a: unknown[]) => mock.fetchEmployee(...a),
  fetchLeaves: (...a: unknown[]) => mock.fetchLeaves(...a),
  fetchEmployeeDocuments: (...a: unknown[]) => mock.fetchEmployeeDocuments(...a),
  createLeave: (...a: unknown[]) => mock.createLeave(...a),
}));
jest.mock('@/api/domains/attendance', () => ({
  ...jest.requireActual('@/api/domains/attendance'),
  fetchEmployeeAttendance: (...a: unknown[]) => mock.fetchEmployeeAttendance(...a),
  fetchBoard: (...a: unknown[]) => mock.fetchBoard(...a),
}));
jest.mock('@/api/domains/ops', () => ({
  ...jest.requireActual('@/api/domains/ops'),
  fetchSiteDetail: (...a: unknown[]) => mock.fetchSiteDetail(...a),
  fetchSitePlanning: (...a: unknown[]) => mock.fetchSitePlanning(...a),
}));
jest.mock('@/auth/AuthProvider', () => ({ useCurrentUser: () => mockUser }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }), useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const employee = {
  id: 5, code: 'AGT005', firstName: 'Karim', lastName: 'BENALI', position: 'Agent', society: 'Societe A', status: 'actif', contractType: 'CDD',
  recruitDate: '2025-01-02', contractEndDate: null, phone: null, email: null, siteId: 1, siteName: 'Site Nord', group: 'A',
};

function signIn(modules: string[], actions: string[] = []) {
  mockUser = makeUser({ effective_modules: modules, authorized_actions: actions as never });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mockPush.mockReset();
  mockBack.mockReset();
  mock.fetchEmployee.mockResolvedValue(employee);
  mock.fetchLeaves.mockResolvedValue([]);
  mock.fetchEmployeeDocuments.mockResolvedValue([]);
});

describe('saisie de dates', () => {
  it('convertit une date saisie et refuse une date inexistante', () => {
    expect(parseDateInput('07/10/2026')).toBe('2026-10-07');
    expect(parseDateInput(' 7-1-2026 ')).toBe('2026-01-07');
    for (const value of ['31/02/2026', '00/10/2026', '10/13/2026', '2026-10-07', 'demain', '']) expect(parseDateInput(value)).toBeNull();
  });

  it('calcule une date locale décalée, y compris en fin de mois', () => {
    expect(localDate(0, new Date(2026, 9, 8, 23, 30))).toBe('2026-10-08');
    expect(localDate(6, new Date(2026, 9, 28))).toBe('2026-11-03');
  });

  it('contrôle une demande de congé', () => {
    expect(validateLeave({ startDate: '2026-10-10', endDate: '2026-10-12', reason: '' })).toEqual({});
    expect(validateLeave({ startDate: '2026-10-10', endDate: '2026-10-10', reason: '' })).toEqual({});
    expect(validateLeave({ startDate: '', endDate: 'x', reason: '' })).toEqual({ startDate: 'required', endDate: 'invalid' });
    expect(validateLeave({ startDate: '2026-10-12', endDate: '2026-10-10', reason: '' })).toEqual({ endDate: 'order' });
    expect(validateLeave({ startDate: '2026-01-01', endDate: '2028-01-01', reason: 'x'.repeat(501) })).toEqual({ endDate: 'invalid', reason: 'tooLong' });
  });
});

describe('fiche employé — pointage et demande de congé', () => {
  it('affiche les pointages récents quand le compte a accès au pointage', async () => {
    signIn(['drh']);
    mockParams = { id: '5' };
    mock.fetchEmployeeAttendance.mockResolvedValue([{ id: 9, date: '2026-10-07', status: 'present', site: 'Site Nord', arrival: '07:02', departure: '' }]);
    await show(<EmployeeDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-attendance')).toHaveTextContent(/07\/10\/2026/));
    expect(screen.getByTestId('employee-attendance')).toHaveTextContent(/Arrivée 07:02/);
    expect(mock.fetchEmployeeAttendance).toHaveBeenCalledWith({}, 5);
    // Consultation seule : pas de dépôt de demande sans droit de création.
    expect(screen.queryByTestId('employee-leave-new')).toBeNull();
  });

  it('une section en erreur ne masque pas la fiche', async () => {
    signIn(['drh']);
    mockParams = { id: '5' };
    mock.fetchEmployeeAttendance.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    await show(<EmployeeDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-attendance')).toHaveTextContent(/indisponible/i));
    expect(screen.getByText('BENALI Karim')).toBeTruthy();
  });

  it('propose le dépôt d\'une demande avec le droit de création', async () => {
    signIn(['drh'], ['read', 'create']);
    mockParams = { id: '5' };
    mock.fetchEmployeeAttendance.mockResolvedValue([]);
    await show(<EmployeeDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('employee-leave-new')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('employee-leave-new'));
    expect(mockPush).toHaveBeenCalledWith('/drh/leave-request?employee_id=5');
  });
});

describe('demande de congé', () => {
  it('refuse l\'écran sans droit de création ou sans employé valide', async () => {
    signIn(['drh'], ['read']);
    mockParams = { employee_id: '5' };
    const view = await show(<LeaveRequestScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    await view.unmount();

    signIn(['drh'], ['create']);
    mockParams = { employee_id: 'abc' };
    await show(<LeaveRequestScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
  });

  it('contrôle les dates puis dépose la demande, sans jamais fixer son statut', async () => {
    signIn(['conges'], ['create']);
    mockParams = { employee_id: '5' };
    mock.createLeave.mockResolvedValue({ id: 1 });
    await show(<LeaveRequestScreen />);

    await fireEvent.press(screen.getByTestId('leave-submit'));
    expect(screen.getAllByText('Champ obligatoire.').length).toBe(2);
    await fireEvent.changeText(screen.getByTestId('leave-start'), '12/10/2026');
    await fireEvent.changeText(screen.getByTestId('leave-end'), '31/02/2026');
    await fireEvent.press(screen.getByTestId('leave-submit'));
    expect(screen.getByText(/Date invalide/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('leave-end'), '10/10/2026');
    await fireEvent.press(screen.getByTestId('leave-submit'));
    expect(screen.getByText(/La fin doit être/)).toBeTruthy();
    expect(mock.createLeave).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('leave-end'), '14/10/2026');
    await fireEvent.press(screen.getByTestId('leave-type-maladie'));
    await fireEvent.changeText(screen.getByTestId('leave-reason'), 'Arrêt');
    await fireEvent.press(screen.getByTestId('leave-submit'));
    await waitFor(() =>
      expect(mock.createLeave).toHaveBeenCalledWith({}, { employeeId: 5, type: 'maladie', startDate: '2026-10-12', endDate: '2026-10-14', reason: 'Arrêt' }),
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('affiche le refus du backend', async () => {
    signIn(['drh'], ['create']);
    mockParams = { employee_id: '5' };
    mock.createLeave.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Employé hors périmètre' }));
    await show(<LeaveRequestScreen />);
    await fireEvent.changeText(screen.getByTestId('leave-start'), '12/10/2026');
    await fireEvent.changeText(screen.getByTestId('leave-end'), '12/10/2026');
    await fireEvent.press(screen.getByTestId('leave-submit'));
    await waitFor(() => expect(screen.getByTestId('leave-submit-error')).toHaveTextContent(/Employé hors périmètre/));
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('détail de site — planning', () => {
  const detail = {
    site: { id: 1, name: 'Site Nord', client: 'Client X', address: null, commune: 'Hydra', wilaya: 'Alger', society: 'Societe A' },
    contractualStaff: 12, realizedStaff: 10, missingStaff: 2, surplusStaff: 0, agents: [],
  };

  it('affiche le planning projeté par le backend sur 7 jours', async () => {
    signIn(['ops']);
    mockParams = { id: '1' };
    mock.fetchSiteDetail.mockResolvedValue(detail);
    mock.fetchBoard.mockResolvedValue({ kpi: { present: 9, absent: 2, not_pointed: 1 } });
    mock.fetchSitePlanning.mockResolvedValue([
      { key: 'a', date: '2026-10-08', start: '07:00', end: '19:00', group: 'A', rest: false, expectedCount: 6 },
      { key: 'b', date: '2026-10-09', start: '', end: '', group: 'B', rest: true, expectedCount: 0 },
    ]);
    await show(<SiteDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('site-planning')).toHaveTextContent(/08\/10\/2026 · 07:00 – 19:00/));
    expect(screen.getByTestId('site-planning')).toHaveTextContent(/6 attendus/);
    expect(screen.getByTestId('site-planning')).toHaveTextContent(/09\/10\/2026 · Repos/);
    const [, siteId, from, to] = mock.fetchSitePlanning.mock.calls[0]!;
    expect([siteId, from, to]).toEqual([1, localDate(0), localDate(6)]);
  });

  it("ne demande pas le planning d'un site refusé par le backend", async () => {
    signIn(['ops']);
    mockParams = { id: '999' };
    mock.fetchSiteDetail.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    mock.fetchBoard.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    await show(<SiteDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('site-error')).toBeTruthy());
    expect(mock.fetchSitePlanning).not.toHaveBeenCalled();
  });
});
