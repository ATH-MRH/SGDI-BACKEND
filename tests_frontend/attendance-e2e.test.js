// ATLAS IRON HR & ATTENDANCE V1 — E2E Chrome PERMANENT.
// Même patron que site-workforce-e2e.test.js : vrai serveur uvicorn (base SQLite temporaire),
// données seedées, vrai Chrome, hosts réels simulés par --host-resolver-rules
// (pointage.irongs.com = centre de contrôle, pointeur.irongs.com = terminal). Hors du script
// `test` par défaut : `npm run test:attendance-e2e`.
//
// Biométrie : moteur RÉEL (aucun faux moteur dans le serveur). Exécutée uniquement si
//   ATLAS_E2E_PYTHON        → python disposant d'opencv/numpy (requirements-biometric.txt)
//   BIOMETRIC_MODELS_DIR    → modèles vérifiés (docs/biometrics.md)
//   BIOMETRIC_TEST_FACES    → obama1.jpg / obama2.jpg (portraits du domaine public)
// La caméra est une caméra Dahua SIMULÉE : un vrai serveur HTTP à authentification Digest
// (/cgi-bin/snapshot.cgi) que le backend interroge exactement comme une vraie caméra (même
// adaptateur). Ses images viennent de ces portraits. Sans ces variables, les scénarios
// biométriques sont IGNORÉS (skip explicite), jamais comptés comme réussis. La validation avec
// une vraie caméra et de vraies personnes reste à faire sur site
// (docs/attendance-hardware-checklist.md).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8953;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_att_e2e_"));
const DB_PATH = path.join(TMP, "e2e.db");
const UPLOADS = path.join(TMP, "uploads");
const PY = process.env.ATLAS_E2E_PYTHON || "python3";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const BIO = Boolean(MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const SOC = "Iron Global Securite";
const SOC_B = "Sword Corporation";
const ADMIN = { username: "atte2eadmin", password: "att-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1hdHRlbmRhbmNlLXYxLS0="; // clé Fernet de test (32 octets base64)

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return process.env.PUPPETEER_EXECUTABLE_PATH;
  return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((p) => fs.existsSync(p)) || null;
}
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const CHROME_PATH = findChrome();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = "GET", token, body, host } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (host) headers.Host = host;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + "/api" + p, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non JSON */ }
  return { status: res.status, data };
}
const login = async (username, password) => {
  const r = await api("/auth/login", { method: "POST", body: { username, password } });
  assert.strictEqual(r.status, 200, `${username}: ${JSON.stringify(r.data)}`);
  return r.data.access_token;
};

const serverEnv = () => ({
  ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "att-e2e-permanent-secret-00000000000", APP_ENV: "test",
  ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password, LOG_LEVEL: "ERROR", LOGIN_MAX_ATTEMPTS: "1000000",
  SGDI_UPLOADS_DIR: UPLOADS, BIOMETRIC_ENABLED: BIO ? "true" : "false", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS || "/nonexistent",
  ATTENDANCE_MIN_EVENT_GAP_SECONDS: "300",
});

// ── Caméra Dahua simulée (HTTP Digest) ──────────────────────────────────────────────────
const http = require("http");
const crypto = require("crypto");
const CAM = { user: "admin", pass: "Cam-E2E-S3cret!", realm: "Login to DAHUA", nonce: crypto.randomBytes(8).toString("hex"), frames: [], served: 0 };
const md5 = (v) => crypto.createHash("md5").update(v).digest("hex");
function startCamera() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith("/cgi-bin/snapshot.cgi?channel=1")) { res.writeHead(404); return res.end(); }
      const auth = req.headers.authorization || "";
      if (auth.startsWith("Digest ")) {
        const f = Object.fromEntries(auth.slice(7).split(/,\s*/).map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1).replace(/^"|"$/g, "")]; }));
        const expected = md5(`${md5(`${CAM.user}:${CAM.realm}:${CAM.pass}`)}:${CAM.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${md5(`GET:${f.uri}`)}`);
        if (f.username === CAM.user && f.response === expected && CAM.frames.length) {
          const body = CAM.frames[CAM.served++ % CAM.frames.length];
          res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": body.length });
          return res.end(body);
        }
      }
      res.writeHead(401, { "WWW-Authenticate": `Digest realm="${CAM.realm}", qop="auth", nonce="${CAM.nonce}", opaque="x"` });
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cameraFrames(source, mode) {
  // live  : portrait pleine résolution, légers décalages (bruit de capteur réel) ;
  // still : trames strictement identiques (image figée ré-injectée).
  // Pas de simulation « écran/impression » : un cadrage numérique n'a ni moiré ni reflets et
  // ne valide RIEN (mesuré : accepté pour un portrait, refusé pour un autre). Ces attaques se
  // testent sur la vraie caméra (docs/attendance-hardware-checklist.md).
  const dir = fs.mkdtempSync(path.join(TMP, mode + "_"));
  execFileSync(PY, ["-c", `
import io
from PIL import Image
img = Image.open(${JSON.stringify(source)}).convert("RGB")
img.thumbnail((1280, 1280))
w, h = img.size
for i in range(6):
    d = 0 if "${mode}" == "still" else (i % 3) * 3
    f = img.crop((d, d, w - 12 + d, h - 12 + d))
    if "${mode}" == "screen":
        c = Image.new("RGB", (640, 480), (12, 12, 12)); f.thumbnail((640, 480)); c.paste(f, ((640 - f.width) // 2, (480 - f.height) // 2)); f = c
    f.save(${JSON.stringify(dir)} + "/%d.jpg" % i, "JPEG", quality=90)
`]);
  return fs.readdirSync(dir).sort().map((n) => fs.readFileSync(path.join(dir, n)));
}

let serverProc, browser, cameraServer;
const ids = {};
const tokens = {};

test("Attendance V1 — E2E permanent", { skip: !CHROME_PATH ? "Chrome introuvable (PUPPETEER_EXECUTABLE_PATH)" : (!puppeteer ? "puppeteer-core absent" : false) }, async (t) => {
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (serverProc) serverProc.kill();
    if (cameraServer) cameraServer.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  await t.test("démarrage serveur + seed", async () => {
    fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
    // Photo de la fiche = obama2.jpg ; la caméra verra obama1.jpg (autre photo, même personne).
    if (BIO) fs.copyFileSync(path.join(FACES, "obama2.jpg"), path.join(UPLOADS, "photos", "E2E-PHOTO.jpg"));
    serverProc = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env: serverEnv(), stdio: "ignore" });
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      try { ready = (await api("/auth/login", { method: "POST", body: ADMIN })).status === 200; } catch (e) { /* pas encore prêt */ }
      if (!ready) await sleep(300);
    }
    assert.ok(ready, "serveur E2E non prêt");
    const out = execFileSync(PY, ["-c", `
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Site, Assignment
from datetime import date, timedelta
S = SessionLocal()
a = Site(name="Site E2E A", active=1, equipment_plan={"societe": "${SOC}"})
b = Site(name="Site E2E B", active=1, equipment_plan={"societe": "${SOC_B}"})
S.add_all([a, b]); S.flush()
e1 = Employee(code="ATT-E1", first_name="Amine", last_name="Terrain", society="${SOC}", status="actif", position="AGENT")
e2 = Employee(code="ATT-E2", first_name="Nadia", last_name="Photo", society="${SOC}", status="actif", position="AGENT", extra={"photo": "/uploads/photos/E2E-PHOTO.jpg"})
e3 = Employee(code="ATT-E3", first_name="Bilal", last_name="Autre", society="${SOC_B}", status="actif", position="AGENT")
S.add_all([e1, e2, e3]); S.flush()
start = date.today() - timedelta(days=30)
S.add_all([Assignment(employee_id=e.id, site_id=s.id, group_code="A", start_date=start, active=1) for e, s in ((e1, a), (e2, a), (e3, b))])
def user(name, **kw):
    S.add(User(username=name, full_name=name, password_hash=hash_password(name + "-pass"), validation_password_hash=hash_password("x"), is_active=True,
               authorized_structures=[], role=kw.pop("role", "ops"), access_level="H3", **kw))
user("opsE2E", authorized_societies=["${SOC}"], authorized_sites=[a.id], authorized_modules=["pointage", "pointeur", "ops", "drh"],
     authorized_actions=["read", "create", "update", "validate", "unlock"])
user("opsB", authorized_societies=["${SOC_B}"], authorized_sites=[b.id], authorized_modules=["pointage", "pointeur", "ops"],
     authorized_actions=["read", "create", "update", "validate", "unlock"])
user("financeE2E", authorized_societies=["${SOC}"], authorized_sites=[], authorized_modules=["finances"], authorized_actions=["read"])
user("chargeE2E", role="charge_effectifs_site", authorized_societies=["${SOC}"], authorized_sites=[a.id], authorized_modules=["site_workforce"],
     authorized_actions=["read", "create", "update", "validate"])
user("bioE2E", authorized_societies=["${SOC}"], authorized_sites=[a.id], authorized_modules=["pointage", "drh"],
     authorized_actions=["read", "create", "update", "validate"])
S.flush()
from app.modules.auth.models import UserFeaturePermission
bio = S.query(User).filter(User.username == "bioE2E").one()
for feature, action in (("biometric_status", "read"), ("biometric_enrollment", "create"), ("biometric_enrollment", "update"),
                        ("biometric_admin", "validate"), ("biometric_admin", "admin")):
    S.add(UserFeaturePermission(user_id=bio.id, module_key="attendance", feature_key=feature, action_key=action))
S.commit()
print(a.id, b.id, e1.id, e2.id, e3.id)
`], { cwd: REPO_ROOT, env: serverEnv() }).toString().trim().split("\n").pop().split(" ").map(Number);
    [ids.siteA, ids.siteB, ids.e1, ids.e2, ids.e3] = out;
    tokens.admin = await login(ADMIN.username, ADMIN.password);
    for (const u of ["opsE2E", "opsB", "financeE2E", "chargeE2E", "bioE2E"]) tokens[u] = await login(u, u + "-pass");
    cameraServer = await startCamera();
    const model = await api("/biometrics/camera-models", { method: "POST", token: tokens.admin, body: { manufacturer: "DAHUA", model: "Simulée E2E (Digest)", adapter: "DAHUA", resolution: "5MP" } });
    assert.strictEqual(model.status, 200, JSON.stringify(model.data));
    const cam = await api("/biometrics/cameras", { method: "POST", token: tokens.admin, body: {
      name: "CAM-ENTREE-01", camera_model_id: model.data.id, site_id: ids.siteA, host: "127.0.0.1", http_port: cameraServer.address().port,
      rtsp_port: 1, location: "Entrée principale", usage: "ATTENDANCE_AND_ENROLLMENT", role: "ENTRY", is_default: true, facial_attendance_enabled: true, username: CAM.user, password: CAM.pass } });
    assert.strictEqual(cam.status, 200, JSON.stringify(cam.data));
    assert.ok(!JSON.stringify(cam.data).includes(CAM.pass), "mot de passe caméra jamais renvoyé");
    ids.camA = cam.data.id;
  });

  await t.test("scénarios hostiles (preuve backend)", async () => {
    assert.strictEqual((await api("/attendance/board")).status, 401, "anonyme");
    assert.strictEqual((await api("/portal/pointages", { method: "POST", body: { employee: { matricule: "ATT-E1" }, date: "2026-01-01" } })).status, 401, "pointage portail anonyme");
    assert.strictEqual((await api("/attendance/board", { token: tokens.financeE2E })).status, 403, "mauvais module");
    assert.strictEqual((await api("/biometrics/cameras", { token: tokens.financeE2E })).status, 403, "mauvais module (biométrie)");
    assert.strictEqual((await api(`/attendance/board?site_id=${ids.siteA}`, { token: tokens.opsB })).status, 403, "mauvais site");
    assert.strictEqual((await api("/portal/attendance-manual/scan", { method: "POST", token: tokens.opsE2E, body: { employee_id: ids.e3 } })).status, 403, "employee_id forgé d'un autre site");
    assert.strictEqual((await api(`/biometrics/cameras/${ids.camA}/recognize`, { method: "POST", token: tokens.opsB, body: {} })).status, 404, "caméra d'un autre site");
    assert.strictEqual((await api(`/attendance/employees/${ids.e1}`, { token: tokens.opsB })).status, 404, "employé d'un autre site");
    // Concurrence : 10 scans simultanés du même employé → une seule arrivée.
    const results = await Promise.all(Array.from({ length: 10 }, () => api("/portal/attendance-manual/scan", { method: "POST", token: tokens.opsE2E, body: { employee_id: ids.e1 } })));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
    const hist = await api(`/attendance/employees/${ids.e1}`, { token: tokens.opsE2E });
    assert.strictEqual(hist.data.events.filter((e) => e.type === "ARRIVAL").length, 1, "requêtes concurrentes : une seule arrivée");
    assert.strictEqual(results.filter((r) => !r.data.duplicate).length, 1);
  });

  await t.test("BEO : le pointage du chargé des effectifs passe par Attendance Core", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = await api("/site-workforce/attendance", { method: "POST", token: tokens.chargeE2E, body: { employee_id: ids.e2, presence_date: yesterday, status: "absent" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const board = await api(`/attendance/board?presence_date=${yesterday}&q=ATT-E2`, { token: tokens.opsE2E });
    assert.strictEqual(board.data.items[0].status, "absent");
    assert.strictEqual(board.data.items[0].source, "SITE_WORKFORCE");
    assert.ok(board.data.items[0].anomalies.some((a) => a.type === "ABSENT"));
    assert.strictEqual((await api("/site-workforce/attendance", { method: "POST", token: tokens.chargeE2E, body: { employee_id: ids.e3, presence_date: yesterday, status: "present" } })).status, 403, "BEO : employé d'un autre site");
  });

  const newPage = async (width = 1440, extraArgs = []) => {
    const b = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new", userDataDir: path.join(TMP, `chrome_${Date.now()}_${Math.random()}`),
      args: ["--no-first-run", `--host-resolver-rules=MAP pointage.irongs.com 127.0.0.1:${PORT}, MAP pointeur.irongs.com 127.0.0.1:${PORT}`, ...extraArgs] });
    const page = await b.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return { b, page, errors };
  };

  await t.test("centre de contrôle (pointage.irongs.com) : KPI, correction, clôture, réouverture, responsive", async () => {
    const { b, page, errors } = await newPage();
    browser = b;
    await page.goto("http://pointage.irongs.com/", { waitUntil: "domcontentloaded" });
    await page.type("#login-user", "opsE2E"); await page.type("#login-pass", "opsE2E-pass");
    await Promise.all([page.click("#login-btn"), page.waitForSelector("#app:not(.hidden)", { timeout: 10000 })]);
    await page.waitForFunction(() => document.querySelectorAll("#board-rows tr").length >= 2, { timeout: 10000 });
    const text = await page.evaluate(() => document.body.innerText);
    assert.match(text, /Terrain Amine|Amine/); assert.match(text, /Photo Nadia|Nadia/);
    assert.doesNotMatch(text, /Bilal/, "jamais l'employé d'un autre site");
    const kpi = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".kpi")].map((k) => [k.querySelector("span").textContent, Number(k.querySelector("strong").textContent)])));
    assert.strictEqual(kpi["Présents"], 1);
    // Correction via l'interface (motif obligatoire)
    const presenceId = await page.evaluate(() => document.querySelector("[data-correct]")?.dataset.correct);
    assert.ok(presenceId);
    await page.click(`[data-correct="${presenceId}"]`);
    await page.select("#c-status", "mission");
    await page.type("#c-reason", "Mission extérieure confirmée par le chef de poste");
    await page.click("#c-save");
    await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 5000 });
    // Clôture via l'interface : anomalies affichées avant confirmation
    await page.click("#close-btn");
    await page.waitForSelector("#cl-ok", { timeout: 5000 });
    await page.click("#cl-ok");
    await page.waitForFunction(() => !document.querySelector(".modal"), { timeout: 5000 });
    await page.waitForFunction(() => document.body.innerText.includes("🔒"), { timeout: 5000 });
    // Journée clôturée : aucun scan ne la modifie (refus 409, ou « déjà enregistré » sans
    // écriture si le scan tombe dans la fenêtre anti-rebond) ; modification OPS refusée ;
    // réouverture motivée.
    const before = (await api(`/attendance/employees/${ids.e1}`, { token: tokens.opsE2E })).data;
    const scan = await api("/portal/attendance-manual/scan", { method: "POST", token: tokens.opsE2E, body: { employee_id: ids.e1 } });
    assert.ok(scan.status === 409 || (scan.status === 201 && scan.data.duplicate === true), JSON.stringify(scan));
    const afterScan = (await api(`/attendance/employees/${ids.e1}`, { token: tokens.opsE2E })).data;
    assert.strictEqual(afterScan.events.length, before.events.length, "aucun événement écrit sur une journée clôturée");
    assert.deepStrictEqual(afterScan.days, before.days);
    assert.strictEqual((await api(`/ops/pointage/daily/${presenceId}`, { method: "PATCH", token: tokens.opsE2E, body: { status: "absent" } })).status, 409);
    assert.strictEqual((await api(`/attendance/presences/${presenceId}/unlock`, { method: "POST", token: tokens.opsE2E, body: { reason: "Litige paie" } })).status, 200);
    // Responsive : aucun débordement horizontal de page
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewport({ width, height: 900 }); await sleep(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `débordement ${overflow}px à ${width}px`);
    }
    assert.deepStrictEqual(errors, []);
    await b.close(); browser = null;
  });

  await t.test("DRH Next : Employé 360 (Pointage + Biométrie sans permission explicite)", async () => {
    const { b, page, errors } = await newPage();
    browser = b;
    await page.goto(`${BASE}/drh-next`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#dn-login-form", { timeout: 10000 });
    await page.type("#dn-login-form input[name=username]", "opsE2E"); await page.type("#dn-login-form input[name=password]", "opsE2E-pass");
    await Promise.all([page.click("#dn-login-form button[type=submit]"), page.waitForSelector("#dn-nav", { timeout: 10000 })]);
    const nav = await page.evaluate(() => document.querySelector("#dn-nav").innerText);
    assert.doesNotMatch(nav, /Alertes/);
    await page.evaluate((id) => { location.hash = `#/employees/${id}`; }, ids.e1);
    await page.waitForSelector('[data-dn-tab="pointage"]', { timeout: 10000 });
    await page.click('[data-dn-tab="pointage"]');
    await page.waitForFunction(() => /Correction/.test(document.querySelector("#dn-dossier-panel")?.innerText || ""), { timeout: 10000 });
    const panel = await page.evaluate(() => document.querySelector("#dn-dossier-panel").innerText);
    assert.match(panel, /Manuel/); assert.match(panel, /Mission extérieure/); assert.match(panel, /Réouverture/);
    await page.click('[data-dn-tab="biometrie"]');
    await page.waitForFunction(() => /Permission biométrique requise/.test(document.querySelector("#dn-dossier-panel")?.innerText || ""), { timeout: 10000 });
    assert.deepStrictEqual(errors.filter((e) => !/403/.test(e)), [], JSON.stringify(errors));
    await b.close(); browser = null;
  });

  await t.test("biométrie réelle : consentement + enrôlement (UI), terminal zéro clic, image figée refusée", { skip: BIO ? false : "BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES / ATLAS_E2E_PYTHON non fournis — non exécuté" }, async () => {
    // 1) Centre de contrôle, compte à permissions biométriques EXPLICITES (pas un administrateur
    //    global) : consentement puis enrôlement depuis la photo de la fiche.
    let { b, page, errors } = await newPage();
    browser = b;
    await page.goto("http://pointage.irongs.com/", { waitUntil: "domcontentloaded" });
    await page.type("#login-user", "bioE2E"); await page.type("#login-pass", "bioE2E-pass");
    await page.click("#login-btn");
    await page.waitForFunction(() => !document.getElementById("app").classList.contains("hidden") || document.getElementById("login-error").classList.contains("show"), { timeout: 10000 });
    const loginError = await page.evaluate(() => document.getElementById("login-error").textContent);
    assert.strictEqual(loginError, "", "connexion administrateur : " + loginError);
    await page.waitForSelector(`[data-bio="${ids.e2}"]`, { timeout: 10000 });
    await page.evaluate((id) => document.querySelector(`[data-bio="${id}"]`).click(), ids.e2);
    await page.waitForSelector("#consent-form", { timeout: 10000 });
    await page.select("#cs-status", "contract_confirmed");
    await page.type("#cs-ref", "Contrat CDD E2E art. 12");
    await page.evaluate(() => document.querySelector("#consent-form").requestSubmit());
    await page.waitForFunction(() => /Accord du contrat confirmé/.test(document.querySelector(".modal")?.innerText || ""), { timeout: 10000 });
    // La modale se redessine après chaque action : clic sur l'élément présent AU MOMENT du clic.
    await page.waitForFunction(() => document.querySelector("#en-photo") && !document.querySelector("#en-photo").disabled, { timeout: 10000 });
    await page.evaluate(() => document.querySelector("#en-photo").click());
    // Enrôlement SUPERVISÉ : analyse de la photo DRH, puis confirmation explicite de l'opérateur.
    await page.waitForFunction(() => document.querySelector("#en-confirm") && !document.querySelector("#en-confirm").disabled, { timeout: 20000 });
    await page.evaluate(() => document.querySelector("#en-confirm").click());
    await page.waitForFunction(() => /Enrôlement :<\/b> actif|Enrôlement : actif/.test(document.querySelector(".modal")?.innerHTML || "") || /actif/.test(document.querySelector(".modal")?.innerText || ""), { timeout: 20000 });
    const status = await api(`/biometrics/employees/${ids.e2}`, { token: tokens.bioE2E });
    assert.strictEqual(status.data.enrollment, "ACTIVE", JSON.stringify(status.data));
    assert.ok(!JSON.stringify(status.data).includes("embedding"));
    assert.deepStrictEqual(errors, []);
    await b.close(); browser = null;

    // 2) Terminal pointeur.irongs.com : la caméra (simulée) voit l'employée — autre photo de la
    //    même personne que celle de sa fiche. Aucun clic après l'ouverture de la vue.
    CAM.frames = cameraFrames(path.join(FACES, "obama1.jpg"), "live"); CAM.served = 0;
    ({ b, page, errors } = await newPage(1280));
    browser = b;
    await page.goto("http://pointeur.irongs.com/", { waitUntil: "domcontentloaded" });
    await page.type("#username", "opsE2E"); await page.type("#password", "opsE2E-pass");
    await Promise.all([page.click("#loginBtn"), page.waitForSelector("#appView:not(.hidden)", { timeout: 10000 })]);
    await page.click("#faceNav");
    const t0 = Date.now();
    await page.waitForFunction(() => /POINTAGE ENREGISTRÉ|DÉJÀ ENREGISTRÉ|REFUSÉ|INCONNU|INDISPONIBLE|AUCUNE/.test(document.getElementById("faceStatus").innerText), { timeout: 30000 });
    const recognized = await page.evaluate(() => document.getElementById("faceStatus").innerText);
    const elapsed = Date.now() - t0;
    assert.match(recognized, /POINTAGE ENREGISTRÉ/, recognized);
    assert.match(recognized, /PHOTO Nadia|Photo Nadia/i); assert.match(recognized, /ATT-E2/); assert.match(recognized, /ENTRÉE/);
    console.log(`# E2E facial : ouverture de la vue → POINTAGE ENREGISTRÉ en ${elapsed} ms (moteur réel, capture serveur Dahua simulée, zéro clic)`);
    const previewOk = await page.evaluate(() => document.getElementById("facePreview").src.startsWith("blob:"));
    assert.ok(previewOk, "aperçu relayé par le backend");
    const leaked = await page.evaluate((pass) => document.documentElement.innerHTML.includes(pass) || performance.getEntriesByType("resource").some((r) => !r.name.includes("irongs.com")), CAM.pass);
    assert.strictEqual(leaked, false, "aucun secret ni accès direct à la caméra depuis le navigateur");
    const hist = await api(`/attendance/employees/${ids.e2}`, { token: tokens.opsE2E });
    let facial = hist.data.events.filter((e) => e.source === "FACIAL");
    assert.strictEqual(facial.length, 1);
    assert.strictEqual(facial[0].device_id, ids.camA);
    await sleep(6000); // l'employée reste devant la caméra : jamais de sortie immédiate
    facial = (await api(`/attendance/employees/${ids.e2}`, { token: tokens.opsE2E })).data.events.filter((e) => e.source === "FACIAL");
    assert.strictEqual(facial.length, 1, "présence prolongée devant la caméra : un seul pointage");
    assert.deepStrictEqual(errors, []);

    // 3) Image figée ré-injectée dans le flux : aucun pointage, échec de liveness tracé.
    for (const mode of ["still"]) {
      CAM.frames = cameraFrames(path.join(FACES, "obama1.jpg"), mode); CAM.served = 0;
      await page.evaluate(() => { PointeurFacial.stop(); document.getElementById("faceStatus").innerText = ""; PointeurFacial.cooldownUntil = 0; });
      await page.evaluate(() => PointeurFacial.start());
      await page.waitForFunction(() => /REFUSÉ|ENREGISTRÉ/.test(document.getElementById("faceStatus").innerText), { timeout: 30000 });
      const verdict = await page.evaluate(() => document.getElementById("faceStatus").innerText);
      assert.match(verdict, /Présence réelle non confirmée/, `${mode} : ${verdict}`);
    }
    const after = await api(`/attendance/employees/${ids.e2}`, { token: tokens.opsE2E });
    assert.strictEqual(after.data.events.filter((e) => e.source === "FACIAL").length, 1, "aucun nouveau pointage");
    const anomalies = await api(`/attendance/anomalies?site_id=${ids.siteA}&anomaly_type=LIVENESS_FAILED`, { token: tokens.opsE2E });
    assert.ok(anomalies.data.total >= 1, "échec liveness tracé");
    await b.close(); browser = null;
  });
});
