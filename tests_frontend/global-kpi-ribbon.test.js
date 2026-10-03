// Bandeau KPI du Global Shell — version compacte PARTAGÉE (≈58 px, une seule rangée).
// Contrat : structure « pastille + valeur + badge / libellé », aucun sous-texte, données, ordre,
// couleurs et liens du module inchangés, aucune variante par module. La hauteur réelle en pixels
// est mesurée en Chrome par tests_frontend/global-kpi-ribbon-chrome.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const STATIC = path.join(__dirname, '../app/static');
const SHELL = fs.readFileSync(path.join(STATIC, 'design-system/shell.css'), 'utf8');
const rule = selector => { const i = SHELL.indexOf(selector + ' {'); assert.ok(i >= 0, selector); return SHELL.slice(i, SHELL.indexOf('}', i)); };

function ribbon(t, transverse, items) {
  const r = loadSgdiApp(['emptyDB', 'moduleCountersRibbon']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  r.T().setDb(r.T().emptyDB());
  r.T().setSession({ username: 'KPI-01', role: 'ADM', adminSystem: true, transverse, societe: 'IRON GLOBAL SOLUTION' });
  const host = r.window.document.createElement('div');
  host.innerHTML = r.T().moduleCountersRibbon(items);
  return host.querySelector('.module-counters-ribbon');
}

const ITEMS = [
  { label: 'NBR SITE', value: 5, color: '#043970', route: 'sites/actifs', sub: 'site(s)' },
  { label: 'EFF. OPÉRATIONNEL', value: 163, color: '#047857', route: 'effectif/actifs', pctBase: 163 },
  { label: 'EFF. CONGÉ', value: 4, color: '#f59e0b', route: 'effectif/conge', pctBase: 200 },
  { label: 'EFF. ABSENT', value: 0, color: '#dc2626', route: 'effectif/absents', pctBase: 200 },
  { label: 'MISSION EN COURS', value: 2, color: '#7c3aed', route: 'ops/missions', pctBase: 2 },
];

for (const module of ['ops', 'drh', 'materiel', 'commercial']) {
  test(`KPI global compact — ${module} : pastille, valeur, badge puis libellé ; aucun sous-texte ; données conservées`, t => {
    const bar = ribbon(t, module, ITEMS);
    const items = [...bar.children];
    assert.equal(items.length, ITEMS.length, 'tous les compteurs du module, aucun ajouté ni retiré');
    for (const item of items) {
      assert.deepEqual([...item.children].map(el => el.className.split(' ')[0]),
        ['module-counter-dot', 'module-counter-value', 'module-counter-label', 'module-counter-pct'], 'quatre éléments, pas de ligne de sous-texte');
      assert.equal(item.tagName, 'A', 'chaque KPI reste un lien');
    }
    const text = selector => items.map(item => item.querySelector(selector).textContent);
    assert.deepEqual(text('.module-counter-value'), ['5', '163', '4', '0', '2'], 'valeurs inchangées');
    assert.deepEqual(text('.module-counter-label'), ['NBR SITE', 'OPÉRATIONNEL', 'CONGÉ', 'ABSENT', 'MISSION EN COURS'], 'libellés et ordre inchangés');
    assert.deepEqual(text('.module-counter-pct'), ['site(s)', '100%', '2%', '0%', '100%'], 'badges inchangés');
    assert.deepEqual(items.map(item => item.getAttribute('href')), ['#/sites/actifs', '#/effectif/actifs', '#/effectif/conge', '#/effectif/absents', '#/ops/missions'], 'liens inchangés');
    assert.deepEqual(items.map(item => item.dataset.tone), ['neutral', 'success', 'warning', 'danger', 'violet'], 'couleurs sémantiques inchangées');
    assert.doesNotMatch(bar.textContent, /Employés actifs|Attendance Core|Compteur serveur|Périmètre autorisé|Statut mission réel/);
    assert.equal(bar.className, 'module-counters-ribbon drh-workforce-ribbon no-print', 'même composant pour tous les modules');
  });
}

test('KPI global compact — géométrie partagée : 58 px, une rangée, défilement local, dimensions cibles', () => {
  const bar = rule('.sgdi-shell.atlas-shell-v4 .module-counters-ribbon');
  assert.match(bar, /height:58px!important; min-height:58px!important; max-height:58px!important/, 'hauteur totale 56–62 px');
  assert.match(bar, /grid-auto-flow:column!important/, 'une seule rangée');
  assert.match(bar, /grid-template-rows:minmax\(0,1fr\)!important/, 'jamais de seconde rangée');
  assert.match(bar, /overflow-x:auto!important; overflow-y:hidden!important/, 'défilement horizontal local au bandeau');
  assert.match(bar, /border-radius:var\(--atlas-radius-lg\)!important/, 'rayon 14 px');
  const item = rule('.sgdi-shell.atlas-shell-v4 .module-counter-item');
  assert.match(item, /padding:7px 10px!important/, 'padding vertical 6–8 px, horizontal 10–14 px');
  assert.match(item, /grid-template-areas:"dot value pct" "label label label"/, 'ligne 1 : pastille, valeur, badge ; ligne 2 : libellé');
  assert.match(item, /grid-template-rows:21px 12px!important/);
  assert.match(rule('.sgdi-shell.atlas-shell-v4 .module-counter-value'), /font-size:21px!important/, 'valeur ~20–22 px');
  const label = rule('.sgdi-shell.atlas-shell-v4 .module-counter-label');
  assert.match(label, /font-size:9\.5px!important/, 'libellé ~9–10 px');
  assert.match(label, /white-space:nowrap!important/, 'libellé sur une ligne');
  assert.match(label, /text-transform:uppercase!important/);
  assert.match(rule('.sgdi-shell.atlas-shell-v4 .module-counter-pct'), /padding:2px 5px!important/, 'badge très compact');
  assert.match(fs.readFileSync(path.join(STATIC, 'design-system/tokens.css'), 'utf8'), /--atlas-radius-lg:\s*14px;/);
  // Aucune règle responsive ne rétablit une hauteur ou un empilement.
  const responsive = SHELL.slice(SHELL.indexOf('/* Tablet and phone'));
  assert.doesNotMatch(responsive, /min-height|grid-template-columns|flex-wrap/);
});

test('KPI global compact — aucune variante par module', () => {
  const sources = ['design-system/shell.css', 'design-system/legacy.css', 'design-system/specialized.css', 'sgdi-app.css', 'sgdi-app.js']
    .map(file => fs.readFileSync(path.join(STATIC, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /\.(?:ops|drh|materiel|commercial|paie|pointage|admin)-kpi-(?:small|compact)/);
  assert.doesNotMatch(SHELL, /module-host-(?:ops|drh)[^{]*module-counter/, 'aucun sélecteur de module sur le bandeau');
});
