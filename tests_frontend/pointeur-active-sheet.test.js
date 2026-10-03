// pointeur.irongs.com — « Pointage en direct » = FEUILLE ACTIVE de la rotation en cours (lot 1 du
// Planning intelligent V3) : une ligne par employé, fournie par le serveur. Site non configuré :
// affichage historique conservé. La fiche « dernier pointage » reste un composant distinct.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', user: { username: 'PTG34', full_name: 'POINTEUR 34' } };
const SUMMARY = { entries_today: 3, exits_today: 1, present_now: 2, absent_today: 0 };
const LINE = (matricule, name, extra = {}) => ({ id: 1, employee_id: 1, matricule, name, fonction: 'MAGASINIER', site: 'HAMOUL 01 (40K)', photo: '',
  first_entry: '14:32:26', last_exit: '', state: 'PRESENT', events_count: 1, declared_group: 'B', anomaly: null, ...extra });
const SHEET = (lines, extra = {}) => ({ configured: true, site_id: 12, next: null,
  sheet: { id: 7, label: '14:00 – 22:00', status: 'OPEN', lines_count: lines.length, present_count: lines.filter((l) => l.state === 'PRESENT').length,
    out_count: lines.filter((l) => l.state === 'SORTI').length, observed_group: 'B', expected_group: null, lines }, ...extra });
const FEED = [
  { employee_id: 1, matricule: 'K162', nom: 'ADDA IBRAHIM', poste: 'MAGASINIER', site: 'HAMOUL 01 (40K)', cycle: 1, action: 'arrivee', scanned_at: '2026-10-03T04:12:14' },
  { employee_id: 1, matricule: 'K162', nom: 'ADDA IBRAHIM', poste: 'MAGASINIER', site: 'HAMOUL 01 (40K)', cycle: 1, action: 'depart', scanned_at: '2026-10-03T04:17:29' },
  { employee_id: 1, matricule: 'K162', nom: 'ADDA IBRAHIM', poste: 'MAGASINIER', site: 'HAMOUL 01 (40K)', cycle: 2, action: 'arrivee', scanned_at: '2026-10-03T14:32:26' },
  { employee_id: 1, matricule: 'K162', nom: 'ADDA IBRAHIM', poste: 'MAGASINIER', site: 'HAMOUL 01 (40K)', cycle: 2, action: 'depart', scanned_at: '2026-10-03T14:37:28' },
];

function boot(sheetReply) {
  const calls = [];
  let sheet = sheetReply;
  const fetch = async (raw) => {
    const u = new URL(raw, 'https://pointeur.irongs.com/');
    calls.push(u.pathname + u.search);
    if (u.pathname === '/api/portal/attendance-sheet') { const r = typeof sheet === 'function' ? sheet() : sheet; return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r }; }
    if (u.pathname === '/api/portal/attendance-live') return { ok: true, status: 200, json: async () => ({ latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY }) };
    if (u.pathname === '/api/portal/attendance-feed') return { ok: true, status: 200, json: async () => FEED };
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'DHL FORWARDING / HAMOUL 01 (40K)' }] };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  const w = ctx.window;
  w.localStorage.setItem('atlas_pointer_site', '12');
  return { ...ctx, w, d: w.document, calls, setSheet: (v) => { sheet = v; }, list: () => w.document.getElementById('liveFeedList') };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.T().stopIdleWatch(); t.w.close(); } catch (e) { /* fermée */ } } });
async function ready(t) { opened.push(t); await tick(100); t.T().stopLivePolling(); }

test('site configuré : le direct affiche la feuille active — une seule ligne par employé, même après plusieurs passages', async () => {
  const t = boot(SHEET([LINE('K162', 'ADDA IBRAHIM MOHAMED AISSOUNI', { last_exit: '14:37:28', state: 'SORTI', events_count: 4 }), LINE('K201', 'BENALI KARIM')]));
  await ready(t);
  assert.ok(t.calls.some((c) => c.startsWith('/api/portal/attendance-sheet')), 'feuille demandée au serveur');
  const rows = [...t.list().querySelectorAll('.live-feed-row')];
  assert.equal(rows.length, 2, 'une ligne par employé (et non une carte par couple entrée/sortie)');
  const banner = t.d.getElementById('activeSheetBanner');
  assert.match(banner.textContent, /FEUILLE EN COURS[\s\S]*14:00 – 22:00/);
  assert.match(banner.textContent, /1 présent\(s\)[\s\S]*2 pointé\(s\)[\s\S]*Groupe B/);
  const k162 = rows.find((r) => /K162/.test(r.textContent));
  assert.match(k162.textContent, /ENTRÉE\s*14:32:26[\s\S]*SORTIE\s*14:37:28/);
  assert.match(k162.textContent, /Groupe B · 4 passages/, 'les passages multiples sont synthétisés, pas dupliqués');
  assert.ok(k162.classList.contains('live-out'));
  assert.ok(rows.find((r) => /K201/.test(r.textContent)).classList.contains('live-in'));
  assert.doesNotMatch(t.list().textContent, /04:12:14/, 'les rotations précédentes de la journée ne sont pas affichées');
});

test('filtres KPI appliqués à la feuille ; arrivées anticipées de la rotation suivante affichées à part', async () => {
  const next = { id: 8, label: '22:00 – 06:00', status: 'OPEN', lines_count: 1, lines: [LINE('A077', 'CHERIF NADIA', { first_entry: '21:20:00', declared_group: 'C' })] };
  const t = boot(SHEET([LINE('K162', 'ADDA IBRAHIM', { last_exit: '14:37:28', state: 'SORTI', events_count: 2 }), LINE('K201', 'BENALI KARIM')], { next }));
  await ready(t);
  assert.match(t.list().querySelector('.sheet-next').textContent, /ROTATION SUIVANTE · 22:00 – 06:00[\s\S]*CHERIF NADIA/);
  t.T().setLiveFilter('presents');
  assert.deepEqual([...t.list().querySelectorAll('.live-feed-row .live-feed-name')].map((n) => n.textContent.trim()), ['BENALI KARIM']);
  assert.equal(t.list().querySelector('.sheet-next'), null, 'un filtre ne mélange pas les deux rotations');
  t.T().setLiveFilter('sorties');
  assert.deepEqual([...t.list().querySelectorAll('.live-feed-row .live-feed-name')].map((n) => n.textContent.trim()), ['ADDA IBRAHIM']);
  t.T().setLiveFilter('absents');
  assert.match(t.list().textContent, /Aucun employé pour ce filtre\./);
  t.T().setLiveFilter('absents');
  assert.equal(t.list().querySelectorAll('.live-feed-row').length, 3);
});

test('feuille active vide : message explicite, bandeau conservé', async () => {
  const t = boot(SHEET([]));
  await ready(t);
  assert.match(t.d.getElementById('activeSheetBanner').textContent, /0 présent\(s\)[\s\S]*0 pointé\(s\)/);
  assert.match(t.list().textContent, /Aucun pointage sur cette rotation\./);
});

test('site non configuré : affichage historique inchangé (aucune feuille inventée)', async () => {
  const t = boot({ configured: false, site_id: 12, sheet: null, next: null });
  await ready(t);
  assert.equal(t.T().getActiveSheet(), null);
  assert.equal(t.d.getElementById('activeSheetBanner'), null);
  assert.equal(t.list().querySelectorAll('.live-feed-row').length, 2, 'comportement existant : une ligne par cycle de la journée');
});

test('erreur serveur sur la feuille : la dernière feuille connue reste affichée ; 401 déconnecte', async () => {
  const t = boot(SHEET([LINE('K201', 'BENALI KARIM')]));
  await ready(t);
  t.setSheet({ status: 500 });
  await t.T().loadActiveSheet();
  assert.equal(t.list().querySelectorAll('.live-feed-row').length, 1);
  assert.ok(t.T().getSession());
  t.setSheet({ status: 401 });
  await t.T().loadActiveSheet(); await tick(30);
  assert.equal(t.T().getSession(), null);
  assert.equal(t.T().getActiveSheet(), null);
});
