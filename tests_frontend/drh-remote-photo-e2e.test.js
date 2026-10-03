// LOT C1 — E2E réel : PC DRH → tablette de pointage → photo → PC → Enregistrer → LOT B.
// Vrai serveur uvicorn (SQLite temporaire), VRAI moteur, DEUX vrais Chrome : le PC (Fiche de
// position) et la tablette (/borne, associée par code, caméra virtuelle diffusant un portrait).
// Le PC ne reçoit aucune vidéo : état de session puis LA photo prise. Reprendre, Utiliser,
// Annuler, fermeture brutale du PC : la tablette revient toujours au pointage.
// Correctif « cercle de capture » : les vidéos de la caméra virtuelle sont générées à partir de
// la géométrie RÉELLEMENT mesurée sur la page de la tablette (taille de l'élément vidéo) : tête
// hors du cercle, front coupé, menton coupé ⇒ aucune photo ; tête centrée ⇒ photo = carré du cercle.
// Pointage facial DÉSACTIVÉ (BIOMETRIC_ENABLED=false) pendant tout le parcours.
// `npm run test:drh-remote-photo-e2e`. Exécuté seulement si ATLAS_E2E_PYTHON,
// BIOMETRIC_MODELS_DIR et BIOMETRIC_TEST_FACES sont définis (sinon skip explicite).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8987;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const ADMIN = { username: "LOTC1ADMIN", password: "lot-c1-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;

test("LOT C1 — Prise de photo distante supervisée : PC DRH → tablette → photo → fiche → référence faciale (E2E réel)", { skip: SKIP, timeout: 420000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lot_c1_"));
  const UPLOADS = path.join(TMP, "uploads");
  fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "lot-c1-e2e-secret-000000000000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "false", BIOMETRIC_ENROLLMENT_ENABLED: "true", DRH_FACIAL_REFERENCE_AUTO_SYNC_ENABLED: "true", DRH_REMOTE_PHOTO_CAPTURE_ENABLED: "true", FACIAL_REFERENCE_CONSENT_MODE: "no_objection", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS };
  const SERVER_LOG = path.join(TMP, "server.log");
  const py = (code) => execFileSync(PY, ["-c", code], { cwd: REPO_ROOT, env }).toString().trim().split("\n").pop();
  let server, browser, tabletBrowser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (tabletBrowser) await tabletBrowser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  });
  const VIDEO = path.join(TMP, "portrait.mjpeg");
  const TABLET_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lotc1_tab_"));   // identité de la borne conservée entre relances
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
from app.modules.biometrics.models import BiometricConsent, BiometricPhotoSync, BiometricRemoteCaptureSession, BiometricTemplate
from app.modules.attendance.models import AttendanceEvent
from app.modules.drh.models import Employee
S = SessionLocal(); e = S.query(Employee).filter(Employee.code == "LOTC-01").one()
sync = S.query(BiometricPhotoSync).filter(BiometricPhotoSync.employee_id == e.id).one_or_none()
print(json.dumps({"templates": [[t.status, t.source] for t in S.query(BiometricTemplate).filter(BiometricTemplate.employee_id == e.id).order_by(BiometricTemplate.id)],
  "sync": [sync.status, sync.reason_code, sync.source, bool(sync.previous_reference_kept)] if sync else None,
  "sessions": [[x.status, x.reason_code, x.photo_encrypted is None, x.active_terminal_id] for x in S.query(BiometricRemoteCaptureSession).order_by(BiometricRemoteCaptureSession.id)],
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
  let page, tablet, siteId, adminToken;
  const kiosk = { errors: [], paths: [] };
  const pcRequests = [];
  await t.test("serveur réel + connexion Administration système + ouverture de la fiche", async () => {
    const logFd = fs.openSync(SERVER_LOG, "w");
    server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env, stdio: ["ignore", logFd, logFd] });
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) {
      try { ok = (await fetch(BASE + "/api/auth/admin-system-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ADMIN) })).status === 200; } catch (e) { /* démarrage */ }
      if (!ok) await sleep(300);
    }
    assert.ok(ok, "serveur E2E non prêt");
    siteId = Number(py(`
import app.main
from datetime import date, timedelta
from app.db.session import SessionLocal
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
S = SessionLocal()
site = Site(name="HAMOUL 01 E2E", active=1, equipment_plan={"societe": "IRON GLOBAL SOLUTION"}); S.add(site); S.flush()
e = Employee(code="LOTC-01", first_name="Barack", last_name="LotC", society="IRON GLOBAL SOLUTION", status="actif", position="CARISTE")
S.add(e); S.flush()
S.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
S.commit(); print(site.id)
`));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_lotc1_pc_")),
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

  const api = async (pathname, { method = "GET", body } = {}) => {
    const res = await fetch(BASE + "/api" + pathname, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const kioskState = () => tablet.$eval("#kioskStatus", (e) => e.dataset.state);
  const kioskText = () => tablet.$eval("#kioskStatus", (e) => e.innerText.replace(/\s+/g, " ").trim());
  const waitKiosk = async (wanted, timeout = 30000) => {
    try { await tablet.waitForFunction((w) => document.querySelector("#kioskStatus").dataset.state === w, { timeout }, wanted); }
    catch (e) { throw new Error(`tablette attendue ${wanted} : ` + JSON.stringify({ state: await kioskState(), text: await kioskText(), errors: kiosk.errors, db: state().sessions })); }
  };
  const unlock = async () => {
    if (await page.evaluate(() => document.body.classList.contains("sgdi-view-mode"))) {
      await page.evaluate(() => document.getElementById("sgdi-edit-toggle").click());
      await page.waitForFunction(() => !document.body.classList.contains("sgdi-view-mode"), { timeout: 8000 });
    }
  };
  // « Prendre la photo » → choix de l'appareil → tablette → « Continuer ».
  const startRemote = async () => {
    await unlock();
    await page.evaluate(() => document.querySelector('[id^="rh-photo-camera-"]').click());
    await page.waitForSelector("#photo-source-title", { timeout: 15000 });
    const picked = await page.evaluate(() => {
      const option = Array.from(document.querySelectorAll(".photo-source-option")).find((o) => /TAB-HAMOUL-C1/.test(o.textContent));
      const input = option.querySelector("input");
      input.click();
      return { text: option.innerText.replace(/\s+/g, " ").trim(), disabled: input.disabled, checked: input.checked };
    });
    await page.click("#photo-source-continue");
    await page.waitForSelector("#photo-remote-title", { timeout: 15000 });
    return picked;
  };
  const waitPreview = () => page.waitForFunction(() => { const img = document.getElementById("photo-remote-shot"); return img && !img.hidden && img.naturalWidth > 0; }, { timeout: 60000 });

  let caseVideos = {}, guide = null;
  const launchTablet = async (video, url) => {
    if (tabletBrowser) { await tabletBrowser.close().catch(() => {}); tabletBrowser = null; }
    tabletBrowser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: TABLET_PROFILE,
      args: ["--no-first-run", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`,
        `--host-resolver-rules=MAP pointeur.irongs.com 127.0.0.1:${PORT}`, "--unsafely-treat-insecure-origin-as-secure=http://pointeur.irongs.com"] });
    tablet = await tabletBrowser.newPage();
    await tablet.setViewport({ width: 1280, height: 800 });                // Galaxy Tab paysage
    tablet.on("pageerror", (e) => kiosk.errors.push(String(e)));
    tablet.on("request", (r) => { if (r.url().includes("/api/")) kiosk.paths.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await tablet.goto(url || "http://pointeur.irongs.com/borne", { waitUntil: "domcontentloaded" });
  };
  const ready = async () => {
    await waitKiosk("FACIAL_OFF", 20000);
    await tablet.waitForFunction(() => window.AtlasBorne.commandAt > 0, { timeout: 10000 });
  };
  const lastSession = () => state().sessions.at(-1);
  await t.test("tablette associée par code à usage unique, EN LIGNE, en mode pointage (facial désactivé)", async () => {
    adminToken = (await (await fetch(BASE + "/api/auth/admin-system-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ADMIN) })).json()).access_token;
    const term = await api("/biometrics/terminals", { method: "POST", body: { name: "TAB-HAMOUL-C1", terminal_type: "TABLET_ANDROID", site_id: siteId } });
    assert.strictEqual(term.status, 200, JSON.stringify(term.data));
    const code = (await api(`/biometrics/terminals/${term.data.id}/pairing-code`, { method: "POST" })).data;
    await launchTablet(VIDEO, `http://pointeur.irongs.com/borne${code.pair_path.slice("/borne".length)}`);
    await tablet.waitForFunction(() => document.querySelector("#pairCode").value.length === 10, { timeout: 10000 });
    await tablet.click("#pairSubmit");
    await waitKiosk("FACIAL_OFF", 20000);                                  // BIOMETRIC_ENABLED=false : pas de pointage facial
    assert.strictEqual(await tablet.$eval("#kioskMode", (e) => e.hidden), true);
    await tablet.waitForFunction(() => window.AtlasBorne.commandAt > 0, { timeout: 10000 });   // première relève de commande = en ligne
    page.on("request", (r) => { if (r.url().includes("/remote-photo/")) pcRequests.push(`${r.method()} ${new URL(r.url()).pathname.replace(/sessions\/[^/]+/, "sessions/:id")}`); });
    // Géométrie RÉELLE du cercle sur cette tablette, pour une caméra 1280×720.
    // (mesurée en mode prise de photo : la zone de texte y a une hauteur fixe)
    const box = await tablet.evaluate(() => {
      const badge = document.getElementById("kioskMode");
      document.body.classList.add("kiosk-capturing"); badge.hidden = false; badge.textContent = "PRISE DE PHOTO EN COURS";
      const r = document.getElementById("kioskVideo").getBoundingClientRect();
      document.body.classList.remove("kiosk-capturing"); badge.hidden = true; badge.textContent = "";
      return { elW: r.width, elH: r.height };
    });
    guide = await tablet.evaluate((view) => window.AtlasBorne.guideGeometry(view), { ...box, vw: 1280, vh: 720 });
    assert.ok(guide && guide.video.side > 300, JSON.stringify(guide));
    // Vidéos : la TÊTE (estimée comme le serveur, à partir de la boîte du VRAI détecteur) placée
    // par rapport au cercle. dx/dy en fraction du rayon sûr ; écran miroir pour les consignes.
    caseVideos = JSON.parse(py(`
import io, json
from PIL import Image
from app.modules.biometrics.engine import OpenCvFaceEngine
from app.modules.biometrics import framing
eng = OpenCvFaceEngine(${JSON.stringify(MODELS)})
src = Image.open(${JSON.stringify(path.join(FACES, "obama2.jpg"))}).convert("RGB"); src.thumbnail((470, 640))
b = io.BytesIO(); src.save(b, "JPEG", quality=92)
x, y, w, h = eng.analyze(b.getvalue()).faces[0].bbox
hx, hy, hw, hh = framing.head_box((x, y, w, h))
sx, sy, side = ${guide.video.sx}, ${guide.video.sy}, ${guide.video.side}
safe = framing.SAFE_RATIO * side / 2
out = {}
for name, dx, dy in (("centre", 0, 0), ("hors_cercle", 0.80, 0), ("front_coupe", 0, -0.62), ("menton_coupe", 0, 0.62)):
    k = (0.72 * 2 * safe) / hh
    face = src.resize((round(src.width * k), round(src.height * k)))
    cx, cy = sx + side / 2 + dx * safe, sy + side / 2 + dy * safe
    left, top = round(cx - (hx + hw / 2) * k), round(cy - (hy + hh / 2) * k)
    path = ${JSON.stringify(TMP)} + "/" + name + ".mjpeg"
    with open(path, "wb") as f:
        for n in range(60):
            canvas = Image.new("RGB", (1280, 720), (52, 58, 66)); canvas.paste(face, (left, top))
            d = (n % 3 - 1) * 2
            frame = canvas.point(lambda v, d=d: max(0, min(255, v + d)))
            if n == 0:
                frame.save(${JSON.stringify(TMP)} + "/" + name + "-ref.png")
            bb = io.BytesIO(); frame.save(bb, "JPEG", quality=92); f.write(bb.getvalue())
    out[name] = path
print(json.dumps(out))
`));
  });

  // Tête hors de la zone sûre : consigne correspondante, cercle jamais vert, AUCUNE photo candidate.
  for (const [name, label, instruction] of [["hors_cercle", "visage partiellement hors du cercle", /Déplacez-vous légèrement vers la (droite|gauche)/],
    ["front_coupe", "front coupé", /Descendez légèrement/], ["menton_coupe", "menton coupé", /Montez légèrement/]]) {
    await t.test(`CAS ${label} : consigne « ${instruction.source.replace(/\\/g, "")} », aucune photo candidate`, async () => {
      await launchTablet(caseVideos[name]);
      await ready();
      await startRemote();
      await waitKiosk("CAPTURE");
      try { await tablet.waitForFunction((re) => new RegExp(re).test(document.querySelector("#kioskStatus").innerText), { timeout: 20000 }, instruction.source); }
      catch (e) { throw new Error(`${label} : ` + JSON.stringify({ text: await kioskText(), session: lastSession() })); }
      await sleep(5000);                                                      // bien au-delà de la période de stabilité
      assert.match(await kioskText(), instruction);
      assert.doesNotMatch(await tablet.$eval(".kiosk-frame", (e) => e.className), /guide-ok/, "cercle jamais vert");
      const row = lastSession();
      assert.deepStrictEqual([row[0], row[2]], ["WAITING_FOR_FACE", true], "aucune photo candidate");
      assert.strictEqual(await page.$eval("#photo-remote-shot", (e) => e.hidden), true);
      assert.strictEqual(await page.$eval("#photo-remote-use", (e) => e.hidden), true);
      await page.click("#photo-remote-cancel");
      await page.waitForFunction(() => !document.getElementById("photo-remote-title"), { timeout: 10000 });
      await waitKiosk("FACIAL_OFF");
    });
  }

  await t.test("CAS tête centrée : cercle vert, capture ; le PC reçoit SEULEMENT le carré du cercle (aucune vidéo)", async () => {
    await launchTablet(caseVideos.centre);
    await ready();
    await page.waitForFunction(() => document.querySelector(".rh-facial-ref")?.dataset.state === "NONE", { timeout: 15000 });
    const picked = await startRemote();
    assert.match(picked.text, /^Tablette TAB-HAMOUL-C1 HAMOUL 01 E2E ● En ligne$/);
    assert.deepStrictEqual([picked.disabled, picked.checked], [false, true]);
    assert.match(await page.$eval("#photo-remote-title", (e) => e.textContent), /Photo prise avec Tablette TAB-HAMOUL-C1/);
    assert.strictEqual(await page.$("#modal-host video"), null, "aucun flux vidéo sur le PC");
    await waitKiosk("CAPTURE");
    assert.match(await kioskText(), /^PRISE DE PHOTO LotC Barack/);
    assert.deepStrictEqual(await tablet.$eval("#kioskMode", (e) => [e.hidden, e.textContent]), [false, "PRISE DE PHOTO EN COURS"]);
    await waitPreview();
    assert.match(await kioskText(), /Photo prise — vérification en cours/);
    assert.strictEqual(await page.$eval("#photo-remote-checks", (e) => e.innerText.replace(/\s+/g, " ").trim()), "✓ Visage détecté ✓ Cadrage conforme ✓ Qualité suffisante");
    assert.match(await tablet.$eval(".kiosk-frame", (e) => e.className), /is-guide guide-ok|guide-ok/, "cercle vert");
    // CAS 5 : l'aperçu est le carré du cercle — mêmes dimensions et même contenu que la zone
    // correspondante de l'image caméra (et non l'image caméra complète 1280×720).
    const preview = await page.evaluate(async () => {
      const img = document.getElementById("photo-remote-shot");
      const blob = await (await fetch(img.src)).blob();
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
      return { w: img.naturalWidth, h: img.naturalHeight, b64 };
    });
    assert.strictEqual(preview.w, preview.h);
    const live = await tablet.evaluate(() => { const v = document.getElementById("kioskVideo"), r = v.getBoundingClientRect();
      return window.AtlasBorne.guideGeometry({ elW: r.width, elH: r.height, vw: v.videoWidth, vh: v.videoHeight }); });
    assert.deepStrictEqual(live, guide, "géométrie stable pendant la prise (celle qui a servi à placer la tête)");
    assert.strictEqual(preview.w, Math.round(Math.min(640, guide.video.side)));
    const previewFile = path.join(TMP, "preview.jpg");
    fs.writeFileSync(previewFile, Buffer.from(preview.b64, "base64"));
    const diff = JSON.parse(py(`
import json
from PIL import Image, ImageChops, ImageStat
ref = Image.open(${JSON.stringify(path.join(TMP, "centre-ref.png"))}).convert("RGB")
sx, sy, side = ${guide.video.sx}, ${guide.video.sy}, ${guide.video.side}
got = Image.open(${JSON.stringify(previewFile)}).convert("RGB")
expected = ref.crop((round(sx), round(sy), round(sx + side), round(sy + side))).resize(got.size)
full = ref.resize(got.size)
mean = lambda a, b: sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3
print(json.dumps({"crop": mean(got, expected), "full": mean(got, full)}))
`));
    assert.ok(diff.crop < 12, `aperçu ≠ zone du cercle : ${JSON.stringify(diff)}`);
    assert.ok(diff.full > 2 * diff.crop, `l'aperçu ne doit pas être l'image complète : ${JSON.stringify(diff)}`);
    assert.deepStrictEqual(await page.evaluate(() => ["photo-remote-retake", "photo-remote-use", "photo-remote-cancel"].map((id) => !document.getElementById(id).hidden)), [true, true, true]);
    const s = state();
    assert.deepStrictEqual([s.sessions.at(-1)[0], s.sessions.at(-1)[2]], ["PREVIEW_READY", false], "photo candidate dans la session, chiffrée");
    assert.deepStrictEqual([s.templates, s.sync, s.photo], [[], null, ""], "rien dans la fiche, aucune référence");
    assert.strictEqual(pcRequests.filter((r) => r.endsWith("/preview")).length, 1, "une seule image reçue par le PC");
  });

  await t.test("Reprendre : la tablette recommence ; Utiliser cette photo : formulaire rempli, tablette revenue au pointage", async () => {
    await page.click("#photo-remote-retake");
    await page.waitForFunction(() => document.getElementById("photo-remote-shot").hidden, { timeout: 10000 });
    await tablet.waitForFunction(() => !/Photo prise/.test(document.querySelector("#kioskStatus").innerText), { timeout: 15000 });
    await waitPreview();
    assert.strictEqual(pcRequests.filter((r) => r.endsWith("/preview")).length, 2);
    await page.click("#photo-remote-use");
    await page.waitForFunction(() => !document.getElementById("photo-remote-title"), { timeout: 10000 });
    assert.match(await page.$eval('#agent-form [name="photo"]', (el) => el.value.slice(0, 23)), /^data:image\/jpeg;base64,/);
    assert.match(await page.$eval(".rh-photo-check", (el) => el.textContent), /Photo exploitable.*Enregistrez la fiche/);
    await waitKiosk("FACIAL_OFF");                                         // retour automatique au pointage
    assert.strictEqual(await tablet.$eval("#kioskMode", (e) => e.hidden), true);
    const s = state();
    assert.deepStrictEqual(s.sessions.at(-1), ["ACCEPTED", null, true, null], "session close, photo candidate effacée");
    assert.deepStrictEqual([s.templates, s.sync, s.photo], [[], null, ""], "« Utiliser cette photo » n'enregistre pas la fiche");
  });

  await t.test("Enregistrer la fiche → LOT B : « ✓ Prête », provenance DRH_REMOTE_TERMINAL", async () => {
    const saves = [];
    page.on("request", (r) => { if (/\/api\/drh\/employees\/\d+(\?|$)/.test(r.url()) && r.method() === "PUT") saves.push(new URL(r.url()).search); });
    await saveFiche();
    await waitRef("READY");
    assert.match(await refText(), /^✓ Prête/);
    assert.deepStrictEqual(saves, ["?photo_source=DRH_REMOTE_TERMINAL"]);
    const s = state();
    assert.deepStrictEqual(s.templates, [["ACTIVE", "EMPLOYEE_PHOTO"]]);
    assert.deepStrictEqual(s.sync, ["READY", null, "DRH_REMOTE_TERMINAL", false]);
    assert.deepStrictEqual([s.photo, s.events, s.consents, s.biometric_enabled], ["/uploads/photos", 0, 0, false]);
  });

  await t.test("Annuler la prise, puis fermeture brutale du PC : la tablette revient toujours au pointage", async () => {
    await startRemote();
    await waitKiosk("CAPTURE");
    await page.click("#photo-remote-cancel");
    await page.waitForFunction(() => !document.getElementById("photo-remote-title"), { timeout: 10000 });
    await waitKiosk("FACIAL_OFF");
    assert.strictEqual(lastSession()[0], "CANCELLED");
    // Le navigateur du PC disparaît pendant une prise (aucune annulation propre possible).
    await startRemote();
    await waitKiosk("CAPTURE");
    const pcProcess = browser.process();
    browser = null;
    pcProcess.kill("SIGKILL");
    await waitKiosk("FACIAL_OFF", 45000);
    const s = state();
    assert.deepStrictEqual(s.sessions.at(-1), ["CANCELLED", "OPERATOR_GONE", true, null]);
    assert.deepStrictEqual([s.templates, s.events, s.biometric_enabled], [[["ACTIVE", "EMPLOYEE_PHOTO"]], 0, false], "aucune référence ni pointage créé par les prises annulées");
  });

  await t.test("tablette : aucune erreur, aucun appel de pointage pendant les prises ; journaux sans image", async () => {
    assert.deepStrictEqual(kiosk.errors, []);
    assert.ok(kiosk.paths.filter((p) => p.endsWith("/terminal/capture/check")).length >= 6, "contrôles de cadrage en direct");
    assert.strictEqual(kiosk.paths.some((p) => /terminal\/(recognize|challenge|qr)$/.test(p)), false);
    assert.ok(kiosk.paths.filter((p) => p.endsWith("/terminal/capture/photo")).length >= 2);
    const log = fs.readFileSync(SERVER_LOG, "utf8");
    assert.strictEqual(/data:image|\/9j\/4/.test(log), false, "aucune image dans les journaux");
    for (const event of ["requested", "acknowledged", "captured", "retake", "accepted", "cancelled"]) assert.match(log, new RegExp(`drh\\.remote_photo\\.${event}`));
  });
});
