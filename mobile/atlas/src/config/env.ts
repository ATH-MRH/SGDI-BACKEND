import Constants from 'expo-constants';

export type AppVariant = 'development' | 'staging' | 'production';

export const FEATURE_KEYS = [
  'biometrics',
  'gps',
  'nfc',
  'ai',
  'employeeCreation',
  'offline',
  'finance',
  'push',
  'updateCheck',
  'employeePortal',
  'secureScreen',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type AppEnv = {
  variant: AppVariant;
  /** URL de base du backend ATLAS, ou null si l'app n'est pas configurée. */
  apiUrl: string | null;
  features: Record<FeatureKey, boolean>;
  /** Délai d'arrière-plan avant verrouillage biométrique. */
  lockTimeoutMs: number;
  /** Fiches store ; null tant que l'application n'y est pas publiée. */
  storeUrls: { ios: string | null; android: string | null };
};

const DEFAULT_LOCK_TIMEOUT_SECONDS = 120;
const STORE_URL = /^https:\/\/(apps\.apple\.com|play\.google\.com)\/\S+$/;

const VARIANTS: readonly AppVariant[] = ['development', 'staging', 'production'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valide la configuration injectée au build (app.config.ts → extra).
 * Toute valeur absente ou douteuse retombe sur le comportement le plus strict :
 * variante production, aucune fonction optionnelle, pas d'URL non HTTPS.
 */
export function parseEnv(extra: unknown): AppEnv {
  const source = isRecord(extra) ? extra : {};
  const variant = VARIANTS.includes(source.variant as AppVariant)
    ? (source.variant as AppVariant)
    : 'production';

  let apiUrl: string | null = null;
  if (typeof source.apiUrl === 'string' && source.apiUrl.trim()) {
    const candidate = source.apiUrl.trim().replace(/\/+$/, '');
    const isHttps = /^https:\/\/[^/\s@]+(\/[^\s]*)?$/i.test(candidate);
    const isHttp = /^http:\/\/[^/\s@]+(\/[^\s]*)?$/i.test(candidate);
    if (isHttps || (isHttp && variant === 'development')) apiUrl = candidate;
  }

  const rawFeatures = isRecord(source.features) ? source.features : {};
  const features = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, rawFeatures[key] === true]),
  ) as Record<FeatureKey, boolean>;

  const seconds = source.lockTimeoutSeconds;
  const lockTimeoutMs =
    (typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 15 && seconds <= 3600
      ? seconds
      : DEFAULT_LOCK_TIMEOUT_SECONDS) * 1000;

  const rawStores = isRecord(source.storeUrls) ? source.storeUrls : {};
  const storeUrl = (value: unknown) => (typeof value === 'string' && STORE_URL.test(value) ? value : null);
  const storeUrls = { ios: storeUrl(rawStores.ios), android: storeUrl(rawStores.android) };

  return { variant, apiUrl, features, lockTimeoutMs, storeUrls };
}

export const env: AppEnv = parseEnv(Constants.expoConfig?.extra);

export function isFeatureEnabled(key: FeatureKey): boolean {
  return env.features[key];
}
