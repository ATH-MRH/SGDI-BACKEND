import type { ApiClient } from './client';

/** Configuration publique servie par le backend (GET /api/mobile/config). */
export type MobileConfig = {
  minSupportedVersion: { ios: string | null; android: string | null };
  recommendedVersion: { ios: string | null; android: string | null };
  maintenance: { enabled: boolean; message: string | null };
  storeUrls: { ios: string | null; android: string | null };
};

const VERSION = /^\d+(\.\d+){0,2}$/;
const STORE_URL = /^https:\/\/(apps\.apple\.com|play\.google\.com)\/\S+$/;

const version = (value: unknown): string | null => (typeof value === 'string' && VERSION.test(value) ? value : null);
const storeUrl = (value: unknown): string | null => (typeof value === 'string' && STORE_URL.test(value) ? value : null);

type Pair = { ios?: unknown; android?: unknown };

export async function fetchMobileConfig(client: ApiClient): Promise<MobileConfig> {
  const raw = await client.get<{
    min_supported_version?: Pair;
    recommended_version?: Pair;
    maintenance?: { enabled?: unknown; message?: unknown };
    store_urls?: Pair;
  }>('/api/mobile/config', { authenticated: false });
  const minimum = raw?.min_supported_version ?? {};
  const recommended = raw?.recommended_version ?? {};
  const stores = raw?.store_urls ?? {};
  const message = raw?.maintenance?.message;
  return {
    minSupportedVersion: { ios: version(minimum.ios), android: version(minimum.android) },
    recommendedVersion: { ios: version(recommended.ios), android: version(recommended.android) },
    maintenance: {
      // Seul un `true` explicite met l'application en maintenance.
      enabled: raw?.maintenance?.enabled === true,
      message: typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : null,
    },
    storeUrls: { ios: storeUrl(stores.ios), android: storeUrl(stores.android) },
  };
}
