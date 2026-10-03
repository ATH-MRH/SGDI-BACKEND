// LOT C1 — DRH → Fiche de position → « Prendre la photo » avec un terminal de pointage distant.
// Vrai sgdi-app.js dans jsdom ; seul le réseau est simulé. Le PC ne reçoit jamais de vidéo :
// il crée une session, en lit l'état, puis reçoit LA photo prise ; rien n'est enregistré tant
// que l'opérateur n'a pas cliqué « Enregistrer ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['employeePhotoPanelHTML', 'openAgentPhotoSource', 'continueAgentPhotoSource', 'cancelAgentRemotePhoto', 'decideAgentRemotePhoto',
  'agentRemotePhoto', 'employeePhotoSource', 'employeePhotoSaveQuery', 'closeModal'];
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const PHOTO = 'data:image/jpeg;base64,/9j/REMOTE';
const TERMINALS = 'GET /api/drh/employees/42/remote-photo/terminals';
const START = 'PUT /api/drh/employees/42/remote-photo/session';
const SESSION = 'GET /api/drh/remote-photo/sessions/sess-1';
const PREVIEW = 'GET /api/drh/remote-photo/sessions/sess-1/preview';
const DECIDE = 'PATCH /api/drh/remote-photo/sessions/sess-1';
const TABLET = { id: 7, name: 'Entrée principale', type: 'Tablette', site: 'HAMOUL 01 (40K)', location: null, online: true, busy: false, last_seen_at: '2026-10-03T08:00:00Z', employee_site: true };
const PHONE = { id: 8, name: 'Pointage 01', type: 'Smartphone', site: 'HAMOUL 01 (40K)', location: 'Quai', online: false, busy: false, last_seen_at: '2026-10-02T17:30:00Z', employee_site: true };
const BUSY = { id: 9, name: 'Sortie', type: 'Tablette', site: 'HAMOUL 02', location: null, online: true, busy: true, last_seen_at: '2026-10-03T08:00:00Z', employee_site: false };
const state = (status, extra = {}) => ({ session_id: 'sess-1', status, active: ['REQUESTED', 'WAITING_FOR_FACE', 'PREVIEW_READY', 'RETAKE_REQUESTED'].includes(status), reason: null,
  message: { REQUESTED: 'Commande envoyée au terminal…', WAITING_FOR_FACE: 'Le terminal attend que le salarié se place devant la caméra.', PREVIEW_READY: 'Photo prise. Vérifiez-la avant de l\'utiliser.',
    RETAKE_REQUESTED: 'Nouvelle prise demandée au terminal…', EXPIRED: 'La prise de photo a expiré. Le terminal est revenu au pointage.', FAILED: 'Le terminal ne répond pas. Vérifiez qu\'il est allumé et connecté.' }[status] || '',
  attempt: 0, expires_in: 100, preview: status === 'PREVIEW_READY', checks: status === 'PREVIEW_READY' ? { face: true, framing: true, quality: true } : null,
  terminal: { name: 'Entrée principale', site: 'HAMOUL 01 (40K)', type: 'Tablette' }, ...extra });

function boot({ routes = {}, editable = true } = {}) {
  const ctx = loadSgdiApp(NAMES);
  assert.ifError(ctx.loadError);
  const { window } = ctx, T = ctx.T(), d = window.document;
  const a = { id: 'ag1', backendId: 42, nom: 'ABDELALI', prenom: 'Habib', matricule: 'K01', photo: '/uploads/photos/k01-abc.jpg' };
  T.setDb({ agents: [a], sites: [], users: [], settings: {} });
  T.setSession({ username: 'DRH01', role: 'agent', transverse: 'drh' });
  window.sessionStorage.setItem('ficheContext', 'drh');
  window.sessionStorage.setItem('sgdi_api_token_v1', 'tok');
  const calls = [];
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://drh.irongs.com');
    const call = { key: `${opts.method || 'GET'} ${u.pathname}`, body: opts.body ? JSON.parse(opts.body) : null, keepalive: Boolean(opts.keepalive), auth: (opts.headers || {}).authorization };
    calls.push(call);
    const found = routes[call.key] || [200, {}];
    const [status, data] = typeof found === 'function' ? found(call) : found;
    return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), blob: async () => ({ size: 10, type: 'image/jpeg' }) };
  };
  let urls = 0; const revoked = [];
  window.URL.createObjectURL = () => `blob:preview-${++urls}`;
  window.URL.revokeObjectURL = (u) => revoked.push(u);
  // Seule la relecture de session (1 s) est retenue ; les autres minuteurs de l'application restent réels.
  const real = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window), polls = [];
  let pollId = 1e9;
  window.setTimeout = (fn, ms, ...rest) => { if (ms !== 1000) return real(fn, ms, ...rest); polls.push({ id: ++pollId, fn }); return pollId; };
  window.clearTimeout = (id) => { const i = polls.findIndex((p) => p.id === id); if (i >= 0) polls.splice(i, 1); else realClear(id); };
  if (!d.getElementById('toast-host')) d.body.insertAdjacentHTML('beforeend', '<div id="toast-host"></div>');
  d.getElementById('view').innerHTML = `<div class="rh-erp-photo" id="rh-erp-photo-ag1"></div>${T.employeePhotoPanelHTML(a, editable)}
    <form id="agent-form"><input type="hidden" name="photo" value="${a.photo}"><button type="submit" class="rh-save-submit" disabled></button></form>`;
  const modal = () => d.getElementById('modal-host');
  return { ...ctx, T, d, a, calls, polls, revoked, w: window, modal,
    sent: (key) => calls.filter((c) => c.key === key),
    async poll() { assert.ok(polls.length, 'une relecture de session est programmée'); polls.shift().fn(); await tick(); },
    visible: (id) => { const el = d.getElementById(id); return Boolean(el) && !el.hidden; },
    toasts: () => Array.from(d.querySelectorAll('.toast, #toast-host *')).map((x) => x.textContent).join(' | ') };
}

async function openRemote(t) {
  t.T.openAgentPhotoSource('ag1');
  await tick();
  t.modal().querySelector('input[name="photo-source"][value="7"]').click();
  t.T.continueAgentPhotoSource('ag1');
  await tick();
}

test('prise distante non activée, aucun terminal ou liste indisponible : caméra de cet ordinateur, comme avant', async () => {
  for (const reply of [[200, { enabled: false, terminals: [] }], [200, { enabled: true, terminals: [] }], [503, { detail: 'x' }], [403, { detail: 'Accès refusé' }]]) {
    const t = boot({ routes: { [TERMINALS]: reply } });
    Object.defineProperty(t.w.navigator, 'mediaDevices', { value: undefined, configurable: true });
    t.T.openAgentPhotoSource('ag1');
    await tick();
    assert.ok(t.d.getElementById('photo-cam-title'), 'fenêtre caméra locale (LOT A)');
    assert.equal(t.d.getElementById('photo-source-title'), null);
    assert.equal(t.sent(START).length, 0);
    t.dom.window.close();
  }
});

test('choix de l\'appareil : caméra locale par défaut, terminaux en ligne sélectionnables, hors ligne / occupé grisés', async () => {
  const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET, PHONE, BUSY] }] } });
  t.T.openAgentPhotoSource('ag1');
  await tick();
  assert.equal(t.d.getElementById('photo-source-title').textContent, 'Prendre une nouvelle photo');
  assert.equal(t.d.getElementById('rh-photo-camera-ag1').getAttribute('onclick'), "openAgentPhotoSource('ag1')");
  assert.equal(t.d.getElementById('photo-source-continue').getAttribute('onclick'), "continueAgentPhotoSource('ag1')");
  const options = Array.from(t.modal().querySelectorAll('.photo-source-option')).map((o) => ({ text: o.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), input: o.querySelector('input') }));
  assert.equal(options.length, 4);
  assert.equal(options[0].text, 'Caméra de cet ordinateur'); assert.equal(options[0].input.checked, true);
  assert.equal(options[1].text, 'Tablette Entrée principale HAMOUL 01 (40K) ● En ligne'); assert.equal(options[1].input.disabled, false);
  assert.match(options[2].text, /^Smartphone Pointage 01 HAMOUL 01 \(40K\) · Quai ○ Hors ligne Dernière activité : \d{2}\/\d{2}/); assert.equal(options[2].input.disabled, true);
  assert.match(options[3].text, /Occupé par une autre prise de photo/); assert.equal(options[3].input.disabled, true);
  assert.doesNotMatch(t.modal().textContent, /cl[ée]|secret|challenge|nonce|empreinte/i);
  // Un terminal grisé ne peut pas être choisi : « Continuer » ouvre alors la caméra locale.
  options[2].input.click();
  assert.equal(options[2].input.checked, false);
  Object.defineProperty(t.w.navigator, 'mediaDevices', { value: undefined, configurable: true });
  t.T.continueAgentPhotoSource('ag1');
  await tick();
  assert.ok(t.d.getElementById('photo-cam-title'));
  assert.equal(t.sent(START).length, 0, 'aucune commande envoyée');
  t.dom.window.close();
});

test('terminal choisi : session créée, état suivi, AUCUNE vidéo ; aperçu de la seule photo prise', async () => {
  let current = state('REQUESTED');
  const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET, PHONE] }], [START]: [200, state('REQUESTED')], [SESSION]: () => [200, current] } });
  await openRemote(t);
  assert.deepEqual(t.sent(START).map((c) => c.body), [{ terminal_id: 7 }]);
  assert.ok(t.sent(START)[0].auth, 'requête authentifiée');
  assert.equal(t.d.getElementById('photo-remote-title').textContent, 'Photo prise avec Tablette Entrée principale');
  assert.equal(t.modal().querySelector('video'), null, 'aucun flux vidéo sur le PC');
  assert.deepEqual(['photo-remote-cancel', 'photo-remote-close', 'photo-remote-retake', 'photo-remote-use'].map((id) => t.d.getElementById(id).getAttribute('onclick')),
    ['cancelAgentRemotePhoto()', 'closeModal()', "decideAgentRemotePhoto('retake')", "decideAgentRemotePhoto('accept')"]);
  assert.equal(t.d.getElementById('photo-remote-msg').textContent, 'Commande envoyée au terminal…');
  assert.equal(t.visible('photo-remote-cancel'), true); assert.equal(t.visible('photo-remote-use'), false); assert.equal(t.visible('photo-remote-retake'), false);
  current = state('WAITING_FOR_FACE');
  await t.poll();
  assert.equal(t.d.getElementById('photo-remote-msg').textContent, 'Le terminal attend que le salarié se place devant la caméra.');
  assert.equal(t.sent(PREVIEW).length, 0, 'aucune image demandée avant la prise');
  current = state('PREVIEW_READY');
  await t.poll();
  assert.equal(t.sent(PREVIEW).length, 1);
  assert.equal(t.d.getElementById('photo-remote-shot').getAttribute('src'), 'blob:preview-1');
  assert.equal(t.visible('photo-remote-shot'), true); assert.equal(t.visible('photo-remote-wait'), false);
  assert.equal(t.d.getElementById('photo-remote-checks').textContent, '✓ Visage détecté✓ Cadrage conforme✓ Qualité suffisante');
  assert.ok(t.d.querySelector('.photo-remote-stage').classList.contains('is-square'), 'aperçu carré : la photo recadrée selon le cercle');
  assert.deepEqual(['photo-remote-retake', 'photo-remote-use', 'photo-remote-cancel'].map(t.visible), [true, true, true]);
  await t.poll(); await t.poll();
  assert.equal(t.sent(PREVIEW).length, 1, 'la photo n\'est demandée qu\'une fois par prise');
  assert.doesNotMatch(t.modal().textContent, /score|gabarit|embedding/i);
  assert.equal(t.d.querySelector('#agent-form [name="photo"]').value, t.a.photo, 'rien dans la fiche avant « Utiliser cette photo »');
  t.T.cancelAgentRemotePhoto(); await tick();
  t.dom.window.close();
});

test('Reprendre puis Utiliser cette photo : la photo rejoint le formulaire, sans enregistrer la fiche', async () => {
  let current = state('PREVIEW_READY');
  const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }], [START]: [200, state('REQUESTED')], [SESSION]: () => [200, current],
    [DECIDE]: (call) => (call.body.action === 'retake' ? (current = state('RETAKE_REQUESTED', { attempt: 1 }), [200, current])
      : call.body.action === 'accept' ? [200, { ...state('ACCEPTED'), photo: PHOTO }] : [200, state('CANCELLED')]) } });
  await openRemote(t);
  await t.poll();
  assert.equal(t.sent(PREVIEW).length, 1);
  t.T.decideAgentRemotePhoto('retake'); await tick();
  assert.deepEqual(t.sent(DECIDE).map((c) => c.body), [{ action: 'retake' }]);
  assert.deepEqual(t.revoked, ['blob:preview-1'], 'aperçu précédent libéré');
  assert.equal(t.visible('photo-remote-shot'), false); assert.equal(t.visible('photo-remote-use'), false);
  assert.equal(t.d.getElementById('photo-remote-msg').textContent, 'Nouvelle prise demandée au terminal…');
  current = state('PREVIEW_READY', { attempt: 1 });
  await t.poll();
  assert.equal(t.sent(PREVIEW).length, 2); assert.equal(t.d.getElementById('photo-remote-shot').getAttribute('src'), 'blob:preview-2');
  t.T.decideAgentRemotePhoto('accept'); await tick();
  assert.deepEqual(t.sent(DECIDE).map((c) => c.body.action), ['retake', 'accept']);
  assert.equal(t.d.getElementById('photo-remote-title'), null, 'fenêtre fermée');
  assert.equal(t.d.querySelector('#agent-form [name="photo"]').value, PHOTO);
  assert.equal(t.T.employeePhotoSource.ag1, 'DRH_REMOTE_TERMINAL');
  assert.equal(t.T.employeePhotoSaveQuery('ag1', t.a.photo, PHOTO), '?photo_source=DRH_REMOTE_TERMINAL');
  assert.equal(t.d.querySelector('.rh-save-submit').disabled, false, 'la fiche devient enregistrable');
  assert.equal(t.d.getElementById('rh-photo-state-ag1').textContent, '✓ Photo disponible');
  assert.match(t.d.getElementById('rh-photo-check-ag1').textContent, /Photo exploitable.*Enregistrez la fiche pour conserver la photo\./);
  assert.equal(t.calls.some((c) => /^(PUT|POST) \/api\/drh\/employees(\/42)?$/.test(c.key)), false, 'la fiche n\'est PAS enregistrée par « Utiliser cette photo »');
  assert.equal(t.sent(DECIDE).some((c) => c.body.action === 'cancel'), false, 'une session acceptée n\'est pas annulée');
  assert.equal(t.polls.length, 0, 'plus aucune relecture');
  t.dom.window.close();
});

test('Annuler la prise, fenêtre fermée, fiche quittée, page fermée : la session est toujours annulée', async () => {
  const routes = { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }], [START]: [200, state('REQUESTED')], [SESSION]: [200, state('WAITING_FOR_FACE')], [DECIDE]: [200, state('CANCELLED')] };
  const closers = {
    'bouton « Annuler la prise »': (t) => t.T.cancelAgentRemotePhoto(),
    'fenêtre fermée autrement': (t) => t.T.closeModal(),
    'changement d\'écran': (t) => t.w.dispatchEvent(new t.w.Event('hashchange')),
    'page fermée': (t) => t.w.dispatchEvent(new t.w.Event('pagehide')),
  };
  for (const [name, close] of Object.entries(closers)) {
    const t = boot({ routes });
    await openRemote(t);
    close(t); await tick(40);
    const cancels = t.sent(DECIDE);
    assert.deepEqual(cancels.map((c) => c.body), [{ action: 'cancel' }], name);
    assert.equal(cancels[0].keepalive, true, name + ' : la requête survit à la fermeture de la page');
    assert.equal(t.T.agentRemotePhoto.sessionId, null, name);
    if (name !== 'page fermée') assert.equal(t.d.getElementById('photo-remote-title'), null, name);
    assert.equal(t.d.querySelector('#agent-form [name="photo"]').value, t.a.photo, name);
    t.dom.window.close();
  }
});

test('session expirée ou terminal muet : message clair, plus d\'action, plus de relecture, rien à annuler', async () => {
  for (const status of ['EXPIRED', 'FAILED']) {
    let current = state('WAITING_FOR_FACE');
    const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }], [START]: [200, state('REQUESTED')], [SESSION]: () => [200, current], [DECIDE]: [200, state('CANCELLED')] } });
    await openRemote(t);
    current = state(status);
    await t.poll();
    assert.match(t.d.getElementById('photo-remote-msg').textContent, status === 'EXPIRED' ? /a expiré/ : /ne répond pas/);
    assert.deepEqual(['photo-remote-use', 'photo-remote-retake', 'photo-remote-cancel', 'photo-remote-close'].map(t.visible), [false, false, false, true]);
    assert.equal(t.polls.length, 0);
    t.T.closeModal(); await tick();
    assert.equal(t.sent(DECIDE).length, 0);
    t.dom.window.close();
  }
});

test('refus du serveur (terminal occupé, hors ligne, droits) : message, aucune fenêtre de prise ; fiche verrouillée : rien', async () => {
  const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }],
    [START]: [409, { detail: { code: 'TERMINAL_BUSY', message: 'Terminal déjà utilisé pour une prise de photo.' } }] } });
  await openRemote(t);
  assert.equal(t.d.getElementById('photo-remote-title'), null);
  assert.ok(t.d.getElementById('photo-source-title'), 'le choix de l\'appareil reste ouvert');
  assert.equal(t.d.getElementById('photo-source-continue').disabled, false);
  assert.match(t.d.getElementById('toast-host').textContent, /Terminal déjà utilisé pour une prise de photo\./);
  assert.equal(t.T.agentRemotePhoto.sessionId, null);
  t.dom.window.close();
  const locked = boot({ editable: false, routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }] } });
  assert.equal(locked.d.getElementById('rh-photo-camera-ag1'), null, 'aucun bouton de prise de photo sur une fiche verrouillée');
  locked.w.sessionStorage.setItem('ficheContext', 'ops');                       // hors contexte DRH : mêmes verrous que l'import
  locked.T.setSession({ username: 'OPS01', role: 'agent', transverse: 'ops' });
  await locked.T.openAgentPhotoSource('ag1'); await tick();
  assert.equal(locked.sent(TERMINALS).length, 0); assert.equal(locked.sent(START).length, 0);
  locked.dom.window.close();
});

test('photo non validée par le serveur (cadrage absent) : « Utiliser cette photo » jamais proposé', async () => {
  let current = state('PREVIEW_READY', { checks: { face: true, quality: true } });
  const t = boot({ routes: { [TERMINALS]: [200, { enabled: true, terminals: [TABLET] }], [START]: [200, state('REQUESTED')], [SESSION]: () => [200, current], [DECIDE]: [200, state('CANCELLED')] } });
  await openRemote(t);
  await t.poll();
  assert.equal(t.visible('photo-remote-use'), false);
  assert.equal(t.visible('photo-remote-retake'), true);
  assert.match(t.d.getElementById('photo-remote-checks').textContent, /Photo non validée — reprenez la photo/);
  current = state('PREVIEW_READY', { checks: null });
  await t.poll();
  assert.equal(t.visible('photo-remote-use'), false);
  t.T.cancelAgentRemotePhoto(); await tick();
  t.dom.window.close();
});
