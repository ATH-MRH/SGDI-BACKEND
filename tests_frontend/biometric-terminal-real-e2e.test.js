// ATLAS — borne faciale (tablette) — E2E RÉEL de bout en bout + E2E hostile.
// Vrai serveur uvicorn (SQLite temporaire), VRAI moteur (YuNet + SFace + MiniFASNetV2), vrai Chrome
// dont la caméra virtuelle diffuse une personne qui arrive, repart, revient
// (--use-file-for-fake-video-capture). Parcours : enrôlement supervisé → création du terminal →
// association par code à usage unique dans /borne → activation → ENTRÉE → départ → SORTIE,
// vérifiés en base. Puis attaques directes sur l'API du terminal : aucun pointage.
// `npm run test:biometric-terminal-real-e2e`. Environnement de TEST uniquement (BIOMETRIC_ENABLED
// n'est activé que pour ce serveur éphémère). Exécuté seulement si :
//   ATLAS_E2E_PYTHON (opencv/numpy/Pillow) · BIOMETRIC_MODELS_DIR · BIOMETRIC_TEST_FACES (obama1/obama2)
// Sinon : skip explicite (jamais compté comme réussi).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { webcrypto } = require("crypto");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8983;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.ATLAS_E2E_PYTHON || "";
const MODELS = process.env.BIOMETRIC_MODELS_DIR || "";
const FACES = process.env.BIOMETRIC_TEST_FACES || "";
const READY = Boolean(PY && MODELS && FACES && fs.existsSync(path.join(FACES, "obama1.jpg")));
const SOC = "IRON GLOBAL SOLUTION";
const ADMIN = { username: "tre2eadmin", password: "tr-e2e-admin-password" };
const KEY = "ZmFrZS1lMmUta2V5LWZvci1iaW9tZXRyaWMtdGVzdC0=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = null; }
const SKIP = !READY ? "ATLAS_E2E_PYTHON / BIOMETRIC_MODELS_DIR / BIOMETRIC_TEST_FACES non définis" : !CHROME ? "Chrome absent" : !puppeteer ? "puppeteer-core absent" : false;
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("Borne faciale — E2E réel (vrai moteur, vrai Chrome) + E2E hostile", { skip: SKIP, timeout: 420000 }, async (t) => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atlas_bio_terminal_"));
  const UPLOADS = path.join(TMP, "uploads");
  fs.mkdirSync(path.join(UPLOADS, "photos"), { recursive: true });
  fs.copyFileSync(path.join(FACES, "obama2.jpg"), path.join(UPLOADS, "photos", "E2E-TERM-PHOTO.jpg"));   // photo DRH
  const env = { ...process.env, PYTHONPATH: REPO_ROOT, DATABASE_URL: `sqlite:///${path.join(TMP, "e2e.db")}`, APP_ENV: "test",
    JWT_SECRET: "bio-terminal-e2e-secret-0000000000000", ADMIN_SYSTEM_USERNAME: ADMIN.username, ADMIN_SYSTEM_PASSWORD: ADMIN.password,
    LOG_LEVEL: "INFO", LOGIN_MAX_ATTEMPTS: "1000000", SGDI_UPLOADS_DIR: UPLOADS, STARTUP_MAINTENANCE_ENABLED: "false",
    BIOMETRIC_ENABLED: "true", BIOMETRIC_TEST_MODE_ENABLED: "false", BIOMETRIC_TEMPLATE_KEY: KEY, BIOMETRIC_MODELS_DIR: MODELS,
    ATTENDANCE_MIN_EVENT_GAP_SECONDS: "0" };
  const SERVER_LOG = path.join(TMP, "server.log");
  const py = (code) => execFileSync(PY, ["-c", code], { cwd: REPO_ROOT, env }).toString().trim().split("\n").pop();
  const api = async (p, { method = "GET", token, body, headers = {}, raw } = {}) => {
    const h = { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json", ...headers };
    const res = await fetch(BASE + "/api" + p, { method, headers: h, body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* non JSON */ }
    return { status: res.status, data };
  };
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  // Caméra virtuelle : scène vide → personne (obama1) → scène vide → même personne décalée.
  // Chaque trame est unique (comme un capteur réel) : jamais deux JPEG identiques.
  const VIDEO = path.join(TMP, "arrive-leave.mjpeg");
  py(`
import io
from PIL import Image, ImageDraw
face = Image.open(${JSON.stringify(path.join(FACES, "obama1.jpg"))}).convert("RGB"); face.thumbnail((460, 460))
out = open(${JSON.stringify(VIDEO)}, "wb"); n = 0
for segment, frames in (("empty", 45), ("A", 150), ("empty", 45), ("B", 150)):
    for i in range(frames):
        n += 1
        canvas = Image.new("RGB", (640, 480), (52, 58, 66))
        if segment != "empty":
            canvas.paste(face, ((640 - face.width) // 2 + (0 if segment == "A" else 18), (480 - face.height) // 2))
        d = (n % 3 - 1) * 2
        canvas = canvas.point(lambda v, d=d: max(0, min(255, v + d)))
        ImageDraw.Draw(canvas).rectangle((0, 0, 3, 3), fill=(n % 256, n // 256, 7))
        b = io.BytesIO(); canvas.save(b, "JPEG", quality=90); out.write(b.getvalue())
out.close(); print(n)
`);
  // Rafales « hostiles » : 6 trames distinctes de la même personne, envoyées sans la borne.
  const HOSTILE = JSON.parse(py(`
import io, base64, json
from PIL import Image
face = Image.open(${JSON.stringify(path.join(FACES, "obama1.jpg"))}).convert("RGB"); face.thumbnail((800, 800))
out = []
for i in range(6):
    b = io.BytesIO(); face.point(lambda v, d=i: max(0, min(255, v + d - 3))).save(b, "JPEG", quality=85)
    out.append("data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode())
print(json.dumps(out))
`));

  const ids = {}, tokens = {};
  await t.test("serveur réel, moteur réel, employé pilote enrôlé (supervisé)", async () => {
    const logFd = fs.openSync(SERVER_LOG, "w");
    server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], { cwd: REPO_ROOT, env, stdio: ["ignore", logFd, logFd] });
    let ok = false;
    for (let i = 0; i < 120 && !ok; i++) { try { ok = (await api("/auth/admin-system-login", { method: "POST", body: ADMIN })).status === 200; } catch (e) { /* démarrage */ } if (!ok) await sleep(300); }
    assert.ok(ok, "serveur E2E non prêt");
    const out = py(`
import app.main
from datetime import date, timedelta
from app.db.session import SessionLocal
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
S = SessionLocal()
a = Site(name="HAMOUL 01 (40K) E2E", active=1, equipment_plan={"societe": "${SOC}"})
b = Site(name="AUTRE SITE E2E", active=1, equipment_plan={"societe": "${SOC}"})
S.add_all([a, b]); S.flush()
e = Employee(code="TRM-E2E-1", first_name="Barack", last_name="Pilote", society="${SOC}", status="actif", position="Agent",
             extra={"photo": "/uploads/photos/E2E-TERM-PHOTO.jpg"})
S.add(e); S.flush()
S.add(Assignment(employee_id=e.id, site_id=a.id, group_code="A", start_date=date.today() - timedelta(days=30), active=1))
S.commit(); print(a.id, b.id, e.id)
`);
    [ids.site, ids.siteB, ids.emp] = out.split(" ").map(Number);
    tokens.admin = (await api("/auth/admin-system-login", { method: "POST", body: ADMIN })).data.access_token;
    const notice = (await api("/biometrics/notice", { token: tokens.admin })).data.version;
    assert.strictEqual((await api(`/biometrics/employees/${ids.emp}/consent`, { method: "POST", token: tokens.admin,
      body: { status: "contract_confirmed", source: "EMPLOYMENT_CONTRACT", proof_reference: "Contrat E2E", notice_version: notice } })).status, 200);
    const preview = await api(`/biometrics/employees/${ids.emp}/enrollment/preview`, { method: "POST", token: tokens.admin, body: {} });
    assert.strictEqual(preview.status, 200, JSON.stringify(preview.data));
    assert.strictEqual(preview.data.photo.state, "OK");
    const confirm = await api(`/biometrics/employees/${ids.emp}/enrollment/confirm`, { method: "POST", token: tokens.admin, body: { token: preview.data.token, confirm: true } });
    assert.strictEqual(confirm.data.status, "ACTIVE", JSON.stringify(confirm.data));
    // Environnement de TEST : fenêtre de non-répétition nulle (ENTRÉE puis SORTIE dans la même
    // minute), dans une version de configuration tracée. Seuils de liveness/reconnaissance : ceux
    // de production (défaut v1), inchangés.
    const cfg = await api("/biometrics/config", { method: "POST", token: tokens.admin, body: {
      provenance: "E2E borne — fenêtre de non-répétition nulle pour enchaîner ENTRÉE et SORTIE ; aucune valeur de production", cooldown_seconds: 0 } });
    assert.strictEqual(cfg.status, 200, JSON.stringify(cfg.data));
  });

  const kiosk = { responses: [], errors: [] };
  let page;
  await t.test("association par code à usage unique dans /borne, facial désactivé par défaut", async () => {
    const term = await api("/biometrics/terminals", { method: "POST", token: tokens.admin, body: { name: "TAB-HAMOUL-01", terminal_type: "TABLET_ANDROID", site_id: ids.site } });
    assert.strictEqual(term.status, 200, JSON.stringify(term.data));
    assert.strictEqual(term.data.facial_attendance_enabled, false);
    ids.term = term.data.id;
    const code = (await api(`/biometrics/terminals/${ids.term}/pairing-code`, { method: "POST", token: tokens.admin })).data;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "atlas_borne_chrome_")),
      args: ["--no-first-run", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${VIDEO}`,
        `--host-resolver-rules=MAP pointeur.irongs.com 127.0.0.1:${PORT}`, "--unsafely-treat-insecure-origin-as-secure=http://pointeur.irongs.com"] });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });            // Galaxy Tab paysage
    page.on("pageerror", (e) => kiosk.errors.push(String(e)));
    page.on("response", async (r) => {
      if (!r.url().includes("/api/biometrics/terminal/")) return;
      let data = null; try { data = await r.json(); } catch (e) { /* vide */ }
      kiosk.responses.push({ path: new URL(r.url()).pathname, status: r.status(), data });
    });
    await page.goto(`http://pointeur.irongs.com/borne${code.pair_path.slice("/borne".length)}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#pairCode").value.length === 10, { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => location.hash), "");
    await page.click("#pairSubmit");
    await page.waitForFunction(() => document.querySelector("#kioskStatus").dataset.state === "FACIAL_OFF", { timeout: 20000 });
    assert.match(await page.$eval("#kioskStatus", (e) => e.textContent), /UTILISEZ LE QR/);
    // Le même code ne sert plus.
    const reuse = await api("/biometrics/terminal/pair", { method: "POST", body: { code: code.code, public_key: { kty: "EC", crv: "P-256", x: "AA", y: "AA" } } });
    assert.strictEqual(reuse.status, 401);
    const listed = (await api("/biometrics/terminals", { token: tokens.admin })).data.find((x) => x.id === ids.term);
    assert.deepStrictEqual([listed.paired, listed.facial_attendance_enabled, listed.pairing_pending], [true, false, false]);
    assert.strictEqual(JSON.stringify(listed).includes('"x"'), false);
  });

  await t.test("activation explicite → personne devant la tablette → ENTRÉE ; départ, retour → SORTIE (Attendance Core)", async () => {
    assert.strictEqual((await api(`/biometrics/terminals/${ids.term}`, { method: "PATCH", token: tokens.admin, body: { facial_attendance_enabled: true } })).status, 200);
    await page.reload({ waitUntil: "domcontentloaded" });              // identité relue depuis IndexedDB
    const dump = () => JSON.stringify(kiosk.responses.map((r) => [r.path.split("/").pop(), r.status, r.data && (r.data.state || r.data.detail)]));
    try {
      await page.waitForFunction(() => /RECORDED/.test(document.querySelector("#kioskStatus").dataset.state), { timeout: 60000 });
    } catch (e) { throw new Error("ENTRÉE non atteinte : " + dump() + " écran=" + await page.$eval("#kioskStatus", (x) => x.textContent) + " erreurs=" + kiosk.errors.join("|")); }
    const first = await page.$eval("#kioskStatus", (e) => e.textContent);
    assert.match(first, /ENTRÉE ENREGISTRÉE/, first);
    assert.match(first, /Matricule TRM-E2E-1/);
    try {
      await page.waitForFunction(() => /SORTIE ENREGISTRÉE/.test(document.querySelector("#kioskStatus").textContent), { timeout: 60000 });
    } catch (e) { throw new Error("SORTIE non atteinte : " + dump()); }
    // Le corps de la dernière réponse est lu de façon asynchrone par l'écouteur : l'attendre.
    for (let i = 0; i < 50 && kiosk.responses.filter((r) => r.data && r.data.state === "ATTENDANCE_RECORDED").length < 2; i++) await sleep(100);
    const recognized = kiosk.responses.filter((r) => r.path.endsWith("/recognize"));
    const recorded = recognized.filter((r) => r.data && r.data.state === "ATTENDANCE_RECORDED");
    assert.deepStrictEqual(recorded.map((r) => r.data.action), ["ENTRÉE", "SORTIE"], JSON.stringify(recognized.map((r) => r.data && (r.data.state || r.data.detail))));
    t.diagnostic(`reconnaissances : ${recognized.length} ; durées serveur (ms) : ${recorded.map((r) => r.data.duration_ms).join(", ")} ; liveness : ${recorded.map((r) => r.data.liveness).join(", ")} ; scores : ${recorded.map((r) => r.data.confidence).join(", ")}`);
    assert.deepStrictEqual(kiosk.errors, []);
    const events = JSON.parse(py(`
import app.main, json
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
S = SessionLocal()
print(json.dumps([[e.event_type, e.source, (e.data or {}).get("terminal_name"), e.actor_label] for e in S.query(AttendanceEvent).order_by(AttendanceEvent.id)]))
`));
    assert.deepStrictEqual(events, [["ARRIVAL", "FACIAL", "TAB-HAMOUL-01", "BORNE TAB-HAMOUL-01"], ["DEPARTURE", "FACIAL", "TAB-HAMOUL-01", "BORNE TAB-HAMOUL-01"]]);
    await browser.close(); browser = null;                             // plus aucune capture pendant l'E2E hostile
  });

  await t.test("E2E hostile : JPEG sans terminal, session utilisateur, signature, rejeux, ancienne config, révocation → aucun pointage", async () => {
    const before = py(`
import app.main
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
print(SessionLocal().query(AttendanceEvent).count())
`);
    // Terminal « attaquant » associé légitimement à un AUTRE site (personne n'y est enrôlé).
    const other = (await api("/biometrics/terminals", { method: "POST", token: tokens.admin, body: { name: "TAB-AUTRE", terminal_type: "SMARTPHONE_ANDROID", site_id: ids.siteB } })).data;
    const code = (await api(`/biometrics/terminals/${other.id}/pairing-code`, { method: "POST", token: tokens.admin })).data.code;
    const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    const tid = (await api("/biometrics/terminal/pair", { method: "POST", body: { code, public_key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } } })).data.terminal_id;
    await api(`/biometrics/terminals/${other.id}`, { method: "PATCH", token: tokens.admin, body: { facial_attendance_enabled: true } });
    const signed = async (method, p, body, over = {}) => {
      const raw = body === undefined ? "" : JSON.stringify(body);
      const ts = String(over.ts || Date.now());
      const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(raw))).toString("hex");
      const msg = ["ATLAS-TERMINAL-1", over.tid || tid, method, "/api/biometrics" + p, ts, digest].join("\n");
      const sig = b64u(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Buffer.from(over.tamper ? msg + "x" : msg)));
      return api("/biometrics" + p, { method, raw, headers: { "X-Atlas-Terminal": over.tid || tid, "X-Atlas-Timestamp": ts, "X-Atlas-Signature": sig } });
    };
    // 1. JPEG arbitraire sans terminal / avec une session humaine / signature fausse / horodatage périmé.
    const naked = await api("/biometrics/terminal/recognize", { method: "POST", body: { frames: HOSTILE.slice(0, 3) } });
    assert.strictEqual(naked.status, 401, JSON.stringify(naked.data));
    const human = await api("/biometrics/terminal/challenge", { method: "POST", token: tokens.admin, body: {} });
    assert.strictEqual(human.status, 401, JSON.stringify(human.data));
    assert.strictEqual((await signed("POST", "/terminal/challenge", {}, { tamper: true })).status, 401);
    assert.strictEqual((await signed("POST", "/terminal/challenge", {}, { ts: Date.now() - 3600_000 })).status, 401);
    // 2. Mauvais site : un visage enrôlé ailleurs n'est jamais reconnu ici.
    const ch = (await signed("POST", "/terminal/challenge", {})).data;
    const first = await signed("POST", "/terminal/recognize", { challenge_id: ch.challenge_id, nonce: ch.nonce, frames: HOSTILE.slice(0, 3) });
    assert.strictEqual(first.status, 200, JSON.stringify(first.data));
    assert.notStrictEqual(first.data.state, "ATTENDANCE_RECORDED");
    assert.strictEqual(first.data.recorded, false);
    // 3. Rejeu du défi, rejeu des images avec un défi neuf.
    const reuse = await signed("POST", "/terminal/recognize", { challenge_id: ch.challenge_id, nonce: ch.nonce, frames: HOSTILE.slice(3, 6) });
    assert.strictEqual(reuse.data.detail.code, "CHALLENGE_REUSED");
    const ch2 = (await signed("POST", "/terminal/challenge", {})).data;
    const replay = await signed("POST", "/terminal/recognize", { challenge_id: ch2.challenge_id, nonce: ch2.nonce, frames: HOSTILE.slice(0, 3) });
    assert.strictEqual(replay.data.detail.code, "REPLAY_DETECTED");
    // 4. Défi émis sous une ancienne configuration.
    const ch3 = (await signed("POST", "/terminal/challenge", {})).data;
    await api("/biometrics/config", { method: "POST", token: tokens.admin, body: { provenance: "E2E hostile : changement de configuration", cooldown_seconds: 0 } });
    const stale = await signed("POST", "/terminal/recognize", { challenge_id: ch3.challenge_id, nonce: ch3.nonce, frames: HOSTILE.slice(3, 6) });
    assert.strictEqual(stale.data.detail.code, "CHALLENGE_STALE");
    // 5. Défi du terminal attaquant présenté sous l'identité de la borne légitime.
    const ch4 = (await signed("POST", "/terminal/challenge", {})).data;
    const legit = (await api("/biometrics/terminals", { token: tokens.admin })).data.find((x) => x.id === ids.term).terminal_id;
    assert.strictEqual((await signed("POST", "/terminal/recognize", { challenge_id: ch4.challenge_id, nonce: ch4.nonce, frames: HOSTILE.slice(3, 6) }, { tid: legit })).status, 401);
    // 6. Révocation : effet immédiat.
    await api(`/biometrics/terminals/${other.id}/revoke`, { method: "POST", token: tokens.admin, body: { reason: "E2E : appareil compromis" } });
    assert.strictEqual((await signed("POST", "/terminal/challenge", {})).status, 401);
    const after = py(`
import app.main
from app.db.session import SessionLocal
from app.modules.attendance.models import AttendanceEvent
print(SessionLocal().query(AttendanceEvent).count())
`);
    assert.strictEqual(after, before, "aucun pointage créé par les attaques");
    const leaks = py(`
import app.main, json
from app.db.session import SessionLocal
from app.modules.auth.models import AuditEvent
rows = SessionLocal().query(AuditEvent).filter(AuditEvent.action.like("biometrics.terminal.%")).all()
blob = " ".join((r.new_state or "") for r in rows)
print(json.dumps({"rows": len(rows), "image": "data:image" in blob or "/9j/" in blob, "key": '"d"' in blob or "privateKey" in blob}))
`);
    assert.deepStrictEqual(JSON.parse(leaks).image, false);
    assert.deepStrictEqual(JSON.parse(leaks).key, false);
    const log = fs.readFileSync(SERVER_LOG, "utf8");
    assert.strictEqual(/data:image|\/9j\/4/.test(log), false, "aucune image dans les journaux");
  });
});
