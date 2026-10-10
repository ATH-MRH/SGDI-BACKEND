// Borne de pointage (tablette / smartphone) — tests jsdom sur le VRAI app/static/pointeur-borne.html
// et pointeur-borne.js. Réseau, caméra et stockage simulés ; WebCrypto RÉEL (Node) : les
// signatures sont vérifiées comme le serveur les recalcule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '../app/static');
const JS = fs.readFileSync(path.join(ROOT, 'pointeur-borne.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'pointeur-borne.html'), 'utf8')
  .replace(/<script src="\/static\/pointeur-borne\.js[^"]*"><\/script>/, `<script>${JS}</script>`);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const SESSION = { terminal: { terminal_id: 'trm_1', name: 'TAB-01', terminal_type: 'TABLET_ANDROID', site_id: 3, site: 'HAMOUL 01', society: 'IRON GLOBAL SOLUTION' },
  facial: { available: true, code: null, message: '' }, qr: { available: true }, burst: { frames: 3, interval_ms: 1, max_side: 800, jpeg_quality: 0.85 },
  challenge_ttl: 10, server_time: Date.now() };
const RECORDED = (action, heure) => ({ state: 'ATTENDANCE_RECORDED', recorded: true, message: 'POINTAGE ENREGISTRÉ', action, heure,
  employee: { nom: 'OUALI', prenom: 'Amine', matricule: 'A0001' }, confidence: 0.81, liveness: 0.97 });

async function boot({ routes = {}, identity = true, hash = '', media, barcode = null } = {}) {
  const calls = [];
  const store = { data: {}, async get(k) { return this.data[k]; }, async set(k, v) { this.data[k] = v; }, async clear() { this.data = {}; } };
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  if (identity) store.data.identity = { terminal_id: 'trm_1', privateKey: keys.privateKey, camera: null };
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(HTML, {
    url: `https://pointeur.irongs.com/borne${hash}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) { w.__ATLAS_BORNE_NO_AUTOSTART__ = true; w.TextEncoder = TextEncoder; },
  });
  const w = dom.window;
  const B = w.AtlasBorne;
  let now = 1_000_000;
  let scene = 0;
  const track = { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; }, stop() {} };
  B.deps = {
    subtle: () => webcrypto.subtle,
    store,
    now: () => now,
    media: () => media || { getUserMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }), enumerateDevices: async () => [] },
    barcode: () => barcode,
    faceDetector: () => null,
    fetch: async (url, opts = {}) => {
      const u = new URL(url, 'https://pointeur.irongs.com');
      const call = { path: u.pathname, method: opts.method || 'GET', headers: opts.headers || {}, rawBody: opts.body || '', body: opts.body ? JSON.parse(opts.body) : null };
      calls.push(call);
      const found = routes[`${call.method} ${u.pathname}`];
      const [status, data] = await (typeof found === 'function' ? found(call) : (found || [200, {}]));
      if (status === 'NETWORK') throw new TypeError('Failed to fetch');
      return { ok: status < 400, status, json: async () => data };
    },
  };
  B.sample = () => new Uint8Array(768).fill(scene);
  B.capture = () => `data:image/jpeg;base64,${Buffer.from(`frame-${Math.random()}`).toString('base64')}`;
  const ctx = {
    dom, w, d: w.document, B, calls, store, keys, track,
    setScene(v) { scene = v; }, advance(ms) { now += ms; },
    status: () => w.document.getElementById('kioskStatus'),
    text: () => w.document.getElementById('kioskStatus').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    count: (p) => calls.filter((c) => c.path === '/api/biometrics' + p).length,
    async motion() { scene = (scene + 40) % 250; await B.tick(); },
  };
  return ctx;
}

const facialRoutes = (recognize) => ({
  'GET /api/biometrics/terminal/session': [200, SESSION],
  'POST /api/biometrics/terminal/challenge': (() => { let n = 0; return () => [200, { challenge_id: ++n, nonce: 'n'.repeat(43) + n, expires_in: 10, burst: SESSION.burst }]; })(),
  'POST /api/biometrics/terminal/recognize': recognize,
});

async function started(opts) {
  const ctx = await boot(opts);
  await ctx.B.boot();
  ctx.B.running = false;              // les tests pilotent B.tick() eux-mêmes
  clearTimeout(ctx.B.timer);
  ctx.B.lastAnalyzed = ctx.B.sample(); // scène vide déjà analysée au démarrage
  await ctx.B.tick();                 // premier échantillon : référence du détecteur de mouvement
  return ctx;
}

test('association : code du QR pré-rempli puis retiré de l\'URL, clé non extractible, seule la clé PUBLIQUE est envoyée', async () => {
  const ctx = await boot({ identity: false, hash: '#pair=ABCDEFGHJK', routes: {
    'POST /api/biometrics/terminal/pair': [200, { terminal_id: 'trm_new', name: 'TAB-01', site: 'HAMOUL 01' }],
    'GET /api/biometrics/terminal/session': [200, SESSION] } });
  await ctx.B.boot();
  assert.equal(ctx.d.getElementById('kioskPairing').hidden, false);
  assert.equal(ctx.d.getElementById('pairCode').value, 'ABCDEFGHJK');
  assert.equal(ctx.w.location.hash, '');
  ctx.d.getElementById('pairForm').dispatchEvent(new ctx.w.Event('submit', { cancelable: true }));
  await tick(150);
  const pair = ctx.calls.find((c) => c.path.endsWith('/terminal/pair'));
  assert.deepEqual(Object.keys(pair.body.public_key).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(pair.headers['X-Atlas-Signature'], undefined);             // aucune identité avant association
  const stored = ctx.store.data.identity;
  assert.equal(stored.terminal_id, 'trm_new');
  assert.equal(stored.privateKey.extractable, false);
  assert.equal(stored.privateKey.type, 'private');
  await assert.rejects(webcrypto.subtle.exportKey('jwk', stored.privateKey));
  assert.equal(ctx.d.getElementById('kioskPairing').hidden, true);
  // Requêtes suivantes signées : message canonique vérifiable avec la clé publique envoyée.
  const session = ctx.calls.find((c) => c.path.endsWith('/terminal/session'));
  const pub = await webcrypto.subtle.importKey('jwk', { ...pair.body.public_key, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const h = session.headers;
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(''))).toString('hex');
  const message = ['ATLAS-TERMINAL-1', 'trm_new', 'GET', '/api/biometrics/terminal/session', h['X-Atlas-Timestamp'], digest].join('\n');
  const sig = Buffer.from(h['X-Atlas-Signature'].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.equal(sig.length, 64);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, Buffer.from(message)), true);
  assert.equal(h['X-Atlas-Terminal'], 'trm_new');
  ctx.dom.window.close();
});

test('caméra frontale par défaut ; refusée ou interrompue : message clair, aucune requête biométrique', async () => {
  let constraints = null;
  const ok = await started({ routes: facialRoutes(() => [200, {}]), media: { getUserMedia: async (c) => { constraints = c; return { getVideoTracks: () => [], getTracks: () => [] }; } } });
  assert.deepEqual([constraints.audio, constraints.video.facingMode], [false, 'user']);
  ok.dom.window.close();
  const denied = await started({ routes: facialRoutes(() => [200, {}]), media: { getUserMedia: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } } });
  assert.match(denied.text(), /CAMÉRA REFUSÉE/);
  assert.equal(denied.count('/terminal/challenge'), 0);
  denied.dom.window.close();
  const lost = await started({ routes: facialRoutes(() => [200, {}]) });
  lost.track.listeners.ended();
  assert.match(lost.text(), /CAMÉRA INTERROMPUE/);
  lost.dom.window.close();
});

test('parcours sans clic : mouvement → défi → rafale → ENTRÉE affichée seulement après confirmation serveur', async () => {
  let release;
  const pending = new Promise((r) => { release = r; });
  const ctx = await started({ routes: facialRoutes(() => pending) });
  assert.match(ctx.text(), /PRÉSENTEZ VOTRE VISAGE/);
  await ctx.B.tick();                                     // scène immobile : aucun envoi
  assert.equal(ctx.count('/terminal/challenge'), 0);
  const run = ctx.motion();
  await tick(40);
  assert.match(ctx.text(), /ANALYSE EN COURS/);
  assert.doesNotMatch(ctx.text(), /ENTRÉE|SORTIE/);       // jamais avant la réponse d'Attendance Core
  release([200, RECORDED('ENTRÉE', '08:03')]);
  await run;
  assert.match(ctx.text(), /OUALI Amine/); assert.match(ctx.text(), /Matricule A0001/); assert.match(ctx.text(), /ENTRÉE ENREGISTRÉE · 08:03/);
  const rec = ctx.calls.find((c) => c.path.endsWith('/terminal/recognize'));
  assert.equal(rec.body.challenge_id, 1); assert.equal(rec.body.nonce.length, 44); assert.equal(rec.body.frames.length, 3);
  assert.equal(new Set(rec.body.frames).size, 3);
  ctx.dom.window.close();
});

test('réarmement : même visage resté devant la tablette → aucune nouvelle tentative ; départ puis retour → SORTIE', async () => {
  const answers = [RECORDED('ENTRÉE', '08:03'), RECORDED('SORTIE', '17:14')];
  const ctx = await started({ routes: facialRoutes(() => [200, answers.shift()]) });
  ctx.setScene(10);
  await ctx.motion();
  assert.match(ctx.text(), /ENTRÉE ENREGISTRÉE/);
  ctx.advance(ctx.B.TIMING.RESULT_MS + 100);
  for (let i = 0; i < 5; i++) { await ctx.B.tick(); ctx.advance(300); }   // personne immobile
  assert.equal(ctx.count('/terminal/challenge'), 1);
  assert.match(ctx.text(), /ENTRÉE ENREGISTRÉE/);
  ctx.setScene(120); await ctx.B.tick();          // la scène change (départ / nouvelle personne) : réarmement + analyse
  assert.match(ctx.text(), /SORTIE ENREGISTRÉE · 17:14/);
  assert.equal(ctx.count('/terminal/challenge'), 2);
  ctx.dom.window.close();
});

test('refus : inconnu (message générique, aucune proposition d\'enrôlement), liveness, ambigu, déjà enregistré', async () => {
  const answers = [
    { state: 'UNKNOWN_FACE', recorded: false, message: 'VISAGE INCONNU' },
    { state: 'LIVENESS_FAILED', recorded: false, message: 'x' },
    { state: 'AMBIGUOUS', recorded: false, message: 'x' },
    { state: 'ALREADY_RECORDED', recorded: false, action: 'ENTRÉE', heure: '08:03', employee: { nom: 'OUALI', prenom: 'Amine', matricule: 'A0001' } },
  ];
  const ctx = await started({ routes: facialRoutes(() => [200, answers.shift()]) });
  const expect = [/EMPLOYÉ NON IDENTIFIÉ Présentez-vous au bureau pour actualiser votre photo/, /LIVENESS REFUSÉ/, /RÉSULTAT AMBIGU/, /POINTAGE DÉJÀ ENREGISTRÉ/];
  for (const re of expect) {
    ctx.advance(60000);
    ctx.B.holdScene = null;
    await ctx.motion();
    assert.match(ctx.text(), re);
    assert.doesNotMatch(ctx.d.querySelector('main').textContent, /Ajouter ce visage|Enrôler|candidat/i);
  }
  ctx.dom.window.close();
});

test('hors ligne : FAIL CLOSED — message de secours, aucune reconnaissance conservée ni rejouée', async () => {
  let online = false;
  const ctx = await started({ routes: facialRoutes(() => [200, RECORDED('ENTRÉE', '08:03')]) });
  ctx.B.deps.fetch = ((orig) => async (url, opts) => { if (!online) throw new TypeError('Failed to fetch'); return orig(url, opts); })(ctx.B.deps.fetch);
  await ctx.motion();
  assert.match(ctx.text(), /SERVICE TEMPORAIREMENT INDISPONIBLE UTILISEZ LE QR OU LA MÉTHODE DE SECOURS/);
  online = true;
  ctx.advance(ctx.B.TIMING.UNAVAILABLE_MS + 10);
  await ctx.B.tick();                                     // scène immobile : rien n'est rejoué
  assert.equal(ctx.count('/terminal/recognize'), 0);
  assert.equal(JSON.stringify(ctx.store.data).includes('frame'), false);
  ctx.dom.window.close();
});

test('terminal révoqué → identité effacée, écran d\'association ; désactivé → TERMINAL DÉSACTIVÉ', async () => {
  const revoked = await started({ routes: { ...facialRoutes(() => [200, {}]),
    'POST /api/biometrics/terminal/challenge': [401, { detail: { code: 'TERMINAL_REVOKED', message: 'Terminal révoqué' } }] } });
  await revoked.motion();
  await tick(20);
  assert.equal(revoked.store.data.identity, undefined);
  assert.equal(revoked.B.identity, null);
  assert.equal(revoked.d.getElementById('kioskPairing').hidden, false);
  assert.match(revoked.d.getElementById('pairMessage').textContent, /non autorisé/);
  revoked.dom.window.close();
  const disabled = await started({ routes: { ...facialRoutes(() => [200, {}]),
    'POST /api/biometrics/terminal/challenge': [403, { detail: { code: 'TERMINAL_DISABLED', message: 'Terminal désactivé' } }] } });
  await disabled.motion();
  assert.match(disabled.text(), /TERMINAL DÉSACTIVÉ/);
  assert.equal(disabled.B.running, false);
  disabled.dom.window.close();
});

test('facial coupé : aucune rafale envoyée, le QR de la borne reste disponible', async () => {
  const barcode = { detect: async () => [{ rawValue: 'qr-token-employe' }] };
  const ctx = await started({ barcode, routes: {
    'GET /api/biometrics/terminal/session': [200, { ...SESSION, facial: { available: false, code: 'BIOMETRIC_DISABLED', message: 'Pointage facial non activé' } }],
    'POST /api/biometrics/terminal/qr': [200, RECORDED('ENTRÉE', '07:58')] } });
  assert.match(ctx.text(), /POINTAGE FACIAL INDISPONIBLE/); assert.match(ctx.text(), /UTILISEZ LE QR/);
  await ctx.motion(); await ctx.motion();
  assert.equal(ctx.count('/terminal/challenge'), 0);
  assert.equal(ctx.calls.find((c) => c.path.endsWith('/terminal/qr')).body.token, 'qr-token-employe');
  assert.match(ctx.text(), /ENTRÉE ENREGISTRÉE · 07:58/);
  ctx.dom.window.close();
});

test('borne : aucune navigation ni administration, aucun lien, rien d\'interactif hors association', async () => {
  const ctx = await started({ routes: facialRoutes(() => [200, {}]) });
  assert.equal(ctx.d.querySelectorAll('a').length, 0);
  assert.equal(ctx.d.querySelectorAll('nav, .side, .nav-btn').length, 0);
  const visible = ctx.d.querySelector('main').textContent + ctx.d.getElementById('kioskPairing').textContent;
  assert.doesNotMatch(visible, /Administration|Mode Test|Paramètres|Déconnexion/);
  assert.equal([...ctx.d.querySelectorAll('button, input, select')].every((el) => el.closest('#kioskPairing')), true);
  assert.match(ctx.d.querySelector('.kiosk-prod').textContent, /PRODUCTION/);
  assert.equal(ctx.calls.every((c) => !c.headers.Authorization), true);   // jamais de session humaine
  ctx.dom.window.close();
});

test('personne arrivée pendant une pause puis immobile : analysée dès la fin de la pause ; scène inchangée : une seule analyse', async () => {
  const answers = [{ state: 'NO_FACE', recorded: false, message: 'Aucun visage' }, RECORDED('ENTRÉE', '08:10')];
  const ctx = await started({ routes: facialRoutes(() => [200, answers.shift()]) });
  await ctx.motion();                                      // quelqu'un passe : scène vide analysée → NO_FACE, pause
  assert.equal(ctx.count('/terminal/challenge'), 1);
  ctx.setScene(200); await ctx.B.tick();                   // arrive PENDANT la pause (aucune analyse)
  assert.equal(ctx.count('/terminal/challenge'), 1);
  ctx.advance(ctx.B.TIMING.RETRY_MS + 10);
  await ctx.B.tick();                                      // immobile, mais scène ≠ dernière scène analysée
  assert.match(ctx.text(), /ENTRÉE ENREGISTRÉE · 08:10/);
  assert.equal(ctx.count('/terminal/challenge'), 2);
  ctx.dom.window.close();
});

test('battement de cœur : au repos (aucun passage) la borne relit son état toutes les 30 s, requête signée ; jamais de reconnaissance', async () => {
  const ctx = await started({ routes: facialRoutes([200, RECORDED('ENTRÉE', '08:00')]) });
  const beats = () => ctx.calls.filter((c) => c.path === '/api/biometrics/terminal/session' && c.headers['X-Atlas-Signature']).length;
  const base = beats();
  for (let i = 0; i < 5; i++) { ctx.advance(9000); await ctx.B.tick(); }            // 45 s sans aucun mouvement
  assert.equal(beats() - base, 1, 'un battement par tranche de 30 s');
  for (let i = 0; i < 7; i++) { ctx.advance(9000); await ctx.B.tick(); }            // +63 s
  assert.equal(beats() - base, 3);
  assert.equal(ctx.count('/terminal/recognize'), 0, 'un battement ne déclenche aucune reconnaissance');
  assert.equal(ctx.count('/terminal/challenge'), 0);
  assert.match(JS, /call\("GET", "\/terminal\/session\?hb=1"\)/, 'le battement se déclare au serveur');
  assert.match(fs.readFileSync(path.join(ROOT, 'pointeur-borne.html'), 'utf8'), /pointeur-borne\.js\?v=20261010-integration-v1/);
});

test('battement de cœur : coupure réseau silencieuse puis reprise ; facial coupé par l\'administration appris sans passage ; révocation apprise au repos', async () => {
  let session = [200, SESSION];
  const ctx = await started({ routes: { ...facialRoutes([200, RECORDED('ENTRÉE', '08:00')]), 'GET /api/biometrics/terminal/session': () => session } });
  const before = ctx.text();
  session = ['NETWORK'];
  ctx.advance(31000); await ctx.B.tick();
  assert.equal(ctx.text(), before, 'réseau coupé au repos : écran inchangé, nouvel essai au battement suivant');
  session = [200, { ...SESSION, facial: { available: false, code: 'FACIAL_DISABLED', message: 'Pointage facial désactivé' } }];
  ctx.advance(31000); await ctx.B.tick();
  assert.match(ctx.text(), /Pointage facial désactivé|FACIAL/i);
  await ctx.motion();
  assert.equal(ctx.count('/terminal/recognize'), 0, 'facial coupé : aucune rafale');
  session = [200, SESSION];
  ctx.advance(31000); await ctx.B.tick();
  await ctx.motion(); await tick();
  assert.equal(ctx.count('/terminal/recognize'), 1, 'facial rétabli : la borne reprend seule');
  session = [401, { detail: { code: 'TERMINAL_REVOKED', message: 'Terminal révoqué' } }];
  ctx.advance(40000); await ctx.B.tick(); await tick();
  assert.equal(await ctx.store.get('identity'), undefined, 'révocation apprise au repos : identité effacée');
});
