import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { notifyUpgradeRequired } from '@/auth/session';
import { UpdateGate } from '@/update/UpdateGate';

const mockFetchMobileConfig = jest.fn();
let mockUpdateCheck = false;

jest.mock('@/api', () => ({ api: {} }));
jest.mock('@/api/mobileConfig', () => ({ fetchMobileConfig: (...args: unknown[]) => mockFetchMobileConfig(...args) }));
jest.mock('@/config/env', () => ({ isFeatureEnabled: (key: string) => key === 'updateCheck' && mockUpdateCheck }));

async function mount() {
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}>
      <UpdateGate
        renderUpdate={(storeUrl) => <Text testID="update">{storeUrl ?? 'sans lien'}</Text>}
        renderMaintenance={(message) => <Text testID="maintenance">{message ?? 'maintenance'}</Text>}>
        <Text testID="app">application</Text>
      </UpdateGate>
    </QueryClientProvider>,
  );
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    minSupportedVersion: { ios: null, android: null },
    recommendedVersion: { ios: null, android: null },
    maintenance: { enabled: false, message: null },
    storeUrls: { ios: null, android: null },
    ...overrides,
  };
}

beforeEach(() => {
  mockUpdateCheck = false;
  mockFetchMobileConfig.mockReset();
});

describe('UpdateGate', () => {
  it("n'interroge pas le backend et ne bloque rien quand la vérification est désactivée", async () => {
    await mount();
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(mockFetchMobileConfig).not.toHaveBeenCalled();
  });

  it('bloque dès que le backend refuse la version (426)', async () => {
    await mount();
    await act(async () => notifyUpgradeRequired());
    expect(screen.getByTestId('update')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('bloque sous la version minimale annoncée (installée : 1.0.0)', async () => {
    mockUpdateCheck = true;
    mockFetchMobileConfig.mockResolvedValue(
      config({ minSupportedVersion: { ios: '1.1.0', android: '1.1.0' }, storeUrls: { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' } }),
    );
    await mount();
    await waitFor(() => expect(screen.getByTestId('update')).toHaveTextContent(/^https:\/\/(apps\.apple|play\.google)\.com\//));
  });

  it('laisse passer une version suffisante, ou un endpoint absent', async () => {
    mockUpdateCheck = true;
    mockFetchMobileConfig.mockResolvedValue(config({ minSupportedVersion: { ios: '1.0.0', android: '0.9.0' } }));
    await mount();
    await waitFor(() => expect(mockFetchMobileConfig).toHaveBeenCalled());
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it("ne bloque pas si l'endpoint n'existe pas encore (404)", async () => {
    mockUpdateCheck = true;
    mockFetchMobileConfig.mockRejectedValue(new Error('404'));
    await mount();
    await waitFor(() => expect(mockFetchMobileConfig).toHaveBeenCalled());
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('affiche la maintenance annoncée par le serveur, avec son message', async () => {
    mockUpdateCheck = true;
    mockFetchMobileConfig.mockResolvedValue(config({ maintenance: { enabled: true, message: 'Retour à 14 h.' } }));
    await mount();
    await waitFor(() => expect(screen.getByTestId('maintenance')).toHaveTextContent('Retour à 14 h.'));
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('la mise à jour requise prime sur la maintenance', async () => {
    mockUpdateCheck = true;
    mockFetchMobileConfig.mockResolvedValue(
      config({ minSupportedVersion: { ios: '9.0.0', android: '9.0.0' }, maintenance: { enabled: true, message: null } }),
    );
    await mount();
    await waitFor(() => expect(screen.getByTestId('update')).toBeTruthy());
    expect(screen.queryByTestId('maintenance')).toBeNull();
  });
});
