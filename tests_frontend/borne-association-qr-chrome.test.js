// Association d'une tablette par QR code — bout en bout en Chrome RÉEL sur un serveur ATLAS isolé
// (uvicorn, base SQLite temporaire, données fictives). L'administrateur affiche le QR dans
// Gestion des équipements ; la « tablette » (onglet /borne) le lit avec SA caméra — ici un flux
// vidéo réel produit à partir de l'image du QR affiché — via le lecteur QR réel du navigateur
// (ou html5-qrcode local). Le serveur associe ; un second scan du même QR est refusé.
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
const PORT = Number(process.env.ATLAS_PAIRING_QR_PORT || 8793);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasPairingQr!2026';
const SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SEED = `
import json, app.main
from app.db.session import SessionLocal
from app.modules.ops.models import Site
s=SessionLocal()
site=Site(name='SITE HAMOUL 01',indicatif='HAM',active=1,equipment_plan={'societe':${JSON.stringify(SOCIETY)}})
s.add(site); s.commit(); print(json.dumps({'site':site.id})); s.close()
`;
const STATE = (id) => `
import json, app.main
from app.db.session import SessionLocal
from app.modules.auth.models import UserFeaturePermission
from app.modules.biometrics.models import BiometricTerminal, FacialDeviceAuthorization
s=SessionLocal(); t=s.get(BiometricTerminal, ${Number(id)})
print(json.dumps({'paired': t.public_key is not None, 'facial': bool(t.facial_attendance_enabled), 'enabled': bool(t.enabled),
  'permissions': s.query(UserFeaturePermission).count(), 'authorizations': s.query(FacialDeviceAuthorization).count()})); s.close()
`;

// La « caméra » de la tablette : un vrai MediaStream (canvas.captureStream) qui filme l'image du QR.
const fakeCamera = (dataUrl, deny) => {
  const original = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    window.__cameraRequests = (window.__cameraRequests || []).concat([constraints]);
    if (deny) throw new DOMException('Permission refusée', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const img = new Image(); img.src = dataUrl;
    const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); if (img.complete) ctx.drawImage(img, 170, 90, 300, 300); };
    draw(); setInterval(draw, 100);
    return canvas.captureStream(10);
  };
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'fake', label: 'Caméra arrière (essai)' }];
  void original;
};

test('Association par QR — Gestion des équipements puis /borne, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pairing-qr-'));
  const artifacts = process.env.ATLAS_PAIRING_QR_ARTIFACTS || path.join(os.tmpdir(), 'atlas-pairing-qr-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-pairing-qr-e2e-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '',
    BIOMETRIC_ENABLED: 'true', BIOMETRIC_TEMPLATE_KEY: crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const python = (code) => JSON.parse(execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  let server, browser, admin, terminalId, qrImage, fixture;
  const errors = [];
  const shot = (page, name) => page.screenshot({ path: path.join(artifacts, name + '.png') });
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const borne = async (name, { deny = false } = {}) => {
    const context = await browser.createBrowserContext();             // appareil neuf : aucune identité stockée
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name} — ${error.message}`));
    await page.setViewport({ width: 800, height: 1280, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(fakeCamera, qrImage, deny);
    await page.goto(BASE + '/borne', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#pairScan');
    return page;
  };
  const text = (page, sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
  const until = async (page, fn, arg, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) { if (await page.evaluate(fn, arg).catch(() => false)) return; if (Date.now() > end) throw new Error('délai dépassé : ' + fn); await delay(150); }
  };

  await t.test('serveur isolé et administrateur connecté', async () => {
    server = spawn(PYTHON, ['-c', 'import sys,uvicorn,app.main; uvicorn.run(app.main.app,host="127.0.0.1",port=int(sys.argv[1]),log_level="error")', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* démarrage */ }
      await delay(200);
    }
    fixture = python(SEED);
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream'] });
    admin = await browser.newPage();
    admin.on('pageerror', (error) => errors.push(`admin — ${error.message}`));
    admin.on('dialog', (dialog) => dialog.accept());
    await admin.setViewport({ width: 1440, height: 900 });
    await admin.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
    await admin.waitForSelector('.login-admin-system-shortcut'); await admin.click('.login-admin-system-shortcut');
    await admin.click('#modal-host input[name="username"]', { clickCount: 3 }); await admin.keyboard.press('Backspace');
    await admin.type('#modal-host input[name="username"]', 'UIADMIN'); await admin.type('#modal-host input[name="password"]', PASSWORD);
    for (const button of await admin.$$('#modal-host button')) if ((await button.evaluate((el) => el.textContent)).includes('Valider')) { await button.click(); break; }
    await admin.waitForSelector('#sidebar-nav [data-route="admin/terminaux-faciaux"]');
    await admin.evaluate(() => { location.hash = '#/admin/terminaux-faciaux'; });
    await admin.waitForSelector('#admin-equip-dashboard');
  });

  await t.test('Administration : enregistrer une tablette puis « Associer un appareil » — grand QR, code, durée', async () => {
    await admin.evaluate(() => document.getElementById('admin-facial-add').click());
    await admin.waitForSelector('#admin-facial-form');
    await admin.type('#af-name', 'TABLETTE ENTREE');
    await admin.select('#af-site', String(fixture.site));
    await admin.evaluate(() => adminFacialCreate());
    await admin.waitForSelector('#admin-pair-modal #admin-facial-qr canvas, #admin-pair-modal #admin-facial-qr img');
    await delay(800);
    assert.equal(await text(admin, '#admin-pair-state'), "QR d'association prêt");
    assert.match(await text(admin, '#admin-pair-modal h3'), /Associer un appareil — TABLETTE ENTREE/);
    // Rien ne recouvre le QR (notification, menu…) : le point central est bien le QR.
    assert.equal(await admin.$eval('#admin-facial-qr', (el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), true);
    assert.match(await text(admin, '#admin-facial-code'), /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    assert.match(await text(admin, '#admin-pair-ttl'), /^Valide encore (10 min 00|9 min 5\d) s$/);
    const size = await admin.$eval('#admin-facial-qr', (el) => el.getBoundingClientRect().width);
    assert.ok(size >= 280, `QR assez grand sur ordinateur (${size}px)`);
    terminalId = Number(await admin.$eval('#admin-pair-modal', (el) => el.dataset.key.split(':')[1]));
    qrImage = await admin.$eval('#admin-facial-qr canvas', (canvas) => canvas.toDataURL('image/png'));
    await shot(admin, '01-admin-qr-association');
  });

  await t.test('Borne : caméra refusée → saisie manuelle proposée, rien n\'est associé', async () => {
    const page = await borne('borne-refus', { deny: true });
    await page.click('#pairScan');
    await until(page, () => /Caméra indisponible/.test(document.getElementById('pairMessage').textContent));
    assert.equal(await text(page, '#pairMessage'), 'Caméra indisponible — saisissez le code manuellement');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pairCode');
    assert.equal(python(STATE(terminalId)).paired, false);
    await page.close();
  });

  await t.test('Borne : « Scanner le QR d\'association » lit le QR, associe, confirme, revient à la borne', async () => {
    const page = await borne('borne');
    await shot(page, '02-borne-avant-scan');
    await page.click('#pairScan');
    await until(page, () => /ASSOCIATION RÉUSSIE/.test(document.getElementById('kioskStatus').textContent), null, 45000);
    assert.match(await text(page, '#kioskStatus'), /✓ ASSOCIATION RÉUSSIE TABLETTE ENTREE · SITE HAMOUL 01/);
    await shot(page, '03-borne-association-reussie');
    const requests = await page.evaluate(() => window.__cameraRequests.map((c) => JSON.stringify(c.video || c)));
    assert.match(requests[0], /environment/, 'caméra arrière pour lire l\'écran de l\'administrateur');
    await until(page, () => document.getElementById('kioskPairing').hidden && !/ASSOCIATION RÉUSSIE/.test(document.getElementById('kioskStatus').textContent), null, 20000);
    const state = python(STATE(terminalId));
    assert.deepEqual(state, { paired: true, facial: false, enabled: true, permissions: state.permissions, authorizations: 0 }, 'aucune activation faciale, aucune affectation');
    await page.close();
    // L'administrateur voit l'association aboutir.
    await until(admin, () => document.getElementById('admin-pair-state')?.textContent === 'Association réussie', null, 15000);
    await shot(admin, '04-admin-association-reussie');
  });

  await t.test('Borne : le même QR scanné par un second appareil → « QR déjà utilisé »', async () => {
    const page = await borne('borne-2');
    await page.click('#pairScan');
    await until(page, () => /QR déjà utilisé/.test(document.getElementById('pairMessage').textContent), null, 45000);
    assert.equal(await page.evaluate(() => document.getElementById('kioskPairing').hidden), false);
    await shot(page, '05-borne-qr-deja-utilise');
    await page.close();
  });

  await t.test('Administration sur téléphone : fenêtre adaptée, QR lisible, sans débordement', async () => {
    await admin.evaluate(() => adminPairClose());
    await admin.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await admin.evaluate(() => renderView());
    await admin.waitForSelector('[data-facial-pair]');
    await admin.evaluate(() => document.querySelector('[data-facial-pair]').click());       // « Remplacer le matériel » : nouveau QR
    await admin.waitForSelector('#admin-pair-modal #admin-facial-qr canvas');
    await delay(800);                                                   // fin de l'animation d'ouverture
    const geometry = await admin.evaluate(() => {
      const modal = document.querySelector('#modal-host .modal').getBoundingClientRect(), qr = document.getElementById('admin-facial-qr').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, modalRight: modal.right, qr: qr.width, vw: innerWidth };
    });
    assert.equal(geometry.overflow, 0);
    assert.ok(geometry.modalRight <= geometry.vw, 'fenêtre dans l\'écran');
    assert.ok(geometry.qr >= 200 && geometry.qr <= geometry.vw - 32, `QR adapté à l'écran (${geometry.qr}px)`);
    await shot(admin, '06-admin-qr-telephone');
    await admin.evaluate(() => adminPairClose());
    assert.deepEqual(errors, []);
  });
});
