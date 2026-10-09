import type { CurrentScope } from '@/scope/model';

/**
 * Filtres de périmètre envoyés au backend. Ce n'est qu'une restriction de
 * confort : le backend applique de toute façon le périmètre du compte.
 */
export function scopeParams(scope: Pick<CurrentScope, 'society' | 'site'>): { society?: string; site_id?: number } {
  return { society: scope.society ?? undefined, site_id: scope.site?.id };
}

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
export const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
export const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
export const asNullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
