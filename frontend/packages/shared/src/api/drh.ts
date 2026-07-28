/** API tableau de bord DRH — app/modules/drh/routes.py GET /drh/dashboard. */
import type { ApiClient } from './client';

export interface TrialPeriod {
  id: number;
  code: string;
  name: string;
  trial_end_date: string | null;
}

export interface DrhDashboard {
  employees_total: number;
  employees_by_status: Record<string, number>;
  candidates_by_status: Record<string, number>;
  leaves_pending: number;
  trial_periods: TrialPeriod[];
}

export function createDrhApi(client: ApiClient) {
  return {
    dashboard(params?: { society?: string }): Promise<DrhDashboard> {
      return client.get<DrhDashboard>('/drh/dashboard', { query: params });
    },
  };
}

export type DrhApi = ReturnType<typeof createDrhApi>;
