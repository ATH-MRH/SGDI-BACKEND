import { LOCK_KEY, readLocal, removeLocal, writeLocal } from '@/auth/localData';

type StoredLock = { userId: number; enabled: true };

function isStoredLock(value: unknown): value is StoredLock {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, enabled } = value as Record<string, unknown>;
  return Number.isInteger(userId) && enabled === true;
}

/** Seul le CHOIX d'activation est mémorisé — aucune donnée biométrique. */
export async function isLockEnabled(userId: number): Promise<boolean> {
  const stored = await readLocal(LOCK_KEY, isStoredLock);
  return stored !== null && stored.userId === userId;
}

export function saveLockEnabled(userId: number): Promise<void> {
  return writeLocal(LOCK_KEY, { userId, enabled: true });
}

export function clearLockEnabled(): Promise<void> {
  return removeLocal(LOCK_KEY);
}
