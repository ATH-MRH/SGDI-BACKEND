// pointeur.irongs.com — écran du POSTE DE SÉCURITÉ : le dernier passage ACCEPTÉ par Attendance
// Core s'affiche seul (aucun clic), avec photo (portrait DRH), identité, ENTRÉE / SORTIE, heure
// et état actuel ; refus affichés ; compteurs canoniques du serveur ; Mode Test retiré.
// VRAIE page dans jsdom (tests_frontend/load-pointeur.js) ; seul le réseau est simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const EMP = { id: 2258, matricule: 'K162', nom: 'ADDA', prenom: 'IBRAHIM', fonction: 'MAGASINIER', poste: 'MAGASINIER', societe: 'DHL FORWARDING',
  site: 'HAMOUL 01 (40K)', photo: '/uploads/photos/K162-a.jpg', has_photo: true };
const EVENT = (id, type, extra = {}) => ({ id, type, heure: type === 'ENTREE' ? '04:12:14' : '04:17:29', date: '2026-10-05', source: 'FACIAL',
  source_label: 'Reconnaissance faciale', terminal: 'TABLETTTE HAMOUL 01', site: 'HAMOUL 01 (40K)', site_id: 12,
  state: type === 'ENTREE' ? 'PRESENT' : 'SORTI', employee: EMP, ...extra });
const SUMMARY = { entries_today: 3, exits_today: 1, present_now: 2, absent_today: 1 };

function boot({ live = [], portrait = 200, photoBroken = false } = {}) {
  const calls = [];
  const replies = [...live];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    calls.push({ path: u.pathname, search: u.search, auth: (opts.headers || {}).Authorization });
    if (u.pathname === '/api/portal/attendance-live') {
      const body = replies.length ? replies.shift() : { latest_event_id: 50, events: [], latest_refusal_id: 9, refusals: [], summary: SUMMARY };
      return { ok: true, status: 200, json: async () => body };
    }
    if (u.pathname.endsWith('/portrait')) return { ok: portrait < 400, status: portrait, blob: async () => ({ size: 3 }), json: async () => ({}) };
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'HAMOUL 01 (40K)' }] };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  const w = ctx.window;
  let n = 0;
  w.URL.createObjectURL = () => `blob:portrait-${++n}`;
  w.URL.revokeObjectURL = () => {};
  // Images : chargement simulé (réussi, sauf photo source « cassée »).
  Object.defineProperty(w.HTMLImageElement.prototype, 'src', { configurable: true, set(v) { this.setAttribute('src', v); setTimeout(() => { if (photoBroken && !String(v).startsWith('blob:')) this.onerror && this.onerror(); else this.onload && this.onload(); }, 0); }, get() { return this.getAttribute('src'); } });
  const real = w.setTimeout.bind(w), idle = [];
  w.setTimeout = (fn, ms, ...rest) => (ms === 6000 ? (idle.push(fn), idle.length) : real(fn, ms, ...rest));
  // V5.1 : le résultat s'affiche dans la carte flottante ; #lastScanCard reste la zone d'attente.
  const card = () => w.document.getElementById('scanResultCard');
  const zone = () => w.document.getElementById('lastScanCard').textContent;
  return { ...ctx, w, calls, idle, card, zone, text: () => card().innerHTML.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(), live: (p) => calls.filter((c) => c.path === '/api/portal/attendance-live').map((c) => c.search) };
}

const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.dom.window.close(); } catch (e) { /* déjà fermée */ } } });
async function ready(t) {
  opened.push(t);
  await tick(80);
  t.T().stopLivePolling();                                                       // les tests pilotent la relève
}

test('Mode Test retiré du poste de sécurité ; navigation Scanner / Planning / Facial', async () => {
  const t = boot();
  await ready(t);
  const d = t.w.document;
  assert.equal(d.getElementById('testModeNav'), null);
  assert.equal(d.getElementById('testModeView'), null);
  assert.equal([...d.querySelectorAll('script[src]')].some((s) => /test-mode/.test(s.getAttribute('src'))), false);
  assert.deepEqual([...d.querySelectorAll('.module-nav button')].map((b) => b.textContent), ['Scanner', 'Planning intelligent', 'Facial']);
  t.dom.window.close();
});

test('démarrage : ancien passage NON réaffiché, compteurs du serveur ; relève authentifiée ~2 s', async () => {
  const t = boot({ live: [{ latest_event_id: 41, events: [EVENT(41, 'ENTREE')], latest_refusal_id: 7, refusals: [], summary: SUMMARY }] });
  await ready(t);
  assert.equal(t.card().classList.contains('is-open'), false);
  assert.match(t.zone(), /EN ATTENTE DU PROCHAIN POINTAGE/);
  assert.deepEqual(['entrantCount', 'sortantCount', 'presentCount', 'absentCount'].map((id) => t.w.document.getElementById(id).textContent), ['03', '01', '02', '01']);
  const first = t.calls.find((c) => c.path === '/api/portal/attendance-live');
  assert.equal(first.auth, 'Bearer tok-ptg');
  assert.equal(t.T().LIVE_POLL_MS, 2000);
  assert.deepEqual([t.T().getLive().liveCursor, t.T().getLive().liveRefusalCursor], [41, 7]);
  t.dom.window.close();
});

test('ENTRÉE faciale acceptée : fiche complète, IDENTIFIÉ, PRÉSENT, portrait DRH ; puis retour à l\'attente', async () => {
  const t = boot({ live: [{ latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY },
    { latest_event_id: 42, events: [EVENT(42, 'ENTREE')], latest_refusal_id: 7, refusals: [], summary: { ...SUMMARY, entries_today: 4 } }] });
  await ready(t);
  await t.T().pollLive(); await tick(40);
  assert.match(t.live().at(-1), /after_id=41/);
  assert.ok(t.card().classList.contains('is-entry'));
  const text = t.text();
  for (const part of ['IDENTIFIÉ', 'ADDA IBRAHIM', 'K162', 'MAGASINIER', 'HAMOUL 01 (40K)', 'DHL FORWARDING', 'TABLETTTE HAMOUL 01', 'ENTRÉE ENREGISTRÉE', '04:12:14', 'ÉTAT ACTUEL : PRÉSENT']) {
    assert.ok(text.includes(part), `${part} absent de : ${text}`);
  }
  const portraitCall = t.calls.find((c) => c.path === '/api/portal/attendance-employee/2258/portrait');
  assert.ok(portraitCall && portraitCall.auth === 'Bearer tok-ptg', 'portrait DRH demandé par une route authentifiée');
  assert.equal(t.card().querySelector('#lastScanPhoto img').getAttribute('src'), 'blob:portrait-1');
  assert.ok(t.calls.some((c) => c.path === '/api/portal/attendance-feed'), 'Pointage en direct rafraîchi');
  assert.equal(t.w.document.getElementById('entrantCount').textContent, '04');
  assert.equal(t.idle.length, 1);
  assert.match(t.zone(), /EN ATTENTE DU PROCHAIN POINTAGE/, 'la zone de pointage reste en attente sous la carte');
  t.idle.shift()();                                                              // 6 s plus tard
  assert.ok(!t.card().classList.contains('is-open') && t.text() === '' && /EN ATTENTE DU PROCHAIN POINTAGE/.test(t.zone()));
  t.dom.window.close();
});

test('SORTIE : présentation distincte, état SORTI ; un nouveau passage remplace immédiatement le précédent', async () => {
  const t = boot({ live: [{ latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY },
    { latest_event_id: 42, events: [EVENT(42, 'ENTREE', { employee: { ...EMP, id: 9, nom: 'BENALI', prenom: 'Karim', matricule: 'K200' } })], latest_refusal_id: 7, refusals: [], summary: SUMMARY },
    { latest_event_id: 43, events: [EVENT(43, 'SORTIE')], latest_refusal_id: 7, refusals: [], summary: SUMMARY }] });
  await ready(t);
  await t.T().pollLive(); await tick(20);
  assert.match(t.text(), /BENALI Karim/);
  await t.T().pollLive(); await tick(20);                                        // avant la fin des 6 s
  assert.ok(t.card().classList.contains('is-exit') && !t.card().classList.contains('is-entry'));
  assert.match(t.text(), /^SORTIE ENREGISTRÉE.*04:17:29/);
  assert.match(t.text(), /ÉTAT ACTUEL : SORTI/);
  assert.doesNotMatch(t.text(), /PRÉSENT/);
  assert.doesNotMatch(t.text(), /BENALI/);
  t.dom.window.close();
});

test('QR et saisie manuelle : même écran, libellé de la source', async () => {
  for (const [source, badge] of [['QR', 'QR VALIDÉ'], ['MANUAL', 'SAISIE MANUELLE']]) {
    const t = boot({ live: [{ latest_event_id: 1, events: [], latest_refusal_id: 0, refusals: [], summary: SUMMARY },
      { latest_event_id: 2, events: [EVENT(2, 'ENTREE', { source, terminal: null })], latest_refusal_id: 0, refusals: [], summary: SUMMARY }] });
    await ready(t);
    await t.T().pollLive(); await tick(20);
    assert.match(t.text(), new RegExp(`^ENTRÉE ENREGISTRÉE ${badge}`));
    assert.doesNotMatch(t.text(), /Terminal/);
    t.dom.window.close();
  }
});

test('refus (employé suspendu reconnu) : POINTAGE REFUSÉ, aucun mouvement', async () => {
  const t = boot({ live: [{ latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY },
    { latest_event_id: 41, events: [], latest_refusal_id: 8, refusals: [{ id: 8, heure: '05:01:02', label: 'EMPLOYÉ SUSPENDU', terminal: 'TABLETTTE HAMOUL 01', employee: EMP }], summary: SUMMARY }] });
  await ready(t);
  await t.T().pollLive(); await tick(20);
  assert.match(t.live().at(-1), /after_refusal_id=7/);
  assert.ok(t.card().classList.contains('is-refused'));
  assert.match(t.text(), /^POINTAGE REFUSÉ.*ADDA IBRAHIM/);
  assert.match(t.text(), /EMPLOYÉ SUSPENDU 05:01:02/);
  assert.match(t.text(), /AUCUN MOUVEMENT ENREGISTRÉ/);
  t.dom.window.close();
});

test('photo : portrait indisponible ⇒ photo de la fiche ; photo cassée ⇒ initiales (jamais d\'image cassée)', async () => {
  const fallback = boot({ portrait: 404, live: [{ latest_event_id: 1, events: [], latest_refusal_id: 0, refusals: [], summary: SUMMARY },
    { latest_event_id: 2, events: [EVENT(2, 'ENTREE')], latest_refusal_id: 0, refusals: [], summary: SUMMARY }] });
  await ready(fallback);
  await fallback.T().pollLive(); await tick(40);
  assert.equal(fallback.card().querySelector('#lastScanPhoto img').getAttribute('src'), '/uploads/photos/K162-a.jpg');
  fallback.dom.window.close();
  const broken = boot({ portrait: 404, photoBroken: true, live: [{ latest_event_id: 1, events: [], latest_refusal_id: 0, refusals: [], summary: SUMMARY },
    { latest_event_id: 2, events: [EVENT(2, 'ENTREE')], latest_refusal_id: 0, refusals: [], summary: SUMMARY }] });
  await ready(broken);
  await broken.T().pollLive(); await tick(40);
  assert.equal(broken.card().querySelector('#lastScanPhoto img'), null);
  assert.equal(broken.card().querySelector('.last-scan-initials').textContent, 'AI');
  broken.dom.window.close();
});

test('déconnexion : la relève s\'arrête', async () => {
  const t = boot();
  opened.push(t);
  await tick(80);
  assert.ok(t.T().getLive().liveTimer);
  await t.T().logout();
  assert.equal(t.T().getLive().liveTimer, null);
  t.dom.window.close();
});

test('Planning intelligent : pendant l\'apprentissage, une présence réelle n\'est pas une anomalie', async () => {
  const t = boot();
  await ready(t);
  const today = new Date().toISOString().slice(0, 10);
  t.T().setPlanningEvents([{ employee_id: 2258, matricule: 'K162', nom: 'ADDA IBRAHIM', site: 'HAMOUL 01', site_id: 12, cycle: 1, action: 'arrivee', scanned_at: `${today}T04:12:14` }]);
  t.T().renderPlanning(today);
  const html = t.w.document.getElementById('planningContent').textContent;
  assert.match(html, /Présence constatée — planning en apprentissage/);
  assert.doesNotMatch(html, /Présence non prévue par le planning appris/);
  t.dom.window.close();
});
