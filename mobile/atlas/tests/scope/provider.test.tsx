import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';

import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { ApiUser } from '@/api/types';
import { ScopeProvider, useScope } from '@/scope/ScopeProvider';

import { makeSite, makeUser } from '../helpers';

const mockFetchScopeSites = jest.fn();
let mockUser: ApiUser | null = null;

jest.mock('@/api', () => ({ api: {} }));
jest.mock('@/api/scope', () => ({ fetchScopeSites: (...args: unknown[]) => mockFetchScopeSites(...args) }));
jest.mock('@/auth/AuthProvider', () => ({ useCurrentUser: () => mockUser }));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = 'atlas.scope.v1';
const A = 'Societe A';
const B = 'Societe B';

let scopeApi: ReturnType<typeof useScope>;

function Probe() {
  scopeApi = useScope();
  const { scope, ready } = scopeApi;
  return <Text testID="scope">{ready ? `${scope.society ?? '*'}|${scope.site?.id ?? '*'}` : 'chargement'}</Text>;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <ScopeProvider>
        <Probe />
      </ScopeProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

const text = () => screen.getByTestId('scope').props.children as string;
const saved = () => (store.has(KEY) ? JSON.parse(store.get(KEY)!) : null);

beforeEach(() => {
  store.clear();
  mockFetchScopeSites.mockReset();
  mockUser = makeUser({ authorized_societies: [A, B], authorized_sites: [] });
  mockFetchScopeSites.mockResolvedValue([makeSite(1, A), makeSite(2, B), makeSite(5, B)]);
});

describe('ScopeProvider', () => {
  it("n'est prêt qu'une fois la sélection mémorisée et les sites connus", async () => {
    await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
    expect(scopeApi.scope.societies).toEqual([A, B]);
  });

  it('restaure une sélection mémorisée encore autorisée', async () => {
    store.set(KEY, JSON.stringify({ userId: 7, society: B, siteId: 5 }));
    await mount();
    await waitFor(() => expect(text()).toBe(`${B}|5`));
  });

  it('supprime une sélection mémorisée devenue interdite et la remplace sur le disque', async () => {
    store.set(KEY, JSON.stringify({ userId: 7, society: B, siteId: 5 }));
    mockUser = makeUser({ authorized_societies: [A], authorized_sites: [] });
    await mount();
    await waitFor(() => expect(text()).toBe(`${A}|*`));
    await waitFor(() => expect(saved()).toEqual({ userId: 7, society: A, siteId: null }));
  });

  it("ignore et efface la sélection d'un autre utilisateur", async () => {
    store.set(KEY, JSON.stringify({ userId: 99, society: B, siteId: 5 }));
    await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
    expect(saved()?.userId).not.toBe(99);
  });

  it('ignore une sélection mémorisée corrompue', async () => {
    store.set(KEY, '{"userId":"7","society":42}');
    await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
  });

  it("applique un choix, le mémorise et n'invalide que les données dépendantes du contexte", async () => {
    const { client } = await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
    client.setQueryData(queryKeys.scoped(null, null, 'employees'), ['a']);
    client.setQueryData(queryKeys.scopeSites(7), [makeSite(1, A), makeSite(2, B), makeSite(5, B)]);
    client.setQueryData(['autre'], ['b']);

    await act(() => scopeApi.setScope({ society: B, siteId: 2 }));

    expect(text()).toBe(`${B}|2`);
    expect(saved()).toEqual({ userId: 7, society: B, siteId: 2 });
    expect(client.getQueryState(queryKeys.scoped(null, null, 'employees'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['autre'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.scopeSites(7))?.isInvalidated).toBe(false);
  });

  it('refuse un choix hors périmètre : la valeur retenue est toujours valide', async () => {
    await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
    await act(() => scopeApi.setScope({ society: 'Societe Interdite', siteId: 999 }));
    expect(text()).toBe('*|*');
    await act(() => scopeApi.setScope({ society: A, siteId: 2 }));
    expect(text()).toBe(`${A}|*`);
  });

  it('prévisualise un choix sans le retenir', async () => {
    await mount();
    await waitFor(() => expect(text()).toBe('*|*'));
    expect(scopeApi.preview({ society: B, siteId: null }).sites.map((site) => site.id)).toEqual([2, 5]);
    expect(text()).toBe('*|*');
  });

  it('se rabat sur les identifiants de /me quand la liste de sites est indisponible', async () => {
    mockUser = makeUser({ authorized_societies: [A], authorized_sites: [3, 9] });
    mockFetchScopeSites.mockRejectedValue(new ApiError({ kind: 'network' }));
    await mount();
    await waitFor(() => expect(text()).toBe(`${A}|*`));
    expect(scopeApi.scope.sites).toEqual([
      { id: 3, name: null, society: null },
      { id: 9, name: null, society: null },
    ]);
  });

  it('ne donne aucun contexte hors session', async () => {
    mockUser = null;
    await mount();
    expect(text()).toBe('chargement');
    expect(scopeApi.scope.societies).toEqual([]);
    expect(mockFetchScopeSites).not.toHaveBeenCalled();
  });
});
