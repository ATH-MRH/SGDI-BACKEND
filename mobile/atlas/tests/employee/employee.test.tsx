import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { ReactElement } from 'react';

import { parseLoginResponse } from '@/api/auth';
import { ApiError } from '@/api/errors';
import EmployeeHomeScreen from '@/app/employee';
import { employeeApi, parseEmployeeLogin } from '@/employee/api';
import { EMPLOYEE_SESSION_KEY, EmployeeProvider, useEmployee } from '@/employee/EmployeeProvider';

import { FUTURE, jsonResponse, makeToken } from '../helpers';

let mockEnabled = true;
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://atlas.example.test', variant: 'staging', features: {} },
  isFeatureEnabled: (key: string) => key === 'employeePortal' && mockEnabled,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const employeeToken = (exp: number = FUTURE) => makeToken(exp, { token_use: 'employee_mobile', acc: 'acc-1', pv: 'abc' });
const profile = { id: 5, matricule: 'AGT005', first_name: 'Karim', last_name: 'BENALI', position: 'Agent', society: 'Societe A', status: 'actif', site: { id: 1, name: 'Site Nord' }, group: 'A' };
const loginBody = (token: string = employeeToken()) => ({ access_token: token, token_type: 'bearer', expires_in: 28800, employee: profile });

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const routes: Record<string, () => Response> = {};
beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function serve(overrides: Record<string, () => Response> = {}) {
  Object.assign(routes, {
    '/api/employee-mobile/login': () => jsonResponse(200, loginBody()),
    '/api/employee-mobile/me': () => jsonResponse(200, profile),
    '/api/employee-mobile/me/planning': () => jsonResponse(200, { shifts: [{ date: '2026-10-09', start: '07:00', end: '19:00', group: 'A', rest: false }] }),
    '/api/employee-mobile/me/attendance': () => jsonResponse(200, { days: [{ date: '2026-10-08', status: 'present', site: 'Site Nord', arrival: '07:02', departure: '' }] }),
    '/api/employee-mobile/me/absences': () => jsonResponse(200, { days: [] }),
    '/api/employee-mobile/me/leaves': () => jsonResponse(200, { items: [{ id: 1, leave_type: 'conge', start_date: '2026-11-01', end_date: '2026-11-05', reason: 'Famille', status: 'instance' }] }),
    '/api/employee-mobile/me/documents': () => jsonResponse(200, { items: [{ id: 3, label: 'Contrat', created_at: '2026-01-02T10:00:00' }] }),
    '/api/employee-mobile/me/payslips': () => jsonResponse(200, { items: [{ id: 9, period: '2026-09', net_a_payer: '48600.00', status: 'validated' }] }),
    ...overrides,
  });
  fetchMock.mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    return (routes[path] ?? (() => jsonResponse(404, { detail: 'Not Found' })))();
  });
}

let employee: ReturnType<typeof useEmployee>;
function Probe() {
  employee = useEmployee();
  return null;
}

async function show(ui: ReactElement = <Probe />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeProvider>
        <Probe />
        {ui}
      </EmployeeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  store.clear();
  mockEnabled = true;
  fetchMock.mockReset();
  for (const key of Object.keys(routes)) delete routes[key];
  serve();
});

describe('famille de jetons employé', () => {
  it("n'accepte qu'un jeton employee_mobile", () => {
    expect(parseEmployeeLogin(loginBody()).employee.matricule).toBe('AGT005');
    for (const claims of [{ token_use: 'staff' }, { portal: true }, { client_portal: true }, { token_use: 'employee' }, {}]) {
      expect(() => parseEmployeeLogin(loginBody(makeToken(FUTURE, claims)))).toThrow(ApiError);
    }
    expect(() => parseEmployeeLogin(loginBody(employeeToken(1)))).toThrow(ApiError);
    expect(() => parseEmployeeLogin({ ...loginBody(), employee: {} })).toThrow(ApiError);
    expect(() => parseEmployeeLogin({ ...loginBody(), token_type: 'mac' })).toThrow(ApiError);
  });

  it("la session staff refuse un jeton employé", () => {
    expect(() => parseLoginResponse({ access_token: employeeToken(), token_type: 'bearer' })).toThrow(ApiError);
  });
});

describe('EmployeeProvider', () => {
  it('reste inerte quand la fonction est absente du build', async () => {
    mockEnabled = false;
    store.set(EMPLOYEE_SESSION_KEY, JSON.stringify({ token: employeeToken() }));
    await show();
    expect(employee.available).toBe(false);
    expect(employee.state.status).toBe('signedOut');
    await expect(employee.signIn('agt005', 'x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('connecte, ne stocke que le jeton, et envoie ce jeton aux seules routes employé', async () => {
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    await act(() => employee.signIn(' AGT005 ', 'secret'));
    expect(employee.state).toMatchObject({ status: 'signedIn', employee: { matricule: 'AGT005', siteName: 'Site Nord' } });
    expect(JSON.parse(store.get(EMPLOYEE_SESSION_KEY)!)).toEqual({ token: employeeToken() });
    expect([...store.keys()]).toEqual([EMPLOYEE_SESSION_KEY]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://atlas.example.test/api/employee-mobile/login');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'AGT005', password: 'secret' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();

    await employeeApi.get('/api/employee-mobile/me');
    expect((fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${employeeToken()}`);
  });

  it('refuse des identifiants incorrects sans rien stocker', async () => {
    serve({ '/api/employee-mobile/login': () => jsonResponse(403, { detail: 'Identifiant ou mot de passe incorrect' }) });
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    await expect(employee.signIn('agt005', 'faux')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(store.size).toBe(0);
  });

  it("refuse une réponse de connexion qui porterait un jeton staff", async () => {
    serve({ '/api/employee-mobile/login': () => jsonResponse(200, loginBody(makeToken(FUTURE))) });
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    await expect(employee.signIn('agt005', 'secret')).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(store.size).toBe(0);
  });

  it('restaure une session stockée, et efface un jeton expiré, étranger ou refusé', async () => {
    store.set(EMPLOYEE_SESSION_KEY, JSON.stringify({ token: employeeToken() }));
    const first = await show();
    await waitFor(() => expect(employee.state.status).toBe('signedIn'));
    await first.unmount();

    for (const token of [employeeToken(1), makeToken(FUTURE), 'pas-un-jwt']) {
      store.set(EMPLOYEE_SESSION_KEY, JSON.stringify({ token }));
      const view = await show();
      await waitFor(() => expect(employee.state.status).toBe('signedOut'));
      expect(store.has(EMPLOYEE_SESSION_KEY)).toBe(false);
      await view.unmount();
    }

    serve({ '/api/employee-mobile/me': () => jsonResponse(401, { detail: 'Session expirée' }) });
    store.set(EMPLOYEE_SESSION_KEY, JSON.stringify({ token: employeeToken() }));
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    expect(store.has(EMPLOYEE_SESSION_KEY)).toBe(false);
  });

  it('garde le jeton si le réseau manque à la restauration', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    store.set(EMPLOYEE_SESSION_KEY, JSON.stringify({ token: employeeToken() }));
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    expect(store.has(EMPLOYEE_SESSION_KEY)).toBe(true);
  });

  it('ferme la session quand le backend refuse le jeton en cours de route', async () => {
    await show();
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    await act(() => employee.signIn('agt005', 'secret'));
    serve({ '/api/employee-mobile/me/leaves': () => jsonResponse(401, { detail: 'Session expirée' }) });
    await act(async () => {
      await employeeApi.get('/api/employee-mobile/me/leaves').catch(() => undefined);
    });
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    expect(store.size).toBe(0);
  });
});

describe('espace employé', () => {
  async function open() {
    await show(<EmployeeHomeScreen />);
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    await act(() => employee.signIn('agt005', 'secret'));
    await waitFor(() => expect(screen.getByTestId('employee-name')).toHaveTextContent('BENALI Karim'));
  }

  it('affiche les données de la personne connectée, section par section', async () => {
    await open();
    await waitFor(() => expect(screen.getByTestId('self-planning')).toHaveTextContent(/09\/10\/2026/));
    expect(screen.getByTestId('self-planning')).toHaveTextContent(/07:00 – 19:00/);
    expect(screen.getByTestId('self-attendance')).toHaveTextContent(/Arrivée 07:02/);
    expect(screen.getByTestId('self-absences')).toHaveTextContent(/Aucun/);
    expect(screen.getByTestId('self-leaves')).toHaveTextContent(/Famille/);
    expect(screen.getByTestId('self-documents')).toHaveTextContent(/Contrat/);
    expect(screen.getByTestId('self-payslips')).toHaveTextContent(/2026-09/);
    expect(screen.getByTestId('self-payslips')).toHaveTextContent(/48600\.00 DA/);
    // Aucun appel ne part vers une route staff.
    for (const [url] of fetchMock.mock.calls) expect(new URL(url).pathname.startsWith('/api/employee-mobile/')).toBe(true);
  });

  it("une section en erreur propose de réessayer sans masquer les autres", async () => {
    serve({ '/api/employee-mobile/me/payslips': () => jsonResponse(500, {}) });
    await open();
    await waitFor(() => expect(screen.getByTestId('self-payslips-retry')).toBeTruthy());
    expect(screen.getByTestId('self-leaves')).toHaveTextContent(/Famille/);
    serve({ '/api/employee-mobile/me/payslips': () => jsonResponse(200, { items: [] }) });
    await fireEvent.press(screen.getByTestId('self-payslips-retry'));
    await waitFor(() => expect(screen.getByTestId('self-payslips')).toHaveTextContent(/Aucun/));
  });

  it('la déconnexion efface le jeton et vide l\'écran', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('employee-sign-out'));
    await waitFor(() => expect(employee.state.status).toBe('signedOut'));
    expect(store.size).toBe(0);
    expect(screen.queryByTestId('employee-home')).toBeNull();
  });
});
