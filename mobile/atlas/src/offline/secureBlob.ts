import * as SecureStore from 'expo-secure-store';

/**
 * Valeur longue dans le stockage sécurisé (Keychain iOS / Keystore Android).
 *
 * Une entrée du trousseau ne doit pas dépasser environ 2 Ko : la valeur est donc
 * découpée. Chaque écriture utilise une nouvelle génération de morceaux puis bascule
 * l'en-tête ; une écriture interrompue laisse la valeur précédente intacte.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// 600 caractères : sous la limite même en arabe ou avec des caractères sur 3 octets.
const CHUNK_SIZE = 600;
const MAX_CHUNKS = 200;

type Header = { generation: number; count: number };

async function readHeader(key: string): Promise<Header | null> {
  try {
    const parsed: unknown = JSON.parse((await SecureStore.getItemAsync(key, OPTIONS)) ?? 'null');
    const { generation, count } = (parsed ?? {}) as Partial<Header>;
    if (Number.isInteger(generation) && Number.isInteger(count) && count! >= 0 && count! <= MAX_CHUNKS) {
      return { generation: generation!, count: count! };
    }
  } catch {
    // illisible : traité comme absent
  }
  return null;
}

const chunkKey = (key: string, generation: number, index: number) => `${key}.${generation}.${index}`;

async function removeChunks(key: string, header: Header | null): Promise<void> {
  if (!header) return;
  await Promise.all(
    Array.from({ length: header.count }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, header.generation, index), OPTIONS).catch(() => undefined),
    ),
  );
}

export async function readBlob(key: string): Promise<string | null> {
  const header = await readHeader(key);
  if (!header) return null;
  try {
    const parts = await Promise.all(
      Array.from({ length: header.count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, header.generation, index), OPTIONS)),
    );
    return parts.every((part): part is string => typeof part === 'string') ? parts.join('') : null;
  } catch {
    return null;
  }
}

export async function writeBlob(key: string, value: string): Promise<void> {
  const count = Math.ceil(value.length / CHUNK_SIZE);
  if (count > MAX_CHUNKS) throw new Error('valeur trop longue pour le stockage sécurisé');
  const previous = await readHeader(key);
  const generation = ((previous?.generation ?? 0) + 1) % 1_000_000;
  for (let index = 0; index < count; index += 1) {
    await SecureStore.setItemAsync(chunkKey(key, generation, index), value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), OPTIONS);
  }
  await SecureStore.setItemAsync(key, JSON.stringify({ generation, count } satisfies Header), OPTIONS);
  await removeChunks(key, previous);
}

export async function removeBlob(key: string): Promise<void> {
  const header = await readHeader(key);
  await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => undefined);
  await removeChunks(key, header);
}
