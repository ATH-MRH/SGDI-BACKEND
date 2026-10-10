/**
 * Écran ouvert quand l'utilisateur touche une notification.
 *
 * Le contenu d'une notification n'est pas digne de confiance : seule une route
 * interne connue est acceptée, jamais une URL. L'écran visé repasse de toute
 * façon par la session, les droits et le périmètre.
 */
const ROUTES: readonly RegExp[] = [
  /^\/alerts\/\d{1,12}$/,
  /^\/ops\/sites\/\d{1,12}$/,
  /^\/drh\/employees\/\d{1,12}$/,
  /^\/(incidents|abandons|attendance|brq|recruitment)$/,
  /^\/drh\/leaves$/,
  /^\/\(tabs\)\/(tasks|alerts)$/,
];

export function pushTarget(data: unknown): string | null {
  const route = typeof data === 'object' && data !== null ? (data as { route?: unknown }).route : null;
  if (typeof route !== 'string' || route.length > 60) return null;
  return ROUTES.some((pattern) => pattern.test(route)) ? route : null;
}
