// Administration système — Terminaux de reconnaissance faciale
// (app/static/js/modules/administration-facial-terminals.js) : le module s'exécute tel quel dans
// un DOM jsdom ; seuls le réseau et les fonctions globales du shell ATLAS sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULES = path.join(__dirname, '../app/static/js/modules');
const SRC = fs.readFileSync(path.join(MODULES, 'administration-facial-terminals.js'), 'utf8');
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const KIOSK = (extra = {}) => ({ key: 'trm:4', kind: 'TERMINAL', id: 4, name: 'TAB HAMOUL 01', hardware: 'Tablette Android', category: 'MOBILE_KIOSK', society: 'Iron Global Securite',
  site_id: 12, site: 'HAMOUL 01', equipment: 'Galaxy Tab', status: 'ACTIVE', status_label: 'Actif', paired: true, paired_at: '2026-10-03T09:00:00Z', pairing: 'DEVICE_KEY',
  last_communication: '2026-10-09T13:00:00Z', facial_attendance_enabled: true, remote_activation: false, users: [{ id: 7, username: 'PTG01', full_name: 'Poste 1', is_active: true }], ...extra });
const CAMERA = (extra = {}) => ({ key: 'cam:9', kind: 'CAMERA', id: 9, name: 'CAM ENTREE', hardware: 'DAHUA IPC', category: 'IP_CAMERA', society: 'Iron Global Securite', site_id: 12, site: 'HAMOUL 01',
  equipment: 'Entrée principale', status: 'ACTIVE', status_label: 'Actif', paired: true, paired_at: '2026-09-28T08:00:00Z', pairing: 'REGISTRATION', last_communication: null,
  facial_attendance_enabled: true, remote_activation: true, users: [], ...extra });
const CATEGORIES = [{ key: 'MOBILE_KIOSK', label: 'Terminal mobile autonome', supported: true, remote_activation: false }, { key: 'IP_CAMERA', label: 'Caméra IP lue par le serveur', supported: true, remote_activation: true },
  { key: 'NETWORK_STANDALONE', label: 'Terminal réseau autonome à reconnaissance embarquée', supported: false, remote_activation: false }, { key: 'LOCAL_CAMERA', label: 'Caméra USB ou intégrée du poste Pointeur', supported: false, remote_activation: false }];

function boot({ items = [KIOSK(), CAMERA()], system = true, routes = {} } = {}) {
  const dom = new JSDOM('<!doctype html><div id="view"></div><div id="modal-host"></div>', { runScripts: 'dangerously', url: 'https://atlas.irongs.com/' });
  const w = dom.window, d = w.document;
  const calls = [], toasts = [];
  const state = { items };
  Object.assign(w, {
    SGDIModules: { registered: [], registerModule(m) { this.registered.push(m); } },
    escapeHTML: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    isAdminSystemSession: () => system, adminCaptureView: () => () => true,
    openModal: (html) => { d.getElementById('modal-host').innerHTML = html; }, closeModal: () => { d.getElementById('modal-host').innerHTML = ''; },
    toast: (msg, type) => toasts.push([msg, type || 'info']), confirm: () => true, prompt: () => 'Tablette perdue',
    renderView: () => w.renderAdminFacialTerminals(d.getElementById('view')),
    agentRemoteCall: async (method, url, body) => {
      calls.push({ method, url, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
      const route = routes[`${method} ${url}`];
      if (route) return typeof route === 'function' ? route(body, state) : route;
      if (url === '/biometrics/facial-devices') return { ok: true, status: 200, data: { items: state.items, kpi: { active: state.items.filter((i) => i.status === 'ACTIVE').length, inactive: 0, offline: 0, revoked: state.items.filter((i) => i.status === 'REVOKED').length }, categories: CATEGORIES } };
      if (url.startsWith('/biometrics/facial-devices/users')) return { ok: true, status: 200, data: [{ id: 7, username: 'PTG01', full_name: 'Poste 1' }, { id: 8, username: 'PTG02', full_name: 'Poste 2' }] };
      if (url === '/portal/attendance-sites') return { ok: true, status: 200, data: [{ id: 12, name: 'HAMOUL 01', society: 'Iron Global Securite' }, { id: 13, name: 'DEPOT EST', society: 'Sword Corporation' }] };
      if (url.endsWith('/pairing-code')) return { ok: true, status: 200, data: { code: 'ABCDE-FGHJK', expires_in: 600 } };
      if (method === 'POST' && url === '/biometrics/terminals') return { ok: true, status: 200, data: { id: 31 } };
      return { ok: true, status: 200, data: {} };
    },
  });
  w.eval(SRC);
  const view = d.getElementById('view');
  const text = (el) => (el ? el.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '');
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { w, d, view, calls, toasts, state, text, writes, modal: () => d.getElementById('modal-host'), open: () => w.renderAdminFacialTerminals(view) };
}

test('module enregistré comme dépendance d\'Administration, route réservée au compte Administration système', async () => {
  const c = boot();
  assert.deepEqual(c.w.SGDIModules.registered.map((m) => m.key), ['administration-facial-terminals']);
  assert.match(fs.readFileSync(path.join(MODULES, 'administration.js'), 'utf8'), /"administration-beo","administration-facial-terminals"\]/);
  const router = fs.readFileSync(path.join(MODULES, 'administration-users.js'), 'utf8');
  assert.match(router, /if\(sub==="terminaux-faciaux"\)return renderAdminFacialTerminals\(view\);/);
  assert.match(router, /const systemOnly=\["terminaux-faciaux",/);
  assert.match(fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8'), /\{label:"TERMINAUX FACIAUX",route:"admin\/terminaux-faciaux",group:"IDENTITÉS & ACCÈS"\}/);
  const denied = boot({ system: false });
  await denied.open();
  assert.match(denied.text(denied.view), /Accès réservé Administration système/);
  assert.equal(denied.calls.length, 0);
});

test('liste : identifiant, nom, matériel, société, site, équipement, état, appairage, dernière communication, utilisateurs', async () => {
  const c = boot({ items: [KIOSK(), CAMERA(), KIOSK({ key: 'trm:5', id: 5, name: 'TAB NEUVE', paired: false, paired_at: null, status: 'INACTIVE', status_label: 'Inactif', users: [], last_communication: null }),
    KIOSK({ key: 'trm:6', id: 6, name: 'TAB PERDUE', status: 'REVOKED', status_label: 'Révoqué', revoked_reason: 'Vol', users: [] })] });
  await c.open();
  assert.deepEqual([...c.view.querySelectorAll('thead th')].map((th) => th.textContent), ['Terminal', 'Société', 'Site', 'Équipement', 'État', 'Appairage', 'Dernière communication', 'Utilisateurs autorisés', 'Actions']);
  const row = (key) => c.text(c.view.querySelector(`[data-facial-row="${key}"]`));
  assert.match(row('trm:4'), /TAB HAMOUL 01 trm:4 · Tablette Android Iron Global Securite HAMOUL 01 Galaxy Tab Autonome — surveillance seulement Actif Appairé le 03\/10\/2026 \d\d:00 09\/10\/2026 \d\d:00 1 compte PTG01/);
  assert.match(row('cam:9'), /CAM ENTREE cam:9 · DAHUA IPC.*Activée depuis le poste Pointeur Actif Enregistrée le.*0 compte/);
  assert.match(row('trm:5'), /Inactif Non appairé/); assert.match(row('trm:6'), /Révoqué Vol/);
  const actions = (key) => [...c.view.querySelectorAll(`[data-facial-row="${key}"] button`)].map((b) => b.textContent.replace(/^[^\wÀ-ÿ]+/, ''));
  assert.deepEqual(actions('trm:4'), ['Utilisateurs autorisés', 'Remplacer le matériel', 'Couper le pointage facial', 'Révoquer']);
  assert.deepEqual(actions('trm:5'), ['Utilisateurs autorisés', 'Appairer', 'Révoquer']);
  assert.deepEqual(actions('cam:9'), ['Utilisateurs autorisés']);
  assert.deepEqual(actions('trm:6'), [], 'révoqué : plus aucune action');
  assert.match(c.text(c.view.querySelector('#admin-facial-kpi')), /2 actif\(s\).*1 révoqué\(s\)/);
  assert.match(c.text(c.view), /Non pris en charge Terminal réseau autonome.*Non pris en charge Caméra USB ou intégrée du poste Pointeur/);
  // Jamais de secret ni d'adresse d'équipement à l'écran.
  assert.doesNotMatch(c.view.innerHTML, /public_key|fingerprint|password|rtsp|10\.0\.0/i);
});

test('enregistrer puis appairer : création, code à usage unique affiché une fois, jamais stocké', async () => {
  const c = boot();
  await c.open();
  c.view.querySelector('#admin-facial-add').click(); await wait();
  assert.deepEqual([...c.d.querySelectorAll('#af-site option')].map((o) => o.textContent), ['— Choisir —', 'HAMOUL 01 — Iron Global Securite', 'DEPOT EST — Sword Corporation']);
  const set = (id, v) => { c.d.getElementById(id).value = v; };
  assert.deepEqual([...c.d.querySelectorAll('#af-type option')].map((o) => o.value), ['TABLET_ANDROID', 'SMARTPHONE_ANDROID', 'IPAD', 'IPHONE']);
  set('af-name', '  TAB DEPOT 02 '); set('af-type', 'SMARTPHONE_ANDROID'); set('af-site', '13'); set('af-loc', 'Poste de garde');
  await c.w.adminFacialCreate(); await wait();
  assert.deepEqual(c.writes()[0], { method: 'POST', url: '/biometrics/terminals', body: { name: 'TAB DEPOT 02', terminal_type: 'SMARTPHONE_ANDROID', site_id: 13, location: 'Poste de garde' } });
  assert.deepEqual(c.writes()[1], { method: 'POST', url: '/biometrics/terminals/31/pairing-code', body: undefined });
  assert.equal(c.d.getElementById('admin-facial-code').textContent, 'ABCDE-FGHJK');
  assert.match(c.text(c.modal()), /une seule fois sur l'appareil.*aucun nouvel appairage n'est demandé — ni à la connexion du Pointeur, ni à l'activation/);
  assert.equal(c.w.localStorage.length + c.w.sessionStorage.length, 0, 'le code n\'est conservé nulle part');
});

test('remplacer le matériel : confirmation, même route d\'association, autorisations conservées ; refus = aucune écriture', async () => {
  const c = boot();
  await c.open();
  const asked = [];
  c.w.confirm = (msg) => { asked.push(msg); return false; };
  c.view.querySelector('[data-facial-pair="trm:4"]').click(); await wait();
  assert.equal(c.writes().length, 0); assert.match(asked[0], /Remplacer le matériel.*clé actuelle restera valable.*utilisateurs autorisés sont conservés/s);
  c.w.confirm = () => true;
  c.view.querySelector('[data-facial-pair="trm:4"]').click(); await wait();
  assert.deepEqual(c.writes().map((x) => x.url), ['/biometrics/terminals/4/pairing-code']);
});

test('utilisateurs autorisés : seuls les comptes éligibles renvoyés par le serveur, enregistrement de la liste complète', async () => {
  const c = boot();
  await c.open();
  c.view.querySelector('[data-facial-users="trm:4"]').click(); await wait();
  assert.equal(c.calls.at(-1).url, '/biometrics/facial-devices/users?key=trm%3A4');
  const boxes = [...c.d.querySelectorAll('.admin-facial-user')];
  assert.deepEqual(boxes.map((b) => [b.value, b.checked]), [['7', true], ['8', false]]);
  boxes[1].checked = true;
  c.d.getElementById('admin-facial-users-save').click(); await wait();
  assert.deepEqual(c.writes().at(-1), { method: 'POST', url: '/biometrics/facial-devices/authorizations', body: { key: 'trm:4', user_ids: [7, 8] } });
  assert.equal(c.modal().innerHTML, '');
});

test('compte hors périmètre refusé par le serveur : erreur visible, fenêtre conservée, rien d\'optimiste', async () => {
  const c = boot({ routes: { 'POST /biometrics/facial-devices/authorizations': { ok: false, status: 422, message: 'Hors périmètre Société/Site ou compte non éligible : PTG02' } } });
  await c.open();
  c.view.querySelector('[data-facial-users="cam:9"]').click(); await wait();
  c.d.querySelectorAll('.admin-facial-user')[1].checked = true;
  c.d.getElementById('admin-facial-users-save').click(); await wait();
  assert.deepEqual(c.toasts.at(-1), ['Hors périmètre Société/Site ou compte non éligible : PTG02', 'error']);
  assert.ok(c.d.getElementById('admin-facial-users-save'), 'fenêtre toujours ouverte');
  assert.match(c.text(c.view.querySelector('[data-facial-row="cam:9"]')), /0 compte/);
});

test('révoquer : motif obligatoire, effet relu depuis le serveur ; couper le facial : PATCH exact', async () => {
  const c = boot({ routes: { 'POST /biometrics/terminals/4/revoke': (body, state) => { state.items = [KIOSK({ status: 'REVOKED', status_label: 'Révoqué', revoked_reason: body.reason, users: [] }), CAMERA()]; return { ok: true, status: 200, data: {} }; } } });
  await c.open();
  c.w.prompt = () => 'ab';
  c.view.querySelector('[data-facial-revoke="trm:4"]').click(); await wait();
  assert.equal(c.writes().length, 0); assert.deepEqual(c.toasts.at(-1), ['Motif trop court', 'error']);
  c.w.prompt = () => null;
  c.view.querySelector('[data-facial-revoke="trm:4"]').click(); await wait();
  assert.equal(c.writes().length, 0, 'annuler ne révoque rien');
  c.view.querySelector('[data-facial-toggle="trm:4"]').click(); await wait();
  assert.deepEqual(c.writes().at(-1), { method: 'PATCH', url: '/biometrics/terminals/4', body: { facial_attendance_enabled: false } });
  c.w.prompt = () => '  Tablette perdue ';
  c.view.querySelector('[data-facial-revoke="trm:4"]').click(); await wait(40);
  assert.deepEqual(c.writes().at(-1), { method: 'POST', url: '/biometrics/terminals/4/revoke', body: { reason: 'Tablette perdue' } });
  assert.match(c.text(c.view.querySelector('[data-facial-row="trm:4"]')), /Révoqué Tablette perdue/);
  assert.equal(c.view.querySelectorAll('[data-facial-row="trm:4"] button').length, 0);
});

test('contenu hostile échappé ; liste indisponible : erreur affichée, aucune donnée inventée', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const c = boot({ items: [KIOSK({ name: evil, site: evil, society: evil, equipment: evil, users: [{ id: 7, username: evil }] })] });
  await c.open();
  assert.equal(c.view.querySelectorAll('img').length, 0); assert.match(c.text(c.view), /<img src=x onerror=alert\(1\)>/);
  const down = boot({ routes: { 'GET /biometrics/facial-devices': { ok: false, status: 403, message: "Opération réservée à l'Administration Système" } } });
  await down.open();
  assert.match(down.text(down.view.querySelector('[role="alert"]')), /Opération réservée à l'Administration Système/);
  assert.equal(down.view.querySelectorAll('[data-facial-row]').length, 0);
});
