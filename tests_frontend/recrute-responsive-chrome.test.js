// Recrutement V6 — contrôle responsive en Chrome réel.
// Lancer : npm run test:recruitment-responsive-chrome
// L'application réelle (app/static/recrute.html et ses feuilles de style) est servie telle quelle ;
// seules les réponses réseau sont des fixtures de test, isolées dans ce fichier (rien n'est écrit
// dans le produit, la base ou le stockage de production).
// RECRUTE_SCREENSHOT_DIR=<dossier> enregistre les captures de recette.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite ci-dessous */ }
const SKIP = !puppeteer || !CHROME ? 'Chrome ou puppeteer-core indisponible' : false;
const SHOTS = process.env.RECRUTE_SCREENSHOT_DIR;

const WIDTHS = [1600, 1440, 1280, 1024, 768, 430, 390];
const SCREENS = ['dashboard', 'candidates', 'interviews', 'announcements', 'reserve', 'recruited', 'archive'];
const SECURITE = 'IRON GLOBAL SÉCURITÉ', SOLUTION = 'IRON GLOBAL SOLUTION';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixtures(kind) {
  if (kind === 'empty') return { candidates: [], announcements: [] };
  const positions = ['Agent de prévention et de sécurité', 'Chef de poste', 'Superviseur', 'Chauffeur', ''];
  const opinions = ['', 'Favorable', 'Défavorable', 'Instance'];
  const candidates = [];
  let id = 0;
  const add = (mode, society, count, extra = () => ({})) => {
    for (let i = 0; i < count; i++) {
      id++;
      const opinion = opinions[i % opinions.length];
      const data = { avisDecision: opinion, source: i % 3 ? 'ANEM' : '' };
      if (mode === 'new' && i % 3 === 0) data.derniereConvocation = { date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, heure: '09:30', lieu: 'Siège de la société' };
      if (mode === 'new' && i % 6 === 0) data.dernierEntretien = { date: '2026-10-02', moyenne: 7.5, bareme: 10, valide: i % 12 === 0, recruteur: 'Recruteur de test' };
      candidates.push({
        id, mode, society, status: mode === 'reserve' ? 'reserve' : mode === 'recruited' ? (i % 2 ? 'embauche' : 'a_contractualiser') : 'nouvelle',
        last_name: i % 7 === 0 ? 'Fixture-Nom-Particulièrement-Long' : `Fixture${id}`, first_name: i % 5 === 0 ? 'Prénom Composé De Test' : 'Test',
        phone: `0550 00 ${String(id).padStart(2, '0')} 00`, email: i % 4 ? `fixture${id}@exemple.test` : '', desired_position: positions[i % positions.length],
        created_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00`, data: { ...data, ...extra(i) },
      });
    }
  };
  add('new', SECURITE, 60); add('reserve', SECURITE, 30, () => ({ fichePositionValidee: true, fichePositionValideeAt: '2026-09-20T10:00:00' }));
  add('recruited', SECURITE, 30); add('archive', SECURITE, 30, () => ({ archivedAt: '2026-09-25' }));
  add('new', SOLUTION, 8); add('new', null, 6);
  const announcements = Array.from({ length: 9 }, (_, i) => ({
    id: `ANN-${i}`, title: i % 4 === 0 ? 'Agent de prévention et de sécurité — site industriel de nuit' : `Poste de test ${i}`,
    society: i % 3 === 2 ? SOLUTION : SECURITE, location: i % 2 ? 'Alger' : '', positions: 1 + i, publishedAt: '2026-10-01', deadline: i % 2 ? '2026-11-15' : '',
    status: ['Publiée', 'Brouillon', 'Clôturée'][i % 3], reference: i % 2 ? `REC-2026-00${i}` : '', description: 'Annonce de test.',
  }));
  return { candidates, announcements };
}

function startServer(state) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (url.pathname === '/api/auth/me') return json({ username: 'REC01', full_name: 'Recruteur De Test', role: 'recruteur', recruitment_access: true, authorized_actions: state.actions, authorized_societies: [SECURITE, SOLUTION] });
    if (url.pathname === '/api/irongs/positions') return json([]);
    if (url.pathname === '/api/drh/candidates/page') {
      if (state.fail) return json({ detail: 'Service indisponible (test)' }, 503);
      const q = url.searchParams, society = q.get('society'), mode = q.get('mode'), needle = (q.get('q') || '').toLowerCase();
      let rows = state.data.candidates.filter(item => (!mode || item.mode === mode)
        && (!society || (society === '__unassigned__' ? !item.society : item.society === society))
        && (!q.get('desired_position') || (item.desired_position || 'Poste non renseigné') === q.get('desired_position'))
        && (!q.get('recruiter_opinion') || (item.data.avisDecision || 'Non évalué') === q.get('recruiter_opinion'))
        && (!needle || `${item.last_name} ${item.first_name} ${item.phone} ${item.desired_position}`.toLowerCase().includes(needle)));
      const size = Number(q.get('page_size')) || 25, page = Number(q.get('page')) || 1;
      return json({ items: rows.slice((page - 1) * size, page * size), total: rows.length, pages: Math.max(1, Math.ceil(rows.length / size)), page });
    }
    if (url.pathname.startsWith('/api/')) return json({ detail: 'Non disponible dans la recette responsive' }, 404);
    const file = url.pathname === '/' ? path.join(STATIC, 'recrute.html') : path.join(STATIC, decodeURIComponent(url.pathname.replace(/^\/static\//, '')));
    if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Géométrie observée dans la page : débordement global, éléments hors écran (hors zones à
// défilement LOCAL autorisé), collisions entre actions et entre filtres.
function inspectLayout() {
  const width = document.documentElement.clientWidth;
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const scrollers = '.rec-tabs,.rec-chips,.recruit-nav,.dashboard-pipeline,.dashboard-table-wrap,.rec-table-sortable thead tr';
  const outside = [...document.querySelectorAll('#appView *')].filter(el => visible(el) && !el.closest(scrollers) && !el.closest('.hidden'))
    .filter(el => { const r = el.getBoundingClientRect(); return r.right > width + 1 || r.left < -1; })
    .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`).slice(0, 5);
  const overlaps = selector => {
    const boxes = [...document.querySelectorAll(selector)].filter(visible).map(el => el.getBoundingClientRect());
    return boxes.some((a, i) => boxes.slice(i + 1).some(b => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
  };
  const section = document.querySelector('.main>section:not(.hidden)');
  const wraps = [...section.querySelectorAll('.candidate-table-wrap')].filter(visible);
  const row = section.querySelector('.rec-table tbody tr');
  return {
    scrollWidth: document.documentElement.scrollWidth, clientWidth: width, bodyScrollWidth: document.body.scrollWidth, outside,
    actionCollision: overlaps('.main>section:not(.hidden) .rec-page-actions>*') || overlaps('.main>section:not(.hidden) .dashboard-actions>*'),
    filterCollision: overlaps('.main>section:not(.hidden) .rec-filters>*'),
    headerCollision: overlaps('.top-row>*'),
    tableScrolls: wraps.some(el => el.scrollWidth > el.clientWidth + 1),
    rowDisplay: row ? getComputedStyle(row).display : null,
    primary: [...section.querySelectorAll('.rec-page-actions .primary,.dashboard-actions .primary')].filter(visible).map(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= width; }),
    title: (section.querySelector('h2') || {}).textContent || '', emptyHeight: Math.round(section.querySelector('.rec-empty-state')?.getBoundingClientRect().height || 0),
    activeNav: [...document.querySelectorAll('.recruit-nav-btn.active')].map(el => el.dataset.section),
    pagination: section.id === 'candidatesSection' ? document.getElementById('pagination').innerText : '',
  };
}

async function openApp(browser, base, announcements, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width <= 430, hasTouch: width <= 430 });
  await page.evaluateOnNewDocument(items => {
    localStorage.setItem('atlas_recrute_session', JSON.stringify({ token: 'recette', user: {} }));
    localStorage.setItem('atlas_recruitment_announcements_v1', JSON.stringify(items));
    sessionStorage.removeItem('atlas_recrute_section');
  }, announcements);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#appView:not(.hidden)');
  return { page, errors };
}
async function show(page, screen) {
  await page.evaluate(section => document.querySelector(`.recruit-nav-btn[data-section="${section}"]`).click(), screen);
  await page.waitForFunction(() => !document.querySelector('.main>section:not(.hidden)[aria-busy="true"],.main>section:not(.hidden) [aria-busy="true"]') && !document.querySelector('.main>section:not(.hidden) .rec-skeleton-list'), { timeout: 10000 });
  await delay(60);
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
}

async function withApp(kind, actions, run) {
  const state = { data: fixtures(kind), actions, fail: false };
  const server = await startServer(state);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try { await run({ browser, base: `http://127.0.0.1:${server.address().port}`, state }); }
  finally { await browser.close(); server.close(); }
}

const TITLES = { dashboard: 'Recrutement', candidates: 'Gestion des candidatures', interviews: 'Entretiens', announcements: 'Annonces recrutement', reserve: 'Réserve de talents', recruited: 'Candidats recrutés', archive: 'Archives' };

for (const kind of ['many', 'empty']) {
  test(`responsive Chrome — ${kind === 'many' ? 'données nombreuses' : 'données vides'} : 7 écrans × 7 largeurs sans débordement ni collision`, { skip: SKIP, timeout: 240000 }, async () => {
    await withApp(kind, ['read', 'create', 'update', 'delete'], async ({ browser, base, state }) => {
      for (const width of WIDTHS) {
        const { page, errors } = await openApp(browser, base, state.data.announcements, width);
        for (const screen of SCREENS) {
          await show(page, screen);
          const layout = await page.evaluate(inspectLayout);
          const where = `${kind} ${screen} ${width}px`;
          assert.ok(layout.scrollWidth <= layout.clientWidth, `${where} : débordement global (${layout.scrollWidth} > ${layout.clientWidth})`);
          assert.ok(layout.bodyScrollWidth <= layout.clientWidth, `${where} : le contenu dépasse le viewport`);
          assert.deepEqual(layout.outside, [], `${where} : éléments hors écran`);
          assert.equal(layout.actionCollision, false, `${where} : actions en collision`);
          assert.equal(layout.filterCollision, false, `${where} : filtres en collision`);
          assert.equal(layout.headerCollision, false, `${where} : header en collision`);
          assert.equal(layout.tableScrolls, false, `${where} : tableau en défilement horizontal`);
          assert.ok(layout.primary.every(Boolean), `${where} : action principale hors écran`);
          assert.equal(layout.title, TITLES[screen], where);
          assert.deepEqual(layout.activeNav, [screen], `${where} : une seule entrée de navigation active`);
          if (layout.rowDisplay) assert.equal(layout.rowDisplay, width <= 600 ? 'grid' : 'table-row', `${where} : ${width <= 600 ? 'cards attendues' : 'tableau attendu'}`);
          if (kind === 'empty' && screen !== 'dashboard') {
            assert.ok(await page.$('.main>section:not(.hidden) .rec-empty-state'), `${where} : état vide attendu`);
            assert.ok(layout.emptyHeight <= 220, `${where} : état vide trop haut (${layout.emptyHeight}px)`);
          }
          if (kind === 'many' && ['candidates', 'reserve', 'recruited', 'archive'].includes(screen)) assert.match(layout.pagination, /page 1\/\d/, `${where} : pagination`);
          const wanted = { many: { 1440: SCREENS, 390: ['candidates', 'interviews'] }, empty: { 1440: ['candidates'], 390: ['candidates'] } }[kind][width] || [];
          if (wanted.includes(screen)) await shot(page, `${kind === 'many' ? '' : 'vide-'}${screen}-${width}`);
        }
        assert.deepEqual(errors, [], `erreurs JavaScript à ${width}px`);
        await page.close();
      }
    });
  });
}

test('responsive Chrome — candidatures : stabilité du layout, société active, fiche, erreur API et permissions', { skip: SKIP, timeout: 120000 }, async () => {
  await withApp('many', ['read', 'create', 'update'], async ({ browser, base, state }) => {
    const { page, errors } = await openApp(browser, base, state.data.announcements, 1440);
    const geometry = () => page.evaluate(() => ['.rec-page-header', '#tabs', '.rec-filters', '.rec-table-card'].map(selector => { const r = document.querySelector('#candidatesSection ' + selector).getBoundingClientRect(); return [selector, Math.round(r.left), Math.round(r.width)]; }));
    const brand = () => page.evaluate(() => ({ name: document.getElementById('recruitmentBrand').textContent, logo: document.querySelector('#recruitmentBrand img')?.getAttribute('src') }));
    await show(page, 'candidates');
    const initial = await geometry();
    await delay(15000);                                               // aucune bascule différée du layout
    assert.deepEqual(await geometry(), initial);
    assert.deepEqual(await brand(), { name: SECURITE, logo: '/static/iron-securite-logo.png' });

    await page.select('#opinionFilter', 'Favorable');
    await page.waitForFunction(() => [...document.querySelectorAll('#listWrap tbody tr')].length > 0 && [...document.querySelectorAll('#listWrap .avis-select')].every(el => el.value === 'Favorable'));
    assert.deepEqual(await geometry(), initial);
    assert.equal(await page.$eval('.counter-chip.favorable', el => el.classList.contains('active')), true);
    // Avis Favorable + droits ⇒ action Recruter directe (verte) sur la ligne.
    assert.ok(await page.$('#listWrap tbody tr .row-recruit'));

    await page.select('#societySelect', SOLUTION);
    await page.waitForFunction(() => document.getElementById('recruitmentBrand').textContent === 'IRON GLOBAL SOLUTION');
    assert.deepEqual(await brand(), { name: SOLUTION, logo: '/static/iron-solution-logo.png' });
    await show(page, 'dashboard');
    assert.match(await page.$eval('#dashboardSection', el => el.innerText), /Candidatures totales\s*8/);
    await page.select('#societySelect', SECURITE);
    await show(page, 'candidates');
    await page.click('.filter-reset');
    await page.waitForFunction(() => /74 dossiers/.test(document.getElementById('candidateTotal').textContent));
    assert.deepEqual(await geometry(), initial);
    assert.deepEqual(await brand(), { name: SECURITE, logo: '/static/iron-securite-logo.png' });

    await page.click('#listWrap tbody tr .row-open');
    await page.waitForSelector('#modalBackdrop:not(.hidden)');
    const modal = await page.evaluate(() => { const r = document.querySelector('#modalBackdrop .modal').getBoundingClientRect(), save = document.getElementById('saveBtn').getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth, saveVisible: save.top >= 0 && save.bottom <= innerHeight, font: parseFloat(getComputedStyle(document.getElementById('fLastName')).fontSize) }; });
    assert.deepEqual(modal, { fits: true, saveVisible: true, font: 13 });
    await page.click('#modalBackdrop .modal-close');
    assert.deepEqual(await geometry(), initial);

    // Mobile : fiche presque plein écran, une colonne, pied accessible sans défilement de page.
    await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: 'networkidle0' });
    await show(page, 'candidates');
    await page.click('#addCandidateBtn');
    await page.waitForSelector('#modalBackdrop:not(.hidden)');
    const mobile = await page.evaluate(() => {
      const r = document.querySelector('#modalBackdrop .modal').getBoundingClientRect(), save = document.getElementById('saveBtn').getBoundingClientRect();
      const fields = [...document.querySelectorAll('#candidateForm input:not([type=hidden]):not([type=file]),#candidateForm select:not(.hidden),#candidateForm textarea')].map(el => el.getBoundingClientRect()).filter(b => b.width);
      return { margin: Math.round(r.left), width: Math.round(r.width), saveVisible: save.top >= 0 && save.bottom <= innerHeight, truncated: fields.filter(b => b.left < r.left || b.right > r.right + 1).length, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(mobile, { margin: 12, width: 366, saveVisible: true, truncated: 0, overflow: false });
    await page.click('#modalBackdrop .modal-close');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'networkidle0' });
    await show(page, 'candidates');

    // Erreur API : composant cohérent, géométrie conservée, reprise par « Réessayer ».
    state.fail = true;
    await page.click('#refreshCandidatesBtn');
    await page.waitForSelector('#listWrap .rec-error-state');
    assert.deepEqual(await geometry(), initial);
    assert.match(await page.$eval('#listWrap', el => el.innerText), /Service indisponible \(test\)/);
    state.fail = false;
    await page.click('#listWrap .rec-error-state button');
    await page.waitForSelector('#listWrap tbody tr');
    assert.deepEqual(errors, []);
    await page.close();
  });

  // Lecture seule : aucune action d'écriture n'apparaît, sur aucun écran.
  await withApp('many', ['read'], async ({ browser, base, state }) => {
    const { page } = await openApp(browser, base, state.data.announcements, 1280);
    for (const screen of SCREENS) {
      await show(page, screen);
      const controls = await page.evaluate(() => [...document.querySelectorAll('.main>section:not(.hidden) :is(.primary,.danger,.row-open,.row-convoke,.row-recruit,.kebab-btn,.avis-select,#importCandidatesBtn)')].filter(el => el.getClientRects().length).map(el => el.textContent.trim() || el.className));
      assert.deepEqual(controls, [], `lecture seule ${screen}`);
    }
    await page.close();
  });
});
