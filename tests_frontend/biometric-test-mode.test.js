// Biometric Test Mode browser-flow tests: the production Attendance recognition route is forbidden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((candidate) => fs.existsSync(candidate));

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../app/static/pointage/test-mode.js'), 'utf8');
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const STATUS = { test_mode_enabled: true, production_enabled: false, records_attendance: false, engine_available: true,
  permitted: true, max_frames: 6, max_frame_bytes: 3000000, max_side_px: 4096, max_per_minute: 30 };
const recognized = { mode: 'TEST', recorded: false, state: 'RECOGNIZED', reason_code: null, message: 'Employé reconnu (test — aucun pointage)',
  employee: { employee_id: 42, matricule: 'A0042', nom: 'BENALI', prenom: 'Karim', fonction: 'Magasinier', site: 'ENTREPOT PRINCIPAL' },
  match: { candidates: 14, confidence: 0.8276, threshold: 0.363, review_margin: 0.07 },
  liveness: { result: 'PASS', score: 0.872, threshold: 0.8 }, quality: { face_px: 312 }, site_id: 12, config_version: 1,
  engine: 'opencv-yunet-sface-minifasnet', frames: 3, timings_ms: { upload: 0.2, validation: 0.2, detection: 15.2, quality: 0.2, embedding: 4.9, liveness: 1.2, matching: 1.8, total: 26.9 } };

function boot({ permitted = true, status = STATUS, result = recognized, errorStatus, errorDetail, cameras = [{ deviceId: 'front-1', kind: 'videoinput', label: 'FaceTime HD Camera' }, { deviceId: 'usb-2', kind: 'videoinput', label: 'USB Webcam' }] } = {}) {
  const calls = [], streams = [], requestedConstraints = [];
  const tracks = [];
  const mockStatus = { ...status, permitted };
  const dom = new JSDOM(HTML, { url: 'https://pointage.irongs.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
      Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });
      w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
      w.HTMLCanvasElement.prototype.toDataURL = function (type, quality) { this.captureType = type; this.captureQuality = quality; return `data:${type};base64,ZmFrZQ==`; };
      const mediaDevices = {
        getUserMedia: async (constraints) => {
          requestedConstraints.push(constraints);
          if (errorStatus === 'camera-denied') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
          if (errorStatus === 'no-camera') throw Object.assign(new Error('none'), { name: 'NotFoundError' });
          const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: 'front-1' }) };
          tracks.push(track);
          const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
          streams.push(stream);
          return stream;
        },
        enumerateDevices: async () => cameras,
      };
      Object.defineProperty(w.navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
      w.fetch = async (url, options = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        const call = { path: u.pathname, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, signal: options.signal };
        calls.push(call);
        let statusCode = 200, data = {};
        if (u.pathname === '/api/auth/me') data = { username: 'ADM', full_name: 'Administrateur' };
        else if (u.pathname === '/api/attendance/sites') data = [{ id: 12, name: 'ENTREPOT PRINCIPAL', society: 'IRON' }, { id: 13, name: 'AUTRE SITE', society: 'IRON' }];
        else if (u.pathname === '/api/attendance/board') data = { date: '2026-09-29', kpi: {}, total: 0, page: 1, page_size: 25, pages: 1, items: [] };
        else if (u.pathname === '/api/attendance/anomalies') data = { total: 0, page: 1, page_size: 25, pages: 1, items: [] };
        else if (u.pathname === '/api/biometrics/test-mode/status') data = mockStatus;
        else if (u.pathname === '/api/biometrics/test-mode/recognize') {
          if (errorStatus && typeof errorStatus === 'number') { statusCode = errorStatus; data = { detail: errorDetail || { code: errorStatus === 429 ? 'RATE_LIMITED' : errorStatus === 413 ? 'IMAGE_TOO_LARGE' : errorStatus === 422 ? 'INVALID_IMAGE' : 'TEST_MODE_DISABLED', message: 'test error' } }; }
          else data = result;
        }
        return { ok: statusCode < 400, status: statusCode, json: async () => data, text: async () => JSON.stringify(data), headers: { get: (name) => name.toLowerCase() === 'retry-after' && statusCode === 429 ? '5' : null } };
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, calls, tracks, requestedConstraints, streams };
}

async function openMode(options) {
  const ctx = boot(options);
  await tick(80);
  ctx.w.eval(SCRIPT);
  await tick(80);
  assert.equal(ctx.d.querySelector('[data-view="test-mode"]').classList.contains('hidden'), false, 'navigation is shown only to permitted users');
  ctx.d.querySelector('[data-view="test-mode"]').click();
  await tick(50);
  return ctx;
}

test('autorisation frontend : statut autorisé affiche le menu, absence de droit le masque', async () => {
  const denied = boot({ permitted: false });
  await tick(70);
  denied.w.eval(SCRIPT);
  await tick(70);
  assert.equal(denied.d.querySelector('[data-view="test-mode"]').classList.contains('hidden'), true);
  denied.dom.window.close();
  const allowed = await openMode();
  assert.equal(allowed.d.getElementById('view-test-mode').classList.contains('hidden'), false);
  allowed.w.ATLASTestMode.stop();
  allowed.dom.window.close();
});

test('E2E mock caméra: autorisation, burst JPEG redimensionné, identité, timings, arrêt des tracks, aucun endpoint de présence', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('tm-site').value = '12';
  ctx.d.getElementById('tm-site').dispatchEvent(new ctx.w.Event('change'));
  await ctx.w.ATLASTestMode.start();
  await tick(1300);
  const recognize = ctx.calls.find((call) => call.path === '/api/biometrics/test-mode/recognize');
  assert.ok(recognize, 'le point de terminaison test-only est appelé');
  assert.deepEqual(Object.keys(recognize.body).sort(), ['frames', 'site_id']);
  assert.equal(recognize.body.site_id, 12);
  assert.equal(recognize.body.frames.length, 3);
  assert.ok(recognize.body.frames.every((frame) => frame.startsWith('data:image/jpeg;base64,')));
  assert.ok(ctx.requestedConstraints[0].video.facingMode, 'la caméra frontale est favorisée par défaut');
  assert.match(ctx.d.getElementById('tm-result').textContent, /VISAGE RECONNU/);
  assert.match(ctx.d.getElementById('tm-result').textContent, /Karim/);
  assert.match(ctx.d.getElementById('tm-result').textContent, /AUCUN POINTAGE ENREGISTRÉ/);
  assert.match(ctx.d.getElementById('tm-result').textContent, /0\.8276/);
  assert.match(ctx.d.getElementById('tm-result').textContent, /Détails techniques/);
  assert.equal(ctx.calls.some((call) => /\/cameras\/\d+\/recognize|\/attendance\/(scan|presences|events)/.test(call.path)), false);
  ctx.w.ATLASTestMode.stop();
  assert.equal(ctx.tracks.at(-1).stopped, true);
  const before = ctx.calls.filter((call) => call.path === '/api/biometrics/test-mode/recognize').length;
  await tick(2700);
  assert.equal(ctx.calls.filter((call) => call.path === '/api/biometrics/test-mode/recognize').length, before);
  ctx.dom.window.close();
});

test('reconnaissance jamais concurrente et arrêt annule le timer et le flux', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('tm-site').value = '12';
  const originalFetch = ctx.w.fetch;
  let inFlight = 0, maximum = 0;
  ctx.w.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/test-mode/recognize')) {
      inFlight++; maximum = Math.max(maximum, inFlight);
      await tick(30);
      inFlight--;
    }
    return originalFetch(url, options);
  };
  await ctx.w.ATLASTestMode.start();
  await tick(1800);
  assert.equal(maximum, 1);
  ctx.w.ATLASTestMode.stop();
  const count = ctx.calls.filter((call) => call.path.endsWith('/test-mode/recognize')).length;
  await tick(2700);
  assert.equal(ctx.calls.filter((call) => call.path.endsWith('/test-mode/recognize')).length, count);
  assert.ok(ctx.tracks.every((track) => track.stopped));
  ctx.dom.window.close();
});

test('changer de caméra utilise le périphérique sélectionné et libère l’ancienne piste', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('tm-site').value = '12';
  await ctx.w.ATLASTestMode.start();
  ctx.d.getElementById('tm-camera').value = 'usb-2';
  ctx.d.getElementById('tm-camera').dispatchEvent(new ctx.w.Event('change'));
  await tick(60);
  assert.equal(ctx.tracks[0].stopped, true);
  assert.equal(ctx.requestedConstraints.at(-1).video.deviceId.exact, 'usb-2');
  assert.equal(ctx.w.ATLASTestMode.state.devices.length, 2);
  ctx.w.ATLASTestMode.stop();
  assert.equal(ctx.tracks.at(-1).stopped, true);
  ctx.dom.window.close();
});

test('codes métier affichés selon le contrat, aucune identité inconnue ni proposition de création/enrôlement', async () => {
  const ctx = await openMode();
  const states = [
    ['RECOGNIZED', 'VISAGE RECONNU'], ['UNKNOWN_FACE', 'VISAGE INCONNU'], ['NO_FACE', 'AUCUN VISAGE DÉTECTÉ'],
    ['MULTIPLE_FACES', 'PLUSIEURS VISAGES DÉTECTÉS'], ['QUALITY_FAILED', 'QUALITÉ INSUFFISANTE'],
    ['LIVENESS_FAILED', 'LIVENESS REFUSÉ'], ['AMBIGUOUS', 'RÉSULTAT AMBIGU'], ['REVIEW_REQUIRED', 'VÉRIFICATION NÉCESSAIRE'],
    ['REFUSED', 'CONSENTEMENT BIOMÉTRIQUE REQUIS', 'CONSENT_REQUIRED'], ['REFUSED', 'EMPLOYÉ NON ACTIF', 'EMPLOYEE_INACTIVE'],
  ];
  for (const [state, label, reason_code] of states) {
    ctx.w.ATLASTestMode.renderResult({ mode: 'TEST', recorded: false, state, reason_code, reasons: [], match: null, liveness: { result: 'NOT_EVALUATED' }, timings_ms: {} });
    assert.match(ctx.d.getElementById('tm-result').textContent, new RegExp(label));
  }
  ctx.w.ATLASTestMode.renderResult({ mode: 'TEST', recorded: false, state: 'UNKNOWN_FACE', reason_code: null, reasons: [], match: null, liveness: { result: 'NOT_EVALUATED' }, timings_ms: {} });
  assert.doesNotMatch(ctx.d.getElementById('tm-result').textContent, /Créer employé|Enrôler|Ajouter visage/);
  assert.match(ctx.d.getElementById('tm-result').textContent, /Non évalué/);
  ctx.w.ATLASTestMode.renderResult({ mode: 'TEST', recorded: false, state: 'QUALITY_FAILED', reason_code: null, reasons: [], match: null, liveness: { result: 'NOT_EVALUATED' }, timings_ms: {} });
  assert.doesNotMatch(ctx.d.getElementById('tm-result').textContent, /Rapprochez-vous|Restez immobile/);
  ctx.w.ATLASTestMode.renderResult({ mode: 'TEST', recorded: false, state: 'QUALITY_FAILED', reason_code: null, reasons: ['Visage trop petit — approchez-vous'], match: null, liveness: { result: 'NOT_EVALUATED' }, timings_ms: {} });
  assert.match(ctx.d.getElementById('tm-result').textContent, /Rapprochez-vous de la caméra/);
  ctx.w.ATLASTestMode.stop();
  ctx.dom.window.close();
});

test('caméra refusée / absente et statut service traité sans laisser un MediaStream actif', async () => {
  for (const [errorStatus, expected] of [['camera-denied', /CAMÉRA NON AUTORISÉE/], ['no-camera', /CAMÉRA INDISPONIBLE/]]) {
    const ctx = await openMode({ errorStatus });
    ctx.d.getElementById('tm-site').value = '12';
    await ctx.w.ATLASTestMode.start();
    assert.match(ctx.d.getElementById('tm-state').textContent, expected);
    assert.equal(ctx.w.ATLASTestMode.state.stream, null);
    ctx.dom.window.close();
  }
});

test('413 réduit les captures suivantes; 422 réessaie et 429 suspend au Retry-After', async () => {
  for (const [errorStatus, expected] of [[413, /résolution réduite/], [422, /Image caméra invalide/], [429, /pause temporaire/]]) {
    const ctx = await openMode({ errorStatus });
    ctx.d.getElementById('tm-site').value = '12';
    await ctx.w.ATLASTestMode.start();
    await tick(2200);
    assert.match(ctx.d.getElementById('tm-state').textContent, expected);
    if (errorStatus === 413) assert.equal(ctx.w.ATLASTestMode.state.maxSide, 960);
    const count = ctx.calls.filter((call) => call.path.endsWith('/test-mode/recognize')).length;
    assert.equal(count, 1, 'aucune seconde analyse pendant la pause');
    ctx.w.ATLASTestMode.stop();
    ctx.dom.window.close();
  }
});

test('feature flag ou moteur indisponible : aucun accès caméra ni tentative de reconnaissance', async () => {
  for (const status of [{ ...STATUS, test_mode_enabled: false }, { ...STATUS, engine_available: false }]) {
    const ctx = await openMode({ status });
    ctx.d.getElementById('tm-site').value = '12';
    await ctx.w.ATLASTestMode.start();
    assert.equal(ctx.requestedConstraints.length, 0);
    assert.equal(ctx.calls.some((call) => call.path.endsWith('/test-mode/recognize')), false);
    ctx.dom.window.close();
  }
});

test('garde source: le module frontend ne référence que les deux endpoints test-only', () => {
  assert.match(SCRIPT, /\/api\/biometrics\/test-mode\/status/);
  assert.match(SCRIPT, /\/api\/biometrics\/test-mode\/recognize/);
  assert.doesNotMatch(SCRIPT, /\/api\/biometrics\/cameras\/|\/api\/attendance\//);
});

test('E2E Chrome caméra virtuelle: desktop et mobile 390 px, aucun appel de production', { skip: !CHROME ? 'Chrome absent; fournir PUPPETEER_EXECUTABLE_PATH' : false }, async (t) => {
  const html = HTML;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/static/pointage/test-mode.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(SCRIPT); }
    if (req.url.startsWith('/static/design-system/atlas.css')) { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(''); }
    if (req.url.startsWith('/static/sgdi-icon-192.png')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-first-run'] });
  t.after(async () => { await browser.close().catch(() => {}); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage();
  const apiCalls = [];
  await page.evaluateOnNewDocument(() => sessionStorage.setItem('atlas_pointage_token', 'tok'));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return req.continue();
    const url = new URL(req.url());
    apiCalls.push({ path: url.pathname, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null });
    const data = url.pathname === '/api/auth/me' ? { username: 'E2E', full_name: 'Test E2E' }
      : url.pathname === '/api/attendance/sites' ? [{ id: 12, name: 'Site E2E', society: 'ATLAS' }]
      : url.pathname === '/api/attendance/board' ? { date: '2026-09-29', kpi: {}, total: 0, page: 1, page_size: 25, pages: 1, items: [] }
      : url.pathname === '/api/attendance/anomalies' ? { total: 0, page: 1, page_size: 25, pages: 1, items: [] }
      : url.pathname === '/api/biometrics/test-mode/status' ? STATUS
      : url.pathname === '/api/biometrics/test-mode/recognize' ? recognized : {};
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="test-mode"]:not(.hidden)');
  await page.click('[data-view="test-mode"]');
  await page.select('#tm-site', '12');
  await page.click('#tm-start');
  await page.waitForFunction(() => document.querySelector('#tm-result')?.textContent.includes('VISAGE RECONNU'), { timeout: 15000 });
  assert.match(await page.$eval('#tm-result', (el) => el.textContent), /AUCUN POINTAGE ENREGISTRÉ/);
  assert.equal(apiCalls.some((call) => /\/cameras\/\d+\/recognize|\/attendance\/(scan|presences|events)/.test(call.path)), false);
  for (const width of [1024, 768]) {
    await page.setViewport({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `aucun overflow à ${width}px`);
    assert.equal(await page.$eval('#view-test-mode', (section) => !section.classList.contains('hidden')), true);
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.equal(await page.$eval('#view-test-mode', (section) => !section.classList.contains('hidden')), true);
  assert.equal(await page.$eval('.test-mode-video-wrap', (video) => video.getBoundingClientRect().width > 0), true);
  assert.match(await page.$eval('#tm-result', (result) => result.textContent), /VISAGE RECONNU/);
  assert.equal(await page.$eval('#tm-video', (video) => video.playsInline), true);
  const stopButton = await page.$eval('#tm-stop', (button) => ({ height: button.getBoundingClientRect().height, minHeight: getComputedStyle(button).minHeight, cssHeight: getComputedStyle(button).height, viewport: window.innerWidth, sectionClass: document.querySelector('#view-test-mode').className, appClass: document.querySelector('#app').className, actionClass: button.parentElement.className }));
  assert.ok(stopButton.height >= 44, JSON.stringify(stopButton));
  await page.click('#tm-stop');
  assert.equal(await page.$eval('#tm-video', (video) => video.srcObject === null), true);
});
