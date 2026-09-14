// BUG PRODUCTION 0.6-A — bouton "Ouvrir →" inactif dans #/alerts.
// Couverture comportementale RÉELLE : clic effectif sur l'ancre rendue par
// alertsTableHTML (pas un appel direct à renderAlerts avec des arguments
// fabriqués), à travers le vrai routeur (renderView -> case"alerts") et le
// vrai chargement lazy du script. C'est précisément ce que l'ancienne suite
// ne couvrait pas et qui a laissé passer le bug en production.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadSgdiApp } = require('./load-app');

const tick = () => new Promise(resolve => setTimeout(resolve, 150));

function alert(id, overrides) {
  return Object.assign({
    id, rule_key: 'drh.employee_contract.expiring', rule_version: 1, source_type: 'employee', source_id: String(id),
    society: 'IRON GLOBAL SECURITE', site_id: null, status: 'open', severity: 'critical', score: 90, confidence: 100,
    title: `Contrat expirant — E${id}`, summary: 'Expire dans 2 jours', first_detected_at: '2026-09-13T10:00:00',
    last_detected_at: '2026-09-13T10:00:00', occurrence_count: 1, assigned_user_id: null, dedup_key: 'x' + id,
  }, overrides || {});
}
function detailFor(listAlert) {
  const { id, rule_key, title, society, site_id, status, severity, score, confidence, occurrence_count } = listAlert;
  return {
    id, rule_key, title, summary: 'Expire dans 2 jours',
    society, site_id, status, severity, score, confidence,
    occurrence_count, explanation: "Score 90/100 : proximité de l'échéance (+80), statut employé actif (+10).",
    score_factors: [{ key: 'days_remaining_band', label: 'Contrat expire dans 2 jour(s)', value: 2, weight: 80, contribution: 80 }],
    evidence: [{ id: 1, evidence_type: 'employee', evidence_key: 'detection_snapshot', evidence_value_json: { employee_code: `E${id}` }, observed_at: '2026-09-13T10:00:00' }],
    history: [{ id: 1, action: 'detected', previous_status: null, new_status: 'open', reason: null, created_at: '2026-09-13T10:00:00' }],
  };
}

function bootLazy() {
  const ctx = loadSgdiApp(['renderView'], { lazyModules: true });
  assert.ifError(ctx.loadError);
  ctx.dom.reconfigure({ url: 'http://localhost/' });
  const { window: w, T } = ctx;
  for (const id of ['sidebar-nav', 'view']) w.document.getElementById('app').appendChild(w.document.getElementById(id));
  const errors = [], downloads = [], apiCalls = [];
  w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.console.error = (...args) => errors.push(args);
  w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}), text: async () => '' });
  w.setInterval = () => 0;
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = el => {
    if (el.src && el.src.includes('/static/js/modules/')) {
      const url = new URL(el.src);
      const filename = path.join(__dirname, '../app', url.pathname);
      assert.ok(fs.existsSync(filename), 'aucun 404 : ' + url.pathname);
      downloads.push(url.pathname);
      assert.strictEqual(url.searchParams.get('v'), w.SGDIModules.MODULE_VERSION);
      el.removeAttribute('src');
      el.textContent = fs.readFileSync(filename, 'utf8');
      append(el);
      queueMicrotask(() => el.onload());
      return el;
    }
    return append(el);
  };
  T().setDb(new Proxy({}, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  T().setSession({ username: 'admin', role: 'ADM', adminSystem: true, transverse: 'admin', societe: '' });
  T().setFullDataReady(true);
  T().setViewMode(true);
  const alerts = { 10: alert(10), 20: alert(20, { title: 'Absence pointage — S20', rule_key: 'attendance.presence.missing_checkout' }) };
  w.sgdiApi = async url => {
    apiCalls.push(url);
    if (url.startsWith('/alerts/stats')) return { total_open: 2, critical: 1, unacknowledged: 2, assigned_to_me: 0 };
    if (url.startsWith('/alerts?')) return { items: Object.values(alerts), total: 2, page: 1, page_size: 50, pages: 1 };
    const m = url.match(/^\/alerts\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (!alerts[id]) throw new Error('Alerte introuvable ou accès refusé');
      return detailFor(alerts[id]);
    }
    return {}; // autres endpoints (ex. sidebar-stats déclenché par la traversée DRH) : hors périmètre de ce test
  };
  const go = hash => { w.history.replaceState(null, '', hash); assert.equal(T().renderView(), undefined); };
  return { ...ctx, errors, downloads, apiCalls, go, view: () => w.document.getElementById('view') };
}

function openLink(view, id) {
  return [...view.querySelectorAll('a')].find(a => a.getAttribute('href') === `#/alerts/${id}`);
}

test('clic réel sur "Ouvrir →" : requête détail avec le bon ID et fiche affichée (titre/score/preuves/historique)', async () => {
  const r = bootLazy();
  r.go('#/alerts'); await tick();
  const link = openLink(r.view(), 10);
  assert.ok(link, 'le lien "Ouvrir →" de l\'alerte 10 doit exister dans le tableau rendu');
  assert.match(link.textContent, /Ouvrir/);
  link.click();
  await tick();
  assert.equal(r.apiCalls[r.apiCalls.length - 1], '/alerts/10', 'le clic doit interroger /alerts/10, pas la liste');
  const text = r.view().textContent;
  assert.match(text, /Contrat expirant — E10/);
  assert.match(text, /90/);
  assert.match(text, /proximité de l'échéance/);
  assert.match(text, /E10/); // preuve
  assert.match(text, /detected/); // historique
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('deux alertes différentes : chaque clic "Ouvrir" ouvre la bonne fiche, sans ID résiduel', async () => {
  const r = bootLazy();
  r.go('#/alerts'); await tick();
  openLink(r.view(), 10).click();
  await tick();
  assert.match(r.view().textContent, /Contrat expirant — E10/);
  r.go('#/alerts'); await tick(); // retour liste
  openLink(r.view(), 20).click();
  await tick();
  assert.equal(r.apiCalls[r.apiCalls.length - 1], '/alerts/20');
  assert.match(r.view().textContent, /Absence pointage — S20/);
  assert.doesNotMatch(r.view().textContent, /Contrat expirant — E10/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('retour à la liste depuis la fiche détail', async () => {
  const r = bootLazy();
  r.go('#/alerts'); await tick();
  openLink(r.view(), 10).click();
  await tick();
  const back = [...r.view().querySelectorAll('button')].find(b => /Retour au cockpit/.test(b.textContent));
  assert.ok(back);
  back.click();
  await tick();
  assert.match(r.view().textContent, /Cockpit Alertes/);
  assert.match(r.view().textContent, /Contrat expirant — E10/);
  assert.match(r.view().textContent, /Absence pointage — S20/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('ouverture de la fiche après navigation DRH → Alertes', async () => {
  const r = bootLazy();
  r.go('#/dashboard'); await tick();
  r.go('#/drh/dashboard'); await tick();
  r.go('#/alerts'); await tick();
  const link = openLink(r.view(), 20);
  assert.ok(link);
  link.click();
  await tick();
  assert.equal(r.apiCalls[r.apiCalls.length - 1], '/alerts/20');
  assert.match(r.view().textContent, /Absence pointage — S20/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('erreur API contrôlée à l\'ouverture : carte d\'erreur, pas de page blanche ni de crash', async () => {
  const r = bootLazy();
  r.go('#/alerts'); await tick();
  // Alerte listée mais dont le détail échoue (ex. révoquée entre-temps) : le clic
  // ne doit jamais planter le module, seulement afficher un message clair.
  const link = openLink(r.view(), 10);
  const w = r.window;
  const originalApi = w.sgdiApi;
  w.sgdiApi = async url => { if (url === '/alerts/10') throw new Error('Alerte introuvable ou accès refusé'); return originalApi(url); };
  link.click();
  await tick();
  assert.match(r.view().textContent, /Alerte introuvable ou accès refusé/);
  assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|undefined/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('aucun double handler : plusieurs clics/allers-retours ne chargent alerts.js qu\'une seule fois', async () => {
  const r = bootLazy();
  r.go('#/alerts'); await tick();
  openLink(r.view(), 10).click(); await tick();
  r.go('#/alerts'); await tick();
  openLink(r.view(), 20).click(); await tick();
  r.go('#/alerts'); await tick();
  openLink(r.view(), 10).click(); await tick();
  assert.equal(r.downloads.filter(d => d.endsWith('/alerts.js')).length, 1, 'alerts.js ne doit être injecté qu\'une seule fois');
  assert.equal(r.apiCalls[r.apiCalls.length - 1], '/alerts/10');
  assert.deepEqual(r.errors, []);
  r.window.close();
});
