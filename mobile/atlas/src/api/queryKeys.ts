import type { QueryClient } from '@tanstack/react-query';

/**
 * Clés de cache. Tout ce qui dépend de la société ou du site sélectionnés vit
 * sous `scoped` : un changement de contexte n'invalide que cette branche.
 */
export const queryKeys = {
  scopeSites: (userId: number) => ['scope', 'sites', userId] as const,
  mobileConfig: ['mobile', 'config'] as const,
  scopedRoot: ['scoped'] as const,
  scoped: (society: string | null, siteId: number | null, ...rest: readonly unknown[]) =>
    ['scoped', society ?? '*', siteId ?? '*', ...rest] as const,
};

export function invalidateScopedQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: queryKeys.scopedRoot });
}
