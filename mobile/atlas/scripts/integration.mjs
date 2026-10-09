#!/usr/bin/env node
/**
 * Lance les tests d'intégration mobile ↔ backend : démarre le backend ATLAS du
 * dépôt sur une base SQLite jetable, exécute tests/integration, puis l'arrête.
 *
 * Prérequis : un Python disposant des dépendances backend (requirements.txt).
 *   ATLAS_PYTHON=/chemin/vers/python npm run test:integration
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..', '..');
// Sans ATLAS_IT_PORT, le système choisit un port libre. Un port déjà pris est refusé : le
// serveur qui l'occupe répondrait à /health à la place du backend de test.
const bindable = (wanted) =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`le port ${wanted} est déjà utilisé`)));
    probe.listen(wanted, '127.0.0.1', () => {
      const { port: bound } = probe.address();
      probe.close(() => resolve(bound));
    });
  });
let port;
try {
  port = await bindable(Number(process.env.ATLAS_IT_PORT ?? 0));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const password = randomBytes(12).toString('hex');
const python = process.env.ATLAS_PYTHON ?? 'python3';

const backend = spawn(python, [join(root, 'scripts', 'it_backend.py'), repoRoot, String(port)], {
  env: { ...process.env, IT_PASSWORD: password },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let exitCode = 1;
try {
  const fixtures = await new Promise((resolve, reject) => {
    let buffer = '';
    backend.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n').find((entry) => entry.startsWith('ATLAS_IT '));
      if (line) resolve(JSON.parse(line.slice('ATLAS_IT '.length)));
    });
    backend.on('exit', (code) => reject(new Error(`le backend de test s'est arrêté (code ${code})`)));
    setTimeout(() => reject(new Error('le backend de test ne démarre pas')), 90_000);
  });

  const url = `http://localhost:${port}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      // pas encore prêt
    }
    if (backend.exitCode !== null) throw new Error(`le backend de test s'est arrêté (code ${backend.exitCode})`);
    if (attempt > 120) throw new Error('le backend de test ne répond pas sur /health');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const account = (name) => `${name}:${password}`;
  const result = spawnSync('npx', ['jest', 'tests/integration', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ATLAS_IT_URL: url,
      ATLAS_IT_ADMIN: account('itboss'),
      ATLAS_IT_OPS: account('itops'),
      ATLAS_IT_NOSCOPE: account('itnoscope'),
      ATLAS_IT_NOMODULE: account('itnomodule'),
      ATLAS_IT_INACTIVE: account('itinactive'),
      ATLAS_IT_ONESITE: account('itonesite'),
      ATLAS_IT_EMPLOYEE: account('itemp1'),
      ATLAS_IT_EMPLOYEE_OTHER: account('itemp2'),
      ATLAS_IT_EXPIRED_TOKEN: fixtures.expired_token,
      ATLAS_IT_TOKEN_CLIENT_PORTAL: fixtures.client_portal,
      ATLAS_IT_TOKEN_EMPLOYEE_PORTAL: fixtures.employee_portal,
      ATLAS_IT_TOKEN_ATTENDANCE_QR: fixtures.attendance_qr,
      ATLAS_IT_TOKEN_SSE_TICKET: fixtures.sse_ticket,
      ATLAS_IT_OTHER_SITE_ID: String(fixtures.other_site_id),
      ATLAS_IT_FOREIGN_SITE_ID: String(fixtures.foreign_site_id),
    },
  });
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  backend.kill();
}
process.exit(exitCode);
