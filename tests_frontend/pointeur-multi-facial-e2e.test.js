// Multi-terminaux faciaux — bout en bout en Chrome RÉEL sur un serveur ATLAS isolé (uvicorn, base
// SQLite temporaire, aucune donnée de production). Lancer : npm run test:pointeur-multi-facial-e2e
// Le moteur facial et la lecture des caméras IP sont simulés DANS le serveur de test (aucune caméra
// physique, aucun OpenCV) : tout le reste — API, RBAC, Attendance Core, pages — est le vrai code.
//
// Parcours : l'Administration Système enregistre un terminal, l'appaire par code à usage unique,
// autorise le compte Pointeur sur le terminal et sur deux caméras ; le Pointeur voit ses terminaux,
// les coche, les active ensemble ; deux caméras qui voient la même personne n'enregistrent qu'UN
// pointage ; la panne d'une caméra n'arrête pas l'autre ; le retrait d'une autorisation arrête le
// terminal concerné ; après reconnexion aucun nouvel appairage n'est demandé.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_MULTI_FACIAL_PORT || 8767);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasVisualLocal!2026';
const SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Serveur de test : vrai ATLAS + moteur facial simulé + caméras IP simulées, pilotées par un
// fichier (« qui chaque caméra voit-elle ? »). Aucune route, aucune règle n'est modifiée.
const LAUNCH = `
import base64, json, os, sys
import uvicorn
import app.main
from app.modules.biometrics import engine as engine_module
from app.modules.biometrics.cameras import CameraError, DahuaCameraAdapter
from tests.biometric_fakes import FakeFaceEngine, face, frame
SEEN = os.environ["ATLAS_E2E_SEEN"]
PIXEL = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAYAAAA7KqwyAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC")
def seen(camera_id):
    try:
        with open(SEEN) as handle:
            return json.load(handle).get(str(camera_id))
    except (OSError, ValueError):
        return None
def burst(self, count=3, interval=0.25):
    who = seen(self.camera.id)
    if who == "ERROR":
        raise CameraError("Caméra injoignable (simulation)")
    return [frame(face(who)) if who else frame() for _ in range(3)]
def snapshot(self, profile="CAPTURE_HIGH_QUALITY"):
    if seen(self.camera.id) == "ERROR":
        raise CameraError("Caméra injoignable (simulation)")
    return PIXEL
DahuaCameraAdapter.burst = burst
DahuaCameraAdapter.snapshot = snapshot
engine_module.set_engine(FakeFaceEngine())
uvicorn.run(app.main.app, host="127.0.0.1", port=int(sys.argv[1]), log_level="error")
`;

const SEED = `
import json
import app.main
from datetime import date
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.biometrics import crypto, service
from app.modules.biometrics.models import BiometricConsent, BiometricTemplate
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import _vector
s=SessionLocal()
soc=${JSON.stringify(SOCIETY)}
sites=[Site(name=n,indicatif=i,active=1,equipment_plan={'societe':c}) for n,i,c in [('SITE HAMOUL 01','HAM',soc),('SITE DEPOT EST','DEP',soc),('SITE HORS PERIMETRE','EXT','AUTRE SOCIETE')]]
s.add_all(sites);s.flush()
admin=s.query(User).filter_by(username='UIADMIN').one()
admin.validation_password_hash=hash_password(${JSON.stringify(PASSWORD)})
pointer=User(username='PTG01',full_name='Poste de garde 01',role='pointeur',access_level='H2',authorized_modules=['pointeur'],authorized_actions=['read','create'],
             authorized_structures=['pointage'],authorized_societies=[soc],authorized_sites=[sites[0].id,sites[1].id],password_hash=hash_password(${JSON.stringify(PASSWORD)}),is_active=True)
s.add(pointer);s.flush()
for feature in ('qr_scanning','manual_entry'):
    for action in ('read','create'):
        s.add(UserFeaturePermission(user_id=pointer.id,module_key='attendance',feature_key=feature,action_key=action))
people=[]
for index,(who,site) in enumerate([('AGENT-ALPHA',sites[0]),('AGENT-BETA',sites[1])]):
    emp=Employee(code='MF%02d'%(index+1),first_name='Agent',last_name=who.split('-')[1],society=soc,status='actif',position='Agent de sécurité')
    s.add(emp);s.flush()
    for target in sites[:2]:
        if target is site or index==0:
            s.add(Assignment(employee_id=emp.id,site_id=target.id,group_code='A',start_date=date(2026,1,1),active=1))
    consent=BiometricConsent(employee_id=emp.id,status='contract_confirmed',source='EMPLOYMENT_CONTRACT',proof_reference='Contrat',notice_version=service.NOTICE_VERSION)
    s.add(consent);s.flush()
    s.add(BiometricTemplate(employee_id=emp.id,status='ACTIVE',embedding_encrypted=crypto.encrypt_vector(_vector(who,0.0,0)),engine='fake',config_version=1,source='CAMERA',quality={},consent_id=consent.id,society=soc,site_id=site.id))
    people.append({'id':emp.id,'who':who,'code':emp.code})
s.commit()
print(json.dumps({'sites':[x.id for x in sites],'pointer':pointer.id,'people':people}))
s.close()
`;

const COUNT = (employeeId) => `
import json
import app.main
from sqlalchemy import select
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
s=SessionLocal()
rows=s.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id==${Number(employeeId)}).order_by(AttendanceEvent.id)).scalars().all()
print(json.dumps([[r.event_type,r.source,r.device_id] for r in rows]))
s.close()
`;

async function api(endpoint, { method = 'GET', token, body, headers } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, { method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(headers || {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; } catch (_) { return { status: response.status, data: text }; }
}
async function clickText(page, selector, text) {
  for (const handle of await page.$$(selector)) {
    if ((await handle.evaluate((el) => el.textContent.trim())).includes(text)) { await handle.click(); return; }
  }
  assert.fail(`bouton absent : ${selector} / ${text}`);
}
const b64u = (buffer) => Buffer.from(buffer).toString('base64url');

// Tablette simulée : clé P-256 créée « sur l'appareil », requêtes signées comme le fait /borne.
function makeDevice() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const device = { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, terminalId: null };
  device.call = (method, endpoint) => {
    const timestamp = String(Date.now());
    const message = ['ATLAS-TERMINAL-1', device.terminalId, method, '/api/biometrics' + endpoint, timestamp, crypto.createHash('sha256').update('').digest('hex')].join('\n');
    const signature = crypto.sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return api('/biometrics' + endpoint, { method, headers: { 'X-Atlas-Terminal': device.terminalId, 'X-Atlas-Timestamp': timestamp, 'X-Atlas-Signature': b64u(signature) } });
  };
  return device;
}

test('Multi-terminaux faciaux — Administration Système puis Pointeur, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-multi-facial-'));
  const artifacts = process.env.ATLAS_MULTI_FACIAL_ARTIFACTS || path.join(os.tmpdir(), 'atlas-multi-facial-e2e-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const seenFile = path.join(tmp, 'seen.json');
  const sees = (map) => fs.writeFileSync(seenFile, JSON.stringify(map));
  sees({});
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-multi-facial-e2e-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '',
    BIOMETRIC_ENABLED: 'true', BIOMETRIC_TEMPLATE_KEY: crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), ATLAS_E2E_SEEN: seenFile };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const python = (code) => JSON.parse(execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  let server, browser, admin, pointer, adminToken, fixture, terminalId;
  const cameras = {}, errors = [];
  const device = makeDevice();
  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(`${page.url()} — ${error.message}`));
    page.on('dialog', async (dialog) => { if (dialog.type() === 'prompt') await dialog.accept('Retrait après essai'); else await dialog.accept(); });
  };
  const shot = (page, name) => page.screenshot({ path: path.join(artifacts, name + '.png') });
  const rowState = (page, key) => page.$eval(`#ftRows tr[data-key="${key}"]`, (tr) => tr.cells[3].innerText.replace(/\s+/g, ' ').trim());
  const status = (page) => page.$eval('#faceStatus', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  t.after(async () => {
    for (const [page, name] of [[admin, 'last-admin'], [pointer, 'last-pointeur']]) if (page) await shot(page, name).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test('serveur isolé, fixtures : deux sites, un compte Pointeur, deux salariés enrôlés, deux caméras', async () => {
    server = spawn(PYTHON, ['-c', LAUNCH, String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    let login;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'UIADMIN', password: PASSWORD } }); if (login.status === 200) break; } catch (_) { /* démarrage */ }
      await delay(200);
    }
    assert.equal(login?.status, 200, 'administrateur temporaire non disponible');
    adminToken = login.data.access_token;
    fixture = python(SEED);
    const model = await api('/biometrics/camera-models', { method: 'POST', token: adminToken, body: { manufacturer: 'DAHUA', model: 'IPC-HFW E2E', adapter: 'DAHUA' } });
    assert.equal(model.status, 200, JSON.stringify(model));
    for (const [name, site] of [['CAM ENTREE HAMOUL', fixture.sites[0]], ['CAM QUAI DEPOT', fixture.sites[1]], ['CAM HORS PERIMETRE', fixture.sites[2]]]) {
      const cam = await api('/biometrics/cameras', { method: 'POST', token: adminToken, body: { name, camera_model_id: model.data.id, site_id: site, host: '10.20.30.40', username: 'svc', password: 'secret-e2e',
        usage: 'ATTENDANCE', role: 'ENTRY', location: 'Portail', facial_attendance_enabled: true } });
      assert.equal(cam.status, 200, JSON.stringify(cam));
      cameras[name] = cam.data.id;
    }
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'), args: ['--no-first-run', '--no-default-browser-check'] });
  });

  await t.test('Administration Système : enregistrer un terminal, l\'appairer par code à usage unique', async () => {
    admin = await browser.newPage(); watch(admin);
    await admin.setViewport({ width: 1440, height: 900 });
    await admin.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
    await admin.waitForSelector('.login-admin-system-shortcut');
    await admin.click('.login-admin-system-shortcut');
    await admin.click('#modal-host input[name="username"]', { clickCount: 3 }); await admin.keyboard.press('Backspace');
    await admin.type('#modal-host input[name="username"]', 'UIADMIN');
    await admin.type('#modal-host input[name="password"]', PASSWORD);
    await clickText(admin, '#modal-host button', 'Valider');
    await admin.waitForSelector('#sidebar-nav [data-route="admin/terminaux-faciaux"]');
    // L'entrée de menu existe ; la navigation passe par la route (le menu se redessine au chargement).
    await admin.evaluate(() => { location.hash = '#/admin/terminaux-faciaux'; });
    await admin.waitForSelector('#admin-facial-terminals');
    assert.equal(await admin.evaluate(() => location.hash), '#/admin/terminaux-faciaux');
    assert.equal(await admin.$$eval('[data-facial-row]', (rows) => rows.length), 3, 'les trois caméras déjà enregistrées');
    await admin.click('#admin-facial-add');
    await admin.waitForSelector('#admin-facial-form');
    await admin.type('#af-name', 'TABLETTE POSTE DE GARDE');
    await admin.select('#af-type', 'TABLET_ANDROID');
    await admin.select('#af-site', String(fixture.sites[0]));
    await admin.type('#af-loc', 'Guérite entrée');
    await clickText(admin, '#admin-facial-form button', 'Enregistrer');
    await admin.waitForSelector('#admin-facial-code');
    const code = await admin.$eval('#admin-facial-code', (el) => el.textContent.trim());
    assert.match(code, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    await shot(admin, '01-admin-code-association');
    // L'appareil saisit le code UNE fois : sa clé publique est enregistrée, la clé privée ne le quitte pas.
    const paired = await api('/biometrics/terminal/pair', { method: 'POST', body: { code, public_key: device.jwk, device_label: 'Galaxy Tab A9 (essai)' } });
    assert.equal(paired.status, 200, JSON.stringify(paired));
    device.terminalId = paired.data.terminal_id;
    assert.equal((await api('/biometrics/terminal/pair', { method: 'POST', body: { code, public_key: makeDevice().jwk } })).status, 401, 'code à usage unique');
    await clickText(admin, '#modal-host button', 'Fermer');
    await admin.waitForFunction(() => [...document.querySelectorAll('[data-facial-row]')].some((row) => /TABLETTE POSTE DE GARDE/.test(row.textContent) && /Appairé le/.test(row.textContent)));
    terminalId = Number((await admin.$$eval('[data-facial-row]', (rows) => rows.find((row) => /TABLETTE POSTE DE GARDE/.test(row.textContent)).dataset.facialRow)).split(':')[1]);
  });

  await t.test('Administration Système : autoriser le pointage facial et le compte Pointeur, périmètre respecté', async () => {
    const key = `trm:${terminalId}`;
    await admin.click(`[data-facial-toggle="${key}"]`);
    await admin.waitForFunction((k) => /Couper le pointage facial/.test(document.querySelector(`[data-facial-toggle="${k}"]`)?.textContent || ''), {}, key);
    for (const target of [key, `cam:${cameras['CAM ENTREE HAMOUL']}`, `cam:${cameras['CAM QUAI DEPOT']}`]) {
      await admin.click(`[data-facial-users="${target}"]`);
      await admin.waitForSelector('#admin-facial-users .admin-facial-user');
      assert.deepEqual(await admin.$$eval('#admin-facial-users label', (labels) => labels.map((l) => l.textContent.trim().split(' ')[0])), ['PTG01']);
      await admin.click('#admin-facial-users .admin-facial-user');
      await admin.click('#admin-facial-users-save');
      await admin.waitForFunction((k) => /1 compte/.test(document.querySelector(`[data-facial-row="${k}"]`)?.textContent || ''), {}, target);
    }
    // Caméra d'une autre société : le compte Pointeur n'y est pas éligible, et le serveur le refuse.
    const foreign = `cam:${cameras['CAM HORS PERIMETRE']}`;
    await admin.click(`[data-facial-users="${foreign}"]`);
    await admin.waitForSelector('#admin-facial-users');
    assert.match(await admin.$eval('#admin-facial-users', (el) => el.textContent), /Aucun compte Pointage n'a ce site dans son périmètre/);
    await clickText(admin, '#modal-host button', 'Annuler');
    assert.equal((await api('/biometrics/facial-devices/authorizations', { method: 'POST', token: adminToken, body: { key: foreign, user_ids: [fixture.pointer] } })).status, 422);
    assert.equal((await device.call('GET', '/terminal/session')).status, 200, 'la borne appairée communique avec sa clé');
    await admin.click('#admin-facial-terminals .btn-secondary');           // Actualiser
    await admin.waitForFunction((k) => /Actif/.test(document.querySelector(`[data-facial-row="${k}"] .pill`)?.textContent || ''), {}, key);
    await shot(admin, '02-admin-terminaux-faciaux');
    const html = await admin.$eval('#admin-facial-terminals', (el) => el.innerHTML);
    assert.doesNotMatch(html, /10\.20\.30\.40|secret-e2e|"x":|fingerprint/i, 'ni adresse, ni identifiant, ni clé à l\'écran');
  });

  await t.test('Pointeur : terminaux autorisés listés, sélection multiple, activation simultanée — aucun appairage', async () => {
    const login = await api('/auth/login', { method: 'POST', body: { username: 'PTG01', password: PASSWORD } });
    assert.equal(login.status, 200, JSON.stringify(login));
    // Le Pointeur ne peut ni enregistrer, ni appairer, ni révoquer, ni lire la liste d'administration.
    const token = login.data.access_token;
    assert.equal((await api('/biometrics/terminals', { method: 'POST', token, body: { name: 'PIRATE', terminal_type: 'TABLET_ANDROID', site_id: fixture.sites[0] } })).status, 403);
    assert.equal((await api(`/biometrics/terminals/${terminalId}/pairing-code`, { method: 'POST', token })).status, 403);
    assert.equal((await api('/biometrics/facial-devices', { token })).status, 403);
    assert.equal((await api(`/biometrics/pointer/terminals?site_id=${fixture.sites[2]}`, { token })).status, 403, 'site non autorisé');
    assert.equal((await api('/biometrics/pointer/terminals?society=AUTRE%20SOCIETE', { token })).status, 403, 'société non autorisée');
    const context = await browser.createBrowserContext();
    pointer = await context.newPage(); watch(pointer);
    await pointer.setViewport({ width: 1440, height: 900 });
    await pointer.evaluateOnNewDocument((session) => localStorage.setItem('atlas_pointer_session', session),
      JSON.stringify({ token, username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de garde 01' } }));
    const calls = [];
    pointer.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/biometrics/')) calls.push(`${request.method()} ${url.pathname}`); });
    pointer.calls = calls;
    await pointer.goto(BASE + '/pointeur', { waitUntil: 'networkidle2' });
    await pointer.waitForSelector('#faceModeBtn', { visible: true });
    await pointer.click('#faceModeBtn');
    await pointer.waitForFunction(() => document.querySelectorAll('#ftRows tr').length === 3);
    const rows = await pointer.$$eval('#ftRows tr', (trs) => trs.map((tr) => [...tr.cells].slice(1, 4).map((cell) => cell.innerText.replace(/\s+/g, ' ').trim())));
    assert.deepEqual(rows.map((r) => r[1]).sort(), ['SITE DEPOT EST', 'SITE HAMOUL 01', 'SITE HAMOUL 01']);
    assert.ok(rows.some((r) => /TABLETTE POSTE DE GARDE/.test(r[0]) && /En ligne/.test(r[2])), JSON.stringify(rows));
    assert.ok(!rows.some((r) => /HORS PERIMETRE/.test(r[0])));
    assert.doesNotMatch(await pointer.$eval('#faceView', (el) => el.innerText), /appairer|associer|code d'association/i);
    assert.equal(calls.filter((c) => c.includes('/recognize')).length, 0, 'rien ne tourne avant l\'activation');
    await shot(pointer, '03-pointeur-liste-terminaux');
    await pointer.click('#faceTerminals [data-ft="all"]');
    assert.equal(await pointer.$eval('#ftCountSelected', (el) => el.textContent), '3');
    await pointer.click('#ftActivate');
    const camA = `cam:${cameras['CAM ENTREE HAMOUL']}`, camB = `cam:${cameras['CAM QUAI DEPOT']}`;
    await pointer.waitForFunction((a, b) => [a, b].every((k) => /^Actif/.test(document.querySelector(`#ftRows tr[data-key="${k}"]`)?.cells[3].innerText || '')), { timeout: 15000 }, camA, camB);
    assert.match(await rowState(pointer, `trm:${terminalId}`), /^Actif · au repos/);
    assert.equal(await pointer.$eval('#ftCountActive', (el) => el.textContent), '3');
    assert.equal(await pointer.$eval('#ftCountOffline', (el) => el.textContent), '0');
    await shot(pointer, '04-pointeur-trois-terminaux-actifs');
  });

  await t.test('deux caméras voient la même personne : UN seul pointage ; une panne n\'arrête pas l\'autre', async () => {
    const [alpha, beta] = fixture.people;
    const idA = cameras['CAM ENTREE HAMOUL'], idB = cameras['CAM QUAI DEPOT'];
    sees({ [idA]: alpha.who, [idB]: alpha.who });                  // la même personne devant les deux caméras
    await pointer.waitForFunction(() => /POINTAGE ENREGISTRÉ|DÉJÀ ENREGISTRÉ/.test(document.getElementById('faceStatus').innerText), { timeout: 15000 });
    await delay(2500);                                               // laisser les deux boucles répondre
    assert.match(await status(pointer), new RegExp(`ALPHA Agent.*Matricule ${alpha.code}`));
    await shot(pointer, '05-pointeur-pointage-enregistre');
    assert.deepEqual(python(COUNT(alpha.id)).map((e) => e.slice(0, 2)), [['ARRIVAL', 'FACIAL']], 'un seul mouvement, jamais ENTRÉE puis SORTIE');
    assert.match(await pointer.$eval('#ftLastEvent', (el) => el.textContent), /ENTRÉE · ALPHA Agent/);
    // Panne de la caméra A ; la caméra B reconnaît une autre personne.
    sees({ [idA]: 'ERROR', [idB]: beta.who });
    await pointer.waitForFunction((k) => /Caméra inaccessible/.test(document.querySelector(`#ftRows tr[data-key="${k}"]`)?.cells[3].innerText || ''), { timeout: 20000 }, `cam:${idA}`);
    await pointer.waitForFunction((code) => document.getElementById('faceStatus').innerText.includes(code), { timeout: 20000 }, beta.code);
    assert.match(await rowState(pointer, `cam:${idB}`), /^Actif/);
    assert.equal(await pointer.$eval('#ftCountOffline', (el) => el.textContent), '1');
    assert.deepEqual(python(COUNT(beta.id)).map((e) => [e[0], e[1], e[2]]), [['ARRIVAL', 'FACIAL', idB]]);
    await shot(pointer, '06-pointeur-une-camera-en-panne');
    sees({});
  });

  await t.test('autorisation retirée par l\'administration : le terminal s\'arrête, les autres continuent', async () => {
    const idA = cameras['CAM ENTREE HAMOUL'], idB = cameras['CAM QUAI DEPOT'];
    assert.equal((await api('/biometrics/facial-devices/authorizations', { method: 'POST', token: adminToken, body: { key: `cam:${idB}`, user_ids: [] } })).status, 200);
    await pointer.waitForFunction((k) => { const row = document.querySelector(`#ftRows tr[data-key="${k}"]`); return !row || /Refusé/.test(row.cells[3].innerText); }, { timeout: 20000 }, `cam:${idB}`);
    await pointer.waitForFunction((k) => /^Actif/.test(document.querySelector(`#ftRows tr[data-key="${k}"]`)?.cells[3].innerText || ''), { timeout: 20000 }, `cam:${idA}`);
    await pointer.waitForFunction(() => document.querySelectorAll('#ftRows tr').length === 2, { timeout: 20000 });
    const before = pointer.calls.filter((c) => c.endsWith(`/cameras/${idB}/recognize`)).length;
    await delay(2500);
    assert.equal(pointer.calls.filter((c) => c.endsWith(`/cameras/${idB}/recognize`)).length, before, 'plus aucun essai sur le terminal retiré');
    assert.ok(pointer.calls.every((c) => /^(GET|POST) /.test(c)), 'le Pointeur ne modifie aucune configuration');
    assert.ok(!pointer.calls.some((c) => /pairing|\/biometrics\/terminals|facial-devices/.test(c)), 'aucun appel d\'administration depuis Pointeur');
  });

  await t.test('reconnexion du Pointeur : appairage conservé, sélection restaurée, écran étroit sans débordement', async () => {
    await pointer.setViewport({ width: 390, height: 844 });
    await pointer.reload({ waitUntil: 'networkidle2' });
    await pointer.waitForSelector('#faceModeBtn', { visible: true });
    await pointer.click('#faceModeBtn');
    await pointer.waitForFunction(() => document.querySelectorAll('#ftRows tr').length === 2);
    assert.deepEqual(await pointer.$$eval('#ftRows input', (boxes) => boxes.map((box) => box.checked)), [true, true], 'sélection mémorisée, sans le terminal retiré');
    assert.equal((await device.call('GET', '/terminal/session')).status, 200, 'aucun nouvel appairage');
    await pointer.click('#ftActivate');
    await pointer.waitForFunction(() => document.getElementById('ftCountActive').textContent === '2', { timeout: 15000 });
    const overflow = await pointer.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `débordement horizontal de ${overflow}px à 390px`);
    await shot(pointer, '07-pointeur-390px');
    assert.deepEqual(errors, [], 'aucune erreur JavaScript sur les deux applications');
  });
});
