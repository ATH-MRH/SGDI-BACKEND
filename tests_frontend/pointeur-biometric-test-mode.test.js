// ATLAS — « Mode Test facial » du terminal pointeur (pointeur.irongs.com).
//
// Tests jsdom sur la VRAIE page app/static/pointeur.html : le moteur partagé
// (app/static/pointage/test-mode.js) et l'adaptateur terminal sont évalués tels quels ;
// seuls le réseau et la caméra sont simulés. Couvre : visibilité selon permission (§41),
// caméra et payload (§10/§14/§15), garde de session asynchrone (§43), zéro pointage (§44),
// cycle de vie entre les vues (§20), réponse de sécurité (§21), codes métier (§22–§27) et
// erreurs HTTP (§31–§36).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { loadPointeur } = require('./load-pointeur');

const STATIC_DIR = path.join(__dirname, '../app/static');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((candidate) => fs.existsSync(candidate));
const CORE = fs.readFileSync(path.join(__dirname, '../app/static/pointage/test-mode.js'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(__dirname, '../app/static/pointeur-test-mode.js'), 'utf8');
const POINTUER_HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointeur.html'), 'utf8');
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

const STATUS = {
  test_mode_enabled: true, production_enabled: false, records_attendance: false, engine_available: true,
  permitted: true, max_frames: 6, max_frame_bytes: 3000000, max_side_px: 4096, max_per_minute: 30,
};
const RECOGNIZED = {
  mode: 'TEST', recorded: false, state: 'RECOGNIZED', reason_code: null, message: 'Employé reconnu (test — aucun pointage)',
  employee: { employee_id: 42, matricule: 'A0042', nom: 'BENALI', prenom: 'Karim', fonction: 'Magasinier', site: 'ENTREPOT PRINCIPAL' },
  match: { candidates: 14, confidence: 0.8276, threshold: 0.363, review_margin: 0.07 },
  liveness: { result: 'PASS', score: 0.872, threshold: 0.8 }, quality: { face_px: 312 }, site_id: 12,
  engine: 'opencv-yunet-sface-minifasnet', frames: 3,
  timings_ms: { upload: 0.2, validation: 0.2, detection: 15.2, quality: 0.2, embedding: 4.9, liveness: 1.2, matching: 1.8, total: 26.9 },
};
const SITES = [{ id: 12, name: 'ENTREPOT PRINCIPAL' }, { id: 13, name: 'AUTRE SITE' }];
const SESSION = { token: 'tok-pointeur', username: 'PTG01', user: { username: 'PTG01', full_name: 'Pointeur Test' } };

async function boot({
  permitted = true, status = STATUS, result = RECOGNIZED, errorStatus, errorDetail,
  cameras = [{ deviceId: 'front-1', kind: 'videoinput', label: 'FaceTime HD Camera' }, { deviceId: 'rear-2', kind: 'videoinput', label: 'Caméra arrière' }],
  sites = SITES, session = SESSION, withSession = true,
} = {}) {
  const calls = [], tracks = [], requestedConstraints = [];
  const mockStatus = { ...status, permitted };
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    calls.push({ path: u.pathname, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).Authorization, at: Date.now() });
    let statusCode = 200, data = {};
    const fail = (code, codeName, message) => { statusCode = code; data = { detail: errorDetail || { code: codeName, message } }; };
    if (u.pathname === '/api/portal/attendance-sites') data = sites;
    else if (u.pathname === '/api/portal/attendance-feed') data = [];
    else if (u.pathname === '/api/portal/attendance-staffing') data = { source: 'dc', contractual: { source: 'dc', requirements: {} }, sites: [] };
    else if (u.pathname === '/api/biometrics/test-mode/status') {
      if (errorStatus === 'status-401') { statusCode = 401; data = { detail: 'Session expirée' }; }
      else if (errorStatus === 'status-forbidden') fail(403, null, 'Permission biométrique explicite requise');
      else data = mockStatus;
    } else if (u.pathname === '/api/biometrics/test-mode/recognize') {
      if (typeof errorStatus === 'number') fail(errorStatus, errorStatus === 429 ? 'RATE_LIMITED' : errorStatus === 413 ? 'IMAGE_TOO_LARGE' : errorStatus === 422 ? 'INVALID_IMAGE' : 'TEST_MODE_DISABLED', 'erreur de test');
      else if (errorStatus === 'unsafe-response') data = { ...result, recorded: true };
      else if (errorStatus === 'unsafe-mode') data = { ...result, mode: 'ATTENDANCE' };
      else data = result;
    }
    return {
      ok: statusCode < 400, status: statusCode, json: async () => data, blob: async () => new Blob(['x']),
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' && statusCode === 429 ? '5' : null) },
    };
  };
  const ctx = loadPointeur({ url: 'https://pointeur.irongs.com/', fetch, session: withSession ? session : null });
  const w = ctx.window;
  test.after(() => { try { w.PointerTestMode && w.PointerTestMode.stop(); w.close(); } catch (e) { /* fenêtre déjà fermée */ } });

  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get() { return this.srcObject ? 1920 : 0; } });
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get() { return this.srcObject ? 1080 : 0; } });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = function (type) { return `data:${type};base64,ZmFrZQ==`; };
  Object.defineProperty(w.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        requestedConstraints.push(constraints);
        if (errorStatus === 'camera-denied') throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        if (errorStatus === 'no-camera') throw Object.assign(new Error('none'), { name: 'NotFoundError' });
        const track = { stopped: false, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, end() { this.listeners.ended && this.listeners.ended(); }, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: 'front-1' }) };
        tracks.push(track);
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      },
      enumerateDevices: async () => cameras,
    },
  });

  await tick(60);                                   // initialisation réelle de la page (sites chargés)
  w.eval(CORE);
  w.eval(ADAPTER);
  await tick(80);
  return {
    ...ctx, w, d: w.document, calls, tracks, requestedConstraints,
    recognize: () => calls.filter((call) => call.path.endsWith('/test-mode/recognize')),
  };
}

const openMode = async (options) => {
  const ctx = await boot(options);
  assert.equal(ctx.d.getElementById('testModeNav').classList.contains('hidden'), false, 'le bouton Mode Test est visible pour un compte autorisé');
  ctx.w.showPointerSection('testmode');
  await tick(40);
  return ctx;
};

test('§41 visibilité : ni session, ni droit, ni mode activé ⇒ le bouton Mode Test reste absent', async () => {
  const anonymous = await boot({ withSession: false });
  assert.equal(anonymous.d.getElementById('testModeNav').classList.contains('hidden'), true, 'aucune session : aucune requête de statut, bouton masqué');
  assert.equal(anonymous.calls.some((call) => call.path.endsWith('/test-mode/status')), false);
  anonymous.w.close();

  const denied = await boot({ permitted: false });
  assert.equal(denied.d.getElementById('testModeNav').classList.contains('hidden'), true, 'permission biométrique absente : fonctionnalité non exposée');
  denied.w.close();

  const forbidden = await boot({ errorStatus: 'status-forbidden' });
  assert.equal(forbidden.d.getElementById('testModeNav').classList.contains('hidden'), true, '403 sur le statut : bouton masqué, aucune porte dérobée');
  forbidden.w.close();

  const disabled = await boot({ status: { ...STATUS, test_mode_enabled: false } });
  assert.equal(disabled.d.getElementById('testModeNav').classList.contains('hidden'), true, 'BIOMETRIC_TEST_MODE_ENABLED=false : bouton masqué');
  disabled.w.close();

  const granted = await boot();
  assert.equal(granted.d.getElementById('testModeNav').classList.contains('hidden'), false, 'mode activé + permission : bouton disponible');
  assert.equal(granted.d.getElementById('faceNav').textContent.trim(), 'Facial', 'le bouton Facial existant reste intact et distinct');
  granted.w.close();
});

test('§17 site jamais saisi : la liste vient du sélecteur du terminal et suit le site choisi', async () => {
  const ctx = await openMode();
  const siteSelect = ctx.d.getElementById('ptm-site');
  assert.deepEqual(Array.from(siteSelect.options).map((o) => o.value), ['', '12', '13'], 'aucune saisie libre de site_id');
  assert.equal(siteSelect.value, '12', 'le site courant du terminal est repris');
  ctx.d.getElementById('siteSelector').value = '13';
  ctx.w.changeAttendanceSite('13');
  await tick(60);
  assert.equal(ctx.d.getElementById('ptm-site').value, '13', 'changer de site côté terminal change le site du Mode Test');
  ctx.w.close();
});

test('§10/§14/§15/§23 parcours complet : caméra frontale, 3 JPEG, payload strict, identité affichée, zéro pointage', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  ctx.d.getElementById('ptm-site').dispatchEvent(new ctx.w.Event('change'));
  await ctx.w.PointerTestMode.start();
  await tick(1300);

  assert.ok(ctx.requestedConstraints.length >= 1, 'getUserMedia est appelé');
  assert.ok(ctx.requestedConstraints[0].video.facingMode, 'la caméra frontale est favorisée sur smartphone');
  const recognize = ctx.recognize()[0];
  assert.ok(recognize, 'le point de terminaison test-only est appelé');
  assert.deepEqual(Object.keys(recognize.body).sort(), ['frames', 'site_id'], 'aucun champ inventé dans le payload');
  assert.equal(recognize.body.site_id, 12, 'site_id numérique repris du sélecteur');
  assert.equal(recognize.body.frames.length, 3, '3 trames');
  assert.ok(recognize.body.frames.every((frame) => frame.startsWith('data:image/jpeg;base64,')), 'trames JPEG en mémoire');
  assert.equal(recognize.auth, 'Bearer tok-pointeur', 'jeton de la session du terminal');

  const result = ctx.d.getElementById('ptm-result').textContent;
  assert.match(result, /VISAGE RECONNU/);
  assert.match(result, /Karim/);
  assert.match(result, /A0042/);
  assert.match(result, /TEST UNIQUEMENT — AUCUN POINTAGE ENREGISTRÉ/);
  assert.match(result, /0\.8276/, 'score brut, jamais converti en pourcentage de certitude');
  assert.match(result, /Détails techniques/);
  assert.match(result, /Liveness : Réussi/);

  // §44 : aucun appel d'écriture de présence, facial de production inclus.
  assert.equal(ctx.calls.some((call) => /\/cameras\/\d+\/recognize|\/attendance\/(scan|presences|events)|\/api\/attendance\//.test(call.path)), false,
    'aucune route de pointage appelée');

  ctx.w.PointerTestMode.stop();
  assert.equal(ctx.tracks.at(-1).stopped, true, 'les MediaStreamTracks sont arrêtées');
  assert.equal(ctx.d.getElementById('ptm-video').srcObject, null, 'le flux est vidé');
  const before = ctx.recognize().length;
  await tick(2700);
  assert.equal(ctx.recognize().length, before, 'plus aucune analyse après arrêt (§16)');
  ctx.w.close();
});

test('§16 cadence : jamais deux reconnaissances concurrentes et au moins 2,5 s entre deux analyses', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  let inFlight = 0, maximum = 0;
  const originalFetch = ctx.w.fetch;
  ctx.w.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/test-mode/recognize')) {
      inFlight++; maximum = Math.max(maximum, inFlight);
      await tick(30);
      inFlight--;
    }
    return originalFetch(url, options);
  };
  await ctx.w.PointerTestMode.start();
  await tick(6200);
  assert.equal(maximum, 1, 'une seule requête à la fois');
  const stamps = ctx.recognize().map((call) => call.at);
  assert.ok(stamps.length >= 2, 'plusieurs analyses sur 6 s');
  assert.ok(stamps.slice(1).every((stamp, index) => stamp - stamps[index] >= 2400), `cadence ≥ 2,5 s (${stamps})`);
  ctx.w.PointerTestMode.stop();
  ctx.w.close();
});

test('§21 réponse non conforme au contrat : arrêt immédiat et message de sécurité', async () => {
  for (const errorStatus of ['unsafe-response', 'unsafe-mode']) {
    const ctx = await openMode({ errorStatus });
    ctx.d.getElementById('ptm-site').value = '12';
    await ctx.w.PointerTestMode.start();
    await tick(1200);
    assert.match(ctx.d.getElementById('ptm-state').textContent, /RÉPONSE DE SÉCURITÉ INVALIDE/, errorStatus);
    assert.equal(ctx.w.PointerTestMode.isRunning(), false, 'la session est stoppée, aucune poursuite silencieuse');
    assert.equal(ctx.tracks.at(-1).stopped, true, 'la caméra est libérée');
    assert.equal(ctx.d.getElementById('ptm-result').classList.contains('hidden'), true, 'aucun résultat exploité');
    ctx.w.close();
  }
});
test('§20 changement de vue : Scanner, Planning ou Facial arrêtent proprement le Mode Test', async () => {
  for (const section of ['scan', 'planning', 'facial']) {
    const ctx = await openMode();
    ctx.d.getElementById('ptm-site').value = '12';
    await ctx.w.PointerTestMode.start();
    await tick(900);
    assert.equal(ctx.w.PointerTestMode.isRunning(), true, `Mode Test démarré avant passage à ${section}`);
    ctx.w.showPointerSection(section);
    await tick(40);
    assert.equal(ctx.w.PointerTestMode.isRunning(), false, `le Mode Test s'arrête quand on quitte la vue (${section})`);
    assert.equal(ctx.tracks.at(-1).stopped, true, `plus aucune caméra en arrière-plan (${section})`);
    assert.equal(ctx.d.getElementById('testModeView').classList.contains('hidden'), true, `la vue Mode Test est masquée (${section})`);
    ctx.w.close();
  }
});

test('§43 session asynchrone : arrêt pendant l\'autorisation caméra — aucune caméra active, aucune analyse tardive', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  const media = ctx.w.navigator.mediaDevices, fast = media.getUserMedia;
  let release;
  media.getUserMedia = () => new Promise((resolve) => { release = async () => resolve(await fast({ audio: false, video: {} })); });
  const first = ctx.w.PointerTestMode.start();
  for (let i = 0; i < 40 && !release; i++) await tick(10);
  assert.equal(typeof release, 'function', 'getUserMedia a été atteint pendant le test de permission');
  ctx.w.PointerTestMode.stop();                       // l'utilisateur appuie sur ARRÊTER pendant l'invite
  await release();                                    // … puis que la permission se résout enfin
  await Promise.race([first, tick(1000).then(() => { throw new Error("le démarrage annulé doit se résoudre après le retour de getUserMedia"); })]);
  await tick(400);
  assert.equal(ctx.w.PointerTestMode.isRunning(), false, 'aucune caméra ne reste active');
  assert.equal(ctx.recognize().length, 0, 'aucune analyse n\'est lancée par la session annulée');
  assert.ok(ctx.tracks.every((track) => track.stopped), 'les pistes arrivées en retard sont libérées');
  ctx.w.close();
});

test('§43 deux sessions : la session A arrêtée ne peut jamais couper la session B', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  const first = ctx.w.PointerTestMode.start();
  for (let i = 0; i < 200 && !(ctx.w.PointerTestMode.state() && ctx.w.PointerTestMode.state().stream); i++) await tick(5);
  assert.ok(ctx.w.PointerTestMode.state().stream, 'flux ouvert, préchauffage en cours');
  const media = ctx.w.navigator.mediaDevices, fast = media.getUserMedia;
  media.getUserMedia = async (constraints) => { await tick(700); return fast(constraints); };
  ctx.w.PointerTestMode.stop();
  const second = ctx.w.PointerTestMode.start();
  await Promise.all([first, second]);
  await tick(5200);
  assert.equal(ctx.w.PointerTestMode.isRunning(), true, 'la nouvelle session tourne toujours');
  assert.ok(ctx.w.PointerTestMode.state().stream, 'le flux de la nouvelle session est conservé');
  assert.doesNotMatch(ctx.d.getElementById('ptm-state').textContent, /INDISPONIBLE/, "aucune erreur tardive de l'ancienne session");
  assert.equal(ctx.tracks[0].stopped, true, 'la piste de la session A est libérée');
  assert.equal(ctx.tracks.at(-1).stopped, false, 'la piste de la session B reste active');
  ctx.w.PointerTestMode.stop();
  ctx.w.close();
});

test('§42 caméra : refus, absence, caméra unique et changement de périphérique', async () => {
  for (const [errorStatus, pattern] of [['camera-denied', /CAMÉRA NON AUTORISÉE/], ['no-camera', /CAMÉRA INDISPONIBLE/]]) {
    const ctx = await openMode({ errorStatus });
    ctx.d.getElementById('ptm-site').value = '12';
    await ctx.w.PointerTestMode.start();
    await tick(250);
    assert.match(ctx.d.getElementById('ptm-state').textContent, pattern, errorStatus);
    assert.equal(ctx.w.PointerTestMode.isRunning(), false, 'aucune session fantôme');
    assert.equal(ctx.recognize().length, 0, "jamais d'analyse sans flux vidéo");
    ctx.w.close();
  }

  const single = await openMode({ cameras: [{ deviceId: 'front-1', kind: 'videoinput', label: 'FaceTime HD Camera' }] });
  single.d.getElementById('ptm-site').value = '12';
  await single.w.PointerTestMode.start();
  await tick(900);
  assert.equal(single.d.getElementById('ptm-camera').disabled, true, 'une seule caméra : aucun choix inutile proposé');
  single.w.PointerTestMode.stop();
  single.w.close();

  const ctx = await openMode();                        // Mac / PC : deux caméras déclarées
  ctx.d.getElementById('ptm-site').value = '12';
  await ctx.w.PointerTestMode.start();
  assert.equal(ctx.d.getElementById('ptm-camera').disabled, false, 'plusieurs caméras : le choix est offert');
  ctx.d.getElementById('ptm-camera').value = 'rear-2';
  ctx.d.getElementById('ptm-camera').dispatchEvent(new ctx.w.Event('change'));
  await tick(1800);
  assert.equal(ctx.tracks[0].stopped, true, "l'ancienne piste est libérée");
  assert.equal(ctx.requestedConstraints.at(-1).video.deviceId.exact, 'rear-2', 'le périphérique choisi est utilisé, sans supposer son nom');
  assert.ok(ctx.recognize().length >= 1, 'les analyses reprennent après le changement de caméra');
  ctx.w.PointerTestMode.stop();
  ctx.w.close();
});

test('§43 annulation pendant GET status : Arrêter invalide le démarrage avant la permission caméra', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  const originalFetch = ctx.w.fetch;
  let releaseStatus;
  ctx.w.fetch = (url, options) => String(url).endsWith('/test-mode/status')
    ? new Promise((resolve) => { releaseStatus = () => resolve({ ok: true, status: 200, json: async () => STATUS }); })
    : originalFetch(url, options);
  const pendingStart = ctx.w.PointerTestMode.start();
  await tick(30);
  ctx.w.PointerTestMode.stop();
  releaseStatus();
  await pendingStart;
  await tick(450);
  assert.equal(ctx.w.PointerTestMode.isRunning(), false);
  assert.equal(ctx.requestedConstraints.length, 0, 'un statut tardif ne doit pas demander la caméra');
  assert.equal(ctx.recognize().length, 0, 'aucune analyse après annulation du GET status');
  assert.match(ctx.d.getElementById('ptm-state').textContent, /PRÊT/, 'aucune erreur tardive affichée');
  ctx.w.close();
});

test('§43 statut tardif de A ne peut ni démarrer ni arrêter la session B', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  const originalFetch = ctx.w.fetch;
  let statusCalls = 0, releaseA;
  ctx.w.fetch = (url, options) => {
    if (!String(url).endsWith('/test-mode/status')) return originalFetch(url, options);
    statusCalls++;
    if (statusCalls === 1) return new Promise((resolve) => { releaseA = () => resolve({ ok: true, status: 200, json: async () => STATUS }); });
    return originalFetch(url, options);
  };
  const first = ctx.w.PointerTestMode.start();
  await tick(20);
  assert.equal(typeof releaseA, 'function', 'la session A a atteint le GET status différé');
  ctx.w.PointerTestMode.stop();
  await ctx.w.PointerTestMode.start();
  const trackB = ctx.tracks.at(-1);
  assert.ok(trackB && !trackB.stopped, 'B a sa caméra active');
  releaseA();
  await first;
  await tick(30);
  assert.equal(ctx.w.PointerTestMode.isRunning(), true, 'la réponse A ne coupe pas B');
  assert.equal(ctx.w.PointerTestMode.state().stream.getVideoTracks()[0], trackB);
  assert.equal(trackB.stopped, false);
  ctx.w.PointerTestMode.stop();
  ctx.w.close();
});

test('§20 changement de site arrête la caméra avant d’utiliser le nouveau site', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  await ctx.w.PointerTestMode.start();
  await tick(900);
  const before = ctx.recognize().length;
  ctx.d.getElementById('siteSelector').value = '13';
  await ctx.w.changeAttendanceSite('13');
  assert.equal(ctx.w.PointerTestMode.isRunning(), false);
  assert.equal(ctx.tracks.at(-1).stopped, true, 'la caméra est libérée au changement de périmètre');
  assert.equal(ctx.d.getElementById('ptm-site').value, '13');
  await tick(2700);
  assert.equal(ctx.recognize().length, before, 'aucune requête ne continue sur l’ancien site');
  ctx.w.close();
});

test('§45/§46 E2E Chrome avec caméra virtuelle : 390/430/768/1024/1440, Facial séparé, aucun pointage', { skip: !CHROME ? 'Chrome absent; fournir PUPPETEER_EXECUTABLE_PATH' : false }, async (t) => {
  const html = fs.readFileSync(path.join(STATIC_DIR, 'pointeur.html'), 'utf8');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
    if (pathname.startsWith('/static/')) {
      const filePath = path.resolve(STATIC_DIR, pathname.slice('/static/'.length));
      if (!filePath.startsWith(STATIC_DIR + path.sep) || !fs.existsSync(filePath)) { res.writeHead(404); return res.end(); }
      res.writeHead(200); return fs.createReadStream(filePath).pipe(res);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-first-run'] });
  t.after(async () => { await browser.close().catch(() => {}); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage();
  const apiCalls = [];
  await page.evaluateOnNewDocument((session) => localStorage.setItem('atlas_pointer_session', JSON.stringify(session)), SESSION);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return req.continue();
    const url = new URL(req.url());
    const call = { path: url.pathname, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null };
    apiCalls.push(call);
    const data = url.pathname === '/api/portal/attendance-sites' ? SITES
      : url.pathname === '/api/portal/attendance-feed' ? []
      : url.pathname === '/api/portal/attendance-alerts' ? { presence_alerts: [] }
      : url.pathname === '/api/portal/attendance-staffing' ? { source: 'dc', contractual: { source: 'dc', configured: true, requirements: {} }, sites: [] }
      : url.pathname === '/api/biometrics/test-mode/status' ? STATUS
      : url.pathname === '/api/biometrics/test-mode/recognize' ? RECOGNIZED : {};
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('appView').classList.contains('hidden'));
  await page.waitForFunction(() => !document.getElementById('testModeNav').classList.contains('hidden'));
  assert.equal(await page.$eval('#faceNav', (button) => button.textContent.trim()), 'Facial', 'bouton production conservé distinctement');
  await page.click('#testModeNav');
  await page.select('#ptm-site', '12');
  await page.click('#ptm-start');
  await page.waitForFunction(() => document.getElementById('ptm-result').textContent.includes('VISAGE RECONNU'), { timeout: 15000 });
  assert.match(await page.$eval('#ptm-result', (result) => result.textContent), /AUCUN POINTAGE ENREGISTRÉ/);
  assert.match(await page.$eval('.tm-disclaimer', (el) => el.textContent), /LIVENESS RESTE NO-GO POUR LA PRODUCTION/);
  assert.equal(apiCalls.some((call) => /\/biometrics\/cameras\/\d+\/recognize|\/api\/attendance\/(scan|presences|events)|\/portal\/attendance-manual/.test(call.path)), false, 'aucune route production/écriture sollicitée');
  for (const width of [390, 430, 768, 1024, 1440]) {
    await page.setViewport({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      modeVisible: !document.getElementById('testModeView').classList.contains('hidden'),
      videoWidth: document.querySelector('.tm-video-wrap').getBoundingClientRect().width,
      startHeight: document.getElementById('ptm-start').getBoundingClientRect().height,
      stopHeight: document.getElementById('ptm-stop').getBoundingClientRect().height,
      resultVisible: document.getElementById('ptm-result').getBoundingClientRect().width > 0,
    }));
    assert.ok(layout.documentWidth <= width + 1, `pas d’overflow horizontal à ${width}px: ${JSON.stringify(layout)}`);
    assert.ok(layout.videoWidth > 0 && layout.resultVisible, `vidéo/résultat visibles à ${width}px`);
    if (width <= 430) assert.ok(layout.startHeight >= 44 && layout.stopHeight >= 44, `boutons tactiles ≥44px à ${width}px`);
  }
  await page.click('#ptm-stop');
  assert.equal(await page.$eval('#ptm-video', (video) => video.srcObject === null), true, 'le flux caméra est nettoyé à l’arrêt');
  await page.click('#faceNav');
  assert.equal(await page.$eval('#faceView', (view) => !view.classList.contains('hidden')), true, 'le bouton Facial ouvre toujours sa vue production dédiée');
});

test('§44 garde source : l’adaptateur ne contient aucune route de reconnaissance production ni d’écriture attendance', () => {
  assert.doesNotMatch(ADAPTER, /\/api\/biometrics\/cameras\//);
  assert.doesNotMatch(ADAPTER, /\/api\/attendance\//);
  assert.doesNotMatch(ADAPTER, /attendance-manual|record_scan|DailyPresence|attendance_events/);
  assert.doesNotMatch(CORE, /["'`]\/api\/biometrics\/cameras\//);
  assert.doesNotMatch(CORE, /["'`]\/api\/attendance\//);
});

test('§42 interruption caméra : ended arrête la session, la piste et affiche un état explicite', async () => {
  const ctx = await openMode();
  ctx.d.getElementById('ptm-site').value = '12';
  await ctx.w.PointerTestMode.start();
  const track = ctx.tracks.at(-1);
  assert.ok(track);
  track.end();
  assert.equal(ctx.w.PointerTestMode.isRunning(), false);
  assert.equal(track.stopped, true);
  assert.match(ctx.d.getElementById('ptm-state').textContent, /CAMÉRA INTERROMPUE/);
  ctx.w.close();
});

test('§33–§36 auth, périmètre et moteur : 401 déconnecte, 404 et 503 arrêtent sans révéler de données', async () => {
  const expired = await boot({ errorStatus: 'status-401' });
  await tick(100);
  assert.equal(expired.d.getElementById('loginView').classList.contains('hidden'), false, '401 ramène au login standard');
  assert.equal(expired.d.getElementById('testModeNav').classList.contains('hidden'), true);
  expired.w.close();

  for (const [errorStatus, errorDetail, expected] of [
    [404, { code: 'SITE_NOT_FOUND', message: 'private site data' }, /Site indisponible ou hors de votre périmètre/],
    [503, { code: 'ENGINE_UNAVAILABLE', message: 'private engine data' }, /MOTEUR BIOMÉTRIQUE INDISPONIBLE/],
  ]) {
    const ctx = await openMode({ errorStatus, errorDetail });
    ctx.d.getElementById('ptm-site').value = '12';
    await ctx.w.PointerTestMode.start();
    await tick(1500);
    assert.match(ctx.d.getElementById('ptm-state').textContent, expected);
    assert.equal(ctx.w.PointerTestMode.isRunning(), false, 'une erreur de périmètre/service interrompt le flux');
    assert.doesNotMatch(ctx.d.getElementById('ptm-state').textContent, /private/);
    assert.equal(ctx.tracks.at(-1).stopped, true);
    ctx.w.close();
  }
});

test('§36 séparation UI : le bouton Facial conserve sa vue production et Mode Test reste une entrée distincte', () => {
  assert.match(POINTUER_HTML, /<button id="faceNav"[^>]*onclick="showPointerSection\('facial'\)">Facial<\/button>/);
  assert.match(POINTUER_HTML, /<button id="testModeNav"[^>]*onclick="showPointerSection\('testmode'\)"[^>]*>Mode Test<\/button>/);
  assert.match(POINTUER_HTML, /window\.PointeurFacial&&PointeurFacial\.start\(\)/);
  assert.match(ADAPTER, /start:\s*\(\)\s*=>\s*\(engine\(\)\s*\?\s*engine\(\)\.start\(\)/);
});
// Fin des gardes de séparation du terminal.

