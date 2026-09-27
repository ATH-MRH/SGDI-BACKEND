// Pointeur — pointage facial automatique (app/static/pointeur-facial.js) sur la VRAIE page
// pointeur.html. Réseau et caméra simulés uniquement ; la logique du module s'exécute telle quelle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur } = require('./load-pointeur');

const FACIAL_SRC = fs.readFileSync(path.join(__dirname, '../app/static/pointeur-facial.js'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ status = { enabled: true, engine_available: true }, cameras, results = [] } = {}) {
  const calls = [];
  let n = 0;
  const cams = cameras || [{ id: 7, name: 'CAM-ENTREE-01', location: 'Entrée principale', adapter: 'DAHUA', usage: 'ATTENDANCE', role: 'ENTRY', is_default: true, active: true }];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    calls.push({ path: u.pathname, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).Authorization });
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, blob: async () => new Blob(['x']) });
    if (u.pathname === '/api/biometrics/status') return json(status);
    if (u.pathname === '/api/biometrics/cameras') return json(cams);
    if (u.pathname.endsWith('/preview.jpg')) return json({});
    if (u.pathname.endsWith('/recognize')) return json(results[Math.min(n++, results.length - 1)] || { state: 'NO_FACE', recorded: false, reasons: [] });
    return json({});
  };
  const ctx = loadPointeur({ url: 'https://pointeur.irongs.com/', fetch });
  const w = ctx.window;
  test.after(() => { try { w.PointeurFacial && w.PointeurFacial.stop(); w.close(); } catch (e) { /* déjà fermé */ } });
  w.URL.createObjectURL = () => 'blob:preview';
  w.URL.revokeObjectURL = () => {};
  await wait(50); // laisser passer l'initialisation de la page (DOMContentLoaded) avant la session
  w.__pointeurTest.setSession({ token: 'tok', username: 'PTG01' });
  w.eval(FACIAL_SRC);
  return { ...ctx, w, d: w.document, calls, recognizeCalls: () => calls.filter((c) => c.path.endsWith('/recognize')) };
}

test('désactivé : message clair, aucune tentative de reconnaissance', async () => {
  const r = await boot({ status: { enabled: false, engine_available: false } });
  await r.w.PointeurFacial.start();
  assert.match(r.d.getElementById('faceStatus').textContent, /POINTAGE FACIAL NON ACTIVÉ/);
  assert.equal(r.recognizeCalls().length, 0);
  r.w.close();
});

test('parcours normal ZÉRO CLIC : reconnaissance automatique, résultat affiché, pause avant READY', async () => {
  const r = await boot({ results: [{ state: 'ATTENDANCE_RECORDED', recorded: true, employee: { nom: 'OUALI', prenom: 'Amine', matricule: 'M001' }, action: 'ENTRÉE', heure: '07:58', site: 'Site A' }] });
  await r.w.PointeurFacial.start();
  await wait(700);
  const status = r.d.getElementById('faceStatus').textContent;
  assert.match(status, /POINTAGE ENREGISTRÉ/);
  assert.match(status, /OUALI Amine/);
  assert.match(status, /M001/);
  assert.match(status, /ENTRÉE/);
  assert.equal(r.recognizeCalls().length, 1, 'une seule reconnaissance sans aucun clic');
  await wait(1200);
  assert.equal(r.recognizeCalls().length, 1, 'aucune nouvelle tentative pendant l\'affichage du résultat');
  // L'aperçu passe par le backend, jamais par l'adresse de la caméra ; jamais d'identifiant.
  assert.ok(r.calls.some((c) => c.path === '/api/biometrics/cameras/7/preview.jpg'));
  const bio = r.calls.filter((c) => c.path.startsWith('/api/biometrics/'));
  assert.ok(bio.length >= 3, JSON.stringify(bio.map((c) => [c.path, c.auth])));
  assert.ok(bio.every((c) => c.auth === 'Bearer tok'), JSON.stringify(bio.map((c) => [c.path, c.auth])));
  assert.ok(r.calls.every((c) => c.path.startsWith('/api/')), 'aucun appel direct vers une caméra');
  assert.ok(r.recognizeCalls()[0].body.burst_id, 'chaque rafale porte une clé d\'idempotence');
  r.w.PointeurFacial.stop();
  r.w.close();
});

test('visage inconnu : aucun pointage, message et pointage de secours (saisie manuelle)', async () => {
  const r = await boot({ results: [{ state: 'UNKNOWN_FACE', recorded: false, message: 'VISAGE INCONNU' }] });
  r.d.getElementById('appView').classList.remove('hidden');
  await r.w.PointeurFacial.start();
  await wait(700);
  assert.match(r.d.getElementById('faceStatus').textContent, /VISAGE INCONNU/);
  r.d.getElementById('faceFallbackBtn').click();
  assert.equal(r.w.PointeurFacial.running, false, 'le mode facial s\'arrête');
  assert.equal(r.d.getElementById('manualPanel').classList.contains('hidden'), false, 'saisie manuelle ouverte');
  r.w.close();
});

test('plusieurs visages / liveness : refus explicite, jamais d\'attribution', async () => {
  for (const [state, text] of [['MULTIPLE_FACES', /PLUSIEURS VISAGES/], ['LIVENESS_FAILED', /Présence réelle non confirmée/], ['AMBIGUOUS', /AMBIGUË/]]) {
    const r = await boot({ results: [{ state, recorded: false, reasons: [] }] });
    await r.w.PointeurFacial.start();
    await wait(700);
    assert.match(r.d.getElementById('faceStatus').textContent, text, state);
    r.w.PointeurFacial.stop();
    r.w.close();
  }
});

test('caméra du terminal : 3 images capturées et envoyées, flux arrêté en quittant la vue', async () => {
  const cam = [{ id: 9, name: 'Tablette entrée', adapter: 'TERMINAL', usage: 'ATTENDANCE_AND_ENROLLMENT', role: 'ENTRY', is_default: true, active: true }];
  const r = await boot({ cameras: cam, results: [{ state: 'NO_FACE', recorded: false, reasons: [] }] });
  let stopped = 0;
  r.w.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) };
  const video = r.d.getElementById('faceVideo');
  Object.defineProperty(video, 'videoWidth', { value: 1920 });
  Object.defineProperty(video, 'videoHeight', { value: 1080 });
  video.play = () => Promise.resolve();
  r.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  r.w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  await r.w.PointeurFacial.start();
  await wait(1200);
  const body = r.recognizeCalls()[0].body;
  assert.equal(body.frames.length, 3);
  assert.ok(body.frames.every((f) => f.startsWith('data:image/jpeg;base64,')));
  r.w.PointeurFacial.stop();
  assert.equal(stopped, 1, 'la caméra est libérée');
  const before = r.recognizeCalls().length;
  await wait(1200);
  assert.equal(r.recognizeCalls().length, before, 'plus aucune tentative après arrêt');
  r.w.close();
});

test('nom renvoyé par le serveur échappé (aucune injection HTML)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const r = await boot({ results: [{ state: 'ATTENDANCE_RECORDED', recorded: true, employee: { nom: evil, prenom: evil, matricule: evil }, action: 'SORTIE', heure: '18:00' }] });
  await r.w.PointeurFacial.start();
  await wait(700);
  assert.equal(r.d.querySelectorAll('#faceStatus img').length, 0);
  assert.match(r.d.getElementById('faceStatus').textContent, /<img src=x onerror=alert\(1\)>/);
  r.w.PointeurFacial.stop();
  r.w.close();
});
