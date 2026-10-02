// LOT A — E2E réel : Fiche de position → Photo employé → « Prendre la photo ».
// Vrai serveur uvicorn (SQLite temporaire), VRAI moteur, vrai Chrome dont la caméra virtuelle
// diffuse un portrait. Vérifie le parcours caméra → capture → utiliser → analyse serveur, l'état
// de la référence faciale, et qu'AUCUN gabarit n'est créé ni la fiche modifiée par ce lot.
// `npm run test:drh-facial-reference-e2e`. Exécuté seulement si ATLAS_E2E_PYTHON,
// BIOMETRIC_MODELS_DIR et BIOMETRIC_TEST_FACES sont définis (sinon skip explicite).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8985;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const ADMIN = { username: "LOTAADMIN", password: "lot-a-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;

test("LOT A — Fiche de position : photo par caméra et référence faciale (E2E réel)", { skip: SKIP, timeout: 300000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lot_a_"));
  const UPLOADS = path.join(TMP, "uploads");
  fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "lot-a-e2e-secret-000000000000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "false", BIOMETRIC_ENROLLMENT_ENABLED: "true", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS };
  const SERVER_LOG = path.join(TMP, "server.log");
  const py = (code) => execFileSync(PY, ["-c", code], { cwd: REPO_ROOT, env }).toString().trim().split("\n").pop();
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  });
  const VIDEO = path.join(TMP, "portrait.mjpeg");
  py(`
import io
from PIL import Image
face = Image.open(${JSON.stringify(path.join(FACES, "obama1.jpg"))}).convert("RGB"); face.thumbnail((460, 460))
out = open(${JSON.stringify(VIDEO)}, "wb")
for n in range(60):
    canvas = Image.new("RGB", (640, 480), (52, 58, 66)); canvas.paste(face, ((640 - face.width) // 2, (480 - face.height) // 2))
    d = (n % 3 - 1) * 2
    b = io.BytesIO(); canvas.point(lambda v, d=d: max(0, min(255, v + d))).save(b, "JPEG", quality=90); out.write(b.getvalue())
out.close(); print("ok")
`);
  const state = () => JSON.parse(py(`
import app.main, json
from app.db.session import SessionLocal
from app.modules.biometrics.models import BiometricTemplate
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.models import Employee
S = SessionLocal(); e = S.query(Employee).filter(Employee.code == "LOTA-01").one()
print(json.dumps({"templates": S.query(BiometricTemplate).count(), "events": S.query(AttendanceEvent).count(), "photo": (e.extra or {}).get("photo")}))
`));

  let page;
  await t.test("serveur réel + connexion Administration système + ouverture de la fiche", async () => {
    const logFd = fs.openSync(SERVER_LOG, "w");
    server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env, stdio: ["ignore", logFd, logFd] });
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) {
      try { ok = (await fetch(BASE + "/api/auth/admin-system-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ADMIN) })).status === 200; } catch (e) { /* démarrage */ }
      if (!ok) await sleep(300);
    }
    assert.ok(ok, "serveur E2E non prêt");
    py(`
import app.main
from datetime import date, timedelta
from app.db.session import SessionLocal
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
S = SessionLocal()
site = Site(name="HAMOUL 01 E2E", active=1, equipment_plan={"societe": "IRON GLOBAL SOLUTION"}); S.add(site); S.flush()
e = Employee(code="LOTA-01", first_name="Barack", last_name="LotA", society="IRON GLOBAL SOLUTION", status="actif", position="CARISTE")
S.add(e); S.flush()
S.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
S.commit(); print(e.id)
`);
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lota_chrome_")),
      args: ["--no-first-run", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${VIDEO}`] });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on("dialog", async (dialog) => { if (dialog.type() === "prompt") await dialog.accept(ADMIN.password); else await dialog.accept(); });
    await page.goto(BASE + "/#/login", { waitUntil: "networkidle0" });
    await page.waitForSelector(".login-admin-system-shortcut");
    await page.click(".login-admin-system-shortcut");
    await page.$eval('#modal-host input[name="username"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, ADMIN.username);
    await page.type('#modal-host input[name="password"]', ADMIN.password);
    await page.evaluate(() => Array.from(document.querySelectorAll("#modal-host button")).find((b) => b.textContent.trim() === "Valider").click());
    await page.waitForSelector("#sidebar-nav");
    await page.evaluate(() => { location.hash = "#/admin/fiches"; });
    const snapshot = () => page.evaluate(() => JSON.stringify({ hash: location.hash, view: (document.getElementById("view")?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
      links: Array.from(document.querySelectorAll('a[href*="fiches/"]')).slice(0, 5).map((a) => a.getAttribute("href")) }));
    try {
      await page.waitForFunction(() => Array.from(document.querySelectorAll('a[href^="#/admin/fiches/"]')).some((a) => /^#\/admin\/fiches\/\d+$/.test(a.getAttribute("href"))), { timeout: 30000 });
    } catch (e) { throw new Error("liste des fiches : " + await snapshot()); }
    await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#/admin/fiches/"]')).find((a) => /^#\/admin\/fiches\/\d+$/.test(a.getAttribute("href"))).click());
    try { await page.waitForSelector(".rh-photo-panel", { timeout: 30000 }); } catch (e) { throw new Error("fiche : " + await snapshot()); }
  });

  await t.test("fiche sans photo : « Aucune photo », référence « Aucune référence disponible » (jamais « Prête »)", async () => {
    await page.waitForFunction(() => document.querySelector(".rh-facial-ref")?.dataset.state === "NONE", { timeout: 15000 });
    const panel = await page.$eval(".rh-photo-panel", (el) => el.innerText.replace(/\s+/g, " "));
    assert.match(panel, /PHOTO EMPLOYÉ Aucune photo/i);
    assert.match(panel, /RÉFÉRENCE FACIALE ✕ Aucune référence disponible Ajoutez une photo/i);
    assert.doesNotMatch(panel, /Prête|gabarit|score/i);
  });

  await t.test("Prendre la photo : caméra → capture → reprendre → utiliser → analyse réelle ; aucun gabarit, fiche non modifiée", async () => {
    const before = state();
    const sent = [];
    page.on("request", (r) => { if (r.url().includes("/facial-reference/analyze")) sent.push(r.method()); });
    // La fiche s'ouvre verrouillée : la caméra est refusée tant que la page n'est pas déverrouillée.
    assert.strictEqual(await page.evaluate(() => document.body.classList.contains("sgdi-view-mode")), true);
    await page.evaluate(() => document.querySelector('[id^="rh-photo-camera-"]').click());
    await sleep(400);
    assert.strictEqual(await page.$("#photo-cam-video"), null, "fiche verrouillée : caméra non ouverte");
    await page.evaluate(() => document.getElementById("sgdi-edit-toggle").click());      // cadenas « Déverrouiller »
    try { await page.waitForFunction(() => !document.body.classList.contains("sgdi-view-mode"), { timeout: 8000 }); }
    catch (e) { throw new Error("déverrouillage : " + await page.evaluate(() => JSON.stringify({ toggle: document.getElementById("sgdi-edit-toggle")?.outerHTML.slice(0, 300), n: document.querySelectorAll("#sgdi-edit-toggle").length, hash: location.hash }))); }
    const cameraButton = await page.$('[id^="rh-photo-camera-"]');
    assert.ok(cameraButton, "bouton « Prendre la photo » présent (fiche modifiable en Administration système)");
    await cameraButton.click();
    try {
      await page.waitForFunction(() => { const v = document.getElementById("photo-cam-video"); return v && !v.hidden && v.videoWidth > 0; }, { timeout: 20000 });
    } catch (e) {
      throw new Error("caméra : " + await page.evaluate(() => JSON.stringify({ modal: (document.getElementById("modal-host")?.innerText || "").replace(/\s+/g, " ").slice(0, 300),
        video: (() => { const v = document.getElementById("photo-cam-video"); return v ? { hidden: v.hidden, w: v.videoWidth, ready: v.readyState } : null; })(),
        body: document.body.className, toast: (document.querySelector(".toast,#toast-host")?.innerText || "").slice(0, 200) })));
    }
    await page.click("#photo-cam-capture");
    await page.waitForFunction(() => !document.getElementById("photo-cam-shot").hidden);
    await page.click("#photo-cam-retake");
    await page.waitForFunction(() => !document.getElementById("photo-cam-video").hidden);
    assert.strictEqual(sent.length, 0, "aucune image envoyée avant « Utiliser cette photo »");
    await page.click("#photo-cam-capture");
    await page.click("#photo-cam-use");
    const answers = [];
    page.on("response", async (r) => { if (r.url().includes("/facial-reference/analyze")) answers.push(r.status() + " " + (await r.text().catch(() => "")).slice(0, 300)); });
    try {
      await page.waitForFunction(() => /Photo exploitable|Photo non|Qualité|Aucun visage|indisponible/.test(document.querySelector(".rh-photo-check")?.textContent || ""), { timeout: 30000 });
    } catch (e) {
      throw new Error("analyse : " + JSON.stringify({ sent, answers, check: await page.evaluate(() => document.querySelector(".rh-photo-check")?.outerHTML || null),
        cam: await page.evaluate(() => (document.getElementById("modal-host")?.innerText || "").slice(0, 200)) }));
    }
    const check = await page.$eval(".rh-photo-check", (el) => el.textContent);
    assert.match(check, /✓ Photo exploitable pour la reconnaissance faciale/, check);
    assert.deepStrictEqual(sent, ["POST"], "une seule requête, à la validation");
    assert.strictEqual(await page.$("#photo-cam-video"), null, "fenêtre caméra fermée");
    assert.match(await page.$eval('#agent-form [name="photo"]', (el) => el.value.slice(0, 23)), /^data:image\/jpeg;base64,/);
    assert.match(await page.$eval('[id^="rh-photo-state-"]', (el) => el.textContent), /Photo disponible/);
    // LOT A : rien n'est créé ni modifié côté serveur (la photo n'est conservée qu'à l'enregistrement de la fiche).
    assert.deepStrictEqual(state(), before);
    assert.strictEqual(before.templates, 0);
    assert.strictEqual(/data:image|\/9j\/4/.test(fs.readFileSync(SERVER_LOG, "utf8")), false, "aucune image dans les journaux");
  });
});
