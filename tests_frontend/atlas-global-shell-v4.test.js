// ATLAS Global Shell V4 — standard visuel du shell commun : sidebar marine (V3), header BLANC,
// bandeau KPI marine FLOTTANT, contenu clair. Les données, menus, routes et permissions restent
// ceux de chaque module. « Fiche de position » n'est plus une entrée de la barre latérale.
// Vrai sgdi-app.js dans jsdom ; le rendu visuel réel est contrôlé par l'E2E du Design System.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const DS = path.join(__dirname, '../app/static/design-system');
const MODULES = {
  drh: 'drh/dashboard', ops: 'ops/dashboard', superviseur: 'superviseur/dashboard', materiel: 'materiel/dashboard',
  facturation: 'facturation/dashboard', facmod: 'facturation/dashboard', secretariat: 'secretariat/dashboard',
  agenda: 'agenda/dashboard', pointage: 'pointage', paie: 'paie/dashboard', global: 'global-dashboard',
  admin: 'admin/dashboard', commercial: 'commercial/dashboard',
};

function boot(t, transverse, route) {
  const r = loadSgdiApp(['emptyDB', 'renderInternal', 'renderSidebar', 'atlasAccountHTML', 'atlasLegacyTopbarHTML',
    'moduleCounterTone', 'moduleCounterItemHTML', 'moduleCountersRibbon', 'sgdiModuleHostConfigs']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  w.setTimeout = () => 0;
  w.requestAnimationFrame = () => 0;
  r.dom.reconfigure({ url: 'http://localhost/#/' + route });
  w.document.body.innerHTML = '<div id="app"></div><div id="modal-host"></div>';
  r.T().setDb(r.T().emptyDB());
  r.T().setSession({ username: 'OPS-01', nom: 'Karim Test', role: 'ADM', adminSystem: true, transverse, societe: transverse === 'admin' ? null : 'IRON GLOBAL SOLUTION' });
  r.T().setFullDataReady(true);
  r.T().setViewMode(true);
  w.sgdiBackendShouldUse = () => false;
  w.refreshOpsClientObservationsCount = () => {};
  w.renderView = () => {};
  r.T().renderInternal();
  return { ...r, w, shell: w.document.querySelector('.sgdi-shell') };
}

for (const [module, route] of Object.entries(MODULES)) {
  test(`Global Shell V4 — ${module} : même shell, header (module, société, utilisateur), sidebar sans « Fiche de position »`, t => {
    const { shell } = boot(t, module, route);
    assert.ok(shell, 'shell commun rendu');
    assert.equal(shell.classList.contains('atlas-shell-v4'), true);
    assert.equal(shell.classList.contains('atlas-sidebar-v3'), true, 'sidebar marine V3 conservée');
    const top = shell.querySelector(':scope > .sgdi-topbar');
    assert.ok(top.querySelector('.sgdi-sidebar-toggle'), 'hamburger conservé');
    assert.ok(top.querySelector('.topbar-back-btn'), 'retour conservé');
    assert.ok(top.querySelector('.atlas-workspace-tools'), 'Outils conservé');
    assert.ok(top.querySelector('.sgdi-topbar-module-title').textContent.trim().length > 0, 'nom du module');
    if (module !== 'admin') assert.match(top.querySelector('.atlas-context-label').textContent, /Société active : IRON GLOBAL SOLUTION/);
    const account = top.querySelector('.atlas-account');
    assert.match(account.textContent, /OPS-01/, 'code utilisateur');
    assert.equal(account.querySelector('.atlas-account-name').getAttribute('title'), 'Karim Test');
    assert.ok(account.querySelector('small').textContent.trim().length > 0, 'rôle');
    // Barre latérale : jamais « Fiche de position » ; aucune route de fiche en entrée de menu.
    const nav = shell.querySelector('#sidebar-nav');
    assert.doesNotMatch(shell.querySelector('.sidebar').textContent, /fiches?\s+de\s+position/i);
    for (const fiche of ['fiches', 'admin/fiches', 'materiel/fiches']) assert.equal(nav.querySelector(`[data-route="${fiche}"]`), null, fiche);
  });
}

test('Global Shell V4 — bandeau KPI : valeur, libellé, indicateur, accent sémantique ; données du module inchangées', t => {
  const r = boot(t, 'ops', 'ops/dashboard');
  const tone = r.T().moduleCounterTone;
  assert.deepEqual(['#047857', '#16a34a', '#f59e0b', '#c2410c', '#dc2626', '#7c3aed', '#0ea5e9', '#2563eb', '#043970', '#111827', '#64748b', '', 'red'].map(tone),
    ['success', 'success', 'warning', 'warning', 'danger', 'violet', 'info', 'info', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
  const host = r.w.document.createElement('div');
  host.innerHTML = r.T().moduleCountersRibbon([
    { label: 'NBR SITE', value: 5, color: '#043970', route: 'sites/actifs', sub: 'site(s)' },
    { label: 'EFF. OPÉRATIONNEL', value: 163, color: '#047857', route: 'effectif/actifs', pctBase: 163 },
    { label: 'EFF. ABSENT', value: 0, color: '#dc2626', route: 'effectif/absents', pctBase: 163 },
  ]);
  const bar = host.querySelector('.module-counters-ribbon');
  const items = [...bar.querySelectorAll('.module-counter-item')];
  assert.deepEqual(items.map(i => i.dataset.tone), ['neutral', 'success', 'danger']);
  assert.deepEqual(items.map(i => i.querySelector('.module-counter-value').textContent), ['5', '163', '0'], 'valeurs du module, jamais inventées');
  assert.deepEqual(items.map(i => i.querySelector('.module-counter-label').textContent), ['NBR SITE', 'OPÉRATIONNEL', 'ABSENT']);
  assert.deepEqual(items.map(i => i.querySelector('.module-counter-pct').textContent), ['site(s)', '100%', '0%']);
  assert.deepEqual(items.map(i => i.getAttribute('href')), ['#/sites/actifs', '#/effectif/actifs', '#/effectif/absents'], 'routes inchangées');
  assert.equal(items[2].classList.contains('is-zero'), true);
  assert.equal(bar.querySelectorAll('svg,img').length, 0, 'aucune icône décorative dans le bandeau');
});

test('Global Shell V4 — Design System : shell.css versionné, tokens dédiés, header blanc et bandeau marine flottant', () => {
  const tokens = fs.readFileSync(path.join(DS, 'tokens.css'), 'utf8');
  for (const name of ['shell-bg', 'header-bg', 'header-text', 'header-muted', 'kpi-bg-start', 'kpi-bg-mid', 'kpi-bg-end', 'kpi-text', 'kpi-muted', 'kpi-divider', 'content-bg', 'card-bg', 'card-border']) {
    assert.match(tokens, new RegExp(`--atlas-${name}:\\s*#`), name);
  }
  assert.match(tokens, /--atlas-header-bg:\s*#ffffff;/i, 'header blanc');
  assert.match(fs.readFileSync(path.join(DS, 'atlas.css'), 'utf8'), /@import url\('\.\/shell\.css\?v=/);
  const css = fs.readFileSync(path.join(DS, 'shell.css'), 'utf8');
  const rule = selector => { const i = css.indexOf(selector + ' {'); assert.ok(i >= 0, selector); return css.slice(i, css.indexOf('}', i)); };
  assert.match(rule('.sgdi-shell.atlas-shell-v4>.sgdi-topbar'), /background:var\(--atlas-header-bg\)!important/);
  const bar = rule('.sgdi-shell.atlas-shell-v4 .module-counters-ribbon');
  assert.match(bar, /linear-gradient\(90deg,var\(--atlas-kpi-bg-start\)/, 'bleu marine en dégradé');
  assert.match(bar, /border-radius:var\(--atlas-radius-lg\)!important/, 'coins arrondis');
  assert.match(bar, /box-shadow:var\(--atlas-kpi-shadow\)!important/, 'ombre légère');
  assert.match(bar, /margin:0 0 14px!important/, 'espace sous le bandeau');
  assert.match(bar, /overflow-x:auto!important/, 'défilement local, jamais global');
  assert.doesNotMatch(css, /\.sgdi-shell(?!\.atlas-shell-v4)[ >.]/, 'tout est limité au shell V4');
});

test('Global Shell V4 — la fiche employé reste accessible hors barre latérale (routes et portails inchangés)', t => {
  const r = boot(t, 'ops', 'ops/dashboard');
  const tiles = r.T().sgdiModuleHostConfigs();
  assert.ok(tiles.drh.sections.some(s => s.route === 'fiches'));
  assert.ok(tiles.admin.sections.some(s => s.route === 'admin/fiches'));
  const source = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8');
  assert.match(source, /ops:\["ops","pointage","fiches","agents","sites","effectif"/, 'routes fiches/agents toujours autorisées pour OPS');
});
