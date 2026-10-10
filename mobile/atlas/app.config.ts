import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Configuration ATLAS MOBILE.
 *
 * L'environnement est fixé AU BUILD par APP_VARIANT (profil EAS). Aucune URL
 * d'API ni aucun secret n'est écrit ici : l'URL vient de EXPO_PUBLIC_API_URL,
 * fournie par l'environnement EAS (ou un .env local non versionné en dev).
 */

export type AppVariant = 'development' | 'staging' | 'production';

type VariantIdentity = {
  name: string;
  /** iOS bundle identifier et Android applicationId — STABLES une fois publiés. */
  identifier: string;
  scheme: string;
};

const BASE_IDENTIFIER = 'com.irongs.atlas';

const VARIANTS: Record<AppVariant, VariantIdentity> = {
  development: { name: 'ATLAS MOBILE DEV', identifier: `${BASE_IDENTIFIER}.dev`, scheme: 'atlas-dev' },
  staging: { name: 'ATLAS MOBILE TEST', identifier: `${BASE_IDENTIFIER}.staging`, scheme: 'atlas-staging' },
  production: { name: 'ATLAS MOBILE', identifier: BASE_IDENTIFIER, scheme: 'atlas' },
};

// Fonctions sensibles ou incomplètes : toutes désactivées par défaut.
const FEATURE_KEYS = [
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

function resolveVariant(): AppVariant {
  const raw = process.env.APP_VARIANT ?? 'development';
  if (raw !== 'development' && raw !== 'staging' && raw !== 'production') {
    throw new Error(`APP_VARIANT invalide : "${raw}" (attendu : development | staging | production)`);
  }
  return raw;
}

function resolveApiUrl(variant: AppVariant): string | null {
  const raw = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    if (variant !== 'development') {
      throw new Error(`EXPO_PUBLIC_API_URL est obligatoire pour la variante "${variant}".`);
    }
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL doit être une URL absolue.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('EXPO_PUBLIC_API_URL ne doit contenir aucun identifiant.');
  }
  if (variant !== 'development' && parsed.protocol !== 'https:') {
    throw new Error(`EXPO_PUBLIC_API_URL doit être en HTTPS pour la variante "${variant}".`);
  }
  return raw;
}

function resolveFeatures(): Record<(typeof FEATURE_KEYS)[number], boolean> {
  const raw: string = process.env.ATLAS_FEATURES ?? '';
  const enabled = new Set<string>(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const key of enabled) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`ATLAS_FEATURES : fonction inconnue "${key}".`);
    }
  }
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, enabled.has(key)])) as Record<
    (typeof FEATURE_KEYS)[number],
    boolean
  >;
}

/** Délai d'arrière-plan avant verrouillage biométrique, en secondes. */
function resolveLockTimeout(): number {
  const raw: string = process.env.ATLAS_LOCK_TIMEOUT_SECONDS ?? '';
  if (!raw.trim()) return 120;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 15 || value > 3600) {
    throw new Error('ATLAS_LOCK_TIMEOUT_SECONDS doit être un entier entre 15 et 3600.');
  }
  return value;
}

/** Lien vers la fiche store, connu seulement une fois l'application créée sur le store. */
function resolveStoreUrl(name: 'ATLAS_STORE_URL_IOS' | 'ATLAS_STORE_URL_ANDROID'): string | null {
  const raw: string = (process.env[name] ?? '').trim();
  if (!raw) return null;
  if (!/^https:\/\/(apps\.apple\.com|play\.google\.com)\//.test(raw)) {
    throw new Error(`${name} doit être une URL App Store ou Google Play en HTTPS.`);
  }
  return raw;
}

const withoutPushEntitlement: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant();
  const identity = VARIANTS[variant];
  const isDevelopment = variant === 'development';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const version: string = require('./package.json').version;
  const easProjectId = process.env.EAS_PROJECT_ID;
  const features = resolveFeatures();
  const faceIDPermission: string | false = features.biometrics
    ? 'ATLAS MOBILE utilise Face ID pour déverrouiller votre session sur cet appareil.'
    : false;

  return {
    ...config,
    name: identity.name,
    slug: 'atlas-mobile',
    owner: process.env.EXPO_OWNER || undefined,
    scheme: identity.scheme,
    // Version marketing (CFBundleShortVersionString / versionName).
    // Les numéros de build (CFBundleVersion / versionCode) sont gérés par EAS
    // (appVersionSource: remote, autoIncrement) — voir eas.json.
    version,
    runtimeVersion: { policy: 'appVersion' },
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/images/icon.png',
    ios: {
      bundleIdentifier: identity.identifier,
      supportsTablet: false,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        CFBundleDevelopmentRegion: 'fr',
        CFBundleAllowMixedLocalizations: true,
        // HTTP local uniquement pour le client de développement. Le gabarit Expo
        // l'autorise par défaut : on le ferme explicitement ailleurs.
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: isDevelopment },
      },
      // API « required reason » utilisées par React Native lui-même (valeurs du
      // gabarit officiel). Aucun traçage. À recouper avec les manifestes des
      // dépendances au premier build — voir docs/PRIVACY-DATA-SAFETY.md.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        ],
      },
    },
    android: {
      package: identity.identifier,
      adaptiveIcon: {
        backgroundColor: '#0A2D6B',
        foregroundImage: './assets/images/android-icon-foreground.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      // Aucune permission système tant qu'aucune fonction ne l'utilise (INTERNET
      // est ajoutée par la plateforme). Voir docs/PRIVACY-DATA-SAFETY.md.
      permissions: [],
      // Permissions ajoutées par le gabarit natif mais inutilisées par l'app.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.VIBRATE',
        // Déclarée par expo-screen-capture pour DÉTECTER les captures : l'application
        // ne fait que les bloquer (fonction secureScreen), elle n'écoute rien.
        'android.permission.DETECT_SCREEN_CAPTURE',
        ...(isDevelopment ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
        // Déclarées par expo-local-authentication : retirées tant que le
        // verrouillage biométrique n'est pas activé pour ce build.
        ...(features.biometrics
          ? []
          : ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT']),
        // Déclarées par expo-notifications : retirées tant que les notifications
        // push ne sont pas activées pour ce build.
        ...(features.push
          ? []
          : [
              'android.permission.POST_NOTIFICATIONS',
              'android.permission.RECEIVE_BOOT_COMPLETED',
              'android.permission.WAKE_LOCK',
              'com.google.android.c2dm.permission.RECEIVE',
            ]),
      ],
      // Les sessions ne doivent pas être restaurées sur un autre appareil.
      allowBackup: false,
    },
    plugins: [
      'expo-router',
      'expo-status-bar',
      'expo-font',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0A2D6B',
          image: './assets/images/splash-icon.png',
          imageWidth: 140,
        },
      ],
      // Texte Face ID : présent uniquement si le verrouillage biométrique est inclus
      // dans ce build. Les deux plugins écrivent la même clé d'Info.plist ; ils
      // reçoivent donc la même valeur, sinon l'un efface le texte de l'autre.
      ['expo-secure-store', { faceIDPermission, configureAndroidBackup: true }],
      ['expo-local-authentication', { faceIDPermission }],
      ['expo-localization', { supportsRTL: true, supportedLocales: ['fr', 'ar'] }],
      ['expo-build-properties', { android: { usesCleartextTraffic: isDevelopment } }],
      // Capacité push : Expo applique le plugin de expo-notifications dès que le paquet est
      // installé. Sans la fonction, l'entitlement iOS est retiré pour ne pas exiger un
      // profil de provisionnement « Push Notifications ».
      // (Le type d'ExpoConfig ne décrit pas les plugins en ligne, pourtant pris en charge.)
      features.push ? ['expo-notifications', { color: '#0A2D6B' }] : (withoutPushEntitlement as unknown as string),
    ],
    experiments: { typedRoutes: true },
    extra: {
      variant,
      apiUrl: resolveApiUrl(variant),
      features,
      lockTimeoutSeconds: resolveLockTimeout(),
      storeUrls: {
        ios: resolveStoreUrl('ATLAS_STORE_URL_IOS'),
        android: resolveStoreUrl('ATLAS_STORE_URL_ANDROID'),
      },
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
  };
};
