/** Référentiels légers (sans snapshot global) — app/modules/irongs/routes.py. */
import type { ApiClient } from './client';

export function createReferenceApi(client: ApiClient) {
  return {
    /** GET /api/irongs/societes → sociétés visibles par l'utilisateur (cloisonnées serveur). */
    societes(): Promise<string[]> {
      return client
        .get<{ societes: string[] }>('/irongs/societes')
        .then((r) => r.societes ?? []);
    },
  };
}

export type ReferenceApi = ReturnType<typeof createReferenceApi>;
