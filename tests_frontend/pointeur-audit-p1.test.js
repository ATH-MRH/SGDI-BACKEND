// Audit pointeur.irongs.com — P1 : planning sur 8 jours, date du suivi après minuit, reprise
// de poste. Les tests pilotent les fonctions réelles de la page (aucune réimplémentation).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');

const SESSION = { token: 'tok-p1', user: { username: 'PTG01', full_name: 'Agent Test' } };
const EMPLOYEE = { id: 7, matricule: 'M007', nom: 'ADDA', prenom: 'Ibrahim', poste: 'Agent', site: 'SITE TEST' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boot(routes = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'https://pointeur.irongs.com');
    calls.push({ path: parsed.pathname, query: parsed.searchParams, body: options.body ? JSON.parse(options.body) : null });
    const handler = routes[parsed.pathname];
    if (handler) return handler(parsed, options);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  };
  const app = loadPointeur({ fetch, url: 'https://pointeur.irongs.com/pointeur' });
  const w = app.window, t = app.T();
  await tick();
  t.setSession(SESSION);
  await t.enterApp();
  t.clearIdleInterval();
  await tick();
  return { w, t, calls, d: w.document };
}

async function teardown({ w, t }) {
  try { await t.logout(); } catch (e) { /* déjà déconnecté */ }
  w.close();
}

test('planning : la fenêtre de 8 jours n’est jamais réduite à la date du suivi', async () => {
  const app = await boot({ '/api/portal/attendance-feed': async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [] }) });
  app.calls.length = 0;
  await app.w.loadPlanning();
  const planning = app.calls.find((call) => call.path === '/api/portal/attendance-feed' && call.query.get('days') === '8');
  assert.ok(planning, 'le planning interroge le flux sur 8 jours');
  assert.equal(planning.query.has('date'), false, 'aucune date : sinon le serveur ne renvoie qu’un jour');
  // Le suivi du jour, lui, reste borné à sa date.
  assert.match(app.w.siteQuery('?'), /date=\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(app.w.siteQuery('?', false), /date=/);
  await teardown(app);
});

test('date du suivi : suit le jour opérationnel après minuit, sauf choix de l’opérateur', async () => {
  const app = await boot();
  const el = app.d.getElementById('trackingDate'), today = app.t.localDate();
  assert.equal(el.value, today);
  // Le poste est resté ouvert depuis la veille.
  app.w.trackingDateToday = '2026-01-01'; el.value = '2026-01-01'; el.max = '2026-01-01';
  app.calls.length = 0;
  app.w.syncTrackingDate();
  await tick();
  assert.equal(el.value, today, 'la date suit le nouveau jour');
  assert.equal(el.max, today, 'le nouveau jour devient sélectionnable');
  assert.ok(app.calls.some((call) => call.path.startsWith('/api/portal/attendance-')), 'le suivi est rechargé');
  // L'opérateur consulte volontairement un jour passé : sa sélection est conservée.
  app.w.trackingDateToday = '2026-01-02'; el.value = '2025-12-25'; el.max = '2026-01-02';
  app.w.syncTrackingDate();
  assert.equal(el.value, '2025-12-25');
  assert.equal(el.max, today);
  // Même jour : aucun effet.
  el.value = '2025-12-20'; app.w.syncTrackingDate();
  assert.equal(el.value, '2025-12-20');
  await teardown(app);
});

test('reprise de poste : proposée après une sortie en cours de vacation, motif obligatoire, intention explicite', async () => {
  const context = { employee: EMPLOYEE, site: { id: 12, name: 'SITE TEST' }, manual_entry_allowed: true, intent: 'REENTRY', reason_required: true,
    audited: true, extra_shift: null, reentry: { available: true, previous_exit: '05:57' } };
  const done = { success: true, action: 'arrivee', cycle: 2, heure: '06:05:00', date: '2026-10-01', site: 'SITE TEST', employee: { ...EMPLOYEE } };
  const app = await boot({
    '/api/portal/attendance-manual/context': async () => ({ ok: true, status: 200, json: async () => context }),
    '/api/portal/attendance-manual/scan': async () => ({ ok: true, status: 201, headers: { get: () => null }, json: async () => done }),
  });
  app.t.toggleManualPanel(); app.t.setManualResults([EMPLOYEE]); app.t.selectManualResult(0);
  await tick(); await tick();
  const button = app.d.getElementById('manualExtraBtn');
  assert.equal(button.classList.contains('hidden'), false);
  assert.equal(button.textContent, 'REPRISE DE POSTE');
  assert.equal(button.dataset.intent, 'REENTRY');
  const box = app.d.getElementById('manualContext').textContent;
  assert.match(box, /Dernière sortie\s*05:57/); assert.match(box, /Motif \(obligatoire\)/); assert.match(box, /La sortie reste au journal/);
  button.click(); await tick();
  assert.equal(app.calls.some((call) => call.path === '/api/portal/attendance-manual/scan'), false, 'aucun envoi sans motif');
  app.d.getElementById('manualReason').value = 'Double scan à la prise de poste';
  button.click(); await tick(); await tick();
  const sent = app.calls.find((call) => call.path === '/api/portal/attendance-manual/scan');
  assert.ok(sent, 'la reprise est envoyée');
  assert.equal(sent.body.intent, 'REENTRY');
  assert.equal(sent.body.observation, 'Double scan à la prise de poste');
  await teardown(app);
});

test('maintien : le bouton garde son libellé et son intention quand il ne s’agit pas d’une reprise', async () => {
  const iso = (hm) => `2026-10-01T${hm}:00+01:00`;
  const context = { employee: EMPLOYEE, manual_entry_allowed: true, intent: 'EXTRA_SHIFT_ENTRY', reason_required: true, reentry: null,
    extra_shift: { kind: 'EXTRA_SHIFT', entry_status: 'EXTRA_MANUAL', entry_status_label: 'Nouvelle entrée saisie par le pointeur', scheduled_start: iso('14:00'),
      scheduled_end: iso('22:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } } };
  const app = await boot({ '/api/portal/attendance-manual/context': async () => ({ ok: true, status: 200, json: async () => context }) });
  app.t.toggleManualPanel(); app.t.setManualResults([EMPLOYEE]); app.t.selectManualResult(0);
  await tick(); await tick();
  const button = app.d.getElementById('manualExtraBtn');
  assert.equal(button.textContent, 'NOUVELLE ENTRÉE DE MAINTIEN');
  assert.equal(button.dataset.intent, 'EXTRA_SHIFT_ENTRY');
  await teardown(app);
});
