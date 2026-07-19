/**
 * Client API typé — wrapper fetch minimal.
 *  - même origine que le backend FastAPI (chemins relatifs `/api/...`) ;
 *  - jeton Bearer injecté automatiquement ;
 *  - 401 → callback `onUnauthorized` (redirection login gérée par l'app) ;
 *  - erreurs backend {detail} remontées comme `ApiError`.
 *
 * Aucune dépendance : remplace à terme le `fetch` dispersé de l'ancien front.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly body?: unknown,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Préfixe des routes (défaut: "/api"). */
  baseUrl?: string;
  /** Fournit le jeton courant (lu depuis le store de session). */
  getToken?: () => string | null;
  /** Appelé sur toute réponse 401 (session expirée / absente). */
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  signal?: AbortSignal;
}

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
    this.getToken = options.getToken ?? (() => null);
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options.signal,
    });

    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new ApiError(401, 'Session expirée ou non authentifiée');
    }

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json().catch(() => undefined) : undefined;

    if (!response.ok) {
      const detail =
        (payload && typeof payload === 'object' && 'detail' in payload
          ? String((payload as { detail: unknown }).detail)
          : undefined) ?? `Erreur ${response.status}`;
      throw new ApiError(response.status, detail, payload);
    }

    return payload as T;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}
