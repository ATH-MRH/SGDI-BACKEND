import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Verrouillage biométrique LOCAL. La vérification est faite par le système
 * (Face ID, Touch ID, biométrie Android) : ATLAS ne reçoit, ne stocke et ne
 * transmet aucune donnée biométrique, seulement « réussi » ou « échoué ».
 * Elle protège une session déjà ouverte ; elle ne remplace jamais la connexion.
 */
export type BiometricCapability = 'available' | 'notEnrolled' | 'unavailable';

export type UnlockResult = 'success' | 'cancelled' | 'failed' | 'lockout' | 'unavailable';

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return 'unavailable';
    return (await LocalAuthentication.isEnrolledAsync()) ? 'available' : 'notEnrolled';
  } catch {
    return 'unavailable';
  }
}

const CANCELLED = new Set(['user_cancel', 'system_cancel', 'app_cancel']);
const UNAVAILABLE = new Set(['not_enrolled', 'not_available', 'passcode_not_set']);

export async function authenticate(promptMessage: string, cancelLabel: string): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // Le code de l'appareil reste proposé par le système en secours de la biométrie.
      disableDeviceFallback: false,
    });
    if (result.success) return 'success';
    if (CANCELLED.has(result.error)) return 'cancelled';
    if (UNAVAILABLE.has(result.error)) return 'unavailable';
    return result.error === 'lockout' ? 'lockout' : 'failed';
  } catch {
    return 'failed';
  }
}
