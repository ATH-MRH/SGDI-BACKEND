/** Référentiels légers (sans snapshot global) — app/modules/irongs + ops + drh. */
import type { ApiClient } from './client';

export interface SiteRef {
  id: number;
  name: string;
}

export interface EmployeeRef {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
}

export function createReferenceApi(client: ApiClient) {
  return {
    /** GET /api/irongs/societes → sociétés visibles par l'utilisateur (cloisonnées serveur). */
    societes(): Promise<string[]> {
      return client
        .get<{ societes: string[] }>('/irongs/societes')
        .then((r) => r.societes ?? []);
    },
    /** GET /api/ops/sites → sites (id, name) pour les listes déroulantes. */
    sites(society?: string): Promise<SiteRef[]> {
      return client.get<SiteRef[]>('/ops/sites', { query: society ? { society } : undefined });
    },
    /** GET /api/drh/employees → employés (id, code, nom) pour les listes déroulantes. */
    employees(society?: string): Promise<EmployeeRef[]> {
      return client.get<EmployeeRef[]>('/drh/employees', { query: society ? { society } : undefined });
    },
  };
}

export type ReferenceApi = ReturnType<typeof createReferenceApi>;
