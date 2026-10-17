// Administration système — Gestion des équipements (terminaux, caméras, affectations)
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

const AVAIL = { ACTIVE: 'ONLINE', OFFLINE: 'OFFLINE', UNKNOWN: 'UNKNOWN', INACTIVE: 'OFFLINE', REVOKED: 'OFFLINE' };
const enrich = (i) => ({ type: i.kind === 'CAMERA' ? 'IP_CAMERA' : 'TABLET_ANDROID', type_label: i.kind === 'CAMERA' ? 'Caméra IP' : 'Tablette Android',
  admin_state: i.status === 'REVOKED' ? 'REVOKED' : i.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', availability: i.kind === 'CAMERA' ? 'UNKNOWN' : AVAIL[i.status] || 'UNKNOWN', ...i });
const DASH = (items) => ({ total: items.length, terminals: items.filter((i) => i.kind === 'TERMINAL').length, cameras: items.filter((i) => i.kind === 'CAMERA').length,
  admin_active: items.filter((i) => i.status === 'ACTIVE').length, admin_inactive: 0, admin_revoked: items.filter((i) => i.status === 'REVOKED').length,
  availability_online: 0, availability_offline: 0, availability_unknown: 0, unassigned: items.filter((i) => !(i.users || []).length).length, facial_enabled: 0 });

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
      if (url === '/biometrics/equipment') { const all = state.items.map(enrich); return { ok: true, status: 200, data: { items: all, dashboard: DASH(all), categories: CATEGORIES,
        filters: { societies: [...new Set(all.map((i) => i.society))], sites: [...new Map(all.map((i) => [i.site_id, [i.site_id, i.site]])).values()], types: [{ key: 'TABLET_ANDROID', label: 'Tablette Android' }, { key: 'IP_CAMERA', label: 'Caméra IP' }],
          states: [{ key: 'ACTIVE', label: 'Actif' }, { key: 'REVOKED', label: 'Révoqué' }], users: [{ id: 7, username: 'PTG01' }] } } }; }
      if (url === '/biometrics/equipment/accounts') return { ok: true, status: 200, data: [{ id: 7, username: 'PTG01', full_name: 'Poste 1', societies: ['Iron Global Securite'], equipment: ['trm:4'] }, { id: 8, username: 'PTG02', full_name: 'Poste 2', societies: [], equipment: [] }] };
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
  assert.match(fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8'), /\{label:"GESTION DES ÉQUIPEMENTS",route:"admin\/terminaux-faciaux",group:"IDENTITÉS & ACCÈS"\}/);
  const denied = boot({ system: false });
  await denied.open();
  assert.match(denied.text(denied.view), /Accès réservé Administration système/);
  assert.equal(denied.calls.length, 0);
});

test('liste : identifiant, nom, matériel, société, site, équipement, état, appairage, dernière communication, utilisateurs', async () => {
  const c = boot({ items: [KIOSK(), CAMERA(), KIOSK({ key: 'trm:5', id: 5, name: 'TAB NEUVE', paired: false, paired_at: null, status: 'INACTIVE', status_label: 'Inactif', users: [], last_communication: null }),
    KIOSK({ key: 'trm:6', id: 6, name: 'TAB PERDUE', status: 'REVOKED', status_label: 'Révoqué', revoked_reason: 'Vol', users: [] }),
    KIOSK({ key: 'trm:7', id: 7, name: 'TAB COUPEE', status: 'OFFLINE', status_label: 'Hors ligne', connection: 'LOST', connection_label: 'Connexion perdue' }),
    KIOSK({ key: 'trm:8', id: 8, name: 'TAB ANCIENNE', status: 'UNKNOWN', status_label: 'Sans signal', connection: 'SILENT', connection_label: 'Sans signal' })] });
  await c.open();
  assert.deepEqual([...c.view.querySelectorAll('thead th')].map((th) => th.textContent), ['', 'Équipement', 'Société', 'Site', 'État', 'Appairage', 'Disponibilité', 'Reconnaissance faciale', 'Utilisateurs affectés', 'Actions']);
  const row = (key) => c.text(c.view.querySelector(`[data-facial-row="${key}"]`));
  assert.match(row('trm:4'), /TAB HAMOUL 01 trm:4 · Tablette Android Galaxy Tab Iron Global Securite HAMOUL 01 Actif Appairé le 03\/10\/2026 \d\d:00 En ligne 09\/10\/2026 \d\d:00 Facial autorisé Autonome — surveillance seulement 1 compte PTG01/);
  assert.match(row('cam:9'), /CAM ENTREE cam:9 · Caméra IP Entrée principale.*Actif Enregistrée le.*Inconnue.*Activée depuis le poste Pointeur 0 compte/);
  assert.match(row('trm:5'), /Inactif Non appairé/); assert.match(row('trm:6'), /Révoqué Vol/);
  // Connexion réellement perdue ≠ borne sans battement de cœur (état inconnu).
  assert.match(row('trm:7'), /Hors ligne Connexion perdue Appairé/); assert.match(row('trm:8'), /Sans signal Sans signal — borne à recharger pour le suivi de connexion/);
  const actions = (key) => [...c.view.querySelectorAll(`[data-facial-row="${key}"] button`)].map((b) => b.textContent.replace(/^[^\wÀ-ÿ]+/, ''));
  assert.deepEqual(actions('trm:4'), ['Fiche', 'Utilisateurs autorisés', 'Modifier', 'Remplacer le matériel', 'Couper le pointage facial', 'Révoquer', 'Supprimer']);
  assert.deepEqual(actions('trm:5'), ['Fiche', 'Utilisateurs autorisés', 'Modifier', 'Appairer', 'Révoquer', 'Supprimer']);
  assert.deepEqual(actions('cam:9'), ['Fiche', 'Utilisateurs autorisés']);
  assert.deepEqual(actions('trm:6'), ['Fiche', 'Supprimer'], 'révoqué : fiche et suppression seulement');
  assert.equal(c.view.querySelector('[data-facial-row="trm:6"] .admin-equip-pick').disabled, true, 'un révoqué ne s\'affecte pas');
  assert.match(c.text(c.view.querySelector('#admin-equip-dashboard')), /Équipements 6 .*Actifs 2 .*Révoqués 1/);
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
  assert.deepEqual([...c.view.querySelectorAll('[data-facial-row="trm:4"] button')].map((b) => b.dataset.facialDelete).filter(Boolean), ['trm:4']);
  // Supprimer : annulation sans écriture, puis DELETE avec motif (historique conservé côté serveur).
  c.w.prompt = () => null;
  c.view.querySelector('[data-facial-delete="trm:4"]').click(); await wait();
  assert.notEqual(c.writes().at(-1).method, 'DELETE');
  c.w.prompt = () => ' Remplacée ';
  c.view.querySelector('[data-facial-delete="trm:4"]').click(); await wait(40);
  assert.deepEqual(c.writes().at(-1), { method: 'DELETE', url: '/biometrics/terminals/4', body: { reason: 'Remplacée' } });
});

test('contenu hostile échappé ; liste indisponible : erreur affichée, aucune donnée inventée', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const c = boot({ items: [KIOSK({ name: evil, site: evil, society: evil, equipment: evil, users: [{ id: 7, username: evil }] })] });
  await c.open();
  assert.equal(c.view.querySelectorAll('img').length, 0); assert.match(c.text(c.view), /<img src=x onerror=alert\(1\)>/);
  const down = boot({ routes: { 'GET /biometrics/equipment': { ok: false, status: 403, message: "Opération réservée à l'Administration Système" } } });
  await down.open();
  assert.match(down.text(down.view.querySelector('[role="alert"]')), /Opération réservée à l'Administration Système/);
  assert.equal(down.view.querySelectorAll('[data-facial-row]').length, 0);
});

// ── Gestion des équipements : tableau de bord, filtres, fiche, affectation groupée ──────────
test('tableau de bord, onglets Terminaux / Caméras et filtres', async () => {
  const c = boot({ items: [KIOSK(), CAMERA(), KIOSK({ key: 'trm:6', id: 6, name: 'TAB PERDUE', status: 'REVOKED', status_label: 'Révoqué', users: [] })] });
  await c.open();
  assert.match(c.text(c.view.querySelector('#admin-equip-dashboard')), /Équipements 3 Terminaux 2 Caméras 1 Actifs 2 .*Révoqués 1 .*Non affectés 2/);
  const keys = () => [...c.view.querySelectorAll('[data-facial-row]')].map((r) => r.dataset.facialRow);
  c.d.querySelector('[data-equip-tab="CAMERA"]').click();
  assert.deepEqual(keys(), ['cam:9']);
  c.d.querySelector('[data-equip-tab=""]').click();
  const pick = (id, value) => { const el = c.d.getElementById(id); el.value = value; el.dispatchEvent(new c.w.Event('change')); };
  pick('af-f-state', 'REVOKED'); assert.deepEqual(keys(), ['trm:6']);
  pick('af-f-state', ''); pick('af-f-user', '7'); assert.deepEqual(keys(), ['trm:4']);
  pick('af-f-user', ''); pick('af-f-type', 'IP_CAMERA'); assert.deepEqual(keys(), ['cam:9']);
  pick('af-f-type', ''); pick('af-f-society', 'Iron Global Securite'); assert.equal(keys().length, 3);
  assert.match(c.view.querySelector('#admin-equip-cameras').getAttribute('href'), /#\/cameras$/);
  assert.equal(c.writes().length, 0, 'filtrer n\'écrit rien');
});

test('fiche équipement : états séparés, autorisation faciale distincte, historique des affectations', async () => {
  const c = boot({ routes: { 'GET /biometrics/equipment/trm%3A4': { ok: true, status: 200, data: { ...enrich(KIOSK()), admin_state_label: 'Actif', pairing_label: 'Appairé', availability_label: 'En ligne', facial_authorization: true,
    capabilities: ['FACIAL_ATTENDANCE', 'HEARTBEAT'], history: [{ at: '2026-10-17T10:00:00Z', label: 'Affectations modifiées', by: 'ADMIN', result: 'success', added: ['PTG01'], removed: [] },
      { at: '2026-10-16T09:00:00Z', label: 'Enregistrement', by: 'ADMIN', result: 'success', added: [], removed: [] }] } } } });
  await c.open();
  c.view.querySelector('[data-equip-sheet="trm:4"]').click(); await wait();
  const sheet = c.text(c.modal());
  assert.match(sheet, /État administratif Actif Appairage Appairé Disponibilité En ligne .*Reconnaissance faciale Autorisée sur cet équipement Capacités Pointage facial, Signal de vie Utilisateurs affectés PTG01/);
  assert.match(c.text(c.d.getElementById('admin-equip-history')), /Affectations modifiées · par ADMIN \+ PTG01 .*Enregistrement · par ADMIN/);
  assert.doesNotMatch(c.modal().innerHTML, /public_key|fingerprint|pairing_code|10\.0\.0/);
});

test('affectation groupée : sélection, vérification serveur, confirmation — rien n\'est écrit avant', async () => {
  const pairs = [{ key: 'trm:4', device: 'TAB HAMOUL 01', user_id: 8, username: 'PTG02', allowed: true, change: true, code: null, message: 'Autorisé' },
    { key: 'cam:9', device: 'CAM ENTREE', user_id: 8, username: 'PTG02', allowed: true, change: true, code: null, message: 'Autorisé' }];
  const c = boot({ routes: { 'POST /biometrics/equipment/assignments/check': { ok: true, status: 200, data: { pairs, allowed: true, changes: 2 } },
    'POST /biometrics/equipment/assignments': { ok: true, status: 200, data: { changed: 2, items: [] } } } });
  await c.open();
  assert.equal(c.d.getElementById('admin-equip-assign').disabled, true, 'rien de coché : bouton inactif');
  c.view.querySelectorAll('.admin-equip-pick').forEach((box) => { box.checked = true; box.dispatchEvent(new c.w.Event('change')); });
  assert.match(c.text(c.d.getElementById('admin-equip-bulk')), /2 équipements sélectionnés/);
  c.d.getElementById('admin-equip-assign').click(); await wait();
  assert.deepEqual([...c.d.querySelectorAll('.admin-equip-user')].map((b) => b.value), ['7', '8']);
  assert.equal(c.d.getElementById('admin-equip-confirm').disabled, true, 'confirmation après vérification seulement');
  c.d.querySelectorAll('.admin-equip-user')[1].checked = true;
  c.d.getElementById('admin-equip-verify').click(); await wait();
  assert.deepEqual(c.writes().map((x) => x.url), ['/biometrics/equipment/assignments/check']);
  assert.match(c.text(c.d.getElementById('admin-equip-check')), /2 modification\(s\) prête\(s\).*TAB HAMOUL 01 → PTG02 : Autorisé/);
  c.d.getElementById('admin-equip-confirm').click(); await wait(40);
  assert.deepEqual(c.writes().at(-1), { method: 'POST', url: '/biometrics/equipment/assignments', body: { keys: ['trm:4', 'cam:9'], user_ids: [8], action: 'grant' } });
  assert.match(c.toasts.at(-1)[0], /2 affectation\(s\) enregistrée\(s\)/);
});

test('affectation refusée (hors périmètre) : motifs affichés, confirmation bloquée, aucun succès affiché', async () => {
  const refused = [{ key: 'trm:4', device: 'TAB HAMOUL 01', username: 'PTG02', code: 'OUT_OF_SCOPE', message: "Société ou site de l'équipement hors du périmètre du compte" }];
  const c = boot({ routes: { 'POST /biometrics/equipment/assignments/check': { ok: true, status: 200, data: { pairs: [{ ...refused[0], user_id: 8, allowed: false, change: false }], allowed: false, changes: 0 } } } });
  await c.open();
  const box = c.view.querySelector('.admin-equip-pick'); box.checked = true; box.dispatchEvent(new c.w.Event('change'));
  c.d.getElementById('admin-equip-assign').click(); await wait();
  c.d.querySelectorAll('.admin-equip-user')[1].checked = true;
  c.d.getElementById('admin-equip-verify').click(); await wait();
  assert.match(c.text(c.d.getElementById('admin-equip-check')), /Affectation impossible.*✗ TAB HAMOUL 01 → PTG02 : Société ou site de l'équipement hors du périmètre du compte/);
  assert.equal(c.d.getElementById('admin-equip-confirm').disabled, true);
  assert.equal(c.writes().filter((w) => w.url === '/biometrics/equipment/assignments').length, 0);
});

test('modifier un terminal : nom et emplacement par la route existante', async () => {
  const c = boot();
  await c.open();
  c.view.querySelector('[data-equip-edit="trm:4"]').click(); await wait();
  c.d.getElementById('ae-name').value = ' TAB HAMOUL 02 '; c.d.getElementById('ae-loc').value = 'Guérite nord';
  await c.w.adminEquipSave('trm:4'); await wait();
  assert.deepEqual(c.writes().at(-1), { method: 'PATCH', url: '/biometrics/terminals/4', body: { name: 'TAB HAMOUL 02', location: 'Guérite nord' } });
});
