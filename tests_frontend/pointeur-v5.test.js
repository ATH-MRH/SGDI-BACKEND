// pointeur.irongs.com — POSTE DE CONTRÔLE V5 : vacation active et relève (planning officiel), KPI
// personnes, présents uniques, à traiter, derniers mouvements, refus expliqués avec le motif réel
// d'Attendance Core, intention explicite de maintien. VRAIE page dans jsdom ; réseau simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur } = require('./load-pointeur');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'pointeur.html'), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const SUMMARY = { entries_today: 7, exits_today: 3, present_now: 2, absent_today: 0 };
const CLOCK = { timezone: 'Africa/Algiers', server_now: '2026-10-01T14:40:00+01:00', operational_date: '2026-10-01', server_time: '14:40:00' };
const iso = (hhmm, day = '2026-10-01') => `${day}T${hhmm}:00+01:00`;
const slot = (shift, label, group, start, end, endDay) => ({ shift, shift_label: label, group, work_date: '2026-10-01', start, end, scheduled_start: iso(start), scheduled_end: iso(end, endDay) });
const E1 = { id: 11, matricule: 'K162', nom: 'ADDA', prenom: 'IBRAHIM', fonction: 'MAGASINIER', poste: 'MAGASINIER', group: 'B', photo: '' };
const E2 = { id: 12, matricule: 'K088', nom: 'BENALI', prenom: 'SAMIR', fonction: 'AGENT', poste: 'AGENT', group: 'A', photo: '' };
const POST = (over = {}) => ({
  site_id: 12, site: 'SITE TEST', status: 'OFFICIAL', reason: null,
  current: slot('APRES_MIDI', 'Après-midi', 'B', '14:00', '22:00'), next: slot('NUIT', 'Nuit', 'C', '22:00', '06:00', '2026-10-02'),
  maintien: { previous: slot('MATIN', 'Matin', 'A', '06:00', '14:00'), opens_at: iso('14:30'), closes_at: iso('14:45'), opens: '14:30', closes: '14:45', state: 'OPEN' },
  kpi: { expected: 3, present: 2, absent: 1, excused: 1, maintien: 1, anomalies: 1 }, activity: { refused_today: 4 },
  present: [
    { employee: E1, event_id: 5, entry: '13:40', entry_at: iso('13:40'), shift_start: '14:00', shift_end: '22:00', kind: 'NORMAL', badge: 'EN_POSTE', badge_label: 'EN POSTE' },
    { employee: E2, event_id: 9, entry: '14:35', entry_at: iso('14:35'), shift_start: '14:00', shift_end: '22:00', kind: 'EXTRA_SHIFT', badge: 'EN_MAINTIEN', badge_label: 'EN MAINTIEN' },
  ],
  todo: [{ key: 'a3', anomaly_id: 3, code: 'VACATION_NON_CLOTUREE', label: 'Vacation non clôturée', severity: 'warning', message: 'Vacation 06:00 → 14:00 sans sortie enregistrée', employee: E1, scheduled_end: '14:00', overdue_since: '14:45', action: null }],
  movements: [
    { key: 'e9', type: 'MAINTIEN', label: 'MAINTIEN', heure: '14:35:00', at: iso('14:35'), matricule: 'K088', name: 'BENALI SAMIR' },
    { key: 'r4', type: 'REFUS', label: 'REFUSÉ', heure: '14:10:00', at: iso('14:10'), matricule: 'K088', name: '', detail: 'Nouvelle entrée refusée', code: 'EXTRA_BEFORE_WINDOW' },
    { key: 'e8', type: 'SORTIE', label: 'SORTIE', heure: '14:04:00', at: iso('14:04'), matricule: 'K088', name: 'BENALI SAMIR' },
    { key: 'e5', type: 'ENTREE', label: 'ENTRÉE', heure: '13:40:00', at: iso('13:40'), matricule: 'K162', name: 'ADDA IBRAHIM' },
  ],
  permissions: { manual_entry: false }, ...over,
});
const LIVE = (post, extra = {}) => ({ latest_event_id: 50, events: [], latest_refusal_id: 9, refusals: [], alerts: [], summary: SUMMARY, ...CLOCK, post, ...extra });

function boot({ live = [], routes = {} } = {}) {
  const calls = [];
  const replies = [...live];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    calls.push({ path: u.pathname, search: u.search, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (routes[u.pathname]) return routes[u.pathname](u, opts);
    if (u.pathname === '/api/portal/attendance-live') return { ok: true, status: 200, json: async () => (replies.length > 1 ? replies.shift() : replies[0] || LIVE(null)) };
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'SITE TEST' }] };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  const w = ctx.window, d = w.document;
  const text = (id) => d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { ...ctx, w, d, calls, text, T: () => w.__pointeurTest };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.dom.window.close(); } catch (e) { /* déjà fermée */ } } });
async function ready(t) { opened.push(t); await tick(90); t.T().stopLivePolling(); await t.T().pollLive(); return t; }

test('header : logo IRON GLOBAL SÉCURITÉ, POSTE DE POINTAGE, zone « Pointage » multi-modes', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const logo = t.d.querySelector('.brand-logo-img');
  assert.equal(logo.getAttribute('alt'), 'IRON GLOBAL SÉCURITÉ'); assert.match(logo.getAttribute('src'), /iron-securite-logo\.png$/);
  assert.match(t.d.querySelector('.brand').textContent, /POSTE DE POINTAGE\s*Contrôle des présences en temps réel/);
  assert.equal(t.text('scannerTitle'), 'Pointage');
  assert.match(t.d.querySelector('.station-sub').textContent, /Reconnaissance faciale, QR ou saisie manuelle/);
  assert.equal(t.d.getElementById('headerClock').dataset.date, '2026-10-01');            // date métier du serveur
  for (const id of ['qrModeBtn', 'faceModeBtn', 'manualModeBtn']) assert.ok(t.d.getElementById(id), id);
});

test('bandeau : vacation en cours, groupe, prochaine relève et compte à rebours réel', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  assert.match(t.text('shiftBanner'), /Vacation en cours APRÈS-MIDI 14:00 → 22:00 GROUPE B/);
  assert.match(t.text('shiftBanner'), /Prochaine relève 22:00 → 06:00 GROUPE C Dans 07:(20:00|19:5\d)/);
  t.T().syncOpsClock({ timezone: 'Africa/Algiers', server_now: '2026-10-01T21:59:30+01:00' });
  t.T().tickPost();
  assert.match(t.text('reliefCountdown'), /^00:00:(30|29)$/);
  assert.match(t.text('maintienBanner'), /MAINTIENS — VACATION 06:00 → 14:00 Nouvelle entrée autorisée : 14:30 → 14:45/);
  assert.equal(t.d.getElementById('idleShift').textContent, 'Vacation actuelle : 14:00 → 22:00 · Groupe B');
});

test('relève et minuit : le bandeau suit le serveur, la Nuit ne change pas à minuit', async () => {
  const night = slot('NUIT', 'Nuit', 'C', '22:00', '06:00', '2026-10-02');
  const t = await ready(boot({ live: [LIVE(POST())] }));
  t.T().setPost(POST({ current: night, next: slot('MATIN', 'Matin', 'A', '06:00', '14:00'), maintien: null }));
  assert.match(t.text('shiftBanner'), /NUIT 22:00 → 06:00 GROUPE C/);
  const node = t.d.querySelector('#shiftBanner .v5-shift-name');
  t.T().syncOpsClock({ timezone: 'Africa/Algiers', server_now: '2026-10-02T00:00:05+01:00' });
  t.T().setPost(POST({ current: night, next: slot('MATIN', 'Matin', 'A', '06:00', '14:00'), maintien: null }));
  t.T().tickPost();
  assert.equal(t.d.querySelector('#shiftBanner .v5-shift-name'), node, 'aucune réécriture du bandeau à minuit');
  assert.match(t.text('shiftBanner'), /NUIT 22:00 → 06:00 GROUPE C/); assert.match(t.text('reliefCountdown'), /^05:59:5[45]$/);
  assert.ok(t.d.getElementById('maintienBanner').classList.contains('hidden'));
});

test('rotation non configurée : aucun groupe, aucune vacation, aucune relève inventés', async () => {
  const t = await ready(boot({ live: [LIVE(POST({ status: 'ROTATION_NOT_CONFIGURED', current: null, next: null, maintien: null, kpi: { expected: null, present: 1, absent: null, excused: 0, maintien: 0, anomalies: 0 } }))] }));
  const banner = t.text('shiftBanner');
  assert.match(banner, /ROTATION NON CONFIGURÉE/); assert.match(banner, /n’a pas encore de date d’ancrage/);
  assert.doesNotMatch(banner, /GROUPE|→|relève/i);
  assert.equal(t.d.getElementById('idleShift'), null);
  const kpis = [...t.d.querySelectorAll('#postKpis .v5-kpi')].map((k) => k.querySelector('b').textContent);
  assert.deepEqual(kpis, ['—', '1', '—', '0', '0']);
});

test('KPI personnes séparés de l\'activité du jour (mouvements)', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const kpis = [...t.d.querySelectorAll('#postKpis .v5-kpi')].map((k) => [k.querySelector('small').textContent, k.querySelector('b').textContent]);
  assert.deepEqual(kpis, [['Attendus', '3'], ['Présents', '2'], ['Absents / non pointés', '1'], ['En maintien', '1'], ['Anomalies', '1']]);
  assert.equal(t.text('entrantCount'), '07'); assert.equal(t.text('sortantCount'), '03'); assert.equal(t.text('refusedCount'), '4');
  assert.equal(t.d.getElementById('postKpis').contains(t.d.getElementById('entrantCount')), false);
});

test('présents actuellement : une carte par employé, badge EN POSTE / EN MAINTIEN', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const cards = [...t.d.querySelectorAll('#presentNowList .v5-person')];
  assert.equal(cards.length, 2); assert.equal(t.text('presentNowCount'), '2');
  assert.match(cards[0].textContent, /ADDA IBRAHIM.*K162 · MAGASINIER · Groupe B.*Entrée réelle 13:40 · Vacation 14:00 → 22:00.*EN POSTE/);
  assert.match(cards[1].textContent, /BENALI SAMIR.*EN MAINTIEN/); assert.equal(cards[0].querySelector('.v5-avatar').textContent, 'AI');
  assert.equal(new Set(cards.map((c) => c.dataset.employee)).size, 2);
});

test('à traiter : anomalie expliquée ; action seulement si une fonction réelle existe', async () => {
  const manual = { key: 'r7', anomaly_id: null, code: 'MANUAL_ENTRY_REQUIRED', label: 'Saisie manuelle requise', severity: 'warning', employee: E2, scheduled_end: '14:00', overdue_since: '14:45', action: 'MANUAL_ENTRY' };
  const t = await ready(boot({ live: [LIVE(POST({ todo: [POST().todo[0], manual], permissions: { manual_entry: true } }))] }));
  const items = [...t.d.querySelectorAll('#todoList .v5-todo')];
  assert.match(items[0].textContent, /Vacation non clôturée.*ADDA IBRAHIM · K162.*Fin prévue : 14:00.*Toujours présent après : 14:45/);
  assert.equal(items[0].querySelector('button'), null);
  assert.equal(items[1].querySelector('button').textContent, 'SAISIE MANUELLE'); assert.equal(t.text('todoCount'), '2');
  items[1].querySelector('button').click();
  await tick();
  assert.equal(t.d.getElementById('manualPanel').classList.contains('hidden'), false);
  assert.match(t.d.getElementById('manualCard').textContent, /BENALI SAMIR/);
});

test('derniers mouvements : chronologie avec refus, filtres locaux sans appel réseau', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const rows = () => [...t.d.querySelectorAll('#movementsList .v5-move')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(rows().map((r) => r.slice(0, 13)), ['14:35:00K088B', '14:10:00K088N', '14:04:00K088B', '13:40:00K162A']);
  assert.match(rows()[1], /REFUSÉ$/);
  const before = t.calls.length;
  t.d.querySelector('[data-move-filter="REFUS"]').click();
  assert.deepEqual(rows().length, 1); assert.match(rows()[0], /14:10:00.*REFUSÉ/);
  t.d.querySelector('[data-move-filter="MAINTIEN"]').click(); assert.match(rows()[0], /MAINTIEN$/);
  t.d.querySelector('[data-move-filter="ENTREE"]').click(); assert.equal(rows().length, 1);
  t.d.querySelector('[data-move-filter="all"]').click(); assert.equal(rows().length, 4);
  assert.equal(t.calls.length, before, 'filtrage local');
  assert.equal(t.text('presentNowCount'), '2');                                           // un refus ne change pas les présents
});

test('entrée, sortie et maintien : heure réelle, horaire planifié et temps comptabilisé distincts', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const base = { date: '2026-10-01', source: 'QR', source_label: 'QR', site: 'SITE TEST', site_id: 12, employee: E1 };
  const counted = { kind: 'NORMAL', group: 'B', scheduled_start: iso('14:00'), scheduled_end: iso('22:00'), actual_entry: '2026-10-01T13:37:24+01:00', counted_start: iso('14:00') };
  t.T().showLastScan({ ...base, id: 71, type: 'ENTREE', heure: '13:37:24', state: 'PRESENT', counted });
  let card = t.text('scanResultCard');
  assert.match(card, /ADDA IBRAHIM/); assert.match(card, /ENTRÉE ENREGISTRÉE/); assert.match(card, /Groupe B/);
  assert.match(card, /Pointage réel 13:37:24 Début planifié 14:00 Temps comptabilisé à partir de 14:00/); assert.match(card, /ÉTAT ACTUEL : PRÉSENT/);
  t.T().showLastScan({ ...base, id: 72, type: 'SORTIE', heure: '22:18:13', state: 'SORTI', counted: { ...counted, actual_exit: '2026-10-01T22:18:13+01:00', counted_end: iso('22:00'), counted_minutes: 480 } });
  card = t.text('scanResultCard');
  assert.match(card, /SORTIE ENREGISTRÉE/); assert.match(card, /Pointage réel 22:18:13 Fin planifiée 22:00 Temps comptabilisé jusqu’à 22:00 Durée comptabilisée 8 h 00/);
  assert.match(card, /VACATION TERMINÉE/);
  t.T().showLastScan({ ...base, id: 73, type: 'ENTREE', heure: '14:34:00', state: 'PRESENT', employee: E2, counted: { kind: 'EXTRA_SHIFT', group: 'A', scheduled_start: iso('14:00'), scheduled_end: iso('22:00'), actual_entry: '2026-10-01T14:34:00+01:00', counted_start: iso('14:34') } });
  card = t.text('scanResultCard');
  assert.match(card, /MAINTIEN ENREGISTRÉ/); assert.match(card, /Deuxième vacation 14:00 → 22:00 Début réel 14:34:00 Temps comptabilisé à partir de 14:34/); assert.match(card, /EN MAINTIEN/);
});

test('refus : motif réel d\'Attendance Core, jamais « fraude », jamais un message générique seul', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const prev = { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') };
  const show = (code, counted, extra = {}) => { t.T().showLastRefusal({ id: code, heure: '14:10:00', label: 'x', code, employee: E1, counted, ...extra }); return t.text('scanResultCard'); };
  let card = show('EXTRA_BEFORE_WINDOW', { kind: 'EXTRA_SHIFT', scheduled_start: iso('14:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: prev });
  assert.match(card, /POINTAGE REFUSÉ/); assert.match(card, /ADDA IBRAHIM/); assert.match(card, /NOUVELLE ENTRÉE NON AUTORISÉE/);
  assert.match(card, /Vacation précédente 06:00 → 14:00 Sortie enregistrée 14:04 Nouvelle entrée possible 14:30 → 14:45/); assert.match(card, /AUCUN MOUVEMENT ENREGISTRÉ/);
  card = show('EARLY_OUTSIDE_WINDOW', { kind: 'NORMAL', scheduled_start: iso('14:00'), window_opens_at: iso('13:30'), actual_entry: iso('13:21') });
  assert.match(card, /ARRIVÉE HORS FENÊTRE/); assert.match(card, /Votre vacation commence à 14:00\./); assert.match(card, /Pointage autorisé à partir de 13:30/);
  card = show('PREVIOUS_SHIFT_NOT_CLOSED', { previous: { ...prev, actual_exit: null } });
  assert.match(card, /VACATION PRÉCÉDENTE NON CLÔTURÉE/); assert.match(card, /La sortie de la première vacation doit être enregistrée avant l’ouverture d’une deuxième vacation/);
  card = show('MANUAL_ENTRY_REQUIRED', { window_closes_at: iso('14:45'), previous: prev });
  assert.match(card, /FENÊTRE DE MAINTIEN TERMINÉE/); assert.match(card, /SAISIE MANUELLE PAR LE POINTEUR REQUISE/);
  assert.equal(t.d.querySelector('#scanResultCard .v5-inline-btn'), null, 'sans permission : aucun bouton');
  t.T().setPost(POST({ permissions: { manual_entry: true } }));
  show('MANUAL_ENTRY_REQUIRED', { window_closes_at: iso('14:45'), previous: prev });
  assert.equal(t.d.querySelector('#scanResultCard .v5-inline-btn').textContent, 'SAISIE MANUELLE');
  // Refus d'un terminal sans code : le motif fourni est affiché, pas seulement un libellé.
  assert.match(show(null, null, { label: 'EMPLOYÉ SUSPENDU', message: 'Pointage refusé : employé suspendu' }), /EMPLOYÉ SUSPENDU.*Pointage refusé : employé suspendu/);
  assert.doesNotMatch(HTML, /fraude/i);
});

test('scan refusé : le motif structuré de la réponse est affiché, jamais une erreur technique brute', async () => {
  const refusal = { code: 'EXTRA_BEFORE_WINDOW', message: 'Nouvelle entrée refusée : vacation terminée à 14:00, nouvelle entrée possible de 14:30 à 14:45.', kind: 'EXTRA_SHIFT', scheduled_start: iso('14:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } };
  const t = await ready(boot({ live: [LIVE(POST())], routes: { '/api/portal/attendance-qr/scan': async () => ({ ok: false, status: 409, headers: { get: (h) => (h === 'X-Attendance-Refusal' ? JSON.stringify(refusal) : null) }, json: async () => ({ detail: refusal.message }) }) } }));
  await t.T().onQr('qr-token');
  await tick();
  assert.match(t.text('scanResultCard'), /NOUVELLE ENTRÉE NON AUTORISÉE.*Nouvelle entrée possible 14:30 → 14:45.*AUCUN MOUVEMENT ENREGISTRÉ/);
  const resp = (status, detail) => ({ status, headers: { get: () => null } });
  const warn = t.w.console.warn; t.w.console.warn = () => {};
  assert.equal(t.T().operationalError(resp(500), { detail: [{ loc: ['body'], msg: 'Traceback' }] }).message, 'Service momentanément indisponible. Réessayez dans un instant.');
  assert.equal(t.T().operationalError(resp(422), { detail: [{ loc: ['body', 'token'], msg: 'field required' }] }).message, 'Pointage impossible : informations incomplètes ou invalides.');
  assert.equal(t.T().operationalError(resp(409), { detail: 'Journée clôturée : pointage refusé.' }).message, 'Journée clôturée : pointage refusé.');
  t.w.console.warn = warn;
});

test('saisie manuelle : contexte affiché, opération auditée, intention EXTRA_SHIFT_ENTRY transmise explicitement', async () => {
  const context = { employee: E2, site: { id: 12, name: 'SITE TEST' }, manual_entry_allowed: true, intent: 'EXTRA_SHIFT_ENTRY', reason_required: true, audited: true,
    extra_shift: { kind: 'EXTRA_SHIFT', entry_status: 'EXTRA_MANUAL', entry_status_label: 'Nouvelle entrée saisie par le pointeur', shift_label: 'Après-midi', scheduled_start: iso('14:00'), scheduled_end: iso('22:00'),
      window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } } };
  const done = { success: true, action: 'arrivee', cycle: 2, heure: '15:10:00', date: '2026-10-01', site: 'SITE TEST', observation: 'Maintien demandé par le chef de poste', employee: { ...E2 }, counted: { kind: 'EXTRA_SHIFT', entry_status: 'EXTRA_MANUAL' } };
  const t = await ready(boot({ live: [LIVE(POST({ permissions: { manual_entry: true } }))], routes: {
    '/api/portal/attendance-manual/context': async () => ({ ok: true, status: 200, json: async () => context }),
    '/api/portal/attendance-manual/scan': async () => ({ ok: true, status: 201, headers: { get: () => null }, json: async () => done }) } }));
  t.T().toggleManualPanel(); t.T().setManualResults([E2]); t.T().selectManualResult(0);
  await tick();
  const box = t.text('manualContext');
  assert.match(box, /Employé BENALI SAMIR · K088 Site SITE TEST Vacation précédente 06:00 → 14:00 Sortie précédente 14:04 Fin théorique 14:00 Fenêtre automatique 14:30 → 14:45 Vacation supplémentaire Après-midi 14:00 → 22:00/);
  assert.match(box, /Motif \(obligatoire\)/); assert.match(box, /Cette opération sera auditée\./);
  const button = t.d.getElementById('manualExtraBtn');
  assert.equal(button.classList.contains('hidden'), false);
  button.click(); await tick();
  assert.match(t.text('manualFeedback'), /Motif obligatoire/);
  assert.equal(t.calls.some((c) => c.path === '/api/portal/attendance-manual/scan'), false, 'aucun envoi sans motif');
  t.d.getElementById('manualReason').value = 'Maintien demandé par le chef de poste';
  button.click(); await tick(60);
  const sent = t.calls.find((c) => c.path === '/api/portal/attendance-manual/scan').body;
  assert.equal(sent.intent, 'EXTRA_SHIFT_ENTRY'); assert.equal(sent.observation, 'Maintien demandé par le chef de poste'); assert.equal(sent.employee_id, 12);
  assert.match(t.text('manualFeedback'), /ENTRÉE MANUELLE ENREGISTRÉE Source Pointeur Saisi par Poste sécurité Motif Maintien demandé par le chef de poste Statut EN MAINTIEN · À QUALIFIER/);
  // Le bouton PRÉSENT historique n'envoie jamais d'intention : un scan ambigu n'est pas deviné.
  t.T().setManualResults([E2]); t.T().selectManualResult(0); await tick();
  await t.T().confirmManualPointage('present'); await tick();
  const plain = t.calls.filter((c) => c.path === '/api/portal/attendance-manual/scan').pop().body;
  assert.equal('intent' in plain, false);
});

test('saisie manuelle : sans permission ou avant la fenêtre, le bouton de maintien n\'est pas proposé', async () => {
  const ctx = (status) => ({ employee: E2, site: { id: 12, name: 'SITE TEST' }, manual_entry_allowed: false, reason_required: false, audited: true,
    extra_shift: { kind: 'EXTRA_SHIFT', entry_status: status, entry_status_label: status, scheduled_start: iso('14:00'), scheduled_end: iso('22:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } } });
  let current = ctx('MANUAL_ENTRY_REQUIRED');
  const t = await ready(boot({ live: [LIVE(POST())], routes: { '/api/portal/attendance-manual/context': async () => ({ ok: true, status: 200, json: async () => current }) } }));
  t.T().toggleManualPanel(); t.T().setManualResults([E2]); t.T().selectManualResult(0); await tick();
  assert.ok(t.d.getElementById('manualExtraBtn').classList.contains('hidden')); assert.match(t.text('manualContext'), /n’a pas la permission « Saisie manuelle »/);
  current = ctx('EXTRA_BEFORE_WINDOW');
  t.T().selectManualResult(0); await tick();
  assert.ok(t.d.getElementById('manualExtraBtn').classList.contains('hidden')); assert.match(t.text('manualContext'), /Nouvelle entrée possible entre 14:30 et 14:45/);
});

test('rafraîchissement : contenu identique ⇒ aucun nœud réécrit ; sans poste, l\'écran historique reste', async () => {
  const t = await ready(boot({ live: [LIVE(POST())] }));
  const nodes = ['#shiftBanner .v5-shift-name', '#postKpis .v5-kpi', '#presentNowList .v5-person', '#todoList .v5-todo', '#movementsList .v5-move'].map((s) => t.d.querySelector(s));
  const reader = t.d.getElementById('reader'), scanCard = t.d.getElementById('lastScanCard').firstElementChild;
  for (let i = 0; i < 5; i++) await t.T().pollLive();
  ['#shiftBanner .v5-shift-name', '#postKpis .v5-kpi', '#presentNowList .v5-person', '#todoList .v5-todo', '#movementsList .v5-move'].forEach((s, i) => assert.equal(t.d.querySelector(s), nodes[i], s));
  assert.equal(t.d.getElementById('reader'), reader); assert.equal(t.d.getElementById('lastScanCard').firstElementChild, scanCard, 'zone de pointage intacte');
  assert.ok(t.d.body.classList.contains('has-post'));
  t.T().setPost(null);
  assert.equal(t.d.body.classList.contains('has-post'), false);
});

test('aucune donnée codée en dur dans la page', () => {
  for (const banned of [/DHL HAMOUL/i, /18 attendus/i, /16 présents/i, /GROUPE [ABCD]\b/, /ADDA|IBRAHIM|K162/]) assert.doesNotMatch(HTML, banned);
  assert.doesNotMatch(HTML.slice(HTML.indexOf('Poste de contrôle V5 ═')), /new Date\(\)\.toISOString\(\)\.slice\(0,10\)/);
});
