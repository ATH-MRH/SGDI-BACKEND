// LOT B — E2E réel : Fiche de position → nouvelle photo → Enregistrer → référence faciale préparée
// automatiquement par le serveur (DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED=true, pointage facial
// DÉSACTIVÉ). Vrai serveur uvicorn (SQLite temporaire), VRAI moteur, vrai Chrome dont la caméra
// virtuelle diffuse un portrait. Caméra → « Prête » ; puis import du portrait d'une AUTRE
// personne → « Revue requise », référence précédente conservée.
// `npm run test:drh-facial-reference-sync-e2e`. Exécuté seulement si ATLAS_E2E_PYTHON,
// BIOMETRIC_MODELS_DIR et BIOMETRIC_TEST_FACES sont définis (sinon skip explicite).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8986;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const ADMIN = { username: "LOTBADMIN", password: "lot-b-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;

test("LOT B — Fiche de position : synchronisation automatique de la référence faciale (E2E réel)", { skip: SKIP, timeout: 300000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lot_b_"));
  const UPLOADS = path.join(TMP, "uploads");
  fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "lot-b-e2e-secret-000000000000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "false", BIOMETRIC_ENROLLMENT_ENABLED: "true", DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED: "true", FACIAL_REFERENCE_CONSENT_MODE: "no_objection", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS };
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
from app.core.config import settings
from app.db.session import SessionLocal
from app.modules.biometrics.models import BiometricConsent, BiometricPhotoSync, BiometricTemplate
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.models import Employee
S = SessionLocal(); e = S.query(Employee).filter(Employee.code == "LOTB-01").one()
sync = S.query(BiometricPhotoSync).filter(BiometricPhotoSync.employee_id == e.id).one_or_none()
print(json.dumps({"templates": [[t.status, t.source] for t in S.query(BiometricTemplate).filter(BiometricTemplate.employee_id == e.id).order_by(BiometricTemplate.id)],
  "sync": [sync.status, sync.reason_code, sync.source, bool(sync.previous_reference_kept)] if sync else None,
  "events": S.query(AttendanceEvent).count(), "consents": S.query(BiometricConsent).count(),
  "photo": str((e.extra or {}).get("photo") or "")[:15], "biometric_enabled": settings.biometric_enabled}))
`));
  const refState = () => page.$eval(".rh-facial-ref", (el) => el.dataset.state || "");
  const refText = () => page.$eval(".rh-facial-ref", (el) => el.innerText.replace(/\s+/g, " ").trim());
  const saveFiche = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("#agent-form .rh-save-submit"); return b && !b.disabled; }, { timeout: 10000 });
    await page.evaluate(() => document.querySelector("#agent-form .rh-save-submit").click());
  };
  const waitRef = async (wanted) => {
    try { await page.waitForFunction((w) => document.querySelector(".rh-facial-ref")?.dataset.state === w, { timeout: 40000 }, wanted); }
    catch (e) { throw new Error(`référence attendue ${wanted} : ` + JSON.stringify({ ref: await refText().catch(() => null), state: state(),
      toast: await page.evaluate(() => Array.from(document.querySelectorAll(".toast, [class*=toast]")).map((x) => x.innerText).join(" | ").slice(0, 300)) })); }
  };
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
e = Employee(code="LOTB-01", first_name="Barack", last_name="LotB", society="IRON GLOBAL SOLUTION", status="actif", position="CARISTE")
S.add(e); S.flush()
S.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
S.commit(); print(e.id)
`);
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lotb_chrome_")),
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

  await t.test("caméra → Enregistrer la fiche → « Traitement en cours… » → « ✓ Prête », sans aucune action d'enrôlement", async () => {
    await page.waitForFunction(() => document.querySelector(".rh-facial-ref")?.dataset.state === "NONE", { timeout: 15000 });
    assert.deepStrictEqual(state().templates, []);
    await page.evaluate(() => document.getElementById("sgdi-edit-toggle").click());
    await page.waitForFunction(() => !document.body.classList.contains("sgdi-view-mode"), { timeout: 8000 });
    await page.evaluate(() => document.querySelector('[id^="rh-photo-camera-"]').click());
    await page.waitForFunction(() => { const v = document.getElementById("photo-cam-video"); return v && !v.hidden && v.videoWidth > 0; }, { timeout: 20000 });
    await page.click("#photo-cam-capture");
    await page.click("#photo-cam-use");
    await page.waitForFunction(() => /Photo exploitable/.test(document.querySelector(".rh-photo-check")?.textContent || ""), { timeout: 30000 });
    assert.deepStrictEqual(state().templates, [], "rien n'est créé avant l'enregistrement de la fiche");
    const saves = [];
    page.on("request", (r) => { if (/\/api\/drh\/employees\/\d+(\?|$)/.test(r.url()) && r.method() === "PUT") saves.push(new URL(r.url()).search); });
    await saveFiche();
    await waitRef("READY");
    assert.match(await refText(), /^✓ Prête/);
    assert.deepStrictEqual(saves, ["?photo_source=DRH_CAMERA"]);
    const s = state();
    assert.deepStrictEqual(s.templates, [["ACTIVE", "EMPLOYEE_PHOTO"]]);
    assert.deepStrictEqual(s.sync, ["READY", null, "DRH_CAMERA", false]);
    assert.strictEqual(s.photo, "/uploads/photos");
    assert.deepStrictEqual([s.events, s.consents, s.biometric_enabled], [0, 0, false], "aucun pointage, aucun consentement créé, pointage facial désactivé");
    const panel = await page.$eval(".rh-photo-panel", (el) => el.innerText);
    assert.doesNotMatch(panel, /gabarit|embedding|score|enr[oô]l/i);
  });

  await t.test("import du portrait d'une AUTRE personne → « ⚠ Revue requise », référence précédente conservée", async () => {
    if (await page.evaluate(() => document.body.classList.contains("sgdi-view-mode"))) {
      await page.evaluate(() => document.getElementById("sgdi-edit-toggle").click());
      await page.waitForFunction(() => !document.body.classList.contains("sgdi-view-mode"), { timeout: 8000 });
    }
    // Portrait d'une autre personne, ramené sous la limite d'import de la fiche (3 Mo).
    const OTHER = path.join(TMP, "autre.jpg");
    py(`
from PIL import Image
im = Image.open(${JSON.stringify(path.join(FACES, "biden1.jpg"))}).convert("RGB"); im.thumbnail((900, 900)); im.save(${JSON.stringify(OTHER)}, "JPEG", quality=90); print("ok")
`);
    const previous = await page.$eval('#agent-form [name="photo"]', (el) => el.value);
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), page.evaluate(() => document.querySelector('[id^="rh-photo-import-"]').click())]);
    await chooser.accept([OTHER]);
    await page.waitForFunction((v) => { const now = document.querySelector('#agent-form [name="photo"]')?.value || ""; return /^data:image\//.test(now) && now !== v; }, { timeout: 15000 }, previous);
    await saveFiche();
    await waitRef("REVIEW_REQUIRED");
    const text = await refText();
    assert.match(text, /^⚠ Revue requise/);
    assert.match(text, /précédente conservée/);
    const s = state();
    assert.deepStrictEqual(s.templates, [["ACTIVE", "EMPLOYEE_PHOTO"], ["PENDING_REVIEW", "EMPLOYEE_PHOTO"]], "l'ancienne référence reste active");
    assert.deepStrictEqual(s.sync, ["REVIEW_REQUIRED", "FACE_MISMATCH", "DRH_UPLOAD", true]);
    assert.deepStrictEqual([s.events, s.consents, s.biometric_enabled], [0, 0, false]);
    const log = fs.readFileSync(SERVER_LOG, "utf8");
    assert.strictEqual(/data:image|\/9j\/4/.test(log), false, "aucune image dans les journaux");
    assert.match(log, /drh\.facial_reference\.ready/);
    assert.match(log, /drh\.facial_reference\.review_required/);
  });
});
