/** API Incidents / Main courante — app/modules/ops/routes.py (modèle Incident). */
import type { ApiClient } from './client';

export interface IncidentAction {
  date: string;
  user: string;
  type: string;
  note: string;
}

export interface Incident {
  id: number;
  incident_date: string | null;
  incident_time: string | null;
  event_type: string | null; // 'site' | 'autre'
  category: string | null;
  severity: string | null; // mineur | majeur | critique
  subject: string | null;
  description: string | null;
  consigne: string | null;
  destinataire: string | null;
  actions: IncidentAction[];
  status: string; // en_cours | acquitte | clos
  site_id: number | null;
  employee_id: number | null;
  society: string | null;
  created_at: string | null;
}

export interface IncidentInput {
  incident_date?: string | null;
  incident_time?: string | null;
  event_type?: string;
  category?: string | null;
  severity?: string | null;
  subject?: string | null;
  description?: string | null;
  consigne?: string | null;
  destinataire?: string | null;
  status?: string;
  site_id?: number | null;
  employee_id?: number | null;
  society?: string | null;
}

export interface IncidentKpis {
  total: number;
  site: number;
  autres: number;
  ouverts: number;
  critiques: number;
  clos: number;
  aujourdhui: number;
}

export interface IncidentDashboard {
  kpis: IncidentKpis;
  alertes: Incident[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export type IncidentActionName = 'acquitter' | 'escalader' | 'cloturer' | 'commenter';

export function createIncidentsApi(client: ApiClient) {
  return {
    dashboard(): Promise<IncidentDashboard> {
      return client.get<IncidentDashboard>('/ops/incidents/dashboard');
    },
    page(params: { event_type?: string; status?: string; q?: string; page?: number; page_size?: number }): Promise<Paginated<Incident>> {
      return client.get<Paginated<Incident>>('/ops/incidents/page', { query: params });
    },
    get(id: number): Promise<Incident> {
      return client.get<Incident>(`/ops/incidents/${id}`);
    },
    create(body: IncidentInput): Promise<Incident> {
      return client.post<Incident>('/ops/incidents', body);
    },
    update(id: number, body: IncidentInput): Promise<Incident> {
      return client.patch<Incident>(`/ops/incidents/${id}`, body);
    },
    action(id: number, action: IncidentActionName, note?: string): Promise<Incident> {
      return client.post<Incident>(`/ops/incidents/${id}/action`, { action, note });
    },
  };
}

export type IncidentsApi = ReturnType<typeof createIncidentsApi>;
