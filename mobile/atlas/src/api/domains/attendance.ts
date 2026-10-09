import type { ApiClient } from '../client';
import { asArray, asNullableNumber, asNullableString, asNumber, asRecord, asString } from './shared';

/** Tableau de présence du jour (GET /api/attendance/board). Calculé par le backend. */
export type BoardKpi = {
  expected: number;
  present: number;
  absent: number;
  not_pointed: number;
  late: number;
  conge: number;
  maladie: number;
  repos: number;
  anomalies: number;
  incomplete: number;
};

export type BoardItem = {
  employeeId: number;
  matricule: string;
  name: string;
  position: string;
  society: string;
  siteId: number | null;
  site: string;
  status: string;
  arrival: string;
  departure: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  anomalies: { id: number; type: string; message: string }[];
  /** Ligne de pointage corrigeable ; null tant que rien n'est enregistré pour ce jour. */
  presenceId: number | null;
  /** Journée clôturée : la correction exige alors le droit de validation. */
  closed: boolean;
};

export type Board = { date: string; kpi: BoardKpi; total: number; page: number; pages: number; page_size: number; items: BoardItem[] };

const KPI_KEYS = ['expected', 'present', 'absent', 'not_pointed', 'late', 'conge', 'maladie', 'repos', 'anomalies', 'incomplete'] as const;

function toBoardItem(raw: unknown): BoardItem {
  const row = asRecord(raw);
  const planning = asRecord(row.planning);
  return {
    employeeId: asNumber(row.employee_id),
    matricule: asString(row.matricule),
    name: asString(row.nom),
    position: asString(row.fonction),
    society: asString(row.society),
    siteId: asNullableNumber(row.site_id),
    site: asString(row.site),
    status: asString(row.status) || 'non_pointe',
    arrival: asString(row.arrival),
    departure: asString(row.departure),
    plannedStart: asNullableString(planning.start_time),
    plannedEnd: asNullableString(planning.end_time),
    presenceId: asNullableNumber(row.presence_id),
    closed: row.closed === true,
    anomalies: asArray(row.anomalies).map((entry) => {
      const anomaly = asRecord(entry);
      return { id: asNumber(anomaly.id), type: asString(anomaly.type), message: asString(anomaly.message) };
    }),
  };
}

export type BoardQuery = { society?: string; site_id?: number; status?: string; q?: string; page?: number; page_size?: number };

export async function fetchBoard(client: ApiClient, query: BoardQuery = {}): Promise<Board> {
  const raw = asRecord(await client.get<unknown>('/api/attendance/board', { query }));
  const kpiRaw = asRecord(raw.kpi);
  const kpi = Object.fromEntries(KPI_KEYS.map((key) => [key, asNumber(kpiRaw[key])])) as BoardKpi;
  return {
    date: asString(raw.date),
    kpi,
    total: asNumber(raw.total),
    page: asNumber(raw.page) || 1,
    pages: asNumber(raw.pages) || 1,
    page_size: asNumber(raw.page_size) || 25,
    items: asArray(raw.items).map(toBoardItem),
  };
}

/** Événement « abandon de poste » enregistré (GET /api/attendance/business-events). */
export type AbandonEvent = {
  eventId: number;
  employeeId: number;
  employeeName: string;
  matricule: string;
  society: string | null;
  siteId: number | null;
  siteName: string;
  position: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  departureAt: string;
  remainingMinutes: number | null;
  observation: string | null;
  recordedBy: string | null;
  createdAt: string;
};

function toAbandonEvent(raw: unknown): AbandonEvent {
  const row = asRecord(raw);
  const details = asRecord(row.details);
  return {
    eventId: asNumber(row.event_id),
    employeeId: asNumber(row.employee_id),
    employeeName: asString(details.employee_name),
    matricule: asString(details.matricule),
    society: asNullableString(row.society),
    siteId: asNullableNumber(row.site_id),
    siteName: asString(details.site_name),
    position: asString(details.position),
    scheduledStartAt: asNullableString(details.scheduled_start_at),
    scheduledEndAt: asNullableString(details.scheduled_end_at),
    departureAt: asString(row.actual_departure_at),
    remainingMinutes: asNullableNumber(details.remaining_minutes),
    observation: asNullableString(row.observation),
    recordedBy: asNullableString(details.recorded_by),
    createdAt: asString(row.created_at),
  };
}

export async function fetchAbandonEvents(
  client: ApiClient,
  query: { society?: string; site_id?: number; day?: string; page?: number; page_size?: number } = {},
): Promise<{ total: number; page: number; items: AbandonEvent[] }> {
  const raw = asRecord(
    await client.get<unknown>('/api/attendance/business-events', { query: { ...query, event_type: 'ABANDON_POSTE' } }),
  );
  return { total: asNumber(raw.total), page: asNumber(raw.page) || 1, items: asArray(raw.items).map(toAbandonEvent) };
}

/** Recherche d'un employé pour une saisie manuelle (2 caractères minimum, 8 résultats). */
export type ManualEmployee = { id: number; matricule: string; name: string; position: string; society: string; site: string };

export async function searchManualEmployees(
  client: ApiClient,
  query: { q: string; society?: string; site_id?: number },
): Promise<ManualEmployee[]> {
  if (query.q.trim().length < 2) return [];
  const rows = await client.get<unknown>('/api/portal/attendance-manual/search', { query });
  return asArray(rows).map((entry) => {
    const row = asRecord(entry);
    return {
      id: asNumber(row.id),
      matricule: asString(row.matricule),
      name: [asString(row.nom), asString(row.prenom)].filter(Boolean).join(' '),
      position: asString(row.poste),
      society: asString(row.societe),
      site: asString(row.site),
    };
  });
}

/**
 * Aperçu serveur d'un abandon de poste. La règle (départ au moins N minutes
 * avant la fin prévue) est calculée et tranchée par le backend : le mobile
 * affiche `applicable` et ne recalcule rien.
 */
export type AbandonContext = {
  shiftId: number;
  employeeId: number;
  employeeName: string;
  matricule: string;
  society: string | null;
  siteId: number;
  siteName: string;
  position: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  departureAt: string;
  remainingMinutes: number;
  thresholdMinutes: number;
  applicable: boolean;
};

export async function fetchAbandonContext(client: ApiClient, employeeId: number, siteId?: number): Promise<AbandonContext> {
  const row = asRecord(
    await client.get<unknown>('/api/portal/attendance-manual/abandon/context', {
      query: { employee_id: employeeId, site_id: siteId },
    }),
  );
  return {
    shiftId: asNumber(row.shift_id),
    employeeId: asNumber(row.employee_id),
    employeeName: asString(row.employee_name),
    matricule: asString(row.matricule),
    society: asNullableString(row.society),
    siteId: asNumber(row.site_id),
    siteName: asString(row.site_name),
    position: asString(row.position),
    scheduledStartAt: asString(row.scheduled_start_at),
    scheduledEndAt: asString(row.scheduled_end_at),
    departureAt: asString(row.actual_departure_at),
    remainingMinutes: asNumber(row.remaining_minutes),
    thresholdMinutes: asNumber(row.threshold_minutes),
    applicable: row.applicable === true,
  };
}

export const ABANDON_OBSERVATION_MAX = 500;

export async function declareAbandon(
  client: ApiClient,
  context: Pick<AbandonContext, 'employeeId' | 'siteId' | 'shiftId'>,
  observation: string,
): Promise<{ eventId: number; duplicate: boolean }> {
  const row = asRecord(
    await client.post<unknown>('/api/portal/attendance-manual/abandon', {
      employee_id: context.employeeId,
      site_id: context.siteId,
      shift_id: context.shiftId,
      observation: observation.trim(),
    }),
  );
  return { eventId: asNumber(row.event_id), duplicate: row.duplicate === true };
}

export type AttendanceDay = { id: number; date: string; status: string; site: string; arrival: string; departure: string };

/** Pointages récents d'un employé, tels que calculés par le moteur de pointage ATLAS. */
export async function fetchEmployeeAttendance(client: ApiClient, employeeId: number, days: number = 14): Promise<AttendanceDay[]> {
  const raw = asRecord(await client.get<unknown>(`/api/attendance/employees/${employeeId}`, { query: { days } }));
  return asArray(raw.days)
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: asNumber(row.id),
        date: asString(row.date),
        status: asString(row.status) || 'non_pointe',
        site: asString(row.site),
        arrival: asString(row.arrival),
        departure: asString(row.departure),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const CORRECTION_STATUSES = ['present', 'absent', 'conge', 'maladie', 'repos', 'mission'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];
export const CORRECTION_REASON_MIN = 3;
export const CORRECTION_REASON_MAX = 500;

export function validateCorrectionReason(reason: string): 'required' | 'tooShort' | 'tooLong' | null {
  const length = reason.trim().length;
  if (length === 0) return 'required';
  if (length < CORRECTION_REASON_MIN) return 'tooShort';
  return length > CORRECTION_REASON_MAX ? 'tooLong' : null;
}

/**
 * Corrige le statut d'une ligne de pointage. Le motif est obligatoire et journalisé ;
 * le moteur de pointage ATLAS applique la correction, le téléphone ne calcule rien.
 */
export async function correctPresence(client: ApiClient, presenceId: number, correction: { status: CorrectionStatus; reason: string }): Promise<{ status: string }> {
  const raw = asRecord(await client.patch<unknown>(`/api/attendance/presences/${presenceId}`, { status: correction.status, reason: correction.reason.trim() }));
  return { status: asString(raw.status) };
}
