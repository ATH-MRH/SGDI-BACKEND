// Confirmation de pointage du Pointeur — Chrome RÉEL, serveur ATLAS isolé (uvicorn, SQLite temporaire,
// données fictives). Avant correctif, la fiche « dernier pointage » était comprimée dans la carte de scan
// et son contenu (photo, nom, ENTRÉE ENREGISTRÉE) se dessinait par-dessus les commandes. Vérifie : fenêtre
// flottante à droite de la zone de scan (ordinateur) ou en bas d'écran (tablette, téléphone), aucune
// superposition ni débordement, ENTRÉE / SORTIE selon l'opération réelle, fermeture (bouton, Échap,
// 5 s, pause au survol), scans successifs, refus, saisie manuelle, fiche faciale, animations réduites.
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
const PORT = Number(process.env.ATLAS_CONFIRM_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasConfirm!2026';
const SOCIETY = 'IRON GLOBAL SECURITE';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PEOPLE = [['C001', 'OUALI', 'Amine'], ['C002', 'BENALI', 'Karim'], ['C003', 'HADJ-MOHAMMED BENABDERRAHMANE', 'Abdelkader'],
  ['C004', 'SAÏDI', 'Nour'], ['C005', 'MEZIANE', 'Lyes'], ['C006', 'KACI', 'Samir'], ['C007', 'ZERROUKI', 'Yanis'], ['C008', 'BOUZID', 'Rania']];
const SEED = `
import json, app.main
from datetime import date
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.drh import badge_qr
from app.modules.drh.badge_models import EmployeeBadge
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
s=SessionLocal(); soc=${JSON.stringify(SOCIETY)}
site=Site(name='SITE HAMOUL 01',indicatif='HAM',active=1,equipment_plan={'societe':soc}); s.add(site); s.flush()
out=[]
for code,last,first in ${JSON.stringify(PEOPLE)}:
    e=Employee(code=code,first_name=first,last_name=last,society=soc,status='actif',position='Agent de sécurité',
               extra={'photo':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','groupeSanguin':'AB-'})
    s.add(e); s.flush(); s.add(Assignment(employee_id=e.id,site_id=site.id,group_code='A',start_date=date(2026,1,1),active=1))
    b=EmployeeBadge(employee_id=e.id,society=soc,status='ACTIF',snapshot={},design={},width_mm=85.6,height_mm=54.0); s.add(b); s.flush()
    out.append({'id':e.id,'code':code,'name':last+' '+first,'url':badge_qr.url_for(${JSON.stringify(BASE + '/')},b.id)})
p=User(username='PTG01',full_name='Poste de garde 01',role='pointeur',access_level='H2',authorized_modules=['pointeur'],authorized_actions=['read','create'],
       authorized_structures=['pointage'],authorized_societies=[soc],authorized_sites=[site.id],password_hash=hash_password(${JSON.stringify(PASSWORD)}),is_active=True)
s.add(p); s.flush()
for feature,action in (('qr_scanning','create'),('manual_entry','read'),('manual_entry','create')):
    s.add(UserFeaturePermission(user_id=p.id,module_key='attendance',feature_key=feature,action_key=action))
s.commit(); print(json.dumps({'site':site.id,'people':out})); s.close()
`;
const COUNTS = `
import json, app.main
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.models import Employee
from app.modules.drh.badge_models import EmployeeBadge
s=SessionLocal(); print(json.dumps({'events':s.query(AttendanceEvent).count(),'employees':s.query(Employee).count(),'badges':s.query(EmployeeBadge).filter(EmployeeBadge.status=='ACTIF').count()})); s.close()
`;

// Mesures dans la page : fenêtre visible, commandes, chevauchements, débordement horizontal.
function layout() {
  const box = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null; };
  const hit = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
  const card = document.getElementById('lastScanCard');
  const float = box(card.querySelector('.last-scan-float'));
  const resultEl = document.getElementById('result');
  const result = resultEl.classList.contains('show') && !resultEl.classList.contains('is-covered') ? box(resultEl) : null;   // hors message, la règle mobile le garde sous l'écran
  const scanner = box(document.getElementById('scannerCard'));
  const controls = ['.mode-grid', '.pointer-search', '#cameraModeBtn', '.action-row', '.station-foot', '#manualPanel', '#restartBtn']
    .map((sel) => [sel, box(document.querySelector(sel))]).filter(([, b]) => b);
  // Enfants de la carte de scan, dans le flux : aucun ne doit en recouvrir un autre.
  const kids = [...document.getElementById('scannerCard').children].filter((el) => getComputedStyle(el).position !== 'fixed').map((el) => [el.id || el.className, box(el)]).filter(([, b]) => b);
  const overlaps = [];
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(kids[i][1], kids[j][1])) overlaps.push(kids[i][0] + ' × ' + kids[j][0]);
  const visibleFloats = [float, result].filter(Boolean).length;
  return {
    float, result, scanner, visibleFloats, overlaps,
    covered: controls.filter(([, b]) => hit(b, float) || hit(b, result)).map(([sel]) => sel),
    cardOverflow: card.scrollHeight - card.clientHeight,
    hScroll: document.documentElement.scrollWidth - window.innerWidth,
    inViewport: [float, result].filter(Boolean).every((b) => b.x >= 0 && b.y >= 0 && b.r <= window.innerWidth + 0.5 && b.b <= window.innerHeight + 0.5),
    title: card.querySelector('.last-scan-float .last-scan-move b')?.textContent || '',
    text: card.querySelector('.last-scan-float')?.innerText.replace(/\s+/g, ' ') || '',
    resultText: document.getElementById('result').innerText.replace(/\s+/g, ' '),
    cls: card.className, sheet: document.body.classList.contains('lsf-sheet'),
    focus: document.activeElement && document.activeElement.id,
    floats: card.querySelectorAll('.last-scan-float').length,
  };
}

test('Confirmation de pointage — fenêtre flottante, sans chevauchement, Chrome réel', { timeout: 300000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-confirm-'));
  const artifacts = process.env.ATLAS_CONFIRM_ARTIFACTS || path.join(os.tmpdir(), 'atlas-confirm-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-confirm-e2e-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', ATTENDANCE_MIN_EVENT_GAP_SECONDS: '0',
    BIOMETRIC_ENABLED: 'false', BIOMETRIC_TEMPLATE_KEY: crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const python = (code) => JSON.parse(execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  let server, browser, fixture, token, before;
  const errors = [];
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const station = async (name, { width = 1440, height = 900, mobile = false, reducedMotion = false } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name} — ${error.message}`));
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
    if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument((session, site) => { localStorage.setItem('atlas_pointer_session', session); localStorage.setItem('atlas_pointer_site', site); },
      JSON.stringify({ token, username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de garde 01' } }), String(fixture.site));
    await page.goto(BASE + '/pointeur', { waitUntil: 'networkidle2' });
    await page.waitForSelector('#wedgeInput');
    await page.waitForFunction(() => !document.getElementById('appView').classList.contains('hidden'), { timeout: 20000 });
    return page;
  };
  const scan = async (page, text) => { await page.focus('#wedgeInput'); await page.keyboard.type(text, { delay: 1 }); await page.keyboard.press('Enter'); };
  const shown = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#lastScanCard .last-scan-float')?.innerText || ''), { timeout: 15000 }, re.source);
  const floatVisible = (page) => page.evaluate(() => { const f = document.querySelector('#lastScanCard .last-scan-float'); return !!f && getComputedStyle(f).display !== 'none'; });
  const clean = (m, label) => {
    assert.deepEqual(m.overlaps, [], `${label} : éléments superposés dans la carte de scan`);
    assert.deepEqual(m.covered, [], `${label} : commandes masquées`);
    assert.ok(m.cardOverflow <= 1, `${label} : la fiche déborde de sa place (${m.cardOverflow} px)`);
    assert.ok(m.hScroll <= 0, `${label} : défilement horizontal (${m.hScroll} px)`);
    assert.ok(m.inViewport, `${label} : fenêtre hors de l'écran`);
    assert.ok(m.visibleFloats <= 1, `${label} : deux fenêtres affichées`);
  };

  await t.test('serveur isolé, données fictives', async () => {
    server = spawn(PYTHON, ['-c', 'import sys,uvicorn,app.main; uvicorn.run(app.main.app,host="127.0.0.1",port=int(sys.argv[1]),log_level="error")', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { if ((await fetch(BASE + '/api/version')).ok) break; } catch (_) { /* démarrage */ }
      await delay(200);
    }
    fixture = python(SEED);
    before = python(COUNTS);
    const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'PTG01', password: PASSWORD }) })).json();
    token = login.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
  });

  await t.test('1440×900 : ENTRÉE, scans successifs, SORTIE, fermeture, refus, doublon, fiche faciale', async () => {
    const page = await station('1440', { width: 1440, height: 900 });
    const [a, b, c, d] = fixture.people;
    clean(await page.evaluate(layout), 'au repos');

    await scan(page, a.url);
    await shown(page, /ENTRÉE ENREGISTRÉE/);
    await shown(page, /QR VALIDÉ/);                                     // état stabilisé : fiche du flux en direct
    let m = await page.evaluate(layout);
    clean(m, 'entrée');
    assert.match(m.text, /OUALI Amine/); assert.match(m.text, /C001/); assert.match(m.text, /SITE HAMOUL 01/); assert.match(m.text, /\d\d:\d\d:\d\d/);
    assert.match(m.text, /ÉTAT ACTUEL : PRÉSENT/); assert.doesNotMatch(m.text, /AB-/);
    assert.ok(m.float.x >= m.scanner.r, 'à droite de la zone de scan');
    assert.ok(!m.sheet && /is-entry/.test(m.cls));
    assert.ok(await page.$('#lastScanCard .last-scan-float .last-scan-photo'), 'photo');
    assert.equal(await page.$eval('#lastScanCard', (el) => el.getAttribute('role')), 'status', 'résultat annoncé');
    assert.equal(m.focus, 'wedgeInput', 'la douchette reste prête');
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-entree.png') });

    await delay(1900);                                                   // scan suivant (verrou de 1,8 s du poste)
    await scan(page, b.url);
    await shown(page, /BENALI Karim/);
    await shown(page, /QR VALIDÉ/);
    m = await page.evaluate(layout);
    clean(m, 'scan successif');
    assert.equal(m.floats, 1, 'une seule fenêtre, actualisée');
    assert.doesNotMatch(m.text, /OUALI/);

    await delay(1900);
    await scan(page, b.url);                                             // même badge : sortie réelle
    await shown(page, /SORTIE ENREGISTRÉE/);
    m = await page.evaluate(layout);
    clean(m, 'sortie');
    assert.ok(/is-exit/.test(m.cls)); assert.match(m.text, /ÉTAT ACTUEL : SORTI/);
    await shown(page, /QR VALIDÉ/);                                     // fiche du flux en direct : même fenêtre, actualisée
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-sortie.png') });

    await page.click('#lastScanCard .lsf-close');                       // bouton de fermeture
    assert.equal(await floatVisible(page), false, 'fermée au clic');
    m = await page.evaluate(layout);
    assert.equal(m.focus, 'wedgeInput', 'focus rendu à la douchette');
    assert.match(await page.$eval('#lastScanCard', (el) => el.innerText), /SORTIE ENREGISTRÉE/, 'résumé conservé dans la zone de scan');

    await delay(1900);
    await scan(page, c.url);
    await shown(page, /HADJ-MOHAMMED BENABDERRAHMANE Abdelkader/);
    await shown(page, /QR VALIDÉ/);
    clean(await page.evaluate(layout), 'nom long');
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-nom-long.png') });
    await page.keyboard.press('Escape');                                 // Échap
    assert.equal(await floatVisible(page), false, 'fermée par Échap');

    await delay(1900);
    await scan(page, d.url);
    await shown(page, /SAÏDI Nour/);
    await shown(page, /QR VALIDÉ/);
    await page.hover('#lastScanCard .last-scan-float');                  // pause au survol
    await delay(6000);
    assert.equal(await floatVisible(page), true, 'pause au survol');
    await page.mouse.move(5, 890);
    await delay(5300);                                                   // reprise : le temps restant, puis fermeture
    assert.equal(await floatVisible(page), false, 'reprise puis fermeture');

    await delay(600);
    await scan(page, 'https://exemple.invalid/pas-un-badge-atlas-123456');           // refus sans fiche
    await page.waitForFunction(() => /QR code non reconnu/.test(document.getElementById('result').innerText));
    m = await page.evaluate(layout);
    clean(m, 'refus');
    assert.ok(m.result && !m.float, 'message seul, à la place de la fenêtre');
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-refus.png') });

    // Doublon (réponse du serveur rejouée par la fonction réelle du poste) et fiche faciale du flux en direct.
    await page.evaluate(() => showResult({ name: 'OUALI Amine', matricule: 'C001', action: 'arrivee', heure: '08:00:12', site: 'SITE HAMOUL 01', duplicate: true }, 'warning'));
    await shown(page, /PRÉSENCE DÉJÀ ENREGISTRÉE/);
    m = await page.evaluate(layout);
    clean(m, 'doublon'); assert.ok(/is-duplicate/.test(m.cls)); assert.match(m.text, /AUCUN NOUVEAU MOUVEMENT/);
    await page.evaluate(() => showLastScan({ id: 987654, type: 'ENTREE', source: 'FACIAL', heure: '08:01:05', site: 'SITE HAMOUL 01', state: 'PRESENT',
      employee: { nom: 'MEZIANE', prenom: 'Lyes', matricule: 'C005', fonction: 'Agent de sécurité', societe: 'IRON GLOBAL SECURITE' } }));
    await shown(page, /MEZIANE Lyes/);
    m = await page.evaluate(layout);
    clean(m, 'fiche faciale'); assert.match(m.text, /IDENTIFIÉ/); assert.match(m.title, /ENTRÉE ENREGISTRÉE/);
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-facial.png') });
    await delay(5600);                                                   // fermeture automatique (~5 s)
    assert.equal(await floatVisible(page), false, 'fermeture automatique');
    await page.close();
  });

  await t.test('saisie manuelle : même fenêtre de confirmation', async () => {
    const page = await station('manuelle', { width: 1440, height: 900 });
    await page.click('#manualModeBtn');
    await page.type('#manualQuery', 'ZERROUKI');
    await page.waitForSelector('.manual-result-row', { timeout: 15000 });
    await page.click('.manual-result-row');
    await page.waitForSelector('#manualPointerBtn:not([disabled])');
    await page.click('#manualPointerBtn');
    await shown(page, /ZERROUKI Yanis/);
    await shown(page, /SAISIE MANUELLE/);                               // fiche du flux en direct
    const m = await page.evaluate(layout);
    clean(m, 'saisie manuelle'); assert.match(m.title, /ENTRÉE ENREGISTRÉE/);
    await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
    await page.screenshot({ path: path.join(artifacts, '1440-saisie-manuelle.png') });
    await page.close();
  });

  const screens = [['1366x768', 1366, 768, false], ['tablette-1024x768', 1024, 768, true], ['tablette-820x1180', 820, 1180, true], ['telephone-390x844', 390, 844, true]];
  for (const [label, width, height, mobile] of screens) {
    await t.test(`${label} : lisible, dans l'écran, sans masquer les commandes`, async () => {
      const page = await station(label, { width, height, mobile });
      clean(await page.evaluate(layout), `${label} au repos`);
      const person = fixture.people[4 + (screens.findIndex((s) => s[0] === label) % 4)];
      // Téléphone : le poste passe en lecture caméra (la douchette n'y est pas écoutée) ; le texte décodé
      // est remis au gestionnaire RÉEL de la caméra.
      if (await page.evaluate(() => cameraMode)) await page.evaluate((text) => onQr(text), person.url);
      else await scan(page, person.url);
      await shown(page, new RegExp(person.name.split(' ')[0]));
      clean(await page.evaluate(layout), `${label} confirmation immédiate`);
      await shown(page, /QR VALIDÉ/);                                   // état stabilisé (fiche du flux en direct, plus haute)
      await delay(400);                                                  // fin de l'animation, pour la capture
      const m = await page.evaluate(layout);
      clean(m, label);
      if (width >= 1000) assert.ok(m.float.x >= m.scanner.r, `${label} : à droite de la zone de scan`);
      else assert.ok(m.sheet, `${label} : en bas d'écran`);
      await delay(350);                                                   // fin du fondu d'entrée (0,2 s)
      await page.screenshot({ path: path.join(artifacts, `${label}.png`) });
      await page.close();
    });
  }

  await t.test('animations réduites : aucune animation, aucune barre de temps', async () => {
    const page = await station('mouvement-reduit', { reducedMotion: true });
    await scan(page, fixture.people[0].url);
    await shown(page, /OUALI Amine/);
    const css = await page.evaluate(() => ({ anim: getComputedStyle(document.querySelector('#lastScanCard .last-scan-float')).animationName,
      bar: getComputedStyle(document.querySelector('#lastScanCard .lsf-progress')).display }));
    assert.deepEqual(css, { anim: 'none', bar: 'none' });
    await page.close();
  });

  await t.test('données : seuls les pointages fictifs du test, aucune autre écriture', async () => {
    const after = python(COUNTS);
    assert.equal(after.employees, before.employees);
    assert.equal(after.badges, before.badges);
    assert.ok(after.events > before.events, 'les pointages fictifs ont bien été enregistrés par les règles habituelles');
    assert.deepEqual(errors, []);
  });
});
