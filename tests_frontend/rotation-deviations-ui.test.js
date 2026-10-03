// Planning intelligent, lot 3 — affichage des écarts de rotation.
//  • Pointeur : la fiche normale + « ROTATION INHABITUELLE », le pointage reste enregistré.
//  • Command Center OPS : alerte dans « Alertes & actions prioritaires », Examiner, qualifier.
//  • Centre de contrôle : historique de pointage et colonnes prévu / réel d'une feuille.
// Seul le réseau est simulé ; aucune donnée n'est calculée dans les pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { loadSgdiApp } = require('./load-app');
const { loadPointeur } = require('./load-pointeur');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const ALERT = { id: 9, type: 'UNEXPECTED_ROTATION', label: 'ROTATION INHABITUELLE', recorded: true,
  expected: { group: 'A', start: '06:00', end: '14:00' }, observed: { group: 'B', start: '14:00', end: '22:00' } };
const EVENT = { id: 51, type: 'ENTREE', heure: '14:02:11', source: 'FACIAL', state: 'PRESENT', site: 'DHL HAMOUL 01',
  employee: { nom: 'ADDA', prenom: 'Ibrahim', matricule: 'K162', fonction: 'MAGASINIER', societe: 'IGS' } };

test('Pointeur : fiche normale + ROTATION INHABITUELLE (attendu / observé), pointage enregistré, aucune action', (t) => {
  const p = loadPointeur();
  t.after(() => p.window.close());
  const d = p.window.document;
  p.T().showLastScan({ ...EVENT, rotation_alert: ALERT });
  const card = d.getElementById('lastScanCard');
  assert.match(card.textContent, /ADDA Ibrahim[\s\S]*K162[\s\S]*ENTRÉE ENREGISTRÉE[\s\S]*14:02:11[\s\S]*ÉTAT ACTUEL : PRÉSENT/);
  const box = card.querySelector('.last-scan-rotation');
  assert.equal(box.getAttribute('role'), 'alert');
  assert.match(box.textContent, /⚠ ROTATION INHABITUELLE\s*Attendu\s*Groupe A · 06:00–14:00\s*Observé\s*Groupe B · 14:00–22:00\s*POINTAGE ENREGISTRÉ/);
  assert.equal(card.classList.contains('is-entry'), true, 'le pointage reste une entrée acceptée, pas un refus');
  assert.equal(card.querySelectorAll('button,input,select,a').length, 0, 'le poste ne pilote pas le planning');
});

test('Pointeur : pointage conforme ou site sans planning actif ⇒ fiche inchangée ; texte échappé', (t) => {
  const p = loadPointeur();
  t.after(() => p.window.close());
  const d = p.window.document;
  p.T().showLastScan({ ...EVENT, id: 52, rotation_alert: null });
  assert.equal(d.querySelector('.last-scan-rotation'), null);
  p.T().showLastScan({ ...EVENT, id: 53 });
  assert.equal(d.querySelector('.last-scan-rotation'), null);
  assert.equal(p.T().rotationAlertHTML(null), '');
  const rest = p.T().rotationAlertHTML({ expected: { group: '<b>A</b>', start: '06:00', end: '14:00' }, observed: { group: null, start: '22:00', end: '06:00' } });
  assert.match(rest, /Groupe &lt;b&gt;A&lt;\/b&gt;/);
  assert.match(rest, /Repos · 22:00–06:00/);
});

const DEVIATION = { id: 9, type: 'UNEXPECTED_ROTATION', type_label: 'Rotation inhabituelle', severity: 'warning', status: 'OPEN', society: 'IRON GLOBAL SOLUTION',
  site: 'DHL HAMOUL 01', matricule: 'K162', name: 'ADDA Ibrahim', date: '2026-10-03', heure: '14:02', expected_group: 'A', expected_rotation: '06:00 – 14:00',
  observed_group: 'B', observed_rotation: '14:00 – 22:00', confidence: 0.91 };
const DETAIL = { ...DEVIATION, explanation: 'Référence attendue : groupe A (groupe appris par le moteur). 14 rotation(s) observée(s) · 12 avec le groupe A · 13/14 horaires cohérents',
  groups: ['A', 'B', 'C', 'D'], decision: null,
  recent: [{ date: '2026-10-03', rotation: '14:00 – 22:00', expected_group: 'A', observed_group: 'B', outcome_label: 'Rotation inhabituelle', qualification_label: null },
    { date: '2026-10-02', rotation: '06:00 – 14:00', expected_group: 'A', observed_group: 'A', outcome_label: 'Conforme', qualification_label: null }],
  actions: [{ key: 'PERMUTATION', label: 'Permutation exceptionnelle' }, { key: 'REPLACEMENT', label: 'Remplacement temporaire' },
    { key: 'GROUP_CHANGE', label: 'Changement de groupe confirmé' }, { key: 'FALSE_POSITIVE', label: 'Erreur / faux positif' }, { key: 'LATER', label: 'À examiner plus tard' }] };

function bootOps(t, { actions = ['read', 'update', 'validate'], items = [DEVIATION], qualify } = {}) {
  const r = loadSgdiApp(['emptyDB', 'renderOpsCommandCenterV2', 'opsExamineRotationDeviation', 'opsSubmitRotationQualification', 'opsRotationQualifyFields', 'opsCommandCenterRefreshRotationAlerts']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  const calls = [];
  w.document.body.innerHTML = '<main id="view"></main><div id="modal-host"></div>';
  w.setInterval = () => 1; w.clearInterval = () => {};
  w.sgdiApi = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body || null });
    if (url.startsWith('/api/attendance/rotation-deviations?')) return { items: url.includes('status=OPEN') ? items : [], total: items.length };
    if (url === '/api/attendance/rotation-deviations/9') return DETAIL;
    if (url === '/api/attendance/rotation-deviations/9/qualify') { if (qualify) return qualify(opts.body); return { ...DETAIL, status: 'RESOLVED' }; }
    return [];
  };
  r.T().setDb(r.T().emptyDB());
  r.T().setSession({ username: 'OPS-01', role: 'ADM', adminSystem: true, transverse: 'ops', societe: 'IRON GLOBAL SOLUTION', actionsAutorisees: actions });
  const render = () => r.T().renderOpsCommandCenterV2(w.document.getElementById('view'));
  w.renderView = render;
  render();
  return { ...r, w, d: w.document, calls, render };
}

test('OPS : l\'écart apparaît dans « Alertes & actions prioritaires » avec Examiner (données serveur, périmètre société)', async (t) => {
  const { d, calls, w, render } = bootOps(t, { items: [DEVIATION, { ...DEVIATION, id: 10, society: 'AUTRE SOCIETE', name: 'HORS Scope' }] });
  await tick(60);
  render();
  assert.deepEqual(calls.filter((c) => c.url.includes('rotation-deviations?')).map((c) => c.url.match(/status=(\w+)/)[1]).slice(0, 2), ['OPEN', 'ACKNOWLEDGED']);
  const card = d.querySelector('.ops-cc-alerts');
  const rows = [...card.querySelectorAll('[data-rotation-alert]')];
  assert.equal(rows.length, 1, 'une autre société ne fuit pas dans le cockpit');
  assert.match(rows[0].textContent, /CHANGEMENT DE ROTATION DÉTECTÉ\s*K162 — ADDA Ibrahim\s*DHL HAMOUL 01 · 2026-10-03 14:02\s*Attendu : Groupe A · 06:00 – 14:00\s*Observé : Groupe B · 14:00 – 22:00\s*Examiner/);
  assert.equal(card.querySelector('.ops-cc-count').textContent, '1');
  assert.equal(w.document.querySelector('.ops-cc-empty-rotation'), null);
});

test('OPS : Examiner montre employé, site, date, heure, attendu / observé, confiance, explication, historique', async (t) => {
  const { d, w } = bootOps(t);
  await tick(60);
  await w.opsExamineRotationDeviation(9);
  const modal = d.querySelector('[data-rotation-exam="9"]');
  const facts = Object.fromEntries([...modal.querySelectorAll('.ops-rotation-exam-grid > div')].map((n) => [n.querySelector('dt').textContent, n.querySelector('dd').textContent]));
  assert.deepEqual([facts['Employé'], facts['Site'], facts['Heure'], facts['Groupe attendu'], facts['Groupe observé'], facts['Rotation attendue'], facts['Rotation observée']],
    ['K162 — ADDA Ibrahim', 'DHL HAMOUL 01', '14:02', 'Groupe A', 'Groupe B', '06:00 – 14:00', '14:00 – 22:00']);
  assert.match(facts['Confiance du modèle'], /^91\s/);
  assert.match(modal.textContent, /Explication : Référence attendue : groupe A[\s\S]*14 rotation\(s\) observée\(s\) · 12 avec le groupe A/);
  assert.equal(modal.querySelectorAll('.ops-rotation-exam-table tbody tr').length, 2);
  assert.deepEqual([...modal.querySelectorAll('#opsRotationAction option')].map((o) => o.textContent),
    ['Permutation exceptionnelle', 'Remplacement temporaire', 'Changement de groupe confirmé', 'Erreur / faux positif', 'À examiner plus tard']);
  assert.match(modal.textContent, /Le pointage est enregistré et n'est pas modifié/);
});

test('OPS : qualification — champs selon la décision, envoi au serveur, erreur affichée sans fermer', async (t) => {
  let attempts = 0;
  const { d, w, calls } = bootOps(t, { qualify: () => { if (attempts++ === 0) { throw new Error('La fin du remplacement doit suivre son début'); } return { ...DETAIL, status: 'RESOLVED' }; } });
  await tick(60);
  await w.opsExamineRotationDeviation(9);
  const shown = (id) => d.getElementById(id).style.display !== 'none';
  assert.deepEqual([shown('opsRotationGroupRow'), shown('opsRotationEndRow')], [false, false]);        // permutation : rien à saisir
  d.getElementById('opsRotationAction').value = 'REPLACEMENT';
  w.opsRotationQualifyFields();
  assert.deepEqual([shown('opsRotationGroupRow'), shown('opsRotationEndRow')], [true, true]);
  assert.equal(d.getElementById('opsRotationGroup').value, 'B', 'groupe observé proposé');
  d.getElementById('opsRotationEnd').value = '2026-10-05T14:00';
  d.getElementById('opsRotationReason').value = 'Remplace un absent';
  await w.opsSubmitRotationQualification(9);
  assert.match(d.getElementById('opsRotationError').textContent, /fin du remplacement/);
  assert.ok(d.querySelector('[data-rotation-exam="9"]'), 'la fenêtre reste ouverte sur erreur');
  await w.opsSubmitRotationQualification(9);
  await tick(40);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(JSON.stringify(posts[1].body), JSON.stringify({ action: 'REPLACEMENT', reason: 'Remplace un absent', group: 'B', end_at: '2026-10-05T14:00' }));
  assert.equal(d.querySelector('[data-rotation-exam="9"]'), null);
  d.getElementById('modal-host').innerHTML = '';
  await w.opsExamineRotationDeviation(9);
  d.getElementById('opsRotationAction').value = 'GROUP_CHANGE';
  w.opsRotationQualifyFields();
  assert.deepEqual([shown('opsRotationGroupRow'), shown('opsRotationEndRow')], [true, false]);
});

test('OPS : profil sans action « validate » ⇒ consultation seule, aucune qualification possible', async (t) => {
  const { d, w, calls } = bootOps(t, { actions: ['read', 'update'] });
  await tick(60);
  await w.opsExamineRotationDeviation(9);
  const modal = d.querySelector('[data-rotation-exam="9"]');
  assert.equal(modal.querySelector('#opsRotationQualify'), null);
  assert.equal(modal.querySelectorAll('select,textarea,input').length, 0);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const HISTORY = { total: 2, page: 1, page_size: 50, items: [
  { sheet_id: 7, site: 'DHL HAMOUL 01', date: '2026-10-03', rotation: '14:00 – 22:00', sheet_status: 'ARCHIVED', employee_id: 11, matricule: 'K162', name: 'ADDA Ibrahim', first_entry: '14:02', last_exit: '22:01', events_count: 2,
    state: 'SORTI', anomaly: null, expected_group: 'A', observed_group: 'B', outcome: 'UNEXPECTED_ROTATION', outcome_label: 'Rotation inhabituelle', deviation_status: 'RESOLVED', qualification_label: 'Permutation exceptionnelle' },
  { sheet_id: 6, site: 'DHL HAMOUL 01', date: '2026-10-02', rotation: '06:00 – 14:00', sheet_status: 'ARCHIVED', employee_id: 11, matricule: 'K162', name: '<img src=x onerror=alert(1)>', first_entry: '06:01', last_exit: '', events_count: 1,
    state: 'PRESENT', anomaly: 'DEPART_MANQUANT', expected_group: null, observed_group: 'A', outcome: 'NOT_EVALUATED', outcome_label: 'Non évalué', deviation_status: null, qualification_label: null }] };
const SHEET = { id: 7, date: '2026-10-03', label: '14:00 – 22:00', site: 'DHL HAMOUL 01', status: 'ARCHIVED', expected_group: 'B', observed_group: 'B', interpretation: { group: 'B' }, closed_at: '2026-10-03T22:00:00+01:00', closed_by: 'system', lines: [
  { id: 1, matricule: 'K162', name: 'ADDA Ibrahim', fonction: 'MAGASINIER', declared_group: 'A', first_entry: '14:02:00', last_exit: '22:01:00', state: 'SORTI', events_count: 2, anomaly: null, events: [],
    expected_group: 'A', observed_group: 'B', outcome: 'UNEXPECTED_ROTATION', outcome_label: 'Rotation inhabituelle', qualification_label: 'Permutation exceptionnelle' },
  { id: 2, matricule: 'K201', name: 'BENALI Sara', fonction: 'CARISTE', declared_group: 'B', first_entry: '14:00:00', last_exit: '22:00:00', state: 'SORTI', events_count: 2, anomaly: null, events: [],
    expected_group: 'B', observed_group: 'B', outcome: 'CONFORM', outcome_label: 'Conforme', qualification_label: null }] };

function bootControl(hash) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/' + hash, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET' });
        let data = {};
        if (u.pathname === '/api/auth/me') data = { username: 'DRH01' };
        else if (u.pathname === '/api/attendance/sites') data = [{ id: 3, name: 'DHL HAMOUL 01', society: 'SOC' }];
        else if (u.pathname === '/api/attendance/rotation-history') data = HISTORY;
        else if (u.pathname === '/api/attendance/sheets/7') data = SHEET;
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, calls };
}

test('Centre de contrôle : historique de pointage — filtres serveur, prévu / réel / décision, lecture seule', async () => {
  const { d, w, calls, dom } = bootControl('#/history');
  await tick(80);
  assert.equal(d.getElementById('view-history').classList.contains('hidden'), false);
  const first = calls.find((c) => c.path === '/api/attendance/rotation-history');
  assert.ok(first.query.date_from < first.query.date_to);
  assert.equal('site_id' in first.query, false);
  const rows = [...d.querySelectorAll('#history-rows tr')];
  assert.match(rows[0].textContent, /2026-10-03\s*14:00 – 22:00\s*DHL HAMOUL 01\s*ADDA IbrahimK162\s*14:02\s*22:01\s*2\s*Groupe A\s*Groupe B\s*Rotation inhabituelle\s*Permutation exceptionnelle/);
  assert.match(rows[1].textContent, /Départ manquant[\s\S]*—\s*Groupe A\s*Non évalué\s*—/);
  assert.equal(rows[1].querySelector('img'), null, 'aucune injection HTML');
  assert.match(d.getElementById('history-total').textContent, /2 ligne\(s\) · page 1\/1/);
  d.getElementById('f-site').value = '3';
  d.getElementById('h-employee').value = 'K162';
  d.getElementById('h-group').value = 'B';
  d.getElementById('h-outcome').value = 'DEVIATION';
  d.getElementById('h-status').value = 'ARCHIVED';
  d.getElementById('h-anomaly').value = 'DEPART_MANQUANT';
  d.getElementById('h-outcome').dispatchEvent(new w.Event('change'));
  await tick(60);
  const last = calls.filter((c) => c.path === '/api/attendance/rotation-history').at(-1).query;
  assert.deepEqual([last.site_id, last.q, last.group, last.outcome, last.status, last.anomaly, last.page], ['3', 'K162', 'B', 'DEVIATION', 'ARCHIVED', 'DEPART_MANQUANT', '1']);
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  dom.window.close();
});

test('Centre de contrôle : feuille archivée — groupe attendu / observé et écart par salarié', async () => {
  const { d, dom } = bootControl('#/history');
  await tick(80);
  d.querySelector('[data-h-sheet="7"]').click();
  await tick(60);
  const modal = d.querySelector('#modal-host .modal');
  assert.match(modal.querySelector('.sub').textContent, /DHL HAMOUL 01 · Archivée · groupe attendu B · groupe observé B · groupe appris B/);
  assert.deepEqual([...modal.querySelectorAll('thead th')].map((n) => n.textContent), ['Employé', 'Groupe', 'Première entrée', 'Dernière sortie', 'État', 'Attendu / observé', 'Pointages bruts']);
  const lines = [...modal.querySelectorAll('tbody tr')];
  assert.match(lines[0].children[5].textContent, /Rotation inhabituelle\s*A → B · Permutation exceptionnelle/);
  assert.match(lines[1].children[5].textContent, /Conforme\s*B → B/);
  assert.equal(modal.querySelectorAll('input,select,textarea').length, 0);
  dom.window.close();
});
