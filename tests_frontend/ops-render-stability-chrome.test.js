// OPS — stabilité du rendu en Chrome RÉEL : un rendu par navigation, aucun écran intermédiaire peint,
// aucune reconstruction tardive, saisie conservée, modales stables, écouteurs uniques, pas de débordement.
// node --test --test-force-exit tests_frontend/ops-render-stability-chrome.test.js
// Les états sont échantillonnés juste avant chaque image (requestAnimationFrame) : seul ce qui est
// réellement peint compte, pas les états transitoires d'une même tâche.
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer } = require('./helpers/atlas-chrome');

const SIZES = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844]];

const RECORDER = () => {
  const rec = window.__stab = { writes: [], painted: [], renders: [] };
  const now = () => Math.round(performance.now());
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get: desc.get, set(v) {
    if (this.id === 'view') rec.writes.push({ t: now(), hash: location.hash, head: String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) });
    return desc.set.call(this, v);
  } });
  setInterval(() => {
    const f = window.renderInternal;
    if (typeof f === 'function' && !f.__stab) { const g = function (...a) { rec.renders.push({ t: now(), hash: location.hash }); return f.apply(this, a); }; g.__stab = 1; window.renderInternal = g; }
  }, 20);
  let last = '';
  const frame = () => {
    const view = document.getElementById('view');
    if (view) {
      const legacy = [...view.querySelectorAll('button.btn,a.btn')].filter(b => !b.classList.contains('ops-btn') && b.offsetParent).length;
      const moduleCard = /Chargement du module/.test(view.textContent.slice(0, 200));
      const genericHeader = !!view.querySelector('.stf.module-page-header,.ops-sites-cc.module-page-header');
      const s = `${location.hash}|${legacy}|${moduleCard}|${genericHeader}`;
      if (s !== last) { last = s; rec.painted.push({ t: now(), hash: location.hash, legacy, moduleCard, genericHeader }); }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

test('OPS — stabilité du rendu, Chrome réel', {
  timeout: 420000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_STABILITY_ARTIFACTS || path.join(os.tmpdir(), 'atlas-ops-render-stability');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_STABILITY_PORT || 8977), artifacts });
  const report = {};
  t.after(() => fs.writeFileSync(path.join(artifacts, 'stability.json'), JSON.stringify(report, null, 2)));
  await t.test('après connexion : la page demandée s\'affiche dès l\'arrivée des données (plus d\'attente de 20 s)', async () => {
    const fresh = await atlas.login('ops', 'OPS01', 'sites/' + atlas.fixture.sites[0]);
    const t0 = Date.now();
    await fresh.waitForFunction(() => document.querySelector('#site-form .stf-actionbar'), { timeout: 30000, polling: 100 });
    const elapsed = Date.now() - t0;
    report.afterLoginMs = elapsed;
    assert.ok(elapsed < 8000, 'fiche affichée en ' + elapsed + ' ms');
    await fresh.browserContext().close();
  });
  const page = await atlas.login('ops', 'OPS01', 'ops/dashboard');
  await page.evaluateOnNewDocument(RECORDER);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stab && document.querySelector('.ops-cc,.ops-dash-hero,#view h1'), { timeout: 40000, polling: 200 });
  await atlas.delay(2500);
  const since = t0 => page.evaluate(t0 => { const s = window.__stab; const f = x => x.t >= t0; return { writes: s.writes.filter(f), painted: s.painted.filter(f), renders: s.renders.filter(f) }; }, t0);
  const mark = () => page.evaluate(() => Math.round(performance.now()));
  const sidebar = route => page.evaluate(r => document.querySelector(`.sidebar [data-route="${r}"]`).click(), route);
  const siteId = atlas.fixture.sites[0];

  await t.test('navigation par # (Sites → fiche → retour) : un seul rendu par navigation', async () => {
    await page.evaluate(() => { location.hash = '#/sites/actifs'; });
    await page.waitForFunction(() => document.querySelector('.ops-sites-cc[data-cc-ready]'), { timeout: 30000, polling: 100 });
    await atlas.delay(3000);
    let t0 = await mark();
    await page.evaluate(id => { location.hash = '#/sites/' + id; }, siteId);
    try { await page.waitForFunction(() => document.querySelector('#site-form .stf-actionbar'), { timeout: 30000, polling: 100 }); }
    catch (e) { throw new Error(e.message + ' — état : ' + JSON.stringify(await page.evaluate(() => ({ hash: location.hash, view: document.getElementById('view')?.textContent.replace(/\s+/g, ' ').slice(0, 160), stab: !!window.__stab })))); }
    await atlas.delay(1500);
    const fiche = await since(t0);
    t0 = await mark();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.ops-sites-cc[data-cc-ready]'), { timeout: 30000, polling: 100 });
    await atlas.delay(5000);
    const back = await since(t0);
    report.hashNavigation = { fiche, back };
    assert.equal(fiche.renders.length, 1, 'fiche : un seul render()');
    assert.equal(back.renders.length, 1, 'retour : un seul render()');
    const late = back.writes.filter(w => w.t - t0 > 1500);
    assert.deepEqual(late, [], 'aucune reconstruction tardive de Sites après le retour');
  });

  await t.test('navigation latérale : aucun ancien écran ni bouton à l\'ancien style peint', async () => {
    // Premier passage : charge les scripts des modules (écran de chargement légitime, réseau).
    for (const route of ['effectif/recap', 'ops/mouvements', 'pointage/dashboard']) { await sidebar(route); await atlas.delay(2500); }
    // Mesure : modules déjà chargés, navigation habituelle entre rubriques.
    const steps = {};
    for (const route of ['effectif/recap', 'ops/mouvements', 'pointage/dashboard', 'sites/actifs', 'ops/dashboard']) {
      const t0 = await mark();
      await sidebar(route);
      await atlas.delay(3500);
      steps[route] = await since(t0);
    }
    report.sidebar = steps;
    for (const [route, s] of Object.entries(steps)) {
      assert.deepEqual(s.painted.filter(p => p.legacy > 0), [], route + ' : boutons à l\'ancien style peints');
      assert.deepEqual(s.painted.filter(p => p.moduleCard), [], route + ' : écran « Chargement du module » peint pour un module déjà chargé');
      assert.deepEqual(s.painted.filter(p => p.genericHeader), [], route + ' : habillage générique peint');
    }
  });

  await t.test('après chargement : aucune reconstruction tardive (filet 20 s) et saisie conservée', async () => {
    await page.evaluate(id => { location.hash = '#/sites/' + id; }, siteId);
    await page.waitForFunction(() => document.querySelector('#site-form .stf-actionbar'), { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__stab && document.querySelector('#site-form .stf-actionbar') && typeof sgdiExitViewMode === 'function', { timeout: 40000, polling: 100 });
    await atlas.delay(1500);
    await page.evaluate(() => sgdiExitViewMode());
    const t0 = await mark();
    await page.click('[name="siteOuvertPar"]', { clickCount: 3 });
    await page.keyboard.type('Brouillon stabilite');
    await page.click('.stf-title h1');
    await atlas.delay(26000);
    const state = await since(t0);
    const value = await page.$eval('[name="siteOuvertPar"]', el => el.value);
    report.lateRebuild = { writes: state.writes, value };
    assert.deepEqual(state.writes, [], 'aucune reconstruction de la fiche pendant la saisie');
    assert.equal(value.toLocaleLowerCase('fr'), 'brouillon stabilite', 'saisie non enregistrée conservée');
  });

  await t.test('modale : reste ouverte tant que l\'utilisateur ne la ferme pas', async () => {
    await page.evaluate(() => { if (typeof sgdiEnterViewMode === 'function') sgdiEnterViewMode(true); });
    await page.evaluate(() => [...document.querySelectorAll('.stf-toolbar .ops-btn')].find(b => /Demandes/.test(b.textContent))?.click());
    await page.waitForSelector('#modal-host .modal-bg', { timeout: 10000 });
    await atlas.delay(4000);
    assert.ok(await page.$('#modal-host .modal-bg'), 'modale toujours ouverte');
    await page.evaluate(() => closeModal());
    await atlas.delay(1500);
    assert.equal(await page.$('#modal-host .modal-bg'), null, 'modale fermée par l\'utilisateur');
  });

  await t.test('écouteurs de navigation uniques', async () => {
    const cdp = await page.target().createCDPSession();
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const count = type => listeners.filter(l => l.type === type).length;
    report.listeners = { hashchange: count('hashchange'), popstate: count('popstate') };
    assert.equal(count('popstate'), 1);
    assert.equal(count('hashchange'), 2, 'navigation + nettoyage photo à distance');
  });

  for (const [width, height] of SIZES) {
    await t.test(`${width}×${height} : aucun débordement horizontal (Sites, fiche, effectifs)`, async () => {
      await page.setViewport({ width, height });
      const out = {};
      for (const hash of ['#/sites/actifs', '#/sites/' + siteId, '#/effectif/recap']) {
        await page.evaluate(h => { location.hash = h; }, hash);
        await atlas.delay(2500);
        out[hash] = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, view: document.getElementById('view').scrollWidth - document.getElementById('view').clientWidth }));
      }
      report['overflow-' + width] = out;
      for (const [hash, o] of Object.entries(out)) { assert.equal(o.doc, 0, hash); assert.ok(o.view <= 0, hash); }
    });
  }

  await t.test('aucune erreur JavaScript (hors 403 préexistants du profil OPS)', () => {
    assert.deepEqual(atlas.errors.filter(e => !/\/api\/(materiel\/stores|commercial\/clients|irongs\/collections\/demandesPersonnel)/.test(`${e.console || ''} ${e.source || ''}`)), []);
  });
});
