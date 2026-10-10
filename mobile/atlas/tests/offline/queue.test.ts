import * as SecureStore from 'expo-secure-store';

import { ApiError } from '@/api/errors';
import type { NewIncident } from '@/api/domains/incidents';
import { loadQueue, QUEUE_KEY, QUEUE_LIMIT, queueIncident, saveQueue, type QueuedIncident } from '@/offline/queue';
import { readBlob, removeBlob, writeBlob } from '@/offline/secureBlob';
import { classify, syncQueue } from '@/offline/sync';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const payload = (overrides: Partial<NewIncident> = {}): NewIncident => ({
  siteId: 1, society: 'Societe A', type: 'intrusion', severity: 'elevee', subject: 'Portail forcé', description: 'Constaté à la ronde.',
  date: '2026-10-08', time: '14:05', ...overrides,
});

beforeEach(() => store.clear());

describe('stockage sécurisé découpé', () => {
  it('relit une valeur longue, y compris en arabe, sans dépasser la taille d\'une entrée', async () => {
    const value = 'تصريح '.repeat(900) + 'é'.repeat(700);
    await writeBlob('k', value);
    expect(await readBlob('k')).toBe(value);
    for (const [key, chunk] of store) if (key !== 'k') expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('remplace la valeur sans laisser d\'anciens morceaux', async () => {
    await writeBlob('k', 'a'.repeat(2000));
    await writeBlob('k', 'court');
    expect(await readBlob('k')).toBe('court');
    expect(store.size).toBe(2);
    await removeBlob('k');
    expect(store.size).toBe(0);
  });

  it('une écriture interrompue laisse la valeur précédente lisible', async () => {
    await writeBlob('k', 'ancienne valeur');
    const set = SecureStore.setItemAsync as jest.Mock;
    const original = set.getMockImplementation()!;
    let calls = 0;
    set.mockImplementation(async (key: string, value: string) => {
      calls += 1;
      if (calls === 2) throw new Error('trousseau indisponible');
      return original(key, value);
    });
    await expect(writeBlob('k', 'n'.repeat(1500))).rejects.toThrow();
    set.mockImplementation(original);
    expect(await readBlob('k')).toBe('ancienne valeur');
  });

  it('traite une valeur absente, tronquée ou corrompue comme absente', async () => {
    expect(await readBlob('k')).toBeNull();
    await writeBlob('k', 'x'.repeat(1300));
    store.delete([...store.keys()].find((key) => key.endsWith('.1'))!);
    expect(await readBlob('k')).toBeNull();
    store.set('k', '{"generation":"x"}');
    expect(await readBlob('k')).toBeNull();
  });
});

describe('file hors connexion', () => {
  it('garde la saisie avec un identifiant client stable et nettoyé', () => {
    const item = queueIncident(payload({ subject: '  Portail forcé  ' }), 'mobile-' + 'a'.repeat(32), 42);
    expect(item).toMatchObject({ id: 'mobile-' + 'a'.repeat(32), state: 'pending', attempts: 0, error: null, createdAt: 42 });
    expect(item.payload.subject).toBe('Portail forcé');
    expect(queueIncident(payload()).id).toMatch(/^mobile-[0-9a-f]{32}$/);
  });

  it("n'expose jamais la file d'un autre utilisateur et l'efface", async () => {
    await saveQueue(7, [queueIncident(payload())]);
    expect(await loadQueue(7)).toHaveLength(1);
    expect(await loadQueue(8)).toEqual([]);
    expect(store.size).toBe(0);
    expect(await loadQueue(7)).toEqual([]);
  });

  it('écarte les entrées invalides et reprend un envoi interrompu', async () => {
    const good = queueIncident(payload());
    const items = [
      { ...good, state: 'syncing' },
      { ...good, id: 'autre' },
      { ...good, id: 'mobile-' + 'b'.repeat(32), payload: payload({ subject: '' }) },
      { ...good, id: 'mobile-' + 'c'.repeat(32), payload: payload({ type: 'inconnu' as never }) },
      'texte',
    ];
    await writeBlob(QUEUE_KEY, JSON.stringify({ userId: 7, items }));
    const loaded = await loadQueue(7);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.state).toBe('pending');
  });

  it('borne la taille de la file et efface le stockage quand elle est vide', async () => {
    const many = Array.from({ length: QUEUE_LIMIT + 5 }, () => queueIncident(payload()));
    await saveQueue(7, many);
    expect(await loadQueue(7)).toHaveLength(QUEUE_LIMIT);
    await saveQueue(7, []);
    expect(store.size).toBe(0);
  });

  it('une file illisible est abandonnée sans erreur', async () => {
    await writeBlob(QUEUE_KEY, 'pas du json');
    expect(await loadQueue(7)).toEqual([]);
  });
});

describe('synchronisation', () => {
  const three = (): QueuedIncident[] => ['a', 'b', 'c'].map((letter, index) => queueIncident(payload({ subject: letter }), 'mobile-' + letter.repeat(32), index));

  it('envoie dans l\'ordre et retire ce que le backend a accepté', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const states: string[][] = [];
    const result = await syncQueue(three(), send, (items) => void states.push(items.map((item) => `${item.payload.subject}:${item.state}`)));
    expect(send.mock.calls.map(([item]) => (item as QueuedIncident).payload.subject)).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ items: [], synced: 3 });
    expect(states[0]).toEqual(['a:syncing', 'b:pending', 'c:pending']);
  });

  it("s'arrête à la première panne réseau et garde tout en attente", async () => {
    const send = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError({ kind: 'network' }));
    const result = await syncQueue(three(), send, () => undefined);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.synced).toBe(1);
    expect(result.items.map((item) => [item.payload.subject, item.state, item.attempts])).toEqual([
      ['b', 'pending', 1],
      ['c', 'pending', 0],
    ]);
  });

  it('marque un refus du backend sans bloquer les suivantes, et ne renvoie pas ce qui est refusé', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError({ kind: 'forbidden', status: 403, serverMessage: 'Société non autorisée pour cet utilisateur' }))
      .mockRejectedValueOnce(new ApiError({ kind: 'conflict', status: 409 }))
      .mockResolvedValueOnce(undefined);
    const first = await syncQueue(three(), send, () => undefined);
    expect(first.items.map((item) => [item.state, item.error])).toEqual([
      ['failed', 'Société non autorisée pour cet utilisateur'],
      ['conflict', 'conflict'],
    ]);
    const again = jest.fn();
    await syncQueue(first.items, again, () => undefined);
    expect(again).not.toHaveBeenCalled();
  });

  it.each([
    ['network', 'retry'], ['timeout', 'retry'], ['server', 'retry'], ['unauthorized', 'retry'], ['rate_limited', 'retry'],
    ['upgrade_required', 'retry'], ['forbidden', 'failed'], ['validation', 'failed'], ['not_found', 'failed'], ['conflict', 'conflict'],
  ] as const)('%s → %s', (kind, outcome) => {
    expect(classify(new ApiError({ kind })).outcome).toBe(outcome);
  });

  it('une erreur inattendue ne fait jamais perdre la saisie', () => {
    expect(classify(new Error('boom')).outcome).toBe('retry');
  });
});
