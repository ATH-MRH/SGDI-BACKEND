// Centre de contrôle Pointage dans un VRAI Chrome : les contrôles d'écriture suivent les
// permissions effectives du compte. Serveur uvicorn isolé, base SQLite temporaire, données
// synthétiques ; aucune donnée de production. Ignoré (skip explicite) sans Chrome/puppeteer-core.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, execFileSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const PY = process.env.ATLAS_E2E_PYTHON || "python3";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-pointage-readonly-"));
const DB_PATH = path.join(TMP, "e2e.db");
const ADMIN = { username: "adminRO", password: "Admin-ReadOnly-E2E!2026" };
const SOC = "IRON GLOBAL SOLUTION";
const CHROME_PATH = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p)) || null;
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

let PORT, serverProc;
const browsers = [];
async function api(p, { method = "GET", token, body, host } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (host) headers.Host = host;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non JSON */ }
  return { status: res.status, data };
}

async function openControlCenter(username, { expectRefusal = false } = {}) {
  const b = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new", userDataDir: path.join(TMP, `chrome_${username}`),
    args: ["--no-first-run", `--host-resolver-rules=MAP pointage.irongs.com 127.0.0.1:${PORT}`] });
  browsers.push(b);
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [], writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("request", (r) => { if (r.method() !== "GET" && !r.url().endsWith("/api/auth/login")) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto("http://pointage.irongs.com/", { waitUntil: "domcontentloaded" });
  await page.type("#login-user", username); await page.type("#login-pass", username + "-pass");
  await page.click("#login-btn");
  await page.waitForFunction(() => !document.getElementById("app").classList.contains("hidden") || document.getElementById("login-error").textContent.trim(), { timeout: 10000 });
  const refusal = await page.evaluate(() => (document.getElementById("app").classList.contains("hidden") ? document.getElementById("login-error").textContent.trim() : ""));
  if (expectRefusal) return { page, errors, writes, refusal };
  assert.strictEqual(refusal, "", `${username} : connexion refusée`);
  await page.waitForFunction(() => document.querySelectorAll("#board-rows tr").length >= 1, { timeout: 10000 });
  return { page, errors, writes, refusal };
}
const shown = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.offsetParent !== null; }, selector);
const count = (page, selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);

test("Centre de contrôle Pointage — contrôles d'écriture selon les permissions effectives (Chrome réel)",
  { skip: !CHROME_PATH ? "Chrome introuvable (PUPPETEER_EXECUTABLE_PATH)" : (!puppeteer ? "puppeteer-core absent" : false) }, async (t) => {
  t.after(async () => {
    for (const b of browsers) await b.close().catch(() => {});
    if (serverProc) serverProc.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  await t.test("démarrage serveur + données synthétiques", async () => {
    PORT = await freePort();
    const env = { ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "pointage-readonly-e2e-secret-000000000", APP_ENV: "test",
      ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password, LOG_LEVEL: "ERROR", LOGIN_MAX_ATTEMPTS: "1000000",
      SGDI_UPLOADS_DIR: path.join(TMP, "uploads"), BIOMETRIC_ENABLED: "false" };
    serverProc = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env, stdio: "ignore" });
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      try { ready = (await api("/auth/login", { method: "POST", body: ADMIN })).status === 200; } catch (e) { /* pas encore prêt */ }
      if (!ready) await sleep(300);
    }
    assert.ok(ready, "serveur non prêt");
    execFileSync(PY, ["-c", `
import app.main
from datetime import date, timedelta
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Site, Assignment, DailyPresence
from app.modules.attendance.models import AttendanceAnomaly
S = SessionLocal()
site = Site(name="Site Lecture Seule", active=1, equipment_plan={"societe": "${SOC}"})
emp = Employee(code="RO-E1", first_name="Amine", last_name="Consulte", society="${SOC}", status="actif", position="AGENT")
S.add_all([site, emp]); S.flush()
S.add_all([
    Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1),
    DailyPresence(presence_date=date.today(), employee_id=emp.id, site_id=site.id, status="present", arrival_time="08:02"),
    AttendanceAnomaly(anomaly_type="LATE", employee_id=emp.id, society="${SOC}", site_id=site.id, presence_date=date.today(),
                      message="Arrivée à 08:40", dedupe_key="readonly-e2e-late"),
])
def user(name, role, modules, actions=None):
    S.add(User(username=name, full_name=name, password_hash=hash_password(name + "-pass"), validation_password_hash=hash_password("x"),
               is_active=True, role=role, access_level="H3", authorized_structures=[], authorized_societies=["${SOC}"],
               authorized_sites=[site.id], authorized_modules=modules, authorized_actions=actions or []))
user("drhSeul", "drh", ["drh"])
user("drhConsulte", "drh", ["drh", "pointage"], ["read", "export"])
user("opsCentre", "ops", ["pointage", "ops"])
S.commit()
`], { cwd: REPO_ROOT, env });
  });

  await t.test("DRH seul : le serveur n'accorde aucune écriture et refuse l'entrée du centre de contrôle", async () => {
    const { refusal, writes } = await openControlCenter("drhSeul", { expectRefusal: true });
    assert.match(refusal, /module n'est pas autorisé/, "sans module du centre de contrôle, la connexion y est refusée");
    assert.deepStrictEqual(writes, []);
    const login = await api("/auth/login", { method: "POST", body: { username: "drhSeul", password: "drhSeul-pass" } });
    assert.strictEqual(login.status, 200, JSON.stringify(login.data));
    const token = login.data.access_token;
    const caps = await api("/attendance/capabilities", { token });
    assert.strictEqual(caps.status, 200);
    assert.strictEqual(caps.data.read_only, true);
    assert.ok(Object.values(caps.data.writes).every((v) => v === false));
    assert.strictEqual((await api("/attendance/board", { token })).status, 200, "consultation conservée");
    assert.strictEqual((await api("/attendance/close", { method: "POST", token, body: { presence_date: "2020-01-01" } })).status, 403);
  });

  await t.test("compte en consultation : situation, anomalies et filtres visibles, aucun contrôle d'écriture", async () => {
    const { page, errors, writes } = await openControlCenter("drhConsulte");
    assert.match(await page.evaluate(() => document.getElementById("board-rows").innerText), /Consulte/);
    assert.match(await page.evaluate(() => document.getElementById("brand-user").textContent), /consultation/);
    assert.strictEqual(await count(page, "[data-correct]"), 0, "pas de bouton Corriger");
    assert.strictEqual(await shown(page, "#close-btn"), false, "pas de bouton Clôturer");
    await page.select("#f-status", "present");
    await page.waitForFunction(() => document.querySelectorAll("#board-rows tr").length >= 1, { timeout: 10000 });
    await page.click('[data-view="anomalies"]');
    await page.waitForFunction(() => /Arrivée à 08:40/.test(document.getElementById("anomaly-rows").innerText), { timeout: 10000 });
    assert.strictEqual(await count(page, "[data-resolve]"), 0, "pas de bouton Traiter");
    await page.click('[data-view="sheets"]');
    await sleep(400);
    assert.strictEqual(await shown(page, "#s-settings"), false, "pas de bouton Paramètres de rotation");
    await page.click('[data-view="planning"]');
    await sleep(600);
    assert.strictEqual(await count(page, "[data-pl-mode]"), 0, "pas de bouton d'apprentissage");
    assert.deepStrictEqual(writes, [], "aucune requête d'écriture émise par la page");
    assert.deepStrictEqual(errors, []);
  });

  await t.test("compte opérationnel : contrôles d'écriture présents, la correction aboutit", async () => {
    const { page, errors, writes } = await openControlCenter("opsCentre");
    assert.doesNotMatch(await page.evaluate(() => document.getElementById("brand-user").textContent), /consultation/);
    assert.strictEqual(await shown(page, "#close-btn"), true);
    const presenceId = await page.evaluate(() => document.querySelector("[data-correct]")?.dataset.correct);
    assert.ok(presenceId, "bouton Corriger proposé");
    await page.click(`[data-correct="${presenceId}"]`);
    await page.select("#c-status", "mission");
    await page.type("#c-reason", "Mission extérieure confirmée");
    await page.click("#c-save");
    await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 10000 });
    assert.deepStrictEqual(writes, [`PATCH /api/attendance/presences/${presenceId}`]);
    await page.click('[data-view="anomalies"]');
    await page.waitForFunction(() => document.querySelectorAll("[data-resolve]").length >= 1, { timeout: 10000 });
    assert.deepStrictEqual(errors, []);
  });
});
