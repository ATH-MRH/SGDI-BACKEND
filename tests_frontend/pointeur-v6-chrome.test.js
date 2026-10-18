// Pointeur V6 — Chrome RÉEL, page servie telle quelle (feuilles et scripts du dépôt), API simulée
// avec des données FICTIVES (pointeur-v6-fixture.js) : aucune base, aucun serveur ATLAS.
// Vérifie la disposition validée (compteurs ; à gauche pointage compact puis tableau ; à droite
// présents puis effectifs par fonction jusqu'en bas), l'absence de chevauchement et de défilement
// horizontal aux six résolutions, le séparateur (souris, mémorisation, bornes, tactile), les
// compteurs et fonctions cliquables, la douchette (jeton transmis tel quel) et la fenêtre flottante.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const fx = require('./pointeur-v6-fixture');

const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite */ }
const ROOT = path.join(__dirname, '..', 'app', 'static');
const ARTIFACTS = process.env.ATLAS_V6_ARTIFACTS || path.join(os.tmpdir(), 'atlas-pointeur-v6');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [820, 1180, true], [390, 844, true]];

// Mesures dans la page.
function measure() {
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height } : null; };
  const hit = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
  const blocks = ['#postKpis', '#scannerCard', '#movementsCard', '#presentNowCard', '#panelSplit', '#functionsCard'].map((s) => [s, box(s)]).filter(([, b]) => b);
  const overlaps = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (hit(blocks[i][1], blocks[j][1])) overlaps.push(blocks[i][0] + ' × ' + blocks[j][0]);
  return { overlaps, blocks: Object.fromEntries(blocks), mode: box('.mode-card'), query: box('#manualQuery'), search: box('.manual-search-button'),
    header: box('#appView > .top'), hScroll: document.documentElement.scrollWidth - innerWidth, vScroll: document.documentElement.scrollHeight - innerHeight,
    kpiCount: document.querySelectorAll('#postKpis .v5-kpi').length,
    fnRows: document.querySelectorAll('#functionsList .v6-fn').length, total: document.getElementById('functionsTotal').textContent };
}

test('Pointeur V6 — disposition, panneaux ajustables, compteurs et pointage, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const state = fx.createState();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    const file = url.pathname.startsWith('/static/') ? path.join(ROOT, url.pathname.slice(8)) : path.join(ROOT, 'pointeur.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close().catch(() => {}); server.close(); });
  const errors = [];
  const open = async ({ width = 1440, height = 900, touch = false, split } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
    await page.evaluateOnNewDocument((s) => {
      if (sessionStorage.getItem('v6-init')) return; sessionStorage.setItem('v6-init', '1');   // un rechargement garde le localStorage du poste
      localStorage.setItem('atlas_pointer_session', JSON.stringify({ token: 'fixture', user: { username: 'PTG01', full_name: 'AGENT POINTEUR 01' } }));
      localStorage.setItem('atlas_pointer_scope', JSON.stringify({ society: '', site: '1' }));
      if (s !== undefined) localStorage.setItem('atlas_pointer_v6_split', String(s));
    }, split);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (_) { /* GET */ }
        const [status, data] = fx.respond(state, req.method(), url, body);
        return req.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.hostname !== '127.0.0.1') return req.respond({ status: 200, contentType: 'application/javascript', body: '' });
      return req.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/pointeur`);
    await page.waitForSelector('#presentNowList .v5-person', { timeout: 15000 });
    await delay(300);
    return page;
  };

  await t.test('six résolutions : disposition, aucun chevauchement, aucun défilement horizontal', async () => {
    for (const [width, height, touch] of SIZES) {
      const page = await open({ width, height, touch });
      const m = await page.evaluate(measure);
      const label = `${width}×${height}`;
      const b = m.blocks;
      assert.equal(m.kpiCount, 5, label);
      assert.deepEqual(m.overlaps, [], `${label} : blocs superposés`);
      assert.ok(m.hScroll <= 0, `${label} : défilement horizontal ${m.hScroll}`);
      assert.equal(m.fnRows, 5, label); assert.match(m.total, /TOTAL EN POSTE\s*9\s*100 %/, label);
      if (width >= 900) {
        assert.ok(m.vScroll <= 0, `${label} : la page défile (${m.vScroll})`);
        // Gauche : pointage puis tableau ; droite : présents, séparateur, fonctions jusqu'en bas.
        assert.ok(b['#movementsCard'].y >= b['#scannerCard'].b && b['#movementsCard'].r <= b['#presentNowCard'].x, label);
        assert.ok(b['#functionsCard'].y >= b['#presentNowCard'].b && b['#scannerCard'].x < b['#presentNowCard'].x, label);
        assert.ok(Math.abs(b['#functionsCard'].b - b['#movementsCard'].b) <= 1, `${label} : bas des colonnes alignés`);
        assert.ok(b['#functionsCard'].b <= height && b['#functionsCard'].b >= height - 16, `${label} : fonctions jusqu'en bas`);
        assert.ok(Math.abs(b['#presentNowCard'].y - b['#scannerCard'].y) <= 1, label);
        assert.ok(b['#presentNowCard'].h >= 120 && b['#functionsCard'].h >= 120, `${label} : hauteurs minimales`);
        assert.ok(m.mode.h <= 18.5 && m.query.h <= 24.5 && m.search.h <= 24.5, `${label} : onglets ${m.mode.h} / recherche ${m.query.h}`);
      } else {
        // Une colonne : pointage, présents, fonctions, tableau ; pas de poignée.
        const order = ['#scannerCard', '#presentNowCard', '#functionsCard', '#movementsCard'].map((s) => b[s].y);
        assert.deepEqual([...order].sort((x, y) => x - y), order, `${label} : ordre empilé`);
        assert.equal(b['#panelSplit'], undefined, `${label} : séparateur masqué`);
        assert.ok(m.mode.h >= 28, `${label} : onglets tactiles ${m.mode.h}`);
        for (const s of ['#scannerCard', '#presentNowCard', '#functionsCard', '#movementsCard']) assert.ok(b[s].r <= width + 0.5 && b[s].x >= 0, `${label} ${s}`);
      }
      await page.screenshot({ path: path.join(ARTIFACTS, `poste-${width}x${height}.png`), fullPage: width < 900 });
      await page.browserContext().close();
    }
  });

  await t.test('séparateur : glisser à la souris, hauteur totale conservée, bornes, mémorisation, réinitialisation', async () => {
    const page = await open({ width: 1440, height: 900 });
    const sizes = () => page.evaluate(() => ['presentNowCard', 'functionsCard', 'panelSplit'].map((id) => document.getElementById(id).getBoundingClientRect().height));
    const [p0, f0, s0] = await sizes();
    const grip = await page.$eval('#panelSplitter', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x, grip.y - 100, { steps: 6 }); await page.mouse.up();
    const [p1, f1, s1] = await sizes();
    assert.ok(Math.abs((p0 - p1) - 100) <= 3 && Math.abs((f1 - f0) - 100) <= 3, `vers le haut : ${p0}→${p1}, ${f0}→${f1}`);
    assert.ok(Math.abs((p0 + f0 + s0) - (p1 + f1 + s1)) <= 1, 'hauteur totale conservée');
    const saved = await page.evaluate(() => localStorage.getItem('atlas_pointer_v6_split'));
    assert.ok(saved && Number(saved) < 0.55, `proportion mémorisée (${saved})`);
    await page.mouse.move(grip.x, grip.y - 100); await page.mouse.down(); await page.mouse.move(grip.x, 0, { steps: 8 }); await page.mouse.up();
    const [p2] = await sizes();
    assert.ok(p2 >= 119, `hauteur minimale des présents (${p2})`);
    await page.reload(); await page.waitForSelector('#presentNowList .v5-person'); await delay(300);
    const [p3] = await sizes();
    assert.ok(Math.abs(p3 - p2) <= 2, `disposition relue après rechargement : ${p2} / ${p3}`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'separateur-deplace-1440x900.png') });
    await page.click('[data-split="reset"]'); await delay(50);
    const [p4] = await sizes();
    assert.ok(Math.abs(p4 - p0) <= 1, 'réinitialisation');
    assert.equal(await page.evaluate(() => localStorage.getItem('atlas_pointer_v6_split')), null);
    // Clavier : flèches sur le séparateur.
    await page.focus('#panelSplitter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('#panelSplitter', (e) => e.getAttribute('aria-valuenow')), '65');
    await page.browserContext().close();
  });

  await t.test('alternative tactile : boutons ▲ ▼ ⟲ assez grands, sans glisser', async () => {
    const page = await open({ width: 1024, height: 768, touch: true });
    const buttons = await page.$$eval('.v6-split-btn', (items) => items.map((b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    assert.equal(buttons.length, 3); assert.ok(buttons.every((b) => b.h >= 30 && b.w >= 30), JSON.stringify(buttons));
    const before = await page.$eval('#presentNowCard', (e) => e.getBoundingClientRect().height);
    await page.tap('[data-split="1"]'); await delay(50);
    assert.ok(await page.$eval('#presentNowCard', (e) => e.getBoundingClientRect().height) > before);
    assert.ok(await page.$eval('.mode-card', (e) => e.getBoundingClientRect().height) >= 32, 'onglets tactiles');
    await page.browserContext().close();
  });

  await t.test('compteurs et fonctions cliquables, fiche employé, retour à la vue générale', async () => {
    const page = await open({ width: 1366, height: 768 });
    await page.click('#postKpis [data-kpi="absent"]');
    assert.equal(await page.$$eval('#presentNowList .v5-person', (r) => r.length), 3);
    assert.equal(await page.$eval('#presentNowTitle', (e) => e.textContent), 'Absents / non pointés');
    await page.screenshot({ path: path.join(ARTIFACTS, 'compteur-absents-1366x768.png') });
    await page.click('#detailBack');
    await page.click('#functionsList .v6-fn');
    assert.equal(await page.$eval('#presentNowTitle', (e) => e.textContent), 'Fonction · CARISTE');
    assert.equal(await page.$$eval('#presentNowList .v5-person', (r) => r.length), 3);
    await page.click('#presentNowList .v5-person');
    await page.waitForSelector('#manualCardStep:not(.hidden)');
    const fiche = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const card = r('#scannerCard'), step = r('#manualCardStep'), buttons = [...document.querySelectorAll('.manual-actions button')].map((b) => b.getBoundingClientRect());
      return { card: card.height, step: step.height, buttons: buttons.map((b) => ({ y: b.top, h: b.height, w: b.width })), bottom: Math.max(...buttons.map((b) => b.bottom)), cardBottom: card.bottom,
        status: document.getElementById('manualStatus').textContent, colors: [...document.querySelectorAll('.manual-actions button')].map((b) => getComputedStyle(b).backgroundColor) };
    });
    assert.ok(fiche.step <= 160, `fiche compacte (${fiche.step} px)`);
    assert.ok(fiche.buttons.every((b) => b.h >= 36 && b.h <= 44 && Math.abs(b.y - fiche.buttons[0].y) < 1), JSON.stringify(fiche.buttons));
    assert.ok(fiche.bottom <= fiche.cardBottom, 'boutons dans la carte, sans chevauchement');
    assert.match(fiche.status, /EN POSTE · entrée/);
    assert.equal(new Set(fiche.colors).size, 3, 'vert, rouge, orange');
    await page.screenshot({ path: path.join(ARTIFACTS, 'fiche-employe-1366x768.png') });
    await page.browserContext().close();
  });

  await t.test('douchette : jeton transmis tel quel ; fenêtre flottante sans masquer les commandes ; scans successifs', async () => {
    const page = await open({ width: 1440, height: 900 });
    const scan = async (token) => { await page.focus('#wedgeInput'); await page.keyboard.type(token, { delay: 1 }); await page.keyboard.press('Enter'); };
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJiYWRnZSI6IlQxMTAifQ.T110-signature_A1';
    await scan(token);
    await page.waitForFunction(() => !!document.querySelector('#lastScanCard .last-scan-float'), { timeout: 10000 });
    const qr = state.writes.filter((w) => w.kind === 'qr');
    assert.equal(qr.length, 1); assert.equal(qr[0].token, token, 'jeton QR A1 non modifié');
    const check = () => page.evaluate(() => {
      const box = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none') return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };
      const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const float = box(document.querySelector('#lastScanCard .last-scan-float'));
      const controls = ['.mode-grid', '.pointer-search', '#postKpis', '.v6-split-btn', '#detailBack', '.tracking-toolbar', '.manual-actions'].flatMap((s) => [...document.querySelectorAll(s)].map((el) => [s, box(el)])).filter(([, b]) => b);
      return { float: !!float, floats: document.querySelectorAll('#lastScanCard .last-scan-float').length, covered: controls.filter(([, b]) => hit(b, float)).map(([s]) => s),
        inView: float ? float.right <= innerWidth && float.bottom <= innerHeight && float.left >= 0 : false, text: float ? document.querySelector('#lastScanCard .last-scan-float').innerText : '' };
    });
    const first = await check();
    assert.ok(first.float && first.inView, JSON.stringify(first));
    assert.deepEqual(first.covered, [], 'aucune commande masquée par la fenêtre flottante');
    assert.match(first.text, /TOUATI/);
    await page.screenshot({ path: path.join(ARTIFACTS, 'confirmation-flottante-1440x900.png') });
    // Mise à jour en temps réel des panneaux après le scan (arrivée de TOUATI, magasinier).
    await page.waitForFunction(() => /MAGASINIER/.test(document.getElementById('functionsList').textContent), { timeout: 10000 });
    assert.equal(await page.$eval('#postKpis [data-kpi="present"] b', (e) => e.textContent), '10');
    // Scan suivant (après le verrou existant de 1,8 s entre deux badges) : une seule fenêtre, mise à jour.
    await delay(2000);
    await scan('eyJhbGciOiJIUzI1NiJ9.eyJiYWRnZSI6IlQxMTEifQ.T111-signature_A1');
    await page.waitForFunction(() => /LARBI/.test(document.querySelector('#lastScanCard .last-scan-float')?.innerText || ''), { timeout: 10000 });
    const second = await check();
    assert.equal(second.floats, 1); assert.deepEqual(second.covered, []);
    await page.waitForFunction(() => document.querySelector('#postKpis [data-kpi="present"] b').textContent === '11', { timeout: 10000 });
    assert.match(await page.$eval('#functionsTotal', (e) => e.textContent), /11/);
    await page.browserContext().close();
  });

  assert.deepEqual(errors, [], 'aucune erreur JavaScript');
});
