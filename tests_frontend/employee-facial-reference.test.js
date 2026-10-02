// LOT A — DRH → Fiche de position → Photo employé : panneau photo, état de la référence faciale,
// aperçu, capture caméra. Vrai sgdi-app.js dans jsdom ; seuls le réseau et la caméra sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['employeePhotoPanelHTML', 'loadEmployeeFacialReference', 'employeePhotoCheck', 'openAgentPhotoPreview', 'openAgentPhotoCamera',
  'captureAgentPhoto', 'retakeAgentPhoto', 'useAgentPhoto', 'closeAgentPhotoCamera', 'openAgentPhotoUpload', 'agentPhotoCam'];
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const DATA_URL = 'data:image/jpeg;base64,/9j/AAAA';

function boot({ agent = {}, routes = {}, media, editable = true } = {}) {
  const ctx = loadSgdiApp(NAMES);
  assert.ifError(ctx.loadError);
  const { window } = ctx, T = ctx.T(), d = window.document;
  const a = { id: 'ag1', backendId: 42, nom: 'ABDELALI', prenom: 'Habib', matricule: 'K01', photo: '/uploads/photos/k01-abc.jpg', ...agent };
  T.setDb({ agents: [a], sites: [], users: [], settings: {} });
  T.setSession({ username: 'DRH01', role: 'agent', transverse: 'drh' });
  window.sessionStorage.setItem('ficheContext', 'drh');
  window.sessionStorage.setItem('sgdi_api_token_v1', 'tok');
  const calls = [];
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://drh.irongs.com');
    const call = { path: u.pathname, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const found = routes[`${call.method} ${u.pathname}`] || [200, {}];
    const [status, data] = typeof found === 'function' ? found(call) : found;
    return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
  if (media !== undefined) Object.defineProperty(window.navigator, 'mediaDevices', { value: media, configurable: true });
  d.getElementById('view').innerHTML = `<div class="rh-erp-photo" id="rh-erp-photo-ag1"><div class="photo-cam-overlay"></div></div>${T.employeePhotoPanelHTML(a, editable)}
    <form id="agent-form"><input type="hidden" name="photo" value="${a.photo || ''}"></form>`;
  const text = (id) => (d.getElementById(id) ? d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);
  return { ...ctx, T, d, a, calls, text, w: window };
}

const STATE = (state, label, message, photo = true) => ({ employee_id: 42, photo: { available: photo }, reference: { state, label, message }, analysis_available: true });
const REF = 'GET /api/drh/employees/42/facial-reference';
const ANALYZE = 'POST /api/drh/employees/42/facial-reference/analyze';

test('panneau : photo existante → Actualiser / Prendre / Aperçu ; photo et référence faciale sont deux blocs distincts', async () => {
  const t = boot({ routes: { [REF]: [200, STATE('NONE', 'Aucune référence disponible', "La photo de la fiche n'a pas encore servi à préparer une référence faciale.")] } });
  const titles = Array.from(t.d.querySelectorAll('.rh-photo-title')).map((x) => x.textContent);
  assert.deepEqual(titles, ['Photo employé', 'Référence faciale']);
  assert.equal(t.text('rh-photo-state-ag1'), '✓ Photo disponible');
  assert.equal(t.text('rh-photo-import-ag1'), 'Actualiser la photo');
  assert.equal(t.text('rh-photo-camera-ag1'), 'Prendre la photo');
  assert.equal(t.d.getElementById('rh-photo-preview-ag1').hidden, false);
  await t.T.loadEmployeeFacialReference('ag1');
  // Une photo présente ne vaut jamais « Prête ».
  assert.equal(t.text('rh-facial-ref-ag1'), "✕ Aucune référence disponible La photo de la fiche n'a pas encore servi à préparer une référence faciale.");
  assert.equal(t.d.getElementById('rh-facial-ref-ag1').dataset.state, 'NONE');
  t.dom.window.close();
});

test('photo absente → « Ajouter une photo », aucun aperçu ; fiche verrouillée → aucune action de modification', async () => {
  const t = boot({ agent: { photo: '' }, routes: { [REF]: [200, STATE('NONE', 'Aucune référence disponible', 'Ajoutez une photo pour permettre la reconnaissance faciale.', false)] } });
  assert.equal(t.text('rh-photo-state-ag1'), '✕ Aucune photo');
  assert.equal(t.text('rh-photo-import-ag1'), 'Ajouter une photo');
  assert.equal(t.d.getElementById('rh-photo-preview-ag1').hidden, true);
  t.dom.window.close();
  const locked = boot({ editable: false });
  assert.equal(locked.d.getElementById('rh-photo-import-ag1'), null);
  assert.equal(locked.d.getElementById('rh-photo-camera-ag1'), null);
  assert.ok(locked.d.getElementById('rh-photo-preview-ag1'));
  locked.dom.window.close();
});

test('états de la référence faciale : Prête, Photo à actualiser, Revue requise — sans aucun terme technique', async () => {
  const cases = [['READY', 'Prête', '✓', 'is-ok'], ['PHOTO_TO_UPDATE', 'Photo à actualiser', '⚠', 'is-warn'], ['REVIEW_REQUIRED', 'Revue requise', '⚠', 'is-warn']];
  for (const [state, label, icon, cls] of cases) {
    const t = boot({ routes: { [REF]: [200, STATE(state, label, 'Message.')] } });
    await t.T.loadEmployeeFacialReference('ag1');
    const host = t.d.getElementById('rh-facial-ref-ag1');
    assert.equal(t.text('rh-facial-ref-ag1'), `${icon} ${label} Message.`);
    assert.ok(host.classList.contains(cls), state);
    assert.doesNotMatch(t.d.getElementById('rh-photo-panel-ag1').textContent, /gabarit|embedding|template|score|enrôl/i);
    t.dom.window.close();
  }
  const err = boot({ routes: { [REF]: [403, { detail: 'Accès refusé' }] } });
  await err.T.loadEmployeeFacialReference('ag1');
  assert.equal(err.text('rh-facial-ref-ag1'), 'État indisponible');
  err.dom.window.close();
  const fresh = boot({ agent: { backendId: null } });                 // fiche pas encore enregistrée
  await fresh.T.loadEmployeeFacialReference('ag1');
  assert.equal(fresh.text('rh-facial-ref-ag1'), "Disponible après l'enregistrement de la fiche");
  assert.equal(fresh.calls.length, 0);
  fresh.dom.window.close();
});

test('aperçu : la photo courante s\'affiche en grand', () => {
  const t = boot();
  t.T.openAgentPhotoPreview('ag1');
  assert.equal(t.d.getElementById('photo-preview-img').getAttribute('src'), '/uploads/photos/k01-abc.jpg');
  t.dom.window.close();
});

function fakeCamera(w) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const requests = [];
  return { track, requests, media: { getUserMedia: async (c) => { requests.push(c); return stream; } } };
}

test('caméra : ouverture → aperçu vidéo → capture → reprendre → capturer → utiliser ; une seule requête, à la validation', async () => {
  const cam = fakeCamera();
  const t = boot({ media: cam.media, routes: { [ANALYZE]: [200, { usable: true, state: 'OK', message: 'Photo exploitable pour la reconnaissance faciale.', reasons: [] }] } });
  // jsdom n'a ni flux vidéo ni canvas : on fournit les dimensions et le rendu de la capture.
  t.w.HTMLVideoElement.prototype.play = async () => {};
  Object.defineProperty(t.w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 1280, configurable: true });
  Object.defineProperty(t.w.HTMLVideoElement.prototype, 'videoHeight', { get: () => 960, configurable: true });
  let draws = 0;
  t.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() { draws += 1; } });
  t.w.HTMLCanvasElement.prototype.toDataURL = function () { return `${DATA_URL}${draws}-${this.width}x${this.height}`; };
  await t.T.openAgentPhotoCamera('ag1');
  assert.deepEqual([cam.requests[0].audio, cam.requests[0].video.facingMode], [false, 'user']);
  assert.equal(t.d.getElementById('photo-cam-video').hidden, false);
  assert.equal(t.d.getElementById('photo-cam-capture').hidden, false);
  assert.equal(t.d.getElementById('photo-cam-use').hidden, true);
  t.T.captureAgentPhoto();
  assert.equal(t.d.getElementById('photo-cam-shot').hidden, false);
  assert.equal(t.d.getElementById('photo-cam-video').hidden, true);
  assert.match(t.d.getElementById('photo-cam-shot').getAttribute('src'), /1-1000x750$/);   // réduite à 1000 px
  assert.equal(t.calls.length, 0, 'aucune image envoyée avant validation');
  t.T.retakeAgentPhoto();
  assert.equal(t.d.getElementById('photo-cam-video').hidden, false);
  assert.equal(t.T.agentPhotoCam.shot, '', 'capture abandonnée non conservée');
  t.T.captureAgentPhoto();
  t.T.useAgentPhoto();
  await tick(40);
  assert.equal(cam.track.stopped, true, 'caméra libérée');
  assert.equal(t.d.getElementById('photo-cam-video'), null);
  const used = t.d.querySelector('#agent-form [name="photo"]').value;
  assert.match(used, /2-1000x750$/);
  assert.equal(t.d.querySelector('#rh-erp-photo-ag1 img').getAttribute('src'), used);
  assert.deepEqual(t.calls.map((c) => `${c.method} ${c.path}`), [ANALYZE]);
  assert.equal(t.calls[0].body.photo, used);
  assert.match(t.text('rh-photo-check-ag1'), /✓ Photo exploitable pour la reconnaissance faciale\. Enregistrez la fiche/);
  assert.equal(t.T.agentPhotoCam.shot, '');
  t.dom.window.close();
});

test('caméra : fermeture libère le flux ; absence de caméra et permission refusée → message clair, import toujours possible', async () => {
  const cam = fakeCamera();
  const t = boot({ media: cam.media });
  t.w.HTMLVideoElement.prototype.play = async () => {};
  await t.T.openAgentPhotoCamera('ag1');
  t.T.closeAgentPhotoCamera();
  assert.equal(cam.track.stopped, true);
  assert.equal(t.d.getElementById('modal-host').innerHTML, '');
  assert.equal(t.calls.length, 0);
  t.dom.window.close();
  const none = boot({ media: null });
  await none.T.openAgentPhotoCamera('ag1');
  assert.match(none.text('photo-cam-msg'), /Aucune caméra disponible sur cet appareil\. Utilisez « Ajouter une photo »/);
  assert.equal(none.d.getElementById('photo-cam-capture').hidden, true);
  none.dom.window.close();
  for (const [name, re] of [['NotAllowedError', /Accès à la caméra refusé/], ['NotFoundError', /Aucune caméra détectée/]]) {
    const denied = boot({ media: { getUserMedia: async () => { throw Object.assign(new Error('x'), { name }); } } });
    await denied.T.openAgentPhotoCamera('ag1');
    assert.match(denied.text('photo-cam-msg'), re);
    assert.ok(denied.d.getElementById('photo-cam-msg').classList.contains('is-error'));
    denied.dom.window.close();
  }
});

test('caméra refusée hors contexte DRH / fiche verrouillée (mêmes verrous que l\'import)', async () => {
  const cam = fakeCamera();
  const t = boot({ media: cam.media });
  t.w.sessionStorage.setItem('ficheContext', 'ops');
  t.T.setSession({ username: 'OPS01', role: 'agent', transverse: 'ops' });
  await t.T.openAgentPhotoCamera('ag1');
  assert.equal(cam.requests.length, 0);
  assert.equal(t.d.getElementById('photo-cam-video'), null);
  t.dom.window.close();
});

test('analyse de la photo retenue : inexploitable (raison réelle), indisponible, format refusé — jamais bloquant', async () => {
  const bad = boot({ routes: { [ANALYZE]: [200, { usable: false, state: 'QUALITY_FAILED', message: 'Qualité insuffisante pour la reconnaissance faciale.', reasons: ['Image floue — restez immobile'] }] } });
  await bad.T.employeePhotoCheck('ag1', DATA_URL);
  assert.equal(bad.text('rh-photo-check-ag1'), '⚠ Qualité insuffisante pour la reconnaissance faciale. — Image floue — restez immobile Vous pouvez reprendre la photo.');
  assert.ok(bad.d.getElementById('rh-photo-check-ag1').classList.contains('is-warn'));
  bad.dom.window.close();
  const off = boot({ routes: { [ANALYZE]: [503, { detail: { code: 'FACIAL_ANALYSIS_DISABLED' } }] } });
  await off.T.employeePhotoCheck('ag1', DATA_URL);
  assert.match(off.text('rh-photo-check-ag1'), /Analyse faciale indisponible pour le moment — la photo peut être enregistrée/);
  off.dom.window.close();
  const fmt = boot({ routes: { [ANALYZE]: [422, { detail: { code: 'INVALID_IMAGE' } }] } });
  await fmt.T.employeePhotoCheck('ag1', DATA_URL);
  assert.match(fmt.text('rh-photo-check-ag1'), /Photo non analysable/);
  fmt.dom.window.close();
  const url = boot();
  await url.T.employeePhotoCheck('ag1', '/uploads/photos/k01-abc.jpg');       // photo déjà enregistrée : rien à envoyer
  assert.equal(url.calls.length, 0);
  url.dom.window.close();
});
