// OPS → Sites en Command Center — contrôle en Chrome RÉEL (carte MapLibre/OSM, thème, responsive).
// node --test tests_frontend/ops-sites-command-center-chrome.test.js
// Serveur uvicorn isolé + SQLite temporaire + fixtures synthétiques. Les tuiles OpenStreetMap
// viennent d'Internet : leur chargement est relevé (tilesLoaded) mais n'est pas une assertion.
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer } = require('./helpers/atlas-chrome');

const WIDTHS = [1440, 1280, 1024, 768, 430, 390];
const rgb = color => (String(color).match(/[\d.]+/g) || []).map(Number);

test('OPS → Sites Command Center — Chrome réel', {
  timeout: 240000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_SITES_E2E_ARTIFACTS || path.join(os.tmpdir(), 'atlas-ops-sites-chrome');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_SITES_E2E_PORT || 8973), artifacts });
  const report = { widths: [] };
  t.after(() => fs.writeFileSync(path.join(artifacts, 'sites-measurements.json'), JSON.stringify(report, null, 2)));

  const page = await atlas.login('ops', 'OPS01', 'sites');
  const tiles = { ok: 0, failed: 0 };
  page.on('requestfinished', request => { if (request.url().includes('tile.openstreetmap.org')) tiles.ok += request.response()?.ok() ? 1 : 0; });
  page.on('requestfailed', request => { if (request.url().includes('tile.openstreetmap.org')) tiles.failed += 1; });
  await page.waitForSelector('[data-testid="ops-sites-command-center"][data-cc-ready] .ops-sites-cc-card', { visible: true, timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.ops-sites-cc .ops-sites-cc-marker').length > 0, { timeout: 20000 });
  await atlas.delay(2500); // laisse aux tuiles distantes le temps d'arriver (relevé, non bloquant)

  await t.test('command center sombre, données réelles du périmètre, pas de maquette', async () => {
    const state = await page.evaluate(() => {
      const root = document.querySelector('.ops-sites-cc');
      const text = selector => [...root.querySelectorAll(selector)].map(el => el.textContent.replace(/\s+/g, ' ').trim());
      return {
        background: getComputedStyle(root).backgroundColor, card: getComputedStyle(root.querySelector('.ops-sites-cc-card')).backgroundImage,
        cardColor: getComputedStyle(root.querySelector('.ops-sites-cc-card h3')).color,
        body: getComputedStyle(document.body).backgroundColor,
        shell: { sidebars: document.querySelectorAll('.sidebar').length, topbars: document.querySelectorAll('.sgdi-topbar').length, ribbon: document.querySelectorAll('.module-counters-ribbon').length },
        title: root.querySelector('h1').textContent, crumb: root.querySelector('.ops-sites-cc-crumb').textContent.replace(/\s+/g, ' ').trim(),
        tabs: text('[data-cc-view-btn]'), kpis: Object.fromEntries([...root.querySelectorAll('.ops-sites-cc-kpi')].map(el => [el.dataset.ccKpi, el.querySelector('strong').textContent])),
        names: text('.ops-sites-cc-card h3'), statuses: text('.ops-sites-cc-card .ops-sites-cc-status'), chips: text('.ops-sites-cc-card .ops-sites-cc-chip'),
        count: root.querySelector('#ops-sites-cc-count').textContent, legend: text('.ops-sites-cc-legend li'), coverage: text('.ops-sites-cc-coverage dl div'),
        all: root.textContent, legacy: document.querySelectorAll('#view .sites-synth-panel, #view .card.site-card').length,
        details: [...root.querySelectorAll('.ops-sites-cc-more')].map(a => a.getAttribute('href')),
      };
    });
    report.state = state;
    const [r, g, b] = rgb(state.background);
    assert.ok(r < 40 && g < 50 && b < 80 && b > r, 'fond bleu nuit: ' + state.background);
    assert.ok(rgb(state.cardColor).slice(0, 3).every(n => n > 220), 'texte clair sur carte sombre');
    assert.ok(rgb(state.body).slice(0, 3).every(n => n >= 240), 'le shell global reste clair');
    assert.equal(state.shell.sidebars, 1, 'pas de seconde sidebar');
    assert.equal(state.shell.topbars, 1, 'pas de second header global');
    assert.ok(state.shell.ribbon <= 1, 'pas de second bandeau KPI global');
    assert.equal(state.title, 'Sites - Tableau de bord');
    assert.equal(state.crumb, 'OPS›Sites');
    assert.deepEqual(state.tabs, ['Carte', 'Liste', 'Analytique'], 'onglets réellement disponibles uniquement');
    assert.doesNotMatch(state.all, /Nouveau site|Planning|Maintenance|ALERTE MANQUE D'EFFECTIF|INTERDIT/);
    assert.equal(state.legacy, 0, 'plus de grandes cartes blanches ni de synthèse claire');
    assert.deepEqual(state.names, ['SITE TEST ALPHA', 'SITE TEST BETA', 'SITE TEST DELTA', 'SITE TEST EPSILON', 'SITE TEST GAMMA']);
    assert.deepEqual(state.statuses, ['Alerte effectif', 'Opérationnel', 'Inactif', 'Non opérationnel', 'Opérationnel']);
    assert.equal(state.count, 'Liste des sites (5)');
    assert.equal(state.kpis['Sites total'], '5');
    assert.equal(state.kpis['Sites actifs'], '4');
    assert.equal(state.kpis['Sites en alerte'], '1');
    assert.equal(state.kpis['Agents affectés'], '7');
    assert.equal(state.kpis['Couverture'], '83%');
    assert.ok(state.chips.includes('⚠ 1 manquant') && state.chips.includes('+2 surplus') && state.chips.includes('Conforme') && state.chips.includes('Site inactif'), JSON.stringify(state.chips));
    assert.ok(state.details.every(href => /^#\/sites\/\d+$/.test(href)), 'lien « Voir le détail » par site');
  });

  await t.test('vraie carte MapLibre + OpenStreetMap : canvas, attribution, zoom, marqueurs par statut', async () => {
    const map = await page.evaluate(() => {
      const frame = document.querySelector('#sites-map-frame');
      const canvas = frame.querySelector('canvas.maplibregl-canvas');
      const m = window.__sgdiSitesDashboardMap;
      const before = m.getZoom();
      frame.querySelector('.maplibregl-ctrl-zoom-in').click();
      return {
        canvas: !!canvas, canvasSize: canvas ? [canvas.clientWidth, canvas.clientHeight] : null, images: frame.querySelectorAll('img').length,
        attribution: frame.querySelector('.maplibregl-ctrl-attrib')?.textContent || '', attributionVisible: frame.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect().width > 40,
        zoomIn: !!frame.querySelector('.maplibregl-ctrl-zoom-in'), zoomOut: !!frame.querySelector('.maplibregl-ctrl-zoom-out'), zoomBefore: before,
        markers: [...frame.querySelectorAll('.ops-sites-cc-marker')].map(el => el.dataset.ccStatus).sort(),
        markerColors: Object.fromEntries([...frame.querySelectorAll('.ops-sites-cc-marker')].map(el => [el.dataset.ccStatus, getComputedStyle(el).backgroundColor])),
        positions: window.__sgdiSitesDashboardMarkers.map(marker => marker.getLngLat().toArray().map(n => Math.round(n * 1000) / 1000)).sort(),
        osmPaint: m.getPaintProperty('osm', 'raster-brightness-max'), source: m.getStyle().sources.osm.tiles[0],
        interactive: m.dragPan.isEnabled(),
      };
    });
    await atlas.delay(700);
    map.zoomAfter = await page.evaluate(() => window.__sgdiSitesDashboardMap.getZoom());
    map.tiles = { ...tiles };
    report.map = map;
    assert.ok(map.canvas && map.canvasSize[0] > 200 && map.canvasSize[1] > 200, 'canvas MapLibre réel: ' + JSON.stringify(map.canvasSize));
    assert.match(map.attribution, /OpenStreetMap/, 'attribution OpenStreetMap conservée');
    assert.ok(map.attributionVisible, 'attribution visible');
    assert.match(map.source, /tile\.openstreetmap\.org/);
    assert.ok(map.zoomIn && map.zoomOut && map.zoomAfter > map.zoomBefore, 'zoom fonctionnel: ' + map.zoomBefore + ' → ' + map.zoomAfter);
    assert.ok(map.interactive, 'carte interactive');
    assert.deepEqual(map.markers, ['alerte', 'inactif', 'operationnel', 'operationnel'], 'un marqueur par site positionné, coloré par statut réel');
    assert.deepEqual(map.positions, [[-0.631, 35.697], [3.059, 36.754], [6.615, 36.365], [7.767, 36.9]], 'coordonnées réelles');
    assert.equal(map.osmPaint, 0, 'rendu sombre appliqué à la couche OSM');
  });

  await t.test('filtres, détail conservé et vues', async () => {
    const visible = () => page.$$eval('.ops-sites-cc-card', cards => cards.filter(card => !card.hidden).map(card => card.querySelector('h3').textContent));
    await page.type('#ops-sites-cc-search', 'oran');
    assert.deepEqual(await visible(), ['SITE TEST BETA', 'SITE TEST EPSILON']);
    await page.click('.ops-sites-cc-filters .ops-sites-cc-btn');
    await page.select('#ops-sites-cc-status', 'alerte');
    assert.deepEqual(await visible(), ['SITE TEST ALPHA']);
    await page.click('.ops-sites-cc-filters .ops-sites-cc-btn');
    await page.select('#ops-sites-cc-client', 'CLIENT TEST NORD');
    assert.deepEqual(await visible(), ['SITE TEST ALPHA', 'SITE TEST GAMMA']);
    await page.click('.ops-sites-cc-filters .ops-sites-cc-btn');
    assert.equal((await visible()).length, 5);
    await page.click('.ops-sites-cc-card [aria-controls]');
    const detail = await page.$eval('.ops-sites-cc-card .ops-sites-cc-card-detail', el => ({ hidden: el.hidden, text: el.textContent.replace(/\s+/g, ' ') }));
    assert.equal(detail.hidden, false);
    assert.match(detail.text, /Contractuel3.*Jour2.*Nuit1.*Affecté2.*Surplus0.*Manque−1.*Historique des mouvements/);
    await page.click('.ops-sites-cc-card [aria-controls]');
    await page.click('[data-cc-view-btn="analytique"]');
    assert.equal(await page.$eval('.ops-sites-cc-analytics', el => getComputedStyle(el).display), 'block');
    assert.equal(await page.$eval('.ops-sites-cc-map-panel', el => getComputedStyle(el).display), 'none');
    await page.screenshot({ path: path.join(artifacts, 'sites-analytique-1440.png'), fullPage: false });
    await page.click('[data-cc-view-btn="liste"]');
    assert.equal(await page.$eval('.ops-sites-cc', el => el.dataset.ccLayout), 'liste');
    await page.click('[data-cc-view-btn="carte"]');
    await page.click('[data-cc-layout-btn="grille"]');
    await page.select('#sites-map-select', '__all__'); // recadre la carte sur tous les sites positionnés
    assert.match(await page.$eval('#ops-sites-cc-search', el => getComputedStyle(el).backgroundColor), /rgb\(10, 23, 48\)/, 'champ de recherche sombre');
  });

  await t.test('responsive : aucune barre horizontale globale, colonnes de cartes par largeur', async () => {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 900 });
      await atlas.settled(page);
      await atlas.delay(700);
      const state = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.ops-sites-cc-card')].filter(card => !card.hidden).map(card => card.getBoundingClientRect());
        const firstTop = Math.round(cards[0].top);
        const root = document.querySelector('.ops-sites-cc').getBoundingClientRect();
        const main = document.querySelector('.sgdi-shell-body > main');
        const mapBox = document.querySelector('#sites-map-frame').getBoundingClientRect();
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, mainScroll: main.scrollWidth - main.clientWidth,
          perRow: cards.filter(box => Math.round(box.top) === firstTop).length, cardWidth: Math.round(cards[0].width), root: [Math.round(root.left), Math.round(root.right)],
          map: [Math.round(mapBox.width), Math.round(mapBox.height)], ribbon: document.querySelector('.module-counters-ribbon')?.getBoundingClientRect().height ?? null };
      });
      report.widths.push(state);
      // Le shell défile dans un conteneur interne : la capture agrandit la fenêtre le temps du cliché.
      const full = await page.evaluate(() => {
        const root = document.querySelector('.ops-sites-cc');
        let scroller = root.parentElement;
        while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        if (!scroller || scroller === document.body) return innerHeight;
        scroller.scrollTop = 0;
        return innerHeight + (scroller.scrollHeight - scroller.clientHeight) + 8;
      });
      await page.setViewport({ width, height: Math.min(7000, Math.ceil(full)) });
      await atlas.delay(900);
      await page.screenshot({ path: path.join(artifacts, `sites-${width}.png`) });
      await page.setViewport({ width, height: 900 });
      const label = JSON.stringify(state);
      assert.ok(state.documentWidth <= width + 2 && state.bodyWidth <= width + 2 && state.mainScroll <= 2, 'aucun débordement horizontal global — ' + label);
      assert.ok(state.root[1] <= width + 1, 'le command center reste dans la fenêtre — ' + label);
      if (state.ribbon !== null) assert.equal(state.ribbon, 58, 'bandeau KPI global compact — ' + label);
      const [min, max] = width >= 1440 ? [4, 5] : width >= 1280 ? [3, 5] : width >= 1024 ? [2, 3] : width >= 768 ? [1, 2] : [1, 1];
      assert.ok(state.perRow >= min && state.perRow <= max, `${min}–${max} cartes par ligne — ` + label);
      assert.ok(state.map[0] > 250 && state.map[1] >= 300, 'carte lisible — ' + label);
    }
  });

  await t.test('aucune erreur de page (hors tuiles distantes)', () => {
    const errors = atlas.errors.filter(error => !/tile\.openstreetmap\.org|arcgisonline|net::ERR_/.test(JSON.stringify(error)));
    report.errors = atlas.errors;
    assert.deepEqual(errors, []);
  });
});
