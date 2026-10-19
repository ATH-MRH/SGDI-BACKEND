// OPS → Fiche technique site — contrôle en Chrome RÉEL (mise en page, onglets, barre d'actions).
// node --test tests_frontend/ops-site-fiche-technique-chrome.test.js
// Serveur uvicorn isolé + SQLite temporaire + fixtures synthétiques (tests_frontend/helpers/atlas-chrome).
// Le rendu et le métier sont vérifiés dans jsdom par tests_frontend/ops-site-fiche-technique.test.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer } = require('./helpers/atlas-chrome');

const SIZES = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]];

test('OPS → Fiche technique site — Chrome réel', {
  timeout: 300000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_SITE_FICHE_ARTIFACTS || path.join(os.tmpdir(), 'atlas-ops-site-fiche-chrome');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_SITE_FICHE_PORT || 8975), artifacts });
  const report = { sizes: [] };
  t.after(() => fs.writeFileSync(path.join(artifacts, 'fiche-measurements.json'), JSON.stringify(report, null, 2)));

  const siteId = atlas.fixture.sites[0];
  const page = await atlas.login('ops', 'OPS01', 'sites/' + siteId);
  await page.waitForFunction(() => document.querySelector('#site-form .stf-actionbar'), { timeout: 30000, polling: 250 });
  await atlas.settled(page);

  await t.test('structure : en-tête, 7 compteurs réels, 9 onglets, une seule barre d\'actions', async () => {
    const state = await page.evaluate(() => ({
      title: document.querySelector('.stf-title h1').textContent,
      crumb: [...document.querySelector('.stf-crumb').children].map(el => el.textContent.trim()).join(' '),
      kpis: Object.fromEntries([...document.querySelectorAll('[data-stf-kpi]')].map(el => [el.dataset.stfKpi, el.querySelector('.stf-kpi-value').textContent])),
      tabs: [...document.querySelectorAll('.stf-tab')].map(el => el.textContent.trim()),
      actions: [...document.querySelectorAll('.stf-actionbar .ops-btn')].map(el => el.textContent.trim()),
      bars: document.querySelectorAll('.site-form-actions').length,
    }));
    assert.equal(state.title, 'FICHE TECHNIQUE SITE');
    assert.equal(state.crumb, 'OPS › Sites › SITE TEST ALPHA › Fiche technique');
    // Fixture : contrat 3, deux affectations actives → manque 1, surplus 0 (aucune valeur inventée).
    assert.deepEqual(state.kpis, { ouverture: '01/01/2020', indicatif: 'ALPHA-1', telephone: '—', contrat: '3', realise: '2', manque: '1', surplus: '0' });
    assert.deepEqual(state.tabs, ['Identification', 'Contact client', 'Effectifs', 'Rotation', 'Affectation', 'Matériel', 'Documents', 'Consignes', 'Procédures']);
    assert.deepEqual(state.actions, ['Établir un PV', 'Enregistrer modification', 'Enregistrer']);
    assert.equal(state.bars, 1);
  });

  await t.test('onglets : accès direct à la rubrique, onglet actif, saisie conservée', async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.type('[name="siteOuvertPar"]', 'Saisie non enregistrée');
    for (const key of ['effectifs', 'materiel', 'procedures', 'identification']) {
      await page.click(`.stf-tab[data-stf-tab="${key}"]`);
      await atlas.delay(900);
      const state = await page.evaluate(k => {
        const view = document.getElementById('view');
        const nav = document.querySelector('.stf-tabs').getBoundingClientRect();
        const section = document.getElementById('stf-sec-' + k).getBoundingClientRect();
        return { active: document.querySelector('.stf-tab[aria-current="true"]').dataset.stfTab, sectionTop: section.top, navBottom: nav.bottom,
          atBottom: view.scrollTop + view.clientHeight >= view.scrollHeight - 4, hash: location.hash };
      }, key);
      assert.equal(state.active, key, 'onglet actif ' + key);
      assert.ok(state.atBottom || Math.abs(state.sectionTop - state.navBottom) < 40, `${key} : rubrique sous les onglets (${state.sectionTop} / ${state.navBottom})`);
      assert.equal(state.hash, '#/sites/' + siteId, 'la navigation interne ne change pas de route');
    }
    // ATLAS force la saisie en majuscules (comportement global existant) : on compare sans la casse.
    assert.equal((await page.$eval('[name="siteOuvertPar"]', el => el.value)).toLocaleLowerCase('fr'), 'saisie non enregistrée');
  });

  for (const [width, height] of SIZES) {
    await t.test(`${width}×${height} : aucun débordement, barre compacte, dernier contenu accessible`, async () => {
      await page.setViewport({ width, height });
      await atlas.delay(500);
      const state = await page.evaluate(() => {
        const view = document.getElementById('view');
        view.scrollTop = 0;
        const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const viewOverflow = view.scrollWidth - view.clientWidth;
        const limit = view.getBoundingClientRect().right + 1;
        const offenders = [...view.querySelectorAll('.stf *')].filter(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || r.right <= limit) return false;
          for (let p = el.parentElement; p && p !== view; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= limit) return false;
          }
          return true;
        }).slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}`);
        const bar = document.querySelector('.stf-actionbar').getBoundingClientRect();
        view.scrollTop = view.scrollHeight;
        const last = document.getElementById('stf-sec-procedures').getBoundingClientRect();
        const barEnd = document.querySelector('.stf-actionbar').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.stf-actionbar .ops-btn')].map(b => b.getBoundingClientRect());
        const tabs = document.querySelector('.stf-tabs-track');
        return { docOverflow, viewOverflow, offenders, barHeight: Math.round(bar.height), lastBottom: Math.round(last.bottom), barTop: Math.round(barEnd.top),
          minButtonHeight: Math.min(...buttons.map(b => b.height)), buttonsInside: buttons.every(b => b.right <= innerWidth + 1 && b.left >= 0),
          tabsScrollable: tabs.scrollWidth > tabs.clientWidth, viewHeight: view.scrollHeight };
      });
      report.sizes.push({ width, height, ...state });
      await page.screenshot({ path: path.join(artifacts, `fiche-${width}x${height}.png`) });
      assert.equal(state.docOverflow, 0, 'débordement de page: ' + state.offenders.join(' | '));
      assert.ok(state.viewOverflow <= 0, 'débordement de la vue: ' + state.offenders.join(' | '));
      assert.ok(state.barHeight <= (width <= 640 ? 72 : 64), 'barre d\'actions compacte: ' + state.barHeight);
      assert.ok(state.lastBottom <= state.barTop + 1, `la dernière rubrique n'est pas masquée par la barre (${state.lastBottom} > ${state.barTop})`);
      assert.ok(state.minButtonHeight >= 32, 'zones cliquables suffisantes');
      assert.ok(state.buttonsInside, 'boutons de la barre visibles');
      await page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
    });
  }

  await t.test('aucune erreur JavaScript (hors 403 préexistants matériel/commercial pour ce profil OPS)', () => {
    const unexpected = atlas.errors.filter(e => !/\/api\/(materiel\/stores|commercial\/clients)/.test(`${e.console || ''} ${e.source || ''}`));
    assert.deepEqual(unexpected, []);
  });
  await t.test('boutons OPS : marqueur présent en OPS, absent en DRH', async () => {
    assert.equal(await page.evaluate(() => !!document.querySelector('.sgdi-shell.sgdi-ops-shell')), true);
    const drh = await atlas.login('drh', 'DRH01', 'dashboard');
    await drh.waitForFunction(() => (document.getElementById('app')?.textContent || '').trim().length > 0 && location.hash !== '#/login', { timeout: 30000, polling: 250 });
    await atlas.delay(1500);
    assert.equal(await drh.evaluate(() => document.querySelectorAll('.sgdi-ops-shell').length), 0);
  });
});
