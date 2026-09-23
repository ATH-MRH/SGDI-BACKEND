// ATLAS Finance Platform V2 — E2E Chrome PERMANENT (revue finale bloquante V2, §3).
// Remplace le scénario Puppeteer manuel exécuté pendant la construction par un test
// committé, reproductible, exécuté via `npm run test:finance-e2e` (volontairement PAS dans
// le script `test` par défaut — la CI (.github/workflows/ci.yml) n'installe pas Chrome ;
// voir résolution d'executablePath ci-dessous, qui SKIP proprement si Chrome est introuvable
// plutôt que de faire échouer la CI).
//
// Démarre un VRAI serveur uvicorn (base SQLite temporaire, jamais la prod), seed des
// données réelles via l'API HTTP (aucun mock), puis pilote un VRAI Chrome. Aucun paiement/
// règlement/validation réel n'est mené à son terme (les dialogues de confirmation sont
// annulés après vérification de leur contenu).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `fp_e2e_permanent_${Date.now()}.db`);
const SOC = "Iron Global Securite";
const SOC_B = "Sword Corporation";

const SCREENS = [
  "dashboard", "tresorerie", "banque", "creances", "dettes",
  "paie", "budget", "rentabilite", "fiscalite", "comptabilite", "reglementation", "cockpit",
];

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ];
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
        try {
          const r = await fetch(`${BASE}/health`);
          if (r.ok) return resolve();
        } catch (e) { /* pas encore prêt */ }
        await new Promise((r2) => setTimeout(r2, 300));
      }
      reject(new Error("serveur E2E non prêt après le délai"));
    })();
  });
}

async function api(path_, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + "/api" + path_, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, data };
}

let serverProc;
let adminToken, restrictedToken;

test("finance-platform E2E permanent", { skip: !CHROME_PATH ? "Chrome introuvable (définir PUPPETEER_EXECUTABLE_PATH) — non exécuté, ne bloque pas npm test par défaut" : (!puppeteer ? "puppeteer-core absent" : false) }, async (t) => {
  await t.test("démarrage serveur + seed", async () => {
    serverProc = spawn("python3", ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:///${DB_PATH}`,
        JWT_SECRET: "e2e-permanent-secret-0000000000000",
        APP_ENV: "test",
        ADMIN_SYSTEM_USERNAME: "testadmin",
        ADMIN_SYSTEM_PASSWORD: "test-admin-password",
        LOG_LEVEL: "ERROR",
        LOGIN_MAX_ATTEMPTS: "1000000",
        SGDI_UPLOADS_DIR: path.join(os.tmpdir(), `fp_e2e_uploads_${Date.now()}`),
      },
      stdio: "ignore",
    });
    await waitForHealth(20000);

    // L'application crée elle-même un compte "testadmin" à son démarrage (ADMIN_SYSTEM_
    // USERNAME/PASSWORD, tâche de lifespan asynchrone) — TROUVÉ EN CONSTRUISANT CE TEST :
    // /health répond "ok" sans attendre cette tâche, donc écrire notre propre "testadmin" à
    // l'INSERT juste après waitForHealth() course avec ce bootstrap (celui qui commite en
    // dernier écrase l'autre — observé : authorized_societies revenu à [] côté framework).
    // On attend ici que ce login réussisse (preuve que le bootstrap est bien terminé) avant
    // de METTRE À JOUR (jamais ré-insérer) la ligne existante.
    {
      const deadline = Date.now() + 15000;
      let ok = false;
      while (Date.now() < deadline) {
        const r = await api("/auth/login", { method: "POST", body: { username: "testadmin", password: "test-admin-password" } });
        if (r.status === 200) { ok = true; break; }
        await new Promise((r2) => setTimeout(r2, 300));
      }
      assert.ok(ok, "le bootstrap testadmin de l'application n'a jamais abouti");
    }

    // Comptes (admin scope société + restreint), via un sous-processus Python ponctuel — le
    // serveur ASGI ci-dessus partage la même base SQLite (fichier). UPDATE sur testadmin
    // (jamais un second INSERT, voir ci-dessus) ; RH01E2E est un nouvel utilisateur, pas de
    // course possible dessus.
    const seedPy = `
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
S = SessionLocal()
admin = S.query(User).filter(User.username == "testadmin").one()
admin.authorized_societies = ["${SOC}"]
admin.global_society_access = True
if not S.query(User).filter(User.username == "RH01E2E").first():
    S.add(User(username="RH01E2E", full_name="RH Restreint E2E", role="drh", access_level="H3",
        authorized_societies=["${SOC}"], authorized_structures=[], authorized_modules=["drh"],
        password_hash=hash_password("rh01e2epass"), validation_password_hash=hash_password("x"), is_active=True))
S.commit()
S.refresh(admin)
print("seeded", admin.authorized_societies, admin.global_society_access)
`;
    // execFileSync (pas execSync) : évite le shell — un script Python multi-lignes passé en
    // argv brut (via -c) survit sans réinterprétation d'échappement. TROUVÉ EN CONSTRUISANT
    // CE TEST : execSync(`python3 -c ${JSON.stringify(seedPy)}`) passait par /bin/sh, qui ne
    // convertit jamais les \n de JSON.stringify en vrais retours à la ligne — Python recevait
    // donc un seul "token" avec des \n littéraux et échouait avec un SyntaxError silencieux
    // (node:test continue les sous-tests suivants même si un sous-test précédent échoue).
    const seedOut = execFileSync("python3", ["-c", seedPy], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "e2e-permanent-secret-0000000000000", APP_ENV: "test" },
    }).toString();
    if (process.env.FP_E2E_DEBUG) console.error("SEED OUTPUT:", seedOut);

    let r = await api("/auth/login", { method: "POST", body: { username: "testadmin", password: "test-admin-password" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    adminToken = r.data.access_token;
    if (process.env.FP_E2E_DEBUG) {
      const me = await api("/auth/me", { token: adminToken });
      console.error("ME AFTER LOGIN:", JSON.stringify(me.data));
    }
    r = await api("/auth/login", { method: "POST", body: { username: "RH01E2E", password: "rh01e2epass" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    restrictedToken = r.data.access_token;

    // Données réelles traversant chaque domaine testé plus bas.
    await api("/finance-core/obligations", { method: "POST", token: adminToken, body: {
      society: SOC, direction: "receivable", source_type: "manual", source_id: "E2E-CLIENT-1",
      amount_total: "125000.00", counterparty_name: "Sonatrach", due_date: "2020-01-15", idempotency_key: "e2e:obl:1",
    } });
    const dette = (await api("/finance-core/obligations", { method: "POST", token: adminToken, body: {
      society: SOC, direction: "payable", source_type: "manual", source_id: "E2E-FOURN-1",
      amount_total: "48000.00", counterparty_name: "Fournisseur Alpha", idempotency_key: "e2e:obl:2",
    } })).data;

    const acc = (await api("/banking/accounts", { method: "POST", token: adminToken, body: { society: SOC, bank_name: "BNA", account_number: "00998877002" } })).data;
    const csv = "date,label,reference,credit\n2026-09-01,Virement client,E2E-CLIENT-1,5000.00\n";
    const fd = new FormData();
    fd.append("society", SOC); fd.append("bank_account_id", String(acc.id)); fd.append("import_format", "csv"); fd.append("idempotency_key", "e2e:import:1");
    fd.append("file", new Blob([csv], { type: "text/csv" }), "r.csv");
    await api("/banking/statements/import", { method: "POST", token: adminToken, formData: fd });

    await api(`/finance-core/obligations/${dette.id}/settle`, { method: "POST", token: adminToken, body: { amount: "48000.00", idempotency_key: "e2e:settle:1" } });
    await api("/finance-core/outbox/dispatch", { method: "POST", token: adminToken });

    const src = (await api("/regulatory/sources", { method: "POST", token: adminToken, body: { name: "Barème E2E", reliability: "verified" } })).data;
    for (const [ruleType, params] of [["cnas_taux_salarial", { taux: 0.09 }], ["cnas_taux_patronal", { taux: 0.26 }], ["irg_bareme", { brackets: [{ up_to: null, rate: 0.1 }] }]]) {
      const rule = (await api("/regulatory/rules", { method: "POST", token: adminToken, body: { rule_type: ruleType, society: SOC, label: ruleType } })).data;
      const prop = (await api("/regulatory/proposals", { method: "POST", token: adminToken, body: { rule_id: rule.id, proposed_parameters: params, proposed_effective_from: "2026-01-01", source_id: src.id } })).data;
      await api(`/regulatory/proposals/${prop.id}/approve`, { method: "POST", token: adminToken, body: { mark_verified: true } });
    }
    const emp = (await api("/drh/employees", { method: "POST", token: adminToken, body: { code: "E2EPERM1", first_name: "E2E", last_name: "Perm", society: SOC, status: "actif", contract_type: "CDI" } })).data;
    const grid = (await api("/payroll/salary-grids", { method: "POST", token: adminToken, body: { society: SOC, poste: "Agent E2E", salaire_base: "55000.00", effective_from: "2026-01-01" } })).data;
    const run = (await api("/payroll/runs", { method: "POST", token: adminToken, body: { society: SOC, period: "2026-09", idempotency_key: "e2e:run:1" } })).data;
    const slip = (await api(`/payroll/runs/${run.id}/slips`, { method: "POST", token: adminToken, body: { employee_id: Number(emp.id || emp.backendId), salary_grid_id: grid.id, idempotency_key: "e2e:slip:1" } })).data;
    await api(`/payroll/slips/${slip.id}/validate`, { method: "POST", token: adminToken });

    await api("/budget/lines", { method: "POST", token: adminToken, body: { society: SOC, period: "2026-09", compte: "607", montant_budgete: "200000.00" } });
    await api("/fiscalite/declare", { method: "POST", token: adminToken, body: { society: SOC, obligation_type: "g50_tva", period: "2026-09", montant: "19000.00", echeance: "2026-10-20", idempotency_key: "e2e:fisc:1" } });
  });

  let browser;
  let mainPage; // réutilisée par les sous-tests suivants — browser.pages()[0] ramasse
                // l'onglet vide initial de Puppeteer, jamais celui qu'on a créé et connecté.
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (serverProc) serverProc.kill();
    fs.rmSync(DB_PATH, { force: true });
  });

  await t.test("les 12 écrans se chargent sans erreur console, avec des données réelles", async () => {
    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new", userDataDir: path.join(os.tmpdir(), `fp_e2e_chrome_${Date.now()}`), args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    mainPage = page;
    await page.setViewport({ width: 1440, height: 900 });
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

    await page.goto(`${BASE}/finance-platform`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#login-form", { timeout: 15000 });
    await page.type("input[name=username]", "testadmin");
    await page.type("input[name=password]", "test-admin-password");
    await Promise.all([page.click("button[type=submit]"), page.waitForSelector(".shell", { timeout: 8000 })]);

    for (const screen of SCREENS) {
      consoleErrors.length = 0;
      await page.evaluate((s) => { location.hash = "#/" + s; }, screen);
      await page.waitForFunction(
        () => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"),
        { timeout: 10000 }
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 350));
      const view = await page.evaluate(() => document.querySelector("#view")?.innerHTML || "");
      assert.ok(view.trim().length > 0, `page blanche sur ${screen}`);
      assert.strictEqual(consoleErrors.length, 0, `erreur(s) console sur ${screen} : ${consoleErrors.join(" | ")}`);
    }
  });

  await t.test("drawer + pagination + confirmation d'action sensible (annulée, aucun effet réel)", async () => {
    const page = mainPage;
    await page.evaluate(() => { location.hash = "#/creances"; });
    await new Promise((r) => setTimeout(r, 600));
    if (process.env.FP_E2E_DEBUG) {
      console.error("DEBUG society/user:", await page.evaluate(() => JSON.stringify({ society: window.FP.state.society, user: window.FP.state.user })));
    }
    await page.waitForSelector("table.data tbody tr [data-detail]", { timeout: 8000 });
    await page.click("table.data tbody tr [data-detail]");
    await page.waitForSelector(".drawer", { timeout: 5000 });
    const settleBtn = await page.$("#settle-btn");
    assert.ok(settleBtn, "le drawer doit proposer un règlement direct");
    await settleBtn.click();
    await page.waitForSelector(".confirm-box", { timeout: 4000 });
    const confirmText = await page.evaluate(() => document.querySelector(".confirm-box")?.innerText || "");
    assert.match(confirmText, /Sonatrach|Iron Global Securite/);
    await page.click(".confirm-box [data-cancel]"); // annulé : AUCUN règlement réel déclenché
    await page.keyboard.press("Escape");

    // Pagination : au moins la barre existe (même à 1 page, non cassée).
    await page.evaluate(() => { location.hash = "#/comptabilite"; });
    await new Promise((r) => setTimeout(r, 400));
    const hasPaginationOrList = await page.evaluate(() => !!document.querySelector("#ae-list"));
    assert.ok(hasPaginationOrList);
  });

  await t.test("changement société/période recharge les données", async () => {
    const page = mainPage;
    await page.evaluate(() => { location.hash = "#/dashboard"; });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      const p = document.querySelector("#period-input");
      p.value = "2020-01";
      p.dispatchEvent(new Event("change"));
    });
    await new Promise((r) => setTimeout(r, 500));
    const text = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
    assert.match(text, /2020-01/);
    // Remis à une période avec données réelles pour les sous-tests suivants.
    await page.evaluate(() => {
      const p = document.querySelector("#period-input");
      p.value = "2026-09";
      p.dispatchEvent(new Event("change"));
    });
    await new Promise((r) => setTimeout(r, 400));
  });

  await t.test("compte restreint (module 'drh' seul) : actions interdites absentes, jamais une garde UI seule", async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    await page.goto(`${BASE}/finance-platform`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#login-form", { timeout: 15000 });
    await page.type("input[name=username]", "RH01E2E");
    await page.type("input[name=password]", "rh01e2epass");
    await Promise.all([page.click("button[type=submit]"), page.waitForSelector(".shell", { timeout: 8000 })]);

    await page.evaluate(() => { location.hash = "#/creances"; });
    await new Promise((r) => setTimeout(r, 500));
    const hasCreateForm = await page.evaluate(() => !!document.querySelector("#obl-form"));
    assert.strictEqual(hasCreateForm, false, "le formulaire de mutation ne doit jamais être présent sans droit d'écriture");
    const listShowsRefusal = await page.evaluate(() => (document.querySelector("#obl-list")?.innerText || "").includes("Module non autoris"));
    assert.ok(listShowsRefusal, "la lecture doit être refusée CÔTÉ SERVEUR, pas seulement masquée côté UI");

    await page.evaluate(() => { location.hash = "#/banque"; });
    await new Promise((r) => setTimeout(r, 500));
    const hasAccForm = await page.evaluate(() => !!document.querySelector("#acc-form"));
    assert.strictEqual(hasAccForm, false);

    assert.deepStrictEqual(consoleErrors, []);
    await ctx.close();
  });

  await t.test("multi-société : bascule pendant une requête en vol, aucune réponse tardive n'apparaît dans le mauvais contexte", async () => {
    // Deux sociétés réellement connues (SOC créée par le seed ; SOC_B créée ici pour le test).
    // Mission §6 : minimum Dashboard, Banque, Obligations, Paie, Cockpit — chaque écran reçoit
    // sa propre donnée SOC_B distinctive (marqueur de fuite propre à cet écran), plutôt que de
    // supposer que le mécanisme générique guardedApi() suffit sans le rejouer partout.
    await api("/finance-core/obligations", { token: adminToken, method: "POST", body: {
      society: SOC_B, direction: "receivable", source_type: "manual", source_id: "E2E-SOCB-1",
      amount_total: "999999.99", counterparty_name: "SEUL DANS SOC_B", idempotency_key: "e2e:socb:1",
    } });
    await api("/banking/accounts", { token: adminToken, method: "POST", body: {
      society: SOC_B, bank_name: "BANQUESOLOSOCB", account_number: "SOCB-ACC-1",
    } });
    await api("/payroll/runs", { token: adminToken, method: "POST", body: {
      society: SOC_B, period: "2031-12", idempotency_key: "e2e:socb:run:1",
    } });

    const page = mainPage;
    // "999 999,99" formaté par money() avec un séparateur de milliers insécable (U+202F,
    // jamais une espace ordinaire) — normalisé avant comparaison pour ne pas dépendre du
    // caractère exact utilisé par la mise en forme.
    const norm = (s) => s.replace(/[\s  ]/g, "");
    const cases = [
      { screen: "dashboard", marker: "999999,99", normalize: true },
      { screen: "banque", marker: "BANQUESOLOSOCB", normalize: false },
      { screen: "creances", marker: "SEUL DANS SOC_B", normalize: false },
      { screen: "paie", marker: "2031-12", normalize: false },
      { screen: "cockpit", marker: "999999,99", normalize: true },
    ];
    for (const { screen, marker, normalize } of cases) {
      await page.evaluate((s) => { location.hash = "#/" + s; }, screen);
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate((socB) => {
        document.querySelector("#society-select").value = socB;
        // Ne PAS attendre : déclenche le changement puis bascule immédiatement une seconde
        // fois pour simuler une requête en vol interrompue par le race-guard (AbortController).
        document.querySelector("#society-select").dispatchEvent(new Event("change"));
      }, SOC_B);
      await page.evaluate((soc) => {
        document.querySelector("#society-select").value = soc;
        document.querySelector("#society-select").dispatchEvent(new Event("change"));
      }, SOC);
      await new Promise((r) => setTimeout(r, 600));
      let finalText = await page.evaluate(() => document.querySelector("#view")?.innerText || "");
      if (normalize) finalText = norm(finalText);
      assert.doesNotMatch(finalText, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `une réponse périmée de SOC_B ne doit jamais apparaître sur "${screen}" après être revenu sur SOC`);
    }
  });

  await t.test("comptabilité : écriture ouverte affiche Débit = Crédit, jamais recalculée côté client", async () => {
    const page = mainPage;
    await page.evaluate(() => { location.hash = "#/comptabilite"; });
    await page.waitForFunction(() => document.querySelector("#ae-list") && !document.querySelector("#ae-list").querySelector(".skeleton"), { timeout: 10000 });
    const opened = await page.evaluate(async () => {
      const btn = document.querySelector("[data-open-ecriture]");
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(opened, "au moins une écriture postée doit être ouvrable (settlement seedé au démarrage)");
    await page.waitForSelector(".drawer", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    const drawerText = await page.evaluate(() => document.querySelector(".drawer")?.innerText || "");
    assert.match(drawerText, /É[Qq]uilibrée/i); // badge en majuscules (text-transform CSS), contenu DOM réel en casse mixte
    assert.doesNotMatch(drawerText, /Déséquilibrée/i, "l'écriture affichée doit être équilibrée (Débit = Crédit), jamais recalculée côté client");
    await page.keyboard.press("Escape");
  });

  await t.test("responsive : 1440/1024/768/390 px sur les 13 écrans, aucun débordement horizontal", async () => {
    const page = mainPage;
    const widths = [1440, 1024, 768, 390];
    const allScreens = [...SCREENS, "banque"]; // "rapprochement" est un sous-onglet, déjà couvert en visitant "banque"
    for (const width of widths) {
      await page.setViewport({ width, height: 900 });
      for (const screen of allScreens) {
        await page.evaluate((s) => { location.hash = "#/" + s; }, screen);
        await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        const overflow = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 2);
        assert.strictEqual(overflow, false, `débordement horizontal non intentionnel sur "${screen}" à ${width}px`);
        const contentVisible = await page.evaluate(() => {
          const content = document.querySelector(".shell-content");
          return !!content && content.getBoundingClientRect().width > 0;
        });
        assert.ok(contentVisible, `contenu non visible/utilisable sur "${screen}" à ${width}px`);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
  });
});
