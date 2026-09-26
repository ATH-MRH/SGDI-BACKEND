// Centre de contrôle pointage.irongs.com — tests jsdom sur le VRAI app/static/pointage/index.html.
// Seul le réseau est simulé (fetch) ; la logique de la page est exécutée telle quelle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function row(over = {}) {
  return {
    employee_id: 1, matricule: 'M001', nom: 'Ouali Amine', fonction: 'AGENT', society: 'SOC', site_id: 3, site: 'Site A',
    planning: { known: true, working: true, period: 'jour', start_time: '08:00', end_time: '16:00' },
    arrival: '08:02', departure: '', status: 'present', source: 'QR', incomplete: false, closed: false, presence_id: 11,
    anomalies: [], ...over,
  };
}

function boot({ standalone = false, board, anomalies = [] } = {}) {
  const calls = [], navigations = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) navigations.push(e.message); });
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: standalone && q.includes('standalone'), addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
        let data = {};
        if (u.pathname === '/api/auth/me') data = { username: 'OPS01', full_name: 'Chef OPS' };
        else if (u.pathname === '/api/attendance/sites') data = [{ id: 3, name: 'Site A', society: 'SOC' }];
        else if (u.pathname === '/api/attendance/board') data = board || { date: '2027-04-05', kpi: { expected: 3, present: 1, absent: 1, not_pointed: 1, late: 0, conge: 0, maladie: 0, repos: 0, anomalies: 1, incomplete: 0 }, total: 60, page: Number(u.searchParams.get('page')), page_size: 25, pages: 3, items: [row()] };
        else if (u.pathname === '/api/attendance/anomalies') data = { total: anomalies.length, page: 1, page_size: 25, pages: 1, items: anomalies };
        else if (u.pathname.startsWith('/api/attendance/presences/')) data = { id: 11, status: 'absent' };
        else if (u.pathname === '/api/attendance/close') data = { closed: 2, open_anomalies: anomalies.length };
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      };
    },
  });
  return { dom, w: dom.window, d: dom.window.document, calls, navigations };
}

test('terminal installé (PWA standalone) sur pointage.irongs.com → renvoyé vers /pointeur', async () => {
  const pwa = boot({ standalone: true });
  await tick();
  assert.equal(pwa.navigations.length, 1, 'une navigation (location.replace("/pointeur")) doit être tentée');
  pwa.dom.window.close();
  const browser = boot({ standalone: false });
  await tick(60);
  assert.equal(browser.navigations.length, 0, 'un navigateur normal reste sur le centre de contrôle');
  browser.dom.window.close();
});

test('connexion existante → situation du jour avec KPI du serveur et site autorisé', async () => {
  const { d, calls, dom } = boot();
  await tick(60);
  assert.equal(d.getElementById('login').classList.contains('hidden'), true);
  assert.match(d.getElementById('brand-user').textContent, /Chef OPS · 1 site/);
  const kpis = [...d.querySelectorAll('.kpi')].map((k) => k.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(kpis.includes('Effectif prévu3') && kpis.includes('Absents1'), kpis.join('|'));
  const boardCall = calls.find((c) => c.path === '/api/attendance/board');
  assert.equal(boardCall.query.page, '1');
  assert.equal(d.getElementById('board-count').textContent, '60 employé(s) · page 1/3');
  dom.window.close();
});

test('filtres et pagination envoyés au serveur (jamais filtrés dans la page)', async () => {
  const { d, w, calls, dom } = boot();
  await tick(60);
  d.getElementById('f-status').value = 'absent';
  d.getElementById('f-status').dispatchEvent(new w.Event('change'));
  await tick(40);
  assert.equal(calls.filter((c) => c.path === '/api/attendance/board').at(-1).query.status, 'absent');
  d.getElementById('next-btn').click();
  await tick(40);
  assert.equal(calls.filter((c) => c.path === '/api/attendance/board').at(-1).query.page, '2');
  d.getElementById('f-q').value = 'ouali';
  d.getElementById('f-q').dispatchEvent(new w.Event('input'));
  await tick(400);
  assert.equal(calls.filter((c) => c.path === '/api/attendance/board').at(-1).query.q, 'ouali');
  dom.window.close();
});

test('correction : motif obligatoire, seules les valeurs modifiées sont envoyées en PATCH', async () => {
  const { d, w, calls, dom } = boot();
  await tick(60);
  d.querySelector('[data-correct="11"]').click();
  d.getElementById('c-status').value = 'absent';
  d.getElementById('corr-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.match(d.getElementById('c-error').textContent, /motif est obligatoire/);
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
  d.getElementById('c-reason').value = 'Oubli de badge confirmé';
  d.getElementById('corr-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick(60);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/api/attendance/presences/11');
  assert.deepEqual(patch.body, { reason: 'Oubli de badge confirmé', status: 'absent' });
  dom.window.close();
});

test('clôture : les anomalies ouvertes sont affichées avant confirmation et restent ouvertes', async () => {
  const anomalies = [{ id: 5, type: 'LATE', severity: 'warning', nom: 'Ouali Amine', message: 'Arrivée à 08:40', status: 'OPEN', date: '2027-04-05' }];
  const { d, calls, dom } = boot({ anomalies });
  await tick(60);
  d.getElementById('close-btn').click();
  await tick(60);
  assert.match(d.querySelector('.modal').textContent, /1 anomalie\(s\) ouverte\(s\)/);
  assert.match(d.querySelector('.modal').textContent, /Arrivée à 08:40/);
  d.getElementById('cl-ok').click();
  await tick(60);
  const close = calls.find((c) => c.path === '/api/attendance/close');
  assert.equal(close.method, 'POST');
  assert.equal(calls.some((c) => c.path.startsWith('/api/attendance/anomalies/') && c.method === 'PATCH'), false);
  dom.window.close();
});

test('données serveur échappées (aucune injection HTML)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const board = { date: '2027-04-05', kpi: { expected: 1 }, total: 1, page: 1, page_size: 25, pages: 1,
    items: [row({ nom: evil, site: evil, fonction: evil, anomalies: [{ id: 1, type: evil, severity: 'info', message: evil }] })] };
  const { d, dom } = boot({ board });
  await tick(60);
  assert.equal(d.querySelectorAll('#board-rows img').length, 0);
  assert.match(d.getElementById('board-rows').textContent, /<img src=x onerror=alert\(1\)>/);
  dom.window.close();
});
