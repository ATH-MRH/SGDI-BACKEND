// pointeur.irongs.com — POINTAGE FACIAL AUTOMATIQUE activé d'UN clic dans la zone centrale du poste.
// Le moteur existant (app/static/pointeur-facial.js) s'exécute tel quel sur la VRAIE page ; réseau
// et caméra simulés. Le facial n'identifie que la personne : Attendance Core décide du reste.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur } = require('./load-pointeur');

const FACIAL_SRC = fs.readFileSync(path.join(__dirname, '../app/static/pointeur-facial.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointeur.html'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const CAM = (id, site, extra = {}) => ({ id, site_id: site, name: `CAM-${id}`, location: 'Entrée', adapter: 'DAHUA', usage: 'ATTENDANCE', role: 'ENTRY', is_default: true, active: true, facial_attendance_enabled: true, ...extra });
const iso = (hhmm) => `2026-10-01T${hhmm}:00+01:00`;
const E = (n) => ({ nom: `AGENT${n}`, prenom: 'Test', matricule: `M00${n}`, poste: 'Agent de sécurité' });
const POST = { site_id: 12, site: 'SITE A', status: 'OFFICIAL', current: { shift: 'APRES_MIDI', shift_label: 'Après-midi', group: 'B', start: '14:00', end: '22:00', scheduled_start: iso('14:00'), scheduled_end: iso('22:00') },
  next: null, maintien: null, kpi: { expected: 3, present: 1, absent: 2, excused: 0, maintien: 0, anomalies: 0 }, activity: { refused_today: 0 }, present: [], todo: [], movements: [], permissions: { manual_entry: false } };

async function boot({ status = { enabled: true, engine_available: true }, cameras = { 12: [CAM(7, 12)], 13: [CAM(9, 13)] }, recognize, site = '12', recognizeDelay = 0 } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    const call = { path: u.pathname, search: u.search, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, at: Date.now() };
    calls.push(call);
    const json = (data, code = 200) => ({ ok: code < 400, status: code, headers: { get: () => null }, json: async () => data, blob: async () => new Blob(['x']) });
    if (u.pathname === '/api/biometrics/status') return json(status);
    if (u.pathname === '/api/biometrics/cameras') return json(u.searchParams.get('site_id') ? (cameras[u.searchParams.get('site_id')] || []) : Object.values(cameras).flat());
    if (u.pathname.endsWith('/preview.jpg')) return json({});
    if (u.pathname.endsWith('/recognize')) {
      if (recognizeDelay) await wait(recognizeDelay);
      const out = recognize ? recognize(n++, call) : { state: 'NO_FACE', recorded: false, reasons: [] };
      return out && out.__status ? json({ detail: out.detail }, out.__status) : json(out);
    }
    if (u.pathname === '/api/portal/attendance-live') return json({ latest_event_id: 1, events: [], latest_refusal_id: 1, refusals: [], alerts: [], summary: { entries_today: 0, exits_today: 0, present_now: 1, absent_today: 0 },
      timezone: 'Africa/Algiers', server_now: iso('14:40'), post: u.searchParams.get('site_id') ? { ...POST, site_id: Number(u.searchParams.get('site_id')) } : null });
    if (u.pathname === '/api/portal/attendance-sites') return json([{ id: 12, name: 'SITE A' }, { id: 13, name: 'SITE B' }]);
    return json([]);
  };
  const ctx = loadPointeur({ url: 'https://pointeur.irongs.com/', fetch, session: SESSION });
  const w = ctx.window, d = w.document;
  w.URL.createObjectURL = () => 'blob:preview';
  w.URL.revokeObjectURL = () => {};
  await wait(80);
  w.__pointeurTest.stopLivePolling();
  w.__pointeurTest.setSelectedSite(site);
  w.eval(FACIAL_SRC);
  if (site) await w.__pointeurTest.pollLive();
  const of = (suffix) => calls.filter((c) => c.path.endsWith(suffix));
  const text = (id) => d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const close = () => { try { w.PointeurFacial.stop(); w.__pointeurTest.stopLivePolling(); w.close(); } catch (e) { /* déjà fermée */ } };
  return { ...ctx, w, d, calls, of, text, close, T: w.__pointeurTest, F: () => w.PointeurFacial };
}
const visible = (r, id) => !r.d.getElementById(id).classList.contains('hidden');
const sys = (r, id) => [r.d.querySelector(`#${id} dd`).textContent, r.d.getElementById(id).getAttribute('data-tone')];

test('UN clic sur « Reconnaissance faciale » : mode facial actif dans la zone centrale, sans second clic ni redirection', async () => {
  const r = await boot();
  const card = r.d.getElementById('faceModeBtn');
  assert.match(card.textContent, /Reconnaissance faciale\s*Détection automatique/);
  card.click();
  await wait(450);
  assert.equal(r.T.getFacialMode(), true);
  assert.ok(visible(r, 'faceView')); assert.ok(r.d.getElementById('scannerCard').contains(r.d.getElementById('faceView')), 'dans la zone de pointage');
  assert.match(r.text('faceView'), /POINTAGE FACIAL AUTOMATIQUE/);
  // Le poste reste affiché : vacation, KPI, à traiter.
  assert.equal(r.d.querySelector('main.main').classList.contains('hidden'), false);
  assert.match(r.text('shiftBanner'), /APRÈS-MIDI 14:00 → 22:00 GROUPE B/); assert.ok(r.d.getElementById('postKpis').children.length === 5);
  assert.match(r.text('lastScanCard'), /EN ATTENTE D’UN VISAGE.*Vacation actuelle : 14:00 → 22:00 · Groupe B/);
  // Moteur existant, site du poste, caméra du site, détection lancée — aucun clic « caméra ».
  assert.equal(r.of('/api/biometrics/cameras')[0].search, '?site_id=12');
  assert.ok(r.of('/cameras/7/preview.jpg').length >= 1); assert.ok(r.of('/cameras/7/recognize').length >= 1);
  assert.ok(visible(r, 'facePreview')); assert.equal(r.d.getElementById('faceCameraLabel').textContent, 'CAM-7 · Entrée');
  assert.equal(r.d.getElementById('faceModeBtn').getAttribute('aria-pressed'), 'true'); assert.equal(r.d.getElementById('qrModeBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(r.w.location.hostname, 'pointeur.irongs.com');
  assert.ok(r.calls.every((c) => c.path.startsWith('/api/')), 'aucun appel hors API (jamais la caméra en direct)');
  assert.deepEqual(sys(r, 'sysCamera'), ['Active', 'ok']); assert.deepEqual(sys(r, 'sysFace'), ['Active', 'ok']); assert.equal(sys(r, 'sysReader')[0], 'En pause (mode facial)');
  r.close();
});

test('le lecteur QR par caméra n\'est pas le facial : libellé explicite, masqué en mode facial', async () => {
  const r = await boot();
  assert.equal(r.d.getElementById('cameraModeBtn').textContent.trim(), '▣ LIRE LE QR AVEC LA CAMÉRA');
  assert.doesNotMatch(HTML, /UTILISER LA CAMÉRA/);
  r.d.getElementById('faceModeBtn').click(); await wait(300);
  assert.match(HTML, /#scannerCard\.facial-mode :is\(#usbReader,#reader,#restartBtn,#cameraModeBtn,\.station-foot\)\{display:none!important\}/);
  r.close();
});

test('« Tous les sites » : SÉLECTIONNEZ UN SITE, aucune caméra choisie arbitrairement ; puis le site choisi démarre le facial', async () => {
  const r = await boot({ site: '' });
  r.d.getElementById('faceModeBtn').click(); await wait(300);
  assert.match(r.text('faceStatus'), /SÉLECTIONNEZ UN SITE Le pointage facial automatique nécessite un site précis\./);
  assert.equal(r.of('/api/biometrics/cameras').length, 0); assert.equal(r.of('/recognize').length, 0);
  assert.ok(r.d.getElementById('faceView').classList.contains('no-video'), 'aucun cadre vidéo vide');
  assert.ok(r.d.getElementById('siteSelector'), 'le sélecteur de site existant reste disponible');
  await r.T.changeAttendanceSite('13'); await wait(450);
  assert.equal(r.of('/api/biometrics/cameras')[0].search, '?site_id=13'); assert.ok(r.of('/cameras/9/recognize').length >= 1);
  r.close();
});

test('aucune caméra de pointage : état explicite et compact, aucune tentative', async () => {
  const r = await boot({ cameras: { 12: [CAM(3, 12, { adapter: 'TERMINAL' }), CAM(4, 12, { active: false }), CAM(5, 12, { usage: 'ENROLLMENT' })] } });
  r.d.getElementById('faceModeBtn').click(); await wait(350);
  assert.match(r.text('faceView'), /POINTAGE FACIAL AUTOMATIQUE.*AUCUNE CAMÉRA DE POINTAGE Aucune caméra active n'est déclarée pour ce site\./);
  assert.ok(r.d.getElementById('faceView').classList.contains('no-video')); assert.equal(visible(r, 'facePreview'), false);
  assert.equal(r.of('/recognize').length, 0); assert.equal(r.of('/preview.jpg').length, 0);
  assert.deepEqual(sys(r, 'sysCamera'), ['Non disponible', 'bad']);
  assert.equal(r.d.querySelector('#faceView button'), null, 'aucune action de configuration proposée au pointeur');
  r.close();
});

test('facial désactivé (serveur, site ou caméra) : refus propre, protection jamais contournée', async () => {
  let r = await boot({ status: { enabled: false, engine_available: false } });
  r.d.getElementById('faceModeBtn').click(); await wait(300);
  assert.match(r.text('faceStatus'), /RECONNAISSANCE FACIALE DÉSACTIVÉE/); assert.equal(r.of('/recognize').length, 0);
  assert.deepEqual(sys(r, 'sysFace'), ['Désactivée', 'bad']);
  r.close();
  r = await boot({ cameras: { 12: [CAM(7, 12, { facial_attendance_enabled: false })] } });
  r.d.getElementById('faceModeBtn').click(); await wait(300);
  assert.match(r.text('faceStatus'), /RECONNAISSANCE FACIALE DÉSACTIVÉE pour ce site/); assert.equal(r.of('/recognize').length, 0);
  r.close();
  r = await boot({ recognize: () => ({ __status: 409, detail: 'Pointage facial non activé pour cette caméra (activation pilote requise)' }) });
  r.d.getElementById('faceModeBtn').click(); await wait(500);
  assert.match(r.text('faceStatus'), /RECONNAISSANCE FACIALE DÉSACTIVÉE pour ce site/);
  const count = r.of('/recognize').length; await wait(1300);
  assert.equal(r.of('/recognize').length, count, 'plus aucune tentative après le refus');
  r.close();
});

test('visage reconnu : identité affichée, Attendance Core décide, la fiche du poste se met à jour, puis retour à l\'attente', async () => {
  const r = await boot({ recognize: (n) => (n === 0 ? { state: 'ATTENDANCE_RECORDED', recorded: true, employee: E(1), action: 'ENTRÉE', heure: '13:37', site: 'SITE A',
    counted: { kind: 'NORMAL', counted_start: iso('14:00') } } : { state: 'NO_FACE', recorded: false, reasons: [] }) });
  r.d.getElementById('faceModeBtn').click(); await wait(600);
  assert.match(r.text('faceStatus'), /POINTAGE ENREGISTRÉ AGENT1 Test Matricule M001 · Agent de sécurité · ENTRÉE · 13:37/);
  const body = r.of('/recognize')[0].body;
  assert.deepEqual(Object.keys(body), ['burst_id'], 'le facial ne transmet ni entrée/sortie, ni vacation, ni image');
  assert.ok(r.of('/api/portal/attendance-live').length >= 2, 'la fiche du poste (réel / planifié / comptabilisé) est rafraîchie aussitôt');
  // Pendant l'affichage : aucune nouvelle reconnaissance ; ensuite retour automatique, caméra toujours active.
  assert.equal(r.of('/recognize').length, 1); await wait(1500); assert.equal(r.of('/recognize').length, 1);
  await wait(2600);
  assert.ok(r.of('/recognize').length >= 2, 'détection reprise sans nouveau clic'); assert.match(r.text('faceStatus'), /PRÊT — placez-vous face à la caméra/);
  assert.equal(r.T.getFacialMode(), true); assert.deepEqual(sys(r, 'sysCamera'), ['Active', 'ok']);
  r.close();
});

test('refus d\'Attendance Core : motif réel affiché avec la fiche V5, aucun mouvement', async () => {
  const refusal = { code: 'EXTRA_BEFORE_WINDOW', message: 'Nouvelle entrée refusée', kind: 'EXTRA_SHIFT', scheduled_start: iso('14:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'),
    previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } };
  const r = await boot({ recognize: () => ({ state: 'REFUSED', recorded: false, employee: E(2), message: 'Nouvelle entrée refusée : nouvelle entrée possible de 14:30 à 14:45.', code: 'EXTRA_BEFORE_WINDOW', refusal }) });
  r.d.getElementById('faceModeBtn').click(); await wait(600);
  assert.match(r.text('faceStatus'), /POINTAGE REFUSÉ AGENT2 Test Matricule M002.*Aucun mouvement enregistré\./);
  const card = r.text('scanResultCard');
  assert.match(card, /POINTAGE REFUSÉ.*AGENT2 Test.*NOUVELLE ENTRÉE NON AUTORISÉE.*Vacation précédente 06:00 → 14:00 Sortie enregistrée 14:04 Nouvelle entrée possible 14:30 → 14:45.*AUCUN MOUVEMENT ENREGISTRÉ/);
  r.close();
  const early = await boot({ recognize: () => ({ state: 'REFUSED', recorded: false, employee: E(2), message: 'Pointage hors fenêtre', code: 'EARLY_OUTSIDE_WINDOW',
    refusal: { code: 'EARLY_OUTSIDE_WINDOW', kind: 'NORMAL', scheduled_start: iso('14:00'), window_opens_at: iso('13:30'), actual_entry: iso('13:21') } }) });
  early.d.getElementById('faceModeBtn').click(); await wait(600);
  assert.match(early.text('scanResultCard'), /ARRIVÉE HORS FENÊTRE.*Votre vacation commence à 14:00\..*Pointage autorisé à partir de 13:30/);
  early.close();
});

test('visage inconnu : aucun mouvement, aucun rattachement, secours par la saisie manuelle existante', async () => {
  const r = await boot({ recognize: () => ({ state: 'UNKNOWN_FACE', recorded: false, message: 'VISAGE INCONNU' }) });
  r.d.getElementById('faceModeBtn').click(); await wait(600);
  assert.match(r.text('faceStatus'), /VISAGE INCONNU Aucun pointage n'a été enregistré\./);
  assert.doesNotMatch(r.text('faceStatus'), /AGENT|Matricule/);
  assert.match(r.text('lastScanCard'), /EN ATTENTE D’UN VISAGE/); assert.equal(r.d.getElementById('scanResultCard').classList.contains('is-open'), false, 'aucune fiche de pointage');
  r.d.getElementById('faceFallbackBtn').click(); await wait(50);
  assert.equal(r.T.getFacialMode(), false); assert.ok(visible(r, 'manualPanel')); assert.equal(r.F().running, false);
  r.close();
});

test('anti-rebond : 10 détections du même visage en rafale ⇒ UNE reconnaissance ; deux personnes successives pointent chacune', async () => {
  const r = await boot({ recognizeDelay: 120, recognize: (n) => ({ state: 'ATTENDANCE_RECORDED', recorded: true, employee: E(n + 1), action: 'ENTRÉE', heure: '14:0' + n }) });
  r.d.getElementById('faceModeBtn').click(); await wait(380);
  // Dix déclenchements forcés pendant le traitement puis pendant l'affichage du résultat.
  for (let i = 0; i < 10; i++) { r.d.getElementById('faceModeBtn').click(); r.F().start(); await wait(40); }
  assert.equal(r.of('/recognize').length, 1, 'verrou pendant reconnaissance + affichage');
  assert.match(r.text('faceStatus'), /AGENT1 Test/);
  await wait(3900);                                                    // fin de l'affichage : la personne suivante
  assert.equal(r.of('/recognize').length, 2); assert.match(r.text('faceStatus'), /AGENT2 Test/);
  assert.notEqual(r.of('/recognize')[0].body.burst_id, r.of('/recognize')[1].body.burst_id, 'une clé d\'idempotence par rafale');
  r.close();
});

for (const [label, leave, check] of [
  ['QR', (r) => r.d.getElementById('qrModeBtn').click(), (r) => assert.equal(r.d.getElementById('qrModeBtn').getAttribute('aria-pressed'), 'true')],
  ['saisie manuelle', (r) => r.d.getElementById('manualModeBtn').click(), (r) => assert.ok(visible(r, 'manualPanel'))],
  ['déconnexion', (r) => r.T.logout(), (r) => assert.ok(visible(r, 'loginView'))],
]) {
  test(`nettoyage : facial actif → ${label} — détection, aperçu et minuteurs arrêtés, aucun appel facial ultérieur`, async () => {
    const r = await boot({ recognizeDelay: 200 });
    r.d.getElementById('faceModeBtn').click(); await wait(420);       // une reconnaissance est en vol
    assert.equal(r.F().running, true); assert.ok(r.F().previewTimer);
    await leave(r); await wait(60);
    assert.equal(r.T.getFacialMode(), false); assert.equal(r.F().running, false);
    assert.equal(r.F().timer, null); assert.equal(r.F().previewTimer, null); assert.equal(r.F().camera, null);
    assert.equal(visible(r, 'faceView'), false); assert.equal(visible(r, 'facePreview'), false);
    assert.ok(r.d.getElementById('sysCamera').classList.contains('hidden'));
    check(r);
    const before = r.calls.filter((c) => c.path.startsWith('/api/biometrics/')).length;
    const status = r.text('faceStatus');
    await wait(1500);                                                  // la réponse en vol arrive : elle est ignorée
    assert.equal(r.calls.filter((c) => c.path.startsWith('/api/biometrics/')).length, before, 'aucun appel facial après l\'arrêt');
    assert.equal(r.text('faceStatus'), status, 'aucun résultat tardif affiché');
    r.close();
  });
}

test('changement de site en mode facial : ancien contexte arrêté, caméra du NOUVEAU site, jamais de pointage vers l\'ancien', async () => {
  const r = await boot({ recognizeDelay: 250, recognize: (n, call) => ({ state: 'ATTENDANCE_RECORDED', recorded: true, employee: E(call.path.includes('/7/') ? 1 : 2), action: 'ENTRÉE', heure: '14:00' }) });
  r.d.getElementById('faceModeBtn').click(); await wait(420);         // reconnaissance en vol sur la caméra 7 (site 12)
  assert.equal(r.of('/cameras/7/recognize').length, 1);
  const switchedAt = Date.now();
  await r.T.changeAttendanceSite('13'); await wait(900);
  assert.equal(r.T.getFacialMode(), true, 'le mode facial reste actif, sans nouveau clic');
  assert.equal(r.F().siteId, '13'); assert.equal(r.F().camera.id, 9);
  assert.equal(r.of('/api/biometrics/cameras').pop().search, '?site_id=13');
  assert.equal(r.calls.filter((c) => c.path.includes('/cameras/7/') && c.at > switchedAt).length, 0, 'plus aucun appel à la caméra du site précédent');
  assert.ok(r.of('/cameras/9/recognize').length >= 1);
  assert.doesNotMatch(r.text('faceStatus'), /AGENT1/, 'la réponse tardive de l\'ancien site n\'est pas affichée');
  r.close();
});

test('mise en page : cadre vidéo stable, aucun bouton « Capturer », entrée du header identique à la carte', async () => {
  assert.match(HTML, /#scannerCard \.face-stage\{width:100%;max-width:560px;margin:12px auto;aspect-ratio:16\/9/);
  assert.match(HTML, /#scannerCard \.face-view\.no-video \.face-stage\{display:none\}/);
  const r = await boot();
  assert.equal(r.d.getElementById('faceModeBtn').getAttribute('onclick'), r.d.getElementById('faceNav').getAttribute('onclick'));
  r.d.getElementById('faceNav').click(); await wait(350);
  assert.equal(r.T.getFacialMode(), true);
  assert.equal([...r.d.querySelectorAll('#faceView button')].length, 0, 'aucun bouton Capturer / Valider');
  assert.doesNotMatch(r.text('faceView'), /capturer|valider/i);
  r.close();
});
