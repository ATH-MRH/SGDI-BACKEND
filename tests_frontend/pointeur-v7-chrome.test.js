// V7 : vraie page et vrais styles dans Chrome, API/données fictives, huit tailles et actions réelles.
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
const ARTIFACTS = process.env.ATLAS_V7_ARTIFACTS || path.join(os.tmpdir(), 'atlas-pointeur-v7');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
test('Pointeur V7 — tableau de bord opérationnel, Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome introuvable' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
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

  await t.test('V7 — référence, huit résolutions sans chevauchement', async () => {
    for (const [width,height,touch] of [[1920,1080],[1600,900],[1440,900],[1280,900],[1024,768],[820,1180,true],[430,932,true],[390,844,true]]) {
      const page=await open({width,height,touch});
      const metrics=await page.evaluate(()=>{
        const selectors=['#postKpis','#scannerCard','#movementsCard','#presentNowCard','#eventsCard'];
        const boxes=selectors.map(s=>({s,r:document.querySelector(s).getBoundingClientRect().toJSON()}));
        const overlap=[];
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {const a=boxes[i].r,b=boxes[j].r;if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)overlap.push([boxes[i].s,boxes[j].s])}
        return {overlap,overflow:document.documentElement.scrollWidth-innerWidth,kpis:document.querySelectorAll('#postKpis button').length,total:document.getElementById('v7Present').textContent};
      });
      assert.deepEqual(metrics.overlap,[],String(width));assert.ok(metrics.overflow<=0,`${width}: ${metrics.overflow}`);
      assert.equal(metrics.kpis,5);assert.equal(metrics.total,'9');
      await page.screenshot({path:path.join(ARTIFACTS,`pointeur-v7-${width}.png`),fullPage:true});
      await page.close();
    }
  });
  await t.test('ABANDON POSTE : fenêtre de confirmation dans l’écran, motif obligatoire, ANNULER puis CONFIRMER', async () => {
    for (const [width, height, touch, id] of [[1366, 768, false, 102], [390, 844, true, 103]]) {
      const page = await open({ width, height, touch });
      const label = `${width}×${height}`;
      await page.evaluate((emp) => { toggleManualPanel(); manualResults = [emp]; selectManualResult(0); },
        { id, matricule: 'T' + id, nom: id === 102 ? 'BENALI' : 'SAÏDI', prenom: id === 102 ? 'Karim' : 'Nour', poste: 'Cariste', societe: fx.SOCIETY, site: 'SITE TEST NORD' });
      await page.waitForSelector('#manualCardStep:not(.hidden)');
      await page.click('#manualAbandonBtn');
      await page.waitForSelector('#abandonOverlay:not(.hidden)');
      const m = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, h: b.height }; };
        return { modal: r(document.querySelector('.abandon-modal')), actions: [...document.querySelectorAll('.abandon-modal-actions button')].map(r),
          facts: [...document.querySelectorAll('#abandonFacts dt')].map((dt) => dt.textContent + '=' + dt.nextElementSibling.textContent),
          motif: document.getElementById('abandonObservation').value, disabled: document.getElementById('abandonConfirm').disabled,
          focus: document.activeElement.id, hScroll: document.documentElement.scrollWidth - innerWidth };
      });
      assert.ok(m.modal.x >= 0 && m.modal.r <= width && m.modal.y >= 0 && m.modal.b <= height, `${label} : fenêtre dans l'écran ${JSON.stringify(m.modal)}`);
      assert.ok(m.actions.length === 2 && m.actions.every((a) => a.h >= 40 && a.x >= m.modal.x && a.r <= m.modal.r), `${label} : ANNULER / CONFIRMER ${JSON.stringify(m.actions)}`);
      assert.ok(m.facts.includes(`Matricule=T${id}`) && m.facts.includes('Site=SITE TEST NORD') && m.facts.includes('Heure de départ=10:15') && m.facts.includes('Fin prévue de la vacation=14:00'), JSON.stringify(m.facts));
      assert.equal(m.motif, ''); assert.equal(m.disabled, true); assert.equal(m.focus, 'abandonObservation'); assert.ok(m.hScroll <= 0);
      await page.screenshot({ path: path.join(ARTIFACTS, `abandon-confirmation-${width}x${height}.png`) });
      await page.click('#abandonCancel');
      assert.equal(await page.$eval('#abandonOverlay', (e) => e.classList.contains('hidden')), true);
      assert.equal(state.writes.filter((w) => w.kind === 'abandon' && w.employee_id === id).length, 0, 'ANNULER : aucune écriture');
      await page.click('#manualAbandonBtn'); await page.waitForSelector('#abandonOverlay:not(.hidden)');
      await page.type('#abandonObservation', 'Quitte le site sans relève');
      await page.click('#abandonConfirm');
      await page.waitForFunction(() => /ABANDON DE POSTE ENREGISTRÉ/.test(document.getElementById('manualFeedback').textContent), { timeout: 10000 });
      const writes = state.writes.filter((w) => w.kind === 'abandon' && w.employee_id === id);
      assert.equal(writes.length, 1); assert.equal(writes[0].observation, 'Quitte le site sans relève');
      await page.waitForFunction((n) => !document.getElementById('presentNowList').textContent.includes(n), { timeout: 10000 }, id === 102 ? 'BENALI' : 'SAÏDI');
      await page.browserContext().close();
    }
  });

  await t.test('douchette : jeton transmis tel quel ; fenêtre flottante sans masquer les commandes ; scans successifs', async () => {
    const page = await open({ width: 1440, height: 900 });
    const scan = async (token) => { await page.focus('#wedgeInput'); await page.keyboard.type(token, { delay: 1 }); await page.keyboard.press('Enter'); };
    const presentBefore = Number(await page.$eval('#postKpis [data-kpi="present"] b', (e) => e.textContent));
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJiYWRnZSI6IlQxMTAifQ.T110-signature_A1';
    await scan(token);
    await page.waitForFunction(() => !!document.querySelector('#lastScanCard .last-scan-float'), { timeout: 10000 });
    const qr = state.writes.filter((w) => w.kind === 'qr');
    assert.equal(qr.length, 1); assert.equal(qr[0].token, token, 'jeton QR A1 non modifié');
    const check = () => page.evaluate(() => {
      const box = (el) => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none') return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };
      const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const float = box(document.querySelector('#lastScanCard .last-scan-float'));
      const controls = ['.mode-grid', '.pointer-search', '#postKpis', '#detailBack', '.tracking-toolbar', '.manual-actions'].flatMap((s) => [...document.querySelectorAll(s)].map((el) => [s, box(el)])).filter(([, b]) => b);
      return { float: !!float, floats: document.querySelectorAll('#lastScanCard .last-scan-float').length, covered: controls.filter(([, b]) => hit(b, float)).map(([s]) => s),
        inView: float ? float.right <= innerWidth && float.bottom <= innerHeight && float.left >= 0 : false, text: float ? document.querySelector('#lastScanCard .last-scan-float').innerText : '' };
    });
    const first = await check();
    assert.ok(first.float && first.inView, JSON.stringify(first));
    assert.deepEqual(first.covered, [], 'aucune commande masquée par la fenêtre flottante');
    assert.match(first.text, /TOUATI/);
    await page.screenshot({ path: path.join(ARTIFACTS, 'pointeur-v7-confirmation-1440.png') });
    // Mise à jour en temps réel des panneaux après le scan (arrivée de TOUATI, magasinier).
    await page.waitForFunction(() => /MAGASINIER/.test(document.getElementById('functionsList').textContent), { timeout: 10000 });
    assert.equal(await page.$eval('#postKpis [data-kpi="present"] b', (e) => e.textContent), String(presentBefore + 1));
    // Scan suivant (après le verrou existant de 1,8 s entre deux badges) : une seule fenêtre, mise à jour.
    await page.waitForFunction(() => scanBusy === false, { timeout: 10000 });
    await scan('eyJhbGciOiJIUzI1NiJ9.eyJiYWRnZSI6IlQxMTEifQ.T111-signature_A1');
    await page.waitForFunction(() => /LARBI/.test(document.querySelector('#lastScanCard .last-scan-float')?.innerText || ''), { timeout: 10000 });
    const second = await check();
    assert.equal(second.floats, 1); assert.deepEqual(second.covered, []);
    await page.waitForFunction((n) => document.querySelector('#postKpis [data-kpi="present"] b').textContent === String(n), { timeout: 10000 }, presentBefore + 2);
    assert.match(await page.$eval('#functionsTotal', (e) => e.textContent), new RegExp(`TOTAL EN POSTE\\s*${presentBefore + 2}\\s*100`));
    await page.browserContext().close();
  });


  assert.deepEqual(errors,[]);
});
