import { ApiError, errorFromResponse } from './errors';

export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** false pour les appels publics (login) : aucun jeton n'est envoyé. */
  authenticated?: boolean;
  timeoutMs?: number;
};

export type ApiClientDeps = {
  baseUrl: string | null;
  getToken: () => string | null;
  /**
   * Renouvelle le jeton d'accès (refresh token). Reçoit le jeton refusé, renvoie le
   * nouveau, ou null si la session n'est pas renouvelable. Peut lever une erreur réseau.
   */
  refreshToken?: (staleToken: string | null) => Promise<string | null>;
  /** Appelé quand le backend refuse le jeton d'une requête authentifiée. */
  onUnauthorized: () => void;
  /** Refus de permission sur une requête authentifiée : les droits ont pu changer. */
  onForbidden?: () => void;
  /** Le backend exige une version plus récente de l'application (HTTP 426). */
  onUpgradeRequired?: () => void;
  /** En-têtes d'identification du client (version, plateforme). Jamais de secret. */
  clientHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type ApiClient = {
  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T>;
};

const DEFAULT_TIMEOUT_MS = 20_000;

/** Identifiant de corrélation repris par le journal d'audit du backend (X-Correlation-Id). */
function newCorrelationId(): string {
  let id = '';
  for (let index = 0; index < 32; index += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  // Chemins relatifs à l'API uniquement : le jeton ne doit jamais partir vers un autre hôte.
  if (!path.startsWith('/api/') || path.includes('://') || path.includes('..')) {
    throw new ApiError({ kind: 'config' });
  }
  const params: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return `${baseUrl}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  // `fetch` est lu à chaque appel : un client créé au chargement du module n'en fige pas une copie.
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));

  async function renew(staleToken: string | null): Promise<string | null> {
    if (!deps.refreshToken) return null;
    try {
      return await deps.refreshToken(staleToken);
    } catch (error) {
      // Refus du backend : la session est perdue. Panne réseau : elle est conservée.
      if (error instanceof ApiError && (error.kind === 'unauthorized' || error.kind === 'forbidden')) return null;
      throw error instanceof ApiError ? error : new ApiError({ kind: 'network' });
    }
  }

  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (!deps.baseUrl) throw new ApiError({ kind: 'config' });
    const url = buildUrl(deps.baseUrl, path, options.query);
    const authenticated = options.authenticated !== false;

    let token: string | null = null;
    if (authenticated) {
      token = deps.getToken() ?? (await renew(null));
      if (!token) {
        deps.onUnauthorized();
        throw new ApiError({ kind: 'unauthorized', status: 401 });
      }
    }

    let attempt = await send(method, url, options, token);
    if (attempt.response.status === 401 && authenticated) {
      // Jeton d'accès expiré ou session renouvelée ailleurs : un seul nouvel essai.
      const fresh = await renew(token);
      if (fresh && fresh !== token) attempt = await send(method, url, options, fresh);
    }

    const { response, correlationId } = attempt;
    const body = await readBody(response);
    if (!response.ok) {
      if (response.status === 401 && authenticated) deps.onUnauthorized();
      if (response.status === 403 && authenticated) deps.onForbidden?.();
      if (response.status === 426) deps.onUpgradeRequired?.();
      throw errorFromResponse(response.status, body, response.headers, correlationId);
    }
    return body as T;
  }

  async function send(
    method: string,
    url: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<{ response: Response; correlationId: string }> {
    const correlationId = newCorrelationId();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...deps.clientHeaders,
      'X-Correlation-Id': correlationId,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      return { response, correlationId };
    } catch (cause) {
      if (options.signal?.aborted && !timedOut) throw cause;
      throw new ApiError({ kind: timedOut ? 'timeout' : 'network', correlationId });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  return {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  };
}
