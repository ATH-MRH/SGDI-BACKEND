import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { ReactElement } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@/api/errors';
import IncidentsScreen from '@/app/incidents/index';
import NewIncidentScreen from '@/app/incidents/new';
import { OfflineProvider, useOffline } from '@/offline/OfflineProvider';
import { loadQueue, queueIncident, saveQueue } from '@/offline/queue';

import { makeSite, makeUser } from '../helpers';

const mockCreateIncident = jest.fn();
const mockFetchIncidents = jest.fn();
const mockBack = jest.fn();
let mockOffline = true;
let mockUser: ReturnType<typeof makeUser> | null = null;
const mockSites = [makeSite(1, 'Societe A', 'Site Nord')];

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/errors'), api: {} }));
jest.mock('@/config/env', () => ({ isFeatureEnabled: (key: string) => key === 'offline' && mockOffline }));
jest.mock('@/api/domains/incidents', () => ({
  ...jest.requireActual('@/api/domains/incidents'),
  createIncident: (...a: unknown[]) => mockCreateIncident(...a),
  fetchIncidents: (...a: unknown[]) => mockFetchIncidents(...a),
}));
jest.mock('@/auth/AuthProvider', () => ({ useCurrentUser: () => mockUser }));
jest.mock('@/scope/ScopeProvider', () => ({
  useScope: () => {
    const model = jest.requireActual('@/scope/model');
    return { scope: model.buildScope(mockUser, mockSites, null), ready: true };
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: mockBack }), useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const draft = { siteId: 1, society: 'Societe A', type: 'vol', severity: 'moyenne', subject: 'Vol de câble', description: 'Zone B', date: '2026-10-08', time: '09:00' } as const;

let offline: ReturnType<typeof useOffline>;
function Probe() {
  offline = useOffline();
  return null;
}

async function show(ui: ReactElement = <Probe />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <OfflineProvider>{ui}</OfflineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  store.clear();
  mockOffline = true;
  mockUser = makeUser({ id: 7, effective_modules: ['ops'], authorized_actions: ['read', 'create'] as never, authorized_sites: [] });
  mockCreateIncident.mockReset();
  mockFetchIncidents.mockReset().mockResolvedValue([]);
  mockBack.mockReset();
});

describe('OfflineProvider', () => {
  it('reste inerte quand la fonction est désactivée pour ce build', async () => {
    mockOffline = false;
    await saveQueue(7, [queueIncident(draft)]);
    await show();
    expect(offline.enabled).toBe(false);
    expect(await offline.enqueueIncident(draft)).toBe(false);
    expect(mockCreateIncident).not.toHaveBeenCalled();
  });

  it('envoie au démarrage ce qui attendait, avec son identifiant client', async () => {
    const item = queueIncident(draft);
    await saveQueue(7, [item]);
    mockCreateIncident.mockResolvedValue({ id: 12 });
    await show();
    await waitFor(() => expect(mockCreateIncident).toHaveBeenCalledWith({}, item.payload, item.id));
    await waitFor(() => expect(offline.items).toHaveLength(0));
    expect(await loadQueue(7)).toEqual([]);
  });

  it('garde la saisie sans réseau, puis la renvoie au retour au premier plan', async () => {
    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'network' }));
    await show();
    await act(async () => {
      expect(await offline.enqueueIncident(draft)).toBe(true);
    });
    expect(offline.items).toHaveLength(1);
    expect(await loadQueue(7)).toHaveLength(1);

    mockCreateIncident.mockReset().mockResolvedValue({ id: 3 });
    const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)![1] as (state: string) => void;
    await act(async () => listener('active'));
    await waitFor(() => expect(offline.items).toHaveLength(0));
    expect(mockCreateIncident).toHaveBeenCalledTimes(1);
  });

  it("n'envoie jamais la file d'un autre compte", async () => {
    await saveQueue(99, [queueIncident(draft)]);
    await show();
    await waitFor(() => expect(store.size).toBe(0));
    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(offline.items).toHaveLength(0);
  });

  it('refuse une saisie de plus quand la file est pleine et ne duplique pas un identifiant', async () => {
    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'network' }));
    await show();
    await act(async () => {
      expect(await offline.enqueueIncident(draft, 'mobile-' + 'a'.repeat(32))).toBe(true);
      expect(await offline.enqueueIncident(draft, 'mobile-' + 'a'.repeat(32))).toBe(true);
    });
    expect(offline.items).toHaveLength(1);
    await act(async () => {
      for (let index = 0; index < 9; index += 1) await offline.enqueueIncident(draft);
      expect(await offline.enqueueIncident(draft)).toBe(false);
    });
    expect(offline.items).toHaveLength(10);
  });
});

describe('déclaration d\'incident sans réseau', () => {
  async function fill() {
    await fireEvent.changeText(screen.getByTestId('incident-subject'), 'Vol de câble');
    await fireEvent.changeText(screen.getByTestId('incident-description'), 'Zone B');
    await fireEvent.press(screen.getByTestId('incident-submit'));
  }

  it('met la déclaration en attente et revient à la liste', async () => {
    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'network' }));
    await show(<><Probe /><NewIncidentScreen /></>);
    await fill();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(offline.items).toHaveLength(1);
    // Même identifiant que la tentative directe : si elle a abouti malgré tout, pas de doublon.
    expect(offline.items[0]!.id).toBe(mockCreateIncident.mock.calls[0]![2]);
    expect(screen.queryByTestId('incident-submit-error')).toBeNull();
  });

  it("ne met jamais en attente un refus du backend", async () => {
    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Société non autorisée pour cet utilisateur' }));
    await show(<><Probe /><NewIncidentScreen /></>);
    await fill();
    await waitFor(() => expect(screen.getByTestId('incident-submit-error')).toHaveTextContent(/Société non autorisée/));
    expect(offline.items).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('sans la fonction hors connexion, la panne réseau est affichée et rien n\'est gardé', async () => {
    mockOffline = false;
    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'network' }));
    await show(<NewIncidentScreen />);
    await fill();
    await waitFor(() => expect(screen.getByTestId('incident-submit-error')).toBeTruthy());
    expect(store.size).toBe(0);
  });

  it('la liste distingue les saisies en attente et permet de renvoyer ou supprimer un refus', async () => {
    const refused = { ...queueIncident(draft), state: 'failed' as const, error: 'Société non autorisée pour cet utilisateur', attempts: 1 };
    await saveQueue(7, [refused]);
    await show(<><Probe /><IncidentsScreen /></>);
    await waitFor(() => expect(screen.getByTestId(`offline-state-${refused.id}`)).toHaveTextContent('Refusée par le serveur'));
    expect(screen.getByTestId('offline-queue')).toHaveTextContent(/pas encore enregistrées dans ATLAS/);
    expect(mockCreateIncident).not.toHaveBeenCalled();

    mockCreateIncident.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Toujours refusé' }));
    await fireEvent.press(screen.getByTestId(`offline-retry-${refused.id}`));
    await waitFor(() => expect(mockCreateIncident).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId(`offline-${refused.id}`)).toHaveTextContent(/Toujours refusé/));

    await fireEvent.press(screen.getByTestId(`offline-discard-${refused.id}`));
    await fireEvent.press(screen.getByTestId('offline-discard-confirm-confirm'));
    await waitFor(() => expect(screen.queryByTestId('offline-queue')).toBeNull());
    expect(await loadQueue(7)).toEqual([]);
  });
});
