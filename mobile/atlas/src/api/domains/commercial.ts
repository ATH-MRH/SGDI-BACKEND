import type { ApiClient } from '../client';
import type { Page } from '../types';
import { asArray, asNullableString, asNumber, asRecord, asString } from './shared';

/**
 * Commercial : clients et devis (routes SQL /api/commercial et /api/ventes, module `dc`),
 * prospects et opportunités (collections ATLAS /api/irongs, module commercial), et
 * compteurs calculés par le serveur (/api/ui/sidebar-stats). Lecture seule.
 */

/** Montant renvoyé en nombre ou en chaîne décimale ; null si absent ou illisible. */
export function asAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pageOf<T>(raw: unknown, map: (row: unknown) => T): Page<T> {
  const record = asRecord(raw);
  return {
    items: asArray(record.items).map(map),
    total: asNumber(record.total),
    page: asNumber(record.page) || 1,
    page_size: asNumber(record.page_size) || 25,
    pages: asNumber(record.pages) || 1,
  };
}

export type Client = {
  id: number;
  name: string;
  legalName: string | null;
  society: string | null;
  structure: string | null;
  status: string;
  contactName: string | null;
  contactPosition: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  services: string | null;
  contractStart: string | null;
  contractDuration: string | null;
  contractEnd: string | null;
  /** Statut du contrat DC enregistré (« brouillon », « valide ») ; null s'il n'existe pas. */
  contractStatus: string | null;
  /** Sites rattachés, comme le compte le serveur (tech_sites, sinon le nombre saisi). */
  sitesCount: number | null;
  siteNames: string[];
};

function siteNames(data: Record<string, unknown>): string[] {
  const contract = asArray(data.dc_contract_sites).map((site) => asString(asRecord(site).name));
  const tech = asArray(data.tech_sites).map((site) => asString(asRecord(site).nom) || asString(asRecord(site).denomination));
  return (contract.some(Boolean) ? contract : tech).filter(Boolean);
}

export function toClient(raw: unknown): Client {
  const row = asRecord(raw);
  const data = asRecord(row.data);
  const tech = data.tech_sites;
  const declared = Number(data.tech_nbrSite ?? data.nbrSite);
  return {
    id: asNumber(row.id),
    name: asString(row.name),
    legalName: asNullableString(row.legal_name),
    society: asNullableString(row.society),
    structure: asNullableString(row.structure),
    status: asString(row.status) || 'actif',
    contactName: asNullableString(row.contact_name),
    contactPosition: asNullableString(row.contact_position),
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    address: asNullableString(row.address),
    services: asNullableString(row.services),
    contractStart: asNullableString(row.contract_start),
    contractDuration: asNullableString(row.contract_duration),
    contractEnd: asNullableString(row.contract_end),
    contractStatus: asNullableString(data.dc_contract_status),
    sitesCount: Array.isArray(tech) ? tech.length : Number.isFinite(declared) && declared > 0 ? declared : null,
    siteNames: siteNames(data),
  };
}

export type ClientQuery = { q?: string; status?: string; society?: string; page?: number; page_size?: number };

export async function fetchClientsPage(client: ApiClient, query: ClientQuery = {}): Promise<Page<Client>> {
  return pageOf(await client.get<unknown>('/api/commercial/clients/page', { query }), toClient);
}

/** Tous les clients du périmètre : fiche client et contrats (le backend n'a pas de route par identifiant). */
export async function fetchAllClients(client: ApiClient, society?: string): Promise<Client[]> {
  return asArray(await client.get<unknown>('/api/commercial/clients', { query: { society } })).map(toClient).filter((row) => row.id > 0);
}

export type QuoteLine = { id: number; designation: string; quantity: number | null; unit: string | null; unitPrice: number | null; vatRate: number | null; totalHt: number | null; totalTtc: number | null };

export type Quote = {
  id: number;
  number: string;
  clientId: number | null;
  clientName: string;
  society: string | null;
  date: string | null;
  validUntil: string | null;
  object: string | null;
  status: string;
  totalHt: number | null;
  vat: number | null;
  totalTtc: number | null;
  lines: QuoteLine[];
};

function toQuote(raw: unknown): Quote {
  const row = asRecord(raw);
  return {
    id: asNumber(row.id),
    number: asString(row.numero),
    clientId: typeof row.client_id === 'number' ? row.client_id : null,
    clientName: asString(row.client_name),
    society: asNullableString(row.society),
    date: asNullableString(row.date_devis),
    validUntil: asNullableString(row.date_validite),
    object: asNullableString(row.objet),
    status: asString(row.status) || 'brouillon',
    totalHt: asAmount(row.total_ht),
    vat: asAmount(row.tva),
    totalTtc: asAmount(row.total_ttc),
    lines: asArray(row.lignes).map((entry) => {
      const line = asRecord(entry);
      return {
        id: asNumber(line.id),
        designation: asString(line.designation),
        quantity: asAmount(line.quantite),
        unit: asNullableString(line.unite),
        unitPrice: asAmount(line.prix_unitaire_ht),
        vatRate: asAmount(line.tva_pct),
        totalHt: asAmount(line.total_ht),
        totalTtc: asAmount(line.total_ttc),
      };
    }),
  };
}

/** Statuts de devis tels que le backend les enregistre. */
export const QUOTE_STATUSES = ['brouillon', 'envoyé', 'accepté', 'annulé'] as const;

export type QuoteQuery = { q?: string; status?: string; client_id?: number; society?: string; page?: number; page_size?: number };

export async function fetchQuotesPage(client: ApiClient, query: QuoteQuery = {}): Promise<Page<Quote>> {
  return pageOf(await client.get<unknown>('/api/ventes/devis/page', { query }), toQuote);
}

export async function fetchQuote(client: ApiClient, id: number): Promise<Quote> {
  return toQuote(await client.get<unknown>(`/api/ventes/devis/${id}`));
}

export type Prospect = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  society: string | null;
  source: string | null;
  score: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
};

export const PROSPECT_STATUSES = ['nouveau', 'contacte', 'interesse', 'rdv_planifie', 'rdv_realise', 'converti', 'perdu'] as const;

export async function fetchProspects(client: ApiClient): Promise<Prospect[]> {
  return asArray(await client.get<unknown>('/api/irongs/collections/prospects/items'))
    .map((entry) => {
      const row = asRecord(entry);
      const score = row.score;
      return {
        id: String(row.id ?? ''),
        name: asString(row.nom),
        contact: asNullableString(row.contact),
        phone: asNullableString(row.tel),
        email: asNullableString(row.email),
        society: asNullableString(row.societe),
        source: asNullableString(row.source),
        score: typeof score === 'number' || typeof score === 'string' ? String(score) || null : null,
        status: asString(row.statut) || 'nouveau',
        createdBy: asNullableString(row.createdBy),
        createdAt: asNullableString(row.createdAt),
      };
    })
    .filter((prospect) => prospect.id && prospect.name);
}

export type Opportunity = {
  id: string;
  title: string;
  target: string | null;
  amount: number | null;
  probability: number | null;
  closeDate: string | null;
  stage: string;
  society: string | null;
  createdBy: string | null;
};

export const OPPORTUNITY_STAGES = ['nouveau', 'qualification', 'proposition', 'negociation', 'gagnee', 'perdue'] as const;

export async function fetchOpportunities(client: ApiClient): Promise<Opportunity[]> {
  return asArray(await client.get<unknown>('/api/irongs/collections/opportunites/items'))
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: String(row.id ?? ''),
        title: asString(row.intitule),
        target: asNullableString(row.cible),
        amount: asAmount(row.montant),
        probability: asAmount(row.probabilite),
        closeDate: asNullableString(row.dateCloture),
        stage: asString(row.etape) || 'nouveau',
        society: asNullableString(row.societe),
        createdBy: asNullableString(row.createdBy),
      };
    })
    .filter((opportunity) => opportunity.id && opportunity.title);
}

/** Compteurs calculés par le serveur (GET /api/ui/sidebar-stats), sur le périmètre du compte. */
export type ErpCounters = {
  commercial: {
    prospects: number;
    clientsActive: number;
    clientsTotal: number;
    sitesTotal: number;
    opportunitiesOpen: number;
    contractsActive: number;
    contractsEnding30d: number;
  } | null;
  billing: {
    invoicesTotal: number;
    invoicesIssued: number;
    invoicedTtc: number;
    paymentsTotal: number;
    paymentsAmount: number;
    creditNotesTotal: number;
  } | null;
};

export async function fetchErpCounters(client: ApiClient, society?: string): Promise<ErpCounters> {
  const raw = asRecord(await client.get<unknown>('/api/ui/sidebar-stats', { query: { society } }));
  const commercial = asRecord(raw.commercial);
  const billing = asRecord(raw.facturation);
  return {
    commercial: Object.keys(commercial).length
      ? {
          prospects: asNumber(commercial.prospects),
          clientsActive: asNumber(commercial.clients_active),
          clientsTotal: asNumber(commercial.clients_total),
          sitesTotal: asNumber(commercial.sites_total),
          opportunitiesOpen: asNumber(commercial.opportunities_open),
          contractsActive: asNumber(commercial.contracts_active),
          contractsEnding30d: asNumber(commercial.contracts_30d),
        }
      : null,
    billing: Object.keys(billing).length
      ? {
          invoicesTotal: asNumber(billing.invoices_total),
          invoicesIssued: asNumber(billing.invoices_issued),
          invoicedTtc: asAmount(billing.invoiced_ttc) ?? 0,
          paymentsTotal: asNumber(billing.payments_total),
          paymentsAmount: asAmount(billing.payments_amount) ?? 0,
          creditNotesTotal: asNumber(billing.credit_notes_total),
        }
      : null,
  };
}
