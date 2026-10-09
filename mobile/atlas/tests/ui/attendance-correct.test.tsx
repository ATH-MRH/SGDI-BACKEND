import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { ApiError } from '@/api/errors';
import { validateCorrectionReason } from '@/api/domains/attendance';
import AttendanceScreen from '@/app/attendance';
import AttendanceCorrectScreen from '@/app/attendance-correct';
import { PrivacyShield } from '@/components/PrivacyShield';

import { makeUser } from '../helpers';

const mockFetchBoard = jest.fn();
const mockCorrect = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockUser: ReturnType<typeof makeUser> | null = null;
let mockSecure = false;

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/errors'), api: {} }));
jest.mock('@/config/env', () => ({ isFeatureEnabled: (key: string) => key === 'secureScreen' && mockSecure }));
jest.mock('@/api/domains/attendance', () => ({
  ...jest.requireActual('@/api/domains/attendance'),
  fetchBoard: (...a: unknown[]) => mockFetchBoard(...a),
  correctPresence: (...a: unknown[]) => mockCorrect(...a),
}));
jest.mock('@/auth/AuthProvider', () => ({ useCurrentUser: () => mockUser }));
jest.mock('@/scope/ScopeProvider', () => ({
  useScope: () => {
    const model = jest.requireActual('@/scope/model');
    return { scope: model.buildScope(mockUser, [{ id: 1, name: 'Site Nord', society: 'Societe A' }], null), ready: true };
  },
}));
jest.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }), useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const row = (overrides = {}) => ({
  employeeId: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', society: 'Societe A', siteId: 1, site: 'Site Nord', status: 'absent',
  arrival: '', departure: '', plannedStart: null, plannedEnd: null, anomalies: [], presenceId: 42, closed: false, ...overrides,
});
const board = (items: unknown[]) => ({ date: '2026-10-08', kpi: {}, total: items.length, page: 1, pages: 1, page_size: 25, items });

function signIn(actions: string[]) {
  mockUser = makeUser({ effective_modules: ['pointage'], authorized_actions: actions as never, authorized_sites: [] });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockFetchBoard.mockReset();
  mockCorrect.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
  mockParams = {};
  mockSecure = false;
});

describe('correction de pointage', () => {
  it('contrôle le motif', () => {
    expect(validateCorrectionReason('  ')).toBe('required');
    expect(validateCorrectionReason('ab')).toBe('tooShort');
    expect(validateCorrectionReason('x'.repeat(501))).toBe('tooLong');
    expect(validateCorrectionReason('Erreur de saisie')).toBeNull();
  });

  it("n'ouvre la correction que pour une ligne enregistrée et un compte habilité", async () => {
    mockFetchBoard.mockResolvedValue(board([row(), row({ employeeId: 6, name: 'SAIDI Nadia', presenceId: null }), row({ employeeId: 7, name: 'AMRANI Ali', presenceId: 44, closed: true })]));

    signIn(['read']);
    const readOnly = await show(<AttendanceScreen />);
    await waitFor(() => expect(screen.getByTestId('attendance-5')).toBeTruthy());
    expect(screen.getByTestId('attendance-5').props.accessibilityRole).not.toBe('button');
    await readOnly.unmount();

    signIn(['read', 'update']);
    await show(<AttendanceScreen />);
    await waitFor(() => expect(screen.getByTestId('attendance-5')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('attendance-5'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/attendance-correct', params: { presence_id: '42', name: 'BENALI Karim', status: 'absent', closed: '' } });
    // Rien d'enregistré pour ce jour, ou journée clôturée sans droit de validation : pas de correction.
    expect(screen.getByTestId('attendance-6').props.accessibilityRole).not.toBe('button');
    expect(screen.getByTestId('attendance-7').props.accessibilityRole).not.toBe('button');
  });

  it('exige un motif puis transmet la correction au backend', async () => {
    signIn(['update']);
    mockParams = { presence_id: '42', name: 'BENALI Karim', status: 'absent' };
    mockCorrect.mockResolvedValue({ status: 'present' });
    await show(<AttendanceCorrectScreen />);
    await fireEvent.press(screen.getByTestId('correct-submit'));
    expect(screen.getByText('Champ obligatoire.')).toBeTruthy();
    expect(mockCorrect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('correct-status-mission'));
    await fireEvent.changeText(screen.getByTestId('correct-reason'), 'Ordre de mission du 8 octobre');
    await fireEvent.press(screen.getByTestId('correct-submit'));
    await waitFor(() => expect(mockCorrect).toHaveBeenCalledWith({}, 42, { status: 'mission', reason: 'Ordre de mission du 8 octobre' }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('affiche le refus du backend et ne quitte pas l\'écran', async () => {
    signIn(['update']);
    mockParams = { presence_id: '42', status: 'present' };
    mockCorrect.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Site hors périmètre' }));
    await show(<AttendanceCorrectScreen />);
    await fireEvent.changeText(screen.getByTestId('correct-reason'), 'Erreur de saisie');
    await fireEvent.press(screen.getByTestId('correct-submit'));
    await waitFor(() => expect(screen.getByTestId('correct-error')).toHaveTextContent(/Site hors périmètre/));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('refuse l\'écran sans droit, sans identifiant valide, ou sur journée clôturée sans validation', async () => {
    for (const [actions, params] of [
      [['read'], { presence_id: '42' }],
      [['update'], { presence_id: 'abc' }],
      [['update'], { presence_id: '42', closed: '1' }],
    ] as const) {
      signIn([...actions]);
      mockParams = { ...params };
      const view = await show(<AttendanceCorrectScreen />);
      expect(screen.getByTestId('access-denied')).toBeTruthy();
      await view.unmount();
    }
    signIn(['update', 'validate']);
    mockParams = { presence_id: '42', closed: '1' };
    await show(<AttendanceCorrectScreen />);
    expect(screen.getByTestId('correct-notice')).toHaveTextContent(/clôturée/);
  });
});

describe('protection de l\'écran', () => {
  const capture = ScreenCapture as jest.Mocked<typeof ScreenCapture>;
  beforeEach(() => {
    capture.preventScreenCaptureAsync.mockClear();
    capture.allowScreenCaptureAsync.mockClear();
  });

  it('ne bloque les captures que si la fonction est incluse dans le build', async () => {
    const plain = await render(<PrivacyShield><Text>contenu</Text></PrivacyShield>);
    expect(capture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    await plain.unmount();

    mockSecure = true;
    const secured = await render(<PrivacyShield><Text>contenu</Text></PrivacyShield>);
    expect(capture.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    await secured.unmount();
    expect(capture.allowScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });
});
