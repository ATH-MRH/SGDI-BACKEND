import type { ApiClient } from '../client';
import { asAmount } from './commercial';
import { asArray, asNullableString, asNumber, asRecord, asString } from './shared';

/**
 * Facturation : factures et règlements de l'application Facturation d'ATLAS
 * (collections /api/irongs, module Facturation), et synthèses calculées par le
 * serveur (/api/reporting, module Finances). Lecture seule.
 *
 * Le serveur ne publie ni « payé » ni « reste à payer » par facture : le mobile
 * ne les recalcule pas, il affiche les règlements enregistrés et le statut stocké.
 */

export type InvoiceLine = { key: string; designation: string; quantity: number | null; unit: string | null; unitPrice: number | null; totalHt: number | null; kind: string };

export type Invoice = {
  /** Identifiant ATLAS de la facture (celui de la route de détail). */
  id: string;
  number: string;
  date: string | null;
  dueDate: string | null;
  client: string;
  clientId: string | null;
  society: string | null;
  object: string | null;
  site: string | null;
  status: string;
  totalHt: number | null;
  vat: number | null;
  totalTtc: number | null;
  paymentMode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: InvoiceLine[];
};

export function toInvoice(raw: unknown): Invoice {
  const row = asRecord(raw);
  return {
    id: String(row.id ?? ''),
    number: asString(row.numero),
    date: asNullableString(row.date),
    dueDate: asNullableString(row.dateEcheance) ?? asNullableString(row.echeance),
    client: asString(row.clientNom) || asString(row.client),
    clientId: row.clientId === undefined || row.clientId === null ? null : String(row.clientId),
    society: asNullableString(row.societe),
    object: asNullableString(row.objet),
    site: asNullableString(row.siteNom),
    status: asString(row.statut) || 'brouillon',
    totalHt: asAmount(row.totalHT) ?? asAmount(row.montantHT),
    vat: asAmount(row.tvaAmt),
    totalTtc: asAmount(row.ttc) ?? asAmount(row.montantTTC),
    paymentMode: asNullableString(row.modeReglement),
    periodStart: asNullableString(row.periodeDebut),
    periodEnd: asNullableString(row.periodeFin),
    lines: asArray(row.lignes)
      .map((entry, index) => {
        const line = asRecord(entry);
        return {
          key: `${index}`,
          designation: asString(line.designation),
          quantity: asAmount(line.quantite) ?? asAmount(line.qte) ?? asAmount(line.nbr),
          unit: asNullableString(line.unite),
          unitPrice: asAmount(line.prixUnitHT) ?? asAmount(line.prixUnitaire),
          totalHt: asAmount(line.totalHT),
          kind: asString(line.type) || 'article',
        };
      })
      .filter((line) => line.designation),
  };
}

export async function fetchInvoices(client: ApiClient): Promise<Invoice[]> {
  return asArray(await client.get<unknown>('/api/irongs/collections/factures/items'))
    .map(toInvoice)
    .filter((invoice) => invoice.id);
}

/** Détail d'une facture : le serveur refuse (404) une facture hors du périmètre du compte. */
export async function fetchInvoice(client: ApiClient, id: string): Promise<Invoice> {
  return toInvoice(await client.get<unknown>(`/api/irongs/collections/factures/items/${encodeURIComponent(id)}`));
}

export type Payment = { id: string; invoiceId: string | null; date: string | null; amount: number | null; mode: string | null; reference: string | null; client: string | null; society: string | null };

export async function fetchPayments(client: ApiClient): Promise<Payment[]> {
  return asArray(await client.get<unknown>('/api/irongs/collections/paiements/items'))
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? ''),
        invoiceId: row.factureId === undefined || row.factureId === null ? null : String(row.factureId),
        date: asNullableString(row.date),
        amount: asAmount(row.montant),
        mode: asNullableString(row.mode),
        reference: asNullableString(row.reference),
        client: asNullableString(row.client),
        society: asNullableString(row.societe),
      };
    })
    .filter((payment) => payment.id);
}

export type Period = { from: string; to: string };

/** Chiffre d'affaires et encaissements de la période (GET /api/reporting/dashboard). */
export type SalesDashboard = { revenueHt: number; revenueTtc: number; collected: number; invoices: number; quotes: number; clients: number };

export async function fetchSalesDashboard(client: ApiClient, period: Period, society?: string): Promise<SalesDashboard> {
  const raw = asRecord(await client.get<unknown>('/api/reporting/dashboard', { query: { society, date_debut: period.from, date_fin: period.to } }));
  return {
    revenueHt: asAmount(raw.chiffre_affaires_ht) ?? 0,
    revenueTtc: asAmount(raw.chiffre_affaires_ttc) ?? 0,
    collected: asAmount(raw.paiements_encaisses) ?? 0,
    invoices: asNumber(raw.nb_factures),
    quotes: asNumber(raw.nb_devis),
    clients: asNumber(raw.nb_clients),
  };
}

export type StatusBreakdown = { total: number; amountTtc: number | null; byStatus: { status: string; count: number }[] };

/** Devis et factures par statut sur la période (GET /api/reporting/ventes). */
export type SalesByStatus = { quotes: StatusBreakdown; invoices: StatusBreakdown };

function breakdown(raw: unknown): StatusBreakdown {
  const row = asRecord(raw);
  return {
    total: asNumber(row.total),
    amountTtc: asAmount(row.montant_ttc),
    byStatus: Object.entries(asRecord(row.par_status))
      .map(([status, count]) => ({ status, count: asNumber(count) }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

export async function fetchSalesByStatus(client: ApiClient, period: Period, society?: string): Promise<SalesByStatus> {
  const raw = asRecord(await client.get<unknown>('/api/reporting/ventes', { query: { society, date_debut: period.from, date_fin: period.to } }));
  return { quotes: breakdown(raw.devis), invoices: breakdown(raw.factures) };
}

export async function fetchTopClients(client: ApiClient, period: Period, society?: string): Promise<{ client: string; totalTtc: number }[]> {
  return asArray(await client.get<unknown>('/api/reporting/top-clients', { query: { society, date_debut: period.from, date_fin: period.to, limit: 5 } }))
    .map((entry) => {
      const row = asRecord(entry);
      return { client: asString(row.client_name), totalTtc: asAmount(row.total_ttc) ?? 0 };
    })
    .filter((row) => row.client);
}
