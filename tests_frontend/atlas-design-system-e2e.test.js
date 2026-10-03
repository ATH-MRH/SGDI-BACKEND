// ATLAS Design System V1 — permanent browser contract, real local API and DOM.
// node --test tests_frontend/atlas-design-system-e2e.test.js
// Optional: NODE_PATH, PUPPETEER_EXECUTABLE_PATH, ATLAS_E2E_PYTHON,
// ATLAS_DS_E2E_PORT, ATLAS_DS_E2E_ARTIFACTS. No production data or browser profile.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_DS_E2E_PORT || 8964);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasVisualLocal!2026';
const SOCIETY = 'IRON GLOBAL SOLUTION';
const OTHER_SOCIETY = 'IRON GLOBAL SÉCURITÉ';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* explicit skip below */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rgb = color => (String(color).match(/[\d.]+/g) || []).map(Number);
const isLight = color => { const c = rgb(color); return c.length >= 3 && c.slice(0, 3).every(n => n >= 240) && (c.length < 4 || c[3] > .9); };
const isBlue = color => { const [r, g, b] = rgb(color); return b > r + 20 && b >= 80 && g < b + 15; };
// Sidebar V3 du shell commun : bleu marine foncé (fond peint en background-color sous le dégradé).
const isNavy = color => { const [r, g, b] = rgb(color); return r <= 30 && g <= 70 && b >= 40 && b <= 140 && b > r + 25; };

async function api(endpoint, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.text();
  let data;
  try { data = JSON.parse(content); } catch (_) { data = content; }
  return { status: response.status, data };
}
async function replaceInput(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await page.type(selector, value);
}
async function clickVisible(page, selector) {
  for (const element of await page.$$(selector)) {
    const box = await element.boundingBox();
    if (box && box.width && box.height) { await element.click(); return; }
  }
  assert.fail('no visible clickable control: ' + selector);
}
async function clickText(page, selector, text) {
  for (const element of await page.$$(selector)) {
    if ((await element.evaluate(el => el.textContent)).includes(text) && await element.boundingBox()) { await element.click(); return; }
  }
  assert.fail('missing control: ' + text);
}
async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => document.getAnimations().filter(a => a.constructor.name === 'CSSTransition').every(a => a.playState !== 'running'), { timeout: 5000 });
}

async function visualContract(page, surface, name, artifacts, measurements, sidebar = null) {
  await page.waitForSelector(`body.atlas-ui[data-atlas-surface="${surface}"]`, { timeout: 10000 });
  await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href && new URL(sheet.href).pathname === '/static/design-system/atlas.css'));
  await settled(page);
  const state = await page.evaluate(sidebarSelector => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const visible = element => { const r = element.getBoundingClientRect(), c = getComputedStyle(element); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
    const controls = [...document.querySelectorAll('button,input,select,a[href]')].filter(visible);
    const side = sidebarSelector ? document.querySelector(sidebarSelector) : null;
    const workArea = document.querySelector('.sgdi-shell-body > main');
    const active = side?.querySelector('.nav-link.active,.dn-nav-link.active,.v3-nav-link.active,.nav-btn.active,[aria-current="page"]');
    const primary = [...document.querySelectorAll('.btn-primary,.dn-btn-primary,.primary,.sgdi-login-submit,.paie-login-submit,.v3-btn-primary')].find(visible);
    const oversized = [...document.querySelectorAll('main,header,section,aside')].filter(visible).filter(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right > innerWidth + 2 && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 6).map(el => ({ tag: el.tagName, id: el.id, className: el.className, ...rect(el) }));
    return {
      viewport: innerWidth, viewportHeight:innerHeight,
      bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth,
      bodyHeight:document.body.scrollHeight, documentHeight:document.documentElement.scrollHeight,
      background: getComputedStyle(document.body).backgroundColor, controls: controls.length,
      sidebar: side ? { background: getComputedStyle(side).backgroundColor, ...rect(side) } : null,
      workArea: workArea ? rect(workArea) : null,
      active: active ? { color: getComputedStyle(active).color, background: getComputedStyle(active).backgroundColor } : null,
      // Global Shell V4 (shell commun) : header, bandeau KPI flottant, barre latérale.
      shellV4: (() => {
        const shell = document.querySelector('.sgdi-shell.atlas-shell-v4'); if (!shell) return null;
        const top = shell.querySelector(':scope > .sgdi-topbar'), bar = [...shell.querySelectorAll('.module-counters-ribbon')].find(visible), view = shell.querySelector('#view');
        const aside = shell.querySelector('.sidebar');
        return { header: top ? { background: getComputedStyle(top).backgroundColor, ...rect(top) } : null,
          kpi: bar ? { background: getComputedStyle(bar).backgroundColor, radius: parseFloat(getComputedStyle(bar).borderTopLeftRadius), shadow: getComputedStyle(bar).boxShadow,
            value: getComputedStyle(bar.querySelector('.module-counter-value')).color, viewTop: view.getBoundingClientRect().top, ...rect(bar) } : null,
          sidebarRight: aside && visible(aside) ? aside.getBoundingClientRect().right : null,
          fiche: /fiches?\s+de\s+position/i.test(aside ? aside.textContent : '') };
      })(),
      primary: primary ? { color: getComputedStyle(primary).color, background: getComputedStyle(primary).backgroundColor, backgroundImage: getComputedStyle(primary).backgroundImage, ...rect(primary) } : null,
      oversized,
    };
  }, sidebar);
  measurements.push({ name, surface, ...state });
  fs.writeFileSync(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
  await page.screenshot({ path: path.join(artifacts, `${name}-${state.viewport}.png`), fullPage: true });
  assert.ok(isLight(state.background), `${name}: body is not a light surface: ${state.background}`);
  assert.ok(state.controls > 0, `${name}: no usable control`);
  assert.ok(state.bodyWidth <= state.viewport + 2 && state.documentWidth <= state.viewport + 2,
    `${name}: global overflow ${JSON.stringify(state)}`);
  if (state.workArea) {
    assert.ok(state.workArea.width >= 280 && state.workArea.height > 0,
      `${name}: main content collapsed ${JSON.stringify(state.workArea)}`);
    assert.ok(state.documentHeight <= state.viewportHeight + 2 && state.bodyHeight <= state.viewportHeight + 2,
      `${name}: legacy shell must scroll inside its main area, not beyond the viewport: ${JSON.stringify({ document:state.documentHeight, body:state.bodyHeight, viewport:state.viewportHeight })}`);
  }
  if (state.sidebar && state.viewport >= 1024) {
    if (surface === 'legacy') assert.ok(isNavy(state.sidebar.background), `${name}: shared-shell Sidebar V3 must be navy: ${state.sidebar.background}`);
    else assert.ok(isLight(state.sidebar.background), `${name}: sidebar must be white: ${state.sidebar.background}`);
    assert.ok(state.sidebar.width >= 180 && state.sidebar.width <= 340, `${name}: sidebar width ${state.sidebar.width}`);
    assert.ok(state.sidebar.x >= -2 && state.sidebar.right < state.viewport, `${name}: sidebar outside viewport`);
    assert.ok(state.active && (isBlue(state.active.color) || isBlue(state.active.background)), `${name}: active navigation lacks blue accent`);
  }
  if (surface === 'legacy') {
    const v4 = state.shellV4;
    assert.ok(v4, `${name}: shared shell must be Global Shell V4`);
    assert.ok(isLight(v4.header.background), `${name}: header must be white: ${v4.header.background}`);
    assert.equal(v4.fiche, false, `${name}: « Fiche de position » must not be a sidebar entry`);
    if (v4.kpi) {
      assert.ok(isNavy(v4.kpi.background) || isBlue(v4.kpi.background), `${name}: KPI bar must be navy: ${v4.kpi.background}`);
      assert.ok(v4.kpi.radius >= 10 && v4.kpi.radius <= 16 && v4.kpi.shadow !== 'none', `${name}: KPI bar is a rounded floating card ${JSON.stringify(v4.kpi)}`);
      assert.ok(isLight(v4.kpi.value) || rgb(v4.kpi.value).slice(0, 3).every(n => n >= 190), `${name}: KPI value must be light on navy: ${v4.kpi.value}`);
      // Flottant : espace visible avec le header, le contenu, le bord droit et la barre latérale.
      assert.ok(v4.kpi.y - v4.header.bottom >= 6, `${name}: KPI bar touches the header`);
      assert.ok(v4.kpi.viewTop - v4.kpi.bottom >= 6, `${name}: KPI bar touches the content`);
      assert.ok(state.viewport - v4.kpi.right >= 6 && v4.kpi.x >= 6, `${name}: KPI bar touches the screen edge`);
      if (v4.sidebarRight !== null && state.viewport >= 768) assert.ok(v4.kpi.x - v4.sidebarRight >= 6, `${name}: KPI bar touches the sidebar`);
    }
  }
  if (state.primary) {
    assert.ok(isBlue(state.primary.background) || (isLight(state.primary.background) && isBlue(state.primary.color)), `${name}: primary action lacks blue accent ${JSON.stringify(state.primary)}`);
    assert.ok(state.primary.width > 24 && state.primary.height >= 28, `${name}: primary action too small`);
  }
}

async function mobileNavigation(page, { sidebar, toggle, active }) {
  await page.setViewport({ width: 390, height: 900 });
  await settled(page);
  const isVisible = () => page.$eval(sidebar, element => {
    const r = element.getBoundingClientRect(), c = getComputedStyle(element);
    return r.width > 0 && r.right > 10 && r.x < innerWidth && c.visibility !== 'hidden' && c.display !== 'none';
  });
  assert.equal(await isVisible(), false, 'mobile sidebar must begin closed');
  await clickVisible(page, toggle);
  await settled(page);
  assert.equal(await isVisible(), true, 'real menu handler must reveal mobile navigation');
  const geometry = await page.$eval(sidebar, element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; });
  assert.ok(geometry.x >= -2 && geometry.right <= 392 && geometry.width >= 180, JSON.stringify(geometry));
  await clickVisible(page, active);
  await page.waitForFunction(selector => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const r = element.getBoundingClientRect(), c = getComputedStyle(element);
    return r.width === 0 || r.right <= 10 || r.x >= innerWidth || c.visibility === 'hidden' || c.display === 'none';
  }, { timeout: 5000 }, sidebar);
  await settled(page);
  assert.equal(await isVisible(), false, 'selecting a real navigation item must close mobile navigation');
}

function contrastRatio(foreground, background) {
  const luminance = color => rgb(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126,.7152,.0722][i], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}
async function workspaceToolsContract(page, name, artifacts) {
  await clickVisible(page, '.atlas-workspace-tools > summary');
  await page.waitForSelector('.atlas-workspace-tools[open]');
  await settled(page);
  const state = await page.evaluate(() => {
    const panel = document.querySelector('.atlas-workspace-tools[open] .ws-browser-chrome');
    const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom }; };
    const box = bounds(panel);
    const buttons = [...panel.querySelectorAll('button')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ label:el.textContent.trim() || el.title, ...bounds(el) }));
    const lock = panel.querySelector('.ws-lock-toggle');
    const header = document.querySelector('.sgdi-topbar');
    const title = header.querySelector('.atlas-account-name,.admin-users-global-context,.atlas-context');
    return { box, buttons, viewport:{ width:innerWidth, height:innerHeight }, documentHeight:document.documentElement.scrollHeight, bodyHeight:document.body.scrollHeight, lock:lock ? { color:getComputedStyle(lock).color, background:getComputedStyle(lock).backgroundColor } : null,
      header: { color:getComputedStyle(title).color, background:getComputedStyle(header).backgroundColor } };
  });
  await page.screenshot({ path:path.join(artifacts, `${name}-tools-${page.viewport().width}.png`), fullPage:true });
  fs.writeFileSync(path.join(artifacts, `${name}-tools-${page.viewport().width}.json`), JSON.stringify(state,null,2));
  assert.ok(state.box.left >= 0 && state.box.top >= 0 && state.box.right <= state.viewport.width && state.box.bottom <= state.viewport.height,
    'tools popover is outside the viewport: ' + JSON.stringify({ box:state.box, viewport:state.viewport }));
  assert.ok(state.documentHeight <= state.viewport.height + 2 && state.bodyHeight <= state.viewport.height + 2,
    'open tools must not create global vertical overflow: ' + JSON.stringify({ document:state.documentHeight, body:state.bodyHeight, viewport:state.viewport.height }));
  assert.ok(state.buttons.length > 0, 'tools popover contains controls');
  for (const button of state.buttons) assert.ok(button.left >= state.box.left - 2 && button.top >= state.box.top - 2 && button.right <= state.box.right + 2 && button.bottom <= state.box.bottom + 2,
    'tool button escapes its popover: ' + JSON.stringify({ box:state.box, button }));
  if (state.lock) assert.ok(contrastRatio(state.lock.color,state.lock.background) >= 4.5, 'lock action has insufficient text contrast: ' + JSON.stringify(state.lock));
  assert.ok(contrastRatio(state.header.color,state.header.background) >= 4.5, 'header text has insufficient contrast: ' + JSON.stringify(state.header));
  await clickVisible(page, '.atlas-workspace-tools > summary');
  await page.waitForSelector('.atlas-workspace-tools[open]', { hidden:true });
}

async function standardLogin(page, url, username, { form = '#login-form', ready = '.shell', submit } = {}) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector(form, { visible: true });
  await page.type(`${form} [name="username"]`, username);
  await page.type(`${form} [name="password"]`, PASSWORD);
  await page.click(submit || `${form} button[type="submit"]`);
  await page.waitForSelector(ready, { visible: true, timeout: 20000 });
}

const hosts = ['drh','ops','dc','materiel','pointage','pointeur','fr','rh','fac','dsdesign'];

test('ATLAS white/blue design system — real browser, isolated API', {
  timeout: 300000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-design-system-e2e-'));
  const artifacts = process.env.ATLAS_DS_E2E_ARTIFACTS || path.join(os.tmpdir(), 'atlas-design-system-e2e-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-ds-e2e-local-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'DSADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', CONVOCATION_SMTP_PASSWORD: '', BIOMETRIC_ENABLED: 'false' });
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  let server, browser, adminToken, fixture;
  const measurements = [], pages = [], requests = [], errors = [];
  const accounts = {};
  t.after(async () => {
    fs.writeFileSync(path.join(artifacts, 'requests.json'), JSON.stringify(requests, null, 2));
    fs.writeFileSync(path.join(artifacts, 'page-errors.json'), JSON.stringify(errors, null, 2));
    for (const [index, page] of pages.entries()) {
      if (!page.isClosed()) await page.screenshot({ path: path.join(artifacts, `last-page-${index}.png`), fullPage: true }).catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) {
      server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]);
      if (server.exitCode === null) { server.kill('SIGKILL'); await Promise.race([once(server, 'exit'), delay(2000)]); }
    }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  async function newPage() {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    pages.push(page);
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), host: url.host, path: url.pathname }); });
    return page;
  }
  async function captureWidths(page, surface, name, sidebar) {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 900 });
      await visualContract(page, surface, name, artifacts, measurements, sidebar);
    }
  }

  await t.test('local server, synthetic fixtures and specialized users created through API', async () => {
    assert.ok(Number.isInteger(PORT) && PORT > 1024 && PORT < 65536);
    assert.ok(fs.existsSync(path.join(ROOT, 'app/static/design-system/atlas.css')), 'canonical design system must be installed');
    server = spawn(PYTHON, ['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(PORT)], { cwd: tmp, env, stdio: ['ignore',output,output] });
    let login;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(server.exitCode, null, 'local server exited: see server.log');
      try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'DSADMIN', password: PASSWORD } }); if (login.status === 200) break; } catch (_) {}
      await delay(200);
    }
    assert.equal(login?.status, 200, JSON.stringify(login));
    adminToken = login.data.access_token;
    const seed = `
import json
import app.main
from datetime import date,timedelta
from app.db.session import SessionLocal
from app.modules.ops.models import Site,Assignment
from app.modules.drh.models import Employee
from app.modules.commercial.models import Client
from app.modules.materiel.models import StockArticle
s=SessionLocal()
a,b=${JSON.stringify(SOCIETY)},${JSON.stringify(OTHER_SOCIETY)}
sites=[Site(name='SITE DS LOCAL',active=1,equipment_plan={'societe':a,'dateOuverture':'2020-01-01'}),Site(name='SITE DS INTERDIT',active=1,equipment_plan={'societe':b,'dateOuverture':'2020-01-01'})]
s.add_all(sites);s.flush()
employees=[Employee(code='DS01',first_name='Amine',last_name='VISUEL DS',society=a,status='actif',position='Agent',recruit_date=date(2025,1,1)),Employee(code='DS02',first_name='Bilal',last_name='VISUEL DS',society=a,status='actif',position='Agent'),Employee(code='DS99',first_name='Hors',last_name='INTERDIT DS',society=b,status='actif',position='Agent')]
s.add_all(employees);s.flush()
for i,employee in enumerate(employees):s.add(Assignment(employee_id=employee.id,site_id=sites[1 if i==2 else 0].id,start_date=date.today()-timedelta(days=30),active=1,group_code='A'))
s.add(Client(name='CLIENT DS LOCAL',society=a,status='actif',portal_slug='dsdesign',portal_enabled=True))
s.add(StockArticle(code='DS-MAT-01',designation='CASQUE DS LOCAL',society=a,quantity=12,unit_price=150,active=1))
s.commit()
print(json.dumps({'site':sites[0].id,'otherSite':sites[1].id,'employee':employees[0].id,'otherEmployee':employees[2].id}))
s.close()
`;
    fixture = JSON.parse(execFileSync(PYTHON, ['-c',seed], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
    for (const [username, role, modules, sites] of [
      ['DRH01','drh',['drh'],[]], ['OPS01','ops',['ops'],[fixture.site]], ['COM01','commercial',['dc'],[]],
      ['MAT01','materiel',['materiel'],[]], ['FIN01','finances',['finances'],[]],
      ['CE01','charge_effectifs_site',['site_workforce'],[fixture.site]], ['PTG01','pointage',['pointage','pointeur'],[fixture.site]],
    ]) {
      const created = await api('/auth/users', { method: 'POST', token: adminToken, body: { username, full_name: `${username} LOCAL DS`, email: `${username.toLowerCase()}@example.com`,
        role, access_level: 'H3', authorized_modules: modules, authorized_societies: [SOCIETY], authorized_sites: sites,
        authorized_structures: [], authorized_actions: ['read','create','update'], global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
      assert.equal(created.status, 200, JSON.stringify(created));
      const authenticated = await api('/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
      assert.equal(authenticated.status, 200, JSON.stringify(authenticated));
      accounts[username] = authenticated.data.access_token;
    }
    const obligation = await api('/finance-core/obligations', { method: 'POST', token: adminToken, body: { society: SOCIETY, direction: 'receivable', source_type: 'manual', source_id: 'DS-LOCAL-1', amount_total: '1200.00', counterparty_name: 'CLIENT DS LOCAL', idempotency_key: 'ds-local:1' } });
    assert.ok([200,201].includes(obligation.status), JSON.stringify(obligation));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp,'chrome'),
      args: ['--no-first-run','--no-default-browser-check','--disable-background-networking', `--host-resolver-rules=${hosts.map(host => `MAP ${host}.irongs.com 127.0.0.1:${PORT}`).join(', ')}`] });
  });

  await t.test('admin: navy Sidebar V3, filters, real mobile navigation, read-only drawer', async () => {
    const page = await newPage();
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.login-admin-system-shortcut');
    await page.click('.login-admin-system-shortcut');
    await replaceInput(page, '#modal-host input[name="username"]', 'DSADMIN');
    await page.type('#modal-host input[name="password"]', PASSWORD);
    await clickText(page, '#modal-host button', 'Valider');
    await page.waitForSelector('#sidebar-nav [data-route="admin/users"]');
    await page.click('#sidebar-nav [data-route="admin/users"]');
    await page.waitForSelector('.admin-users-page');
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-user-row]').length === 8);
    await workspaceToolsContract(page, 'admin-users', artifacts);
    await captureWidths(page, 'legacy', 'admin-users', '.sidebar');
    await workspaceToolsContract(page, 'admin-users', artifacts);
    await mobileNavigation(page, { sidebar: '.sidebar', toggle: '.sgdi-sidebar-toggle', active: '#sidebar-nav .nav-link.active' });
    await replaceInput(page, '#admin-user-search', 'OPS01');
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-user-row]').length === 1);
    await page.click('.admin-user-actions [aria-label^="Voir "]');
    await page.waitForSelector('.admin-user-readonly');
    assert.match(await page.$eval('.admin-user-readonly', el => el.textContent), /OPS01/);
    await clickText(page, '#modal-host button', 'Fermer');
    await page.waitForSelector('.admin-user-readonly', { hidden: true });
    await page.close();
  });

  for (const config of [
    { host: 'drh', user: 'DRH01', route: 'effectif/recap', marker: 'VISUEL DS', name: 'legacy-drh' },
    { host: 'ops', user: 'OPS01', route: 'effectif/actifs', marker: 'VISUEL DS', name: 'legacy-ops' },
    { host: 'dc', user: 'COM01', route: 'commercial/clients', marker: 'CLIENT DS LOCAL', name: 'legacy-commercial' },
    { host: 'materiel', user: 'MAT01', route: 'materiel/articles', marker: 'CASQUE DS LOCAL', name: 'legacy-materiel' },
  ]) await t.test(`${config.name}: real fixture, layout, search and navigation`, async () => {
    const page = await newPage();
    await standardLogin(page, `http://${config.host}.irongs.com/#/login`, config.user, { ready: '.module-host-soc-card', submit: '.sgdi-login-submit' });
    await clickText(page, '.module-host-soc-card', SOCIETY);
    await page.goto(`http://${config.host}.irongs.com/#/${config.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(marker => document.querySelector('#view')?.textContent.toUpperCase().includes(marker), { timeout: 20000 }, config.marker);
    await captureWidths(page, 'legacy', config.name, '.sidebar');
    await mobileNavigation(page, { sidebar: '.sidebar', toggle: '.sgdi-sidebar-toggle', active: '#sidebar-nav .nav-link.active' });
    if (config.host === 'ops' || config.host === 'drh') {
      const search = '.effectif-page input[placeholder="Recherche nom / prénom / code"]';
      await replaceInput(page, search, 'DS01');
      await page.waitForFunction(() => [...document.querySelectorAll('.effectif-table tbody tr')].filter(row => row.getBoundingClientRect().height > 0).length === 1, { timeout:10000 }).catch(async () => {
        const rows = await page.$$eval('.effectif-table tbody tr', elements => elements.map(row => ({ text:row.textContent.trim(), inlineDisplay:row.style.display, computedDisplay:getComputedStyle(row).display, height:row.getBoundingClientRect().height })));
        assert.fail(`${config.name}: mobile search must show exactly one employee: ${JSON.stringify(rows)}`);
      });
      assert.match(await page.$eval('.effectif-table', el => el.textContent), /DS01/);
      assert.doesNotMatch(await page.$eval('.effectif-table', el => el.textContent), /INTERDIT DS/);
    }
    await page.close();
  });

  await t.test('OPS Command Center V2: contenu réel et responsive 1440 / 1024 / 768 / 390', async () => {
    const page = await newPage();
    await standardLogin(page, 'http://ops.irongs.com/#/login', 'OPS01', { ready: '.module-host-soc-card', submit: '.sgdi-login-submit' });
    await clickText(page, '.module-host-soc-card', SOCIETY);
    await page.goto('http://ops.irongs.com/#/ops/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ops-command-center-v2"]', { visible: true, timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.ops-cc-sites')?.textContent.includes('SITE DS LOCAL'));
    const content = await page.$eval('[data-testid="ops-command-center-v2"]', el => el.textContent);
    assert.match(content, /Situation opérationnelle/);
    assert.match(content, /SITE DS LOCAL/);
    assert.doesNotMatch(content, /SITE DS INTERDIT/);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewport({ width, height: 900 });
      await visualContract(page, 'legacy', 'ops-command-center-v2', artifacts, measurements, '.sidebar');
    }
    await mobileNavigation(page, { sidebar: '.sidebar', toggle: '.sgdi-sidebar-toggle', active: '#sidebar-nav .nav-link.active' });
    await page.close();
  });

  for (const config of [
    { surface: 'finance', path: '/finance-platform', user: 'FIN01', nav: 'creances', marker: '#obl-list' },
    { surface: 'beo', path: '/site-workforce', user: 'CE01', nav: 'personnel', marker: '#pers-list' },
  ]) await t.test(`${config.surface}: native shell, responsive sidebar and real navigation`, async () => {
    const page = await newPage();
    await standardLogin(page, BASE + config.path, config.user);
    await page.click(`[data-nav="${config.nav}"]`);
    await page.waitForSelector(config.marker);
    await page.waitForFunction(selector => document.querySelector(selector) && !document.querySelector(selector).querySelector('.skeleton'), {}, config.marker);
    await captureWidths(page, config.surface, config.surface, '.shell-sidebar');
    await mobileNavigation(page, { sidebar: '.shell-sidebar', toggle: '[data-toggle-sidebar]', active: '.shell-sidebar .nav-link.active' });
    if (config.surface === 'beo') {
      const content = await page.$eval('#pers-list', el => el.textContent);
      assert.match(content, /VISUEL DS/); assert.doesNotMatch(content, /INTERDIT DS/);
    }
    await page.close();
  });

  await t.test('DRH Next: native sidebar and employees', async () => {
    const page = await newPage();
    await standardLogin(page, BASE + '/drh-next', 'DRH01', { form: '#dn-login-form', ready: '#dn-nav' });
    await page.click('#dn-nav [data-route="employees"]');
    await page.waitForSelector('#dn-emp-search');
    await page.waitForFunction(() => document.querySelector('#dn-view')?.textContent.includes('VISUEL DS'));
    await captureWidths(page, 'drh-next', 'drh-next', '.dn-sidebar');
    await mobileNavigation(page, { sidebar: '.dn-sidebar', toggle: '#dn-sidebar-toggle', active: '.dn-nav-link.active' });
    await page.close();
  });

  await t.test('Pointage: real control center filters and terminal navigation', async () => {
    const page = await newPage();
    await standardLogin(page, 'http://pointage.irongs.com/', 'PTG01', { ready: '#app:not(.hidden)' });
    await page.waitForFunction(() => document.querySelector('#board-rows')?.textContent.includes('VISUEL DS'));
    await captureWidths(page, 'pointage', 'pointage', '.side');
    await replaceInput(page, '#f-q', 'DS01');
    await page.waitForFunction(() => document.querySelectorAll('#board-rows tr').length === 1);
    assert.match(await page.$eval('#board-rows', el => el.textContent), /DS01/);
    await page.click('[data-view="anomalies"]');
    await page.waitForSelector('#view-anomalies:not(.hidden)');
    await page.click('[data-view="board"]');
    const terminal = await newPage();
    await terminal.goto(BASE + '/pointeur', { waitUntil: 'domcontentloaded' });
    await terminal.waitForSelector('#username');
    await terminal.type('#username', 'PTG01'); await terminal.type('#password', PASSWORD); await terminal.click('#loginBtn');
    await terminal.waitForSelector('#appView:not(.hidden)', { timeout: 15000 });
    await terminal.waitForFunction(() => document.querySelector('#siteSelector')?.options.length > 0);
    await captureWidths(terminal, 'pointeur', 'pointeur');
    await terminal.click('#planningNav');
    await terminal.waitForSelector('#planningView:not(.hidden)');
    await visualContract(terminal, 'pointeur', 'pointeur-planning', artifacts, measurements);
    await terminal.click('#scanNav');
    await terminal.waitForSelector('#planningView', { hidden: true });
    await terminal.close();
    await page.close();
  });

  for (const [surface, url] of [
      ['client','http://dsdesign.irongs.com/'], ['employee',BASE+'/portail-rh'], ['candidate','http://fr.irongs.com/'],
      ['recruitment',BASE+'/recrute'], ['rh','http://rh.irongs.com/'], ['commercial',BASE+'/static/commercial.html'],
      ['loans',BASE+'/prets'], ['supervision',BASE+'/supervision'], ['cheque',BASE+'/cheque'], ['paie',BASE+'/paie'],
      ['facturation','http://fac.irongs.com/'], ['conges',BASE+'/conges-app'], ['core-v3',BASE+'/atlas-v3'],
    ]) await t.test(`${surface}: public entry uses the shared stylesheet and usable mobile layout`, async () => {
      const page = await newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => [...document.querySelectorAll('button,input,a[href]')].some(el => el.getBoundingClientRect().width > 0));
      await captureWidths(page, surface, `entry-${surface}`);
      await page.close();
  });

  await t.test('read scopes and data unchanged by appearance/navigation', async () => {
    const employees = await api('/ops/employees/page?mode=all', { token: accounts.OPS01 });
    assert.equal(employees.status, 200);
    assert.equal(employees.data.total, 2);
    assert.ok(employees.data.items.every(row => row.society === SOCIETY));
    assert.equal((await api(`/ops/employees/${fixture.otherEmployee}/photo`, { token: accounts.OPS01 })).status, 404);
    assert.equal((await api('/auth/users', { token: accounts.OPS01 })).status, 403);
    assert.equal((await api('/site-workforce/employees?site_id=' + fixture.otherSite, { token: accounts.CE01 })).status, 403);
    const users = await api('/auth/users', { token: adminToken });
    assert.equal(users.data.length, 8);
    const mutations = requests.filter(request => !['GET','HEAD','OPTIONS'].includes(request.method) && !/\/auth\/|\/irongs\/events\/ticket$/.test(request.path));
    assert.deepEqual(mutations, [], 'visual checks must not create business mutations');
    assert.deepEqual(errors, [], 'no uncaught browser error');
  });
});
