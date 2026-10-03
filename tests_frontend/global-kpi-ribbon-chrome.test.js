// Bandeau KPI du Global Shell — contrôle en Chrome RÉEL (jsdom ne mesure aucune hauteur).
// node --test tests_frontend/global-kpi-ribbon-chrome.test.js
// Serveur uvicorn isolé + base SQLite temporaire + fixtures synthétiques. Aucune donnée de production.
// Options : PUPPETEER_EXECUTABLE_PATH, ATLAS_E2E_PYTHON, ATLAS_KPI_E2E_PORT, ATLAS_KPI_E2E_ARTIFACTS,
// ATLAS_KPI_E2E_PREFIX (préfixe des captures), ATLAS_KPI_E2E_MEASURE_ONLY=1 (relevé sans assertion de hauteur).
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer } = require('./helpers/atlas-chrome');

const WIDTHS = [1440, 1280, 1024, 768, 430, 390];
const PREFIX = process.env.ATLAS_KPI_E2E_PREFIX || '';
const MEASURE_ONLY = process.env.ATLAS_KPI_E2E_MEASURE_ONLY === '1';

test('Bandeau KPI global compact — Chrome réel, OPS et DRH, six largeurs', {
  timeout: 240000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_KPI_E2E_ARTIFACTS || path.join(os.tmpdir(), 'atlas-kpi-ribbon-chrome');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_KPI_E2E_PORT || 8971), artifacts });
  const measurements = [];
  t.after(() => fs.writeFileSync(path.join(artifacts, `${PREFIX}kpi-measurements.json`), JSON.stringify(measurements, null, 2)));

  for (const config of [
    { host: 'ops', user: 'OPS01', route: 'effectif/actifs' },
    { host: 'drh', user: 'DRH01', route: 'effectif/recap' },
  ]) await t.test(`${config.host} : une seule rangée compacte, valeurs et liens du module conservés`, async () => {
    const page = await atlas.login(config.host, config.user, config.route);
    await page.waitForSelector('.sgdi-shell.atlas-shell-v4 .module-counters-ribbon .module-counter-item', { visible: true, timeout: 20000 });
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 900 });
      await atlas.settled(page);
      const state = await page.evaluate(() => {
        const bar = [...document.querySelectorAll('.sgdi-shell.atlas-shell-v4 .module-counters-ribbon')].find(el => el.getBoundingClientRect().height > 0);
        const box = bar.getBoundingClientRect();
        const items = [...bar.querySelectorAll('.module-counter-item')];
        // Deux rangées = un compteur placé entièrement sous un autre (les hauteurs peuvent différer).
        const boxes = items.map(item => item.getBoundingClientRect());
        const firstBottom = Math.min(...boxes.map(b => b.bottom));
        const stacked = boxes.some(b => b.top >= firstBottom - 1);
        const sample = items[0];
        return {
          viewport: innerWidth, height: Math.round(box.height * 100) / 100, top: box.top, left: box.left, right: box.right,
          rows: stacked ? 2 : 1, items: items.length,
          labels: items.map(item => item.querySelector('.module-counter-label').textContent.trim()),
          values: items.map(item => item.querySelector('.module-counter-value').textContent.trim()),
          hrefs: items.map(item => item.getAttribute('href')),
          children: items.map(item => item.children.length),
          localScroll: bar.scrollWidth > bar.clientWidth + 1,
          overflowX: getComputedStyle(bar).overflowX,
          radius: parseFloat(getComputedStyle(bar).borderTopLeftRadius),
          valueSize: parseFloat(getComputedStyle(sample.querySelector('.module-counter-value')).fontSize),
          labelSize: parseFloat(getComputedStyle(sample.querySelector('.module-counter-label')).fontSize),
          documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        };
      });
      measurements.push({ module: config.host, ...state });
      const top = Math.max(0, state.top - 70);
      await page.screenshot({ path: path.join(artifacts, `${PREFIX}kpi-${config.host}-${width}.png`), clip: { x: 0, y: top, width, height: Math.min(900 - top, state.height + 150) } });
      const label = `${config.host} @${width}: ${JSON.stringify(state)}`;
      if (MEASURE_ONLY) continue;
      assert.equal(state.rows, 1, 'une seule rangée de KPI — ' + label);
      assert.ok(state.documentWidth <= width + 2 && state.bodyWidth <= width + 2, 'aucun débordement horizontal global — ' + label);
      assert.ok(state.left >= 0 && state.right <= width + 1, 'le bandeau reste dans la fenêtre — ' + label);
      assert.ok(state.items >= 4, 'compteurs du module rendus — ' + label);
      assert.ok(state.hrefs.every(href => /^#\/.+/.test(href)), 'liens conservés — ' + label);
      assert.ok(state.children.every(count => count === 4), 'pastille, valeur, libellé, badge — aucun sous-texte — ' + label);
      if (width >= 1280) assert.ok(state.height >= 56 && state.height <= 62, 'hauteur 56–62 px — ' + label);
      else assert.ok(state.height >= 56 && state.height <= 64, 'hauteur 56–64 px — ' + label);
      assert.ok(state.radius >= 12 && state.radius <= 14, 'rayon 12–14 px — ' + label);
      assert.ok(state.valueSize >= 19 && state.valueSize <= 22, 'valeur ~20–22 px — ' + label);
      assert.ok(state.labelSize >= 9 && state.labelSize <= 10, 'libellé ~9–10 px — ' + label);
      if (state.localScroll) assert.match(state.overflowX, /auto|scroll/, 'défilement horizontal local au bandeau — ' + label);
    }
    assert.deepEqual(atlas.errors, [], 'aucune erreur console / page');
    await page.close();
  });
});
