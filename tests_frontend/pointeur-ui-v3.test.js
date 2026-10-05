// pointeur.irongs.com — POSTE DE POINTAGE V3 (interface) : header blanc, barre KPI marine, scanner
// central, modes de pointage, Pointage en direct, État du système. L'habillage ne change AUCUNE
// logique : chaque contrôle déclenche le mécanisme existant ; aucun chiffre ni état inventé.
// VRAIE page dans jsdom (tests_frontend/load-pointeur.js) ; seul le réseau est simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPointeur, SESSION_KEY } = require('./load-pointeur');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointeur.html'), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', user: { username: 'PTG34', full_name: 'POINTEUR 34' } };
const SUMMARY = { entries_today: 2, exits_today: 2, present_now: 0, absent_today: 0 };
const EMP = { id: 2258, matricule: 'K162', nom: 'ADDA', prenom: 'IBRAHIM', fonction: 'MAGASINIER', societe: 'DHL FORWARDING', site: 'HAMOUL 01 (40K)', photo: '', has_photo: false };
const EVENT = (id, type) => ({ id, type, heure: '14:32:26', date: '2026-10-03', source: 'FACIAL', source_label: 'Reconnaissance faciale', terminal: 'TABLETTTE HAMOUL 01',
  site: 'HAMOUL 01 (40K)', site_id: 12, state: type === 'ENTREE' ? 'PRESENT' : 'SORTI', employee: EMP });

function boot() {
  let live = () => ({ status: 200, body: { latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY } });
  const fetch = async (raw) => {
    const u = new URL(raw, 'https://pointeur.irongs.com/');
    if (u.pathname === '/api/portal/attendance-live') {
      const r = live();
      if (r.network) throw new TypeError('Failed to fetch');
      return { ok: r.status < 400, status: r.status, json: async () => r.body || {} };
    }
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'DHL FORWARDING / HAMOUL 01 (40K)' }] };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  const w = ctx.window, d = w.document;
  const real = w.setTimeout.bind(w), idle = [];
  w.setTimeout = (fn, ms, ...rest) => (ms === 6000 ? (idle.push(fn), idle.length) : real(fn, ms, ...rest));
  return { ...ctx, w, d, idle, setLive: (fn) => { live = fn; }, sys: (id) => { const el = d.getElementById(id); return [el.querySelector('dd').textContent, el.dataset.tone]; } };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.T().stopIdleWatch(); t.w.close(); } catch (e) { /* fermée */ } } });
async function ready(t) { opened.push(t); await tick(80); t.T().stopLivePolling(); }

test('structure V3 : header conservé, barre KPI aux 4 valeurs réelles, aucune donnée décorative, pas de menu fictif', async () => {
  const t = boot(); await ready(t);
  const d = t.d;
  assert.equal(d.body.classList.contains('ptr-v3'), true);
  // Header : mêmes contrôles et mêmes actions qu'avant.
  assert.deepEqual([...d.querySelectorAll('.module-nav button')].map((b) => [b.id, b.getAttribute('onclick')]),
    [['scanNav', "showPointerSection('scan')"], ['planningNav', "showPointerSection('planning')"], ['faceNav', "showPointerSection('facial')"]]);
  assert.equal(d.getElementById('siteSelector').getAttribute('onchange'), 'changeAttendanceSite(this.value)');
  assert.equal(d.querySelector('.top .logout').getAttribute('onclick'), 'logout()');
  assert.ok(d.getElementById('headerClock') && d.getElementById('connPill') && d.querySelector('.header-scanner-status'));
  assert.match(d.getElementById('userLabel').textContent, /POINTEUR 34/);
  // KPI : 4 compteurs, valeurs du serveur, ni pourcentage ni mini-graphique.
  const kpi = d.querySelector('.presence-summary');
  assert.deepEqual([...kpi.querySelectorAll('button')].map((b) => [b.dataset.liveFilter, b.querySelector('small').textContent, b.querySelector('b').textContent]),
    [['entrees', 'Entrées aujourd’hui', '02'], ['sorties', 'Sorties aujourd’hui', '02'], ['presents', 'Présents sur site', '00'], ['absents', 'Absents aujourd’hui', '00']]);
  assert.doesNotMatch(kpi.textContent, /%|\+\s*\d/, 'aucune évolution inventée');
  assert.equal(kpi.querySelectorAll('canvas,.spark,.chart,[class*="chart"]').length, 0);
  // Aucune sidebar ni menu repris de la maquette.
  assert.equal(d.querySelector('aside.sidebar,nav.sidebar,.atlas-sidebar,#sidebar-nav'), null);
  assert.doesNotMatch(d.getElementById('appView').textContent, /Historique|Terminaux|Rapports|Paramètres/);
});

test('modes de pointage : trois cartes, chacune branchée sur le mécanisme EXISTANT', async () => {
  const t = boot(); await ready(t);
  const d = t.d, cards = [...d.querySelectorAll('.mode-grid .mode-card')];
  assert.deepEqual(cards.map((c) => [c.id, c.querySelector('b').textContent, c.querySelector('small').textContent, c.getAttribute('onclick')]), [
    ['qrModeBtn', 'QR Code', 'Présentez votre badge', 'selectQrMode()'],
    ['faceModeBtn', 'Reconnaissance faciale', 'Détection automatique', "showPointerSection('facial')"],
    ['manualModeBtn', 'Saisie manuelle', 'Code employé', 'toggleManualPanel()'],
  ]);
  assert.equal(d.getElementById('faceModeBtn').getAttribute('onclick'), d.getElementById('faceNav').getAttribute('onclick'), 'même entrée que le bouton Facial du header');
  // Saisie manuelle : le panneau existant s'ouvre, la carte reflète l'état, QR Code y revient.
  t.T().toggleManualPanel();
  assert.equal(d.getElementById('manualPanel').classList.contains('hidden'), false);
  assert.deepEqual(['qrModeBtn', 'manualModeBtn'].map((id) => d.getElementById(id).getAttribute('aria-pressed')), ['false', 'true']);
  t.T().selectQrMode();
  assert.equal(d.getElementById('manualPanel').classList.contains('hidden'), true);
  assert.deepEqual(['qrModeBtn', 'manualModeBtn'].map((id) => d.getElementById(id).classList.contains('active')), [true, false]);
  // Douchette : mode clavier existant, texte d'état réel ; aucune action « Tester la douchette ».
  assert.equal(t.T().getUi().cameraMode, false);
  assert.equal(d.getElementById('scannerHint').textContent, 'Douchette USB active · aucune action à effectuer.');
  assert.doesNotMatch(d.getElementById('scannerCard').textContent, /Tester la douchette/i);
  assert.equal(d.getElementById('cameraModeBtn').getAttribute('onclick'), 'enableCameraMode()');
  // Bouton historique sans gestionnaire (« Générer un QR site ») : jamais mis en avant.
  assert.equal(d.getElementById('generateQrBtn').classList.contains('ptr-legacy'), true);
  assert.match(HTML, /body\.ptr-v3 \.ptr-legacy\{display:none!important\}/);
});

test('zone centrale : attente dessinée, toujours en place ; le dernier pointage s\'affiche dans la carte flottante puis disparaît', async () => {
  const t = boot(); await ready(t);
  const zone = t.d.getElementById('lastScanCard'), card = t.d.getElementById('scanResultCard'), waiting = zone.firstElementChild;
  assert.ok(zone.classList.contains('is-idle')); assert.equal(card.classList.contains('is-open'), false);
  assert.ok(zone.querySelector('.scan-visual .scan-device .scan-line'), 'scanner dessiné en CSS');
  assert.match(zone.textContent, /EN ATTENTE DU PROCHAIN POINTAGE/);
  assert.match(zone.textContent, /douchette.*reconnaissance faciale.*saisie manuelle/i);
  await t.T().pollLive();
  t.setLive(() => ({ status: 200, body: { latest_event_id: 42, events: [EVENT(42, 'ENTREE')], latest_refusal_id: 7, refusals: [], summary: { ...SUMMARY, entries_today: 3, present_now: 1 } } }));
  await t.T().pollLive(); await tick(20);
  assert.ok(card.classList.contains('is-open') && card.classList.contains('is-entry'));
  assert.equal(zone.firstElementChild, waiting, 'la zone d\'attente n\'est pas redessinée par un pointage');
  for (const text of [/ADDA/, /K162/, /MAGASINIER/, /HAMOUL 01/, /ENTRÉE ENREGISTRÉE/, /14:32:26/, /ÉTAT ACTUEL : PRÉSENT/, /IDENTIFIÉ/]) assert.match(card.textContent, text);
  assert.equal(card.querySelector('img[src=""],img:not([src])'), null, 'jamais d\'image cassée');
  assert.equal(t.d.getElementById('entrantCount').textContent, '03');
  assert.equal(t.T().LAST_SCAN_DISPLAY_MS, 6000, 'durée d\'affichage de la carte flottante (V5.1)');
  t.idle.at(-1)();                                               // fin des 6 s
  assert.equal(card.classList.contains('is-open'), false);
  assert.ok(zone.querySelector('.scan-visual'), 'le scanner d\'attente est resté en place');
  // Refus : fiche rouge, aucun mouvement.
  t.setLive(() => ({ status: 200, body: { latest_event_id: 42, events: [], latest_refusal_id: 8, summary: SUMMARY,
    refusals: [{ id: 8, heure: '14:40:00', label: 'EMPLOYÉ SUSPENDU', terminal: 'TABLETTTE HAMOUL 01', employee: EMP }] } }));
  await t.T().pollLive(); await tick(20);
  assert.ok(card.classList.contains('is-refused')); assert.equal(card.getAttribute('role'), 'alert');
  assert.match(card.textContent, /POINTAGE REFUSÉ[\s\S]*EMPLOYÉ SUSPENDU[\s\S]*AUCUN MOUVEMENT ENREGISTRÉ/);
});

test('État du système : uniquement des états réels (lecteur, réseau, relève) ; jamais « base de données » ni « sécurité »', async () => {
  const t = boot(); await ready(t);
  const d = t.d;
  // « Caméra » et « Reconnaissance faciale » n'apparaissent qu'en mode facial (états réels du moteur).
  assert.deepEqual([...d.querySelectorAll('#systemCard .system-item:not(.hidden) dt')].map((e) => e.textContent), ['Lecteur QR', 'Réseau', 'Temps réel']);
  assert.deepEqual([...d.querySelectorAll('#systemCard .system-item.hidden dt')].map((e) => e.textContent), ['Caméra', 'Reconnaissance faciale']);
  assert.doesNotMatch(d.getElementById('systemCard').textContent, /base de données|sécurité|stable|connectée/i);
  await t.T().pollLive();
  assert.deepEqual(t.sys('sysReader'), ['Douchette USB à l\'écoute', 'ok']);
  assert.deepEqual(t.sys('sysNetwork'), ['En ligne', 'ok']);
  assert.match(t.sys('sysLive')[0], /^Actif · relève \d{2}:\d{2}:\d{2}$/);
  assert.equal(d.getElementById('stationStateLabel').textContent, 'SYSTÈME OPÉRATIONNEL');
  assert.equal(d.getElementById('liveBadge').classList.contains('hidden'), false, '« Actualisation temps réel » seulement si la relève répond');
  // Relève en échec (serveur) : l'état le dit, sans déconnexion.
  t.setLive(() => ({ status: 500 }));
  await t.T().pollLive();
  assert.deepEqual(t.sys('sysLive'), ['Interrompu · nouvel essai automatique', 'bad']);
  assert.equal(d.getElementById('stationStateLabel').textContent, 'RELÈVE INTERROMPUE');
  assert.equal(d.getElementById('liveBadge').classList.contains('hidden'), true);
  assert.ok(t.T().getSession(), 'toujours connecté');
  // Hors ligne (navigateur) puis retour réseau.
  Object.defineProperty(t.w.navigator, 'onLine', { configurable: true, get: () => false });
  t.w.dispatchEvent(new t.w.Event('offline'));
  assert.deepEqual(t.sys('sysNetwork'), ['Hors ligne', 'bad']);
  assert.equal(d.getElementById('stationStateLabel').textContent, 'HORS LIGNE');
  assert.equal(d.getElementById('connLabel').textContent, 'Hors ligne');
  assert.ok(t.T().getSession(), 'une coupure réseau ne déconnecte pas');
  Object.defineProperty(t.w.navigator, 'onLine', { configurable: true, get: () => true });
  t.w.dispatchEvent(new t.w.Event('online'));
  t.setLive(() => ({ status: 200, body: { latest_event_id: 42, events: [], latest_refusal_id: 8, refusals: [], summary: SUMMARY } }));
  await t.T().pollLive();
  assert.equal(d.getElementById('stationStateLabel').textContent, 'SYSTÈME OPÉRATIONNEL');
});

test('session permanente et sécurité de session préservées par la nouvelle interface', async () => {
  const t = boot(); await ready(t);
  assert.equal(t.T().IDLE_LOGOUT_ENABLED, false, 'aucune déconnexion pour inactivité sur pointeur.irongs.com');
  assert.equal(t.T().getIdleTimer(), null);
  assert.equal(t.T().LIVE_POLL_MS, 2000, 'fréquence de relève inchangée');
  for (const status of [401, 403]) {
    const s = boot(); await ready(s);
    s.setLive(() => ({ status }));
    await s.T().pollLive(); await tick(30);
    assert.equal(s.T().getSession(), null, String(status));
    assert.equal(s.w.localStorage.getItem(SESSION_KEY), null);
    assert.equal(s.d.getElementById('loginView').classList.contains('hidden'), false);
  }
});

test('habillage : tokens locaux déclarés une fois, animations coupées par prefers-reduced-motion, aucun framework ni canvas', () => {
  const at = HTML.indexOf('POSTE DE POINTAGE V3');
  const css = HTML.slice(HTML.lastIndexOf('/*', at), HTML.indexOf('</style>', at));
  assert.ok(css.length > 2000);
  assert.match(css, /--ptr-navy-1:var\(--atlas-sidebar-bg-start,/, 'tokens ATLAS réutilisés');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\s*body\.ptr-v3 :is\(\.scan-line,\.scan-ring-2,\.live-dot,\.last-scan-body\)\{animation:none!important\}/);
  assert.doesNotMatch(HTML, /<canvas|webgl|three\.js|gsap|lottie/i);
  assert.match(css, /body\.ptr-v3 #appView>\.top\{[^}]*background:var\(--ptr-surface\)!important/, 'header blanc');
  assert.match(css, /body\.ptr-v3 \.presence-summary\{[^}]*linear-gradient\(100deg,var\(--ptr-kpi-1\)/, 'barre KPI marine');
  // Toutes les règles du bloc restent limitées au poste V3.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').match(/(?:^|\})\s*([^{}@]+)\{/g) || [];
  for (const raw of selectors) for (const sel of raw.replace(/^\}/, '').replace(/\{$/, '').replace(/\([^()]*\)/g, '()').split(',')) assert.match(sel.trim(), /^body\.ptr-v3/, sel.trim());
});
