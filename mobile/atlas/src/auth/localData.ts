import * as SecureStore from 'expo-secure-store';

/**
 * Préférences locales liées à un utilisateur (contexte de travail, verrouillage).
 * Rien de sensible : des identifiants et des choix. Elles sont rangées dans le
 * stockage sécurisé par simplicité et effacées à la déconnexion.
 */
export const SCOPE_KEY = 'atlas.scope.v1';
export const LOCK_KEY = 'atlas.lock.v1';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function readLocal<T>(key: string, isValid: (value: unknown) => value is T): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, OPTIONS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isValid(parsed)) return parsed;
  } catch {
    // illisible : traité comme absent
  }
  await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => undefined);
  return null;
}

export async function writeLocal(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value), OPTIONS);
}

export async function removeLocal(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => undefined);
}

/** Efface tout ce qui se rapporte à l'utilisateur qui se déconnecte. */
export async function clearLocalUserData(): Promise<void> {
  await Promise.all([removeLocal(SCOPE_KEY), removeLocal(LOCK_KEY)]);
}
