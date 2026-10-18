// Badge officiel historique présenté au Pointeur — bout en bout en Chrome RÉEL sur un serveur ATLAS
// isolé (uvicorn, SQLite temporaire, données fictives). Le QR est CELUI que le serveur dessine sur
// le badge (/api/public-links/employee → badge_qr) ; le Pointeur le lit par sa caméra (flux vidéo
// réel filmant le QR) puis par la douchette USB (saisie clavier) ; présence enregistrée et affichée.
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
const PORT = Number(process.env.ATLAS_BADGE_HIST_PORT || 8795);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasBadgeHist!2026';
const SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SEED = `
import json, app.main
from datetime import date
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
s=SessionLocal(); soc=${JSON.stringify(SOCIETY)}
site=Site(name='SITE HAMOUL 01',indicatif='HAM',active=1,equipment_plan={'societe':soc}); s.add(site); s.flush()
people=[]
for code,last in (('HIST01','OUALI'),('HIST02','BENALI')):
    e=Employee(code=code,first_name='Amine',last_name=last,society=soc,status='actif',position='Agent de sécurité',
               extra={'photo':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','groupeSanguin':'AB-'})
    s.add(e); s.flush(); s.add(Assignment(employee_id=e.id,site_id=site.id,group_code='A',start_date=date(2026,1,1),active=1)); people.append(e.id)
p=User(username='PTG01',full_name='Poste de garde 01',role='pointeur',access_level='H2',authorized_modules=['pointeur'],authorized_actions=['read','create'],
       authorized_structures=['pointage'],authorized_societies=[soc],authorized_sites=[site.id],password_hash=hash_password(${JSON.stringify(PASSWORD)}),is_active=True)
s.add(p); s.flush()
s.add(UserFeaturePermission(user_id=p.id,module_key='attendance',feature_key='qr_scanning',action_key='create'))
s.commit(); print(json.dumps({'site':site.id,'people':people})); s.close()
`;
const EVENTS = (id) => `
import json, app.main
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
s=SessionLocal(); print(json.dumps([[e.event_type,e.source] for e in s.query(AttendanceEvent).filter(AttendanceEvent.employee_id==${Number(id)}).all()])); s.close()
`;

const camera = (svgDataUrl) => {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
    const ctx = canvas.getContext('2d'); const img = new Image(); img.src = svgDataUrl;
    const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 640); if (img.complete) ctx.drawImage(img, 245, 245, 150, 150); };          // badge présenté dans le cadre de lecture
    draw(); setInterval(draw, 100);
    return canvas.captureStream(15);
  };
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'arriere', label: 'Caméra arrière (essai)' }];
};

test('Badge historique au Pointeur — caméra puis douchette, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-badge-hist-'));
  const artifacts = process.env.ATLAS_BADGE_HIST_ARTIFACTS || path.join(os.tmpdir(), 'atlas-badge-hist-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-badge-hist-e2e-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', ATTENDANCE_MIN_EVENT_GAP_SECONDS: '300',
    BIOMETRIC_ENABLED: 'false', BIOMETRIC_TEMPLATE_KEY: crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const python = (code) => JSON.parse(execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  const api = async (p, { method = 'GET', token, body } = {}) => {
    const r = await fetch(BASE + '/api' + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); try { return { status: r.status, data: JSON.parse(text) }; } catch (_) { return { status: r.status, data: text }; }
  };
  let server, browser, fixture, badges = [], pointerToken;
  const errors = [];
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const station = async (svg, name) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name} — ${error.message}`));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((session, site) => { localStorage.setItem('atlas_pointer_session', session); localStorage.setItem('atlas_pointer_site', site); },
      JSON.stringify({ token: pointerToken, username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de garde 01' } }), String(fixture.site));
    if (svg) await page.evaluateOnNewDocument(camera, svg);
    await page.goto(BASE + '/pointeur', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#wedgeInput');
    return page;
  };
  const resultText = (page) => page.$eval('#result', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const until = async (page, fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) { if (await page.evaluate(fn).catch(() => false)) return; if (Date.now() > end) throw new Error('délai dépassé : ' + fn); await delay(120); }
  };

  await t.test('serveur isolé : deux employés, un compte Pointeur, QR des badges historiques', async () => {
    server = spawn(PYTHON, ['-c', 'import sys,uvicorn,app.main; uvicorn.run(app.main.app,host="127.0.0.1",port=int(sys.argv[1]),log_level="error")', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    let admin;
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { admin = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'UIADMIN', password: PASSWORD } }); if (admin.status === 200) break; } catch (_) { /* démarrage */ }
      await delay(200);
    }
    fixture = python(SEED);
    for (const id of fixture.people) {
      const links = await api(`/public-links/employee/${id}`, { token: admin.data.access_token });
      assert.equal(links.status, 200, JSON.stringify(links));
      assert.doesNotMatch(links.data.badge_page, /[?&]b=/, 'badge historique : pas de numéro de badge émis');
      // Image du QR telle qu'imprimée : le SVG du serveur est dimensionné en % (il remplit le cadre
      // du badge) ; pour le filmer, on lui donne une taille d'affichage — contenu du QR inchangé.
      const svg = Buffer.from(links.data.badge_qr.split(',')[1], 'base64').toString('utf8').replace('width="100%" height="100%"', 'width="410" height="410"');
      badges.push({ id, link: links.data.badge_page, qr: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') });
    }
    const login = await api('/auth/login', { method: 'POST', body: { username: 'PTG01', password: PASSWORD } });
    assert.equal(login.status, 200, JSON.stringify(login));
    pointerToken = login.data.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--use-fake-ui-for-media-stream'] });
  });

  await t.test('caméra : le QR du badge, décodé par le lecteur du Pointeur, donne PRÉSENCE ENREGISTRÉE avec photo, nom, matricule, site, heure', async () => {
    const page = await station(null, 'camera');
    const sent = [], answered = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/portal/attendance-qr/scan')) sent.push(Date.now()); });
    page.on('response', (r) => { if (r.url().endsWith('/api/portal/attendance-qr/scan')) answered.push([Date.now(), r.status()]); });
    await until(page, () => !document.getElementById('appView').classList.contains('hidden'), 20000);
    // 1) Image du QR imprimé sur le badge → décodée par la bibliothèque de lecture du Pointeur.
    // 2) Le texte lu est remis au gestionnaire de scan RÉEL du poste (celui qu'appelle la caméra).
    const decoded = await page.evaluate(async (svgDataUrl) => {
      const img = new Image(); img.src = svgDataUrl; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 640); ctx.drawImage(img, 120, 120, 400, 400);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const host = document.createElement('div'); host.id = 'decode-check'; host.style.cssText = 'position:absolute;left:-9999px;width:400px'; document.body.appendChild(host);
      const out = await new Html5Qrcode('decode-check').scanFileV2(new File([blob], 'badge.png', { type: 'image/png' }), false);
      return out.decodedText;
    }, badges[0].qr);
    assert.equal(decoded, badges[0].link, 'le QR du badge contient exactement le lien signé');
    await page.evaluate((text) => onQr(text), decoded);
    await until(page, () => /PRÉSENCE ENREGISTRÉE/.test(document.getElementById('result').innerText), 15000);
    const text = await resultText(page);
    assert.match(text, /PRÉSENCE ENREGISTRÉE · ARRIVÉE/);
    assert.match(text, /OUALI Amine/); assert.match(text, /CODE HIST01/); assert.match(text, /SITE HAMOUL 01/); assert.match(text, /\d\d:\d\d:\d\d/);
    assert.ok(await page.$eval('#result', (el) => el.classList.contains('success')), 'confirmation verte');
    assert.ok(await page.$('#result img.employee-photo'), 'photo de l\'employé');
    assert.doesNotMatch(text, /AB-/);
    assert.equal(answered[0][1], 201);
    assert.ok(answered[0][0] - sent[0] < 1000, `réponse serveur en ${answered[0][0] - sent[0]} ms`);
    await page.screenshot({ path: path.join(artifacts, '01-pointeur-presence-enregistree.png') });
    assert.deepEqual(python(EVENTS(badges[0].id)), [['ARRIVAL', 'QR']]);
    // Badge relu (resté devant la caméra) : aucun second mouvement.
    await delay(1900);
    await page.evaluate((text) => onQr(text), decoded);
    await until(page, () => /PRÉSENCE DÉJÀ ENREGISTRÉE/.test(document.getElementById('result').innerText), 15000);
    assert.deepEqual(python(EVENTS(badges[0].id)), [['ARRIVAL', 'QR']], 'un seul pointage malgré les lectures répétées');
    await page.close();
  });

  await t.test('douchette USB : l\'adresse du badge saisie au clavier est reconnue et enregistrée', async () => {
    const page = await station(null, 'douchette');
    await page.focus('#wedgeInput');
    await page.keyboard.type(badges[1].link, { delay: 2 });
    await page.keyboard.press('Enter');
    await until(page, () => /PRÉSENCE ENREGISTRÉE/.test(document.getElementById('result').innerText));
    assert.match(await resultText(page), /BENALI Amine.*CODE HIST02/);
    assert.deepEqual(python(EVENTS(badges[1].id)), [['ARRIVAL', 'QR']]);
    // Même badge relu aussitôt : présence déjà enregistrée, en orange, aucun mouvement.
    await delay(1900);
    await page.focus('#wedgeInput');
    await page.keyboard.type(badges[1].link, { delay: 2 });
    await page.keyboard.press('Enter');
    await until(page, () => /PRÉSENCE DÉJÀ ENREGISTRÉE/.test(document.getElementById('result').innerText));
    assert.ok(await page.$eval('#result', (el) => el.classList.contains('warning')));
    assert.deepEqual(python(EVENTS(badges[1].id)), [['ARRIVAL', 'QR']]);
    await page.screenshot({ path: path.join(artifacts, '02-pointeur-deja-enregistree.png') });
    // Badge falsifié : refus explicite en rouge, aucune donnée personnelle.
    await delay(1900);
    await page.focus('#wedgeInput');
    await page.keyboard.type(badges[1].link.replace(/t=[0-9a-f]+/, 't=' + '0'.repeat(32)), { delay: 2 });
    await page.keyboard.press('Enter');
    await until(page, () => /QR code non reconnu/.test(document.getElementById('result').innerText));
    assert.ok(await page.$eval('#result', (el) => el.classList.contains('error')));
    assert.doesNotMatch(await resultText(page), /BENALI|HIST02/);
    await page.screenshot({ path: path.join(artifacts, '03-pointeur-qr-falsifie.png') });
    await page.close();
    assert.deepEqual(errors, []);
  });
});
