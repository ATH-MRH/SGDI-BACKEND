// pointage.irongs.com — vue « Feuilles de rotation » (historique DRH / OPS + paramètres de rotation
// d'un site). Tests jsdom sur le VRAI app/static/pointage/index.html ; seul le réseau est simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const SHEETS = { total: 2, page: 1, page_size: 25, items: [
  { id: 7, date: '2026-10-06', label: '14:00 – 22:00', site: 'Site A', site_id: 3, status: 'OPEN', present_count: 2, out_count: 1, lines_count: 3, anomalies_count: 0, observed_group: 'B' },
  { id: 6, date: '2026-10-06', label: '06:00 – 14:00', site: 'Site A', site_id: 3, status: 'ARCHIVED', present_count: 1, out_count: 4, lines_count: 5, anomalies_count: 1, observed_group: null },
] };
const DETAIL = { id: 6, date: '2026-10-06', label: '06:00 – 14:00', site: 'Site A', status: 'ARCHIVED', observed_group: 'A', closed_at: '2026-10-06T14:00:00+01:00', closed_by: 'system', lines: [
  { id: 1, matricule: 'K162', name: 'ADDA IBRAHIM', fonction: 'MAGASINIER', declared_group: 'A', first_entry: '06:02:00', last_exit: '14:03:00', state: 'SORTI', events_count: 2, anomaly: null,
    events: [{ id: 1, type: 'ENTREE', heure: '06:02:00', source: 'FACIAL' }, { id: 2, type: 'SORTIE', heure: '14:03:00', source: 'QR' }] },
  { id: 2, matricule: 'K201', name: '<img src=x onerror=alert(1)>', fonction: 'CARISTE', declared_group: 'A', first_entry: '06:05:00', last_exit: '', state: 'PRESENT', events_count: 1, anomaly: 'DEPART_MANQUANT',
    events: [{ id: 3, type: 'ENTREE', heure: '06:05:00', source: 'MANUAL' }] },
] };

function boot({ settings, put } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/#/sheets', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        const call = { path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
        calls.push(call);
        let data = {}, status = 200;
        if (u.pathname === '/api/auth/me') data = { username: 'DRH01', full_name: 'Resp DRH' };
        else if (u.pathname === '/api/attendance/sites') data = [{ id: 3, name: 'Site A', society: 'SOC' }];
        else if (u.pathname === '/api/attendance/sheets') data = SHEETS;
        else if (u.pathname === '/api/attendance/sheets/6') data = DETAIL;
        else if (u.pathname === '/api/attendance/rotation-settings') data = settings || { site_id: 3, configured: false, first_shift_time: '06:00', shift_minutes: 480, groups_count: 4, early_margin_minutes: 60, active: false };
        else if (u.pathname === '/api/attendance/rotation-settings/3') { const r = put ? put(call.body) : { status: 200, data: { ...call.body, configured: true, version: 1 } }; status = r.status; data = r.data; }
        return { ok: status < 400, status, text: async () => JSON.stringify(data) };
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, calls };
}

test('ouverture directe #/sheets : historique des feuilles sur 7 jours, statuts et groupe observé', async () => {
  const { d, calls, dom } = boot();
  await tick(80);
  assert.equal(d.getElementById('view-sheets').classList.contains('hidden'), false);
  assert.equal(d.querySelector('.nav-btn[data-view="sheets"]').classList.contains('active'), true);
  const list = calls.find((c) => c.path === '/api/attendance/sheets');
  assert.equal(list.query.page, '1');
  assert.match(list.query.date_from, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(list.query.date_from < list.query.date_to, 'période par défaut : 7 derniers jours');
  assert.equal('site_id' in list.query, false, 'tous les sites autorisés par défaut');
  const rows = [...d.querySelectorAll('#sheet-rows tr')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /2026-10-06\s*14:00 – 22:00\s*Site A\s*En cours\s*2\s*1\s*3\s*Groupe B/);
  assert.match(rows[1].textContent, /06:00 – 14:00[\s\S]*Archivée[\s\S]*5\s*· 1 départ\(s\) manquant\(s\)/);
  assert.match(d.getElementById('sheet-total').textContent, /2 feuille\(s\) · page 1\/1/);
  dom.window.close();
});

test('filtres site / statut envoyés au serveur', async () => {
  const { d, calls, w, dom } = boot();
  await tick(80);
  d.getElementById('s-status').value = 'CLOSED';
  d.getElementById('s-status').dispatchEvent(new w.Event('change'));
  await tick();
  assert.equal(calls.filter((c) => c.path === '/api/attendance/sheets').at(-1).query.status, 'CLOSED');
  d.getElementById('f-site').value = '3';
  d.getElementById('f-site').dispatchEvent(new w.Event('change'));
  await tick(60);
  const last = calls.filter((c) => c.path === '/api/attendance/sheets').at(-1);
  assert.deepEqual([last.query.site_id, last.query.status], ['3', 'CLOSED']);
  dom.window.close();
});

test('détail d\'une feuille : une ligne par employé, pointages bruts conservés, texte échappé', async () => {
  const { d, calls, dom } = boot();
  await tick(80);
  d.querySelector('#sheet-rows [data-sheet="6"]').click();
  await tick(60);
  assert.ok(calls.some((c) => c.path === '/api/attendance/sheets/6'));
  const modal = d.querySelector('#modal-host .modal');
  assert.match(modal.querySelector('h3').textContent, /Feuille 06:00 – 14:00 · 2026-10-06/);
  assert.match(modal.querySelector('.sub').textContent, /Site A · Archivée · groupe observé A · clôturée par system/);
  const lines = [...modal.querySelectorAll('tbody tr')];
  assert.equal(lines.length, 2);
  assert.match(lines[0].textContent, /ADDA IBRAHIM[\s\S]*K162 · MAGASINIER[\s\S]*A[\s\S]*06:02:00[\s\S]*14:03:00[\s\S]*Sorti/);
  assert.match(lines[0].textContent, /Entrée 06:02:00 \(Facial\) · Sortie 14:03:00 \(QR\)/);
  assert.match(lines[1].textContent, /Présent[\s\S]*Départ manquant[\s\S]*Entrée 06:05:00 \(Manuel\)/);
  assert.equal(modal.querySelector('img'), null, 'aucune injection HTML');
  assert.equal(modal.querySelectorAll('input,select,textarea').length, 0, 'lecture seule : aucun pointage modifiable ici');
  modal.querySelector('#sheet-close').click();
  assert.equal(d.querySelector('#modal-host .modal'), null);
  dom.window.close();
});

test('paramètres de rotation : site obligatoire, valeurs proposées, enregistrement et erreur serveur', async () => {
  const errors = { n: 0 };
  const { d, calls, w, dom } = boot({ put: (body) => (errors.n++ === 0
    ? { status: 422, data: { detail: 'La durée d\'une rotation doit diviser 24 h (ex. 8 h, 12 h, 24 h)' } }
    : { status: 200, data: { ...body, configured: true, version: 1 } }) });
  await tick(80);
  d.getElementById('s-settings').click();
  await tick();
  assert.equal(d.querySelector('#modal-host .modal'), null, 'sans site choisi : aucun formulaire');
  assert.equal(calls.some((c) => c.path === '/api/attendance/rotation-settings'), false);
  d.getElementById('f-site').value = '3';
  d.getElementById('s-settings').click();
  await tick(60);
  const modal = d.querySelector('#modal-host .modal');
  assert.match(modal.querySelector('.sub').textContent, /Site A[\s\S]*non configuré — valeurs proposées/);
  assert.deepEqual([modal.querySelector('#rot-first').value, modal.querySelector('#rot-shift').value, modal.querySelector('#rot-groups').value, modal.querySelector('#rot-margin').value],
    ['06:00', '480', '4', '60']);
  assert.deepEqual([...modal.querySelectorAll('#rot-shift option')].map((o) => o.textContent), ['6 h', '8 h', '12 h', '24 h']);
  modal.querySelector('#rot-first').value = '07:00';
  modal.querySelector('#rot-shift').value = '720';
  modal.querySelector('#rot-groups').value = '2';
  modal.querySelector('#rot-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(60);
  assert.match(modal.querySelector('#rot-error').textContent, /doit diviser 24 h/);
  assert.ok(d.querySelector('#modal-host .modal'), 'le formulaire reste ouvert sur erreur');
  modal.querySelector('#rot-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(80);
  const puts = calls.filter((c) => c.path === '/api/attendance/rotation-settings/3');
  assert.equal(puts.length, 2);
  assert.deepEqual([puts[1].method, puts[1].body], ['PUT', { first_shift_time: '07:00', shift_minutes: 720, groups_count: 2, early_margin_minutes: 60, active: true }]);
  assert.equal(d.querySelector('#modal-host .modal'), null);
  dom.window.close();
});
