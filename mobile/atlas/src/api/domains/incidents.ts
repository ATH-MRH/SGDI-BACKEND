import type { ApiClient } from '../client';
import { asArray, asNullableNumber, asNumber, asRecord, asString } from './shared';

/**
 * Incidents OPS. Le backend les expose par la collection historique
 * `incidents` : seuls les champs utiles à l'affichage sont conservés.
 */
export type Incident = {
  id: number;
  date: string;
  time: string;
  siteId: number | null;
  type: string;
  severity: string;
  subject: string;
  description: string;
  status: string;
  society: string;
};

export const INCIDENT_TYPES = ['intrusion', 'vol', 'agression', 'accident', 'incendie', 'materiel', 'discipline', 'autre'] as const;
export const INCIDENT_SEVERITIES = ['faible', 'moyenne', 'elevee', 'critique'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_SUBJECT_MAX = 255;
export const INCIDENT_DESCRIPTION_MAX = 4000;

function toIncident(raw: unknown): Incident {
  const row = asRecord(raw);
  return {
    id: asNumber(row.backendId),
    date: asString(row.date),
    time: asString(row.heure),
    siteId: asNullableNumber(row.siteBackendId),
    type: asString(row.type) || 'autre',
    severity: asString(row.gravite),
    subject: asString(row.sujet),
    description: asString(row.description),
    status: asString(row.statut) || 'ouvert',
    society: asString(row.societe),
  };
}

/** Incidents récents du périmètre de l'utilisateur (filtrés par société côté serveur). */
export async function fetchIncidents(client: ApiClient): Promise<Incident[]> {
  return asArray(await client.get<unknown>('/api/irongs/collections/incidents/items'))
    .map(toIncident)
    .filter((incident) => incident.id > 0);
}

export type NewIncident = {
  siteId: number;
  society: string;
  type: IncidentType;
  severity: IncidentSeverity;
  subject: string;
  description: string;
  /** Jour et heure locaux de l'appareil au moment de la déclaration. */
  date: string;
  time: string;
};

export type IncidentErrors = Partial<Record<'site' | 'society' | 'subject' | 'description', 'required' | 'tooLong'>>;

/** Contrôle de saisie côté téléphone ; le backend revalide société et périmètre. */
export function validateIncident(draft: Partial<NewIncident>): IncidentErrors {
  const errors: IncidentErrors = {};
  if (!Number.isInteger(draft.siteId) || (draft.siteId ?? 0) <= 0) errors.site = 'required';
  if (!draft.society?.trim()) errors.society = 'required';
  const subject = draft.subject?.trim() ?? '';
  if (!subject) errors.subject = 'required';
  else if (subject.length > INCIDENT_SUBJECT_MAX) errors.subject = 'tooLong';
  const description = draft.description?.trim() ?? '';
  if (!description) errors.description = 'required';
  else if (description.length > INCIDENT_DESCRIPTION_MAX) errors.description = 'tooLong';
  return errors;
}

/**
 * `clientId` identifie la déclaration côté téléphone : rejouer le même envoi (réseau
 * coupé avant la réponse, file hors connexion) met à jour la même ligne au lieu d'en créer une autre.
 */
export async function createIncident(client: ApiClient, incident: NewIncident, clientId?: string): Promise<Incident> {
  const created = await client.post<unknown>('/api/irongs/collections/incidents/items', {
    data: {
      ...(clientId ? { id: clientId } : {}),
      date: incident.date,
      heure: incident.time,
      siteBackendId: incident.siteId,
      societe: incident.society,
      type: incident.type,
      gravite: incident.severity,
      sujet: incident.subject.trim(),
      description: incident.description.trim(),
      statut: 'ouvert',
      origine: 'mobile',
    },
  });
  return toIncident(created);
}
