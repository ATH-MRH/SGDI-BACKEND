import type { ApiClient } from '../client';
import type { Page } from '../types';
import { asArray, asNullableNumber, asNullableString, asNumber, asRecord, asString } from './shared';

/**
 * Fiche employé telle qu'affichée sur mobile. Seuls ces champs sont conservés :
 * le reste de la réponse (données historiques volumineuses, rémunération) n'est
 * ni gardé en mémoire ni mis en cache.
 */
export type Employee = {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  position: string | null;
  society: string | null;
  status: string;
  contractType: string | null;
  recruitDate: string | null;
  contractEndDate: string | null;
  phone: string | null;
  email: string | null;
  siteId: number | null;
  siteName: string | null;
  group: string | null;
};

function toEmployee(raw: unknown): Employee {
  const row = asRecord(raw);
  return {
    id: asNumber(row.id),
    code: asString(row.code),
    firstName: asString(row.first_name),
    lastName: asString(row.last_name),
    position: asNullableString(row.current_position) ?? asNullableString(row.position),
    society: asNullableString(row.society),
    status: asString(row.status) || 'actif',
    contractType: asNullableString(row.contract_type),
    recruitDate: asNullableString(row.recruit_date),
    contractEndDate: asNullableString(row.contract_end_date),
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    siteId: asNullableNumber(row.current_site_id),
    siteName: asNullableString(row.current_site_name),
    group: asNullableString(row.current_group_code),
  };
}

export type EmployeeMode = 'actifs' | 'absents' | 'suspension' | 'sortants' | 'all';
export type EmployeeQuery = { q?: string; mode?: EmployeeMode; society?: string; page?: number; page_size?: number };

export async function fetchEmployeesPage(client: ApiClient, query: EmployeeQuery = {}): Promise<Page<Employee>> {
  const raw = asRecord(await client.get<unknown>('/api/drh/employees/page', { query }));
  return {
    items: asArray(raw.items).map(toEmployee),
    total: asNumber(raw.total),
    page: asNumber(raw.page) || 1,
    page_size: asNumber(raw.page_size) || 25,
    pages: asNumber(raw.pages) || 1,
  };
}

export async function fetchEmployee(client: ApiClient, id: number): Promise<Employee> {
  return toEmployee(await client.get<unknown>(`/api/drh/employees/${id}`));
}

export type LeaveStatus = 'instance' | 'approuve' | 'refuse';

export type Leave = {
  id: number;
  employeeId: number;
  type: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
};

function toLeave(raw: unknown): Leave {
  const row = asRecord(raw);
  return {
    id: asNumber(row.id),
    employeeId: asNumber(row.employee_id),
    type: asString(row.leave_type) || 'conge',
    startDate: asString(row.start_date),
    endDate: asString(row.end_date),
    reason: asNullableString(row.reason),
    status: asString(row.status) || 'instance',
    createdAt: asString(row.created_at),
  };
}

export async function fetchLeaves(client: ApiClient, query: { status?: LeaveStatus; employee_id?: number } = {}): Promise<Leave[]> {
  return asArray(await client.get<unknown>('/api/drh/leaves', { query })).map(toLeave);
}

/** Décision transmise au backend, qui vérifie le droit de validation et le périmètre. */
export async function decideLeave(client: ApiClient, id: number, decision: 'approve' | 'refuse'): Promise<Leave> {
  return toLeave(await client.post<unknown>(`/api/drh/leaves/${id}/${decision}`));
}

export const LEAVE_TYPES = ['conge', 'maladie'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_REASON_MAX = 500;
/** Durée maximale d'une demande saisie sur mobile ; au-delà, c'est une erreur de saisie. */
export const LEAVE_MAX_DAYS = 366;

export type NewLeave = { employeeId: number; type: LeaveType; startDate: string; endDate: string; reason: string };
export type LeaveErrors = Partial<Record<'startDate' | 'endDate' | 'reason', 'required' | 'invalid' | 'order' | 'tooLong'>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Contrôle de saisie ; le backend reste seul juge de la demande. */
export function validateLeave(draft: { startDate: string | null; endDate: string | null; reason: string }): LeaveErrors {
  const errors: LeaveErrors = {};
  if (!draft.startDate || !ISO_DATE.test(draft.startDate)) errors.startDate = draft.startDate === '' ? 'required' : 'invalid';
  if (!draft.endDate || !ISO_DATE.test(draft.endDate)) errors.endDate = draft.endDate === '' ? 'required' : 'invalid';
  if (!errors.startDate && !errors.endDate) {
    const days = (Date.parse(draft.endDate!) - Date.parse(draft.startDate!)) / 86_400_000;
    if (days < 0) errors.endDate = 'order';
    else if (days > LEAVE_MAX_DAYS) errors.endDate = 'invalid';
  }
  if (draft.reason.trim().length > LEAVE_REASON_MAX) errors.reason = 'tooLong';
  return errors;
}

/**
 * Dépose une demande de congé pour un employé. Le statut n'est jamais envoyé :
 * une demande naît « en instance » et seule une validation peut l'approuver.
 */
export async function createLeave(client: ApiClient, leave: NewLeave): Promise<Leave> {
  return toLeave(
    await client.post<unknown>('/api/drh/leaves', {
      employee_id: leave.employeeId,
      leave_type: leave.type,
      start_date: leave.startDate,
      end_date: leave.endDate,
      reason: leave.reason.trim() || null,
    }),
  );
}

export type EmployeeDocument = { id: number; label: string; fileName: string | null; mimeType: string | null; createdAt: string };

export async function fetchEmployeeDocuments(client: ApiClient, employeeId: number): Promise<EmployeeDocument[]> {
  const rows = await client.get<unknown>('/api/drh/documents', { query: { owner_type: 'employee', owner_id: employeeId } });
  return asArray(rows).map((entry) => {
    const row = asRecord(entry);
    return {
      id: asNumber(row.id),
      label: asString(row.label),
      fileName: asNullableString(row.file_name),
      mimeType: asNullableString(row.mime_type),
      createdAt: asString(row.created_at),
    };
  });
}

export type Candidate = {
  id: number;
  firstName: string;
  lastName: string;
  desiredPosition: string | null;
  society: string | null;
  status: string;
  createdAt: string;
};

export type CandidateMode = 'new' | 'reserve' | 'recruited' | 'all';

export async function fetchCandidatesPage(
  client: ApiClient,
  query: { q?: string; mode?: CandidateMode; page?: number; page_size?: number } = {},
): Promise<Page<Candidate>> {
  const { mode, ...rest } = query;
  const raw = asRecord(
    await client.get<unknown>('/api/drh/candidates/page', { query: { ...rest, mode: mode === 'all' ? undefined : mode } }),
  );
  return {
    items: asArray(raw.items).map((entry) => {
      const row = asRecord(entry);
      return {
        id: asNumber(row.id),
        firstName: asString(row.first_name),
        lastName: asString(row.last_name),
        desiredPosition: asNullableString(row.desired_position),
        society: asNullableString(row.society),
        status: asString(row.status) || 'nouvelle',
        createdAt: asString(row.created_at),
      };
    }),
    total: asNumber(raw.total),
    page: asNumber(raw.page) || 1,
    page_size: asNumber(raw.page_size) || 25,
    pages: asNumber(raw.pages) || 1,
  };
}

export async function fetchPendingLeavesCount(client: ApiClient, society?: string): Promise<number> {
  const raw = asRecord(await client.get<unknown>('/api/drh/dashboard', { query: { society } }));
  return asNumber(raw.leaves_pending);
}
