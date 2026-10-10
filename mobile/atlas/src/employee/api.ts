import { Platform } from 'react-native';

import { createApiClient, type ApiClient } from '@/api/client';
import { asArray, asNullableString, asNumber, asRecord, asString } from '@/api/domains/shared';
import { ApiError } from '@/api/errors';
import { readTokenClaims } from '@/auth/token';
import { env } from '@/config/env';
import { getAppVersion } from '@/config/version';

/**
 * Accès mobile EMPLOYÉ (libre-service). Famille de jetons distincte de la session
 * staff : `token_use = "employee_mobile"`. Les deux ne se mélangent jamais — client
 * HTTP, stockage et routes sont séparés, et chaque côté refuse le jeton de l'autre.
 */
export const EMPLOYEE_TOKEN_USE = 'employee_mobile';

export type EmployeeSession = { token: string; expiresAt: number };

export type EmployeeProfile = {
  id: number;
  matricule: string;
  firstName: string;
  lastName: string;
  position: string | null;
  society: string | null;
  status: string;
  siteName: string | null;
  group: string | null;
};

export type SelfDay = { date: string; status: string; site: string; arrival: string; departure: string };
export type SelfLeave = { id: number; type: string; startDate: string; endDate: string; reason: string | null; status: string };
export type SelfShift = { key: string; date: string; start: string; end: string; group: string; rest: boolean };
export type SelfDocument = { id: number; label: string; createdAt: string };
export type SelfPayslip = { id: number; period: string; netToPay: string };

let current: EmployeeSession | null = null;
const rejectionListeners = new Set<() => void>();

export function setEmployeeSession(session: EmployeeSession | null): void {
  current = session;
}

export function onEmployeeSessionRejected(listener: () => void): () => void {
  rejectionListeners.add(listener);
  return () => {
    rejectionListeners.delete(listener);
  };
}

const { version, build } = getAppVersion();

/** Client HTTP du libre-service : ne porte que le jeton employé, jamais le jeton staff. */
export const employeeApi: ApiClient = createApiClient({
  baseUrl: env.apiUrl,
  getToken: () => (current && current.expiresAt > Date.now() ? current.token : null),
  onUnauthorized: () => {
    current = null;
    for (const listener of rejectionListeners) listener();
  },
  clientHeaders: { 'X-Atlas-Client': `mobile-${Platform.OS}`, 'X-Atlas-App-Version': version, 'X-Atlas-App-Build': build },
});

function toProfile(raw: unknown): EmployeeProfile {
  const row = asRecord(raw);
  return {
    id: asNumber(row.id),
    matricule: asString(row.matricule),
    firstName: asString(row.first_name),
    lastName: asString(row.last_name),
    position: asNullableString(row.position),
    society: asNullableString(row.society),
    status: asString(row.status),
    siteName: asNullableString(asRecord(row.site).name),
    group: asNullableString(row.group),
  };
}

/** N'accepte qu'un jeton Bearer de la famille employé, avec une échéance future. */
export function parseEmployeeLogin(response: unknown, now: number = Date.now()): { session: EmployeeSession; employee: EmployeeProfile } {
  const body = asRecord(response);
  const token = body.access_token;
  const claims = typeof token === 'string' ? readTokenClaims(token) : null;
  const employee = toProfile(body.employee);
  if (
    typeof token !== 'string' ||
    String(body.token_type ?? '').toLowerCase() !== 'bearer' ||
    !claims ||
    claims.tokenUse !== EMPLOYEE_TOKEN_USE ||
    claims.expiresAt === null ||
    claims.expiresAt <= now ||
    employee.id <= 0
  ) {
    throw new ApiError({ kind: 'invalid_response' });
  }
  return { session: { token, expiresAt: claims.expiresAt }, employee };
}

export async function employeeLogin(client: ApiClient, username: string, password: string) {
  const response = await client.post<unknown>('/api/employee-mobile/login', { username: username.trim(), password }, { authenticated: false });
  return parseEmployeeLogin(response);
}

export async function fetchSelfProfile(client: ApiClient): Promise<EmployeeProfile> {
  return toProfile(await client.get<unknown>('/api/employee-mobile/me'));
}

function toDays(raw: unknown): SelfDay[] {
  return asArray(asRecord(raw).days).map((entry) => {
    const row = asRecord(entry);
    return { date: asString(row.date), status: asString(row.status), site: asString(row.site), arrival: asString(row.arrival), departure: asString(row.departure) };
  });
}

export async function fetchSelfAttendance(client: ApiClient, days: number = 14): Promise<SelfDay[]> {
  return toDays(await client.get<unknown>('/api/employee-mobile/me/attendance', { query: { days } }));
}

export async function fetchSelfAbsences(client: ApiClient): Promise<SelfDay[]> {
  return toDays(await client.get<unknown>('/api/employee-mobile/me/absences'));
}

export async function fetchSelfLeaves(client: ApiClient): Promise<SelfLeave[]> {
  return asArray(asRecord(await client.get<unknown>('/api/employee-mobile/me/leaves')).items).map((entry) => {
    const row = asRecord(entry);
    return {
      id: asNumber(row.id), type: asString(row.leave_type) || 'conge', startDate: asString(row.start_date), endDate: asString(row.end_date),
      reason: asNullableString(row.reason), status: asString(row.status) || 'instance',
    };
  });
}

export async function fetchSelfPlanning(client: ApiClient, days: number = 7): Promise<SelfShift[]> {
  const raw = asRecord(await client.get<unknown>('/api/employee-mobile/me/planning', { query: { days } }));
  return asArray(raw.shifts).map((entry, index) => {
    const row = asRecord(entry);
    return {
      key: `${asString(row.date)}-${asString(row.start)}-${index}`, date: asString(row.date), start: asString(row.start), end: asString(row.end),
      group: asString(row.group), rest: row.rest === true,
    };
  });
}

export async function fetchSelfDocuments(client: ApiClient): Promise<SelfDocument[]> {
  return asArray(asRecord(await client.get<unknown>('/api/employee-mobile/me/documents')).items).map((entry) => {
    const row = asRecord(entry);
    return { id: asNumber(row.id), label: asString(row.label), createdAt: asString(row.created_at) };
  });
}

/** Montants affichés tels que la paie ATLAS les a validés : jamais recalculés ici. */
export async function fetchSelfPayslips(client: ApiClient): Promise<SelfPayslip[]> {
  return asArray(asRecord(await client.get<unknown>('/api/employee-mobile/me/payslips')).items).map((entry) => {
    const row = asRecord(entry);
    return { id: asNumber(row.id), period: asString(row.period), netToPay: asString(row.net_a_payer) };
  });
}
