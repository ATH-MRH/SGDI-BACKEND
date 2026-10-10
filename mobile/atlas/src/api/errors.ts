import type { TranslationKey } from '@/i18n';

export type ApiErrorKind =
  | 'config'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'upgrade_required'
  | 'invalid_response'
  | 'server'
  | 'unknown';

type ApiErrorInit = {
  kind: ApiErrorKind;
  status?: number;
  /** Message métier renvoyé par le backend (4xx uniquement). */
  serverMessage?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  /** Identifiant de la requête, à communiquer au support (jamais de donnée sensible). */
  correlationId?: string;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly serverMessage?: string;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly correlationId?: string;

  constructor(init: ApiErrorInit) {
    super(init.serverMessage ?? init.kind);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.serverMessage = init.serverMessage;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.correlationId = init.correlationId;
  }
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status === 426) return 'upgrade_required';
  if (status >= 500) return 'server';
  return 'unknown';
}

type NormalizedDetail = Pick<ApiErrorInit, 'serverMessage' | 'code' | 'fieldErrors'>;

/**
 * Le backend renvoie `detail` sous trois formes : chaîne (cas général), liste
 * Pydantic (422) ou objet {code, message} / {message, reasons} selon le module.
 */
export function normalizeDetail(detail: unknown): NormalizedDetail {
  if (typeof detail === 'string') return { serverMessage: detail };

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const entry of detail) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { loc, msg } = entry as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') continue;
      const path = Array.isArray(loc) ? loc.filter((part) => part !== 'body' && part !== 'query') : [];
      fieldErrors[path.join('.') || '_'] = msg;
    }
    return Object.keys(fieldErrors).length ? { fieldErrors } : {};
  }

  if (typeof detail === 'object' && detail !== null) {
    const { message, code } = detail as { message?: unknown; code?: unknown };
    return {
      serverMessage: typeof message === 'string' ? message : undefined,
      code: typeof code === 'string' ? code : undefined,
    };
  }

  return {};
}

export function errorFromResponse(
  status: number,
  body: unknown,
  headers?: Headers,
  correlationId?: string,
): ApiError {
  const kind = kindFromStatus(status);
  const detail =
    typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  // Jamais de texte serveur sur une 5xx : il peut exposer des détails internes.
  const normalized = kind === 'server' ? {} : normalizeDetail(detail);
  const retryAfter = Number(headers?.get('Retry-After'));
  return new ApiError({
    kind,
    status,
    ...normalized,
    code: normalized.code ?? headers?.get('X-Error-Code') ?? undefined,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    correlationId,
  });
}

const MESSAGE_KEYS: Record<ApiErrorKind, TranslationKey> = {
  config: 'errors.config',
  network: 'errors.network',
  timeout: 'errors.timeout',
  unauthorized: 'errors.unauthorized',
  forbidden: 'errors.forbidden',
  not_found: 'errors.notFound',
  conflict: 'errors.conflict',
  validation: 'errors.validation',
  rate_limited: 'errors.rateLimited',
  upgrade_required: 'errors.upgradeRequired',
  invalid_response: 'errors.server',
  server: 'errors.server',
  unknown: 'errors.unknown',
};

/** Clé du message générique à afficher pour une erreur quelconque. */
export function errorMessageKey(error: unknown): TranslationKey {
  return error instanceof ApiError ? MESSAGE_KEYS[error.kind] : 'errors.unknown';
}

export type ErrorAction = 'retry' | 'signIn' | 'back' | 'update' | 'none';

/** Action à proposer à l'utilisateur pour une erreur donnée. */
export function errorAction(error: unknown): ErrorAction {
  if (!(error instanceof ApiError)) return 'retry';
  switch (error.kind) {
    case 'network':
    case 'timeout':
    case 'server':
    case 'rate_limited':
    case 'invalid_response':
    case 'unknown':
      return 'retry';
    case 'unauthorized':
      return 'signIn';
    case 'upgrade_required':
      return 'update';
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'validation':
      return 'back';
    case 'config':
      return 'none';
  }
}
