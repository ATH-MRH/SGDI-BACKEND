import { useQuery } from '@tanstack/react-query';

import { api } from '@/api';
import { fetchInvoices, fetchPayments, fetchSalesByStatus, fetchSalesDashboard, fetchTopClients } from '@/api/domains/billing';
import { fetchAllClients, fetchErpCounters, fetchOpportunities, fetchProspects, fetchQuotesPage } from '@/api/domains/commercial';
import { queryKeys } from '@/api/queryKeys';
import { useCurrentUser } from '@/auth/AuthProvider';
import { useScope } from '@/scope/ScopeProvider';
import { currentMonth } from '@/utils/format';

import { access } from '../access';

const TWO_MINUTES = 2 * 60_000;
const FIVE_MINUTES = 5 * 60_000;

/**
 * Données Commercial et Facturation, toutes mises en cache par société. Chaque requête n'est
 * envoyée que si le compte a le droit correspondant ; le serveur revérifie module et société.
 */
function useScopedQueryContext() {
  const user = useCurrentUser();
  const { scope, ready } = useScope();
  const society = scope.society ?? undefined;
  const key = (...rest: readonly unknown[]) => queryKeys.scoped(scope.society, null, ...rest);
  return { user, ready, society, key };
}

/** Compteurs Commercial et Facturation calculés par le serveur. */
export function useErpCounters() {
  const { user, ready, society, key } = useScopedQueryContext();
  const enabled = ready && (access.commercial(user) || access.billing(user));
  return useQuery({ queryKey: key('erp-counters'), queryFn: () => fetchErpCounters(api, society), enabled, staleTime: TWO_MINUTES });
}

/** Devis en cours (envoyés, en attente de réponse) : le total vient de la pagination serveur. */
export function useQuotesSent() {
  const { user, ready, society, key } = useScopedQueryContext();
  return useQuery({
    queryKey: key('quotes', 'sent-total'),
    queryFn: () => fetchQuotesPage(api, { society, status: 'envoyé', page_size: 5 }),
    enabled: ready && access.commercial(user),
    staleTime: TWO_MINUTES,
  });
}

export function useRecentQuotes() {
  const { user, ready, society, key } = useScopedQueryContext();
  return useQuery({
    queryKey: key('quotes', 'recent'),
    queryFn: () => fetchQuotesPage(api, { society, page_size: 5 }),
    enabled: ready && access.commercial(user),
  });
}

export function useAllClients() {
  const { user, ready, society, key } = useScopedQueryContext();
  return useQuery({ queryKey: key('clients', 'all'), queryFn: () => fetchAllClients(api, society), enabled: ready && access.commercial(user), staleTime: FIVE_MINUTES });
}

export function useProspects() {
  const { user, ready, key } = useScopedQueryContext();
  return useQuery({ queryKey: key('prospects'), queryFn: () => fetchProspects(api), enabled: ready && access.commercial(user), staleTime: TWO_MINUTES });
}

export function useOpportunities() {
  const { user, ready, key } = useScopedQueryContext();
  return useQuery({ queryKey: key('opportunities'), queryFn: () => fetchOpportunities(api), enabled: ready && access.commercial(user), staleTime: TWO_MINUTES });
}

/** Chiffre d'affaires et encaissements du mois en cours (module Finances). */
export function useMonthSales() {
  const { user, ready, society, key } = useScopedQueryContext();
  const period = currentMonth();
  return useQuery({
    queryKey: key('sales-dashboard', period.from, period.to),
    queryFn: () => fetchSalesDashboard(api, period, society),
    enabled: ready && access.salesReports(user),
    staleTime: FIVE_MINUTES,
  });
}

export function useMonthSalesByStatus() {
  const { user, ready, society, key } = useScopedQueryContext();
  const period = currentMonth();
  return useQuery({
    queryKey: key('sales-by-status', period.from, period.to),
    queryFn: () => fetchSalesByStatus(api, period, society),
    enabled: ready && access.salesReports(user),
    staleTime: FIVE_MINUTES,
  });
}

export function useInvoices() {
  const { user, ready, key } = useScopedQueryContext();
  return useQuery({ queryKey: key('invoices'), queryFn: () => fetchInvoices(api), enabled: ready && access.billing(user), staleTime: TWO_MINUTES });
}

export function usePayments() {
  const { user, ready, key } = useScopedQueryContext();
  return useQuery({ queryKey: key('payments'), queryFn: () => fetchPayments(api), enabled: ready && access.billing(user), staleTime: TWO_MINUTES });
}

/** Meilleurs clients du mois en chiffre d'affaires TTC, classés par le serveur (module Finances). */
export function useMonthTopClients() {
  const { user, ready, society, key } = useScopedQueryContext();
  const period = currentMonth();
  return useQuery({
    queryKey: key('top-clients', period.from, period.to),
    queryFn: () => fetchTopClients(api, period, society),
    enabled: ready && access.salesReports(user),
    staleTime: FIVE_MINUTES,
  });
}
