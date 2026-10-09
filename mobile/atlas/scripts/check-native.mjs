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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');

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
    'android.permission.INTERNET',
    ...(isDev ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
    // Verrouillage biométrique local : uniquement si la fonction est incluse dans le build.
    ...(biometrics ? ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT'] : []),
  ].sort();
  check(JSON.stringify(permissions) === JSON.stringify(allowed), `permissions = ${allowed.join(', ')} (trouvé : ${permissions.join(', ')})`);
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
  const usage = [...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)].map((match) => match[1]);
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
