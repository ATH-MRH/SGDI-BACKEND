#!/usr/bin/env node
// LOT PERFORMANCE — DRH.IRONGS.COM + OPS.IRONGS.COM COLD START V3.
//
// Harnais de mesure reproductible pour les deux modules, via un vrai Chrome
// (Puppeteer-core piloté par CDP — aucun Chromium embarqué téléchargé). Ne
// modifie jamais la production : cible une instance locale/de test passée en
// argument, jamais un domaine réel.
//
// Usage :
//   BASE_URL=http://127.0.0.1:8001 CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node scripts/perf/drh-ops-cold-start.js --runs 5 --user perftest --password perftest12345 --societe "Iron Global Securite" --out results.json
//
// Alterne DRH/OPS/DRH/OPS/... comme demandé (jamais 5 DRH puis 5 OPS d'affilée),
// profil Chrome jetable à chaque passage froid, cache HTTP désactivé.
//
// NOTE — À LIRE : ce dossier scripts/perf/ contenait déjà, avant ce lot, un
// harnais DRH bien plus poussé et spécifique (drh_backend_bench.py, un serveur
// ASGI synthétique instrumenté au niveau SQL/ORM/sérialisation, et
// frontend-browser-server.js, un proxy de mesure navigateur qui suit déjà les
// requêtes dupliquées, les Long Tasks, le Resource Timing détaillé — voir
// README.md et frontend-README.md dans ce même dossier). Ce script-ci NE LE
// REMPLACE PAS : il apporte ce que l'existant ne couvrait pas — OPS en plus de
// DRH, et une mesure contre un vrai conteneur Docker/PostgreSQL plutôt qu'un
// serveur ASGI/SQLite synthétique en mémoire — via un vrai Chrome piloté par
// CDP. Les deux approches sont complémentaires, pas redondantes : consultez
// aussi le harnais existant pour toute investigation future.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const args = require('node:util').parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    user: { type: 'string', default: process.env.PERF_USER || 'perftest' },
    password: { type: 'string', default: process.env.PERF_PASSWORD || '' },
    societe: { type: 'string', default: process.env.PERF_SOCIETE || 'Iron Global Securite' },
    out: { type: 'string', default: 'scripts/perf/results.json' },
    mode: { type: 'string', default: 'cold' }, // cold | warm
  },
}).values;

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8001';
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = parseInt(args.runs, 10);
const MODE = args.mode;

// Route + marqueur DOM fiable "module visible" pour chaque cible — voir DRH Cold
// Start V2 pour la justification (.drh-pilot-head ne s'affiche pas sur le vrai
// chemin de clic depuis le portail société ; un marqueur texte stable est plus
// robuste que de deviner un sélecteur CSS interne).
const TARGETS = {
  drh: { key: 'drh', route: 'drh/dashboard', marker: 'TABLEAU DE BORD', heavyApi: '/api/drh/employees' },
  ops: { key: 'ops', route: 'ops/dashboard', marker: 'NBR SITE', heavyApi: '/api/ops/sites' },
};

async function runOnePass(targetName, passIndex) {
  const target = TARGETS[targetName];
  const userDataDir = MODE === 'cold'
    ? fs.mkdtempSync(path.join(os.tmpdir(), `chrome-perfv3-${targetName}-`))
    : path.join(os.tmpdir(), `chrome-perfv3-warm-${targetName}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    userDataDir,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(MODE === 'warm');
  if (process.env.PERF_DEBUG) {
    page.on('console', m => console.error('PAGE:', m.type(), m.text().slice(0, 200)));
    page.on('pageerror', e => console.error('PAGEERROR:', e.message));
  }

  const marks = {};
  const t0 = Date.now();
  marks.navigationStart = 0;

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  marks.htmlReceived = Date.now() - t0;

  await page.waitForFunction(() => typeof window.login === 'function', { timeout: 15000 });
  marks.scriptsReceived = Date.now() - t0;

  await page.evaluate((u, p) => { window.login(u, p); }, args.user, args.password);
  await page.waitForFunction(() => location.hash === '#/select-societe', { timeout: 15000 });
  marks.authTerminee = Date.now() - t0;

  await page.evaluate((s) => { window.pickSociete(s); }, args.societe);
  await page.waitForFunction(() => location.hash === '#/societe-portal', { timeout: 15000 });
  marks.permissionsTerminees = Date.now() - t0; // portail société = premier écran nécessitant droits+scope résolus

  await page.evaluate((mod, route) => { window.enterSocietePortalRoute(mod, route); }, target.key, target.route);

  await page.waitForFunction(
    (marker) => !!(document.body && document.body.innerText && document.body.innerText.includes(marker)),
    { timeout: 20000 },
    target.marker
  );
  marks.dashboardVisible = Date.now() - t0;
  marks.firstReady = marks.dashboardVisible; // définition figée : shell + nav + dashboard principal utilisables

  await page.waitForFunction(
    (api) => performance.getEntriesByType('resource').some(r => r.name.includes(api)),
    { timeout: 3000 },
    target.heavyApi
  ).then(() => { marks.heavyApiFired = true; }).catch(() => { marks.heavyApiFired = false; });

  await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
  marks.settled = Date.now() - t0;

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, startTime: p.startTime }));
    const resources = performance.getEntriesByType('resource').map(r => ({
      name: r.name, initiatorType: r.initiatorType, startTime: r.startTime,
      responseStart: r.responseStart, responseEnd: r.responseEnd, duration: r.duration,
      transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize,
    }));
    return { navigation: { domContentLoadedEventEnd: nav.domContentLoadedEventEnd, loadEventEnd: nav.loadEventEnd }, paints, resources };
  });

  await browser.close();
  if (MODE === 'cold') fs.rmSync(userDataDir, { recursive: true, force: true });

  return { target: targetName, mode: MODE, pass: passIndex, marks, perf };
}

(async () => {
  if (!args.password) { console.error('FATAL: --password requis (ou PERF_PASSWORD)'); process.exit(1); }
  const order = [];
  for (let i = 1; i <= RUNS; i++) { order.push(['drh', i]); order.push(['ops', i]); } // alterné, jamais 5+5 d'affilée

  const results = [];
  for (const [targetName, passIndex] of order) {
    console.error(`--- ${MODE} ${targetName} #${passIndex} ---`);
    const r = await runOnePass(targetName, passIndex);
    results.push(r);
    console.error(JSON.stringify(r.marks));
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(results, null, 2));
  console.log(`OK — ${results.length} passages écrits dans ${args.out}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
