// Pointeur — pointage facial sur PLUSIEURS équipements (app/static/pointeur-facial.js) sur la
// VRAIE page pointeur.html. Réseau simulé uniquement ; la logique du module s'exécute telle quelle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur } = require('./load-pointeur');
const { CAM, KIOSK, LOST, facialServer } = require('./helpers/pointeur-facial-mock');

const FACIAL_SRC = fs.readFileSync(path.join(__dirname, '../app/static/pointeur-facial.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointeur.html'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RECORDED = (n = 1, extra = {}) => ({ state: 'ATTENDANCE_RECORDED', recorded: true, employee: { nom: `OUALI${n}`, prenom: 'Amine', matricule: `M00${n}` }, action: 'ENTRÉE', heure: '07:58', site: 'Site A', ...extra });

async function boot(state = {}, { site = '12', stored } = {}) {
  const calls = [];
  const server = facialServer(state);
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    const call = { path: u.pathname, search: u.search, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).Authorization, at: Date.now() };
    calls.push(call);
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, blob: async () => new Blob(['x']) });
    return (await server(u, call, json)) || json({});
  };
  const ctx = loadPointeur({ url: 'https://pointeur.irongs.com/', fetch });
  const w = ctx.window, d = w.document;
  test.after(() => { try { w.PointeurFacial && w.PointeurFacial.stop(); w.close(); } catch (e) { /* déjà fermé */ } });
  w.URL.createObjectURL = () => 'blob:preview';
  w.URL.revokeObjectURL = () => {};
  await wait(50); // laisser passer l'initialisation de la page (DOMContentLoaded) avant la session
  w.__pointeurTest.setSession({ token: 'tok', username: 'PTG01' });
  w.__pointeurTest.stopLivePolling();
  w.__pointeurTest.setSelectedSite(site);
  if (stored) w.localStorage.setItem('atlas_pointer_face_terminals', JSON.stringify(stored));
  w.eval(FACIAL_SRC);
  const F = w.PointeurFacial;
  const of = (suffix) => calls.filter((c) => c.path.endsWith(suffix));
  const text = (id) => d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const rows = () => [...d.querySelectorAll('#ftRows tr')].map((tr) => ({ key: tr.dataset.key, cells: [...tr.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()), checked: tr.querySelector('input').checked }));
  const row = (key) => rows().find((x) => x.key === key);
  const count = (id) => d.getElementById(id).textContent;
  const click = (ft) => d.querySelector(`#faceTerminals [data-ft="${ft}"]`).click();
  const check = (key, on = true) => { const box = d.querySelector(`#ftRows input[data-key="${key}"]`); box.checked = on; box.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const close = () => { try { F.stop(); w.close(); } catch (e) { /* déjà fermé */ } };
  /** Ouvre le mode facial, coche `keys` (ou tout) et active. */
  const run = async (keys) => { await F.start(); if (keys) keys.forEach((k) => check(k)); else click('all'); click('activate'); await wait(60); };
  return { ...ctx, w, d, F, calls, of, text, rows, row, count, click, check, close, run, state };
}

test('liste des terminaux autorisés : Nom | Site | État | Sélection — rien ne démarre sans activation, aucun appairage', async () => {
  const r = await boot({ devices: [CAM(7, 12), CAM(8, 13), KIOSK(3, 12), KIOSK(4, 13, { online: false, connection: 'NEVER', state: 'OFFLINE', last_communication: null })] }, { site: '' });
  await r.F.start();
  assert.equal(r.of('/pointer/terminals')[0].search, '', 'tous les sites autorisés du compte');
  assert.deepEqual([...r.d.querySelectorAll('.ft-table thead th')].map((th) => th.textContent.trim()), ['', 'Terminal', 'Site', 'État', 'Dernière activité']);
  assert.deepEqual(r.rows().map((x) => [x.key, x.cells[2], x.checked]), [['cam:7', 'SITE 12', false], ['cam:8', 'SITE 13', false], ['trm:3', 'SITE 12', false], ['trm:4', 'SITE 13', false]]);
  assert.match(r.row('cam:7').cells[1], /CAM-7.*Entrée/); assert.equal(r.d.querySelector('#ftRows tr[data-key="cam:7"] td[title]').title, 'DAHUA IPC'); assert.match(r.row('cam:7').cells[3], /Disponible/);
  assert.match(r.row('trm:3').cells[3], /En ligne · au repos.*Terminal autonome/); assert.match(r.row('trm:4').cells[3], /Jamais connecté/);
  assert.equal(r.row('trm:4').cells[4], 'Jamais');
  assert.match(r.text('faceStatus'), /SÉLECTIONNEZ LES TERMINAUX/);
  assert.equal(r.d.getElementById('ftActivate').disabled, true, 'rien à activer sans sélection');
  await wait(1200);
  assert.equal(r.of('/recognize').length + r.of('/activate').length + r.of('/preview.jpg').length, 0, 'aucune reconnaissance avant activation');
  // Le Pointeur n'appaire jamais : aucun bouton, aucun appel d'administration.
  assert.doesNotMatch(r.text('faceView'), /appairer|associer|code d'association/i);
  assert.doesNotMatch(FACIAL_SRC, /pairing-code|\/terminals\/\$\{|facial-devices|getUserMedia|enumerateDevices/);
  assert.ok(r.calls.every((c) => !/pairing|facial-devices|\/biometrics\/terminals/.test(c.path)));
  r.close();
});

test('sélection : un, plusieurs, tout, rien — compteurs et sélection mémorisée', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8), KIOSK(3)] });
  await r.F.start();
  r.check('cam:7');
  assert.equal(r.count('ftCountSelected'), '1'); assert.equal(r.d.getElementById('ftAll').indeterminate, true);
  assert.equal(r.d.getElementById('ftActivate').disabled, false);
  r.click('all');
  assert.deepEqual(r.rows().map((x) => x.checked), [true, true, true]); assert.equal(r.count('ftCountSelected'), '3'); assert.equal(r.d.getElementById('ftAll').checked, true);
  assert.deepEqual(JSON.parse(r.w.localStorage.getItem('atlas_pointer_face_terminals')), ['cam:7', 'cam:8', 'trm:3']);
  r.click('none');
  assert.deepEqual(r.rows().map((x) => x.checked), [false, false, false]); assert.equal(r.count('ftCountSelected'), '0');
  const all = r.d.getElementById('ftAll'); all.checked = true; all.dispatchEvent(new r.w.Event('change', { bubbles: true }));
  assert.equal(r.count('ftCountSelected'), '3');
  assert.equal(r.count('ftCountActive'), '0', 'cocher n\'active rien');
  r.close();
});

test('sélection mémorisée : restaurée sans rien activer ; un terminal révoqué entre-temps en est retiré', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8)] }, { stored: ['cam:7', 'trm:99', 'cam:404'] });
  await r.F.start();
  assert.deepEqual(r.rows().map((x) => [x.key, x.checked]), [['cam:7', true], ['cam:8', false]]);
  assert.equal(r.count('ftCountSelected'), '1');
  await wait(400);
  assert.equal(r.of('/recognize').length, 0); assert.equal(r.of('/activate').length, 0);
  r.click('activate'); await wait(500);
  assert.deepEqual(r.of('/activate')[0].body, { keys: ['cam:7'], site_id: 12 }, 'seuls les terminaux encore proposés sont envoyés');
  assert.ok(r.of('/cameras/7/recognize').length >= 1);
  r.close();
});

test('activation simultanée : chaque caméra a sa boucle ; la panne de l\'une n\'arrête pas l\'autre', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8)], recognize: (n, call) => (call.path.includes('/7/') ? { __status: 502, detail: 'Caméra injoignable' } : { state: 'NO_FACE', recorded: false, reasons: [] }) });
  await r.run();
  await wait(2300);
  assert.equal(r.of('/cameras/7/recognize').length, 1, 'caméra en panne : nouvel essai seulement après la temporisation');
  assert.ok(r.of('/cameras/8/recognize').length >= 2, 'l\'autre caméra continue à sa cadence');
  assert.equal(r.row('cam:7').cells[3], 'Caméra inaccessible', 'libellé sans répétition'); assert.match(r.row('cam:8').cells[3], /^Actif/);
  assert.equal(r.count('ftCountSelected'), '2'); assert.equal(r.count('ftCountActive'), '1'); assert.equal(r.count('ftCountOffline'), '1');
  assert.notEqual(r.row('cam:8').cells[4], '—', 'dernière activité : heure réelle du dernier échange');
  assert.equal(r.F.runners.size, 2);
  assert.ok(r.calls.filter((c) => c.path.startsWith('/api/biometrics/')).every((c) => c.auth === 'Bearer tok'));
  assert.ok(r.of('/recognize').every((c) => Object.keys(c.body).join() === 'burst_id'), 'aucune image envoyée par le navigateur');
  assert.ok(new Set(r.of('/recognize').map((c) => c.body.burst_id)).size === r.of('/recognize').length, 'une clé d\'idempotence par essai');
  r.close();
});

test('deux caméras, deux personnes en même temps : chaque résultat porte son terminal, le « prêt » de l\'une n\'efface pas le résultat de l\'autre', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8)], recognize: (n, call) => (call.path.includes('/8/') && !r.state.done ? ((r.state.done = true), RECORDED(1)) : { state: 'NO_FACE', recorded: false, reasons: [] }) });
  r.w.__pointeurTest.setLastActivity(0);
  await r.run();
  await wait(1500);
  assert.match(r.text('faceStatus'), /POINTAGE ENREGISTRÉ OUALI1 Amine Matricule M001 · ENTRÉE · 07:58 · Site A CAM-8 · SITE 12/);
  assert.ok(r.of('/cameras/7/recognize').length >= 1, 'la caméra voisine continue pendant l\'affichage');
  assert.ok(r.w.__pointeurTest.getLastActivity() > 0, 'un passage reconnu compte comme une lecture réelle');
  assert.match(r.count('ftLastEvent'), /07:58 · ENTRÉE · OUALI1 Amine · CAM-8/);
  assert.equal(r.d.getElementById('faceCameraLabel').textContent, 'CAM-8 · Entrée', 'aperçu : la caméra du dernier résultat');
  assert.ok(r.of('/cameras/8/preview.jpg').length >= 1);
  r.close();
});

test('caméra qui tourne sans passage : ce n\'est jamais une activité utilisateur', async () => {
  const r = await boot();
  r.w.__pointeurTest.setLastActivity(0);
  await r.run();
  await wait(1300);
  assert.ok(r.of('/recognize').length >= 1);
  assert.equal(r.w.__pointeurTest.getLastActivity(), 0);
  assert.match(r.text('faceStatus'), /PRÊT — placez-vous face à la caméra/);
  r.close();
});

test('terminal autonome : surveillé, jamais « activé » à distance — connexion et activité affichées séparément', async () => {
  const r = await boot({ devices: [KIOSK(3), KIOSK(4, 12, { ...LOST, last_communication: '2026-10-09T09:12:00Z' }),
    KIOSK(5, 12, { online: null, connection: 'SILENT', state: 'SILENT' }), KIOSK(6, 12, { activity: 'ACTIVE' })] });
  await r.run();
  await wait(1200);
  assert.equal(r.of('/recognize').length, 0, 'le poste ne pilote pas la caméra d\'une borne');
  assert.equal(r.of('/preview.jpg').length, 0);
  // Borne au repos (aucun passage) : toujours en ligne — l'inactivité n'est jamais une panne.
  assert.match(r.row('trm:3').cells[3], /^Actif · au repos.*aucune activation distante/); assert.match(r.row('trm:6').cells[3], /^Actif · en service/);
  // Borne qui battait et s'est tue : perte de connexion réelle.
  assert.match(r.row('trm:4').cells[3], /^Connexion perdue/);
  // Borne sans battement de cœur : état inconnu, ni « en ligne » ni « hors ligne ».
  assert.match(r.row('trm:5').cells[3], /^Sans signal.*État de connexion inconnu/);
  assert.equal(r.count('ftCountActive'), '2'); assert.equal(r.count('ftCountOffline'), '1', 'seule la connexion perdue compte hors ligne');
  assert.match(r.text('faceStatus'), /SURVEILLANCE ACTIVE TAB-4 : connexion perdue\./);
  assert.ok(r.d.getElementById('faceView').classList.contains('no-video'), 'aucun cadre vidéo vide');
  // Relevé d'état : la borne revient, un pointage y a eu lieu.
  r.state.devices[1] = KIOSK(4, 12, { activity: 'ACTIVE', last_event: { id: 91, heure: '14:02:11', type: 'ENTREE', name: 'SAIDI Lina', matricule: 'M044' } });
  r.state.lastEvent = r.state.devices[1].last_event;
  await r.F.refresh();
  assert.match(r.row('trm:4').cells[3], /^Actif · en service/); assert.equal(r.count('ftCountOffline'), '0'); assert.equal(r.count('ftCountActive'), '3');
  assert.match(r.count('ftLastEvent'), /14:02:11 · ENTRÉE · SAIDI Lina · TAB-4/);
  r.close();
});

test('activation : un résultat PAR terminal — refusé, révoqué ou hors périmètre n\'empêche pas les autres', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8), KIOSK(3)], activate: (call) => ({ results: [
    { key: 'cam:7', status: 'ACTIVATED', code: 'SERVER_CAMERA' },
    { key: 'cam:8', status: 'REFUSED', code: 'FACIAL_OFF', message: 'Pointage facial non activé sur cette caméra par l\'administration' },
    { key: 'trm:3', status: 'REFUSED', code: 'REVOKED', message: 'Terminal révoqué par l\'administration' }] }) });
  await r.run();
  await wait(700);
  assert.ok(r.of('/cameras/7/recognize').length >= 1); assert.equal(r.of('/cameras/8/recognize').length, 0);
  assert.match(r.row('cam:7').cells[3], /^Actif/);
  assert.match(r.row('cam:8').cells[3], /Refusé.*non activé sur cette caméra/); assert.match(r.row('trm:3').cells[3], /Refusé.*Terminal révoqué/);
  assert.equal(r.count('ftCountActive'), '1');
  r.close();
  const none = await boot({ devices: [CAM(7)], activate: () => ({ results: [{ key: 'cam:7', status: 'REFUSED', code: 'REVOKED', message: 'Terminal révoqué par l\'administration' }] }) });
  await none.run();
  assert.match(none.text('faceStatus'), /AUCUN TERMINAL ACTIVÉ CAM-7 : Terminal révoqué par l'administration/);
  await wait(500); assert.equal(none.of('/recognize').length, 0, 'aucune activation simulée');
  none.close();
});

test('aucun terminal autorisé / aucun terminal disponible / périmètre refusé : messages distincts, aucune tentative', async () => {
  let r = await boot({ devices: [], authorizedTotal: 0 });
  await r.F.start();
  assert.match(r.text('faceStatus'), /AUCUN TERMINAL AUTORISÉ.*Administration Système/);
  assert.ok(r.d.getElementById('faceTerminals').classList.contains('hidden')); assert.equal(r.F.running, false);
  r.close();
  r = await boot({ devices: [], authorizedTotal: 2 });
  await r.F.start();
  assert.match(r.text('faceStatus'), /AUCUN TERMINAL DISPONIBLE.*désactivés, non appairés ou révoqués/);
  r.close();
  r = await boot({ listStatus: 403 });
  await r.F.start();
  assert.match(r.text('faceStatus'), /PÉRIMÈTRE NON AUTORISÉ Site non autorisé pour ce compte Pointeur/);
  assert.equal(r.of('/recognize').length + r.of('/activate').length, 0);
  r.close();
});

test('moteur facial désactivé : liste visible, activation impossible, aucune tentative', async () => {
  const r = await boot({ engine: { ready: false, message: 'Biométrie désactivée (BIOMETRIC_ENABLED=false)' } });
  await r.F.start();
  assert.match(r.text('faceStatus'), /RECONNAISSANCE FACIALE DÉSACTIVÉE/);
  r.click('all');
  assert.equal(r.d.getElementById('ftActivate').disabled, true);
  r.click('activate'); await wait(300);
  assert.equal(r.of('/recognize').length, 0);
  r.close();
});

test('terminal révoqué pendant la surveillance : il s\'arrête seul, les autres continuent', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8)], recognize: (n, call) => (call.path.includes('/7/') ? { __status: 403, detail: 'Terminal non autorisé pour ce compte' } : { state: 'NO_FACE', recorded: false, reasons: [] }) });
  await r.run();
  await wait(1300);
  assert.equal(r.of('/cameras/7/recognize').length, 1, 'plus aucune tentative sur le terminal refusé');
  assert.match(r.row('cam:7').cells[3], /Refusé.*révoqué ou non autorisé/); assert.match(r.row('cam:8').cells[3], /^Actif/);
  assert.equal(r.F.runners.has('cam:7'), false); assert.equal(r.F.runners.has('cam:8'), true);
  // Le relevé d'état suivant ne le propose plus : il disparaît de la liste ET de la sélection.
  r.state.devices = [CAM(8)];
  await r.F.refresh();
  assert.deepEqual(r.rows().map((x) => x.key), ['cam:8']); assert.equal(r.count('ftCountSelected'), '1');
  const before = r.of('/cameras/8/recognize').length; await wait(1200);
  assert.ok(r.of('/cameras/8/recognize').length > before);
  r.close();
});

test('coupure réseau : résultat INCONNU, jamais « refusé » — vérification de statut avant tout nouvel essai', async () => {
  let cut = true;
  const r = await boot({ offline: (call) => cut && (call.path.endsWith('/recognize') || call.path.endsWith('/attempt')),
    attempt: () => ({ recorded: true, event: { id: 5, heure: '08:01:10', type: 'ENTREE', name: 'OUALI Amine', matricule: 'M001' } }) });
  await r.run();
  await wait(500);
  assert.match(r.text('faceStatus'), /CONNEXION INTERROMPUE Résultat du dernier essai inconnu.*Ne refaites pas le pointage\./);
  assert.doesNotMatch(r.text('faceStatus'), /REFUS/);
  assert.match(r.row('cam:7').cells[3], /Connexion interrompue.*résultat à vérifier/); assert.equal(r.count('ftCountOffline'), '1');
  const burst = r.of('/recognize')[0].body.burst_id;
  cut = false;
  r.d.getElementById('faceVerifyBtn').click(); await wait(200);
  const check = r.of('/attempt')[0];
  assert.equal(check.search, `?key=cam%3A7&burst_id=${burst}`, 'c\'est CET essai qui est vérifié');
  assert.equal(r.of('/recognize').length, 1, 'aucun nouvel essai avant la réponse du serveur');
  assert.match(r.text('faceStatus'), /POINTAGE ENREGISTRÉ OUALI Amine Matricule M001 · ENTRÉE · 08:01 Confirmé par le serveur après une coupure de connexion\./);
  assert.match(r.row('cam:7').cells[3], /^Actif/);
  r.close();
});

test('coupure réseau sans pointage : la vérification le dit, puis la détection reprend', async () => {
  let cut = true;
  const r = await boot({ offline: (call) => cut && call.path.endsWith('/recognize') });
  await r.run();
  await wait(450);
  assert.match(r.text('faceStatus'), /CONNEXION INTERROMPUE/);
  cut = false;
  r.F.verifyNow('cam:7'); await wait(200);
  assert.match(r.text('faceStatus'), /CONNEXION RÉTABLIE Vérification faite : l'essai interrompu n'a enregistré aucun pointage\./);
  await wait(1300);
  assert.ok(r.of('/recognize').length >= 2);
  r.close();
});

test('arrêter la surveillance des terminaux sélectionnés : boucles et aperçu arrêtés, réglages inchangés', async () => {
  const r = await boot({ devices: [CAM(7), CAM(8), KIOSK(3)] });
  await r.run();
  await wait(500);
  assert.equal(r.d.getElementById('ftStop').disabled, false);
  r.check('cam:8', false); r.check('trm:3', false);                 // seul cam:7 reste coché
  r.click('stop'); await wait(50);
  assert.deepEqual(r.of('/stop')[0].body, { keys: ['cam:7'], site_id: 12 });
  assert.equal(r.F.runners.has('cam:7'), false); assert.equal(r.F.runners.has('cam:8'), true); assert.equal(r.F.monitored.has('trm:3'), true);
  assert.match(r.row('cam:7').cells[3], /Disponible/);
  const seven = r.of('/cameras/7/recognize').length; await wait(1300);
  assert.equal(r.of('/cameras/7/recognize').length, seven); assert.ok(r.of('/cameras/8/recognize').length >= 2);
  r.click('all'); r.click('stop'); await wait(50);
  assert.equal(r.F.runners.size + r.F.monitored.size, 0); assert.equal(r.F.previewTimer, null);
  assert.match(r.text('faceStatus'), /SURVEILLANCE ARRÊTÉE/);
  const before = r.of('/recognize').length; await wait(1200);
  assert.equal(r.of('/recognize').length, before, 'plus aucune tentative après arrêt');
  assert.ok(r.calls.every((c) => ['GET', 'POST'].includes(c.method)), 'le Pointeur ne modifie aucune configuration (ni PATCH ni DELETE)');
  r.close();
});

test('visage inconnu : aucun pointage, message et pointage de secours (saisie manuelle)', async () => {
  const r = await boot({ recognize: () => ({ state: 'UNKNOWN_FACE', recorded: false, message: 'VISAGE INCONNU' }) });
  r.d.getElementById('appView').classList.remove('hidden');
  await r.run();
  await wait(700);
  assert.match(r.text('faceStatus'), /VISAGE INCONNU/);
  r.d.getElementById('faceFallbackBtn').click();
  assert.equal(r.F.running, false, 'le mode facial s\'arrête');
  assert.equal(r.d.getElementById('manualPanel').classList.contains('hidden'), false, 'saisie manuelle ouverte');
  r.close();
});

test('plusieurs visages / liveness : refus explicite, jamais d\'attribution', async () => {
  for (const [state, expected] of [['MULTIPLE_FACES', /PLUSIEURS VISAGES/], ['LIVENESS_FAILED', /Présence réelle non confirmée/], ['AMBIGUOUS', /AMBIGUË/]]) {
    const r = await boot({ recognize: () => ({ state, recorded: false, reasons: [] }) });
    await r.run();
    await wait(700);
    assert.match(r.text('faceStatus'), expected, state);
    r.close();
  }
});

test('nom renvoyé par le serveur échappé (aucune injection HTML), y compris le nom du terminal', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const r = await boot({ devices: [CAM(7, 12, { name: evil, site: evil, hardware: evil }), CAM(8)], recognize: () => RECORDED(1, { employee: { nom: evil, prenom: evil, matricule: evil }, action: 'SORTIE', heure: '18:00' }) });
  await r.run();
  await wait(700);
  assert.equal(r.d.querySelectorAll('#faceView img:not(#facePreview)').length, 0);
  assert.match(r.d.getElementById('faceStatus').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(r.row('cam:7').cells[1], /<img src=x onerror=alert\(1\)>/);
  r.close();
});

test('page : tableau compact et compteurs présents, script versionné (cache immuable)', () => {
  assert.match(HTML, /<script defer src="\/static\/pointeur-facial\.js\?v=20261010-integration-v1"><\/script>/);
  for (const id of ['faceTerminals', 'ftRows', 'ftAll', 'ftActivate', 'ftStop', 'ftCountSelected', 'ftCountActive', 'ftCountOffline', 'ftLastEvent']) assert.match(HTML, new RegExp(`id="${id}"`));
  assert.match(HTML, />Sélectionner tout<[\s\S]*>Désélectionner tout<[\s\S]*>Activer les terminaux sélectionnés<[\s\S]*>Arrêter la surveillance</);
  assert.doesNotMatch(HTML, /faceCameraSelect/);
});
