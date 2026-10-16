import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import BillingScreen from '@/app/billing/index';
import InvoiceDetailScreen from '@/app/billing/invoices/[id]';
import InvoicesScreen from '@/app/billing/invoices/index';
import ClientsScreen from '@/app/commercial/clients/index';
import ClientDetailScreen from '@/app/commercial/clients/[id]';
import CommercialScreen from '@/app/commercial/index';
import ProspectsScreen from '@/app/commercial/prospects';
import { toInvoice } from '@/api/domains/billing';
import { toClient } from '@/api/domains/commercial';
import { ApiError } from '@/api/errors';
import type { AuthState } from '@/auth/AuthProvider';
import { access } from '@/features/access';
import type { ScopeSelection } from '@/scope/model';

import { formatMoney } from '@/utils/format';

import { makeUser } from '../helpers';

/** Réponses du serveur par chemin ; tout autre chemin échoue comme un refus d'accès. */
let mockRoutes: Record<string, unknown> = {};
const mockGet = jest.fn(async (path: string, _options?: unknown) => {
  if (path in mockRoutes) {
    const value = mockRoutes[path];
    if (value instanceof Error) throw value;
    return value;
  }
  throw new ApiError({ kind: 'forbidden', status: 403 });
});
const mockWrite = jest.fn();

jest.mock('@/api', () => ({
  ...jest.requireActual('@/api/errors'),
  api: { get: (path: string, options?: unknown) => mockGet(path, options), post: mockWrite, put: mockWrite, patch: mockWrite, delete: mockWrite },
}));

let mockState: AuthState = { status: 'signedOut' };
let mockSaved: ScopeSelection | null = null;
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockUserOf = () => (mockState.status === 'signedIn' ? mockState.user : null);

jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ state: mockState, signOut: jest.fn() }),
  useCurrentUser: () => mockUserOf(),
}));
jest.mock('@/scope/ScopeProvider', () => ({
  useScope: () => {
    const model = jest.requireActual('@/scope/model');
    return { scope: model.buildScope(mockUserOf(), [{ id: 1, name: 'Site 1', society: 'Societe A' }, { id: 2, name: 'Site 2', society: 'Societe B' }], mockSaved), ready: true, setScope: jest.fn(), preview: jest.fn() };
  },
}));
jest.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

function signIn(modules: string[]) {
  mockState = { status: 'signedIn', user: makeUser({ effective_modules: modules, authorized_societies: ['Societe A', 'Societe B'], authorized_sites: [] }) };
}

async function show(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

const counters = {
  commercial: { prospects: 12, clients_active: 30, clients_total: 34, sites_total: 41, opportunities_open: 6, contracts_active: 28, contracts_30d: 2 },
  facturation: { invoices_total: 120, invoices_issued: 110, invoiced_ttc: 2450000.5, payments_total: 90, payments_amount: 1800000, credit_notes_total: 3, overdue_invoices: 7 },
};
const pageOf = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 25, pages: 1 });
const invoice = (overrides = {}) => ({
  id: 'fac_1', numero: 'FAC0001/10/26', date: '2026-10-02', dateEcheance: '2026-11-01', clientNom: 'Client Nord', societe: 'Societe A',
  statut: 'emise', totalHT: '100000.00', tvaAmt: 19000, ttc: '119000.00', lignes: [{ designation: 'Gardiennage', quantite: 1, prixUnitHT: 100000, totalHT: 100000 }], ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRoutes = {};
  mockParams = {};
  mockSaved = null;
  mockState = { status: 'signedOut' };
});

describe('droits Commercial et Facturation', () => {
  it('suivent les modules du backend : dc pour Commercial, finances ou fac pour Facturation, finances seul pour le CA', () => {
    const user = (modules: string[]) => makeUser({ effective_modules: modules });
    expect(access.commercial(user(['dc']))).toBe(true);
    expect(access.commercial(user(['ops', 'finances']))).toBe(false);
    expect(access.billing(user(['fac']))).toBe(true);
    expect(access.billing(user(['finances']))).toBe(true);
    expect(access.billing(user(['dc']))).toBe(false);
    expect(access.salesReports(user(['fac']))).toBe(false);
    expect(access.salesReports(user(['finances']))).toBe(true);
  });

  it("refuse les écrans sans le module, sans aucun appel au serveur", async () => {
    signIn(['ops']);
    const view = await show(<CommercialScreen />);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    await view.rerender(<QueryClientProvider client={new QueryClient()}><BillingScreen /></QueryClientProvider>);
    expect(screen.getByTestId('access-denied')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('Commercial', () => {
  it('affiche les compteurs calculés par le serveur et le nombre de devis envoyés', async () => {
    signIn(['dc']);
    mockRoutes = { '/api/ui/sidebar-stats': counters, '/api/ventes/devis/page': { ...pageOf([]), total: 4 } };
    await show(<CommercialScreen />);
    await waitFor(() => expect(screen.getByTestId('commercial-kpi-clients')).toHaveTextContent(/30/));
    expect(screen.getByTestId('commercial-kpi-prospects')).toHaveTextContent(/12/);
    expect(screen.getByTestId('commercial-kpi-quotes')).toHaveTextContent(/4/);
    // Sans le module Finances, le chiffre d'affaires n'est ni demandé ni affiché.
    expect(screen.queryByTestId('commercial-kpi-revenue')).toBeNull();
    expect(mockGet.mock.calls.map(([path]) => path)).not.toContain('/api/reporting/dashboard');
    expect(mockGet).toHaveBeenCalledWith('/api/ventes/devis/page', { query: expect.objectContaining({ status: 'envoyé' }) });
  });

  it('pagine et recherche les clients côté serveur, dans la société du contexte', async () => {
    signIn(['dc']);
    mockSaved = { society: 'Societe A', siteId: null };
    mockRoutes = { '/api/commercial/clients/page': pageOf([{ id: 3, name: 'Client Nord', society: 'Societe A', status: 'actif', contact_name: 'M. Haddad', phone: '0550', data: { tech_sites: [{ nom: 'S1' }, { nom: 'S2' }] } }]) };
    await show(<ClientsScreen />);
    await waitFor(() => expect(screen.getByTestId('client-3')).toHaveTextContent(/Client Nord/));
    expect(screen.getByTestId('client-3')).toHaveTextContent(/2 site/);
    await fireEvent.changeText(screen.getByTestId('clients-search'), 'nord');
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/api/commercial/clients/page', { query: expect.objectContaining({ q: 'nord', society: 'Societe A', page: 1 }) }));
  });

  it("ne montre pas une fiche client hors du périmètre renvoyé par le serveur", async () => {
    signIn(['dc']);
    mockParams = { id: '99' };
    mockRoutes = { '/api/commercial/clients': [{ id: 3, name: 'Client Nord', society: 'Societe A', status: 'actif' }] };
    await show(<ClientDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('client-not-found')).toBeTruthy());
    expect(mockGet.mock.calls.map(([path]) => path)).not.toContain('/api/ventes/devis/page');
  });

  it('limite prospects et opportunités à la société du contexte', async () => {
    signIn(['dc']);
    mockSaved = { society: 'Societe A', siteId: null };
    mockRoutes = {
      '/api/irongs/collections/prospects/items': [
        { id: 'p1', nom: 'Prospect A', societe: 'Societe A', statut: 'interesse' },
        { id: 'p2', nom: 'Prospect B', societe: 'Societe B', statut: 'nouveau' },
      ],
      '/api/irongs/collections/opportunites/items': [],
    };
    await show(<ProspectsScreen />);
    await waitFor(() => expect(screen.getByTestId('prospect-p1')).toHaveTextContent(/Intéressé/));
    expect(screen.queryByTestId('prospect-p2')).toBeNull();
  });
});

describe('Facturation', () => {
  it("un compte Facturation sans Finances n'appelle pas les synthèses réservées à Finances", async () => {
    signIn(['fac']);
    mockRoutes = { '/api/ui/sidebar-stats': counters };
    await show(<BillingScreen />);
    await waitFor(() => expect(screen.getByTestId('billing-kpi-issued')).toHaveTextContent(/110/));
    expect(screen.queryByTestId('billing-kpi-month-revenue')).toBeNull();
    expect(mockGet.mock.calls.map(([path]) => path).filter((path) => path.startsWith('/api/reporting'))).toEqual([]);
    // Impayés et retards ne sont pas publiés de façon fiable par le serveur : rien d'estimé.
    expect(screen.getByTestId('billing-outstanding-note')).toBeTruthy();
    expect(screen.queryByText(/7/)).toBeNull();
  });

  it('liste les factures de la société du contexte avec les montants du serveur', async () => {
    signIn(['finances']);
    mockSaved = { society: 'Societe A', siteId: null };
    mockRoutes = {
      '/api/irongs/collections/factures/items': [invoice(), invoice({ id: 'fac_2', numero: 'FAC0002/10/26', societe: 'Societe B' })],
    };
    await show(<InvoicesScreen />);
    await waitFor(() => expect(screen.getByTestId('invoice-fac_1')).toHaveTextContent(/FAC0001\/10\/26/));
    expect(screen.getByTestId('invoice-fac_1')).toHaveTextContent(/119 000,00 DA/);
    expect(screen.getByTestId('invoice-fac_1')).toHaveTextContent(/Émise/);
    expect(screen.queryByTestId('invoice-fac_2')).toBeNull();
  });

  it("affiche une facture, ses règlements sans les additionner, et aucune action d'écriture", async () => {
    signIn(['finances']);
    mockParams = { id: 'fac_1' };
    mockRoutes = {
      '/api/irongs/collections/factures/items/fac_1': invoice(),
      '/api/irongs/collections/paiements/items': [
        { id: 'pay1', factureId: 'fac_1', date: '2026-10-05', montant: 50000, mode: 'Virement', reference: 'VIR-1', societe: 'Societe A' },
        { id: 'pay2', factureId: 'fac_9', date: '2026-10-06', montant: 1000, societe: 'Societe A' },
      ],
    };
    await show(<InvoiceDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('invoice-totals')).toHaveTextContent(/119 000,00 DA/));
    expect(screen.getByTestId('invoice-totals')).toHaveTextContent(/Non disponible/);
    await waitFor(() => expect(screen.getByTestId('invoice-payments')).toHaveTextContent(/VIR-1/));
    expect(screen.getByTestId('invoice-payments')).toHaveTextContent(/\(1\)/);
    expect(screen.getByTestId('invoice-payments')).not.toHaveTextContent(/1\s?000,00/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("une facture d'une autre société, refusée par le serveur, n'est pas affichée", async () => {
    signIn(['finances']);
    mockParams = { id: 'fac_autre' };
    mockRoutes = { '/api/irongs/collections/factures/items/fac_autre': new ApiError({ kind: 'not_found', status: 404 }), '/api/irongs/collections/paiements/items': [] };
    await show(<InvoiceDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('invoice-error')).toBeTruthy());
    expect(screen.queryByTestId('invoice-header')).toBeNull();
  });
});

describe('conversion des réponses', () => {
  it('lit les montants envoyés en nombre ou en chaîne, sans en inventer', () => {
    const parsed = toInvoice(invoice({ ttc: undefined, montantTTC: '42.5', totalHT: null, montantHT: undefined }));
    expect(parsed.totalTtc).toBe(42.5);
    expect(parsed.totalHt).toBeNull();
    expect(parsed.dueDate).toBe('2026-11-01');
  });

  it('compte les sites comme le serveur et garde le statut du contrat', () => {
    expect(toClient({ id: 1, name: 'A', data: { tech_sites: [{}, {}, {}], dc_contract_status: 'valide' } })).toMatchObject({ sitesCount: 3, contractStatus: 'valide' });
    expect(toClient({ id: 1, name: 'A', data: { tech_nbrSite: '4' } }).sitesCount).toBe(4);
    expect(toClient({ id: 1, name: 'A', data: {} }).sitesCount).toBeNull();
  });
});

describe('format des montants', () => {
  it('groupe les milliers à la française et dit « — » pour un montant inconnu', () => {
    expect(formatMoney(2450000.5)).toBe('2 450 000,50 DA');
    expect(formatMoney(-12)).toBe('-12,00 DA');
    expect(formatMoney(null)).toBe('—');
  });
});
