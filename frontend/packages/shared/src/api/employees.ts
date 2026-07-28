/** API Effectif & Agents — app/modules/drh/routes.py (modèle Employee + extra JSON). */
import type { ApiClient } from './client';
import type { Paginated } from './incidents';

/** Employé = colonnes typées + blob `extra` (dont `_legacy` = objet agent complet round-trippé). */
export interface Employee {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  father_name: string | null;
  mother_name: string | null;
  nin: string | null;
  birth_date: string | null;
  birth_place: string | null;
  family_status: string | null;
  children_count: number;
  phone: string | null;
  email: string | null;
  address: string | null;
  commune: string | null;
  wilaya: string | null;
  position: string | null;
  society: string | null;
  status: string;
  contract_type: string | null;
  salary_net: number;
  recruit_date: string | null;
  trial_end_date: string | null;
  contract_end_date: string | null;
  locked: number;
  extra: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

export type EmployeeInput = Partial<Omit<Employee, 'id' | 'created_at' | 'updated_at'>>;

export function createEmployeesApi(client: ApiClient) {
  return {
    page(params: { mode?: string; society?: string; q?: string; page?: number; page_size?: number }): Promise<Paginated<Employee>> {
      return client.get<Paginated<Employee>>('/drh/employees/page', { query: params });
    },
    list(params?: { status?: string; society?: string }): Promise<Employee[]> {
      return client.get<Employee[]>('/drh/employees', { query: params });
    },
    get(id: number): Promise<Employee> {
      return client.get<Employee>(`/drh/employees/${id}`);
    },
    create(body: EmployeeInput): Promise<Employee> {
      return client.post<Employee>('/drh/employees', body);
    },
    update(id: number, body: EmployeeInput): Promise<Employee> {
      return client.put<Employee>(`/drh/employees/${id}`, body);
    },
    remove(id: number): Promise<unknown> {
      return client.delete(`/drh/employees/${id}`);
    },
  };
}

export type EmployeesApi = ReturnType<typeof createEmployeesApi>;
