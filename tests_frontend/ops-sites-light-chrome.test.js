// OPS → Sites : tableau de bord clair — contrôle en Chrome RÉEL (thème, données, interactions, responsive).
// node --test --test-force-exit tests_frontend/ops-sites-light-chrome.test.js
// Banc partagé tests_frontend/helpers/atlas-chrome (serveur isolé, SQLite temporaire, fixtures synthétiques).
// Le démarrage direct sur #/sites souffre d'un défaut de navigation préexistant (signalé par
// ops-sites-command-center-chrome.test.js) : on passe par le tableau de bord OPS puis le vrai renderer serveur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer } = require('./helpers/atlas-chrome');

const SIZES = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]];
const rgb = color => (String(color).match(/[\d.]+/g) || []).map(Number);

test('OPS → Sites, tableau de bord clair — Chrome réel', {
  timeout: 300000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_SITES_LIGHT_ARTIFACTS || path.join(os.tmpdir(), 'atlas-ops-sites-light-chrome');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_SITES_LIGHT_PORT || 8976), artifacts });
  const report = { sizes: [] };
  t.after(() => fs.writeFileSync(path.join(artifacts, 'sites-light-measurements.json'), JSON.stringify(report, null, 2)));

  const page = await atlas.login('ops', 'OPS01', 'ops/dashboard');
  await atlas.delay(1500);
  await page.evaluate(() => { location.hash = '#/sites'; });
  await page.waitForFunction(() => typeof renderSitesServer === 'function' && sgdiViewRenderHash === location.hash && !window.__sgdiSitesBgRefreshing, { timeout: 40000, polling: 250 });
  await page.evaluate(() => renderSitesServer(document.getElementById('view')));
  await page.waitForFunction(() => document.querySelector('.ops-sites-cc[data-cc-ready] .ops-sites-cc-card'), { timeout: 30000, polling: 250 });
  await atlas.delay(1500);

  await t.test('thème clair confiné, compteurs réels, sept indicateurs avec icône', async () => {
    const state = await page.evaluate(() => {
      const root = document.querySelector('.ops-sites-cc');
      const cs = el => getComputedStyle(el);
      return {
        panel: cs(root.querySelector('.ops-sites-cc-panel')).backgroundColor,
        kpi: cs(root.querySelector('.ops-sites-cc-kpi')).backgroundColor,
        title: cs(root.querySelector('h1')).color,
        activeTab: cs(root.querySelector('[data-cc-view-btn][aria-pressed="true"]')).backgroundColor,
        primary: cs(root).getPropertyValue('--ops-sites-primary').trim(),
        globalPrimary: cs(document.documentElement).getPropertyValue('--atlas-primary').trim(),
        kpis: Object.fromEntries([...root.querySelectorAll('.ops-sites-cc-kpi')].map(el => [el.dataset.ccKpi, el.querySelector('strong').textContent])),
        icons: root.querySelectorAll('.ops-sites-cc-kpi .ops-sites-cc-kpi-icon svg').length,
        kpiHeights: [...root.querySelectorAll('.ops-sites-cc-kpi')].map(el => Math.round(el.getBoundingClientRect().height)),
        synth: root.querySelectorAll('[data-cc-panel="synthese"] .ops-sites-cc-synth-tile svg').length,
        surplusRows: root.querySelectorAll('[data-site-surplus-summary] table, .ops-sites-cc [data-surplus-employee]').length,
        all: root.textContent,
      };
    });
    report.state = { ...state, all: undefined };
    assert.deepEqual(rgb(state.panel).slice(0, 3), [255, 255, 255], 'panneaux blancs');
    assert.deepEqual(rgb(state.kpi).slice(0, 3), [255, 255, 255], 'compteurs blancs');
    const [r, g, b] = rgb(state.title);
    assert.ok(r < 40 && g < 60 && b < 100, 'titre bleu marine: ' + state.title);
    assert.deepEqual(rgb(state.activeTab).slice(0, 3), [20, 93, 223], 'onglet actif bleu ATLAS');
    assert.equal(state.primary, '#145ddf');
    assert.equal(state.globalPrimary, '#165dde', 'tokens globaux ATLAS inchangés');
    assert.equal(state.kpis['Sites total'], '5');
    assert.equal(state.kpis['Sites actifs'], '4');
    assert.equal(state.kpis['Sites en alerte'], '1');
    assert.equal(state.kpis['Agents affectés'], '7');
    assert.equal(state.kpis['Couverture'], '83%');
    assert.equal(state.icons, Object.keys(state.kpis).length, 'une icône par compteur');
    assert.ok(state.kpiHeights.every(h => h >= 56 && h <= 90), 'compteurs compacts: ' + state.kpiHeights);
    assert.equal(state.synth, 6, 'synthèse des effectifs avec icônes');
    assert.equal(state.surplusRows, 0, 'surplus numérique uniquement, aucun employé désigné');
    assert.doesNotMatch(state.all, /INTERDIT|Lorem|Sonatrach/i);
  });

  await t.test('carte claire réelle : tuiles OSM non inversées, marqueurs par statut, zoom', async () => {
    await page.waitForFunction(() => window.__sgdiSitesDashboardMap && document.querySelectorAll('.ops-sites-cc-marker').length > 0, { timeout: 20000 });
    const map = await page.evaluate(() => {
      const m = window.__sgdiSitesDashboardMap;
      const wrap = document.querySelector('.ops-sites-cc-map-wrap').getBoundingClientRect();
      const main = document.querySelector('.ops-sites-cc-main').getBoundingClientRect();
      return { brightness: m.getPaintProperty('osm', 'raster-brightness-max'), saturation: m.getPaintProperty('osm', 'raster-saturation'),
        markers: [...document.querySelectorAll('.ops-sites-cc-marker')].map(el => el.dataset.ccStatus).sort(),
        height: Math.round(wrap.height), share: Math.round(wrap.width * 100 / main.width) };
    });
    report.map = map;
    assert.equal(map.brightness, undefined, 'plus d\'inversion de luminosité');
    assert.ok(map.saturation < 0);
    assert.deepEqual(map.markers, ['alerte', 'inactif', 'operationnel', 'operationnel']);
    assert.ok(map.height >= 300 && map.height <= 400, 'hauteur de carte: ' + map.height);
    assert.ok(map.share >= 58 && map.share <= 72, 'carte ≈ 65 % de la zone analytique: ' + map.share);
  });

  await t.test('filtres, réinitialisation, détail et vues : comportements conservés', async () => {
    const shown = () => page.$$eval('.ops-sites-cc-card', cards => cards.filter(c => !c.hidden).map(c => c.querySelector('h3').textContent));
    assert.equal(await page.$eval('.ops-sites-cc', el => el.dataset.ccLayout), 'liste', 'lignes compactes par défaut');
    await page.type('#ops-sites-cc-search', 'beta');
    assert.deepEqual(await shown(), ['SITE TEST BETA']);
    await page.click('.ops-sites-cc-filters .ops-btn');
    assert.equal((await shown()).length, 5);
    await page.select('#ops-sites-cc-status', 'alerte');
    assert.deepEqual(await shown(), ['SITE TEST ALPHA']);
    await page.click('.ops-sites-cc-filters .ops-btn');
    const toggle = await page.$('.ops-sites-cc-card [aria-controls]');
    await toggle.click();
    assert.equal(await page.$eval('.ops-sites-cc-card .ops-sites-cc-card-detail', el => el.hidden), false);
    await toggle.click();
    for (const view of ['liste', 'analytique', 'carte']) {
      await page.click(`[data-cc-view-btn="${view}"]`);
      assert.equal(await page.$eval('.ops-sites-cc', el => el.dataset.ccView), view);
    }
    assert.match(await page.$eval('.ops-sites-cc-card .ops-sites-cc-more', el => el.getAttribute('href')), /^#\/sites\/\d+$/);
  });

  for (const [width, height] of SIZES) {
    await t.test(`${width}×${height} : aucun débordement, aucun chevauchement, actions accessibles`, async () => {
      await page.setViewport({ width, height });
      await atlas.delay(700);
      const state = await page.evaluate(() => {
        const view = document.getElementById('view');
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        let overlaps = [];
        document.querySelectorAll('.ops-sites-cc-card:not([hidden])').forEach(card => {
          const parts = [...card.querySelectorAll('.ops-sites-cc-chip, .ops-sites-cc-metric, .ops-btn, h3, .ops-sites-cc-status')].map(el => ({ el, r: el.getBoundingClientRect() })).filter(p => p.r.width);
          for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
            if (parts[i].el.contains(parts[j].el) || parts[j].el.contains(parts[i].el)) continue;
            if (overlap(parts[i].r, parts[j].r)) overlaps.push(parts[i].el.className + ' / ' + parts[j].el.className);
          }
          const box = card.getBoundingClientRect();
          parts.forEach(p => { if (p.r.right > box.right + 1 || p.r.left < box.left - 1) overlaps.push('hors carte: ' + p.el.className); });
        });
        const buttons = [...document.querySelectorAll('.ops-sites-cc .ops-btn')].filter(b => b.offsetParent);
        const rows = [...document.querySelectorAll('.ops-sites-cc-card:not([hidden])')].map(c => Math.round(c.getBoundingClientRect().height));
        return { docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, viewOverflow: view.scrollWidth - view.clientWidth,
          overlaps: overlaps.slice(0, 5), minButton: Math.min(...buttons.map(b => b.getBoundingClientRect().height)),
          unnamed: buttons.filter(b => !(b.textContent.trim() || b.getAttribute('aria-label'))).length, rows };
      });
      report.sizes.push({ width, ...state });
      await page.screenshot({ path: path.join(artifacts, `sites-light-${width}x${height}.png`) });
      assert.equal(state.docOverflow, 0, 'débordement de page');
      assert.ok(state.viewOverflow <= 0, 'débordement de la vue');
      assert.deepEqual(state.overlaps, [], 'chevauchements dans les lignes de sites');
      assert.ok(state.minButton >= 32, 'zones cliquables: ' + state.minButton);
      assert.equal(state.unnamed, 0, 'chaque bouton garde un intitulé');
      if (width >= 1181) assert.ok(Math.max(...state.rows) <= 110, 'lignes de site compactes: ' + state.rows);
    });
  }

  await t.test('aucune erreur JavaScript', () => {
    assert.deepEqual(atlas.errors, []);
  });

  await t.test('DRH : aucun style ni rendu du tableau de bord Sites', async () => {
    const drh = await atlas.login('drh', 'DRH01', 'effectif/actifs');
    await drh.waitForSelector('.effectif-page', { timeout: 30000 });
    const state = await drh.evaluate(() => ({ cc: document.querySelectorAll('.ops-sites-cc').length, opsUi: document.body.hasAttribute('data-ops-ui'),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--atlas-primary').trim() }));
    assert.deepEqual(state, { cc: 0, opsUi: false, primary: '#165dde' });
  });
});
