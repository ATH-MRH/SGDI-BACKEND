import { ApiError } from '@/api/errors';

import type { QueuedIncident } from './queue';

type Outcome = 'synced' | 'retry' | 'failed' | 'conflict';

/** Ce que devient une saisie après la réponse du backend. Le backend fait toujours foi. */
export function classify(error: unknown): { outcome: Exclude<Outcome, 'synced'>; message: string } {
  if (!(error instanceof ApiError)) return { outcome: 'retry', message: 'unknown' };
  switch (error.kind) {
    case 'conflict':
      return { outcome: 'conflict', message: error.serverMessage ?? error.kind };
    case 'forbidden':
    case 'validation':
    case 'not_found':
      return { outcome: 'failed', message: error.serverMessage ?? error.kind };
    default:
      // Réseau, délai, serveur indisponible, session à rouvrir, mise à jour requise :
      // la saisie reste en attente, rien n'est perdu.
      return { outcome: 'retry', message: error.kind };
  }
}

/**
 * Envoie les saisies en attente, dans l'ordre de saisie. S'arrête à la première
 * qui échoue faute de réseau : inutile d'insister, l'ordre est préservé.
 */
export async function syncQueue(
  items: readonly QueuedIncident[],
  send: (item: QueuedIncident) => Promise<unknown>,
  onChange: (items: QueuedIncident[]) => void | Promise<void>,
): Promise<{ items: QueuedIncident[]; synced: number }> {
  let current = [...items];
  let synced = 0;
  const replace = async (id: string, next: QueuedIncident | null) => {
    current = current.flatMap((entry) => (entry.id === id ? (next ? [next] : []) : [entry]));
    await onChange(current);
  };

  for (const item of items) {
    if (item.state !== 'pending') continue;
    await replace(item.id, { ...item, state: 'syncing' });
    try {
      await send(item);
      synced += 1;
      await replace(item.id, null);
    } catch (error) {
      const { outcome, message } = classify(error);
      const attempts = item.attempts + 1;
      if (outcome === 'retry') {
        await replace(item.id, { ...item, state: 'pending', attempts, error: message });
        break;
      }
      await replace(item.id, { ...item, state: outcome, attempts, error: message });
    }
  }
  return { items: current, synced };
}
