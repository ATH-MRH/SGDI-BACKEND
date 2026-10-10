import { readLocal, removeLocal, SCOPE_KEY, writeLocal } from '@/auth/localData';

import type { ScopeSelection } from './model';

type StoredScope = ScopeSelection & { userId: number };

function isStoredScope(value: unknown): value is StoredScope {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, society, siteId } = value as Record<string, unknown>;
  return (
    Number.isInteger(userId) &&
    (society === null || typeof society === 'string') &&
    (siteId === null || Number.isInteger(siteId))
  );
}

/** Sélection mémorisée pour CET utilisateur ; celle d'un autre compte est ignorée et effacée. */
export async function loadScopeSelection(userId: number): Promise<ScopeSelection | null> {
  const stored = await readLocal(SCOPE_KEY, isStoredScope);
  if (!stored) return null;
  if (stored.userId !== userId) {
    await removeLocal(SCOPE_KEY);
    return null;
  }
  return { society: stored.society, siteId: stored.siteId };
}

export function saveScopeSelection(userId: number, selection: ScopeSelection): Promise<void> {
  return writeLocal(SCOPE_KEY, { userId, society: selection.society, siteId: selection.siteId });
}
