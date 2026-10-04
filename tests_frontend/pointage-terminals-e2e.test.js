// Real local API + Chrome contract for the terminal administration UI.
// No production host, session, camera, biometric engine or attendance event is used.
// npm run test:pointage-terminals-e2e
// Optional: ATLAS_E2E_PYTHON, PUPPETEER_EXECUTABLE_PATH,
// ATLAS_TERMINALS_E2E_PORT, ATLAS_TERMINALS_E2E_ARTIFACTS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_TERMINALS_E2E_PORT || 8968);
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = process.env.ATLAS_TERMINALS_E2E_ARTIFACTS || path.join(os.tmpdir(), 'atlas-pointage-terminals-e2e');
const PASSWORD = 'TerminalUiLocal!2026';
const OPERATOR = 'terminal-ui-operator';
const VIEWER = 'terminal-ui-reader';
const SOCIETY = 'IRON GLOBAL SOLUTION';
const OTHER_SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find(file => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* explicit skip below */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(endpoint, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: response.status, data };
}

async function replaceInput(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await page.type(selector, value);
}

async function loginPage(page, username = OPERATOR) {
  await page.goto(BASE + '/static/pointage/index.html', { waitUntil: 'domcontentloaded' });
  await page.type('#login-user', username);
  await page.type('#login-pass', PASSWORD);
  await page.click('#login-btn');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  await page.click('[data-view="terminals"]');
  await page.waitForSelector('#terminal-rows tr[data-terminal-id]', { timeout: 15000 });
}

async function terminalRows(page) {
  return page.$$eval('#terminal-rows tr[data-terminal-id]', rows => rows.map(row => ({ id: Number(row.dataset.terminalId), text: row.innerText })));
}

async function changeAndWait(page, act, expected) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/biometrics/terminals' && r.request().method() === 'GET' && r.status() === 200);
  await act();
  await response;
  await page.waitForFunction(count => document.querySelectorAll('#terminal-rows tr[data-terminal-id]').length === count, {}, expected);
}

async function pairInChrome(page, record, token, slot) {
  const code = (await api(`/biometrics/terminals/${record.id}/pairing-code`, { token, method: 'POST' })).data.code;
  const jwk = await page.evaluate(async slot => {
    window.terminalKeys ||= {};
    const keys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify']);
    window.terminalKeys[slot] = keys;
    return crypto.subtle.exportKey('jwk', keys.publicKey);
  }, slot);
  assert.equal((await api('/biometrics/terminal/pair', {method:'POST',body:{code,public_key:jwk,device_label:'Chrome lifecycle test'}})).status,200);
  return jwk;
}
async function signedSession(page, record, slot) {
  return page.evaluate(async ({id,slot}) => {
    const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const timestamp = String(Date.now()), path = '/api/biometrics/terminal/session';
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array()))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const message = ['ATLAS-TERMINAL-1',id,'GET',path,timestamp,digest].join('\n');
    const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},window.terminalKeys[slot].privateKey,new TextEncoder().encode(message));
    return (await fetch(path,{headers:{'X-Atlas-Terminal':id,'X-Atlas-Timestamp':timestamp,'X-Atlas-Signature':b64(signature)}})).status;
  },{id:record.terminal_id,slot});
}

test('Gestion du pointage — terminaux : E2E réel, permissions et responsive', {
  timeout: 180000,
  skip: !CHROME ? 'Chrome absent (PUPPETEER_EXECUTABLE_PATH)' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas_terminal_ui_'));
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, DATABASE_URL: `sqlite:///${path.join(tmp, 'e2e.db')}`,
    APP_ENV: 'test', JWT_SECRET: 'terminal-ui-e2e-local-only-secret-2026',
    ADMIN_SYSTEM_USERNAME: 'terminal-ui-bootstrap', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOG_LEVEL: 'ERROR', LOGIN_MAX_ATTEMPTS: '1000000',
    STARTUP_MAINTENANCE_ENABLED: 'false', BIOMETRIC_ENABLED: 'false', BIOMETRIC_TEST_MODE_ENABLED: 'false',
    BIOMETRIC_MODELS_DIR: '/nonexistent', BIOMETRIC_TEMPLATE_KEY: 'ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=' };
  const py = code => execFileSync(PYTHON, ['-c', 'import app.main\n' + code], { cwd: ROOT, env }).toString().trim().split('\n').pop();
  const logFd = fs.openSync(path.join(ARTIFACTS, 'server.log'), 'w');
  const server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT, env, stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  let browser, page, token, viewerToken, ids;
  const errors = [], requests = [], measurements = [];
  t.after(async () => {
    fs.writeFileSync(path.join(ARTIFACTS, 'measurements.json'), JSON.stringify(measurements, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, 'requests.json'), JSON.stringify(requests, null, 2));
    if (browser) await browser.close().catch(() => {});
    if (server.exitCode === null) {
      const stopped = once(server, 'exit');
      server.kill();
      await Promise.race([stopped, delay(3000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test('serveur réel et jeu multi-sociétés / multi-sites (16 terminaux)', async () => {
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) {
      try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { /* starting */ }
      if (!ready) await delay(300);
    }
    assert.ok(ready, 'serveur non prêt : consulter ' + path.join(ARTIFACTS, 'server.log'));
    ids = JSON.parse(py(`
import app.main, json
from datetime import datetime, timedelta
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.ops.models import Site
from app.modules.biometrics.models import BiometricTerminal
s = SessionLocal()
sites = [Site(name="DHL FORWARDING / HAMOUL 01 (40K)", active=1, equipment_plan={"societe": "${SOCIETY}"}),
         Site(name="ORAN LOGISTIQUE", active=1, equipment_plan={"societe": "${SOCIETY}"}),
         Site(name="ALGER SECURITE", active=1, equipment_plan={"societe": "${OTHER_SOCIETY}"})]
s.add_all(sites); s.flush()
for name, allowed_sites, societies, admin in (("${OPERATOR}", [x.id for x in sites], ["${SOCIETY}", "${OTHER_SOCIETY}"], True),
                                            ("${VIEWER}", [sites[0].id], ["${SOCIETY}"], False)):
    u = User(username=name, full_name="Administrateur local" if admin else "Lecteur HAMOUL", role="ops", access_level="H3", is_active=True,
             password_hash=hash_password("${PASSWORD}"), validation_password_hash=hash_password("unused"), authorized_structures=[],
             authorized_societies=societies, authorized_sites=allowed_sites, authorized_modules=["pointage"],
             authorized_actions=["read", "create", "update", "validate", "delete"] if admin else ["read"])
    s.add(u); s.flush()
    s.add(UserFeaturePermission(user_id=u.id, module_key="attendance", feature_key="biometric_status", action_key="read"))
    if admin:
        for action in ("validate", "admin"):
            s.add(UserFeaturePermission(user_id=u.id, module_key="attendance", feature_key="biometric_admin", action_key=action))
now = datetime.utcnow()
rows = []
for i in range(16):
    site = sites[0 if i < 2 else 1 if i < 12 else 2]
    name = ["SMARTPHONE HAMOUL 01", "TABLETTTE HAMOUL 01"][i] if i < 2 else "TERMINAL SITE %02d" % i
    kind = ["SMARTPHONE_ANDROID", "TABLET_ANDROID", "IPHONE", "IPAD"][i % 4]
    paired = i not in (4, 5)
    label = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36" if i == 0 else "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
    term = BiometricTerminal(public_id="trm_ui_local_%02d" % i, name=name, terminal_type=kind,
        society="${OTHER_SOCIETY}" if i >= 12 else "${SOCIETY}", site_id=site.id,
        location="PCS%02d" % (i + 1), enabled=i not in (2, 3, 15), facial_attendance_enabled=i in (0, 1, 6),
        public_key={"kty": "EC", "crv": "P-256", "x": "TEST_PUBLIC_X_NOT_EXPOSED", "y": "TEST_PUBLIC_Y_NOT_EXPOSED"} if paired and i != 15 else None,
        key_fingerprint="fce14e3dec9d537f" + "a" * 48 if paired else None,
        pairing_code_hash="TEST_PAIRING_HASH_NOT_EXPOSED" if i == 4 else None,
        pairing_expires_at=now + timedelta(minutes=10) if i == 4 else None,
        paired_at=now - timedelta(days=2) if paired else None, last_seen_at=now if i == 0 else now - timedelta(hours=2),
        revoked_at=now - timedelta(days=1) if i == 15 else None, revoked_reason="Terminal de test remplacé" if i == 15 else None,
        config_version=1, meta={"device_label": label}, created_by="${OPERATOR}")
    s.add(term); rows.append(term)
s.commit()
print(json.dumps({"sites": [x.id for x in sites], "phone": rows[0].id, "tablet": rows[1].id, "other": rows[12].id, "revoked": rows[15].id}))
`));
    for (const username of [OPERATOR, VIEWER]) {
      const result = await api('/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      if (username === OPERATOR) token = result.data.access_token;
      else viewerToken = result.data.access_token;
    }
    const list = await api('/biometrics/terminals', { token });
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 16);
    assert.equal(new Set(list.data.map(row => row.site_id)).size, 3);
    assert.equal(new Set(list.data.map(row => row.society)).size, 2);
    assert.doesNotMatch(JSON.stringify(list.data), /TEST_PUBLIC_[XY]_NOT_EXPOSED|TEST_PAIRING_HASH_NOT_EXPOSED|"public_key"|"pairing_code_hash"/);
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'), args: ['--no-first-run'] });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(request.url()).pathname, query: new URL(request.url()).search, method: request.method() }); });
    await loginPage(page);
  });

  await t.test('deux terminaux HAMOUL, états réels, audit lecture seule et actions accessibles', async () => {
    await changeAndWait(page, () => page.select('#f-site', String(ids.sites[0])), 2);
    py(`from datetime import datetime
from app.db.session import SessionLocal
from app.modules.biometrics.models import BiometricTerminal
s=SessionLocal(); s.get(BiometricTerminal, ${ids.phone}).last_seen_at=datetime.utcnow(); s.commit(); print("ok")`);
    await changeAndWait(page, () => page.click('#terminal-refresh'), 2);
    const text = await page.$eval('#view-terminals', el => el.innerText);
    assert.match(text, /TABLETTTE HAMOUL 01/);
    assert.match(text, /SMARTPHONE HAMOUL 01/);
    assert.match(text, /PCS01/); assert.match(text, /PCS02/);
    assert.match(text, /En ligne/); assert.match(text, /Hors ligne/);
    assert.match(text, /Facial actif/);
    assert.match(text, /Android 10/);
    assert.doesNotMatch(text, /Android 13/, 'aucune version Android inventée pour la tablette Linux');
    const kpis = await page.$$eval('#terminal-kpis strong[data-terminal-kpi]', els => Object.fromEntries(els.map(el => [el.dataset.terminalKpi, Number(el.textContent)])));
    assert.deepEqual(kpis, { total: 2, active: 2, inactive: 0, pairing: 0, sites: 1 });
    const labels = await page.$$eval(`tr[data-terminal-id="${ids.phone}"] .terminal-action`, els => els.map(el => ({ label: el.getAttribute('aria-label'), title: el.getAttribute('title'), tag: el.tagName, disabled: el.disabled })));
    assert.equal(labels.length, 7);
    assert.ok(labels.every(item => item.label && item.title && item.tag === 'BUTTON' && !item.disabled));
    const before = (await api('/biometrics/terminals', { token })).data;
    await page.focus(`[data-term-audit="${ids.phone}"]`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#audit-close');
    assert.match(await page.$eval('.modal', el => el.innerText), /Audit — SMARTPHONE HAMOUL 01/);
    await page.click('#audit-close');
    assert.deepEqual((await api('/biometrics/terminals', { token })).data, before, 'audit ne modifie aucun terminal');
    const nav = await page.$$eval('aside nav', els => els.map(el => el.textContent).join('\n'));
    assert.match(nav, /Mode Test facial/);
    assert.equal(await page.$$eval('#logout-btn', els => els.length), 1);
  });

  await t.test('recherche, type et pagination côté frontend sans requêtes par terminal', async () => {
    await changeAndWait(page, () => page.select('#f-site', ''), 10);
    const networkBefore = requests.length;
    await replaceInput(page, '#terminal-q', 'HAMOUL');
    assert.equal((await terminalRows(page)).length, 2);
    await page.select('#terminal-type', 'TABLET_ANDROID');
    assert.deepEqual((await terminalRows(page)).map(row => row.id), [ids.tablet]);
    await page.select('#terminal-type', '');
    assert.equal((await terminalRows(page)).length, 2);
    for (const [query, count] of [['PCS01', 1], ['ORAN', 10], [OTHER_SOCIETY, 4], ['Smartphone Android', 4]]) {
      await replaceInput(page, '#terminal-q', query);
      assert.equal((await terminalRows(page)).length, count, query);
    }
    await replaceInput(page, '#terminal-q', 'aucun-resultat-unique');
    assert.equal((await terminalRows(page)).length, 0);
    await replaceInput(page, '#terminal-q', '');
    const firstPage = (await terminalRows(page)).map(row => row.id);
    assert.equal(firstPage.length, 10);
    await page.click('#terminal-next');
    const nextPage = (await terminalRows(page)).map(row => row.id);
    assert.equal(nextPage.length, 6);
    assert.equal(new Set([...firstPage, ...nextPage]).size, 16, 'aucun terminal dupliqué ou perdu entre pages');
    assert.equal(await page.$eval('#terminal-next', el => el.disabled), true);
    await page.click('#terminal-prev');
    assert.deepEqual((await terminalRows(page)).map(row => row.id), firstPage);
    await page.select('#terminal-page-size', '25');
    assert.equal((await terminalRows(page)).length, 16);
    await page.select('#terminal-page-size', '50');
    assert.equal((await terminalRows(page)).length, 16);
    await page.select('#terminal-page-size', '10');
    await delay(500);
    assert.equal(requests.length, networkBefore, 'recherche, filtre et pagination ne font aucun appel API');
    const list = (await api('/biometrics/terminals', { token })).data;
    const kpis = await page.$$eval('#terminal-kpis strong[data-terminal-kpi]', els => Object.fromEntries(els.map(el => [el.dataset.terminalKpi, Number(el.textContent)])));
    assert.equal(kpis.total, list.length);
    assert.equal(kpis.sites, 3);
    assert.equal(kpis.active + kpis.inactive, list.length);
    assert.match(await page.$eval('#terminal-rows', el => el.innerText), /Inactif/);
    assert.match(await page.$eval('#terminal-rows', el => el.innerText), /Facial désactivé/);
  });

  await t.test('Chrome : 1440, 1280, 1024, 800, 768, 430, 390 px', async () => {
    await changeAndWait(page, () => page.select('#f-site', String(ids.sites[0])), 2);
    const issues = [];
    for (const width of [1440, 1280, 1024, 800, 768, 430, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measure = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right }; };
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
          overflowing: [...document.querySelectorAll('body *')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.right > innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
          }).slice(0, 20).map(el => ({ tag: el.tagName, id: el.id, className: el.getAttribute('class'), parent: el.parentElement?.tagName + '#' + (el.parentElement?.id || '') + '.' + (el.parentElement?.getAttribute('class') || ''), ...rect(el) })),
          rows: [...document.querySelectorAll('#terminal-rows tr[data-terminal-id]')].map(el => ({ id: el.dataset.terminalId, ...rect(el), text: el.innerText })),
          actions: [...document.querySelectorAll('#terminal-rows .terminal-action')].map(el => ({ label: el.getAttribute('aria-label'), ...rect(el) })) };
      });
      measurements.push(measure);
      fs.writeFileSync(path.join(ARTIFACTS, 'measurements.json'), JSON.stringify(measurements, null, 2));
      await page.screenshot({ path: path.join(ARTIFACTS, `terminals-${width}.png`), fullPage: true });
      if (measure.documentWidth > width + 1 || measure.bodyWidth > width + 1) issues.push(`débordement global à ${width}px : ${JSON.stringify(measure.overflowing)}`);
      if (measure.rows.length !== 2 || !measure.rows.every(row => row.width >= 240 && /HAMOUL/.test(row.text) && /PCS0[12]/.test(row.text))) issues.push(`contenu terminal incomplet à ${width}px`);
      if (!measure.actions.every(action => action.width >= 30 && action.height >= 30)) issues.push(`actions non utilisables à ${width}px`);
      if (width <= 800 && !measure.rows.every(row => row.right <= width + 1)) issues.push(`carte terminal déborde à ${width}px`);
    }
    await page.setViewport({ width: 1440, height: 1000 });
    assert.deepEqual(issues, []);
    assert.deepEqual(errors, []);
  });

  await t.test('actions conservées sur SQLite jetable : confirmations, ré-association, facial, activation, renommage, création et révocation', async () => {
    const before = (await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone);
    let dialogs = [];
    const dismiss = async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); };
    page.on('dialog', dismiss);
    const requestCount = requests.length;
    await page.click(`[data-term-enable="${ids.phone}"]`);
    await page.click(`[data-term-pair="${ids.phone}"]`);
    await page.click(`[data-term-revoke="${ids.phone}"]`);
    await delay(100);
    page.off('dialog', dismiss);
    assert.equal(dialogs.length, 3, 'confirmations sensibles conservées');
    assert.equal(requests.length, requestCount, 'annulation ne déclenche aucune écriture');
    assert.deepEqual((await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone), before);
    const accept = async dialog => { await dialog.accept(); };
    page.on('dialog', accept);
    await changeAndWait(page, () => page.click(`[data-term-enable="${ids.phone}"]`), 2);
    assert.equal((await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone).enabled, false);
    await changeAndWait(page, () => page.click(`[data-term-enable="${ids.phone}"]`), 2);
    assert.equal((await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone).enabled, true);
    for (const enabled of [false, true]) {
      await changeAndWait(page, () => page.click(`[data-term-facial="${ids.phone}"]`), 2);
      assert.equal((await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone).facial_attendance_enabled, enabled);
    }
    await page.click(`[data-term-pair="${ids.phone}"]`);
    await page.waitForSelector('#pair-code');
    assert.match(await page.$eval('#pair-code', el => el.textContent.replace(/-/g, '')), /^[A-Z0-9]{10}$/);
    await changeAndWait(page, () => page.click('#pair-close'), 2);
    page.off('dialog', accept);
    page.once('dialog', dialog => dialog.accept('SMARTPHONE HAMOUL 01 RENOMME'));
    await changeAndWait(page, () => page.click(`[data-term-rename="${ids.phone}"]`), 2);
    assert.equal((await api('/biometrics/terminals', { token })).data.find(row => row.id === ids.phone).name, 'SMARTPHONE HAMOUL 01 RENOMME');
    await page.click('#terminal-add');
    await page.waitForSelector('#term-form');
    await page.type('#t-name', 'SMARTPHONE HAMOUL 01');
    await page.select('#t-type', 'SMARTPHONE_ANDROID');
    await page.select('#t-site', String(ids.sites[0]));
    await page.type('#t-loc', 'POSTE TEST');
    await page.click('#term-form button[type="submit"]');
    await page.waitForSelector('#pair-close');
    await changeAndWait(page, () => page.click('#pair-close'), 3);
    const created = (await api('/biometrics/terminals', { token })).data.find(row => row.name === 'SMARTPHONE HAMOUL 01');
    assert.ok(created);
    assert.equal(created.facial_attendance_enabled, false);
    assert.equal(created.terminal_type, 'SMARTPHONE_ANDROID');
    const oldKey = await pairInChrome(page, created, token, 'old');
    assert.equal(await signedSession(page, created, 'old'), 200);
    page.once('dialog', dialog => dialog.accept('Révocation terminal E2E jetable'));
    await changeAndWait(page, () => page.click(`[data-term-revoke="${created.id}"]`), 3);
    const revoked = (await api('/biometrics/terminals', { token })).data.find(row => row.id === created.id);
    assert.ok(revoked.revoked_at);
    assert.equal(revoked.enabled, false);
    assert.equal(await page.$$eval(`tr[data-terminal-id="${created.id}"] .terminal-action`, els => els.length), 2, 'terminal révoqué : audit et suppression');
    await page.click(`[data-term-audit="${created.id}"]`);
    await page.waitForSelector('#audit-close');
    assert.match(await page.$eval('.modal', el => el.innerText), /create/);
    assert.match(await page.$eval('.modal', el => el.innerText), /revoke/);
    await page.click('#audit-close');
    await page.click(`[data-term-delete="${created.id}"]`);
    await page.waitForSelector('#terminal-delete-confirm');
    await page.type('#terminal-delete-reason', 'Remplacement E2E');
    await page.click('#terminal-delete-confirm');
    await page.waitForFunction(id => !document.querySelector(`[data-terminal-id="${id}"]`), {}, created.id);
    assert.ok(!(await api('/biometrics/terminals', { token })).data.some(row => row.id === created.id));
    const archived = (await api('/biometrics/terminals?include_deleted=true', { token })).data.find(row => row.id === created.id);
    assert.ok(archived.deleted_at);
    assert.equal(await signedSession(page, created, 'old'), 401);
    assert.match(JSON.stringify((await api(`/biometrics/terminals/${created.id}/audit`, { token })).data), /terminal.delete/);
    await page.click('#terminal-add'); await page.waitForSelector('#term-form');
    await page.type('#t-name', created.name); await page.select('#t-type', created.terminal_type);
    await page.select('#t-site', String(created.site_id)); await page.click('#term-form button[type="submit"]');
    await page.waitForSelector('#pair-close'); await page.click('#pair-close');
    const recreated = (await api('/biometrics/terminals', { token })).data.find(row => row.name === created.name);
    assert.ok(recreated); assert.notEqual(recreated.id, created.id); assert.notEqual(recreated.terminal_id, created.terminal_id);
    const newKey = await pairInChrome(page, recreated, token, 'new');
    assert.notDeepEqual(newKey, oldKey);
    assert.equal(await signedSession(page, recreated, 'new'), 200);
    assert.equal(await signedSession(page, created, 'old'), 401);
    assert.equal(await signedSession(page, recreated, 'old'), 401);
    await page.click('#terminal-archive'); await page.waitForSelector('#terminal-archive-close');
    assert.match(await page.$eval('.modal', el => el.innerText), new RegExp(created.terminal_id));
    await page.click(`[data-deleted-audit="${created.id}"]`); await page.waitForSelector('#audit-close');
    assert.match(await page.$eval('.modal', el => el.innerText), /delete/);
    await page.screenshot({path:path.join(ARTIFACTS,'terminal-deleted-audit.png'),fullPage:true});
    await page.click('#audit-close');
    await page.screenshot({ path: path.join(ARTIFACTS, 'terminal-recreated.png'), fullPage: true });
    assert.equal(py('from app.db.session import SessionLocal\nfrom app.modules.attendance.models import AttendanceEvent\nprint(SessionLocal().query(AttendanceEvent).count())'), '0', 'aucun pointage réel produit');
  });

  await t.test('permissions serveur et périmètre site/société conservés', async () => {
    assert.equal((await api('/biometrics/terminals')).status, 401);
    const scoped = await api('/biometrics/terminals', { token: viewerToken });
    assert.equal(scoped.status, 200);
    assert.ok(scoped.data.every(row => row.site_id === ids.sites[0] && row.society === SOCIETY));
    assert.equal((await api('/biometrics/terminals?site_id=' + ids.sites[2], { token: viewerToken })).status, 403);
    for (const [endpoint, method, body] of [
      ['/biometrics/terminals', 'POST', { name: 'INTERDIT', terminal_type: 'TABLET_ANDROID', site_id: ids.sites[0] }],
      [`/biometrics/terminals/${ids.phone}`, 'PATCH', { enabled: false }],
      [`/biometrics/terminals/${ids.phone}/pairing-code`, 'POST', undefined],
      [`/biometrics/terminals/${ids.phone}/revoke`, 'POST', { reason: 'Interdit' }],
      [`/biometrics/terminals/${ids.phone}/audit`, 'GET', undefined],
      [`/biometrics/terminals/${ids.phone}`, 'DELETE', { reason: 'Interdit' }],
      ['/biometrics/terminals?include_deleted=true', 'GET', undefined],
    ]) assert.equal((await api(endpoint, { token: viewerToken, method, body })).status, 403, endpoint);
    await page.click('#logout-btn');
    await loginPage(page, VIEWER);
    const view = await page.$eval('#view-terminals', el => el.innerText);
    assert.match(view, /HAMOUL/);
    assert.doesNotMatch(view, /ORAN LOGISTIQUE|ALGER SECURITE|IRON GLOBAL SECURITE/);
    assert.doesNotMatch(view, /TEST_PUBLIC_[XY]_NOT_EXPOSED|TEST_PAIRING_HASH_NOT_EXPOSED|"public_key"|"pairing_code_hash"/);
    assert.deepEqual(errors, []);
  });
  t.diagnostic('Captures et mesures : ' + ARTIFACTS);
});
