// OPS — Effectif sans affectation → Affecter → Ordre de mouvement → Valider, en Chrome RÉEL par le
// vrai routeur ATLAS (serveur local isolé, base SQLite temporaire, données fictives).
// node --test --test-force-exit tests_frontend/ops-unassigned-assign-chrome.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAtlas, CHROME, puppeteer, SOCIETY, PASSWORD } = require('./helpers/atlas-chrome');

const SIZES = [[1440, 900], [1366, 768], [1280, 800], [1024, 768], [820, 1180], [768, 1024], [390, 844]];
const NAME = 'TEST OPS AFFECTATION';

test('OPS — affecter un employé sans affectation par ordre de mouvement, Chrome réel', {
  timeout: 420000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const artifacts = process.env.ATLAS_ASSIGN_ARTIFACTS || path.join(os.tmpdir(), 'atlas-ops-unassigned-assign');
  fs.mkdirSync(artifacts, { recursive: true });
  const atlas = await startAtlas(t, { port: Number(process.env.ATLAS_ASSIGN_PORT || 8979), artifacts });
  const admin = (await atlas.api('/auth/admin-system-login', { method: 'POST', body: { username: 'KPIADMIN', password: PASSWORD } })).data.access_token;
  const created = await atlas.api('/drh/employees', { method: 'POST', token: admin, body: {
    code: 'KT50', first_name: 'AFFECTATION', last_name: 'TEST OPS', society: SOCIETY, status: 'actif', position: 'CARISTE', contract_type: 'CDD' } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created));
  const employeeId = created.data.id;
  // Compte OPS sans restriction de site : un compte limité à des sites ne voit pas les non-affectés.
  const user = await atlas.api('/auth/users', { method: 'POST', token: admin, body: { username: 'OPS02', full_name: 'OPS02 LOCAL', email: 'ops02@example.com',
    role: 'ops', access_level: 'H3', authorized_modules: ['ops'], authorized_societies: [SOCIETY], authorized_sites: [],
    authorized_structures: [], authorized_actions: ['read', 'create', 'update'], global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
  assert.equal(user.status, 200, JSON.stringify(user));
  const token = (await atlas.api('/auth/login', { method: 'POST', body: { username: 'OPS02', password: PASSWORD } })).data.access_token;

  const page = await atlas.login('ops', 'OPS02', 'effectif/preparation_affectation');
  const listReady = () => page.waitForFunction(name => document.querySelector('#view h1')?.textContent.toUpperCase().includes('EFFECTIF SANS AFFECTATION')
    && [...document.querySelectorAll('#view tbody tr')].some(tr => tr.textContent.includes(name)), { timeout: 40000, polling: 200 }, NAME);
  try { await listReady(); } catch (e) {
    await page.screenshot({ path: path.join(artifacts, 'liste-attente.png') });
    throw new Error(e.message + ' — ' + JSON.stringify(await page.evaluate(() => ({ hash: location.hash, view: document.getElementById('view')?.textContent.replace(/\s+/g, ' ').slice(0, 400) }))));
  }
  const counter = () => page.evaluate(() => Number([...document.querySelectorAll('#view button.card')].find(b => /Sans Affectation/i.test(b.textContent))?.textContent.replace(/\D+/g, '')));
  const before = await counter();

  await t.test('liste : colonne Action, bouton lisible et sans débordement sur 7 tailles', async () => {
    for (const [width, height] of SIZES) {
      await page.setViewport({ width, height });
      await atlas.settled(page);
      const state = await page.evaluate(name => {
        const row = [...document.querySelectorAll('#view tbody tr')].find(tr => tr.textContent.includes(name));
        const button = row?.querySelector('[data-assign-employee]');
        const r = button?.getBoundingClientRect();
        return { headers: [...document.querySelectorAll('#view thead th')].map(th => th.textContent.trim()),
          overflow: document.documentElement.scrollWidth - window.innerWidth, label: button?.getAttribute('aria-label'),
          rect: r && { left: r.left, right: r.right, height: r.height }, cardRight: row?.closest('.card')?.getBoundingClientRect().right,
          bg: button && getComputedStyle(button).backgroundColor, text: button?.textContent.trim(),
          arrow: button && getComputedStyle(button.querySelector('.ops-btn__label'), '::after').content };
      }, NAME);
      await page.screenshot({ path: path.join(artifacts, `liste-${width}x${height}.png`) });
      assert.equal(state.headers.at(-1), 'Action', `${width} : colonne Action`);
      assert.ok(state.overflow <= 0, `${width} : débordement horizontal de ${state.overflow}px`);
      assert.equal(state.label, `Affecter ${NAME}`);
      // Cible tactile des boutons OPS sur mobile (min-height mobile existant) : 44 px au plus.
      assert.ok(state.rect.height >= 30 && state.rect.height <= (width > 600 ? 36 : 44), `${width} : hauteur ${state.rect.height}`);
      assert.ok(state.rect.right <= Math.min(width, state.cardRight) + 1, `${width} : bouton coupé (${JSON.stringify(state.rect)})`);
      assert.match(state.bg, /rgb\(22, 93, 222\)|rgb\(4, 57, 112\)/, `${width} : bleu ATLAS (${state.bg})`);
      assert.equal(state.text, 'Affecter');
      assert.equal(state.arrow, width > 600 ? '" →"' : 'none', `${width} : flèche`);
    }
  });

  let number;
  await t.test('Affecter → Ordre de mouvement prérempli → Valider OM', async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluate(name => [...document.querySelectorAll('#view tbody tr')].find(tr => tr.textContent.includes(name)).querySelector('[data-assign-employee]').click(), NAME);
    await page.waitForFunction(() => location.hash === '#/ops/mouvements' && document.querySelector('form[data-ops-initial-assignment]'), { timeout: 30000, polling: 100 });
    await atlas.delay(1500);
    const form = await page.evaluate(() => {
      const f = document.querySelector('form[data-ops-initial-assignment]');
      return { forms: document.querySelectorAll('form[data-ops-movement-form]').length,
        checked: [...f.querySelectorAll('.ops-mvt-agent-cb')].map(c => c.checked), summary: f.querySelector('[data-ops-mvt-initial]').textContent,
        focus: document.activeElement?.name, active: document.activeElement?.outerHTML.slice(0, 120), sites: [...f.querySelectorAll('[name="siteId"] option')].map(o => o.textContent.trim()).filter(x => !x.startsWith('—')),
        motif: f.querySelector('[name="mouvementMotif"]').value, number: f.querySelector('[name="ordreMouvementNumero"]').value };
    });
    await page.screenshot({ path: path.join(artifacts, 'ordre-mouvement.png'), fullPage: true });
    assert.equal(form.forms, 1);
    assert.deepEqual(form.checked, [true]);
    for (const text of [NAME, 'KT50', 'Sans affectation', SOCIETY, 'CARISTE']) assert.ok(form.summary.includes(text), text);
    assert.equal(form.focus, 'siteId', 'focus sur Nouvelle affectation : ' + form.active);
    assert.ok(form.sites.length >= 1 && form.sites.every(s => !/INTERDIT|DELTA|Autres/.test(s)), JSON.stringify(form.sites));
    assert.equal(form.motif, 'Affectation');
    for (const [width, height] of SIZES) {
      await page.setViewport({ width, height });
      await atlas.settled(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: path.join(artifacts, `ordre-${width}x${height}.png`) });
      assert.ok(overflow <= 0, `éditeur ${width} : débordement ${overflow}px`);
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.select('form[data-ops-initial-assignment] [name="siteId"]', await page.evaluate(() => [...document.querySelectorAll('form[data-ops-initial-assignment] [name="siteId"] option')].find(o => o.value)?.value));
    await page.select('form[data-ops-initial-assignment] [name="groupe"]', 'B');
    await page.select('form[data-ops-initial-assignment] [name="mouvementDuree"]', 'Définitif');
    await page.evaluate(() => { const b = document.querySelector('form[data-ops-initial-assignment] [data-om-submit]'); b.click(); b.click(); });
    await page.waitForSelector('[data-ops-initial-done]', { timeout: 30000 });
    number = await page.evaluate(() => document.querySelector('[data-ops-initial-done] .font-mono').textContent.trim());
    await page.screenshot({ path: path.join(artifacts, 'ordre-valide.png') });
    assert.match(number, /^OD\/OPS\/\d{4}\/\d{4}$/);
  });

  await t.test('serveur : un OM, une affectation active liée, employé affecté', async () => {
    const assignments = (await atlas.api(`/ops/assignments/page?employee_id=${employeeId}&page_size=100`, { token })).data.items;
    const active = assignments.filter(a => a.active === 1);
    assert.equal(active.length, 1, 'aucun doublon (double clic)');
    assert.equal(active[0].group_code, 'B');
    const movements = (await atlas.api('/ops/movements', { token })).data.filter(m => m.employee_id === employeeId);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movement_number, number);
    assert.equal(movements[0].data.assignment_id, active[0].id);
    const row = (await atlas.api('/ops/employees', { token })).data.find(e => e.id === employeeId);
    assert.equal(row.extra._legacy.affectationCourante.siteBackendId, active[0].site_id);
  });

  await t.test('historique, retour liste et compteur', async () => {
    const inHistory = await page.evaluate(n => [...document.querySelectorAll('#view .ops-dash-card tbody tr')].some(tr => tr.textContent.includes(n)), number);
    assert.ok(inHistory, 'OM dans Historique des mouvements');
    await page.evaluate(() => [...document.querySelectorAll('[data-ops-initial-done] button')].find(b => /Retour/.test(b.textContent)).click());
    await page.waitForFunction(() => document.querySelector('#view h1')?.textContent.toUpperCase().includes('EFFECTIF SANS AFFECTATION'), { timeout: 30000 });
    await atlas.delay(1500);
    const listed = await page.evaluate(name => [...document.querySelectorAll('#view tbody tr')].some(tr => tr.textContent.includes(name)), NAME);
    assert.equal(listed, false, 'employé retiré de Sans affectation');
    assert.equal(await counter(), before - 1);
    await page.screenshot({ path: path.join(artifacts, 'liste-apres.png') });
  });

  await t.test('aucune erreur JavaScript', () => {
    // Archivage du document OM dans la fiche employé (route DRH) : refusé à un compte OPS sans
    // module DRH, comme pour la validation d'OM habituelle (préexistant, non bloquant).
    const relevant = atlas.errors.filter(e => !/favicon|photo|Failed to load resource/.test(JSON.stringify(e))
      && !/Erreur API 403 http:\/\/ops\.irongs\.com\/api\/drh\/employees\/\d+ /.test(e.console || ''));
    assert.deepEqual(relevant, []);
  });
});
