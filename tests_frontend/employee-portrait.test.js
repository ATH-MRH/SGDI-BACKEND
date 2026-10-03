// Fiche de position — portrait de présentation (photo d'identité, fond blanc) dans l'en-tête.
// Vrai sgdi-app.js (vraie fonction de rendu de la fiche) dans jsdom ; seul le réseau est simulé.
// Le portrait est un DÉRIVÉ servi par une route authentifiée ; la photo SOURCE reste celle de
// l'« Aperçu » ; tout échec affiche la photo source, sans bloquer la fiche.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['renderAgentForm', 'loadEmployeePortrait', 'employeeCurrentPhotoSrc', 'openAgentPhotoPreview', 'employeePortraitEligible'];
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SOURCE = '/uploads/photos/K162-3f9a.jpg';
const PORTRAIT = 'GET /api/drh/employees/42/portrait';

function boot({ agent = {}, routes = {} } = {}) {
  const ctx = loadSgdiApp(NAMES);
  assert.ifError(ctx.loadError);
  const { window } = ctx, T = ctx.T(), d = window.document;
  const a = { id: 'ag1', backendId: 42, nom: 'OUALI', prenom: 'Amine', matricule: 'K162', photo: SOURCE, statut: 'actif', ...agent };
  // Collections absentes = vides (la fiche lit de nombreuses collections secondaires).
  T.setDb(new Proxy({ agents: [a], sites: [], users: [], settings: {} }, { get: (o, k) => ((k in o) || typeof k !== 'string' ? o[k] : (o[k] = [])) }));
  T.setSession({ username: 'DRH01', role: 'agent', transverse: 'drh' });
  window.sessionStorage.setItem('ficheContext', 'drh');
  window.sessionStorage.setItem('sgdi_api_token_v1', 'tok');
  const calls = [];
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://drh.irongs.com');
    const call = { key: `${opts.method || 'GET'} ${u.pathname}`, auth: (opts.headers || {}).authorization };
    calls.push(call);
    const found = routes[call.key] || [200, {}];
    const [status, data, headers] = typeof found === 'function' ? await found(call) : found;
    return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), blob: async () => ({ size: 9, type: 'image/jpeg' }),
      headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } };
  };
  let n = 0;
  window.URL.createObjectURL = () => `blob:portrait-${++n}`;
  window.URL.revokeObjectURL = () => {};
  return { ...ctx, T, d, a, calls, w: window, zone: () => d.getElementById('rh-erp-photo-ag1'), img: () => d.querySelector('#rh-erp-photo-ag1 img'),
    portraitCalls: () => calls.filter((c) => c.key === PORTRAIT) };
}

function render(t) {
  const view = t.d.getElementById('view');
  t.T.renderAgentForm(view, 'ag1');
  assert.ok(t.zone(), 'en-tête de la fiche rendu');
}

test('en-tête : cadre 3:4 blanc, photo source masquée le temps du portrait, puis portrait dérivé authentifié', async () => {
  const t = boot({ routes: { [PORTRAIT]: [200, null, { 'x-portrait-method': 'SEGMENTED' }] } });
  render(t);
  assert.ok(t.zone().classList.contains('has-photo') && t.zone().classList.contains('is-portrait-pending'));
  assert.equal(t.img().getAttribute('src'), SOURCE);
  assert.equal(t.img().className, 'rh-portrait-img');
  assert.equal(t.img().getAttribute('alt'), 'Photo de Amine OUALI');
  await tick();
  assert.equal(t.portraitCalls().length, 1);
  assert.equal(t.portraitCalls()[0].auth, 'Bearer tok', 'route authentifiée, jamais une URL publique');
  assert.equal(t.img().getAttribute('src'), 'blob:portrait-1');
  assert.ok(t.zone().classList.contains('is-portrait') && !t.zone().classList.contains('is-portrait-pending'));
  assert.equal(t.zone().dataset.portrait, 'SEGMENTED');
  // « Aperçu » : la photo SOURCE, jamais le portrait détouré.
  assert.equal(t.T.employeeCurrentPhotoSrc('ag1'), SOURCE);
  t.T.openAgentPhotoPreview('ag1');
  assert.equal(t.d.getElementById('photo-preview-img').getAttribute('src'), SOURCE);
  t.dom.window.close();
});

test('portrait indisponible (404, erreur serveur, réseau, trop lent) : photo source affichée, fiche intacte', async () => {
  for (const reply of [[404, { detail: 'x' }], [500, {}], () => { throw new TypeError('Failed to fetch'); }]) {
    const t = boot({ routes: { [PORTRAIT]: reply } });
    render(t);
    await tick();
    assert.ok(t.zone().classList.contains('is-portrait-fallback') && !t.zone().classList.contains('is-portrait-pending'));
    assert.equal(t.img().getAttribute('src'), SOURCE);
    t.dom.window.close();
  }
  const slow = boot({ routes: { [PORTRAIT]: () => new Promise(() => {}) } });
  const real = slow.w.setTimeout.bind(slow.w), held = [];
  slow.w.setTimeout = (fn, ms, ...r) => (ms === 4000 ? held.push(fn) : real(fn, ms, ...r));
  render(slow);
  await tick();
  assert.ok(slow.zone().classList.contains('is-portrait-pending'));
  held.forEach((fn) => fn());
  assert.ok(slow.zone().classList.contains('is-portrait-fallback'), 'au-delà de 4 s : la photo source s\'affiche');
  slow.dom.window.close();
});

test('photo non enregistrée (data:), photo absente : aucune requête de portrait', async () => {
  const unsaved = boot({ agent: { photo: 'data:image/jpeg;base64,/9j/AAAA' } });
  render(unsaved);
  assert.equal(unsaved.zone().classList.contains('is-portrait-pending'), false);
  await tick();
  assert.equal(unsaved.portraitCalls().length, 0);
  assert.ok(unsaved.zone().classList.contains('is-portrait-fallback'));
  unsaved.dom.window.close();
  const none = boot({ agent: { photo: '' } });
  render(none);
  await tick();
  assert.equal(none.portraitCalls().length, 0);
  assert.equal(none.img(), null);
  assert.match(none.zone().textContent, /PHOTO/, 'avatar existant conservé');
  assert.equal(none.zone().classList.contains('has-photo'), false);
  none.dom.window.close();
});

test('la fiche change pendant le chargement : le portrait d\'une autre photo n\'est jamais appliqué', async () => {
  let release;
  const t = boot({ routes: { [PORTRAIT]: () => new Promise((r) => { release = () => r([200, null, {}]); }) } });
  render(t);
  await tick();
  t.a.photo = '/uploads/photos/K162-nouvelle.jpg';                       // nouvelle photo enregistrée entre-temps
  release(); await tick();
  assert.notEqual(t.img().getAttribute('src'), 'blob:portrait-1');
  t.dom.window.close();
});
