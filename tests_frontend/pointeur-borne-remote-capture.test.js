// LOT C1 — Borne (/borne) : prise de photo distante supervisée, commandée depuis DRH.
// VRAI pointeur-borne.html + pointeur-borne.js dans jsdom ; réseau, caméra et horloge simulés ;
// WebCrypto réel (requêtes signées). La borne reste un terminal de POINTAGE : elle relève les
// commandes, sert quelques instants de caméra, puis revient seule au pointage.
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
const API = '/api/biometrics';
const session = (facial = true, remote = { enabled: true, poll_ms: 2000 }) => ({
  terminal: { terminal_id: 'trm_1', name: 'TAB-01', terminal_type: 'TABLET_ANDROID', site_id: 3, site: 'HAMOUL 01', society: 'IRON GLOBAL SOLUTION' },
  facial: facial ? { available: true, code: null, message: '' } : { available: false, code: 'BIOMETRIC_DISABLED', message: 'Pointage facial non activé' },
  qr: { available: true }, remote_capture: remote, burst: { frames: 3, interval_ms: 1, max_side: 800, jpeg_quality: 0.85 }, challenge_ttl: 10, server_time: Date.now() });
const CAPTURE = { max_side: 640, check_side: 480, jpeg_quality: 0.9, check_interval_ms: 400, stable_ms: 800, min_interval_ms: 1500 };
const COMMAND = (status, extra = {}) => ({ command: 'CAPTURE_PHOTO', session_id: 'sess-1', status, attempt: 0, employee: { nom: 'OUALI', prenom: 'Amine' },
  expires_in: 100, capture: CAPTURE, poll_ms: 1000, enabled: true, ...extra });
const OK = { ok: true, state: 'OK', instruction: 'Position correcte — restez immobile' };
const NOT = (state, instruction) => ({ ok: false, state, instruction });
const NONE = { command: null, poll_ms: 2000, enabled: true };

async function started({ facial = true, remote, routes = {}, barcode = null } = {}) {
  const calls = [];
  const store = { data: {}, async get(k) { return this.data[k]; }, async set(k, v) { this.data[k] = v; }, async clear() { this.data = {}; } };
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  store.data.identity = { terminal_id: 'trm_1', privateKey: keys.privateKey, camera: null };
  const dom = new JSDOM(HTML, { url: 'https://pointeur.irongs.com/borne', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) { w.__ATLAS_BORNE_NO_AUTOSTART__ = true; w.TextEncoder = TextEncoder; } });
  const w = dom.window, B = w.AtlasBorne;
  let now = 1_000_000, scene = 0;
  const track = { addEventListener() {}, stop() {} };
  const all = { [`GET ${API}/terminal/session`]: [200, session(facial, remote)], ...routes };
  B.deps = {
    subtle: () => webcrypto.subtle, store, now: () => now,
    media: () => ({ getUserMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }), enumerateDevices: async () => [] }),
    barcode: () => barcode, faceDetector: () => null,
    fetch: async (url, opts = {}) => {
      const u = new URL(url, 'https://pointeur.irongs.com');
      const call = { path: u.pathname.replace(API, ''), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null };
      calls.push(call);
      const found = all[`${call.method} ${u.pathname}`];
      const [status, data] = await (typeof found === 'function' ? found(call) : (found || [200, {}]));
      if (status === 'NETWORK') throw new TypeError('Failed to fetch');
      return { ok: status < 400, status, json: async () => data };
    },
  };
  B.sample = () => new Uint8Array(768).fill(scene);
  B.capture = () => `data:image/jpeg;base64,${Buffer.from(`photo-${Math.random()}`).toString('base64')}`;
  const crops = [];                                                              // côtés demandés au recadrage du cercle
  B.captureGuide = (side) => { crops.push(side); return `data:image/jpeg;base64,${Buffer.from(`carre-${side}-${Math.random()}`).toString('base64')}`; };
  await B.boot();
  B.running = false; clearTimeout(B.timer); clearTimeout(B.pollTimer);
  B.lastAnalyzed = B.sample();
  const ctx = { dom, w, d: w.document, B, calls, all, crops,
    frame: () => w.document.querySelector('.kiosk-frame'),
    advance(ms) { now += ms; }, setScene(v) { scene = v; },
    count: (p, method) => calls.filter((c) => c.path === p && (!method || c.method === method)).length,
    text: () => w.document.getElementById('kioskStatus').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    banner: () => w.document.getElementById('kioskMode'),
    now: () => now,
    async still(ms = 400) { now += ms; await B.tick(); },                       // scène immobile
    async motion(ms = 400) { now += ms; scene = (scene + 40) % 250; await B.tick(); } };
  return ctx;
}

// Serveur simulé d'une session : commande, prise en compte, contrôles de cadrage, photos candidates.
function sessionServer(verdicts, checks = []) {
  const state = { status: 'REQUESTED', nonce: 0, photos: [], checks: [], acks: 0, open: true, at: [] };
  // Scène immobile jusqu'à ce que `n` photos aient été proposées (borné).
  state.until = async (t, n) => { for (let i = 0; i < 60 && state.photos.length < n; i++) { await t.still(200); if (state.photos.length > state.at.length) state.at.push(t.now()); } };
  return { state, routes: {
    [`GET ${API}/terminal/command`]: () => [200, state.open ? COMMAND(state.status) : NONE],
    [`POST ${API}/terminal/capture/ack`]: () => { state.acks++; state.status = 'WAITING_FOR_FACE'; return [200, { ...COMMAND('WAITING_FOR_FACE'), nonce: `nonce-${++state.nonce}` }]; },
    [`POST ${API}/terminal/capture/check`]: (call) => { state.checks.push(call.body); return [200, checks.length ? checks.shift() : OK]; },
    [`POST ${API}/terminal/capture/photo`]: (call) => {
      state.photos.push(call.body);
      const verdict = verdicts.shift() || { accepted: true };
      if (verdict.accepted) { state.status = 'PREVIEW_READY'; return [200, { accepted: true, state: 'CAPTURED', instruction: 'Photo prise', nonce: null }]; }
      return [200, { accepted: false, nonce: `nonce-${++state.nonce}`, ...verdict }];
    } } };
}

test('réglage désactivé : la borne ne relève aucune commande et le pointage est inchangé', async () => {
  for (const remote of [{ enabled: false, poll_ms: 2000 }, null]) {       // null : ancien serveur
    const t = await started({ remote, routes: { [`POST ${API}/terminal/challenge`]: [200, { challenge_id: 1, nonce: 'n'.repeat(44), expires_in: 10 }],
      [`POST ${API}/terminal/recognize`]: [200, { state: 'UNKNOWN_FACE' }] } });
    for (let i = 0; i < 12; i++) await t.still(1000);
    assert.equal(t.count('/terminal/command'), 0);
    await t.motion();
    assert.equal(t.count('/terminal/recognize'), 1);
    assert.equal(t.banner().hidden, true);
    t.dom.window.close();
  }
});

test('au repos : relève signée toutes les 2 s au plus, sans changer l\'écran', async () => {
  const t = await started({ routes: { [`GET ${API}/terminal/command`]: [200, NONE] } });
  for (let i = 0; i < 20; i++) await t.still(500);                                // 10 s
  const polls = t.calls.filter((c) => c.path === '/terminal/command');
  assert.ok(polls.length >= 4 && polls.length <= 5, `relèves : ${polls.length}`);
  for (const p of polls) { assert.ok(p.headers['X-Atlas-Signature']); assert.equal(p.headers['X-Atlas-Terminal'], 'trm_1'); assert.equal(p.method, 'GET'); }
  assert.equal(t.text(), 'PRÉSENTEZ VOTRE VISAGE');
  assert.equal(t.count('/terminal/capture/ack'), 0);
  t.dom.window.close();
});

test('commande → « PRISE DE PHOTO » : cercle de capture, consignes réelles, feu vert, stabilité, puis photo recadrée', async () => {
  const srv = sessionServer([NOT('TOO_HIGH', 'Descendez légèrement') && { accepted: false, state: 'TOO_HIGH', instruction: 'Descendez légèrement' }, { accepted: true }],
    [NOT('NO_FACE', 'Placez votre visage dans le cercle'), NOT('TOO_HIGH', 'Descendez légèrement'), NOT('MULTIPLE_FACES', 'Une seule personne devant la caméra'),
     OK, NOT('TOO_LEFT', 'Déplacez-vous légèrement vers la droite'), OK, OK, OK]);
  let qrReads = 0;
  const t = await started({ barcode: { detect: async () => { qrReads++; return []; } }, routes: { ...srv.routes,
    [`POST ${API}/terminal/challenge`]: [200, { challenge_id: 1, nonce: 'n'.repeat(44), expires_in: 10 }],
    [`POST ${API}/terminal/recognize`]: [200, { state: 'UNKNOWN_FACE' }] } });
  await t.still(2100);                                                           // relève → commande → prise en compte
  assert.equal(srv.state.acks, 1);
  assert.equal(t.B.state, 'CAPTURE');
  assert.equal(t.text(), 'PRISE DE PHOTO OUALI Amine Placez votre visage dans le cercle');
  assert.equal(t.banner().hidden, false); assert.equal(t.banner().textContent, 'PRISE DE PHOTO EN COURS');
  assert.ok(t.frame().classList.contains('is-guide')); assert.ok(!t.frame().classList.contains('guide-ok'), 'cercle jaune au départ');
  // Contrôles de cadrage : carré du cercle en basse définition, au plus toutes les 400 ms.
  assert.equal(srv.state.checks.length, 1, 'premier contrôle dès la prise en compte');
  await t.still(200);
  assert.equal(srv.state.checks.length, 1, 'pas plus d\'un contrôle par 400 ms');
  const seen = [];
  const colours = [];
  for (let i = 0; i < 3; i++) {
    await t.still(400); seen.push(t.text().replace('PRISE DE PHOTO OUALI Amine ', ''));
    colours.push(t.frame().classList.contains('guide-ok') ? 'vert' : t.frame().classList.contains('guide-error') ? 'rouge' : 'jaune');
  }
  assert.deepEqual(colours, ['jaune', 'rouge', 'vert']);
  assert.deepEqual(seen, ['Descendez légèrement', 'Une seule personne devant la caméra', 'Position correcte — restez immobile']);
  assert.ok(srv.state.checks.every((c) => Object.keys(c).sort().join() === 'photo,session_id'), 'aucun jeton de capture dans un contrôle');
  assert.ok(t.crops.every((side) => side === 480));
  assert.equal(srv.state.photos.length, 0, 'aucune photo candidate pendant l\'ajustement');
  assert.ok(t.frame().classList.contains('guide-ok'), 'cercle vert');
  // Cadrage perdu avant la fin de la période de stabilité : compteur remis à zéro, cercle jaune.
  await t.still(400);
  assert.equal(t.text(), 'PRISE DE PHOTO OUALI Amine Déplacez-vous légèrement vers la droite');
  assert.ok(!t.frame().classList.contains('guide-ok'));
  assert.equal(srv.state.photos.length, 0);
  // Mouvement pendant un cadrage correct : compteur remis à zéro aussi.
  await t.still(400);                                                            // OK
  await t.motion(400);                                                           // mouvement → remise à zéro, nouveau contrôle OK
  assert.equal(srv.state.photos.length, 0);
  // Cadrage correct et immobile ≥ 800 ms : photo candidate (carré 640), avec le jeton.
  await srv.state.until(t, 1);
  assert.equal(srv.state.photos.length, 1);
  assert.deepEqual(Object.keys(srv.state.photos[0]).sort(), ['nonce', 'photo', 'session_id']);
  assert.equal(srv.state.photos[0].nonce, 'nonce-1');
  assert.equal(t.crops[t.crops.length - 1], 640);
  assert.match(srv.state.photos[0].photo, /^data:image\/jpeg;base64,/);
  // Refus du serveur (validation sur la photo recadrée) : consigne, cercle jaune, nouveau jeton, nouvelle stabilité exigée.
  assert.equal(t.text(), 'PRISE DE PHOTO OUALI Amine Descendez légèrement');
  assert.ok(!t.frame().classList.contains('guide-ok'));
  await srv.state.until(t, 2);
  assert.equal(srv.state.photos[1].nonce, 'nonce-2');
  assert.ok(srv.state.at[1] - srv.state.at[0] >= 800, 'nouvelle période de stabilité');
  assert.equal(t.text(), 'PRISE DE PHOTO OUALI Amine Photo prise — vérification en cours…');
  assert.doesNotMatch(t.text(), /score|gabarit|%/i);
  // Quelqu'un bouge devant la tablette pendant la prise : ni reconnaissance, ni QR, ni pointage.
  const qrBefore = qrReads;
  for (let i = 0; i < 6; i++) await t.motion(300);
  assert.equal(t.count('/terminal/challenge'), 0); assert.equal(t.count('/terminal/recognize'), 0); assert.equal(t.count('/terminal/qr'), 0);
  assert.equal(qrReads, qrBefore);
  assert.equal(srv.state.photos.length, 2, 'plus aucune photo après la prise');
  // L'opérateur a retenu la photo (ou annulé, ou la session a expiré) : retour au pointage, cercle d'origine.
  srv.state.open = false;
  await t.still(1100);
  assert.equal(t.B.remote, null); assert.equal(t.banner().hidden, true);
  assert.equal(t.text(), 'PRÉSENTEZ VOTRE VISAGE');
  assert.equal(t.frame().classList.contains('is-guide'), false); assert.equal(t.frame().getAttribute('style'), null);
  // La personne photographiée est encore là : aucun pointage tant qu'elle n'a pas quitté le champ.
  for (let i = 0; i < 5; i++) await t.still(600);
  assert.equal(t.count('/terminal/recognize'), 0);
  await t.motion();
  assert.equal(t.count('/terminal/recognize'), 1, 'le pointage reprend');
  t.dom.window.close();
});

test('reprendre : la borne recommence la prise avec un nouveau jeton', async () => {
  const srv = sessionServer([{ accepted: true }, { accepted: true }]);
  const t = await started({ routes: srv.routes });
  await t.still(2100);
  await srv.state.until(t, 1);
  assert.equal(srv.state.photos.length, 1);
  srv.state.status = 'RETAKE_REQUESTED';                                         // l'opérateur clique « Reprendre »
  await t.still(1100);
  assert.equal(srv.state.acks, 2);
  assert.equal(srv.state.photos.length, 1, 'pas de photo immédiate : nouvelle période de stabilité exigée');
  assert.ok(t.B.remote.okSince === 0 || t.now() - t.B.remote.okSince < 800, 'compteur de stabilité réinitialisé');
  assert.ok(t.frame().classList.contains('is-guide'));
  await srv.state.until(t, 2);
  assert.equal(srv.state.photos.length, 2); assert.equal(srv.state.photos[1].nonce, 'nonce-2');
  t.dom.window.close();
});

test('un pointage engagé n\'est jamais interrompu : la commande attend la fin de l\'opération', async () => {
  const srv = sessionServer([]);
  const t = await started({ routes: srv.routes });
  t.B.busy = true;                                                               // reconnaissance / QR en cours
  for (let i = 0; i < 5; i++) await t.still(1000);
  assert.equal(t.count('/terminal/command'), 0); assert.equal(t.B.remote, null);
  t.B.busy = false;
  await t.still(100);
  assert.equal(srv.state.acks, 1); assert.equal(t.B.state, 'CAPTURE');
  t.dom.window.close();
});

test('session close, expirée ou serveur muet : la borne revient seule au pointage', async () => {
  // La photo arrive trop tard (session expirée) : la relève suivante libère la borne.
  const srv = sessionServer([]);
  const t = await started({ routes: srv.routes });
  await t.still(2100);
  t.all[`POST ${API}/terminal/capture/photo`] = () => { srv.state.open = false; return [409, { detail: { code: 'SESSION_CLOSED', message: 'x' } }]; };
  for (let i = 0; i < 4; i++) await t.still(600);
  await t.still(300);
  assert.equal(t.B.remote, null); assert.equal(t.text(), 'PRÉSENTEZ VOTRE VISAGE');
  t.dom.window.close();
  // Prise en compte refusée (annulée entre-temps).
  const u = await started({ routes: { [`GET ${API}/terminal/command`]: (() => { let n = 0; return () => [200, n++ ? NONE : COMMAND('REQUESTED')]; })(),
    [`POST ${API}/terminal/capture/ack`]: [409, { detail: { code: 'SESSION_CLOSED', message: 'x' } }] } });
  await u.still(2100);
  assert.equal(u.B.remote, null); assert.equal(u.banner().hidden, true); assert.equal(u.text(), 'PRÉSENTEZ VOTRE VISAGE');
  u.dom.window.close();
  // Terminal révoqué pendant la prise : mode capture quitté, écran « non autorisé ».
  const srv2 = sessionServer([]);
  const v = await started({ routes: srv2.routes });
  await v.still(2100);
  v.all[`GET ${API}/terminal/command`] = [401, { detail: { code: 'TERMINAL_REVOKED', message: 'Terminal révoqué' } }];
  await v.still(1100);
  assert.equal(v.B.remote, null); assert.equal(v.banner().hidden, true); assert.equal(v.B.state, 'PAIRING');
  v.dom.window.close();
  // Réseau coupé pendant la prise : la borne reste en attente (la session expire côté serveur), puis se libère.
  const srv3 = sessionServer([]);
  const x = await started({ routes: srv3.routes });
  await x.still(2100);
  const live = x.all[`GET ${API}/terminal/command`];
  x.all[`GET ${API}/terminal/command`] = ['NETWORK'];
  await x.still(1100);
  assert.equal(x.B.state, 'CAPTURE');
  srv3.state.open = false; x.all[`GET ${API}/terminal/command`] = live;
  await x.still(1100);
  assert.equal(x.B.remote, null);
  x.dom.window.close();
});

test('pointage facial désactivé (production actuelle) : la prise de photo fonctionne, puis l\'écran d\'origine revient', async () => {
  const srv = sessionServer([{ accepted: true }]);
  const t = await started({ facial: false, routes: srv.routes });
  assert.match(t.text(), /POINTAGE FACIAL INDISPONIBLE/);
  await t.still(2100);
  assert.equal(t.B.state, 'CAPTURE');
  await srv.state.until(t, 1);
  assert.equal(srv.state.photos.length, 1);
  assert.equal(t.count('/terminal/challenge'), 0);
  srv.state.open = false;
  await t.still(1100);
  assert.match(t.text(), /POINTAGE FACIAL INDISPONIBLE/);
  assert.equal(t.banner().hidden, true);
  t.dom.window.close();
});
