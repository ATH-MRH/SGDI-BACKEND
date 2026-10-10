export type Candidate = { id: number; first_name: string; last_name: string; phone?: string; email?: string; desired_position?: string; society?: string; status: string; created_at: string; data?: Record<string, unknown> };
export type CandidatePage = { items: Candidate[]; total: number; page: number; pages: number };
export type CandidateStatus = { reference: string; label: string; message: string; position: string; updated_at?: string; convocation?: { date?: string; heure?: string; lieu?: string } };
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

const PRODUCTION_API = 'https://recrute.irongs.com/api';
// EXPO_PUBLIC_API_URL ne sert qu'aux essais sur un serveur de recette. Une adresse sans HTTPS
// n'est acceptée qu'en développement : une application distribuée parle toujours en HTTPS.
function resolveApi(): string {
  const override = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  const development = typeof __DEV__ !== 'undefined' && __DEV__;
  if (override.startsWith('https://') || (development && override.startsWith('http://'))) return override;
  return PRODUCTION_API;
}
export const API = resolveApi();
/** Origine du serveur, pour les logos servis sous /static. */
export const ORIGIN = API.replace(/\/api$/, '');

type Options = { token?: string; body?: unknown; method?: 'POST' | 'PUT' | 'DELETE'; signal?: AbortSignal };
export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(API + path, {
      method: options.method || (options.body === undefined ? 'GET' : 'POST'), signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : Array.isArray(data?.detail) ? data.detail.map((item: {msg: string}) => item.msg).join('\n') : 'Le serveur ne peut pas traiter cette demande.';
      throw new ApiError(response.status, detail);
    }
    if (data === null) throw new Error('Réponse du serveur invalide.');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new Error('Connexion indisponible. Vérifiez votre réseau puis réessayez.');
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Une erreur est survenue.';
