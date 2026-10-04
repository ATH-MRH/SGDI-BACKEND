// Exécute la vraie page ; seuls les appels réseau et les dialogues navigateur sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const NOW = Date.parse('2026-10-03T12:00:00Z');
const iso = (age = 0) => new Date(NOW - age).toISOString();
const sites = [{ id: 3, name: 'DHL HAMOUL 01', society: 'IRON GLOBAL SOLUTION' }, { id: 4, name: 'Oran', society: 'IRON SÉCURITÉ' }];
const terminal = (id, over = {}) => ({
  id, terminal_id: 'trm_public_' + id, name: 'TABLETTTE HAMOUL 01', terminal_type: 'TABLET_ANDROID',
  society: sites[0].society, site_id: 3, site: sites[0].name, location: 'PCS02', enabled: true,
  facial_attendance_enabled: false, paired: true, paired_at: '2026-10-03T10:44:00Z',
  key_fingerprint: 'abcd1234abcd1234', pairing_pending: false, pairing_expires_at: null,
  last_seen_at: iso(5000), revoked_at: null, revoked_reason: null, config_version: 2,
  device_label: 'Mozilla/5.0 (Linux; Android 13; SM-X210) AppleWebKit/537.36 Chrome/120.0.0.0', ...over,
});
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, label = 'condition') {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Délai dépassé : ' + label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await nextTurn();
}

function boot(t, { records = [terminal(1)], routes = {}, list } = {}) {
  const calls = [], errors = [], confirms = [], prompts = [];
  let current = records.map((r) => ({ ...r }));
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/#/terminals', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) {
      w.Date.now = () => NOW;
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'test-session');
      w.confirm = (message) => { confirms.push(message); return true; };
      w.prompt = (message) => { prompts.push(message); return null; };
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, w.location.origin);
        const call = { path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
        calls.push(call);
        let result;
        const route = routes[call.method + ' ' + call.path] || routes[call.path];
        if (route) result = typeof route === 'function' ? await route(call) : route;
        else if (call.path === '/api/auth/me') result = [200, { username: 'ADM', full_name: 'Administrateur' }];
        else if (call.path === '/api/attendance/sites') result = [200, sites];
        else if (call.path === '/api/biometrics/terminals' && call.method === 'GET') result = list ? await list(call) : [200, current.filter((r) => (call.query.include_deleted || !r.deleted_at) && (!call.query.site_id || String(r.site_id) === call.query.site_id))];
        else if (call.path === '/api/biometrics/terminals' && call.method === 'POST') {
          const created = terminal(900, { ...call.body, paired: false, key_fingerprint: null, last_seen_at: null, device_label: null });
          current.push(created); result = [200, created];
        } else if (/\/terminals\/\d+$/.test(call.path) && call.method === 'PATCH') {
          const record = current.find((r) => r.id === Number(call.path.split('/').at(-1)));
          Object.assign(record, call.body); result = [200, record];
        } else if (/\/terminals\/\d+$/.test(call.path) && call.method === 'DELETE') {
          const record = current.find((r) => r.id === Number(call.path.split('/').at(-1)));
          Object.assign(record, { deleted_at: iso(), deleted_by: 'ADM', enabled: false, paired: false });
          result = [200, record];
        } else if (call.path.endsWith('/pairing-code')) result = [200, { code: 'ABCDE-FGHJK', expires_in: 600, pair_path: '/borne#pair=ABCDEFGHIJ' }];
        else if (call.path.endsWith('/audit')) result = [200, [{ at: iso(), action: 'biometrics.terminal.pair', result: 'success', state: null, matricule: null, reason: 'Association validée' }]];
        else if (call.path.endsWith('/revoke')) {
          const record = current.find((r) => r.id === Number(call.path.split('/').at(-2)));
          Object.assign(record, { revoked_at: iso(), revoked_reason: call.body.reason, enabled: false, facial_attendance_enabled: false, paired: false });
          result = [200, record];
        } else if (/\/sites\/\d+\/facial-disable$/.test(call.path)) {
          current.filter((r) => r.site_id === Number(call.path.split('/').at(-2))).forEach((r) => { r.facial_attendance_enabled = false; });
          result = [200, { disabled_terminals: 1, disabled_cameras: 0 }];
        } else result = [404, { detail: 'Route de test inattendue : ' + call.path }];
        const [status, data] = result;
        return { ok: status < 400, status, text: async () => JSON.stringify(data) };
      };
    },
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'aucune erreur JavaScript non gérée'); });
  const d = dom.window.document, w = dom.window;
  const ctx = {
    d, w, calls, confirms, prompts,
    row: (id) => d.querySelector('[data-terminal-id="' + id + '"]'),
    rows: () => [...d.querySelectorAll('#terminal-rows [data-terminal-id]')],
    kpi: (key) => d.querySelector('#terminal-kpis [data-terminal-kpi="' + key + '"]').textContent.trim(),
    set: (id, value, event = 'change') => { d.getElementById(id).value = value; d.getElementById(id).dispatchEvent(new w.Event(event, { bubbles: true })); },
    click: (selector) => { const button = d.querySelector(selector); assert.ok(button, selector); button.click(); },
    listCalls: () => calls.filter((c) => c.path === '/api/biometrics/terminals' && c.method === 'GET'),
    writes: () => calls.filter((c) => c.method !== 'GET'),
  };
  ctx.ready = () => waitFor(() => ctx.listCalls().length > 0 && !/Chargement/.test(d.getElementById('terminal-state').textContent), 'chargement des terminaux');
  return ctx;
}

test('deux appareils réels : KPI calculés, types distincts, version explicite et états indépendants', async (t) => {
  const c = boot(t, { records: [terminal(1), terminal(2, { name: 'SMARTPHONE HAMOUL 01', terminal_type: 'SMARTPHONE_ANDROID', location: 'PCS01', facial_attendance_enabled: true, device_label: 'Mozilla/5.0 (Linux; Android 10; K) SamsungBrowser/21.0 Chrome/120.0' })] });
  await c.ready();
  assert.deepEqual(['total', 'active', 'inactive', 'pairing', 'sites'].map(c.kpi), ['2', '2', '0', '0', '1']);
  assert.match(c.row(1).textContent, /TABLETTTE HAMOUL 01.*PCS02/s);
  assert.match(c.row(1).textContent, /Tablette.*Android.*Samsung/s);
  assert.match(c.row(1).textContent, /Android 13/);
  assert.match(c.row(1).textContent, /Facial désactivé/);
  assert.match(c.row(2).textContent, /Smartphone.*Android/s);
  assert.match(c.row(2).textContent, /Android 10/);
  assert.match(c.row(2).textContent, /Facial actif/);
  assert.match(c.row(1).textContent, /03\/10\/2026/);
  assert.equal(c.d.getElementById('terminal-prev').disabled, true);
  assert.equal(c.d.getElementById('terminal-next').disabled, true);
  assert.match(c.d.getElementById('terminal-count').textContent, /2.*2/);
});

test('KPI multi-sites : inactifs/révoqués, association absente ou rotation en attente, aucun chiffre fixe', async (t) => {
  const c = boot(t, { records: [terminal(1), terminal(2, { enabled: false, paired: false }), terminal(3, { pairing_pending: true }), terminal(4, { revoked_at: iso(), enabled: false, paired: false }), terminal(5, { site_id: 4, site: sites[1].name, society: sites[1].society, paired: false })] });
  await c.ready();
  assert.deepEqual(['total', 'active', 'inactive', 'pairing', 'sites'].map(c.kpi), ['5', '3', '2', '3', '2']);
  assert.match(c.row(2).textContent, /Inactif/);
  assert.match(c.row(4).textContent, /Révoqué/);
  assert.equal(c.row(4).querySelectorAll('button').length, 2);
  assert.ok(c.row(4).querySelector('[data-term-audit="4"]'));
});

test('état en ligne : règle serveur 20 secondes incluses, absent/invalide/futur/révoqué hors ligne', async (t) => {
  const ages = [0, 20000, 20001, null, 'invalid', -1];
  const c = boot(t, { records: [...ages.map((age, i) => terminal(i + 1, { last_seen_at: age === null ? null : age === 'invalid' ? 'date invalide' : iso(age) })), terminal(7, { revoked_at: iso() })] });
  await c.ready();
  for (const id of [1, 2]) assert.match(c.row(id).textContent, /En ligne/);
  for (const id of [3, 4, 5, 6, 7]) assert.match(c.row(id).textContent, /Hors ligne/);
  const server = fs.readFileSync(path.join(__dirname, '../app/modules/biometrics/remote_capture.py'), 'utf8');
  assert.match(server, /ONLINE_SECONDS\s*=\s*20\b/, 'le seuil UI doit suivre le contrat serveur');
});

test('métadonnées absentes : pas de version Android ni Samsung inventés, iPhone/iPad conservés', async (t) => {
  const c = boot(t, { records: [terminal(1, { device_label: null }), terminal(2, { terminal_type: 'IPHONE', device_label: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1' }), terminal(3, { terminal_type: 'IPAD', device_label: null })] });
  await c.ready();
  assert.doesNotMatch(c.row(1).textContent, /Samsung|Android \d/);
  assert.match(c.row(2).textContent, /iPhone/);
  assert.match(c.row(3).textContent, /iPad/);
  assert.doesNotMatch(c.row(2).textContent, /Android/);
});

test('Samsung Browser ne prouve pas le constructeur du terminal Android', async (t) => {
  const c = boot(t, { records: [terminal(1, { terminal_type: 'SMARTPHONE_ANDROID', device_label: 'Mozilla/5.0 (Linux; Android 10; K) SamsungBrowser/21.0 Chrome/120.0' })] });
  await c.ready();
  assert.doesNotMatch(c.row(1).querySelector('[data-label="Type"]').textContent, /Samsung/);
  assert.match(c.row(1).querySelector('[data-label="Association"]').textContent, /Android · Samsung Browser/);
  assert.match(c.row(1).querySelector('[data-label="Type"]').textContent, /Android 10/);
});

test('recherche instantanée sans accents : nom, code, site, société, type ; filtrage sans nouvel appel', async (t) => {
  const c = boot(t, { records: [terminal(1, { name: 'Écran Entrée', location: 'CODE-A' }), terminal(2, { name: 'Téléphone Oran', terminal_type: 'SMARTPHONE_ANDROID', site_id: 4, site: 'Port Oran', society: 'IRON SÉCURITÉ', location: 'CODE-B', device_label: null })] });
  await c.ready(); const initialCalls = c.calls.length;
  for (const query of ['ecran', 'code-a', 'DHL HAMOUL', 'GLOBAL SOLUTION', 'tablette']) {
    c.set('terminal-q', query, 'input');
    assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['1'], query);
  }
  c.set('terminal-q', 'securite', 'input'); assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['2']);
  c.set('terminal-q', '', 'input'); c.set('terminal-type', 'SMARTPHONE_ANDROID');
  assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['2']);
  c.set('terminal-type', 'TABLET_ANDROID'); assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['1']);
  c.set('terminal-type', ''); assert.equal(c.rows().length, 2);
  c.set('terminal-q', 'introuvable', 'input'); assert.equal(c.rows().length, 0);
  assert.match(c.d.getElementById('terminal-rows').textContent, /aucun/i);
  assert.equal(c.kpi('total'), '2', 'KPI du périmètre, indépendants du filtre local');
  assert.equal(c.calls.length, initialCalls, 'recherche et types ne déclenchent aucun appel API');
});

test('1003 terminaux : rendu paginé, navigation et tailles 10/25/50 sans full-render ni API supplémentaire', async (t) => {
  const records = Array.from({ length: 1003 }, (_, i) => terminal(i + 1, { name: 'Terminal ' + (i + 1), terminal_type: i % 2 ? 'SMARTPHONE_ANDROID' : 'TABLET_ANDROID', site_id: i % 2 ? 4 : 3 }));
  const c = boot(t, { records }); await c.ready(); const initialCalls = c.calls.length;
  assert.equal(c.kpi('total'), '1003'); assert.equal(c.rows().length, 10);
  assert.deepEqual(c.rows().map((r) => Number(r.dataset.terminalId)), Array.from({ length: 10 }, (_, i) => i + 1));
  c.click('#terminal-next'); assert.deepEqual(c.rows().map((r) => Number(r.dataset.terminalId)), Array.from({ length: 10 }, (_, i) => i + 11));
  c.click('#terminal-prev'); assert.equal(c.rows()[0].dataset.terminalId, '1');
  c.set('terminal-page-size', '25'); assert.equal(c.rows().length, 25);
  c.set('terminal-page-size', '50'); assert.equal(c.rows().length, 50);
  for (let i = 0; i < 20; i++) c.click('#terminal-next');
  assert.equal(c.rows().length, 3); assert.equal(c.rows()[0].dataset.terminalId, '1001');
  assert.equal(c.d.getElementById('terminal-next').disabled, true);
  c.set('terminal-type', 'SMARTPHONE_ANDROID'); assert.equal(c.rows()[0].dataset.terminalId, '2', 'un filtre revient à la première page');
  assert.equal(c.calls.length, initialCalls);
});

test('périmètre changé puis 403 : données, KPI et coupure de site anciens disparaissent', async (t) => {
  const c = boot(t, { list: (call) => call.query.site_id === '4' ? [403, { detail: 'Permission biométrique explicite requise' }] : [200, [terminal(1, { facial_attendance_enabled: true })]] });
  await c.ready(); c.set('f-site', '3'); await c.ready();
  assert.equal(c.d.getElementById('site-facial-off-terminals').classList.contains('hidden'), false);
  c.set('f-site', '4'); await c.ready();
  assert.equal(c.rows().length, 0); assert.notEqual(c.kpi('total'), '1');
  assert.equal(c.d.getElementById('site-facial-off-terminals').classList.contains('hidden'), true);
  assert.match(c.d.getElementById('terminal-state').textContent, /Permission biométrique/);
  assert.equal(c.listCalls().at(-1).query.site_id, '4');
});

test('actions après pagination et recherche : aucun mauvais identifiant terminal envoyé', async (t) => {
  const c = boot(t, { records: Array.from({ length: 27 }, (_, i) => terminal(i + 1, { name: 'Borne ' + (i + 1), location: 'POSTE-' + (i + 1) })) });
  await c.ready(); c.click('#terminal-next');
  c.w.prompt = () => 'Borne onze renommée'; c.click('[data-term-rename="11"]');
  await waitFor(() => c.row(11)?.textContent.includes('Borne onze renommée'));
  assert.deepEqual(c.writes().map((call) => ({ path: call.path, body: call.body })), [{ path: '/api/biometrics/terminals/11', body: { name: 'Borne onze renommée' } }]);
  c.set('terminal-q', 'POSTE-27', 'input'); assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['27']);
  c.click('[data-term-audit="27"]'); await waitFor(() => c.d.getElementById('audit-close'));
  assert.equal(c.calls.at(-1).path, '/api/biometrics/terminals/27/audit');
  assert.match(c.d.querySelector('.modal h3').textContent, /Borne 27/);
  assert.equal(c.writes().length, 1);
});

test('réponses réseau inversées : un ancien site ne remplace jamais le nouveau périmètre', async (t) => {
  let finishOld;
  const c = boot(t, { list: (call) => call.query.site_id === '3' ? new Promise((resolve) => { finishOld = resolve; }) : [200, [terminal(call.query.site_id === '4' ? 4 : 1, { site_id: Number(call.query.site_id || 3) })]] });
  await c.ready(); c.set('f-site', '3'); await waitFor(() => finishOld);
  assert.equal(c.rows().length, 0, 'ancien périmètre effacé dès le début du chargement');
  c.set('f-site', '4'); await c.ready(); assert.ok(c.row(4));
  finishOld([200, [terminal(3)]]); await nextTurn(); await nextTurn();
  assert.deepEqual(c.rows().map((r) => r.dataset.terminalId), ['4']);
  assert.equal(c.d.getElementById('terminal-state').textContent.trim(), '');
});

test('ancienne erreur réseau ignorée après la réussite du nouveau site', async (t) => {
  let finishOld;
  const c = boot(t, { list: (call) => call.query.site_id === '3' ? new Promise((resolve) => { finishOld = resolve; }) : [200, [terminal(4)]] });
  await c.ready(); c.set('f-site', '3'); await waitFor(() => finishOld);
  c.set('f-site', '4'); await c.ready(); finishOld([403, { detail: 'ANCIEN SITE REFUSÉ' }]);
  await nextTurn(); await nextTurn(); assert.ok(c.row(4));
  assert.doesNotMatch(c.d.getElementById('terminal-state').textContent, /ANCIEN/);
});

test('contenu hostile échappé et secrets ignorés : seules les empreintes hexadécimales sûres sont affichées', async (t) => {
  const evil = '<img src=x onerror="alert(1)">';
  const c = boot(t, { records: [terminal(1, { name: evil, location: evil, site: evil, society: evil, terminal_type: evil, key_fingerprint: evil, device_label: evil,
    public_key: 'SECRET_PUBLIC_KEY_PAYLOAD', pairing_code_hash: 'SECRET_PAIRING_HASH', private_key: 'SECRET_PRIVATE_KEY', token: 'SECRET_TOKEN' }),
  terminal(2, { key_fingerprint: '1234567890abcdefdeadbeefdeadbeef', device_label: 'Linux Chrome/120.0' }),
  terminal(3, { key_fingerprint: '1234567890abcdef' })] });
  await c.ready();
  assert.equal(c.d.querySelectorAll('#terminal-rows img').length, 0);
  assert.equal(c.d.querySelectorAll('#terminal-rows [onerror]').length, 0);
  assert.match(c.row(1).textContent, /<img src=x/);
  assert.doesNotMatch(c.d.getElementById('terminal-rows').innerHTML, /SECRET_PUBLIC_KEY_PAYLOAD|SECRET_PAIRING_HASH|SECRET_PRIVATE_KEY|SECRET_TOKEN|deadbeef/);
  assert.doesNotMatch(c.row(2).textContent, /1234567890abcdef/, 'une empreinte hors contrat est ignorée plutôt que divulguée');
  assert.match(c.row(3).textContent, /1234567890abcdef/);
});

test('actions icônes : boutons clavier nommés, audit lecture seule et fermeture sans mutation', async (t) => {
  const c = boot(t); await c.ready();
  for (const key of ['pair', 'facial', 'enable', 'rename', 'audit', 'revoke', 'delete']) {
    const button = c.row(1).querySelector('[data-term-' + key + ']');
    assert.ok(button); assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button');
    assert.ok(button.getAttribute('aria-label')); assert.ok(button.getAttribute('title'));
  }
  c.click('[data-term-audit="1"]'); await waitFor(() => c.d.getElementById('audit-close'));
  assert.match(c.d.querySelector('.modal').textContent, /Association validée/);
  c.click('#audit-close'); assert.equal(c.d.querySelector('.modal'), null); assert.equal(c.writes().length, 0);
});

test('annuler les confirmations sensibles ne déclenche aucune mutation', async (t) => {
  const c = boot(t); await c.ready();
  c.w.confirm = () => false;
  for (const key of ['pair', 'facial', 'enable']) c.click('[data-term-' + key + '="1"]');
  c.w.prompt = () => null; c.click('[data-term-rename="1"]'); c.click('[data-term-revoke="1"]');
  c.w.prompt = () => 'ab'; c.click('[data-term-revoke="1"]');
  await nextTurn(); assert.equal(c.writes().length, 0);
});

test('facial et activation : PATCH exacts, confirmations conservées, états renvoyés reflétés', async (t) => {
  const c = boot(t); await c.ready();
  c.click('[data-term-facial="1"]'); await waitFor(() => c.row(1)?.textContent.includes('Facial actif'));
  assert.match(c.confirms.at(-1), /pointage facial RÉEL/);
  assert.deepEqual(c.writes().at(-1).body, { facial_attendance_enabled: true });
  c.click('[data-term-facial="1"]'); await waitFor(() => c.row(1)?.textContent.includes('Facial désactivé'));
  assert.deepEqual(c.writes().at(-1).body, { facial_attendance_enabled: false });
  c.click('[data-term-enable="1"]'); await waitFor(() => c.row(1)?.textContent.includes('Inactif'));
  assert.match(c.confirms.at(-1), /Effet immédiat/); assert.deepEqual(c.writes().at(-1).body, { enabled: false });
  c.click('[data-term-enable="1"]'); await waitFor(() => c.kpi('active') === '1');
  assert.deepEqual(c.writes().at(-1).body, { enabled: true });
});

test('ré-associer, renommer et révoquer utilisent les routes et motifs existants', async (t) => {
  const c = boot(t); await c.ready();
  c.click('[data-term-pair="1"]'); await waitFor(() => c.d.getElementById('pair-code'));
  assert.match(c.confirms.at(-1), /clé actuelle restera valable/);
  assert.equal(c.d.getElementById('pair-code').textContent, 'ABCDE-FGHJK');
  c.click('#pair-close'); await c.ready(); assert.equal(c.d.getElementById('pair-code'), null);
  c.w.prompt = () => '  Nouveau terminal  '; c.click('[data-term-rename="1"]');
  await waitFor(() => c.row(1)?.textContent.includes('Nouveau terminal'));
  assert.deepEqual(c.writes().at(-1).body, { name: 'Nouveau terminal' });
  c.w.prompt = () => '  Appareil perdu  '; c.click('[data-term-revoke="1"]');
  await waitFor(() => c.row(1)?.textContent.includes('Révoqué'));
  assert.deepEqual(c.writes().at(-1), { path: '/api/biometrics/terminals/1/revoke', method: 'POST', query: {}, body: { reason: 'Appareil perdu' } });
  assert.equal(c.row(1).querySelectorAll('button').length, 2);
});

test('création smartphone : données saisies inchangées, aucun facial implicite, association proposée', async (t) => {
  const c = boot(t); await c.ready(); c.click('#terminal-add'); await waitFor(() => c.d.getElementById('term-form'));
  c.set('t-name', 'SMARTPHONE HAMOUL 01'); c.set('t-type', 'SMARTPHONE_ANDROID'); c.set('t-site', '4'); c.set('t-loc', 'PCS01');
  c.d.getElementById('term-form').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
  await waitFor(() => c.d.getElementById('pair-code'));
  assert.deepEqual(c.writes().find((x) => x.path === '/api/biometrics/terminals').body, { name: 'SMARTPHONE HAMOUL 01', terminal_type: 'SMARTPHONE_ANDROID', site_id: 4, location: 'PCS01' });
  assert.ok(c.writes().some((x) => x.path === '/api/biometrics/terminals/900/pairing-code'));
});

test('coupure faciale du site conservée, confirmée et toujours liée au site sélectionné', async (t) => {
  const c = boot(t, { records: [terminal(1, { facial_attendance_enabled: true })] }); await c.ready();
  c.set('f-site', '3'); await c.ready();
  c.w.confirm = () => false; c.click('#site-facial-off-terminals'); assert.equal(c.writes().length, 0);
  c.w.confirm = () => true; c.click('#site-facial-off-terminals');
  await waitFor(() => c.row(1)?.textContent.includes('Facial désactivé'));
  assert.ok(c.writes().some((x) => x.path === '/api/biometrics/sites/3/facial-disable'));
});

test('mutation refusée par RBAC : erreur visible, aucun état optimiste ni action de contournement', async (t) => {
  const c = boot(t, { routes: { 'PATCH /api/biometrics/terminals/1': [403, { detail: 'Permission biométrique explicite requise' }] } });
  await c.ready(); const previousLists = c.listCalls().length;
  c.click('[data-term-enable="1"]'); await waitFor(() => c.d.querySelector('.toast.err'));
  assert.match(c.d.querySelector('.toast.err').textContent, /Permission biométrique/);
  assert.equal(c.kpi('active'), '1'); assert.equal(c.listCalls().length, previousLists);
  assert.deepEqual(c.writes().map((x) => x.path), ['/api/biometrics/terminals/1']);
});

test('périmètre vide puis actualisation : zéro KPI, boutons de page désactivés, un seul GET supplémentaire', async (t) => {
  const c = boot(t, { records: [] }); await c.ready();
  assert.deepEqual(['total', 'active', 'inactive', 'pairing', 'sites'].map(c.kpi), ['0', '0', '0', '0', '0']);
  assert.equal(c.d.getElementById('terminal-prev').disabled, true); assert.equal(c.d.getElementById('terminal-next').disabled, true);
  const before = c.listCalls().length; c.click('#terminal-refresh'); await c.ready();
  assert.equal(c.listCalls().length, before + 1); assert.equal(c.writes().length, 0);
});

 test('suppression confirmée : disparition immédiate, KPI et archive ; annulation sans mutation', async (t) => {
  const c = boot(t, { records: [terminal(1), terminal(2)] }); await c.ready();
  c.click('[data-term-delete="1"]');
  assert.match(c.d.querySelector('.modal').textContent, /historique sera conservé/);
  c.click('#terminal-delete-cancel'); assert.equal(c.writes().length, 0);
  c.click('[data-term-delete="1"]'); const lists = c.listCalls().length;
  c.click('#terminal-delete-confirm'); c.click('#terminal-delete-confirm');
  await waitFor(() => !c.row(1));
  assert.equal(c.kpi('total'), '1'); assert.equal(c.kpi('active'), '1');
  assert.equal(c.listCalls().length, lists);
  assert.equal(c.writes().filter(x => x.method === 'DELETE').length, 1);
  c.click('#terminal-archive'); await waitFor(() => c.d.querySelector('.modal'));
  await waitFor(() => /ADM/.test(c.d.querySelector('.modal').textContent));
  assert.match(c.d.querySelector('.modal').textContent, /trm_public_1/);
});
 test('suppression refusée : ligne et compteurs conservés', async (t) => {
  const c = boot(t, { routes: { 'DELETE /api/biometrics/terminals/1': [403, { detail: 'Interdit' }] } }); await c.ready();
  c.click('[data-term-delete="1"]'); c.click('#terminal-delete-confirm');
  await waitFor(() => c.d.getElementById('terminal-delete-error').textContent);
  assert.ok(c.row(1)); assert.equal(c.kpi('total'), '1');
  assert.equal(c.d.getElementById('terminal-delete-confirm').disabled, false);
});
