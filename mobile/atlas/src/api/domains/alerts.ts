import type { ApiClient } from '../client';
import type { Page } from '../types';
import { asArray, asNullableNumber, asNullableString, asNumber, asRecord, asString } from './shared';

export type AlertStatus = 'open' | 'acknowledged' | 'assigned' | 'deferred' | 'treated' | 'ignored' | 'resolved';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export type Alert = {
  id: number;
  ruleKey: string;
  society: string;
  siteId: number | null;
  status: AlertStatus;
  severity: AlertSeverity;
  title: string;
  summary: string | null;
  lastDetectedAt: string;
  occurrenceCount: number;
  assignedUserId: number | null;
};

export type AlertDetail = Alert & {
  explanation: string | null;
  history: { id: number; action: string; newStatus: string | null; createdAt: string }[];
};

const STATUSES: readonly string[] = ['open', 'acknowledged', 'assigned', 'deferred', 'treated', 'ignored', 'resolved'];
const SEVERITIES: readonly string[] = ['info', 'warning', 'critical'];

/** Statuts sur lesquels une action de l'utilisateur est encore possible (cycle de vie backend). */
export const ACTIONABLE_STATUSES: readonly AlertStatus[] = ['open', 'acknowledged', 'assigned', 'deferred'];

function toAlert(raw: unknown): Alert {
  const row = asRecord(raw);
  const status = asString(row.status);
  const severity = asString(row.severity);
  return {
    id: asNumber(row.id),
    ruleKey: asString(row.rule_key),
    society: asString(row.society),
    siteId: asNullableNumber(row.site_id),
    // Une valeur inconnue est traitée comme la plus prudente : ouverte, à regarder.
    status: (STATUSES.includes(status) ? status : 'open') as AlertStatus,
    severity: (SEVERITIES.includes(severity) ? severity : 'warning') as AlertSeverity,
    title: asString(row.title),
    summary: asNullableString(row.summary),
    lastDetectedAt: asString(row.last_detected_at),
    occurrenceCount: asNumber(row.occurrence_count) || 1,
    assignedUserId: asNullableNumber(row.assigned_user_id),
  };
}

export type AlertQuery = { status?: AlertStatus; severity?: AlertSeverity; society?: string; site_id?: number; page?: number; page_size?: number };

export async function fetchAlerts(client: ApiClient, query: AlertQuery = {}): Promise<Page<Alert>> {
  const raw = asRecord(await client.get<unknown>('/api/alerts', { query }));
  return {
    items: asArray(raw.items).map(toAlert),
    total: asNumber(raw.total),
    page: asNumber(raw.page) || 1,
    page_size: asNumber(raw.page_size) || 25,
    pages: asNumber(raw.pages) || 1,
  };
}

export type AlertStats = { totalOpen: number; critical: number; unacknowledged: number; assignedToMe: number };

export async function fetchAlertStats(client: ApiClient): Promise<AlertStats> {
  const raw = asRecord(await client.get<unknown>('/api/alerts/stats'));
  return {
    totalOpen: asNumber(raw.total_open),
    critical: asNumber(raw.critical),
    unacknowledged: asNumber(raw.unacknowledged),
    assignedToMe: asNumber(raw.assigned_to_me),
  };
}

export async function fetchAlert(client: ApiClient, id: number): Promise<AlertDetail> {
  const raw = asRecord(await client.get<unknown>(`/api/alerts/${id}`));
  return {
    ...toAlert(raw),
    explanation: asNullableString(raw.explanation),
    history: asArray(raw.history).map((entry) => {
      const row = asRecord(entry);
      return { id: asNumber(row.id), action: asString(row.action), newStatus: asNullableString(row.new_status), createdAt: asString(row.created_at) };
    }),
  };
}

export type AlertAction = 'acknowledge' | 'treated';

/** Transition demandée au backend, qui valide le cycle de vie (409 si refusée). */
export async function applyAlertAction(client: ApiClient, id: number, action: AlertAction): Promise<Alert> {
  return toAlert(await client.post<unknown>(`/api/alerts/${id}/${action}`));
}
