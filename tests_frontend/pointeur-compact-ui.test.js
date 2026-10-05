// pointeur.irongs.com — V5.1 : barre KPI compacte, activité du jour sur une ligne et résultat de
// pointage en CARTE FLOTTANTE temporaire (hors flux). Refonte d'affichage uniquement : mêmes
// données, mêmes appels, mêmes règles. VRAIE page dans jsdom ; seul le réseau est simulé.
// La géométrie (hauteurs, absence de déplacement) est vérifiée en Chrome réel :
// tests_frontend/pointeur-compact-ui-chrome.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur } = require('./load-pointeur');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'pointeur.html'), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const iso = (hhmm) => `2026-10-01T${hhmm}:00+01:00`;
const E1 = { id: 11, matricule: 'K39', nom: 'BOUHELEL', prenom: 'ABDELILLAH', fonction: 'CARISTE', poste: 'CARISTE', societe: 'IRON GLOBAL SOLUTION', group: 'B', photo: '' };
const E2 = { id: 12, matricule: 'K088', nom: 'BENALI', prenom: 'SAMIR', fonction: 'AGENT', poste: 'AGENT', group: 'A', photo: '' };
const POST = (value, over = {}) => ({ site_id: 12, site: 'SITE TEST', status: 'OFFICIAL', reason: null,
  current: { shift: 'APRES_MIDI', shift_label: 'Après-midi', group: 'B', work_date: '2026-10-01', start: '14:00', end: '22:00', scheduled_start: iso('14:00'), scheduled_end: iso('22:00') }, next: null, maintien: null,
  kpi: { expected: value, present: value, absent: value, excused: value ? 2 : 0, maintien: value, anomalies: value }, activity: { refused_today: value }, present: [], todo: [], movements: [], permissions: { manual_entry: true }, ...over });
const LIVE = (post, extra = {}) => ({ latest_event_id: 50, events: [], latest_refusal_id: 9, refusals: [], alerts: [], summary: { entries_today: 9, exits_today: 0, present_now: 9, absent_today: 0 },
  timezone: 'Africa/Algiers', server_now: iso('14:40'), operational_date: '2026-10-01', server_time: '14:40:00', post, ...extra });
const COUNTED = { kind: 'NORMAL', group: 'B', scheduled_start: iso('14:00'), scheduled_end: iso('22:00'), actual_entry: '2026-10-01T14:21:41+01:00', counted_start: iso('14:21') };
const EVENT = (id, type, extra = {}) => ({ id, type, heure: type === 'ENTREE' ? '14:21:41' : '22:18:13', date: '2026-10-01', source: 'QR', source_label: 'QR', site: 'DHL FORWARDING / HAMOUL 01 (40K)', site_id: 12,
  state: type === 'ENTREE' ? 'PRESENT' : 'SORTI', employee: E1, counted: type === 'ENTREE' ? COUNTED : { ...COUNTED, actual_exit: '2026-10-01T22:18:13+01:00', counted_end: iso('22:00'), counted_minutes: 459 }, ...extra });

function boot({ live = [LIVE(POST(9))], routes = {} } = {}) {
  const calls = [], replies = [...live];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    calls.push({ path: u.pathname, method: opts.method || 'GET' });
    if (routes[u.pathname]) return routes[u.pathname](u, opts);
    if (u.pathname === '/api/portal/attendance-live') return { ok: true, status: 200, json: async () => (replies.length > 1 ? replies.shift() : replies[0]) };
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'SITE TEST' }] };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  const w = ctx.window, d = w.document;
  // Le minuteur de fermeture automatique est capturé : les tests le déclenchent eux-mêmes. L'identifiant
  // rendu est hors de la plage des vrais minuteurs : clearTimeout() ne doit en annuler aucun autre.
  const real = w.setTimeout.bind(w), closers = [];
  w.setTimeout = (fn, ms, ...rest) => (ms === 6000 ? 1e9 + closers.push(fn) : real(fn, ms, ...rest));
  const text = (id) => d.getElementById(id).innerHTML.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { ...ctx, w, d, calls, closers, text, card: () => d.getElementById('scanResultCard'), T: () => w.__pointeurTest };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.dom.window.close(); } catch (e) { /* déjà fermée */ } } });
async function ready(t) { opened.push(t); await tick(90); t.T().stopLivePolling(); await t.T().pollLive(); return t; }
const isOpen = (t) => t.card().classList.contains('is-open');

test('KPI : barre compacte — libellé, valeur, petit sous-libellé ; couleurs sémantiques et calculs inchangés', async () => {
  for (const value of [0, 9, 99, 999]) {
    const t = await ready(boot({ live: [LIVE(POST(value))] }));
    const cells = [...t.d.querySelectorAll('#postKpis .v5-kpi')];
    assert.deepEqual(cells.map((c) => [c.querySelector('small').textContent, c.querySelector('b').textContent, c.dataset.tone]), [
      ['Attendus', String(value), 'blue'], ['Présents', String(value), 'green'], ['Absents / non pointés', String(value), value ? 'red' : 'muted'],
      ['En maintien', String(value), value ? 'orange' : 'muted'], ['Anomalies', String(value), value ? 'red' : 'muted']]);
    // Plus cinq cartes : des cases d'une même barre. Le sous-libellé reste lisible en entier au survol.
    assert.ok(cells.every((c) => !c.classList.contains('v5-card') && c.children.length <= 3));
    const excused = cells[2].querySelector('span');
    if (value) { assert.equal(excused.textContent, '2 en congé, maladie ou mission'); assert.equal(excused.getAttribute('title'), excused.textContent); } else assert.equal(excused, null);
    assert.equal(cells[0].querySelector('span').textContent, 'Groupe B');
    assert.equal(t.text('refusedCount'), String(value));
  }
  const css = HTML.slice(HTML.indexOf('<style id="ptr-v5-style">'));
  assert.match(css, /body\.ptr-v5 \.v5-kpis\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\);gap:1px;margin:0 0 8px;/);
  assert.match(css, /body\.ptr-v5 \.v5-kpi\{display:grid;[^}]*min-height:54px;padding:7px 14px 7px 16px;/);
});

test('activité du jour : une ligne — libellé, entrées, sorties, refus ; compteurs et filtres historiques conservés', async () => {
  const t = await ready(boot());
  const row = t.d.querySelector('.status-row');
  assert.equal(row.querySelector('.v5-activity-label').textContent, 'Activité du jour');
  assert.deepEqual([...row.querySelectorAll('.presence-summary button')].map((b) => [b.dataset.liveFilter, b.querySelector('small').textContent, b.querySelector('b').id]),
    [['entrees', 'Entrées aujourd’hui', 'entrantCount'], ['sorties', 'Sorties aujourd’hui', 'sortantCount'], ['presents', 'Présents sur site', 'presentCount'], ['absents', 'Absents aujourd’hui', 'absentCount']]);
  assert.equal(row.querySelectorAll('.v5-day-suffix').length, 2, '« aujourd’hui » masqué dans la barre compacte, conservé hors poste');
  assert.match(row.querySelector('.v5-activity-chip').textContent, /^Refus 9$/);
  assert.match(row.querySelector('.v5-activity-chip').getAttribute('title'), /Tentatives refusées aujourd'hui/);
  assert.deepEqual([t.text('entrantCount'), t.text('sortantCount')], ['09', '00']);
  const css = HTML.slice(HTML.indexOf('<style id="ptr-v5-style">'));
  assert.match(css, /body\.ptr-v5\.has-post \.presence-summary button\{min-height:30px;/);
  assert.match(css, /body\.ptr-v5 \.v5-activity-chip\{[^}]*min-height:30px;/);
  assert.match(css, /body\.ptr-v5\.has-post \.v5-day-suffix\{display:none\}/);
});

test('carte flottante : hors flux, une seule, au-dessus du contenu et sous le header et l\'alerte d\'inactivité', async () => {
  const t = await ready(boot());
  const card = t.card();
  assert.equal(card.parentElement, t.d.querySelector('main.main'), 'hors de la zone de pointage');
  assert.equal(t.d.getElementById('scannerCard').contains(card), false);
  assert.equal(t.d.querySelectorAll('.scan-result').length, 1);
  assert.equal(t.d.getElementById('result'), null, 'ancien bandeau de résultat dans le flux supprimé');
  assert.equal(isOpen(t), false); assert.equal(card.innerHTML, '');
  const css = HTML.slice(HTML.indexOf('<style id="ptr-v5-style">'));
  assert.match(css, /body\.ptr-v5 \.scan-result\{[^}]*display:none;position:fixed;z-index:900;[^}]*width:min\(560px,calc\(100vw - 24px\)\);/);
  assert.match(css, /body\.ptr-v5 \.scan-result\.is-open\{display:block;animation:srIn \.2s ease\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{body\.ptr-v5 \.scan-result\.is-open\{animation:none\}\}/);
  assert.match(css, /@media\(max-width:1023px\)\{body\.ptr-v5 \.scan-result\{width:min\(520px,calc\(100vw - 24px\)\)\}\}/);
  assert.match(HTML, /body\.ptr-v3 #appView>\.top\{position:sticky;top:0;z-index:1000;/);
  assert.match(HTML, /\.idle-warning\{display:none;position:fixed;inset:0;z-index:5000;/);
  assert.equal(t.T().LAST_SCAN_DISPLAY_MS, 6000);
});

test('entrée, sortie, maintien, refus : couleur, annonce et contenu de la carte ; la zone de pointage n\'est pas redessinée', async () => {
  const t = await ready(boot());
  const zone = t.d.getElementById('lastScanCard'), waiting = zone.firstElementChild, modes = t.d.querySelector('.mode-grid'), reader = t.d.getElementById('reader');
  const shown = (tone, role) => { assert.ok(isOpen(t) && t.card().classList.contains(tone), t.card().className); assert.equal(t.card().getAttribute('role'), role); return t.text('scanResultCard'); };

  t.T().showLastScan(EVENT(71, 'ENTREE'));
  assert.match(shown('is-entry', 'status'), /^ENTRÉE ENREGISTRÉE QR VALIDÉ × BA BOUHELEL ABDELILLAH K39 · CARISTE DHL FORWARDING \/ HAMOUL 01 \(40K\) · IRON GLOBAL SOLUTION 14:21:41 Groupe B Pointage réel 14:21:41 Début planifié 14:00 Temps comptabilisé à partir de 14:21 ÉTAT ACTUEL : PRÉSENT$/);
  t.T().showLastScan(EVENT(72, 'SORTIE'));
  assert.match(shown('is-exit', 'status'), /^SORTIE ENREGISTRÉE.*22:18:13.*Fin planifiée 22:00 Temps comptabilisé jusqu’à 22:00 Durée comptabilisée 7 h 39 ÉTAT ACTUEL : VACATION TERMINÉE$/);
  t.T().showLastScan(EVENT(73, 'ENTREE', { employee: E2, heure: '14:34:00', counted: { kind: 'EXTRA_SHIFT', group: 'A', scheduled_start: iso('14:00'), scheduled_end: iso('22:00'), actual_entry: '2026-10-01T14:34:00+01:00', counted_start: iso('14:34') } }));
  assert.match(shown('is-maintien', 'status'), /^MAINTIEN ENREGISTRÉ.*BENALI SAMIR K088 · AGENT.*14:34:00.*Deuxième vacation 14:00 → 22:00 Début réel 14:34:00 Temps comptabilisé à partir de 14:34 ÉTAT ACTUEL : EN MAINTIEN$/);
  assert.doesNotMatch(t.text('scanResultCard'), /BOUHELEL/, 'le nouveau résultat remplace le précédent');
  t.T().showLastRefusal({ id: 8, heure: '14:10:00', label: 'x', code: 'EARLY_OUTSIDE_WINDOW', employee: E1, terminal: 'CAM-ENTREE-01', counted: { kind: 'NORMAL', scheduled_start: iso('14:00'), window_opens_at: iso('13:30'), actual_entry: iso('13:21') } });
  assert.match(shown('is-refused', 'alert'), /^POINTAGE REFUSÉ × BA BOUHELEL ABDELILLAH K39 · CARISTE CAM-ENTREE-01 ARRIVÉE HORS FENÊTRE 14:10:00 Votre vacation commence à 14:00\. Pointage autorisé à partir de 13:30 Tentative 13:21:00 AUCUN MOUVEMENT ENREGISTRÉ$/);
  // Refus sans motif structuré : le libellé n'est pas répété deux fois.
  t.T().showLastRefusal({ id: 9, heure: '14:11:00', employee: E1, message: 'Pointage refusé : employé suspendu' });
  assert.equal((t.text('scanResultCard').match(/POINTAGE REFUSÉ/g) || []).length, 1);

  assert.equal(t.d.querySelectorAll('.scan-result.is-open').length, 1, 'jamais deux cartes');
  assert.equal(t.card().children.length, 2, 'une seule fiche dans la carte');
  assert.equal(zone.firstElementChild, waiting, 'zone d\'attente intacte'); assert.ok(zone.classList.contains('is-idle'));
  assert.equal(t.d.querySelector('.mode-grid'), modes); assert.equal(t.d.getElementById('reader'), reader);
  assert.equal(t.card().contains(t.d.activeElement), false, 'le focus n\'est pas déplacé vers la carte');
});

test('fermeture : bouton × accessible, touche Échap, ou seule après 6 s — un nouveau pointage relance le délai', async () => {
  const t = await ready(boot());
  t.T().showLastScan(EVENT(71, 'ENTREE'));
  const close = t.card().querySelector('.sr-close');
  assert.deepEqual([close.tagName, close.getAttribute('type'), close.getAttribute('aria-label'), close.textContent], ['BUTTON', 'button', 'Fermer le résultat', '×']);
  close.click();
  assert.equal(isOpen(t), false); assert.equal(t.card().innerHTML, '');
  t.T().showLastScan(EVENT(72, 'SORTIE'));
  t.d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(isOpen(t), false, 'Échap');
  // Fermeture automatique : le minuteur du premier résultat ne ferme pas le second.
  const before = t.closers.length;
  t.T().showLastScan(EVENT(73, 'ENTREE')); t.T().showLastScan(EVENT(74, 'SORTIE'));
  assert.equal(t.closers.length, before + 2);
  t.closers.at(-1)();
  assert.equal(isOpen(t), false, 'fermée seule');
  // Le même passage relevé une seconde fois ne redessine rien : le délai repart seulement.
  t.T().showLastScan(EVENT(75, 'ENTREE')); const body = t.card().firstElementChild;
  t.T().showLastScan(EVENT(75, 'ENTREE'));
  assert.equal(t.card().firstElementChild, body);
  // Derniers mouvements et présents : la fermeture de la carte ne retire aucune trace.
  t.T().setPost(POST(9, { movements: [{ key: 'e75', type: 'ENTREE', label: 'ENTRÉE', heure: '14:21:41', at: iso('14:21'), matricule: 'K39', name: 'BOUHELEL ABDELILLAH' }],
    present: [{ employee: E1, event_id: 75, entry: '14:21', entry_at: iso('14:21'), shift_start: '14:00', shift_end: '22:00', kind: 'NORMAL', badge: 'EN_POSTE', badge_label: 'EN POSTE' }] }));
  t.card().querySelector('.sr-close').click();
  assert.match(t.text('movementsList'), /14:21:41 K39 BOUHELEL ABDELILLAH ENTRÉE/); assert.match(t.text('presentNowList'), /BOUHELEL ABDELILLAH/);
});

test('scan QR : retour immédiat dans la même carte, puis fiche complète de la relève ; erreur sans motif expliquée', async () => {
  const scan = { success: true, action: 'arrivee', cycle: 1, heure: '14:21:41', date: '2026-10-01', site: 'DHL FORWARDING / HAMOUL 01 (40K)', employee: { ...E1 } };
  let reply = { ok: true, status: 200, headers: { get: () => null }, json: async () => scan };
  const t = await ready(boot({ live: [LIVE(POST(9)), LIVE(POST(9), { latest_event_id: 71, events: [EVENT(71, 'ENTREE')] })], routes: { '/api/portal/attendance-qr/scan': async () => reply } }));
  await t.T().onQr('qr-token'); await tick(60);
  assert.ok(isOpen(t) && t.card().classList.contains('is-entry'));
  assert.match(t.text('scanResultCard'), /^ENTRÉE ENREGISTRÉE QR VALIDÉ.*BOUHELEL ABDELILLAH.*ÉTAT ACTUEL : PRÉSENT$/, 'fiche complète de la relève');
  // Le retour immédiat d'un scan ne remplace jamais la fiche complète déjà affichée pour la même personne.
  const full = t.card().firstElementChild;
  t.T().showResult({ name: 'BOUHELEL ABDELILLAH', matricule: 'K39', action: 'arrivee', heure: '14:21:41', site: 'SITE', poste: 'CARISTE' }, 'success');
  assert.equal(t.card().firstElementChild, full);
  // Autre personne : retour immédiat affiché (avant la relève).
  t.T().showResult({ name: 'BENALI SAMIR', matricule: 'K088', action: 'depart', heure: '22:01:00', site: 'SITE TEST', poste: 'AGENT', overtime: true }, 'warning');
  assert.ok(t.card().classList.contains('is-exit'));
  assert.match(t.text('scanResultCard'), /^SORTIE ENREGISTRÉE × BS BENALI SAMIR K088 · AGENT SITE TEST 22:01:00 ⚠ VOLUME HORAIRE DÉPASSÉ$/);
  // La relève apporte la fiche complète : l'alerte de volume horaire y reste affichée.
  t.T().showLastScan(EVENT(72, 'SORTIE', { employee: E2 }));
  assert.match(t.text('scanResultCard'), /BENALI SAMIR.*Durée comptabilisée 7 h 39 ⚠ VOLUME HORAIRE DÉPASSÉ ÉTAT ACTUEL : VACATION TERMINÉE$/);
  // QR illisible : carte rouge, message opérationnel, aucun avatar inventé.
  t.T().closeScanResult(); await tick(1900);                     // fin de l'anti-rebond du lecteur
  reply = { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ detail: 'QR inconnu ou expiré.' }) };
  await t.T().onQr('bad'); await tick();
  assert.ok(t.card().classList.contains('is-refused') && t.card().classList.contains('no-photo')); assert.equal(t.card().getAttribute('role'), 'alert');
  assert.match(t.text('scanResultCard'), /^POINTAGE REFUSÉ × QR inconnu ou expiré\. AUCUN MOUVEMENT ENREGISTRÉ$/);
  assert.equal(t.d.getElementById('lastScanPhoto'), null);
});

test('saisie manuelle : la carte apparaît, le formulaire reste en place ; refus avec le motif réel et l\'employé', async () => {
  const refusal = { code: 'PREVIOUS_SHIFT_NOT_CLOSED', message: 'Vacation précédente non clôturée.', previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: null } };
  const done = { success: true, action: 'arrivee', cycle: 1, heure: '14:21:41', date: '2026-10-01', site: 'SITE TEST', employee: { ...E1 } };
  let reply = { ok: true, status: 201, headers: { get: () => null }, json: async () => done };
  const t = await ready(boot({ routes: { '/api/portal/attendance-manual/scan': async () => reply } }));
  t.T().toggleManualPanel(); t.T().setManualResults([E1]); t.T().selectManualResult(0); await tick();
  const panel = t.d.getElementById('manualPanel'), cardStep = t.d.getElementById('manualCardStep'), before = t.d.getElementById('scannerCard').children.length;
  await t.T().confirmManualPointage('present'); await tick();
  assert.ok(isOpen(t) && t.card().classList.contains('is-entry'));
  assert.match(t.text('scanResultCard'), /^ENTRÉE ENREGISTRÉE × BA BOUHELEL ABDELILLAH K39 · CARISTE SITE TEST · IRON GLOBAL SOLUTION 14:21:41$/);
  // Rien n'est inséré dans la zone de pointage : même panneau, même nombre de blocs, formulaire visible.
  assert.equal(t.d.getElementById('scannerCard').children.length, before);
  assert.equal(t.d.getElementById('manualPanel'), panel); assert.equal(panel.classList.contains('hidden'), false); assert.equal(cardStep.classList.contains('hidden'), false);
  assert.match(t.text('manualFeedback'), /PRÉSENCE ENREGISTRÉE À 14:21:41/);

  reply = { ok: false, status: 409, headers: { get: (h) => (h === 'X-Attendance-Refusal' ? JSON.stringify(refusal) : null) }, json: async () => ({ detail: refusal.message }) };
  t.T().setManualResults([E1]); t.T().selectManualResult(0); await tick();
  await t.T().confirmManualPointage('present'); await tick();
  assert.ok(t.card().classList.contains('is-refused'));
  assert.match(t.text('scanResultCard'), /^POINTAGE REFUSÉ × BA BOUHELEL ABDELILLAH K39 · CARISTE VACATION PRÉCÉDENTE NON CLÔTURÉE \d\d:\d\d:\d\d La sortie de la première vacation doit être enregistrée.*Vacation précédente 06:00 → 14:00 AUCUN MOUVEMENT ENREGISTRÉ$/);
  assert.match(t.text('manualFeedback'), /VACATION PRÉCÉDENTE NON CLÔTURÉE.*Aucun mouvement enregistré\./, 'message détaillé du formulaire conservé');
});

test('facial : la carte ne touche ni au mode ni à la vue faciale ; déconnexion ou changement de site la referme', async () => {
  const t = await ready(boot());
  t.T().setFacialMode(true);
  const view = t.d.getElementById('faceView'), preview = t.d.getElementById('facePreview');
  t.T().showLastScan(EVENT(81, 'ENTREE', { source: 'FACIAL', terminal: 'CAM-ENTREE-01' }));
  assert.match(t.text('scanResultCard'), /^ENTRÉE ENREGISTRÉE IDENTIFIÉ.*CAM-ENTREE-01/);
  assert.equal(t.T().getFacialMode(), true); assert.equal(view.classList.contains('hidden'), false);
  assert.equal(t.d.getElementById('faceView'), view); assert.equal(t.d.getElementById('facePreview'), preview);
  assert.match(t.text('lastScanCard'), /EN ATTENTE D’UN VISAGE/);
  t.card().querySelector('.sr-close').click();
  assert.equal(t.T().getFacialMode(), true, 'le mode facial reste actif après la fermeture');
  t.T().showLastScan(EVENT(82, 'SORTIE', { source: 'FACIAL' }));
  t.T().stopLivePolling();
  assert.equal(isOpen(t), false, 'aucune carte orpheline quand la relève s\'arrête');
});
