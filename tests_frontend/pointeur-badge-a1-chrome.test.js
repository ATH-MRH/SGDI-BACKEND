// QR de pointage A1 (badge Studio) au Pointeur — bout en bout en Chrome RÉEL sur un serveur ATLAS isolé
// (uvicorn, SQLite temporaire, données fictives). Les QR sont ceux du Studio (badge_routes._qr_url,
// dessinés par badge_design.qr_svg). Lus par la caméra du poste (bibliothèque Html5Qrcode du Pointeur)
// et par la douchette (saisie clavier) telle que la HENEX HC-866 la tape sur un Mac AZERTY : « = » → « - ».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_BADGE_A1_PORT || 8796);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasBadgeA1!2026';
const SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Lecture réelle HENEX (réglée AZERTY PC) sur Mac AZERTY : « = » → « - », « _ » → « ! ».
const hc866OnMac = (text) => text.replace(/=/g, '-').replace(/_/g, '!');

const SEED = `
import json, app.main
from datetime import date
from types import SimpleNamespace
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh import badge_design, badge_qr
from app.modules.drh.badge_models import EmployeeBadge
from app.modules.drh.badge_routes import _studio_link_v0
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
s=SessionLocal(); soc=${JSON.stringify(SOCIETY)}; studio=SimpleNamespace(base_url=${JSON.stringify(BASE + '/')})
site=Site(name='SITE HAMOUL 01',indicatif='HAM',active=1,equipment_plan={'societe':soc}); s.add(site); s.flush()
out=[]
for code,last in (('A1CAM','OUALI'),('A1USB','BENALI'),('A1MAJ','HADJ')):
    e=Employee(code=code,first_name='Amine',last_name=last,society=soc,status='actif',position='Agent de sécurité',
               extra={'photo':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','groupeSanguin':'AB-'})
    s.add(e); s.flush(); s.add(Assignment(employee_id=e.id,site_id=site.id,group_code='A',start_date=date(2026,1,1),active=1))
    b=EmployeeBadge(employee_id=e.id,society=soc,status='ACTIF',snapshot={},design={},width_mm=85.6,height_mm=54.0); s.add(b); s.flush()
    url=badge_qr.url_for(studio.base_url,b.id); b.snapshot={'qr_url':url}   # badge A1 imprimé avant le retour arrière
    out.append({'id':e.id,'url':url,'old':_studio_link_v0(studio,e,b.id),'svg':badge_design.qr_svg(url)})
p=User(username='PTG01',full_name='Poste de garde 01',role='pointeur',access_level='H2',authorized_modules=['pointeur'],authorized_actions=['read','create'],
       authorized_structures=['pointage'],authorized_societies=[soc],authorized_sites=[site.id],password_hash=hash_password(${JSON.stringify(PASSWORD)}),is_active=True)
s.add(p); s.flush()
s.add(UserFeaturePermission(user_id=p.id,module_key='attendance',feature_key='qr_scanning',action_key='create'))
s.commit(); print(json.dumps({'site':site.id,'people':out})); s.close()
`;
const EVENTS = (id) => `
import json, app.main
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
s=SessionLocal(); print(json.dumps([[e.event_type,e.source] for e in s.query(AttendanceEvent).filter(AttendanceEvent.employee_id==${Number(id)}).all()])); s.close()
`;

test('Badge A1 au Pointeur — caméra, douchette HC-866 sur Mac AZERTY, téléphone, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-badge-a1-'));
  const artifacts = process.env.ATLAS_BADGE_A1_ARTIFACTS || path.join(os.tmpdir(), 'atlas-badge-a1-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-badge-a1-e2e-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', ATTENDANCE_MIN_EVENT_GAP_SECONDS: '300',
    BIOMETRIC_ENABLED: 'false', BIOMETRIC_TEMPLATE_KEY: crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const python = (code) => JSON.parse(execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  const api = async (p, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + '/api' + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); try { return { status: r.status, data: JSON.parse(text) }; } catch (_) { return { status: r.status, data: text }; }
  };
  let server, browser, fixture, pointerToken;
  const errors = [];
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const station = async (name) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name} — ${error.message}`));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((session, site) => { localStorage.setItem('atlas_pointer_session', session); localStorage.setItem('atlas_pointer_site', site); },
      JSON.stringify({ token: pointerToken, username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de garde 01' } }), String(fixture.site));
    await page.goto(BASE + '/pointeur', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#wedgeInput');
    return page;
  };
  const resultText = (page) => page.$eval('#result', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const until = async (page, fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) { if (await page.evaluate(fn).catch(() => false)) return; if (Date.now() > end) throw new Error('délai dépassé : ' + fn); await delay(120); }
  };
  const douchette = async (page, text) => { await page.focus('#wedgeInput'); await page.keyboard.type(text, { delay: 2 }); await page.keyboard.press('Enter'); };

  await t.test('serveur isolé : trois badges Studio au format A1', async () => {
    server = spawn(PYTHON, ['-c', 'import sys,uvicorn,app.main; uvicorn.run(app.main.app,host="127.0.0.1",port=int(sys.argv[1]),log_level="error")', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { if ((await api('/version')).status === 200) break; } catch (_) { /* démarrage */ }
      await delay(200);
    }
    fixture = python(SEED);
    for (const person of fixture.people) {
      assert.match(person.url, /^http:\/\/127\.0\.0\.1:\d+\/p\/A1[0-9A-HJKMNP-TV-Z]{23}$/);
      assert.equal(hc866OnMac(person.url), person.url, 'la HC-866 ne change rien au QR A1');
      assert.notEqual(hc866OnMac(person.old), person.old, 'elle abîmait le format précédent (« ?t- »)');
    }
    const login = await api('/auth/login', { method: 'POST', body: { username: 'PTG01', password: PASSWORD } });
    assert.equal(login.status, 200, JSON.stringify(login));
    pointerToken = login.data.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--use-fake-ui-for-media-stream'] });
  });

  await t.test('caméra : le QR A1 imprimé, décodé par le lecteur du Pointeur, donne PRÉSENCE ENREGISTRÉE', async () => {
    const page = await station('camera');
    await until(page, () => !document.getElementById('appView').classList.contains('hidden'), 20000);
    const person = fixture.people[0];
    const svg = 'data:image/svg+xml;base64,' + Buffer.from(person.svg.replace('width="100%" height="100%"', 'width="410" height="410"')).toString('base64');
    const decoded = await page.evaluate(async (svgDataUrl) => {
      const img = new Image(); img.src = svgDataUrl; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 640); ctx.drawImage(img, 120, 120, 400, 400);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const host = document.createElement('div'); host.id = 'decode-check'; host.style.cssText = 'position:absolute;left:-9999px;width:400px'; document.body.appendChild(host);
      return (await new Html5Qrcode('decode-check').scanFileV2(new File([blob], 'badge.png', { type: 'image/png' }), false)).decodedText;
    }, svg);
    assert.equal(decoded, person.url, 'le QR imprimé contient exactement l\'adresse A1');
    await page.evaluate((text) => onQr(text), decoded);
    await until(page, () => /PRÉSENCE ENREGISTRÉE/.test(document.getElementById('result').innerText), 15000);
    const text = await resultText(page);
    assert.match(text, /PRÉSENCE ENREGISTRÉE · ARRIVÉE/); assert.match(text, /OUALI Amine/); assert.match(text, /CODE A1CAM/);
    assert.doesNotMatch(text, /AB-/);
    assert.deepEqual(python(EVENTS(person.id)), [['ARRIVAL', 'QR']]);
    await page.screenshot({ path: path.join(artifacts, '01-a1-camera.png') });
    await page.close();
  });

  await t.test('douchette HC-866 sur Mac AZERTY : le QR A1 passe, le format précédent est refusé sans réparation', async () => {
    const page = await station('douchette');
    const person = fixture.people[1];
    await douchette(page, hc866OnMac(person.url));
    await until(page, () => /PRÉSENCE ENREGISTRÉE/.test(document.getElementById('result').innerText));
    assert.match(await resultText(page), /BENALI Amine.*CODE A1USB/);
    assert.deepEqual(python(EVENTS(person.id)), [['ARRIVAL', 'QR']]);
    await page.screenshot({ path: path.join(artifacts, '02-a1-douchette.png') });
    await delay(1900);
    await douchette(page, hc866OnMac(person.old));                      // « ?t-… &b-… » : lecture abîmée
    await until(page, () => /QR mal lu par le lecteur/.test(document.getElementById('result').innerText));
    assert.ok(await page.$eval('#result', (el) => el.classList.contains('error')));
    assert.doesNotMatch(await resultText(page), /BENALI|A1USB/);
    await delay(1900);
    const forged = person.url.slice(0, -1) + (person.url.endsWith('2') ? '3' : '2');
    await douchette(page, forged);
    await until(page, () => /QR code non reconnu/.test(document.getElementById('result').innerText));
    assert.doesNotMatch(await resultText(page), /BENALI|A1USB/);
    assert.deepEqual(python(EVENTS(person.id)), [['ARRIVAL', 'QR']], 'aucun pointage par une lecture abîmée ou falsifiée');
    await page.close();
  });

  await t.test('douchette en majuscules (Verr. Maj.) : même badge, par définition du format', async () => {
    const page = await station('majuscules');
    const person = fixture.people[2];
    await douchette(page, person.url.toUpperCase());
    await until(page, () => /PRÉSENCE ENREGISTRÉE/.test(document.getElementById('result').innerText));
    assert.match(await resultText(page), /HADJ Amine.*CODE A1MAJ/);
    assert.deepEqual(python(EVENTS(person.id)), [['ARRIVAL', 'QR']]);
    await page.close();
  });

  await t.test('téléphone : le même QR ouvre la page publique du badge, sans pointer', async () => {
    const context = await browser.createBrowserContext();
    const phone = await context.newPage();
    await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const person = fixture.people[0];
    const response = await phone.goto(person.url, { waitUntil: 'networkidle2' });
    assert.equal(response.status(), 200);
    const text = await phone.evaluate(() => document.body.innerText);
    assert.match(text, /Badge actif/i); assert.match(text, /OUALI/); assert.doesNotMatch(text, /AB-|sanguin/i);
    await phone.screenshot({ path: path.join(artifacts, '03-a1-telephone.png') });
    assert.deepEqual(python(EVENTS(person.id)), [['ARRIVAL', 'QR']], 'la consultation ne pointe pas');
    await phone.close();
    assert.deepEqual(errors, []);
  });
});
