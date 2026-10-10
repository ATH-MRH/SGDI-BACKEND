#!/usr/bin/env node
/**
 * Construit le bundle JavaScript de production (iOS + Android) dans un dossier
 * temporaire et vérifie que ni lui ni la configuration embarquée ne contiennent de secret
 * ou d'URL d'API codée en dur.
 *
 * Usage : node scripts/check-bundle.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'atlas-bundle-'));
// Hôte factice : s'il n'est pas le seul hôte ATLAS du bundle, une URL est codée en dur.
const PROBE_URL = 'https://atlas-bundle-probe.example.invalid';

const FORBIDDEN = [
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['jeton JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['clé AWS', /AKIA[0-9A-Z]{16}/],
  ['clé Google', /AIza[0-9A-Za-z_-]{35}/],
  ['clé Anthropic', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['clé OpenAI', /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ['jeton GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['jeton Slack', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['jeton Expo', /expo_[A-Za-z0-9]{20,}|EXPO_TOKEN/],
  ['secret backend', /JWT_SECRET|ADMIN_(SYSTEM|INITIAL)_PASSWORD|ADMIN_RECOVERY_SECRET|BIOMETRIC_TEMPLATE_KEY|ANTHROPIC_API_KEY|DATABASE_URL|POSTGRES_PASSWORD|SMTP_PASSWORD/],
  ['identifiant de signature', /keystorePassword|storePassword|keyPassword|ASC_API_KEY|APPLE_APP_SPECIFIC_PASSWORD/],
  ['hôte ATLAS codé en dur', /[a-z0-9-]+\.irongs\.com/i],
  ['base de données', /postgres(ql)?:\/\/[^\s"']+/i],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const failures = [];
let scanned = 0;
const buildEnv = { ...process.env, APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: PROBE_URL, ATLAS_FEATURES: '', CI: '1' };

function scan(label, content) {
  for (const [kind, pattern] of FORBIDDEN) {
    const match = pattern.exec(content);
    if (match) failures.push(`${kind} dans ${label} : « ${match[0].slice(0, 24)}… »`);
  }
}

try {
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--no-bytecode', '--output-dir', out],
    {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: buildEnv,
    },
  );

  for (const file of walk(out)) {
    if (/\.(png|jpg|jpeg|webp|ttf|otf)$/i.test(file)) continue;
    scan(relative(out, file), readFileSync(file, 'latin1'));
    scanned += 1;
  }

  // La configuration publique (app.config.ts résolu) est embarquée telle quelle
  // dans le binaire : c'est elle qui porte l'URL d'API de la variante.
  const publicConfig = execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: buildEnv,
  });
  scan('configuration publique', publicConfig);
  const extra = JSON.parse(publicConfig).extra ?? {};
  if (extra.apiUrl !== PROBE_URL) failures.push("l'URL d'API de la variante n'est pas celle injectée au build");
  if (extra.variant !== 'production') failures.push('la variante embarquée n\'est pas "production"');
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`${scanned} fichier(s) de bundle analysé(s).`);
if (scanned === 0) failures.push('aucun fichier de bundle produit');

if (failures.length) {
  console.error('Bundle NON conforme :');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Bundle conforme : aucun secret, aucune URL d'API codée en dur.");
