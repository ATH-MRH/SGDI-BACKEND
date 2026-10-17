// Convocations avec QR — parcours complet sur un serveur local réel, base isolée, Chrome réel.
// Lancer : node --test tests_frontend/recrute-convocations-e2e.test.js
// Le recruteur agit dans recrute.html (clics réels) ; le candidat passe par l'API de l'application IRON Emploi
// (aucun téléphone n'est simulé ici). Le QR du PDF est relu par un vrai décodeur (zxing-cpp).
// Aucun SMS (passerelle locale « poll »), aucun push, aucun e-mail : rien ne sort de la machine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_CONVOCATIONS_E2E_PORT || 8961);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'ConvocationsLocal!2026';           // compte jetable de la base E2E uniquement
const GATEWAY = 'convocations-e2e-gateway-key-not-for-production';
const SOCIETY = 'IRON GLOBAL SÉCURITÉ';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite ci-dessous */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const decoder = (() => { try { execFileSync(PYTHON, ['-c', 'import pypdfium2, zxingcpp'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();
const SKIP = !CHROME ? 'Chrome introuvable' : !puppeteer ? 'puppeteer-core absent' : !decoder ? 'pypdfium2 / zxing-cpp absents (requirements-dev.txt)' : false;

async function api(endpoint, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, data: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
function algiers(minutes) {                       // heure d'Alger (UTC+1, sans heure d'été), comme le serveur
  const value = new Date(Date.now() + 3600 * 1000 + minutes * 60 * 1000);
  return { date: value.toISOString().slice(0, 10), time: value.toISOString().slice(11, 16) };
}
async function clickText(page, selector, text) {
  for (const handle of await page.$$(selector)) {
    if ((await handle.evaluate(el => el.textContent.trim())).includes(text)) { await handle.click(); return; }
  }
  assert.fail(`bouton absent : ${selector} / ${text}`);
}

test('Convocation avec QR — du recruteur au candidat, puis scan, arrivée et compte rendu', { timeout: 240000, skip: SKIP }, async t => {
  const start = algiers(40);
  if (start.date !== algiers(0).date) { t.skip('fin de journée à Alger : un entretien « aujourd’hui » n’est plus possible'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-convocations-e2e-'));
  const artifacts = process.env.ATLAS_CONVOCATIONS_ARTIFACTS || path.join(os.tmpdir(), 'atlas-convocations-e2e-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', JWT_SECRET: 'atlas-convocations-e2e-temporary-secret-2026',
    DATABASE_URL: process.env.ATLAS_CONVOCATIONS_E2E_DATABASE_URL || `sqlite:///${path.join(tmp, 'test.db')}`,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    RECRUITMENT_SMS_ENABLED: 'true', RECRUITMENT_SMS_PROVIDER: 'poll', RECRUITMENT_SMS_GATEWAY_KEY: GATEWAY, RECRUITMENT_PUSH_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', CONVOCATION_SMTP_HOST: '' };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  let server, browser, page;
  const pageErrors = [];
  t.after(async () => {
    if (page) await page.screenshot({ path: path.join(artifacts, 'last-state.png'), fullPage: true }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const python = code => execFileSync(PYTHON, ['-c', code], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop();

  // ── Serveur isolé, schéma par Alembic, recruteur jetable ──
  execFileSync(PYTHON, ['-m', 'alembic', '-c', path.join(ROOT, 'alembic.ini'), 'upgrade', 'head'], { cwd: ROOT, env, stdio: 'ignore' });
  server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
    try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) {}
    await delay(250);
  }
  python(`
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
s=SessionLocal()
s.add(User(username='REC01', email='rec01@exemple.dz', full_name='Recruteur Démo', role='recruteur', access_level='H3', authorized_societies=[${JSON.stringify(SOCIETY)}],
           authorized_structures=[], authorized_modules=['recrute'], authorized_actions=['read', 'create', 'update'], password_hash=hash_password(${JSON.stringify(PASSWORD)}), validation_password_hash=hash_password('x'), is_active=True))
s.commit(); print('ok')`);
  const staff = (await api('/auth/login', { method: 'POST', body: { username: 'REC01', password: PASSWORD } })).data.access_token;
  assert.ok(staff, 'connexion recruteur');

  // ── Annonce publiée, candidat identifié par la passerelle SMS locale, candidature ──
  const offer = (await api('/drh/job-offers', { method: 'POST', token: staff, body: { society: SOCIETY, title: 'Agent de sécurité — démonstration', wilaya: 'Alger',
    contract_type: 'CDI', missions: 'Surveillance du site.', profile: 'Sens des responsabilités.' } })).data;
  assert.equal((await api(`/drh/job-offers/${offer.id}/publish`, { method: 'POST', token: staff })).status, 200);
  const gateway = { 'X-SMS-Gateway-Key': GATEWAY };
  await api('/public/mobile/gateway/poll', { method: 'POST', headers: gateway });
  const issued = (await api('/public/mobile/request-code', { method: 'POST', body: { first_name: 'Nadia', last_name: 'Démo-Convocation', phone: '0551234567' } })).data;
  const job = (await api('/public/mobile/gateway/poll', { method: 'POST', headers: gateway })).data.job;
  const code = /\b\d{6}\b/.exec(job.message)[0];
  const verified = (await api('/public/mobile/verify-code', { method: 'POST', body: { challenge_id: issued.challenge_id, code } })).data;
  const candidate = (await api('/public/emploi/session', { method: 'POST', token: verified.access_token })).data.session_token;
  const applied = await api('/public/emploi/applications', { method: 'POST', token: candidate, body: { offer_id: offer.id, request_id: 'demo-convocation-0001', consent: true,
    profile: { wilaya: 'Alger', address: 'Adresse de démonstration' } } });
  assert.equal(applied.status, 201, JSON.stringify(applied.data));
  const applicationId = applied.data.application_id;

  // ── Recruteur : convocation depuis le dossier, aperçu, envoi ──
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'), args: ['--no-first-run', '--no-default-browser-check'] });
  page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto(BASE + '/recrute', { waitUntil: 'networkidle0' });
  await page.type('#username', 'REC01'); await page.type('#password', PASSWORD); await page.click('#loginBtn');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.evaluate(id => openEmploiDossier(id, 'interviews'), applicationId);
  await page.waitForSelector('.conv-head');
  await clickText(page, '.conv-head button', 'Convoquer le candidat');
  await page.waitForSelector('#convForm');
  await page.$eval('#convForm [name=date]', (el, value) => { el.value = value; }, start.date);
  await page.$eval('#convForm [name=time]', (el, value) => { el.value = value; }, start.time);
  for (const [name, value] of [['location', 'Siège IRON Global Sécurité'], ['address', 'Lot de démonstration, zone industrielle\nRouïba, Alger'], ['documents_to_bring', 'Pièce d’identité\nCV'],
    ['note', 'Présentez-vous à l’accueil 10 minutes avant.']]) {
    await page.$eval(`#convForm [name=${name}]`, (el, text) => { el.value = text; }, value);
  }
  await clickText(page, '#convForm button', 'Aperçu avant envoi');
  await page.waitForSelector('.conv-preview');
  assert.match(await page.$eval('.conv-preview', el => el.textContent), /Convocation à un entretien[\s\S]*Rouïba/);
  await page.screenshot({ path: path.join(artifacts, '1-formulaire-apercu.png'), fullPage: true });
  await clickText(page, '#convForm button', 'Envoyer la convocation');
  await page.waitForFunction(() => !document.getElementById('convForm') && document.querySelector('.conv-card'));
  assert.match(await page.$eval('.conv-card', el => el.textContent), /version 1[\s\S]*Envoyée[\s\S]*Candidat : Nouvelle/);
  await page.screenshot({ path: path.join(artifacts, '2-convocation-envoyee.png'), fullPage: true });

  // ── Candidat (API de l'application) : réception, lecture, confirmation, PDF ──
  const items = (await api('/public/emploi/interviews', { token: candidate })).data.items;
  assert.equal(items.length, 1); const interviewId = items[0].id;
  assert.equal(items[0].convocation.state, 'new');
  const notifications = (await api('/public/emploi/notifications', { token: candidate })).data.items.filter(n => n.kind === 'interview');
  assert.deepEqual(notifications.map(n => [n.title, n.interview_id]), [['Convocation à un entretien', interviewId]]);
  const detail = (await api(`/public/emploi/interviews/${interviewId}`, { token: candidate })).data;
  assert.ok(detail.convocation.qr.length > 20, 'matrice du QR fournie à l’application');
  assert.equal((await api(`/public/emploi/interviews/${interviewId}/viewed`, { method: 'POST', token: candidate })).data.convocation.state, 'viewed');
  assert.equal((await api(`/public/emploi/interviews/${interviewId}/confirm`, { method: 'POST', token: candidate })).data.convocation.state, 'confirmed');
  const pdf = await api(`/public/emploi/interviews/${interviewId}/convocation`, { token: candidate });
  assert.equal(pdf.status, 200); const pdfPath = path.join(artifacts, `${detail.convocation.reference}-V1.pdf`); fs.writeFileSync(pdfPath, pdf.data);
  const decoded = JSON.parse(execFileSync(PYTHON, ['-c', `
import json, sys, pypdfium2, zxingcpp
document = pypdfium2.PdfDocument(sys.argv[1])
image = document[0].render(scale=200 / 72).to_pil(); image.save(sys.argv[2])
print(json.dumps({'codes': [code.text for code in zxingcpp.read_barcodes(image)], 'text': document[0].get_textpage().get_text_range()}))`, pdfPath, path.join(artifacts, '3-pdf-page-1.png')], { encoding: 'utf8' }));
  assert.equal(decoded.codes.length, 1); assert.match(decoded.codes[0], /^https:\/\/recrute\.irongs\.com\/#convocation=[A-Za-z0-9_-]{32}$/);
  assert.match(decoded.text, /Présentez cette convocation à votre arrivée/); assert.match(decoded.text, new RegExp(detail.convocation.reference));
  const token = decoded.codes[0].split('#convocation=')[1];

  // ── Jour J : le lien du QR ouvert sans session, connexion, bon dossier, arrivée ──
  await page.evaluate(() => logout());
  await page.goto(`${BASE}/recrute#convocation=${token}`, { waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => location.hash), '', 'le jeton quitte la barre d’adresse');
  assert.equal(await page.$eval('#loginPendingConvocation', el => el.classList.contains('hidden')), false);
  assert.doesNotMatch(await page.$eval('body', el => el.innerText), /Démo-Convocation|DÉMO-CONVOCATION/i, 'aucune identité avant connexion');
  await page.screenshot({ path: path.join(artifacts, '4-connexion-qr-en-attente.png') });
  await page.$eval('#username', el => { el.value = ''; }); await page.$eval('#password', el => { el.value = ''; });
  await page.type('#username', 'REC01'); await page.type('#password', PASSWORD); await page.click('#loginBtn');
  await page.waitForSelector('.conv-scan');
  const banner = await page.$eval('.conv-scan', el => el.textContent);
  assert.match(banner, /Convocation en vigueur/); assert.match(banner, /présence confirmée dans l’application/);
  assert.equal(await page.evaluate(() => emploiState.dossier.id), applicationId);
  await page.screenshot({ path: path.join(artifacts, '5-scan-dossier-ouvert.png'), fullPage: true });
  await clickText(page, '.conv-scan button', 'Confirmer l’arrivée du candidat');
  await page.waitForFunction(() => /Arrivée confirmée le/.test(document.querySelector('.conv-card')?.textContent || ''));
  let staffView = (await api(`/drh/job-offers/applications/${applicationId}`, { token: staff })).data;
  assert.equal(staffView.interviews[0].arrived_by, 'REC01'); assert.equal(staffView.interviews[0].status, 'confirmed'); assert.equal(staffView.outcome, 'pending');

  // ── L'entretien a eu lieu : compte rendu avec la grille existante, sans décision automatique ──
  python(`
import app.main
from datetime import timedelta
from app.db.session import SessionLocal
from app.modules import recruitment_engage_service as engage
from app.modules.recruitment_engage_models import RecruitmentInterview
s=SessionLocal(); row=s.get(RecruitmentInterview, ${interviewId}); row.starts_at=engage.now_local()-timedelta(minutes=2); s.commit(); print('ok')`);
  await page.evaluate(id => openEmploiDossier(id, 'interviews'), applicationId);
  await page.waitForSelector('.conv-card');
  await clickText(page, '.conv-card button', 'Compte rendu de l’entretien');
  await page.waitForSelector(`#convOutcome${interviewId} form`);
  const criteria = await page.$$eval(`#convOutcome${interviewId} .interview-grid label`, els => els.map(el => el.textContent));
  assert.equal(criteria.length, 8, 'la grille du vivier (8 critères) est reprise');
  await page.select(`#convOutcome${interviewId} [name=score_profil]`, '8');
  await page.select(`#convOutcome${interviewId} [name=score_motivation]`, '7');
  await page.select(`#convOutcome${interviewId} [name=appreciation]`, 'Favorable');
  await page.type(`#convOutcome${interviewId} [name=report]`, 'Entretien de démonstration : échange clair.');
  await page.screenshot({ path: path.join(artifacts, '6-compte-rendu.png'), fullPage: true });
  await clickText(page, `#convOutcome${interviewId} button`, 'Enregistrer le compte rendu');
  await page.waitForFunction(() => /Entretien réalisé/.test(document.querySelector('.conv-card')?.textContent || ''));
  staffView = (await api(`/drh/job-offers/applications/${applicationId}`, { token: staff })).data;
  assert.equal(staffView.interviews[0].status, 'done'); assert.equal(staffView.interviews[0].assessment.average, 7.5);
  assert.equal(staffView.outcome, 'pending', 'aucune décision automatique'); assert.equal(staffView.contract, null); assert.equal(staffView.drh_transfer, null);
  const seen = (await api(`/public/emploi/interviews/${interviewId}`, { token: candidate })).data;
  assert.equal(seen.convocation.state, 'done'); assert.doesNotMatch(JSON.stringify(seen), /démonstration : échange|profil|Favorable/, 'compte rendu jamais transmis');

  // ── Scanner (référence manuelle) et affichage téléphone de l'espace recruteur ──
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => convOpenScanner());
  await page.screenshot({ path: path.join(artifacts, '7-scanner-390.png') });
  await page.type('#convScanModal [name=reference]', `${detail.convocation.reference}-V1`);
  assert.equal(await page.$('.conv-scan'), null, 'le résumé du scan précédent est retiré avec le compte rendu');
  await clickText(page, '#convScanModal button', 'Rechercher');
  await page.waitForSelector('.conv-scan');
  assert.match(await page.$eval('.conv-scan', el => el.textContent), /Entretien déjà clos/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'aucun débordement à 390 px');
  await page.screenshot({ path: path.join(artifacts, '8-dossier-390.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
});
