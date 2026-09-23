// Finance Platform V2 — tests jsdom sur le VRAI code (api.js/shell.js/views/*.js), aucun
// mock de logique métier (uniquement fetch, réseau absent de jsdom). Complète les tests
// backend (RBAC/multi-société/pagination déjà couverts par pytest) et la vérification E2E
// Chrome réelle (§19, faite manuellement pendant la construction) par des régressions
// permanentes sur la logique frontend elle-même : formatage, garde RBAC UI, complétude de
// la navigation, pagination, états vide/erreur.
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const FP_DIR = path.join(__dirname, "..", "app", "static", "finance-platform");
const API_SRC = fs.readFileSync(path.join(FP_DIR, "api.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(FP_DIR, "shell.js"), "utf8");
const VIEWS_DIR = path.join(FP_DIR, "views");
const VIEW_FILES = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith(".js")).sort();
const VIEW_SRCS = VIEW_FILES.map((f) => fs.readFileSync(path.join(VIEWS_DIR, f), "utf8"));

const NAV_KEYS = [
  "dashboard", "tresorerie", "banque", "creances", "dettes",
  "paie", "budget", "rentabilite", "fiscalite", "comptabilite", "reglementation", "cockpit",
];

function freshWindow({ user, fetchImpl } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/finance-platform", runScripts: "outside-only" }
  );
  const { window } = dom;
  window.localStorage.setItem("fp_token", "test-token");
  window.fetch = fetchImpl || (() => Promise.resolve({ ok: true, text: () => Promise.resolve("{}") }));
  window.eval(API_SRC);
  if (user) window.FP.state.user = user;
  return window;
}

// ── api.js : formatage (jamais de recalcul flottant, juste l'affichage) ──────────────────
test("money() formate un Decimal-string sans jamais passer par un calcul flottant", () => {
  const w = freshWindow();
  const NBSP = " "; // espace fine insécable — séparateur de milliers français correct
  assert.strictEqual(w.FP.money("1234567.5"), `1${NBSP}234${NBSP}567,50`);
  assert.strictEqual(w.FP.money("0.01"), "0,01");
  assert.strictEqual(w.FP.money("-500.00"), "-500,00");
  assert.strictEqual(w.FP.money(null), "—");
  assert.strictEqual(w.FP.money("999999999999.99"), `999${NBSP}999${NBSP}999${NBSP}999,99`);
});

test("pct()/dateFr()/daysUntil()", () => {
  const w = freshWindow();
  assert.strictEqual(w.FP.pct(12.345), "12.3%");
  assert.strictEqual(w.FP.pct(null), "—");
  assert.strictEqual(w.FP.dateFr(null), "—");
  // TROUVÉ EN CONSTRUISANT LA REVUE FINALE V2 (§13) : daysUntil() raisonne entièrement en
  // heure LOCALE (new Date(v+"T00:00:00") sans "Z"), donc construire la date attendue via
  // .toISOString() (qui restitue de l'UTC) fait un aller-retour par un fuseau différent —
  // flaky près de minuit local dans un fuseau UTC+, ex. 00:51 heure locale : le test
  // attendait 3 et obtenait 2. Corrigé en restant en composants de date locaux, comme
  // daysUntil() lui-même, plutôt que d'introduire un correctif dans l'application.
  const future = new Date(); future.setDate(future.getDate() + 3);
  const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  assert.strictEqual(w.FP.daysUntil(iso), 3);
  assert.strictEqual(w.FP.daysUntil(null), null);
});

// ── RBAC UI : hasFinanceAccess/isAdmin dérivés UNIQUEMENT de /auth/me (jamais reconstruits)
test("hasFinanceAccess() reflète exactement effective_modules/module_access_global", () => {
  const w1 = freshWindow({ user: { effective_modules: ["drh"], module_access_global: false } });
  assert.strictEqual(w1.FP.hasFinanceAccess(), false, "un compte 'drh' seul ne doit jamais avoir accès Finances");

  const w2 = freshWindow({ user: { effective_modules: ["finances"], module_access_global: false } });
  assert.strictEqual(w2.FP.hasFinanceAccess(), true);

  const w3 = freshWindow({ user: { effective_modules: [], module_access_global: true } });
  assert.strictEqual(w3.FP.hasFinanceAccess(), true, "un admin global a toujours accès, même sans le module listé explicitement");
  assert.strictEqual(w3.FP.isAdmin(), true);
});

test("noAccessNotice()/emptyState()/errorState() rendent un état explicite, jamais un formulaire vide silencieux", () => {
  const w = freshWindow();
  assert.match(w.FP.noAccessNotice("création"), /Lecture seule/);
  assert.match(w.FP.noAccessNotice("création"), /création/);
  assert.match(w.FP.emptyState("Aucune donnée."), /Aucune donnée\./);
  const err = w.FP.errorState(new Error("Panne réseau"), "Réessayer");
  assert.match(err, /Panne réseau/);
  assert.match(err, /data-retry/);
});

// ── Pagination : bornes désactivées correctement, jamais de bouton actif hors limites ────
test("paginationBar() désactive Précédent en page 1 et Suivant en dernière page", () => {
  const w = freshWindow();
  const barFirst = w.FP.paginationBar({ page: 1, pages: 3, total: 42 }, () => {});
  assert.match(barFirst.querySelector("[data-prev]").outerHTML, /disabled/);
  assert.doesNotMatch(barFirst.querySelector("[data-next]").outerHTML, /disabled/);

  const barLast = w.FP.paginationBar({ page: 3, pages: 3, total: 42 }, () => {});
  assert.doesNotMatch(barLast.querySelector("[data-prev]").outerHTML, /disabled/);
  assert.match(barLast.querySelector("[data-next]").outerHTML, /disabled/);
});

// ── shell.js : complétude de la navigation — chaque clé du plan (§1 de la mission) a une
// vue RÉELLEMENT enregistrée (attrape l'oubli de charger/enregistrer un fichier de vue) ────
test("shell.js définit les 12 entrées de navigation attendues, toutes distinctes", () => {
  const w = freshWindow({ fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ items: ["SOC"] })) }) });
  // évite le bootstrap auto (fetch réseau) sans casser la fermeture de l'IIFE finale
  w.eval(SHELL_SRC.replace(/if \(state\.token\) \{[\s\S]*?\n  \}\n/, ""));
  const keys = [];
  w.document.body.innerHTML = '<div id="root"></div>';
  // NAV est interne au module ; on le vérifie indirectement via le rendu du shell.
  w.FP.state.user = { full_name: "Test", authorized_societies: ["SOC"], effective_modules: ["finances"], module_access_global: true };
  return w.FinanceShell.renderShell().then(() => {
    const rendered = [...w.document.querySelectorAll("[data-nav]")].map((b) => b.dataset.nav);
    for (const key of NAV_KEYS) assert.ok(rendered.includes(key), `navigation manquante : ${key}`);
    assert.strictEqual(new Set(rendered).size, rendered.length, "clés de navigation dupliquées");
  });
});

test("chaque clé de navigation a une vue réellement enregistrée dans window.FinanceViews", () => {
  const w = freshWindow();
  VIEW_SRCS.forEach((src) => w.eval(src));
  for (const key of NAV_KEYS) {
    assert.strictEqual(typeof w.FinanceViews[key], "function", `aucune vue enregistrée pour "${key}"`);
  }
});

// ── RBAC UI concret : un compte sans le module Finances ne doit jamais voir un formulaire
// de mutation — régression permanente du défaut trouvé pendant le diagnostic RBAC production
test("views/obligations.js masque le formulaire de création quand canWrite=false", async () => {
  const w = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ items: [], total: 0, page: 1, pages: 1, page_size: 20 })) }),
  });
  w.eval(fs.readFileSync(path.join(VIEWS_DIR, "obligations.js"), "utf8"));
  const container = w.document.createElement("div");
  w.document.body.appendChild(container);
  await w.FinanceViews.creances(container, { society: "SOC", period: "2026-09", canWrite: false, isAdmin: false, navigate: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(container.querySelector("#obl-form"), null, "le formulaire de création ne doit jamais être rendu sans droit d'écriture");
  assert.match(container.innerHTML, /Lecture seule/);
});

test("views/obligations.js affiche le formulaire de création quand canWrite=true", async () => {
  const w = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ items: [], total: 0, page: 1, pages: 1, page_size: 20 })) }),
  });
  w.eval(fs.readFileSync(path.join(VIEWS_DIR, "obligations.js"), "utf8"));
  const container = w.document.createElement("div");
  w.document.body.appendChild(container);
  await w.FinanceViews.dettes(container, { society: "SOC", period: "2026-09", canWrite: true, isAdmin: false, navigate: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.notStrictEqual(container.querySelector("#obl-form"), null);
});

// ── Course/annulation : guardedApi ne doit jamais laisser une réponse périmée écraser un
// rendu plus récent (deux navigations rapides sur le même "slot") ─────────────────────────
test("guardedApi() annule la requête précédente du même slot (race-guard)", async () => {
  let firstAborted = false;
  const w = freshWindow({
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      opts.signal?.addEventListener("abort", () => { firstAborted = true; reject(new DOMException("Aborted", "AbortError")); });
    }),
  });
  const p1 = w.FP.guardedApi("slot-a", "/finance-core/obligations");
  w.FP.guardedApi("slot-a", "/finance-core/obligations"); // seconde requête, même slot -> annule la première
  await assert.rejects(p1, /AbortError|Aborted/);
  assert.strictEqual(firstAborted, true);
});
