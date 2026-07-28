/** API Recrutement / Candidats — app/modules/drh/routes.py (modèle Candidate + data JSON). */
import type { ApiClient } from './client';
import type { Paginated } from './incidents';

/**
 * Candidat = colonnes typées + blob `data` (toutes les données des 7 sections de la fiche :
 * nin, dateNaissance, avisDecision, wilaya, photo, cv, habilitations, langues, experience[],
 * flags de validation de section, archive…). Le mapping legacy vit dans utils/candidates.ts.
 */
export interface Candidate {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  desired_position: string | null;
  society: string | null;
  expected_salary: number | null;
  recruiter_opinion: string | null;
  status: string;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

export interface CandidateInput {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  email?: string | null;
  desired_position?: string | null;
  society?: string | null;
  expected_salary?: number | null;
  recruiter_opinion?: string | null;
  status?: string;
  data?: Record<string, unknown> | null;
}

export function createCandidatesApi(client: ApiClient) {
  return {
    page(params: { society?: string; status?: string; q?: string; page?: number; page_size?: number }): Promise<Paginated<Candidate>> {
      return client.get<Paginated<Candidate>>('/drh/candidates/page', { query: params });
    },
    list(params?: { society?: string; status?: string }): Promise<Candidate[]> {
      return client.get<Candidate[]>('/drh/candidates', { query: params });
    },
    create(body: CandidateInput): Promise<Candidate> {
      return client.post<Candidate>('/drh/candidates', body);
    },
    update(id: number, body: CandidateInput): Promise<Candidate> {
      return client.put<Candidate>(`/drh/candidates/${id}`, body);
    },
    validateSection(section: string, body: CandidateInput, candidateId?: number): Promise<unknown> {
      const query: Record<string, string | number> = { section };
      if (candidateId != null) query.candidate_id = candidateId;
      return client.post('/drh/candidates/validate-section', body, { query });
    },
    validateFinal(id: number): Promise<unknown> {
      return client.post(`/drh/candidates/${id}/validate-final`);
    },
    marquerContractualisation(id: number): Promise<unknown> {
      return client.post(`/drh/candidates/${id}/marquer-contractualisation`);
    },
    recruit(id: number): Promise<unknown> {
      return client.post(`/drh/candidates/${id}/recruit`);
    },
    remove(id: number): Promise<unknown> {
      return client.delete(`/drh/candidates/${id}`);
    },
  };
}

export type CandidatesApi = ReturnType<typeof createCandidatesApi>;
