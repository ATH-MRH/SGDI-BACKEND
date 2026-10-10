/**
 * Lecture LOCALE des claims d'un JWT ATLAS.
 *
 * Elle ne sert qu'au confort : fermer la session à l'heure et refuser d'emblée
 * une réponse de connexion qui ne serait pas un jeton staff. Elle n'autorise
 * rien : la validité et les droits sont décidés par le backend à chaque requête.
 */
export type TokenClaims = {
  /** Échéance en millisecondes Unix, ou null si absente. */
  expiresAt: number | null;
  /** Famille du jeton (`token_use`) ; "staff" pour une session ATLAS MOBILE. */
  tokenUse: string | null;
};

export const STAFF_TOKEN_USE = 'staff';

export function readTokenClaims(token: string): TokenClaims | null {
  const segments = token.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || !payload || typeof globalThis.atob !== 'function') return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const claims: unknown = JSON.parse(globalThis.atob(padded));
    if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
    const { exp, token_use: tokenUse } = claims as { exp?: unknown; token_use?: unknown };
    return {
      expiresAt: typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null,
      tokenUse: typeof tokenUse === 'string' ? tokenUse : null,
    };
  } catch {
    return null;
  }
}

export function readTokenExpiry(token: string): number | null {
  return readTokenClaims(token)?.expiresAt ?? null;
}
