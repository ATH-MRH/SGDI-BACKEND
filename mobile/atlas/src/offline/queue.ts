import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  validateIncident,
  type NewIncident,
} from '@/api/domains/incidents';

import { readBlob, removeBlob, writeBlob } from './secureBlob';

/**
 * File d'attente des saisies terrain faites sans réseau.
 *
 * Une saisie en attente n'est PAS un incident : elle n'existe que sur ce téléphone
 * tant que le backend ne l'a pas acceptée. Elle est liée à l'utilisateur qui l'a
 * saisie et n'est jamais envoyée avec le compte d'un autre.
 */
export type QueueState =
  /** En attente de réseau. */
  | 'pending'
  | 'syncing'
  /** Refusée par le backend (droit, périmètre, saisie) : à corriger ou supprimer. */
  | 'failed'
  /** Le backend signale un état incompatible : il fait foi, rien n'est écrasé. */
  | 'conflict';

export type QueuedIncident = {
  /** Identifiant généré sur le téléphone : rend l'envoi rejouable sans doublon. */
  id: string;
  kind: 'incident';
  createdAt: number;
  state: QueueState;
  attempts: number;
  /** Message du backend ou code d'erreur ; jamais de donnée sensible. */
  error: string | null;
  payload: NewIncident;
};

export const QUEUE_KEY = 'atlas.offline.v1';
export const QUEUE_LIMIT = 10;

export function newClientId(): string {
  let id = '';
  for (let index = 0; index < 32; index += 1) id += Math.floor(Math.random() * 16).toString(16);
  return `mobile-${id}`;
}

const STATES: readonly QueueState[] = ['pending', 'syncing', 'failed', 'conflict'];

function isQueuedIncident(value: unknown): value is QueuedIncident {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<QueuedIncident>;
  const payload = item.payload as Partial<NewIncident> | undefined;
  return (
    typeof item.id === 'string' &&
    /^mobile-[0-9a-f]{32}$/.test(item.id) &&
    item.kind === 'incident' &&
    typeof item.createdAt === 'number' &&
    STATES.includes(item.state as QueueState) &&
    Number.isInteger(item.attempts) &&
    (item.error === null || typeof item.error === 'string') &&
    typeof payload === 'object' &&
    payload !== null &&
    Object.keys(validateIncident(payload)).length === 0 &&
    (INCIDENT_TYPES as readonly string[]).includes(payload.type as string) &&
    (INCIDENT_SEVERITIES as readonly string[]).includes(payload.severity as string) &&
    typeof payload.date === 'string' &&
    typeof payload.time === 'string'
  );
}

/** File de CET utilisateur. Celle d'un autre compte est effacée, jamais lue. */
export async function loadQueue(userId: number): Promise<QueuedIncident[]> {
  const raw = await readBlob(QUEUE_KEY);
  if (raw === null) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // illisible
  }
  const stored = (parsed ?? {}) as { userId?: unknown; items?: unknown };
  if (stored.userId !== userId || !Array.isArray(stored.items)) {
    await removeBlob(QUEUE_KEY);
    return [];
  }
  return stored.items
    .filter(isQueuedIncident)
    .slice(0, QUEUE_LIMIT)
    // Un envoi interrompu par la fermeture de l'application est simplement repris.
    .map((item) => (item.state === 'syncing' ? { ...item, state: 'pending' as const } : item));
}

export async function saveQueue(userId: number, items: readonly QueuedIncident[]): Promise<void> {
  if (items.length === 0) await removeBlob(QUEUE_KEY);
  else await writeBlob(QUEUE_KEY, JSON.stringify({ userId, items }));
}

export function queueIncident(payload: NewIncident, id: string = newClientId(), now: number = Date.now()): QueuedIncident {
  return {
    id,
    kind: 'incident',
    createdAt: now,
    state: 'pending',
    attempts: 0,
    error: null,
    payload: { ...payload, subject: payload.subject.trim(), description: payload.description.trim() },
  };
}
