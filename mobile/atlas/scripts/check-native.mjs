#!/usr/bin/env node
/**
 * Valide la configuration native RÉELLE d'une variante : génère les projets
 * iOS/Android (expo prebuild, sans compilation ni signature) dans un dossier
 * temporaire puis contrôle manifeste Android, Info.plist et identifiants.
 *
 * Usage : node scripts/check-native.mjs [production|staging|development] [fonctions]
 *   ex. node scripts/check-native.mjs production biometrics,push
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_CLIENT_PACKAGES } from './strip-dev-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const variant = process.argv[2] ?? 'production';
const features = process.argv[3] ?? '';
const biometrics = features.split(',').includes('biometrics');
const push = features.split(',').includes('push');
const IDS = {
  production: ['com.irongs.atlas', 'ATLAS MOBILE', 'atlas'],
  staging: ['com.irongs.atlas.staging', 'ATLAS MOBILE TEST', 'atlas-staging'],
  development: ['com.irongs.atlas.dev', 'ATLAS MOBILE DEV', 'atlas-dev'],
};
if (!IDS[variant]) {
  console.error(`Variante inconnue : ${variant}`);
  process.exit(2);
}
const [identifier, displayName, scheme] = IDS[variant];
const isDev = variant === 'development';

// Copie de travail : prebuild réécrit package.json et crée ios/ android/.
const work = mkdtempSync(join(tmpdir(), 'atlas-native-'));
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

try {
  for (const entry of ['app.config.ts', 'package.json', 'tsconfig.json', 'assets', 'src']) {
    cpSync(join(root, entry), join(work, entry), { recursive: true });
  }
  if (isDev) {
    symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');
  } else {
    // Même état que sur la machine de build : hors développement, le client de développement
    // est retiré de node_modules avant la génération (scripts/strip-dev-client.mjs).
    mkdirSync(join(work, 'node_modules'));
    for (const name of readdirSync(join(root, 'node_modules'))) {
      if (!DEV_CLIENT_PACKAGES.includes(name)) symlinkSync(join(root, 'node_modules', name), join(work, 'node_modules', name));
    }
  }

  execFileSync('npx', ['expo', 'prebuild', '--no-install', '--clean', '--platform', 'all'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      APP_VARIANT: variant,
      EXPO_PUBLIC_API_URL: isDev ? '' : 'https://atlas.example.invalid',
      ATLAS_FEATURES: features,
      CI: '1',
    },
  });

  const label = `${variant}${features ? ` + ${features}` : ''}`;
  console.log(`\nAndroid — ${label}`);
  const manifest = readFileSync(join(work, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const gradle = readFileSync(join(work, 'android/app/build.gradle'), 'utf8');
  const permissions = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"[^>]*>/g)]
    .filter((match) => !match[0].includes('tools:node="remove"'))
    .map((match) => match[1])
    .sort();
  const allowed = [
    // Exigée au lancement par le module natif d'expo-screen-capture à partir d'Android 14.
    'android.permission.DETECT_SCREEN_CAPTURE',
    'android.permission.INTERNET',
    ...(isDev ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
    // Verrouillage biométrique local : uniquement si la fonction est incluse dans le build.
    ...(biometrics ? ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT'] : []),
  ].sort();
  check(JSON.stringify(permissions) === JSON.stringify(allowed), `permissions = ${allowed.join(', ')} (trouvé : ${permissions.join(', ')})`);
  // Lecture de la galerie : déclarée par le manifeste d'expo-screen-capture, jamais utilisée.
  for (const unused of ['READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE']) {
    check(new RegExp(`<uses-permission[^>]*android\\.permission\\.${unused}[^>]*tools:node="remove"`).test(manifest), `permission ${unused} retirée`);
  }
  // Permissions apportées par des bibliothèques (pastilles de lanceur de ShortcutBadger,
  // provenance d'installation) : invisibles ici, elles n'apparaissent qu'à la fusion des
  // manifestes. Chacune doit donc porter une règle de retrait.
  const removed = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"[^>]*tools:node="remove"/g)].map((match) => match[1]);
  const libraryOnly = ['com.sec.android.provider.badge.permission.READ', 'com.huawei.android.launcher.permission.CHANGE_BADGE', 'android.permission.READ_APP_BADGE', 'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'];
  check(libraryOnly.every((name) => removed.includes(name)), 'permissions de pastille de lanceur et de provenance d\'installation retirées');
  check(removed.filter((name) => /badge|launcher|badger|sonyericsson|sonymobile/i.test(name)).length === 16, '16 permissions de pastille retirées');
  // Les permissions de notification viennent du manifeste de la bibliothèque : sans la
  // fonction push, l'application doit les retirer explicitement à la fusion.
  const removesNotifications = /<uses-permission[^>]*android\.permission\.POST_NOTIFICATIONS[^>]*tools:node="remove"/.test(manifest);
  check(removesNotifications === !push, `permission de notification ${push ? 'conservée' : 'retirée'}`);
  check(gradle.includes(`applicationId '${identifier}'`), `applicationId ${identifier}`);
  check(gradle.includes(`namespace '${identifier}'`), `namespace ${identifier}`);
  check(/versionName "\d+\.\d+\.\d+"/.test(gradle), 'versionName au format x.y.z');
  check(manifest.includes('android:allowBackup="false"'), 'allowBackup désactivé');
  check(manifest.includes(`android:usesCleartextTraffic="${isDev}"`), `usesCleartextTraffic = ${isDev}`);
  check(manifest.includes('android:supportsRtl="true"'), 'RTL supporté (arabe)');
  check(manifest.includes(`android:scheme="${scheme}"`), `schéma de lien ${scheme}://`);
  check(manifest.includes('secure_store_data_extraction_rules'), 'jetons exclus des sauvegardes/transferts');
  // Le client de développement ajoute un schéma de lien et ses modules natifs : attendus en
  // développement, interdits ailleurs.
  const linked = execFileSync('npx', ['expo-modules-autolinking', 'resolve', '--platform', 'android', '--json'], { cwd: work, encoding: 'utf8' });
  const devClientTraces = [manifest.includes('android:scheme="exp+'), DEV_CLIENT_PACKAGES.some((name) => linked.includes(`"${name}"`))];
  check(devClientTraces.every((trace) => trace === isDev), `client de développement ${isDev ? 'présent' : 'absent'} (schéma exp+…, modules natifs liés)`);
  const sdk = readFileSync(join(root, 'node_modules/react-native/gradle/libs.versions.toml'), 'utf8');
  const targetSdk = Number(/targetSdk = "(\d+)"/.exec(sdk)?.[1]);
  check(targetSdk >= 35, `targetSdk ${targetSdk} >= 35 (exigence Google Play en vigueur à vérifier à chaque release)`);

  console.log(`\niOS — ${label}`);
  const iosDir = join(work, 'ios');
  const appDir = execFileSync('find', [iosDir, '-maxdepth', '2', '-name', 'Info.plist'], { encoding: 'utf8' }).trim().split('\n')[0];
  const plist = readFileSync(appDir, 'utf8');
  const pbx = readFileSync(
    execFileSync('find', [iosDir, '-name', 'project.pbxproj', '-not', '-path', '*/Pods/*'], { encoding: 'utf8' }).trim().split('\n')[0],
    'utf8',
  );
  const plistValue = (key) => new RegExp(`<key>${key}</key>\\s*<(?:string>([^<]*)</string|(true|false)/)>`).exec(plist);
  check(pbx.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${identifier}"`) || pbx.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${identifier};`), `bundle identifier ${identifier}`);
  check(plistValue('CFBundleDisplayName')?.[1] === displayName, `nom affiché « ${displayName} »`);
  check(/^\d+\.\d+\.\d+$/.test(plistValue('CFBundleShortVersionString')?.[1] ?? ''), 'CFBundleShortVersionString au format x.y.z');
  check(Boolean(plistValue('CFBundleVersion')), 'CFBundleVersion présent');
  // Le client de développement (expo-dev-client) écrit un texte d'accès au réseau local dans
  // l'Info.plist source et ajoute une phase de build qui le retire de tout binaire non Debug.
  // En développement, le texte n'est toléré que si cette phase est présente ; ailleurs, le
  // client est absent et ni l'un ni l'autre ne doit exister.
  const stripsDevKeys = pbx.includes('Strip Local Network Keys for Release');
  check(stripsDevKeys === isDev, `phase de build du client de développement ${isDev ? 'présente' : 'absente'}`);
  const usage = [...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)]
    .map((match) => match[1])
    .filter((key) => !(isDev && stripsDevKeys && key === 'NSLocalNetworkUsageDescription'));
  const expectedUsage = biometrics ? ['NSFaceIDUsageDescription'] : [];
  check(
    JSON.stringify(usage.sort()) === JSON.stringify(expectedUsage),
    `textes d'usage iOS = ${expectedUsage.join(', ') || 'aucun'} (trouvé : ${usage.join(', ') || 'aucun'})`,
  );
  if (biometrics) {
    check(/ATLAS MOBILE utilise Face ID/.test(plist), 'texte Face ID explicite et en français');
  }
  const entitlements = execFileSync('find', [iosDir, '-name', '*.entitlements', '-not', '-path', '*/Pods/*'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  check(entitlements.includes('aps-environment') === push, `capacité push iOS ${push ? 'présente' : 'absente'}`);
  check(plistValue('ITSAppUsesNonExemptEncryption')?.[2] === 'false', 'ITSAppUsesNonExemptEncryption = false');
  check(plistValue('NSAllowsArbitraryLoads')?.[2] === 'false', 'ATS : NSAllowsArbitraryLoads = false');
  check(plistValue('NSAllowsLocalNetworking')?.[2] === String(isDev), `ATS : NSAllowsLocalNetworking = ${isDev}`);
  const privacy = execFileSync('find', [iosDir, '-name', 'PrivacyInfo.xcprivacy', '-not', '-path', '*/Pods/*'], { encoding: 'utf8' }).trim();
  check(Boolean(privacy) && existsSync(privacy.split('\n')[0]), 'manifeste de confidentialité PrivacyInfo.xcprivacy généré');
  if (privacy) {
    const manifestXml = readFileSync(privacy.split('\n')[0], 'utf8');
    check(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(manifestXml), 'NSPrivacyTracking = false');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nConfiguration native conforme.');
