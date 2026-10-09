import type { ExpoConfig } from 'expo/config';

import createConfig from '../../app.config';

const ENV_KEYS = [
  'APP_VARIANT',
  'EXPO_PUBLIC_API_URL',
  'ATLAS_FEATURES',
  'EAS_PROJECT_ID',
  'EXPO_OWNER',
  'ATLAS_LOCK_TIMEOUT_SECONDS',
  'ATLAS_STORE_URL_IOS',
  'ATLAS_STORE_URL_ANDROID',
] as const;
const saved: Record<string, string | undefined> = {};

function resolve(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): ExpoConfig {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  return createConfig({ config: {} } as Parameters<typeof createConfig>[0]);
}

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const PROD = { APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'https://atlas.example.test' };

describe('configuration de build', () => {
  it('donne à chaque environnement une identité iOS/Android distincte et stable', () => {
    const cases = [
      [{ APP_VARIANT: 'development' }, 'com.irongs.atlas.dev', 'ATLAS MOBILE DEV', 'atlas-dev'],
      [{ APP_VARIANT: 'staging', EXPO_PUBLIC_API_URL: 'https://test.example.test' }, 'com.irongs.atlas.staging', 'ATLAS MOBILE TEST', 'atlas-staging'],
      [PROD, 'com.irongs.atlas', 'ATLAS MOBILE', 'atlas'],
    ] as const;
    for (const [env, identifier, name, scheme] of cases) {
      const config = resolve(env);
      expect(config.ios?.bundleIdentifier).toBe(identifier);
      expect(config.android?.package).toBe(identifier);
      expect(config.name).toBe(name);
      expect(config.scheme).toBe(scheme);
      expect((config.extra as { variant: string }).variant).toBe(env.APP_VARIANT);
    }
  });

  it("n'entre pas en collision avec l'application Pointeur existante", () => {
    for (const variant of ['development', 'staging', 'production']) {
      const config = resolve({ APP_VARIANT: variant, EXPO_PUBLIC_API_URL: 'https://atlas.example.test' });
      expect(config.ios?.bundleIdentifier).not.toBe('com.irongs.pointeur');
    }
  });

  it('utilise la version de package.json au format semver', () => {
    const config = resolve(PROD);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(config.version).toBe(require('../../package.json').version);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  it("vise l'hôte officiel en production et n'impose aucune URL aux autres profils", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../eas.json');
    const url = new URL(eas.build.production.env.EXPO_PUBLIC_API_URL);
    // Hôte en « atlas.… » : le seul que le backend ne restreint pas à un module.
    expect([url.protocol, url.hostname.split('.')[0], url.pathname]).toEqual(['https:', 'atlas', '/']);
    expect(resolve({ APP_VARIANT: 'production', ...eas.build.production.env }).extra?.apiUrl).toBe('https://atlas.irongs.com');
    // Pas de backend de validation aujourd'hui : un build staging ne doit jamais viser la production par défaut.
    for (const profile of ['development', 'staging']) expect(eas.build[profile].env.EXPO_PUBLIC_API_URL).toBeUndefined();
  });

  it('laisse EAS gérer les numéros de build (aucun numéro figé dans le dépôt)', () => {
    const config = resolve(PROD);
    expect(config.ios?.buildNumber).toBeUndefined();
    expect(config.android?.versionCode).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../eas.json');
    expect(eas.cli.appVersionSource).toBe('remote');
    for (const profile of ['staging', 'production']) {
      expect(eas.build[profile].autoIncrement).toBe(true);
      expect(eas.build[profile].android.buildType).toBe('app-bundle');
      expect(eas.build[profile].env.APP_VARIANT).toBe(profile);
    }
  });

  it("exige une URL d'API HTTPS hors développement", () => {
    expect(() => resolve({ APP_VARIANT: 'production' })).toThrow(/EXPO_PUBLIC_API_URL est obligatoire/);
    expect(() => resolve({ APP_VARIANT: 'staging', EXPO_PUBLIC_API_URL: 'http://test.example.test' })).toThrow(/HTTPS/);
    expect(() => resolve({ ...PROD, EXPO_PUBLIC_API_URL: 'https://user:pw@atlas.example.test' })).toThrow(/identifiant/);
    expect(() => resolve({ ...PROD, EXPO_PUBLIC_API_URL: 'atlas.example.test' })).toThrow(/absolue/);
    expect((resolve({ APP_VARIANT: 'development' }).extra as { apiUrl: unknown }).apiUrl).toBeNull();
  });

  it('refuse une variante ou une fonction inconnue', () => {
    expect(() => resolve({ APP_VARIANT: 'prod' })).toThrow(/APP_VARIANT invalide/);
    expect(() => resolve({ ...PROD, ATLAS_FEATURES: 'biometrics,telepathie' })).toThrow(/fonction inconnue/);
  });

  it('désactive par défaut toutes les fonctions sensibles', () => {
    const features = (resolve(PROD).extra as { features: Record<string, boolean> }).features;
    expect(Object.keys(features).sort()).toEqual(
      ['ai', 'biometrics', 'employeeCreation', 'employeePortal', 'finance', 'gps', 'nfc', 'offline', 'push', 'secureScreen', 'updateCheck'].sort(),
    );
    expect(Object.values(features).every((enabled) => enabled === false)).toBe(true);
    const enabled = (resolve({ ...PROD, ATLAS_FEATURES: 'biometrics, push' }).extra as { features: Record<string, boolean> }).features;
    expect(enabled.biometrics).toBe(true);
    expect(enabled.push).toBe(true);
    expect(enabled.gps).toBe(false);
  });

  it("n'autorise le trafic en clair qu'en développement", () => {
    const cleartext = (config: ExpoConfig) => {
      const plugin = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-build-properties');
      return (plugin as [string, { android: { usesCleartextTraffic: boolean } }])[1].android.usesCleartextTraffic;
    };
    const prod = resolve(PROD);
    expect(cleartext(prod)).toBe(false);
    expect(prod.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: false,
    });
    const dev = resolve({ APP_VARIANT: 'development' });
    expect(cleartext(dev)).toBe(true);
    expect(dev.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    });
  });

  it('ne demande aucune permission système ni texte Face ID sans la fonction biométrie', () => {
    const config = resolve(PROD);
    expect(config.android?.permissions).toEqual([]);
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
    expect(config.android?.allowBackup).toBe(false);
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    const usageKeys = Object.keys(config.ios?.infoPlist ?? {}).filter((key) => key.endsWith('UsageDescription'));
    expect(usageKeys).toEqual([]);
    const secureStore = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-secure-store');
    expect((secureStore as [string, { faceIDPermission: unknown }])[1].faceIDPermission).toBe(false);
    const localAuth = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-local-authentication');
    expect((localAuth as [string, { faceIDPermission: unknown }])[1].faceIDPermission).toBe(false);
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining(['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT']),
    );
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  it("n'embarque aucun secret dans la configuration publique", () => {
    const serialized = JSON.stringify(resolve({ ...PROD, EAS_PROJECT_ID: '00000000-0000-0000-0000-000000000000' }));
    expect(serialized).not.toMatch(/password|secret|token|keystore|private[_-]?key|api[_-]?key/i);
  });

  it("n'ajoute le texte Face ID et la permission biométrique que si la fonction est activée", () => {
    const config = resolve({ ...PROD, ATLAS_FEATURES: 'biometrics' });
    const localAuth = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-local-authentication');
    const text = (localAuth as [string, { faceIDPermission: unknown }])[1].faceIDPermission;
    expect(typeof text).toBe('string');
    expect(text).toMatch(/Face ID/);
    // Les deux plugins écrivent la même clé : un `false` sur l'un effacerait le texte de l'autre.
    const secureStore = config.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-secure-store');
    expect((secureStore as [string, { faceIDPermission: unknown }])[1].faceIDPermission).toBe(text);
    expect(config.android?.blockedPermissions).not.toContain('android.permission.USE_BIOMETRIC');
    expect(config.android?.permissions).toEqual([]);
  });

  it('borne le délai de verrouillage et le rend configurable au build', () => {
    const extra = (env: Record<string, string>) => resolve({ ...PROD, ...env }).extra as { lockTimeoutSeconds: number };
    expect(extra({}).lockTimeoutSeconds).toBe(120);
    expect(extra({ ATLAS_LOCK_TIMEOUT_SECONDS: '300' }).lockTimeoutSeconds).toBe(300);
    for (const invalid of ['0', '5', '99999', 'abc', '12.5']) {
      expect(() => resolve({ ...PROD, ATLAS_LOCK_TIMEOUT_SECONDS: invalid })).toThrow(/ATLAS_LOCK_TIMEOUT_SECONDS/);
    }
  });

  it("n'accepte comme lien de mise à jour qu'une fiche App Store ou Google Play", () => {
    const stores = (env: Record<string, string>) =>
      (resolve({ ...PROD, ...env }).extra as { storeUrls: { ios: string | null; android: string | null } }).storeUrls;
    expect(stores({})).toEqual({ ios: null, android: null });
    expect(
      stores({
        ATLAS_STORE_URL_IOS: 'https://apps.apple.com/app/id123',
        ATLAS_STORE_URL_ANDROID: 'https://play.google.com/store/apps/details?id=com.irongs.atlas',
      }),
    ).toEqual({
      ios: 'https://apps.apple.com/app/id123',
      android: 'https://play.google.com/store/apps/details?id=com.irongs.atlas',
    });
    expect(() => resolve({ ...PROD, ATLAS_STORE_URL_IOS: 'https://evil.example/app' })).toThrow(/ATLAS_STORE_URL_IOS/);
    expect(() => resolve({ ...PROD, ATLAS_STORE_URL_ANDROID: 'http://play.google.com/x' })).toThrow(/ATLAS_STORE_URL_ANDROID/);
  });
});
