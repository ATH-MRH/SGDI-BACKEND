import { ApiError, errorAction, errorFromResponse, errorMessageKey, normalizeDetail } from '@/api/errors';

describe('normalizeDetail', () => {
  it('lit un message simple', () => {
    expect(normalizeDetail('Identifiants incorrects')).toEqual({ serverMessage: 'Identifiants incorrects' });
  });

  it('transforme une erreur de validation Pydantic en erreurs par champ', () => {
    const detail = [
      { type: 'missing', loc: ['body', 'username'], msg: 'Field required' },
      { type: 'string_too_short', loc: ['body', 'data', 'label'], msg: 'Too short' },
      { loc: [], msg: 'Global' },
      'bruit',
    ];
    expect(normalizeDetail(detail)).toEqual({
      fieldErrors: { username: 'Field required', 'data.label': 'Too short', _: 'Global' },
    });
  });

  it('lit un détail structuré {code, message}', () => {
    expect(normalizeDetail({ code: 'TERMINAL_REVOKED', message: 'Terminal révoqué' })).toEqual({
      serverMessage: 'Terminal révoqué',
      code: 'TERMINAL_REVOKED',
    });
  });

  it('ignore un détail inexploitable', () => {
    expect(normalizeDetail(undefined)).toEqual({});
    expect(normalizeDetail(42)).toEqual({});
  });
});

describe('errorFromResponse', () => {
  it.each([
    [400, 'validation'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation'],
    [429, 'rate_limited'],
    [426, 'upgrade_required'],
    [500, 'server'],
    [503, 'server'],
    [418, 'unknown'],
  ])('classe le statut %i en %s', (status, kind) => {
    expect(errorFromResponse(status, { detail: 'x' }).kind).toBe(kind);
  });

  it('ne relaie jamais le texte serveur sur une 5xx', () => {
    const error = errorFromResponse(500, { detail: 'psycopg2.OperationalError: connection refused' });
    expect(error.serverMessage).toBeUndefined();
    expect(error.message).toBe('server');
  });

  it('lit Retry-After et X-Error-Code', () => {
    const headers = new Headers({ 'Retry-After': '300', 'X-Error-Code': 'CANDIDATE_LOCKED' });
    const error = errorFromResponse(429, { detail: 'Trop de tentatives' }, headers);
    expect(error.retryAfterSeconds).toBe(300);
    expect(error.code).toBe('CANDIDATE_LOCKED');
  });

  it('supporte un corps absent', () => {
    expect(errorFromResponse(403, undefined).kind).toBe('forbidden');
  });
});

describe('errorMessageKey', () => {
  it('associe chaque type à un message générique', () => {
    expect(errorMessageKey(new ApiError({ kind: 'network' }))).toBe('errors.network');
    expect(errorMessageKey(new ApiError({ kind: 'forbidden' }))).toBe('errors.forbidden');
    expect(errorMessageKey(new Error('boom'))).toBe('errors.unknown');
  });
});

describe('errorAction', () => {
  it.each([
    ['network', 'retry'],
    ['timeout', 'retry'],
    ['server', 'retry'],
    ['unauthorized', 'signIn'],
    ['forbidden', 'back'],
    ['not_found', 'back'],
    ['validation', 'back'],
    ['upgrade_required', 'update'],
    ['config', 'none'],
  ] as const)('propose pour %s l\'action %s', (kind, action) => {
    expect(errorAction(new ApiError({ kind }))).toBe(action);
  });

  it('propose de réessayer pour une erreur inconnue', () => {
    expect(errorAction(new Error('boom'))).toBe('retry');
  });
});
