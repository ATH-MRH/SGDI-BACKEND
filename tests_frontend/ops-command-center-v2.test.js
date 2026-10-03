// OPS Command Center V2 — données réelles, scopes et responsive sans toucher au shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

function boot(t, actions = ['read', 'create', 'update']) {
  const r = loadSgdiApp(['emptyDB', 'renderOpsCommandCenterV2']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  w.document.body.innerHTML = '<main id="view"></main>';
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  w.sgdiApi = async () => [];
  const db = r.T().emptyDB();
  const date = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  Object.assign(db, {
    sites: [
      { id: 's1', nom: 'SITE ALGER', societe: 'IRON GLOBAL SOLUTION', actif: true, wilaya: 'Alger', effectifs: { totalContractuel: 2 } },
      { id: 's2', nom: 'SITE ORAN', societe: 'AUTRE SOCIETE', actif: true, wilaya: 'Oran', effectifs: { totalContractuel: 99 } },
    ],
    agents: [
      { id: 'a1', nom: 'BENALI', prenom: 'Amine', matricule: 'A01', societe: 'IRON GLOBAL SOLUTION', statut: 'actif', affectationCourante: { siteId: 's1', siteName: 'SITE ALGER' } },
      { id: 'a2', nom: 'KACI', prenom: 'Sara', matricule: 'A02', societe: 'IRON GLOBAL SOLUTION', statut: 'actif' },
      { id: 'a3', nom: 'HORS', prenom: 'Scope', societe: 'AUTRE SOCIETE', statut: 'actif', affectationCourante: { siteId: 's2', siteName: 'SITE ORAN' } },
    ],
    feuillePresence: [
      { id: 'p1', date, agentId: 'a1', societe: 'IRON GLOBAL SOLUTION', siteId: 's1', siteName: 'SITE ALGER', code: 'P', scanArrivee: `${date}T08:12:00` },
      { id: 'p2', date, agentId: 'a3', societe: 'AUTRE SOCIETE', siteId: 's2', siteName: 'SITE ORAN', code: 'P', scanArrivee: `${date}T07:00:00` },
    ],
    missions: [{ id: 'm1', numero: 'MIS-001', agentId: 'a1', agentName: 'BENALI Amine', societe: 'IRON GLOBAL SOLUTION', lieu: 'SITE ALGER', dateDebut: date, dateFin: tomorrow, heureDebut: '08:00', heureFin: '18:00' }],
    incidents: [],
  });
  r.T().setDb(db);
  r.T().setSession({ username: 'OPS-01', role: 'ADM', adminSystem: true, transverse: 'ops', societe: 'IRON GLOBAL SOLUTION', actionsAutorisees: actions });
  r.T().renderOpsCommandCenterV2(w.document.getElementById('view'));
  return { ...r, w, root: w.document.querySelector('.ops-cc') };
}

test('OPS Command Center V2 rend les blocs opérationnels avec le périmètre société', t => {
  const { root } = boot(t);
  assert.ok(root);
  for (const title of ['Situation opérationnelle', 'Alertes & actions prioritaires', 'Répartition des effectifs', 'Situation des sites', 'Répartition territoriale', 'Missions en cours', 'Mouvements temps réel']) assert.match(root.textContent, new RegExp(title));
  assert.match(root.textContent, /SITE ALGER/);
  assert.doesNotMatch(root.textContent, /SITE ORAN|99/);
  assert.match(root.textContent, /08:12/);
  assert.match(root.textContent, /Sous-effectif/);
  assert.match(root.textContent, /MIS-001/);
  assert.equal(root.querySelectorAll('.ops-cc-summary,.ops-cc-kpi').length, 0);
  assert.ok(root.firstElementChild.classList.contains('ops-cc-head'), 'le titre remonte sans conteneur KPI vide');
});

test('OPS Command Center V2 masque les actions d’écriture pour un profil explicitement lecture seule', t => {
  const { root } = boot(t, ['read']);
  assert.equal(root.querySelectorAll('.ops-cc-action').length, 1);
  assert.match(root.querySelector('.ops-cc-action').textContent, /Rapport OPS/);
  assert.doesNotMatch(root.textContent, /Affecter du personnel|Planifier une mission|Déclarer une anomalie/);
});

test('OPS Command Center V2 gère honnêtement zéro, un et plusieurs sites', t => {
  const r = boot(t);
  assert.equal(r.root.querySelectorAll('.ops-cc-sites tbody tr').length, 1);
  assert.match(r.root.querySelector('.ops-cc-sites tbody').textContent, /SITE ALGER/);
  const empty = r.T().emptyDB();
  r.T().setDb(empty);
  r.T().renderOpsCommandCenterV2(r.w.document.getElementById('view'));
  assert.equal(r.w.document.querySelectorAll('.ops-cc-summary,.ops-cc-kpi').length, 0);
  assert.match(r.w.document.querySelector('.ops-cc-sites').textContent, /Aucun site dans le périmètre autorisé/);
  empty.sites = [
    { id: 'm1', nom: 'SITE 1', societe: 'IRON GLOBAL SOLUTION', actif: true },
    { id: 'm2', nom: 'SITE 2', societe: 'IRON GLOBAL SOLUTION', actif: true },
  ];
  r.T().renderOpsCommandCenterV2(r.w.document.getElementById('view'));
  assert.equal(r.w.document.querySelectorAll('.ops-cc-sites tbody tr').length, 2);
  assert.match(r.w.document.querySelector('.ops-cc-sites tbody').textContent, /SITE 1/);
  assert.match(r.w.document.querySelector('.ops-cc-sites tbody').textContent, /SITE 2/);
});

test('OPS Command Center V2 ne fabrique ni carte ni données géographiques', t => {
  const { root } = boot(t);
  assert.equal(root.querySelector('[data-map], iframe, canvas'), null);
  assert.match(root.textContent, /Wilaya ou commune renseignée/);
  assert.match(root.textContent, /Alger/);
  assert.doesNotMatch(root.innerHTML, /latitude|longitude|leaflet/i);
});

test('OPS Command Center V2 reste limité au contenu et définit ses paliers responsive', () => {
  const css = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../app/static/js/modules/ops.js'), 'utf8');
  assert.match(css, /\.ops-cc\{/);
  assert.match(css, /@media\(max-width:1200px\)/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.doesNotMatch(css.slice(css.indexOf('OPS Command Center V2')), /\.sgdi-(?:shell|topbar|sidebar)/);
  assert.match(js, /\/api\/attendance\/board\?/);
  assert.match(js, /SGDI\.sites\.situation/);
  assert.doesNotMatch(js.slice(js.indexOf('function opsCommandCenterRefreshAttendance'), js.indexOf('function renderOPS')), /setInterval\(/);
});
