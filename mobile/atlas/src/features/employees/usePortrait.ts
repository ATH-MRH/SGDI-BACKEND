import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/api';

/**
 * Portrait d'un employé (GET /api/drh/employees/{id}/portrait).
 *
 * La route exige le jeton staff : l'image est donc chargée par le client HTTP — même jeton,
 * même renouvellement sur 401 — puis gardée en mémoire sous forme d'URI `data:`. Elle n'est
 * jamais écrite sur le disque, et le cache de données est vidé à chaque fermeture de session :
 * aucune photo ne passe d'un compte à l'autre.
 */
export type PortraitIssue = {
  /** `none` : aucune photo exploitable (404). `forbidden` : hors périmètre (403). `error` : le reste. */
  kind: 'none' | 'forbidden' | 'error';
  /** Code HTTP renvoyé par le backend, quand il y en a un. */
  status: number | null;
  /** Nature de l'erreur côté client (réseau, délai, réponse invalide…). */
  reason: string;
};

export type Portrait = { uri: string | null; issue: PortraitIssue | null };

export const portraitKey = (employeeId: number) => ['employee-portrait', employeeId] as const;

const TEN_MINUTES = 10 * 60_000;

export async function loadPortrait(employeeId: number): Promise<Portrait> {
  try {
    return { uri: await api.getImage(`/api/drh/employees/${employeeId}/portrait`), issue: null };
  } catch (error) {
    const status = error instanceof ApiError ? (error.status ?? null) : null;
    const reason = error instanceof ApiError ? error.kind : 'unknown';
    // 404 et 403 sont des réponses définitives : elles sont mises en cache comme telles.
    if (reason === 'not_found') return { uri: null, issue: { kind: 'none', status, reason } };
    if (reason === 'forbidden') return { uri: null, issue: { kind: 'forbidden', status, reason } };
    throw error;
  }
}

/** État du portrait d'un employé. `enabled: false` : rien n'est demandé (fiche sans photo, identifiant inutilisable). */
export function usePortrait(employeeId: number | null | undefined, enabled: boolean): { uri: string | null; issue: PortraitIssue | null; isLoading: boolean } {
  const usable = enabled && typeof employeeId === 'number' && Number.isInteger(employeeId) && employeeId > 0;
  const query = useQuery({
    queryKey: portraitKey(usable ? employeeId : 0),
    queryFn: () => loadPortrait(employeeId as number),
    enabled: usable,
    staleTime: TEN_MINUTES,
    gcTime: TEN_MINUTES,
    retry: false,
  });
  if (!usable) return { uri: null, issue: null, isLoading: false };
  if (query.error) {
    const error = query.error;
    return {
      uri: null,
      isLoading: false,
      issue: { kind: 'error', status: error instanceof ApiError ? (error.status ?? null) : null, reason: error instanceof ApiError ? error.kind : 'unknown' },
    };
  }
  return { uri: query.data?.uri ?? null, issue: query.data?.issue ?? null, isLoading: query.isPending };
}
