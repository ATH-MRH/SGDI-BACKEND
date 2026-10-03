// pointage.irongs.com — vue « Planning intelligent » (lot 2 : modèle APPRIS des groupes et rotations).
// Tests jsdom sur le VRAI app/static/pointage/index.html ; seul le réseau est simulé. L'écran ne
// calcule rien : il affiche les valeurs mesurées par le moteur, « — » quand il n'y en a pas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const COND = (key, label, value, required, status) => ({ key, label, value, required, status });
const STABLE = { site_id: 3, site: 'DHL HAMOUL 01', sheets_configured: true, expected_groups: 4, enabled: true, mode: 'LEARNING', learning: true,
  state: 'STABLE', sheets_observed: 16, days_observed: 6, groups_detected: 4, mean_confidence: 0.91, model_version: 5, engine_version: 'rot-learn-1',
  computed_at: '2026-10-10T14:01:00+01:00', cycle: { found: true, period: 4, pattern: ['A', 'B', 'C', 'D'], concordance: 1, comparisons: 12 },
  next: { group: 'A', rest: false, label: '14:00 – 22:00', indicative: false },
  conditions: [COND('sheets', 'Rotations observées', 16, 8, 'ok'), COND('members', 'Salariés suivis dont le groupe est probable', 1, 0.8, 'ok')], params: {}, overrides: {} };
const FRESH = { site_id: 4, site: 'Site neuf', sheets_configured: true, expected_groups: 4, enabled: true, mode: 'LEARNING', learning: true,
  state: 'LEARNING', sheets_observed: 0, days_observed: 0, groups_detected: 0, mean_confidence: null, model_version: 0, engine_version: 'rot-learn-1',
  computed_at: null, cycle: null, next: null, conditions: [], params: {}, overrides: {} };
const OFF = { ...FRESH, site_id: 5, site: 'Site éteint', mode: 'OFF', learning: false, state: null };
const MEMBER = (id, matricule, name, status, confidence, extra = {}) => ({ employee_id: id, matricule, name, status, confidence, explanation: '4 rotation(s) observée(s) · 4 avec le groupe A · 4/4 horaires cohérents', ...extra });
const GROUPS = { ...STABLE, groups: [
  { id: 1, label: 'A', status: 'STABLE', sheets_count: 4, usual_start: '06:00', usual_end: '14:00', usual_share: 0.5, confidence: 0.91, last_observed_at: '2026-10-10T06:00:00+01:00',
    members_probable: [MEMBER(11, 'K162', 'ADDA IBRAHIM', 'PROBABLE', 0.91)], members_confirmed: [], members_learning: [MEMBER(12, 'K300', '<img src=x onerror=alert(1)>', 'LEARNING', 0.2)] },
  { id: 2, label: 'G5', status: 'LEARNING', sheets_count: 1, usual_start: null, usual_end: null, usual_share: null, confidence: null, last_observed_at: null,
    members_probable: [], members_confirmed: [], members_learning: [] },
] };
const CARD = { employee_id: 11, matricule: 'K162', name: 'ADDA IBRAHIM', fonction: 'MAGASINIER',
  memberships: [{ site_id: 3, site: 'DHL HAMOUL 01', declared_group: 'B', learned_group: 'A', confirmed_group: null, candidate_group: 'A', status: 'PROBABLE', confidence: 0.91,
    observations: 14, with_group: 12, explanation: '14 rotation(s) observée(s) · 12 avec le groupe A · 13/14 horaires cohérents', last_observed_at: '2026-10-03T06:00:00+01:00' }],
  history: [{ changed_at: '2026-10-01T14:00:00+01:00', old_group: null, new_group: 'A', old_status: 'LEARNING', new_status: 'PROBABLE', old_confidence: 0.62, new_confidence: 0.74, source: 'LEARNED', source_sheet_id: 42, actor: null, engine_version: 'rot-learn-1' }],
  observations: [{ sheet_id: 42, date: '2026-10-03', label: '06:00 – 14:00', group: 'A', first_entry: '06:02', last_exit: '14:01' }] };

const P = (id, matricule, name, source = 'LEARNED') => ({ employee_id: id, matricule, name, source });
const PLAN = { site_id: 3, site: 'DHL HAMOUL 01', mode: 'ACTIVE', state: 'STABLE', model_version: 6, materialized: false,
  banner: { code: 'ACTIVE', label: 'PLANNING INTELLIGENT ACTIF', reliable: true },
  cycle: { period: 4, pattern: ['A', 'B', 'C', 'D'], shift_minutes: 480, version: 6, source: 'HUMAN' },
  occurrences: [
    { date: '2026-10-03', start: '14:00', end: '22:00', group: 'B', rest: false, expected: [P(21, 'K201', 'BENALI Sara'), P(11, 'K162', 'ADDA Ibrahim', 'TEMPORARY')], expected_count: 2,
      exceptions: [{ matricule: 'K162', type: 'TEMPORARY', label: 'Remplacement temporaire (habituel : groupe A)' }], version: 5, version_source: 'LEARNED', period: 'past',
      actual: { sheet_id: 7, status: 'ARCHIVED', present: 2, observed_group: 'B', missing: [P(22, 'K202', 'KACI Lina')], unexpected: [],
        deviations: [{ matricule: 'K162', name: 'ADDA Ibrahim', expected_group: 'A', observed_group: 'B', outcome_label: 'Rotation inhabituelle', qualification_label: 'Remplacement temporaire' }] } },
    { date: '2026-10-03', start: '22:00', end: '06:00', group: 'C', rest: false, expected: [P(31, 'K301', '<img src=x onerror=alert(1)>', 'CONFIRMED')], expected_count: 1, exceptions: [], version: 6, version_source: 'HUMAN', period: 'current', actual: null },
    { date: '2026-10-04', start: '06:00', end: '14:00', group: null, rest: true, expected: [], expected_count: 0, exceptions: [], version: 6, version_source: 'HUMAN', period: 'future', actual: null }] };

function boot({ items = [STABLE, FRESH, OFF], enabled = true, hash = '#/planning', plan = PLAN } = {}) {
  const calls = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/' + hash, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        const call = { path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
        calls.push(call);
        let data = {};
        if (u.pathname === '/api/auth/me') data = { username: 'OPS01', full_name: 'Resp OPS' };
        else if (u.pathname === '/api/attendance/sites') data = [{ id: 3, name: 'DHL HAMOUL 01', society: 'SOC' }, { id: 4, name: 'Site neuf', society: 'SOC' }];
        else if (u.pathname === '/api/attendance/rotation-learning') data = { enabled, engine_version: 'rot-learn-1', items: u.searchParams.get('site_id') ? items.filter((i) => String(i.site_id) === u.searchParams.get('site_id')) : items };
        else if (u.pathname === '/api/attendance/rotation-learning/3/groups') data = GROUPS;
        else if (u.pathname === '/api/attendance/rotation-planning') data = typeof plan === 'function' ? plan(call.query) : plan;
        else if (u.pathname === '/api/attendance/rotation-learning/employees/11') data = CARD;
        else if (/^\/api\/attendance\/rotation-learning\/\d+$/.test(u.pathname)) data = { ...OFF, mode: call.body.mode };
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, calls, errors };
}

test('ouverture #/planning : état, rotations, groupes, confiance, mise à jour et rotation suivante MESURÉS', async () => {
  const { d, calls, dom, errors } = boot();
  await tick(80);
  assert.equal(d.getElementById('view-planning').classList.contains('hidden'), false);
  assert.equal(d.querySelector('.nav-btn[data-view="planning"]').classList.contains('active'), true);
  assert.equal('site_id' in calls.find((c) => c.path === '/api/attendance/rotation-learning').query, false);
  const card = d.querySelector('[data-pl-card="3"]');
  const facts = Object.fromEntries([...card.querySelectorAll('.pl-fact')].map((f) => [f.querySelector('span').textContent, f.querySelector('strong').textContent.trim()]));
  assert.equal(facts["État d'apprentissage"], 'Stable');
  assert.equal(facts['Rotations observées'], '16');
  assert.match(facts['Groupes détectés'], /^4\s*\/ 4 attendus$/);
  assert.equal(facts['Confiance'], '91 %');
  assert.match(facts['Dernière mise à jour'], /10\/10\/2026/);
  assert.equal(facts['Rotation probable suivante'], 'Groupe A · 14:00 – 22:00');
  assert.match(card.textContent, /Cycle observé : A → B → C → D → … \(100 % sur 12 comparaisons\)/);
  assert.match(card.querySelector('.pl-conds').textContent, /✓ Rotations observées : 16 \/ 8[\s\S]*✓ Salariés suivis dont le groupe est probable : 100 % \/ 80 %/);
  assert.equal(card.querySelector('.pl-banner'), null);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('site en apprentissage : bandeau explicite, aucune valeur fictive ; site désactivé : activation explicite', async () => {
  const { d, calls, dom } = boot();
  await tick(80);
  const fresh = d.querySelector('[data-pl-card="4"]');
  assert.match(fresh.querySelector('.pl-banner').textContent, /PLANNING EN COURS D'APPRENTISSAGE — aucune alerte de rotation/);
  const values = [...fresh.querySelectorAll('.pl-fact strong')].map((n) => n.textContent.trim());
  assert.deepEqual(values, ['Apprentissage', '—', '— / 4 attendus', '—', '—', '—']);
  assert.equal(fresh.querySelector('.pl-conds'), null);
  const off = d.querySelector('[data-pl-card="5"]');
  assert.equal(off.querySelector('.pill').textContent, 'Désactivé');
  assert.equal(off.querySelector('.pl-banner'), null);
  off.querySelector('[data-pl-mode]').click();
  await tick(60);
  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual([put.path, put.body], ['/api/attendance/rotation-learning/5', { mode: 'LEARNING' }]);
  assert.equal(d.querySelector('[data-pl-card="3"] [data-pl-mode]').dataset.plMode, 'OFF');
  dom.window.close();
});

test('groupes détectés : membres probables / confirmés / en apprentissage, horaire habituel, texte échappé', async () => {
  const { d, calls, dom } = boot();
  await tick(80);
  assert.equal(d.getElementById('pl-groups-card').classList.contains('hidden'), true, 'plusieurs sites : aucun groupe chargé d\'office');
  d.querySelector('[data-pl-groups="3"]').click();
  await tick(60);
  assert.ok(calls.some((c) => c.path === '/api/attendance/rotation-learning/3/groups'));
  assert.match(d.getElementById('pl-groups-title').textContent, /Groupes détectés — DHL HAMOUL 01/);
  const rows = [...d.querySelectorAll('#pl-group-rows tr')];
  assert.equal(rows.length, 2);
  const cells = [...rows[0].children].map((c) => c.textContent.trim());
  assert.deepEqual([cells[0], cells[1], cells[2], cells[7]], ['Groupe A', 'Consolidé', '4', '91 %']);
  assert.match(cells[3], /06:00 – 14:00\s*\(50 % des rotations\)/);
  assert.match(cells[4], /K162 ADDA IBRAHIM · 91 %/);
  assert.equal(cells[5], '—');
  assert.match(cells[6], /K300/);
  assert.equal(rows[0].querySelector('img'), null, 'aucune injection HTML');
  assert.deepEqual([...rows[1].children].map((c) => c.textContent.trim()).slice(0, 4), ['Groupe G5', 'Candidat', '1', '—']);
  dom.window.close();
});

test('fiche rotation d\'un employé : déclaré / appris / confirmé séparés, explication chiffrée, historique, lecture seule', async () => {
  const { d, dom, calls } = boot({ items: [STABLE] });
  await tick(100);
  assert.equal(d.getElementById('pl-groups-card').classList.contains('hidden'), false, 'un seul site : groupes affichés');
  d.querySelector('[data-pl-emp="11"]').click();
  await tick(60);
  const modal = d.querySelector('#modal-host .modal');
  assert.match(modal.querySelector('h3').textContent, /K162 — ADDA IBRAHIM/);
  const facts = Object.fromEntries([...modal.querySelectorAll('.pl-fact')].map((f) => [f.querySelector('span').textContent, f.querySelector('strong').textContent.trim()]));
  assert.deepEqual([facts['Groupe déclaré'], facts['Groupe appris'], facts['Groupe confirmé'], facts['Confiance'], facts['Statut']], ['Groupe B', 'Groupe A', '—', '91 %', 'Probable']);
  assert.match(modal.textContent, /14 rotation\(s\) observée\(s\) · 12 avec le groupe A · 13\/14 horaires cohérents · dernière observation 03\/10\/2026/);
  assert.match(modal.textContent, /2026-10-03\s*06:00 – 14:00\s*Groupe A\s*06:02\s*14:01/);
  assert.match(modal.textContent, /62 % → 74 %[\s\S]*LEARNED · feuille 42 · rot-learn-1/);
  assert.equal(modal.querySelectorAll('input,select,textarea').length, 0, 'aucune modification du groupe depuis cette fiche');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  modal.querySelector('#pl-emp-close').click();
  assert.equal(d.querySelector('#modal-host .modal'), null);
  dom.window.close();
});

test('apprentissage désactivé globalement ou aucun site configuré : message clair, aucune donnée inventée', async () => {
  const off = boot({ items: [], enabled: false });
  await tick(80);
  assert.match(off.d.getElementById('pl-state').textContent, /désactivé sur cette installation/);
  assert.match(off.d.getElementById('pl-sites').textContent, /Aucun site n'a de paramètres de rotation/);
  assert.equal(off.d.querySelectorAll('.pl-fact').length, 0);
  off.dom.window.close();
});

test('feuilles de rotation : observation brute et interprétation du moteur affichées côte à côte', async () => {
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/#/sheets', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = async (url) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        let data = {};
        if (u.pathname === '/api/auth/me') data = { username: 'DRH01' };
        else if (u.pathname === '/api/attendance/sites') data = [];
        else if (u.pathname === '/api/attendance/sheets') data = { total: 2, page: 1, page_size: 25, items: [
          { id: 7, date: '2026-10-06', label: '14:00 – 22:00', site: 'Site A', status: 'CLOSED', present_count: 0, out_count: 3, lines_count: 3, observed_group: 'A', interpretation: { group: 'G2' } },
          { id: 8, date: '2026-10-06', label: '22:00 – 06:00', site: 'Site A', status: 'OPEN', present_count: 3, out_count: 0, lines_count: 3, observed_group: 'B', interpretation: null }] };
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      };
    },
  });
  await tick(80);
  const rows = [...dom.window.document.querySelectorAll('#sheet-rows tr')];
  assert.match(rows[0].children[7].textContent, /Groupe A\s*· appris G2/);
  assert.equal(rows[1].children[7].textContent.trim(), 'Groupe B');
  dom.window.close();
});

test('planning projeté : bandeau selon l\'état, prévu / réel / écart / décision, version, rien d\'enregistré', async () => {
  const { d, calls, dom, w } = boot({ items: [STABLE] });
  await tick(120);
  assert.equal(d.getElementById('pl-plan-card').classList.contains('hidden'), false);
  const first = calls.find((c) => c.path === '/api/attendance/rotation-planning');
  assert.deepEqual([first.query.site_id, first.query.date_from === first.query.date_to, 'group' in first.query], ['3', true, false], 'aujourd\'hui par défaut');
  const banner = d.querySelector('[data-pl-banner]');
  assert.equal(banner.dataset.plBanner, 'ACTIVE');
  assert.match(banner.textContent, /PLANNING INTELLIGENT ACTIF · cycle A → B → C → D · version 6 \(décision OPS\)/);
  const rows = [...d.querySelectorAll('#pl-plan-rows tr')];
  assert.equal(rows.length, 3);
  const past = [...rows[0].children].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(past.slice(0, 3), ['2026-10-03', '14:00 – 22:00', 'Groupe B']);
  assert.match(past[3], /^2 · K201 BENALI Sara, K162 ADDA Ibrahim \(temporaire\)$/);
  assert.match(past[4], /K162 : Remplacement temporaire \(habituel : groupe A\)/);
  assert.match(past[5], /2 présent\(s\).*K162 prévu A · réel B · Remplacement temporaire.*Attendus non pointés : K202/);
  assert.equal(past[6], 'v5');
  assert.match(rows[1].textContent, /En cours[\s\S]*Groupe C[\s\S]*\(confirmé\)[\s\S]*v6 · OPS/);
  assert.equal(rows[1].querySelector('img'), null, 'aucune injection HTML');
  assert.match(rows[2].textContent, /Repos/);
  assert.match(d.getElementById('pl-plan-total').textContent, /3 rotation\(s\) · calculées à la demande, non enregistrées/);
  // Horizons : aujourd'hui, demain, 7 jours, 30 jours — bornés par le serveur.
  const span = (q) => Math.round((new Date(q.date_to) - new Date(q.date_from)) / 86400000);
  for (const [days, expected] of [['1', 0], ['7', 6], ['30', 29]]) {
    d.querySelector(`[data-pl-days="${days}"]`).click();
    await tick(40);
    assert.equal(span(calls.filter((c) => c.path === '/api/attendance/rotation-planning').at(-1).query), expected);
  }
  d.getElementById('pl-group').value = 'A';
  d.getElementById('pl-group').dispatchEvent(new w.Event('change'));
  await tick(40);
  assert.equal(calls.filter((c) => c.path === '/api/attendance/rotation-planning').at(-1).query.group, 'A');
  d.getElementById('pl-employee').value = 'k201';
  d.getElementById('pl-employee').dispatchEvent(new w.Event('input'));
  assert.equal(d.querySelectorAll('#pl-plan-rows tr').length, 1);
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'consultation seule');
  dom.window.close();
});

test('planning projeté : apprentissage = prévision, révision requise signalée, sans cycle rien n\'est projeté', async () => {
  for (const [banner, pattern] of [
    [{ code: 'LEARNING', label: 'PRÉVISION EN APPRENTISSAGE', reliable: false }, /PRÉVISION EN APPRENTISSAGE/],
    [{ code: 'REVIEW_REQUIRED', label: 'RÉVISION DU PLANNING REQUISE', reliable: false }, /RÉVISION DU PLANNING REQUISE/]]) {
    const { d, dom } = boot({ items: [STABLE], plan: { ...PLAN, banner } });
    await tick(120);
    assert.equal(d.querySelector('[data-pl-banner]').dataset.plBanner, banner.code);
    assert.match(d.querySelector('[data-pl-banner]').textContent, pattern);
    assert.doesNotMatch(d.querySelector('[data-pl-banner]').textContent, /PLANNING INTELLIGENT ACTIF/);
    dom.window.close();
  }
  const empty = boot({ items: [STABLE], plan: { ...PLAN, cycle: null, occurrences: [], banner: { code: 'LEARNING', label: 'PRÉVISION EN APPRENTISSAGE', reliable: false, detail: 'Aucun cycle démontré pour l\'instant : rien n\'est projeté.' } } });
  await tick(120);
  assert.match(empty.d.querySelector('[data-pl-banner]').textContent, /Aucun cycle démontré/);
  assert.match(empty.d.getElementById('pl-plan-rows').textContent, /Aucune rotation projetée/);
  empty.dom.window.close();
});
