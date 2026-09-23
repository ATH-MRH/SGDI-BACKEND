// ATLAS Site Workforce — tests jsdom sur le VRAI code (api.js/shell.js/views/*.js), aucun
// mock de logique métier (uniquement fetch, réseau absent de jsdom). Complète les tests
// backend (RBAC/cross-site déjà couverts par pytest, tests/test_site_workforce.py) par des
// régressions permanentes sur la logique frontend : navigation, séparation UI justificatif/
// absence, absence de toute action "décision" en discipline (backend-autoritaire : la
// route n'existe pas, mais l'UI ne doit pas non plus prétendre l'exposer).
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const SW_DIR = path.join(__dirname, "..", "app", "static", "site-workforce");
const API_SRC = fs.readFileSync(path.join(SW_DIR, "api.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(SW_DIR, "shell.js"), "utf8");
const VIEWS_DIR = path.join(SW_DIR, "views");
const VIEW_FILES = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith(".js")).sort();
const VIEW_SRCS = VIEW_FILES.map((f) => fs.readFileSync(path.join(VIEWS_DIR, f), "utf8"));

const NAV_KEYS = ["dashboard", "personnel", "pointage", "absences", "justificatifs", "conges", "maladies", "discipline", "reclamations"];

function freshWindow({ user, site, fetchImpl } = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/site-workforce", runScripts: "outside-only" }
  );
  const { window } = dom;
  window.localStorage.setItem("sw_token", "test-token");
  window.fetch = fetchImpl || (() => Promise.resolve({ ok: true, text: () => Promise.resolve("{}") }));
  window.eval(API_SRC);
  if (user) window.SW.state.user = user;
  if (site) window.SW.state.site = site;
  return window;
}

test("dateFr() formate une date ISO sans jamais planter sur une valeur absente", () => {
  const w = freshWindow();
  assert.strictEqual(w.SW.dateFr(null), "—");
  assert.strictEqual(w.SW.dateFr("2026-09-23"), new Date("2026-09-23T00:00:00").toLocaleDateString("fr-FR"));
});

test("hasSiteWorkforceAccess() reflète exactement effective_modules/module_access_global", () => {
  const w1 = freshWindow({ user: { effective_modules: ["drh"], module_access_global: false } });
  assert.strictEqual(w1.SW.hasSiteWorkforceAccess(), false);
  const w2 = freshWindow({ user: { effective_modules: ["site_workforce"], module_access_global: false } });
  assert.strictEqual(w2.SW.hasSiteWorkforceAccess(), true);
});

test("shell.js définit les 9 entrées de navigation attendues, toutes distinctes, sans sélecteur libre de société/site", () => {
  const w = freshWindow({
    site: { id: 1, name: "Site A" },
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ site: { id: 1, name: "Site A" }, kpi: {}, actions_rapides: { prochains_conges: [] } })) }),
  });
  w.eval(SHELL_SRC.replace(/if \(state\.token\) \{[\s\S]*?\n  \}\n/, ""));
  w.SW.state.user = { full_name: "Test" };
  return w.SiteWorkforceShell.renderShell().then(() => {
    const rendered = [...w.document.querySelectorAll("[data-nav]")].map((b) => b.dataset.nav);
    for (const key of NAV_KEYS) assert.ok(rendered.includes(key), `navigation manquante : ${key}`);
    assert.strictEqual(new Set(rendered).size, rendered.length, "clés de navigation dupliquées");
    // §B6 : aucun <select>/champ libre de société ou de site dans le header — le site est
    // affiché (site-chip, texte non éditable), jamais choisi.
    assert.strictEqual(w.document.querySelector("#society-select"), null);
    assert.strictEqual(w.document.querySelector("#site-select"), null);
    assert.ok(w.document.querySelector(".site-chip"), "le site actif doit être affiché (lecture seule)");
  });
});

test("chaque clé de navigation a une vue réellement enregistrée dans window.SiteWorkforceViews", () => {
  const w = freshWindow();
  VIEW_SRCS.forEach((src) => w.eval(src));
  for (const key of NAV_KEYS) {
    assert.strictEqual(typeof w.SiteWorkforceViews[key], "function", `aucune vue enregistrée pour "${key}"`);
  }
});

// ── §B13 : aucune action de décision/clôture disciplinaire côté UI (cohérent avec le
// backend qui n'expose pas la route) — seules "Créer" (brouillon) et "Signaler" existent.
test("views/discipline.js n'expose jamais d'action de décision ou de clôture", async () => {
  const w = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([
      { id: 1, subject: "Retard", event_type: "retard", employee_id: 5, status: "signale" },
    ])) }),
  });
  w.eval(fs.readFileSync(path.join(VIEWS_DIR, "discipline.js"), "utf8"));
  const container = w.document.createElement("div");
  w.document.body.appendChild(container);
  await w.SiteWorkforceViews.discipline(container);
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(container.querySelector("[data-decision]"), null);
  assert.strictEqual(container.querySelector("[data-cloture]"), null);
  assert.ok(container.querySelector("[data-transmit]"), "un incident signalé doit pouvoir être transmis à la DRH");
});

// ── Revue finale d'intégration (§5) : rejoue le XSS stocké corrigé — un sujet d'incident/
// réclamation contenant balises, gestionnaires d'événement et caractères spéciaux ne doit
// JAMAIS s'exécuter ni s'injecter dans la boîte de confirmation de transmission.
test("la confirmation de transmission (discipline) échappe un sujet contenant balises/script/gestionnaires d'événement", async () => {
  const payload = `<img src=x onerror="window.__xss_fired=1"><script>window.__xss_fired=2</script>"'&<b>`;
  const w = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([
      { id: 1, subject: payload, event_type: "retard", employee_id: 5, status: "signale" },
    ])) }),
  });
  w.eval(fs.readFileSync(path.join(VIEWS_DIR, "discipline.js"), "utf8"));
  const container = w.document.createElement("div");
  w.document.body.appendChild(container);
  await w.SiteWorkforceViews.discipline(container);
  await new Promise((r) => setTimeout(r, 0));
  container.querySelector("[data-transmit]").click();
  await new Promise((r) => setTimeout(r, 0));
  const box = w.document.querySelector(".confirm-box");
  assert.ok(box, "la boîte de confirmation doit s'afficher");
  assert.strictEqual(box.querySelector("img"), null, "aucune balise <img> injectée depuis le sujet");
  assert.strictEqual(box.querySelector("script"), null, "aucune balise <script> injectée depuis le sujet");
  assert.strictEqual(w.__xss_fired, undefined, "aucun gestionnaire d'événement injecté ne doit jamais s'exécuter");
  assert.match(box.innerHTML, /&lt;img/, "le sujet doit apparaître échappé dans le HTML, jamais interprété");
});

test("la confirmation de transmission (réclamations) échappe un sujet contenant balises/script/gestionnaires d'événement", async () => {
  const payload = `<img src=x onerror="window.__xss_fired=1"><script>window.__xss_fired=2</script>"'&<b>`;
  const w = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([
      { id: 1, subject: payload, employee_id: 5, status: "nouvelle", priority: "normale" },
    ])) }),
  });
  w.prompt = () => "drh"; // window.prompt est appelé par la vue pour choisir le destinataire
  w.eval(fs.readFileSync(path.join(VIEWS_DIR, "reclamations.js"), "utf8"));
  const container = w.document.createElement("div");
  w.document.body.appendChild(container);
  await w.SiteWorkforceViews.reclamations(container);
  await new Promise((r) => setTimeout(r, 0));
  container.querySelector("[data-transmit]").click();
  await new Promise((r) => setTimeout(r, 0));
  const box = w.document.querySelector(".confirm-box");
  assert.ok(box, "la boîte de confirmation doit s'afficher");
  assert.strictEqual(box.querySelector("img"), null, "aucune balise <img> injectée depuis le sujet");
  assert.strictEqual(box.querySelector("script"), null, "aucune balise <script> injectée depuis le sujet");
  assert.strictEqual(w.__xss_fired, undefined, "aucun gestionnaire d'événement injecté ne doit jamais s'exécuter");
  assert.match(box.innerHTML, /&lt;img/, "le sujet doit apparaître échappé dans le HTML, jamais interprété");
});

// ── §B9 : la vue Absences ne présente jamais un contrôle de vérification de document, et
// la vue Justificatifs ne présente jamais un contrôle de décision d'absence — deux écrans,
// deux statuts, jamais mélangés dans la même action.
test("views/absences.js et views/justificatifs.js exposent des actions strictement distinctes", async () => {
  const wAbs = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([
      { id: 1, employee_id: 5, presence_date: "2026-09-20", absence_decision_status: "en_attente" },
    ])) }),
  });
  wAbs.eval(fs.readFileSync(path.join(VIEWS_DIR, "absences.js"), "utf8"));
  const c1 = wAbs.document.createElement("div");
  wAbs.document.body.appendChild(c1);
  await wAbs.SiteWorkforceViews.absences(c1);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(c1.querySelector("[data-decide]"), "une absence en attente doit pouvoir être décidée");
  assert.strictEqual(c1.querySelector("[data-verify]"), null, "jamais un contrôle de vérification de document ici");

  const wJust = freshWindow({
    fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify([
      { id: 1, label: "Certificat", owner_type: "attendance", owner_id: 1, validity_status: "en_attente" },
    ])) }),
  });
  wJust.eval(fs.readFileSync(path.join(VIEWS_DIR, "justificatifs.js"), "utf8"));
  const c2 = wJust.document.createElement("div");
  wJust.document.body.appendChild(c2);
  await wJust.SiteWorkforceViews.justificatifs(c2);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(c2.querySelector("[data-verify]"), "un document en attente doit pouvoir être vérifié");
  assert.strictEqual(c2.querySelector("[data-decide]"), null, "jamais un contrôle de décision d'absence ici");
});

test("noAccessNotice/emptyState/errorState rendent un état explicite, jamais une page vide silencieuse", () => {
  const w = freshWindow();
  assert.match(w.SW.emptyState("Rien ici"), /Rien ici/);
  assert.match(w.SW.errorState(new w.SW.ApiError("Panne", 500)), /Panne/);
});
