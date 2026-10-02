// LOT B — Fiche de position : après l'enregistrement d'une nouvelle photo, la référence faciale
// est préparée par le serveur. Le frontend transmet seulement la PROVENANCE de la photo (caméra
// ou import) avec l'enregistrement de la fiche, puis relit l'état jusqu'au résultat.
// Vrai sgdi-app.js dans jsdom ; seul le réseau est simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['employeePhotoPanelHTML', 'loadEmployeeFacialReference', 'employeePhotoSaveQuery', 'employeePhotoSaved', 'employeePhotoSource',
  'useAgentPhoto', 'agentPhotoCam', 'SGDI', 'FACIAL_REFERENCE_UI'];
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const DATA_URL = 'data:image/jpeg;base64,/9j/AAAA';
const REF = 'GET /api/drh/employees/42/facial-reference';
// Ne retient que la relecture d'état (2 s) ; les autres minuteurs de l'application restent réels.
function holdPolls(w) {
  const real = w.setTimeout.bind(w), polls = [];
  w.setTimeout = (fn, ms, ...rest) => (ms === 2000 ? polls.push(fn) : real(fn, ms, ...rest));
  return polls;
}
const STATE = (state, label, message) => ({ employee_id: 42, photo: { available: true }, reference: { state, label, message }, analysis_available: true });

function boot({ routes = {} } = {}) {
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
    const call = { path: u.pathname, search: u.search, method: opts.method || 'GET' };
    calls.push(call);
    const found = routes[`${call.method} ${u.pathname}`] || [200, {}];
    const [status, data] = typeof found === 'function' ? found(call) : found;
    return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
  d.getElementById('view').innerHTML = `<div class="rh-erp-photo" id="rh-erp-photo-ag1"></div>${T.employeePhotoPanelHTML(a, true)}
    <form id="agent-form"><input type="hidden" name="photo" value="${a.photo}"></form>`;
  const text = (id) => (d.getElementById(id) ? d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);
  return { ...ctx, T, d, a, calls, text, w: window };
}

test('provenance transmise seulement si la photo du formulaire a réellement changé', () => {
  const t = boot();
  const q = t.T.employeePhotoSaveQuery;
  assert.equal(q('ag1', t.a.photo, t.a.photo), '', 'photo inchangée : aucune provenance, donc aucun déclenchement');
  assert.equal(q('ag1', t.a.photo, null), '', 'photo retirée');
  assert.equal(q('ag1', DATA_URL, DATA_URL), '', 'second enregistrement de la même photo');
  assert.equal(q('ag1', t.a.photo, DATA_URL), '?photo_source=DRH_UPLOAD', 'import par défaut');
  t.T.agentPhotoCam.shot = DATA_URL; t.T.agentPhotoCam.agentId = 'ag1';
  t.T.useAgentPhoto();
  assert.equal(t.T.employeePhotoSource.ag1, 'DRH_CAMERA');
  assert.equal(q('ag1', t.a.photo, DATA_URL), '?photo_source=DRH_CAMERA');
  t.dom.window.close();
});

test("l'enregistrement de la fiche porte la provenance ; sans photo nouvelle, l'appel est inchangé", async () => {
  const t = boot({ routes: { 'PUT /api/drh/employees/42': [200, { id: 42 }], 'POST /api/drh/employees': [200, { id: 43 }] } });
  await t.T.SGDI.employees.update(42, { first_name: 'A', last_name: 'B' }, '?photo_source=DRH_CAMERA');
  await t.T.SGDI.employees.update(42, { first_name: 'A', last_name: 'B' });
  await t.T.SGDI.employees.create({ first_name: 'A', last_name: 'B' }, '?photo_source=DRH_UPLOAD');
  const sent = t.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}${c.search}`);
  assert.deepEqual(sent, ['PUT /api/drh/employees/42?photo_source=DRH_CAMERA', 'PUT /api/drh/employees/42', 'POST /api/drh/employees?photo_source=DRH_UPLOAD']);
  await tick(60);
});

test('états LOT B : libellés compréhensibles, aucun terme technique, aucun bouton d\'enrôlement', async () => {
  const cases = [
    ['PROCESSING', 'Traitement en cours…', 'La référence faciale est en cours de préparation.', '…', 'is-busy'],
    ['PREVIOUS_KEPT', 'Nouvelle photo non exploitable', 'Référence faciale précédente conservée. Aucun visage détecté sur cette photo.', '⚠', 'is-warn'],
    ['UNAVAILABLE', 'Traitement temporairement indisponible', 'La photo est enregistrée. Référence faciale précédente conservée.', '⚠', 'is-warn'],
    ['BLOCKED', 'Référence faciale non autorisée', 'Un refus de la reconnaissance faciale est enregistré pour ce salarié.', '✕', 'is-none'],
    ['REVIEW_REQUIRED', 'Revue requise', 'Ce visage ressemble à celui d\'un autre salarié. Une vérification par un responsable habilité est en attente.', '⚠', 'is-warn'],
    ['PHOTO_TO_UPDATE', 'Photo à actualiser', 'Plusieurs visages détectés : la photo doit montrer une seule personne.', '⚠', 'is-warn'],
    ['READY', 'Prête', 'Le salarié peut être reconnu par les terminaux de pointage autorisés.', '✓', 'is-ok'],
  ];
  for (const [state, label, message, icon, cls] of cases) {
    const t = boot({ routes: { [REF]: [200, STATE(state, label, message)] } });
    holdPolls(t.w);                                             // pas de relecture dans ce test
    await t.T.loadEmployeeFacialReference('ag1');
    const host = t.d.getElementById('rh-facial-ref-ag1');
    assert.equal(t.text('rh-facial-ref-ag1'), `${icon} ${label} ${message}`, state);
    assert.ok(host.classList.contains(cls), state);
    const panel = t.d.querySelector('.rh-photo-panel');
    assert.doesNotMatch(panel.textContent, /gabarit|embedding|template|score|enr[oô]l/i, state);
    const buttons = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent.trim());
    assert.deepEqual(buttons, ['Actualiser la photo', 'Prendre la photo', 'Aperçu'], 'aucun bouton Enrôler / Ré-enrôler / Créer / Confirmer');
    t.dom.window.close();
  }
});

test('après enregistrement : « Traitement en cours… » puis relecture jusqu\'au résultat ; le message d\'analyse est effacé', async () => {
  let n = 0;
  const t = boot({ routes: { [REF]: () => [200, ++n < 3 ? STATE('PROCESSING', 'Traitement en cours…', 'La référence faciale est en cours de préparation.') : STATE('READY', 'Prête', 'ok')] } });
  const timers = holdPolls(t.w);
  t.T.employeePhotoSource.ag1 = 'DRH_CAMERA';
  t.d.getElementById('rh-photo-check-ag1').textContent = '✓ Photo exploitable';
  await t.T.employeePhotoSaved('ag1');
  assert.equal(t.T.employeePhotoSource.ag1, undefined);
  assert.equal(t.d.getElementById('rh-photo-check-ag1').textContent, '');
  assert.equal(t.d.getElementById('rh-facial-ref-ag1').dataset.state, 'PROCESSING');
  assert.equal(timers.length, 1);
  timers.shift()(); await tick();
  assert.equal(t.d.getElementById('rh-facial-ref-ag1').dataset.state, 'PROCESSING');
  timers.shift()(); await tick();
  assert.equal(t.d.getElementById('rh-facial-ref-ag1').dataset.state, 'READY');
  assert.equal(timers.length, 0, 'plus aucune relecture une fois le résultat connu');
  assert.equal(t.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/facial-reference')).length, 3);
  assert.equal(t.calls.some((c) => c.method !== 'GET'), false, 'le frontend ne déclenche aucun traitement : il lit seulement l\'état');
  t.dom.window.close();
});

test('relecture bornée, et arrêtée si la fiche est quittée', async () => {
  const t = boot({ routes: { [REF]: [200, STATE('PROCESSING', 'Traitement en cours…', '…')] } });
  const timers = holdPolls(t.w);
  await t.T.loadEmployeeFacialReference('ag1');
  for (let i = 0; i < 40 && timers.length; i++) { timers.shift()(); await tick(); }
  const reads = t.calls.filter((c) => c.path.endsWith('/facial-reference')).length;
  assert.equal(reads, 21, '1 lecture + 20 relectures au plus');
  // Fiche quittée : la relecture en attente ne fait plus aucun appel.
  const u = boot({ routes: { [REF]: [200, STATE('PROCESSING', 'Traitement en cours…', '…')] } });
  const pending = holdPolls(u.w);
  await u.T.loadEmployeeFacialReference('ag1');
  u.d.getElementById('view').innerHTML = '';
  pending.shift()(); await tick();
  assert.equal(u.calls.filter((c) => c.path.endsWith('/facial-reference')).length, 1);
  t.dom.window.close(); u.dom.window.close();
});
