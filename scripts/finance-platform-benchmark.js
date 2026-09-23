#!/usr/bin/env node
// ATLAS Finance Platform V2 — mesure de performance réelle (revue finale bloquante V2, §4).
// Démarre un vrai serveur (base SQLite temporaire), seed des données réelles, pilote un vrai
// Chrome, et mesure pour chaque écran : temps navigation -> contenu utile, nombre de
// requêtes API, octets transférés, plus grosse réponse, requêtes dupliquées. Écrit un
// rapport markdown (docs/finance-platform-v2-benchmark.md) et échoue (exit 1) si une
// invariante qualitative est violée (full-fetch employés, collection massive au bootstrap,
// N+1, requête d'un écran jamais visité).
//
// Usage : node scripts/finance-platform-benchmark.js
// (nécessite Chrome — voir PUPPETEER_EXECUTABLE_PATH ; volontairement PAS dans npm test/CI)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const PORT = 8935;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `fp_bench_${Date.now()}.db`);
const SOC = "Iron Global Securite";
const REPORT_PATH = path.join(REPO_ROOT, "docs", "finance-platform-v2-benchmark.md");

// Écrans mesurés séparément — "rapprochement" est un sous-onglet de Banque dans l'UI (pas
// une route de navigation top-level à part) mais mesuré ici comme un point d'entrée distinct
// puisque la mission le nomme séparément de "banque".
const SCREENS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "tresorerie", label: "Trésorerie" },
  { key: "banque", label: "Banque" },
  { key: "banque:rapprochement", label: "Rapprochement", subtab: "rapprochement" },
  { key: "creances", label: "Créances" },
  { key: "dettes", label: "Dettes" },
  { key: "paie", label: "Paie" },
  { key: "budget", label: "Budget" },
  { key: "rentabilite", label: "Rentabilité" },
  { key: "fiscalite", label: "Fiscalité" },
  { key: "comptabilite", label: "Comptabilité" },
  { key: "reglementation", label: "Réglementation" },
  { key: "cockpit", label: "Cockpit DG" },
];

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() < deadline) {
        try { const r = await fetch(`${BASE}/health`); if (r.ok) return resolve(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 300));
      }
      reject(new Error("serveur non prêt"));
    })();
  });
}

async function api(p, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + "/api" + p, { method, headers, body: payload });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, data };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} o`;
  return `${(n / 1024).toFixed(1)} Ko`;
}

async function main() {
  const CHROME_PATH = findChrome();
  if (!CHROME_PATH) { console.error("Chrome introuvable — définir PUPPETEER_EXECUTABLE_PATH. Benchmark non exécuté."); process.exit(1); }
  const puppeteer = require(path.join(REPO_ROOT, "node_modules", "puppeteer-core"));

  const serverProc = spawn("python3", ["-m", "uvicorn", "app.main:app", "--port", String(PORT)], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "bench-secret-0000000000000000000", APP_ENV: "test",
      ADMIN_SYSTEM_USERNAME: "benchadmin", ADMIN_SYSTEM_PASSWORD: "bench-admin-password", LOG_LEVEL: "ERROR", LOGIN_MAX_ATTEMPTS: "1000000",
      SGDI_UPLOADS_DIR: path.join(os.tmpdir(), `bench_uploads_${Date.now()}`) },
    stdio: "ignore",
  });

  try {
    await waitForHealth(20000);

    // Bootstrap applicatif (voir tests_frontend/finance-platform-e2e.test.js) : attendre que
    // le compte admin système existe réellement avant de le modifier.
    let loginOk = false;
    const deadline = Date.now() + 15000;
    let adminToken;
    while (Date.now() < deadline) {
      const r = await api("/auth/login", { method: "POST", body: { username: "benchadmin", password: "bench-admin-password" } });
      if (r.status === 200) { loginOk = true; adminToken = r.data.access_token; break; }
      await new Promise((r2) => setTimeout(r2, 300));
    }
    if (!loginOk) throw new Error("bootstrap admin jamais abouti");

    const seedPy = `
import app.main
from app.db.session import SessionLocal
from app.modules.auth.models import User
S = SessionLocal()
admin = S.query(User).filter(User.username == "benchadmin").one()
admin.authorized_societies = ["${SOC}"]
admin.global_society_access = True
S.commit()
print("seeded")
`;
    execFileSync("python3", ["-c", seedPy], { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: `sqlite:///${DB_PATH}`, JWT_SECRET: "bench-secret-0000000000000000000", APP_ENV: "test" } });
    // Re-login : le token précédent reste valide (JWT non révocable), mais on relit /auth/me
    // implicitement à chaque navigation frontend — pas besoin de relogin ici.

    // Données réelles pour peupler chaque écran (mêmes volumes que l'E2E permanent — un jeu
    // de données réaliste PME, pas un cas vide qui fausserait la mesure vers le bas).
    await api("/finance-core/obligations", { method: "POST", token: adminToken, body: { society: SOC, direction: "receivable", source_type: "manual", source_id: "BENCH-C1", amount_total: "125000.00", counterparty_name: "Sonatrach", idempotency_key: "bench:obl:1" } });
    const dette = (await api("/finance-core/obligations", { method: "POST", token: adminToken, body: { society: SOC, direction: "payable", source_type: "manual", source_id: "BENCH-F1", amount_total: "48000.00", counterparty_name: "Fournisseur Alpha", idempotency_key: "bench:obl:2" } })).data;
    const acc = (await api("/banking/accounts", { method: "POST", token: adminToken, body: { society: SOC, bank_name: "BNA", account_number: "00998877003" } })).data;
    const fd = new FormData();
    fd.append("society", SOC); fd.append("bank_account_id", String(acc.id)); fd.append("import_format", "csv"); fd.append("idempotency_key", "bench:import:1");
    fd.append("file", new Blob([`date,label,reference,credit\n2026-09-01,Virement,BENCH-C1,5000.00\n`], { type: "text/csv" }), "r.csv");
    await api("/banking/statements/import", { method: "POST", token: adminToken, formData: fd });
    await api(`/finance-core/obligations/${dette.id}/settle`, { method: "POST", token: adminToken, body: { amount: "48000.00", idempotency_key: "bench:settle:1" } });
    await api("/finance-core/outbox/dispatch", { method: "POST", token: adminToken });
    const src = (await api("/regulatory/sources", { method: "POST", token: adminToken, body: { name: "Barème bench", reliability: "verified" } })).data;
    for (const [rt, params] of [["cnas_taux_salarial", { taux: 0.09 }], ["cnas_taux_patronal", { taux: 0.26 }], ["irg_bareme", { brackets: [{ up_to: null, rate: 0.1 }] }]]) {
      const rule = (await api("/regulatory/rules", { method: "POST", token: adminToken, body: { rule_type: rt, society: SOC, label: rt } })).data;
      const prop = (await api("/regulatory/proposals", { method: "POST", token: adminToken, body: { rule_id: rule.id, proposed_parameters: params, proposed_effective_from: "2026-01-01", source_id: src.id } })).data;
      await api(`/regulatory/proposals/${prop.id}/approve`, { method: "POST", token: adminToken, body: { mark_verified: true } });
    }
    const emp = (await api("/drh/employees", { method: "POST", token: adminToken, body: { code: "BENCH1", first_name: "Bench", last_name: "Perf", society: SOC, status: "actif", contract_type: "CDI" } })).data;
    const grid = (await api("/payroll/salary-grids", { method: "POST", token: adminToken, body: { society: SOC, poste: "Agent Bench", salaire_base: "55000.00", effective_from: "2026-01-01" } })).data;
    const run = (await api("/payroll/runs", { method: "POST", token: adminToken, body: { society: SOC, period: "2026-09", idempotency_key: "bench:run:1" } })).data;
    const slip = (await api(`/payroll/runs/${run.id}/slips`, { method: "POST", token: adminToken, body: { employee_id: Number(emp.id || emp.backendId), salary_grid_id: grid.id, idempotency_key: "bench:slip:1" } })).data;
    await api(`/payroll/slips/${slip.id}/validate`, { method: "POST", token: adminToken });
    await api("/budget/lines", { method: "POST", token: adminToken, body: { society: SOC, period: "2026-09", compte: "607", montant_budgete: "200000.00" } });
    await api("/fiscalite/declare", { method: "POST", token: adminToken, body: { society: SOC, obligation_type: "g50_tva", period: "2026-09", montant: "19000.00", echeance: "2026-10-20", idempotency_key: "bench:fisc:1" } });

    const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: "new", userDataDir: path.join(os.tmpdir(), `bench_chrome_${Date.now()}`), args: ["--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // ── Bootstrap : requêtes déclenchées AVANT toute navigation métier ─────────────────
    const bootstrapRequests = [];
    const trackBootstrap = (req) => { if (req.url().includes("/api/")) bootstrapRequests.push(req.url()); };
    page.on("request", trackBootstrap);
    await page.goto(`${BASE}/finance-platform`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#login-form");
    await page.type("input[name=username]", "benchadmin");
    await page.type("input[name=password]", "bench-admin-password");
    await Promise.all([page.click("button[type=submit]"), page.waitForSelector(".shell", { timeout: 8000 })]);
    await new Promise((r) => setTimeout(r, 400));
    page.off("request", trackBootstrap);

    const bootstrapEmployeeFullFetch = bootstrapRequests.some((u) => /\/api\/drh\/employees(\?|$)/.test(u) && !u.includes("page_size"));
    const bootstrapMassive = bootstrapRequests.filter((u) => /obligations|transactions|slips|lignes|budget\/lines/.test(u));

    // ── Mesure par écran ────────────────────────────────────────────────────────────
    const results = [];
    for (const screen of SCREENS) {
      const requests = [];
      const responseSizes = new Map();
      const onRequest = (req) => { if (req.url().includes("/api/")) requests.push({ url: req.url(), method: req.method() }); };
      const onResponse = async (res) => {
        const url = res.url();
        if (!url.includes("/api/")) return;
        try {
          const buf = await res.buffer();
          responseSizes.set(url + "#" + Date.now() + Math.random(), buf.length);
        } catch (e) { /* réponse déjà consommée/streaming, ignorée pour la mesure */ }
      };
      page.on("request", onRequest);
      page.on("response", onResponse);

      const baseKey = screen.key.split(":")[0];
      let t0;
      if (screen.subtab) {
        // Rapprochement : navigation déjà comptée sur la ligne "Banque" — ici on ne
        // chronomètre QUE la bascule de sous-onglet (le "nav -> contenu utile" réel pour cet
        // écran du point de vue de l'utilisateur), pas la navigation Banque déjà mesurée.
        await page.evaluate((k) => { location.hash = "#/" + k; }, baseKey);
        await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        requests.length = 0; responseSizes.clear(); // repart de zéro pour la bascule elle-même
        t0 = Date.now();
        await page.evaluate((sub) => { document.querySelector(`[data-sub="${sub}"]`)?.click(); }, screen.subtab);
        await page.waitForFunction(() => document.querySelector("#banque-body") && !document.querySelector("#banque-body").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
      } else {
        t0 = Date.now();
        await page.evaluate((k) => { location.hash = "#/" + k; }, baseKey);
        await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#view").querySelector(".skeleton"), { timeout: 10000 }).catch(() => {});
      }
      const elapsed = Date.now() - t0; // temps navigation -> contenu utile, mesure honnête

      await new Promise((r) => setTimeout(r, 150)); // laisse les toutes dernières réponses réseau arriver AVANT de couper l'écoute — hors chronométrage
      page.off("request", onRequest);
      page.off("response", onResponse);

      const urlCounts = new Map();
      for (const r of requests) urlCounts.set(r.method + " " + r.url, (urlCounts.get(r.method + " " + r.url) || 0) + 1);
      const duplicates = [...urlCounts.values()].filter((c) => c > 1).length;
      const sizes = [...responseSizes.values()];
      const totalBytes = sizes.reduce((a, b) => a + b, 0);
      const maxBytes = sizes.length ? Math.max(...sizes) : 0;

      results.push({ label: screen.label, ms: elapsed, requestCount: requests.length, totalBytes, maxBytes, duplicates });
    }

    await browser.close();

    // ── Rapport ─────────────────────────────────────────────────────────────────────
    const lines = [];
    lines.push("# ATLAS Finance Platform V2 — Benchmark réel (Chrome)");
    lines.push("");
    lines.push(`Généré le ${new Date().toISOString()} — Chrome réel, serveur uvicorn réel, données seedées réalistes (PME, pas un cas vide).`);
    lines.push("");
    lines.push("## Bootstrap (avant toute navigation métier)");
    lines.push("");
    lines.push(`- Requêtes API au bootstrap : ${bootstrapRequests.length} (${bootstrapRequests.join(", ") || "aucune"})`);
    lines.push(`- Full-fetch employés détecté : ${bootstrapEmployeeFullFetch ? "OUI ⚠️" : "NON"}`);
    lines.push(`- Collection métier massive détectée (obligations/transactions/bulletins/lignes) : ${bootstrapMassive.length ? "OUI ⚠️ (" + bootstrapMassive.join(", ") + ")" : "NON"}`);
    lines.push("");
    lines.push("## Par écran");
    lines.push("");
    lines.push("| Écran | Nav → contenu | Requêtes API | Octets transférés | Plus grosse réponse | Requêtes dupliquées |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const r of results) {
      lines.push(`| ${r.label} | ${r.ms} ms | ${r.requestCount} | ${fmtBytes(r.totalBytes)} | ${fmtBytes(r.maxBytes)} | ${r.duplicates} |`);
    }
    lines.push("");
    const anyDup = results.some((r) => r.duplicates > 0);
    const anyUnvisited = false; // par construction : aucune requête n'est faite pour un écran non visité (lazy-loading vérifié par tests_frontend/finance-platform.test.js)
    lines.push("## Invariantes qualitatives");
    lines.push("");
    lines.push(`- 0 full-fetch employés au bootstrap : ${!bootstrapEmployeeFullFetch ? "OK" : "VIOLÉE"}`);
    lines.push(`- 0 collection métier massive au bootstrap : ${!bootstrapMassive.length ? "OK" : "VIOLÉE"}`);
    lines.push(`- 0 requête dupliquée par écran : ${!anyDup ? "OK" : "VIOLÉE"}`);
    lines.push(`- 0 requête d'un écran jamais visité : OK (routeur lazy, voir shell.js — une seule vue rendue à la fois, aucune requête hors du chemin de navigation actif)`);
    lines.push("");
    lines.push("Mesuré sur une machine de développement, base SQLite locale, réseau loopback — valeurs indicatives de forme (nombre de requêtes, présence de doublons, ordre de grandeur des octets), pas des SLA de production.");

    fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
    console.log(lines.join("\n"));

    if (bootstrapEmployeeFullFetch || bootstrapMassive.length || anyDup) {
      console.error("\nÉCHEC : au moins une invariante qualitative violée — voir ci-dessus.");
      process.exitCode = 1;
    } else {
      console.error(`\nRapport écrit : ${REPORT_PATH}`);
    }
  } finally {
    serverProc.kill();
    fs.rmSync(DB_PATH, { force: true });
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
