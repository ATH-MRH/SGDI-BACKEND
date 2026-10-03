// Fiche de position — portrait de présentation (photo d'identité, fond blanc) : contrôle VISUEL
// réel dans Chrome. Vrai serveur (SQLite temporaire), VRAIS modèles (YuNet + PP-HumanSeg),
// fiche type K162 : photo carrée issue de la tablette, référence faciale « Prête ». Vérifie le
// rendu (taille, fond blanc, visage agrandi), l'« Aperçu » (photo source), l'empreinte de la
// photo source et les tables biométriques inchangées, et 7 largeurs d'écran. Captures AVANT /
// APRÈS dans $ATLAS_PORTRAIT_SHOTS si défini. `npm run test:drh-employee-portrait-e2e`.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8988;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const ADMIN = { username: "PORTRAITADMIN", password: "portrait-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;

test("Fiche de position : portrait d'identité sur fond blanc (contrôle visuel réel)", { skip: SKIP, timeout: 300000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_portrait_"));
  const UPLOADS = path.join(TMP, "uploads");
  fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "portrait-e2e-secret-000000000000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "false", BIOMETRIC_ENROLLMENT_ENABLED: "true",  BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS };
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
import app.main, hashlib, json
from app.core.photo_storage import PHOTOS_DIR
from app.db.session import SessionLocal
from app.modules.biometrics.models import BiometricPhotoSync, BiometricTemplate
from app.modules.drh.portrait_models import EmployeePortrait
S = SessionLocal()
print(json.dumps({"hash": hashlib.sha256((PHOTOS_DIR / "K162-c1.jpg").read_bytes()).hexdigest(),
  "templates": [[t.status, t.source] for t in S.query(BiometricTemplate).order_by(BiometricTemplate.id)],
  "syncs": [[x.status, x.photo_fingerprint[:12]] for x in S.query(BiometricPhotoSync)],
  "portraits": [[p.method, p.width, p.height] for p in S.query(EmployeePortrait)],
  "public": sorted(p.name for p in PHOTOS_DIR.iterdir() if p.is_file())}))
`));
  const SHOTS = process.env.ATLAS_PORTRAIT_SHOTS || "";
  let page, before;
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
e = Employee(code="K162", first_name="Barack", last_name="OUALI", society="IRON GLOBAL SOLUTION", status="actif", position="CARISTE")
S.add(e); S.flush()
S.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
# Photo C1 (carré du cercle de la tablette) et référence faciale active issue de cette photo.
import hashlib, io, datetime
from PIL import Image
from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
from app.modules.biometrics import crypto
from app.modules.biometrics.models import BiometricPhotoSync, BiometricTemplate
# Comme la photo K162 réelle : carré du cercle de la tablette, tête au minimum accepté par le
# cercle (≈ 55 % du diamètre sûr), beaucoup de buste, décor de bureau autour de la personne.
from app.modules.biometrics import framing
from app.modules.biometrics.engine import OpenCvFaceEngine
eng = OpenCvFaceEngine(${JSON.stringify(MODELS)})
src = Image.open(${JSON.stringify(path.join(FACES, "obama2.jpg"))}).convert("RGB"); src.thumbnail((470, 640))
bb = io.BytesIO(); src.save(bb, "JPEG", quality=92)
hx, hy, hw, hh = framing.head_box(eng.analyze(bb.getvalue()).faces[0].bbox)
k = (0.55 * framing.SAFE_RATIO * 480) / hh
person = src.resize((round(src.width * k), round(src.height * k)))
sq = Image.new("RGB", (480, 480), (176, 160, 138))
sq.paste(person, (round(240 - (hx + hw / 2) * k), round(240 - (hy + hh / 2) * k)))
b = io.BytesIO(); sq.save(b, "JPEG", quality=90); data = b.getvalue()
ensure_upload_dirs(); (PHOTOS_DIR / "K162-c1.jpg").write_bytes(data)
e.extra = {"photo": "/uploads/photos/K162-c1.jpg"}
fp = hashlib.sha256(data).hexdigest()
S.add(BiometricTemplate(employee_id=e.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector([0.1] * 128), engine="opencv", config_version=1,
                        source="EMPLOYEE_PHOTO", quality={"photo_sha256": fp}))
S.add(BiometricPhotoSync(employee_id=e.id, photo_fingerprint=fp, status="READY", source="DRH_REMOTE_TERMINAL", requested_at=datetime.datetime.utcnow(),
                         attempts=0, previous_reference_kept=False))
S.commit(); print(e.id)
`);
    before = state();                                                     // AVANT toute ouverture de fiche
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_portrait_chrome_")),
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

  const zoneBox = () => page.$eval(".rh-erp-photo", (z) => { const r = z.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, cls: z.className, method: z.dataset.portrait || "" }; });

  await t.test("en-tête : portrait d'identité 3:4, visage agrandi et centré, fond réellement blanc", async () => {
    try { await page.waitForSelector(".rh-erp-photo.is-portrait", { timeout: 30000 }); }
    catch (e) { throw new Error("portrait : " + JSON.stringify(await zoneBox()) + " " + fs.readFileSync(SERVER_LOG, "utf8").slice(-1500)); }
    const box = await zoneBox();
    assert.strictEqual(box.method, "SEGMENTED");
    assert.ok(Math.abs(box.width - 120) <= 1 && Math.abs(box.height - 160) <= 1, JSON.stringify(box));
    const pixels = await page.evaluate(async () => {
      const img = document.querySelector(".rh-erp-photo img.rh-portrait-img");
      await img.decode();
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const mean = (x, y, w, h) => { const d = ctx.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); };
      return { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 5), corners: [mean(0, 0, 40, 40), mean(260, 0, 40, 40)], sides: [mean(0, 150, 12, 80), mean(288, 150, 12, 80)],
        face: mean(120, 120, 60, 80), shoulders: mean(120, 370, 60, 30) };
    });
    assert.deepStrictEqual([pixels.w, pixels.h, pixels.src], [300, 400, "blob:"], "portrait dérivé, servi par la route protégée");
    for (const v of [...pixels.corners, ...pixels.sides]) assert.ok(v >= 240, `fond non blanc : ${JSON.stringify(pixels)}`);
    assert.ok(pixels.face < 220 && pixels.shoulders < 200, `personne effacée : ${JSON.stringify(pixels)}`);
    // Visage détecté sur le portrait affiché : grand et centré (contrôle par le vrai détecteur).
    const shot = path.join(TMP, "portrait-apres.png");
    await page.screenshot({ path: shot, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    const face = JSON.parse(py(`
import json, cv2
from pathlib import Path
img = cv2.imread(${JSON.stringify(shot)}); h, w = img.shape[:2]
det = cv2.FaceDetectorYN.create(str(Path(${JSON.stringify(MODELS)}) / "face_detection_yunet_2023mar.onnx"), "", (w, h), 0.6, 0.3, 50)
_, faces = det.detect(img)
f = faces[0][:4] if faces is not None and len(faces) else None
print(json.dumps(None if f is None else {"cx": float((f[0] + f[2] / 2) / w), "h": float(f[3] / h)}))
`));
    assert.ok(face, "visage visible dans le portrait affiché");
    assert.ok(face.cx > 0.4 && face.cx < 0.6 && face.h > 0.36, `visage ${JSON.stringify(face)}`);
    // AVANT (rendu précédent : photo source 120×150 en object-fit cover) — pour comparaison visuelle.
    const old = await page.evaluate((src) => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;top:0;width:120px;height:150px;z-index:99999;border:2px dashed #cbd5e1;border-radius:10px;background:#f8fafc;overflow:hidden";
      d.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block">`;
      document.body.appendChild(d); return d.querySelector("img").decode().then(() => true);
    }, "/uploads/photos/K162-c1.jpg");
    assert.ok(old);
    const avant = path.join(TMP, "portrait-avant.png");
    await page.screenshot({ path: avant, clip: { x: 0, y: 0, width: 124, height: 154 } });
    await page.evaluate(() => document.body.lastElementChild.remove());
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.copyFileSync(avant, path.join(SHOTS, "avant.png")); fs.copyFileSync(shot, path.join(SHOTS, "apres.png")); }
    const faceBefore = JSON.parse(py(`
import json, cv2
from pathlib import Path
img = cv2.imread(${JSON.stringify(avant)}); h, w = img.shape[:2]
det = cv2.FaceDetectorYN.create(str(Path(${JSON.stringify(MODELS)}) / "face_detection_yunet_2023mar.onnx"), "", (w, h), 0.6, 0.3, 50)
_, faces = det.detect(img)
print(json.dumps(None if faces is None or not len(faces) else float(faces[0][3] / h)))
`));
    assert.ok(faceBefore === null || face.h > faceBefore * 1.2, `visage nettement plus grand qu'avant (${faceBefore} → ${face.h})`);
  });

  await t.test("« Aperçu » : la photo SOURCE complète, jamais le portrait détouré", async () => {
    await page.evaluate(() => { const id = document.querySelector(".rh-erp-photo").id.replace("rh-erp-photo-", ""); window.openAgentPhotoPreview(id); });
    await page.waitForSelector("#photo-preview-img", { timeout: 10000 });
    assert.match(await page.$eval("#photo-preview-img", (i) => i.getAttribute("src")), /\/uploads\/photos\/K162-c1\.jpg$/);
    assert.deepStrictEqual(await page.$eval("#photo-preview-img", async (i) => { await i.decode(); return [i.naturalWidth, i.naturalHeight]; }), [480, 480]);
    await page.evaluate(() => window.closeModal());
  });

  await t.test("photo source, référence faciale et tables biométriques inchangées ; portrait calculé une seule fois", async () => {
    for (let i = 0; i < 2; i++) {                                           // consultations répétées
      await page.evaluate(() => { location.hash = "#/admin/fiches"; });
      await page.waitForFunction(() => !document.querySelector(".rh-erp-photo"), { timeout: 15000 });
      await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#/admin/fiches/"]')).find((a) => /^#\/admin\/fiches\/\d+$/.test(a.getAttribute("href"))).click());
      await page.waitForSelector(".rh-erp-photo.is-portrait", { timeout: 30000 });
    }
    const after = state();
    assert.strictEqual(after.hash, before.hash, "photo source identique (SHA-256)");
    assert.deepStrictEqual([after.templates, after.syncs, after.public], [before.templates, before.syncs, before.public]);
    assert.deepStrictEqual(after.portraits, [["SEGMENTED", 300, 400]]);
    assert.strictEqual((fs.readFileSync(SERVER_LOG, "utf8").match(/Portrait DRH généré/g) || []).length, 1, "aucun recalcul à chaque affichage");
    await page.waitForFunction(() => document.querySelector(".rh-facial-ref")?.dataset.state === "READY", { timeout: 15000 });
    assert.match(await page.$eval(".rh-facial-ref", (e) => e.innerText), /Prête/);
    assert.strictEqual(/data:image|\/9j\/4/.test(fs.readFileSync(SERVER_LOG, "utf8")), false, "aucune image dans les journaux");
  });

  await t.test("responsive 1440 → 390 px : aucun débordement, portrait lisible, champs non recouverts", async () => {
    for (const width of [1440, 1280, 1024, 800, 768, 430, 390]) {
      await page.setViewport({ width, height: 900 });
      await sleep(250);
      const m = await page.evaluate(() => {
        const z = document.querySelector(".rh-erp-photo").getBoundingClientRect();
        const f = document.querySelector(".rh-erp-fields")?.getBoundingClientRect();
        const overlap = f ? !(z.right <= f.left || f.right <= z.left || z.bottom <= f.top || f.bottom <= z.top) : false;
        return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, w: z.width, h: z.height, left: z.left, right: z.right, overlap };
      });
      assert.ok(m.scroll <= m.inner + 1, `${width}px : défilement horizontal ${JSON.stringify(m)}`);
      assert.ok(m.w >= 100 && m.w <= 130 && Math.abs(m.h / m.w - 4 / 3) < 0.02, `${width}px : cadre ${JSON.stringify(m)}`);
      assert.ok(m.left >= 0 && m.right <= m.inner, `${width}px : portrait hors écran`);
      assert.strictEqual(m.overlap, false, `${width}px : portrait sur les champs`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `fiche-${width}.png`) });
    }
  });
});
