type LockCheck = {
  enabled: boolean;
  /** Instant du passage en arrière-plan, ou null si l'application n'y est pas passée. */
  backgroundedAt: number | null;
  now: number;
  timeoutMs: number;
};

/** L'application doit-elle se verrouiller à son retour au premier plan ? */
export function shouldLockOnForeground({ enabled, backgroundedAt, now, timeoutMs }: LockCheck): boolean {
  if (!enabled || backgroundedAt === null) return false;
  // Horloge reculée pendant l'absence : on verrouille plutôt que de faire confiance.
  return now < backgroundedAt || now - backgroundedAt >= timeoutMs;
}
