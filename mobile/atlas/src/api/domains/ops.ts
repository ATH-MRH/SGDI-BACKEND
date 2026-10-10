import { societyKey } from '@/auth/permissions';

import type { ApiClient } from '../client';
import type { Page } from '../types';
import { asArray, asNullableString, asNumber, asRecord, asString } from './shared';

export type Site = {
  id: number;
  name: string;
  indicatif: string | null;
  client: string | null;
  commune: string | null;
  wilaya: string | null;
  address: string | null;
  society: string | null;
  contractualStaff: number;
  active: boolean;
};

export type SiteAgent = { assignmentId: number; employeeId: number; code: string; name: string; position: string | null; group: string };

export type SiteDetail = {
  site: Site;
  contractualStaff: number;
  realizedStaff: number;
  missingStaff: number;
  surplusStaff: number;
  agents: SiteAgent[];
};

function toSite(raw: unknown): Site {
  const row = asRecord(raw);
  // La société d'un site est rangée dans son plan d'équipement : seul ce libellé est conservé.
  const plan = asRecord(row.equipment_plan);
  const legacy = asRecord(plan._legacy);
  const society = asNullableString(plan.societe) ?? asNullableString(plan.society) ?? asNullableString(legacy.societe);
  return {
    id: asNumber(row.id),
    name: asString(row.name),
    indicatif: asNullableString(row.indicatif),
    client: asNullableString(row.client_name),
    commune: asNullableString(row.commune),
    wilaya: asNullableString(row.wilaya),
    address: asNullableString(row.address),
    society,
    contractualStaff: asNumber(row.contractual_staff),
    active: row.active === 1 || row.active === true,
  };
}

export type SiteQuery = { q?: string; society?: string; page?: number; page_size?: number };

export async function fetchSitesPage(client: ApiClient, query: SiteQuery = {}): Promise<Page<Site>> {
  const raw = asRecord(await client.get<unknown>('/api/ops/sites/page', { query: { ...query, active: 1 } }));
  return {
    items: asArray(raw.items).map(toSite),
    total: asNumber(raw.total),
    page: asNumber(raw.page) || 1,
    page_size: asNumber(raw.page_size) || 25,
    pages: asNumber(raw.pages) || 1,
  };
}

export async function fetchSiteDetail(client: ApiClient, id: number): Promise<SiteDetail> {
  const raw = asRecord(await client.get<unknown>(`/api/ops/sites/${id}`));
  const agents: SiteAgent[] = [];
  for (const [group, members] of Object.entries(asRecord(raw.by_group))) {
    for (const entry of asArray(members)) {
      const row = asRecord(entry);
      agents.push({
        assignmentId: asNumber(row.assignment_id),
        employeeId: asNumber(row.employee_id),
        code: asString(row.code),
        name: asString(row.name),
        position: asNullableString(row.position),
        group,
      });
    }
  }
  agents.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return {
    site: toSite(raw.site),
    contractualStaff: asNumber(raw.contractual_staff),
    realizedStaff: asNumber(raw.realized_staff),
    missingStaff: asNumber(raw.missing_staff),
    surplusStaff: asNumber(raw.surplus_staff),
    agents,
  };
}

export function sameSociety(a: string | null | undefined, b: string | null | undefined): boolean {
  return societyKey(a) !== '' && societyKey(a) === societyKey(b);
}

export type PlannedShift = {
  key: string;
  date: string;
  start: string;
  end: string;
  group: string;
  rest: boolean;
  expectedCount: number;
};

/** Planning prévisionnel d'un site, projeté par le backend à partir de sa rotation. */
export async function fetchSitePlanning(client: ApiClient, siteId: number, dateFrom: string, dateTo: string): Promise<PlannedShift[]> {
  const raw = asRecord(
    await client.get<unknown>('/api/attendance/rotation-planning', { query: { site_id: siteId, date_from: dateFrom, date_to: dateTo } }),
  );
  return asArray(raw.occurrences).map((entry, index) => {
    const row = asRecord(entry);
    return {
      key: `${asString(row.date)}-${asString(row.group)}-${asString(row.start)}-${index}`,
      date: asString(row.date),
      start: asString(row.start),
      end: asString(row.end),
      group: asString(row.group),
      rest: row.rest === true,
      expectedCount: asNumber(row.expected_count),
    };
  });
}
