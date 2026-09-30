// ATLAS Mode Test biométrique — E2E HOSTILE de bout en bout (revue finale).
// Vrai serveur uvicorn (SQLite temporaire), VRAI moteur (YuNet + SFace + MiniFASNetV2), vrai
// Chrome dont la caméra virtuelle diffuse un portrait (--use-file-for-fake-video-capture) :
// le parcours réel navigateur → /api/biometrics/test-mode/recognize → moteur → résultat, sans
// aucun pointage. `npm run test:biometric-test-mode-real-e2e`.
// Exécuté seulement si :
//   ATLAS_E2E_PYTHON     → python disposant d'opencv/numpy/Pillow (requirements-biometric.txt)
//   BIOMETRIC_MODELS_DIR → modèles vérifiés ; BIOMETRIC_TEST_FACES → obama1.jpg / obama2.jpg
// Sinon : skip explicite (jamais compté comme réussi).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8981;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const SOC = "Iron Global Securite";
const SOC_B = "Sword Corporation";
const ADMIN = { username: "tme2eadmin", password: "tm-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0="; // clé Fernet de test (32 octets)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;

test("Mode Test biométrique — E2E hostile, vrai moteur", { skip: SKIP, timeout: 300000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_bio_test_mode_"));
  const UPLOADS = path.join(TMP, "uploads");
  const SERVER_LOG = path.join(TMP, "server.log");
  fs.mkdirSync(UPLOADS, { recursive: true });
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "bio-test-mode-e2e-secret-000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "false", BIOMETRIC_TEST_MODE_ENABLED: "true", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS,
    BIOMETRIC_TEST_MODE_MAX_PER_MINUTE: "30" };
  const py = (code) => execFileSync(PY, ["-c", code], { cwd: REPO_ROOT, env }).toString().trim().split("\n").pop();
  const api = async (p, { method = "GET", token, body, raw } = {}) => {
    const headers = { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body !== undefined || raw ? { "Content-Type": "application/json" } : {}) };
    const res = await fetch(BASE + "/api" + p, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* non JSON */ }
    return { status: res.status, data };
  };
  const login = async (u, p) => (await api("/auth/login", { method: "POST", body: { username: u, password: p } })).data.access_token;
  const counts = () => JSON.parse(py(`
import json, app.main
from sqlalchemy import func, select
from app.db.base import Base
from app.db.session import SessionLocal
S = SessionLocal()
print(json.dumps({t.name: S.execute(select(func.count()).select_from(t)).scalar_one() for t in Base.metadata.sorted_tables if t.name != "audit_events"}))
`));
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  // Caméra virtuelle : portrait obama2 (le gabarit vient d'obama1 : autre photo, même personne).
  // Variation de luminosité de ±2 niveaux par trame : les trames diffèrent (comme un capteur
  // réel) sans dégrader l'image (un bruit ajouté fait chuter le liveness).
  const video = (mode) => {
    const file = path.join(TMP, `${mode}.mjpeg`);   // mode : "live"
    py(`
import io, random
from PIL import Image
img = Image.open(${JSON.stringify(path.join(FACES, "obama2.jpg"))}).convert("RGB")
img.thumbnail((960, 960))
canvas = Image.new("RGB", (1280, 960), (40, 40, 40)); canvas.paste(img, ((1280 - img.width) // 2, (960 - img.height) // 2))
out = open(${JSON.stringify(file)}, "wb")
for i in range(40):
    frame = canvas.point(lambda v, d=(i % 3 - 1) * 2: max(0, min(255, v + d)))
    b = io.BytesIO(); frame.save(b, "JPEG", quality=90); out.write(b.getvalue())
out.close(); print("ok")
`);
    return file;
  };

  const ids = {}, tokens = {};
  await t.test("serveur réel, moteur réel, données", async () => {
    const logFd = fs.openSync(SERVER_LOG, "w");
    server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env, stdio: ["ignore", logFd, logFd] });
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) { try { ok = (await api("/auth/admin-system-login", { method: "POST", body: ADMIN })).status === 200; } catch (e) { /* démarrage */ } if (!ok) await sleep(300); }
    assert.ok(ok, "serveur E2E non prêt");
    const out = py(`
import app.main, io
from datetime import date, timedelta
from PIL import Image
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.auth.models import User, UserFeaturePermission
from app.modules.biometrics import crypto
from app.modules.biometrics.engine import OpenCvFaceEngine
from app.modules.biometrics.models import BiometricConsent, BiometricTemplate
from app.modules.biometrics.service import NOTICE_VERSION
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
S = SessionLocal()
img = Image.open(${JSON.stringify(path.join(FACES, "obama1.jpg"))}).convert("RGB"); img.thumbnail((1280, 1280)); b = io.BytesIO(); img.save(b, "JPEG")
vec = OpenCvFaceEngine(${JSON.stringify(MODELS)}).analyze(b.getvalue()).faces[0].embedding
a = Site(name="Site Test A", active=1, equipment_plan={"societe": "${SOC}"}); a2 = Site(name="Site Test A2", active=1, equipment_plan={"societe": "${SOC}"})
bb = Site(name="Site Test B", active=1, equipment_plan={"societe": "${SOC_B}"})
S.add_all([a, a2, bb]); S.flush()
emps = []
for code, soc, site in (("TM-A", "${SOC}", a), ("TM-B", "${SOC_B}", bb)):
    e = Employee(code=code, first_name="Barack", last_name="Portrait", society=soc, status="actif", position="Agent test"); S.add(e); S.flush()
    S.add(Assignment(employee_id=e.id, site_id=site.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
    c = BiometricConsent(employee_id=e.id, status="contract_confirmed", source="EMPLOYMENT_CONTRACT", proof_reference="Contrat E2E", notice_version=NOTICE_VERSION)
    S.add(c); S.flush()
    S.add(BiometricTemplate(employee_id=e.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(vec), engine="opencv", config_version=1,
                            source="CAMERA", quality={}, consent_id=c.id)); emps.append(e)
def user(name, modules, societies, sites, features):
    u = User(username=name, full_name=name, role="ops", access_level="H3", password_hash=hash_password(name + "-pass"), is_active=True,
             authorized_modules=modules, authorized_societies=societies, authorized_sites=sites, authorized_structures=[],
             authorized_actions=["read", "create", "update", "validate"]); S.add(u); S.flush()
    for f, act in features: S.add(UserFeaturePermission(user_id=u.id, module_key="attendance", feature_key=f, action_key=act))
BIO = [("biometric_admin", "validate")]
user("tmtester", ["pointage"], ["${SOC}"], [a.id], BIO)
user("tmburst", ["pointage"], ["${SOC}"], [a.id], BIO)
user("tmnoperm", ["pointage"], ["${SOC}"], [a.id], [("biometric_status", "read"), ("biometric_enrollment", "create")])
user("tmnomodule", ["fac"], ["${SOC}"], [a.id], BIO)
user("tmsiteb", ["pointage"], ["${SOC_B}"], [bb.id], BIO)
S.commit()
print(a.id, a2.id, bb.id, emps[0].id, emps[1].id)
`);
    [ids.siteA, ids.siteA2, ids.siteB, ids.empA, ids.empB] = out.split(" ").map(Number);
    tokens.admin = (await api("/auth/admin-system-login", { method: "POST", body: ADMIN })).data.access_token;
    for (const u of ["tmtester", "tmburst", "tmnoperm", "tmnomodule", "tmsiteb"]) tokens[u] = await login(u, u + "-pass");
    // Caméra de PRODUCTION déclarée (pour tenter l'injection d'images sur la route réelle).
    const model = await api("/biometrics/camera-models", { method: "POST", token: tokens.admin, body: { manufacturer: "DAHUA", model: "E2E test-mode", adapter: "DAHUA" } });
    const cam = await api("/biometrics/cameras", { method: "POST", token: tokens.admin, body: { name: "CAM-PROD", camera_model_id: model.data.id,
      site_id: ids.siteA, host: "127.0.0.1", http_port: 1, usage: "ATTENDANCE", role: "ENTRY" } });
    assert.strictEqual(cam.status, 200, JSON.stringify(cam.data));
    ids.cam = cam.data.id;
    const status = await api("/biometrics/test-mode/status", { token: tokens.tmtester });
    assert.deepStrictEqual([status.data.test_mode_enabled, status.data.production_enabled, status.data.engine_available, status.data.permitted],
      [true, false, true, true], JSON.stringify(status.data));
    ids.before = counts();
  });

  const apiErrors = [], consoleErrors = [], pageApiCalls = [], results = [];
  const openApp = async (videoFile) => {
    if (browser) await browser.close().catch(() => {});
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_bio_chrome_")),
      args: ["--no-first-run", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${videoFile}`,
        `--host-resolver-rules=MAP pointage.irongs.com 127.0.0.1:${PORT}`, "--unsafely-treat-insecure-origin-as-secure=http://pointage.irongs.com"] });
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
    page.on("request", (r) => { if (r.url().includes("/api/")) pageApiCalls.push(new URL(r.url()).pathname); });
    page.on("response", async (r) => {
      if (!r.url().includes("/api/")) return;
      if (r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
      if (r.url().includes("/test-mode/recognize") && r.ok()) { try { results.push(await r.json()); } catch (e) { /* corps consommé */ } }
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto("http://pointage.irongs.com/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#login-user", { visible: true });
    await page.type("#login-user", "tmtester");
    await page.type("#login-pass", "tmtester-pass");
    await page.click("#login-btn");
    await page.waitForSelector('[data-view="test-mode"]:not(.hidden)', { timeout: 20000 });
    await page.click('[data-view="test-mode"]');
    await page.waitForFunction((id) => [...document.querySelectorAll("#tm-site option")].some((o) => o.value === String(id)), { timeout: 20000 }, ids.siteA);
    await page.select("#tm-site", String(ids.siteA));
    return page;
  };
  const stateText = (page) => page.$eval("#tm-state", (el) => el.textContent);

  await t.test("navigateur → moteur réel : décision réelle, aucun pointage ; responsive ; cycle de vie caméra", async () => {
    // La reconnaissance POSITIVE avec le vrai moteur est prouvée au niveau API
    // (tests/test_biometrics_test_mode.py::test_real_engine_test_mode_pipeline) : ici, un portrait
    // diffusé par la caméra virtuelle est une photo — le liveness la refuse le plus souvent (mesuré
    // 0,11–0,63, parfois 0,81) ; exiger « reconnu » rendrait le test dépendant d'un échec anti-spoof.
    const page = await openApp(video("live"));
    await page.click("#tm-start");
    await page.waitForFunction(() => !document.querySelector("#tm-result").classList.contains("hidden"), { timeout: 45000 });
    // Le corps de la réponse interceptée est lu de façon asynchrone côté Node : la page peut
    // afficher le résultat avant que `results` ne soit rempli.
    for (let i = 0; i < 100 && !results.length; i++) await sleep(50);
    const first = results[0];
    assert.ok(first && first.recorded === false && first.mode === "TEST", JSON.stringify(first));
    assert.ok(["RECOGNIZED", "LIVENESS_FAILED"].includes(first.state), first.state);            // visage réel détecté
    assert.ok(first.quality.face_px > 100 && first.quality.detection_score > 0.9, JSON.stringify(first.quality));
    assert.ok(["PASS", "FAIL"].includes(first.liveness.result), JSON.stringify(first.liveness));
    if (first.state === "RECOGNIZED") assert.strictEqual(first.employee.employee_id, ids.empA);
    else assert.strictEqual(first.employee, null);
    assert.match(await page.$eval(".test-mode-warning", (el) => el.textContent), /AUCUN POINTAGE NE SERA ENREGISTRÉ/);
    assert.match(await page.$eval(".test-mode-disclaimer", (el) => el.textContent), /ne valide pas la sécurité du liveness/);
    assert.match(await page.$eval("#tm-result", (el) => el.textContent), first.state === "RECOGNIZED" ? /VISAGE RECONNU/ : /LIVENESS REFUSÉ/);
    console.log("# réel navigateur :", first.state, "liveness", JSON.stringify(first.liveness), "timings (ms)", JSON.stringify(first.timings_ms));
    for (const [width, height] of [[1440, 900], [1024, 800], [768, 1024], [390, 844]]) {
      await page.setViewport({ width, height });
      await sleep(200);
      const s = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        video: document.querySelector("#tm-video").getBoundingClientRect().width, result: !document.querySelector("#tm-result").classList.contains("hidden"),
        stop: document.querySelector("#tm-stop").getBoundingClientRect().height }));
      assert.deepStrictEqual([s.overflow, s.video > 0, s.result, s.stop >= 44], [false, true, true, true], `${width}px ${JSON.stringify(s)}`);
    }
    await page.setViewport({ width: 1440, height: 900 });
    // Navigation pendant la capture : caméra libérée, plus aucune analyse.
    await page.click('[data-view="board"]');
    const after = await page.evaluate(() => ({ running: window.ATLASTestMode.state.running, stream: window.ATLASTestMode.state.stream, src: document.querySelector("#tm-video").srcObject }));
    assert.deepStrictEqual(after, { running: false, stream: null, src: null });
    const calls = pageApiCalls.filter((p) => p.endsWith("/test-mode/recognize")).length;
    await sleep(3500);
    assert.strictEqual(pageApiCalls.filter((p) => p.endsWith("/test-mode/recognize")).length, calls, "aucune analyse après navigation");
    // Caméra interrompue (piste terminée par le système).
    await page.click('[data-view="test-mode"]');
    await page.select("#tm-site", String(ids.siteA));
    await page.click("#tm-start");
    await page.waitForFunction(() => window.ATLASTestMode.state.stream, { timeout: 15000 });
    await page.evaluate(() => { const track = window.ATLASTestMode.state.stream.getVideoTracks()[0]; track.stop(); track.dispatchEvent(new Event("ended")); });
    await page.waitForFunction(() => /CAMÉRA INTERROMPUE/.test(document.querySelector("#tm-state").textContent), { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => window.ATLASTestMode.state.stream), null);
    await sleep(800);   // la session interrompue ne doit rien réécrire ensuite (défaut corrigé en revue)
    assert.match(await stateText(page), /CAMÉRA INTERROMPUE/);
    // Arrêt PENDANT getUserMedia : la piste obtenue ensuite est immédiatement libérée.
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__tracks = [];
      navigator.mediaDevices.getUserMedia = async (c) => { await new Promise((r) => setTimeout(r, 1200)); const s = await original(c); window.__tracks.push(...s.getTracks()); return s; };
    });
    await page.click("#tm-start");
    await page.waitForFunction(() => window.ATLASTestMode.state.running, { timeout: 5000 });   // getUserMedia en cours
    await page.click("#tm-stop");
    await sleep(2000);
    const late = await page.evaluate(() => ({ states: window.__tracks.map((tr) => tr.readyState), stream: window.ATLASTestMode.state.stream, running: window.ATLASTestMode.state.running }));
    assert.deepStrictEqual(late, { states: ["ended"], stream: null, running: false });
    assert.match(await stateText(page), /PRÊT/);
    await browser.close(); browser = null;
  });

  // Image figée : prouvée au niveau du moteur réel (test_biometrics_engine_real.py) — la
  // caméra virtuelle de Chrome ne garantit pas des trames identiques au pixel près, un scénario
  // navigateur ne serait donc pas déterministe.

  await t.test("attaques par l'API : production, forge, périmètre, taille, format, rafale", async () => {
    const tiny = execFileSync(PY, ["-c", "import io,base64;from PIL import Image;b=io.BytesIO();Image.new('RGB',(64,48)).save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())"]).toString().trim();
    const frames = [tiny];
    // Injection d'images navigateur sur la route de PRODUCTION : refus (production désactivée).
    const injected = await api(`/biometrics/cameras/${ids.cam}/recognize`, { method: "POST", token: tokens.admin, body: { frames } });
    assert.strictEqual(injected.status, 503, JSON.stringify(injected.data));
    // Authentification / module / permission / périmètre.
    assert.strictEqual((await api("/biometrics/test-mode/recognize", { method: "POST", body: { site_id: ids.siteA, frames } })).status, 401);
    assert.strictEqual((await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmnoperm, body: { site_id: ids.siteA, frames } })).status, 403);
    assert.strictEqual((await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmnomodule, body: { site_id: ids.siteA, frames } })).status, 403);
    for (const [who, site] of [["tmtester", ids.siteB], ["tmtester", ids.siteA2], ["tmsiteb", ids.siteA]]) {
      assert.strictEqual((await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens[who], body: { site_id: site, frames } })).status, 404, `${who} → ${site}`);
    }
    // Payload forgé : « recorded: true » ou champs de production ne changent rien.
    const forged = await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmtester,
      body: { site_id: ids.siteA, frames, recorded: true, mode: "PRODUCTION", employee_id: ids.empA, camera_id: ids.cam, burst_id: "x" } });
    assert.deepStrictEqual([forged.status, forged.data.recorded, forged.data.mode], [200, false, "TEST"]);
    // Taille et format.
    const big = await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmtester, raw: `{"site_id": ${ids.siteA}, "frames": ["${"A".repeat(25_000_000)}"]}` });
    assert.deepStrictEqual([big.status, big.data.detail.code], [413, "IMAGE_TOO_LARGE"]);
    const invalid = await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmtester, body: { site_id: ids.siteA, frames: [Buffer.from("<script>").toString("base64")] } });
    assert.deepStrictEqual([invalid.status, invalid.data.detail.code], [422, "INVALID_IMAGE"]);
    // Rafale excessive : 429 au-delà de la limite par minute, pour ce compte seulement.
    const statuses = [];
    for (let i = 0; i < 34; i++) statuses.push((await api("/biometrics/test-mode/recognize", { method: "POST", token: tokens.tmburst, body: { site_id: ids.siteA, frames } })).status);
    assert.ok(statuses.slice(0, 30).every((s) => s === 200) && statuses.slice(30).every((s) => s === 429), statuses.join(","));
  });

  await t.test("zéro écriture, aucune image conservée (base, fichiers, journaux, audit)", async () => {
    const after = counts();
    const changed = Object.keys(ids.before).filter((k) => ids.before[k] !== after[k]).map((k) => `${k}: ${ids.before[k]} → ${after[k]}`);
    assert.deepStrictEqual(changed, [], "aucune table modifiée (présences, événements, anomalies, gabarits, config…)");
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : files.push(d.name)));
    walk(UPLOADS);
    assert.deepStrictEqual(files, [], "aucun fichier écrit dans uploads");
    const log = fs.readFileSync(SERVER_LOG, "utf8");
    assert.ok(!/data:image|\/9j\/|iVBORw0KGgo|embedding/.test(log), "aucune image ni gabarit dans les journaux");
    const audit = JSON.parse(py(`
import json, app.main
from app.db.session import SessionLocal
from app.modules.auth.models import AuditEvent
S = SessionLocal()
rows = S.query(AuditEvent).filter(AuditEvent.action == "biometrics.test_mode.recognize").all()
print(json.dumps([r.new_state or "" for r in rows]))
`));
    assert.ok(audit.length > 30, `audit: ${audit.length}`);
    assert.ok(audit.every((s) => !/data:image|\/9j\/|iVBORw0KGgo|embedding|template/.test(s)), "audit : métadonnées seulement");
    // Réponses : jamais de vecteur ni de gabarit (la clé timings_ms.embedding n'est qu'une durée).
    const leaks = (v) => (Array.isArray(v) ? v.length >= 32 && v.every((x) => typeof x === "number") || v.some(leaks)
      : v && typeof v === "object" ? Object.entries(v).some(([k, x]) => /template|vector/i.test(k) || leaks(x)) : false);
    assert.ok(results.length > 0 && results.every((r) => r.recorded === false && !leaks(r)), JSON.stringify(results.map((r) => r.state)));
    // Parcours navigateur : uniquement les endpoints du Mode Test côté biométrie, aucune erreur.
    assert.deepStrictEqual([...new Set(pageApiCalls.filter((p) => p.startsWith("/api/biometrics/")))].sort(),
      ["/api/biometrics/test-mode/recognize", "/api/biometrics/test-mode/status"]);
    assert.ok(!pageApiCalls.some((p) => /\/attendance\/(scan|presences|events)|\/portal\/.*scan|\/cameras\//.test(p)), pageApiCalls.join(","));
    assert.deepStrictEqual(apiErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
  });
});
