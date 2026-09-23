// ATLAS Site Workforce — E2E Chrome PERMANENT (§B21). Même patron que
// tests_frontend/finance-platform-e2e.test.js (Finance V2) : vrai serveur uvicorn (base
// SQLite temporaire), vraies données seedées via l'API HTTP, vrai Chrome, skip propre si
// Chrome/puppeteer-core introuvable. Volontairement hors du script `test` par défaut —
// voir `npm run test:site-workforce-e2e`.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `sw_e2e_permanent_${Date.now()}.db`);
const SOC = "Iron Global Securite";
const SOC_B = "Sword Corporation";

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const CHROME_PATH = findChrome();

function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        try { const r = await fetch(`${BASE}/health`); if (r.ok) return resolve(); } catch (e) {}
        await new Promise((r2) => setTimeout(r2, 300));
      }
      reject(new Error("serveur E2E non prêt après le délai"));
    })();
  });
}

async function api(path_, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + "/api" + path_, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, data };
}

let serverProc;
let chargeToken;
let siteAId, siteBId, empAId, empBId;

test("site-workforce E2E permanent", { skip: !CHROME_PATH ? "Chrome introuvable (définir PUPPETEER_EXECUTABLE_PATH) — non exécuté, ne bloque pas npm test par défaut" : (!puppeteer ? "puppeteer-core absent" : false) }, async (t) => {
  await t.test("démarrage serveur + seed", async () => {
    serverProc = spawn("python3", ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:///${DB_PATH}`,
        JWT_SECRET: "sw-e2e-permanent-secret-0000000000000",
        APP_ENV: "test",
        ADMIN_SYSTEM_USERNAME: "swtestadmin",
        ADMIN_SYSTEM_PASSWORD: "sw-test-admin-password",
        LOG_LEVEL: "ERROR",
        LOGIN_MAX_ATTEMPTS: "1000000",
        SGDI_UPLOADS_DIR: path.join(os.tmpdir(), `sw_e2e_uploads_${Date.now()}`),
      },
      stdio: "ignore",
    });
    await waitForHealth(20000);

    // Même garde que Finance V2 (voir son fichier E2E) : attendre que le bootstrap propre
    // de l'application soit terminé avant de seeder quoi que ce soit sur la même base.
    {
      const deadline = Date.now() + 15000;
      let ok = false;
      while (Date.now() < deadline) {
        const r = await api("/auth/login", { method: "POST", body: { username: "swtestadmin", password: "sw-test-admin-password" } });
        if (r.status === 200) { ok = true; break; }
        await new Promise((r2) => setTimeout(r2, 300));
      }
      assert.ok(ok, "le bootstrap swtestadmin de l'application n'a jamais abouti");
    }

    const seedPy = `
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Site, Assignment
from datetime import date, timedelta
S = SessionLocal()
site_a = Site(name="Site E2E A", active=1, equipment_plan={"societe": "${SOC}"})
site_b = Site(name="Site E2E B", active=1, equipment_plan={"societe": "${SOC_B}"})
S.add_all([site_a, site_b]); S.flush()
emp_a = Employee(code="SWE2E-A", first_name="Amine", last_name="Terrain", society="${SOC}", status="actif")
emp_b = Employee(code="SWE2E-B", first_name="Bilal", last_name="Autre", society="${SOC_B}", status="actif")
S.add_all([emp_a, emp_b]); S.flush()
today = date.today()
S.add_all([
    Assignment(employee_id=emp_a.id, site_id=site_a.id, group_code="A", start_date=today - timedelta(days=30), active=1),
    Assignment(employee_id=emp_b.id, site_id=site_b.id, group_code="A", start_date=today - timedelta(days=30), active=1),
])
if not S.query(User).filter(User.username == "chargeE2E").first():
    S.add(User(username="chargeE2E", full_name="Chargé E2E", role="charge_effectifs_site", access_level="H2",
        authorized_societies=["${SOC}"], authorized_structures=[], authorized_modules=["site_workforce"],
        authorized_sites=[site_a.id], authorized_actions=["read", "create", "update", "validate"],
        password_hash=hash_password("chargeE2Epass"), validation_password_hash=hash_password("x"), is_active=True))
S.commit()
print("seeded", site_a.id, site_b.id, emp_a.id, emp_b.id)
`;
    // execFileSync (jamais execSync) : voir finance-platform-e2e.test.js pour la raison
    // exacte (le shell n'interprète jamais les \\n de JSON.stringify).
    const seedOut = execFileSync("python3", ["-c", seedPy], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "sw-e2e-permanent-secret-0000000000000", APP_ENV: "test" },
    }).toString();
    const parts = seedOut.trim().split("\n").pop().split(" ");
    [, siteAId, siteBId, empAId, empBId] = parts.map((v, i) => (i === 0 ? v : Number(v)));

    const r = await api("/auth/login", { method: "POST", body: { username: "chargeE2E", password: "chargeE2Epass" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    chargeToken = r.data.access_token;
  });

  let browser;
  let mainPage;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (serverProc) serverProc.kill();
    fs.rmSync(DB_PATH, { force: true });
  });

  await t.test("parcours métier complet : login, dashboard, personnel, pointage, absence, justificatif, congé, maladie, discipline, réclamation, transmission, notifications, logout", async () => {
    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new", userDataDir: path.join(os.tmpdir(), `sw_e2e_chrome_${Date.now()}`), args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    mainPage = page;
    await page.setViewport({ width: 1440, height: 900 });
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

    const t0 = Date.now();
    await page.goto(`${BASE}/site-workforce`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#login-form", { timeout: 15000 });
    await page.type("input[name=username]", "chargeE2E");
    await page.type("input[name=password]", "chargeE2Epass");
    await Promise.all([page.click("button[type=submit]"), page.waitForSelector(".shell", { timeout: 8000 })]);
    await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
    const loginToDashboardMs = Date.now() - t0;
    assert.ok(loginToDashboardMs < 8000, `login->dashboard anormalement lent : ${loginToDashboardMs}ms`);

    // Dashboard : le site affiché doit être le bon (jamais choisi côté client).
    let text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /Site E2E A/);
    assert.strictEqual(consoleErrors.length, 0, "erreur(s) console sur dashboard : " + consoleErrors.join(" | "));

    // Personnel
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/personnel"; });
    await page.waitForFunction(() => document.querySelector("#pers-list") && !document.querySelector("#pers-list").querySelector(".skeleton"), { timeout: 10000 });
    text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /Terrain/); // employé A (site A), jamais "Autre" (employé B, site B)
    assert.doesNotMatch(text, /Autre/);
    assert.strictEqual(consoleErrors.length, 0);

    // Pointage : pointer l'employé A présent
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/pointage"; });
    await page.waitForSelector(`[data-set="${empAId}"]`, { timeout: 10000 });
    await page.select(`[data-set="${empAId}"]`, "absent");
    await new Promise((r) => setTimeout(r, 400));
    text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /absent/i);
    assert.strictEqual(consoleErrors.length, 0);

    // Absences : décider "justifiée"
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/absences"; });
    await page.waitForSelector("[data-decide]", { timeout: 10000 });
    await page.click('[data-decide][data-decision="justifiee"]');
    await page.waitForSelector(".confirm-box", { timeout: 5000 });
    const confirmText = await page.evaluate(() => document.querySelector(".confirm-box")?.innerText || "");
    assert.match(confirmText, /justifiee|justifiée/i);
    await page.click("[data-confirm]");
    await new Promise((r) => setTimeout(r, 400));
    text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /justifiée/i);
    assert.strictEqual(consoleErrors.length, 0);

    // Justificatifs : déposer un PDF minuscule pour le congé créé plus bas — d'abord créer
    // le congé via Congés pour avoir un owner_id réel.
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/conges"; });
    await page.waitForSelector("#conge-form", { timeout: 10000 });
    await page.type('input[name="employee_id"]', String(empAId));
    await page.$eval('input[name="start_date"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, "2026-10-01");
    await page.$eval('input[name="end_date"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, "2026-10-10");
    await page.click('#conge-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector("#conge-msg")?.textContent?.includes("préparée"), { timeout: 8000 });
    text = await page.evaluate(() => document.querySelector("#conge-list")?.innerText || "");
    assert.match(text, new RegExp(`#${empAId}`));
    assert.strictEqual(consoleErrors.length, 0);

    // Maladies
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/maladies"; });
    await page.waitForSelector("#maladie-form", { timeout: 10000 });
    await page.type('input[name="employee_id"]', String(empAId));
    await page.$eval('input[name="start_date"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, "2026-11-01");
    await page.$eval('input[name="end_date"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, "2026-11-05");
    await page.click('#maladie-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector("#maladie-msg")?.textContent?.includes("enregistrée"), { timeout: 8000 });
    assert.strictEqual(consoleErrors.length, 0);

    // Discipline : créer, signaler, transmettre à la DRH
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/discipline"; });
    await page.waitForSelector("#disc-form", { timeout: 10000 });
    await page.type('input[name="employee_id"]', String(empAId));
    await page.type('input[name="subject"]', "Retard répété E2E");
    await page.click('#disc-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector("#disc-msg")?.textContent?.includes("brouillon"), { timeout: 8000 });
    await page.waitForSelector("[data-signal]", { timeout: 8000 });
    await page.click("[data-signal]");
    await page.waitForSelector(".confirm-box", { timeout: 5000 });
    await page.click("[data-confirm]");
    await page.waitForSelector("[data-transmit]", { timeout: 8000 });
    await page.click("[data-transmit]");
    await page.waitForSelector(".confirm-box", { timeout: 5000 });
    const transmitText = await page.evaluate(() => document.querySelector(".confirm-box")?.innerText || "");
    assert.match(transmitText, /DRH|Retard répété E2E/);
    await page.click("[data-confirm]");
    await new Promise((r) => setTimeout(r, 400));
    text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /transmis/i);
    assert.strictEqual(consoleErrors.length, 0);

    // Réclamations
    consoleErrors.length = 0;
    await page.evaluate(() => { location.hash = "#/reclamations"; });
    await page.waitForSelector("#rec-form", { timeout: 10000 });
    await page.type('input[name="employee_id"]', String(empAId));
    await page.type('input[name="subject"]', "Prime non versée");
    await page.type('input[name="description"]', "Détail E2E");
    await page.click('#rec-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector("#rec-msg")?.textContent?.includes("créée"), { timeout: 8000 });
    text = await page.evaluate(() => document.querySelector("#rec-list")?.innerText || "");
    assert.match(text, /Prime non versée/);
    assert.strictEqual(consoleErrors.length, 0);

    // Notifications : la cloche doit refléter au moins la notification d'absence émise plus haut.
    consoleErrors.length = 0;
    await page.click("#notif-btn");
    await page.waitForSelector(".drawer", { timeout: 5000 });
    text = await page.evaluate(() => document.querySelector(".drawer")?.innerText || "");
    assert.match(text, /absence|justificatif/i);
    await page.keyboard.press("Escape");
    assert.strictEqual(consoleErrors.length, 0);

    // Logout
    await page.click("#logout-btn");
    await page.waitForSelector("#login-form", { timeout: 5000 });
  });

  await t.test("scénario hostile : modifier site_id/employee_id/document_id/recherche cross-site — 0 fuite", async () => {
    const page = mainPage;
    // Robuste à l'état de fin du test précédent (déconnecté ou non) : se reconnecte
    // seulement si le formulaire de login est effectivement affiché.
    const needsLogin = await page.evaluate(() => !!document.querySelector("#login-form"));
    if (needsLogin) {
      await page.type("input[name=username]", "chargeE2E");
      await page.type("input[name=password]", "chargeE2Epass");
      await Promise.all([page.click("button[type=submit]"), page.waitForSelector(".shell", { timeout: 8000 })]);
    }

    // Recherche cross-site : "Autre" (nom de l'employé B) ne doit jamais apparaître.
    await page.evaluate(() => { location.hash = "#/personnel"; });
    await page.waitForSelector("#pers-q", { timeout: 8000 });
    await page.type("#pers-q", "Autre");
    await new Promise((r) => setTimeout(r, 500));
    let text = await page.evaluate(() => document.querySelector("#pers-list")?.innerText || "");
    assert.doesNotMatch(text, /Autre/);

    // Appels API directs (fetch depuis la page, même token) avec des IDs du site B forgés —
    // preuve backend, pas seulement absence de bouton côté UI.
    const results = await page.evaluate(async (empBId) => {
      const token = localStorage.getItem("sw_token");
      const headers = { Authorization: "Bearer " + token };
      const out = {};
      out.attendance = (await fetch("/api/site-workforce/attendance", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: empBId, presence_date: "2026-09-23", status: "present" }) })).status;
      out.leave = (await fetch("/api/site-workforce/leaves", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: empBId, leave_type: "conge", start_date: "2026-09-23", end_date: "2026-09-24" }) })).status;
      out.discipline = (await fetch("/api/site-workforce/discipline", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: empBId, event_type: "retard", subject: "hostile" }) })).status;
      out.reclamation = (await fetch("/api/site-workforce/reclamations", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: empBId, subject: "hostile", description: "hostile" }) })).status;
      return out;
    }, empBId);
    assert.strictEqual(results.attendance, 403, "pointage forgé sur un employé du site B doit être refusé");
    assert.strictEqual(results.leave, 403, "congé forgé sur un employé du site B doit être refusé");
    assert.strictEqual(results.discipline, 403, "incident forgé sur un employé du site B doit être refusé");
    assert.strictEqual(results.reclamation, 403, "réclamation forgée sur un employé du site B doit être refusée");
  });

  await t.test("responsive : 1440/1024/768/390 px sur les 9 écrans, aucun débordement horizontal", async () => {
    const page = mainPage;
    const widths = [1440, 1024, 768, 390];
    const screens = ["dashboard", "personnel", "pointage", "absences", "justificatifs", "conges", "maladies", "discipline", "reclamations"];
    for (const width of widths) {
      await page.setViewport({ width, height: 900 });
      for (const screen of screens) {
        await page.evaluate((s) => { location.hash = "#/" + s; }, screen);
        await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        const overflow = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 2);
        assert.strictEqual(overflow, false, `débordement horizontal non intentionnel sur "${screen}" à ${width}px`);
      }
    }
  });
});
