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

// Faux backend : périmètre autorisé A(A1,A2) + B(B1) ; toute requête est journalisée.
const SCOPE = { societies: ["SocA", "SocB"], sites: [
  { id: 1, name: "A1", society: "SocA" }, { id: 2, name: "A2", society: "SocA" }, { id: 3, name: "B1", society: "SocB" },
] };
function scopedFetch(calls, extra = {}) {
  return (url) => {
    calls.push(url);
    const u = new URL(url, "http://localhost");
    let body = [];
    if (u.pathname === "/api/site-workforce/scope") body = extra.scope || SCOPE;
    else if (u.pathname === "/api/site-workforce/dashboard") body = { site: null, kpi: {}, actions_rapides: { prochains_conges: [] }, by_site: [] };
    else if (u.pathname === "/api/site-workforce/employees") body = { items: [], total: 0, page: 1, pages: 1 };
    if (extra[u.pathname]) body = extra[u.pathname](u);
    return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}
function shellWindow(fetchImpl) {
  const w = freshWindow({ fetchImpl });
  VIEW_SRCS.forEach((src) => w.eval(src));
  w.eval(SHELL_SRC.replace(/if \(state\.token\) \{[\s\S]*?\n  \}\n/, ""));
  w.SW.state.user = { full_name: "CE Test", username: "ce01" };
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("shell.js définit les 9 entrées de navigation, et des sélecteurs limités au périmètre autorisé", async () => {
  const calls = [];
  const w = shellWindow(scopedFetch(calls));
  await w.SiteWorkforceShell.renderShell();
  const rendered = [...w.document.querySelectorAll("[data-nav]")].map((b) => b.dataset.nav);
  for (const key of NAV_KEYS) assert.ok(rendered.includes(key), `navigation manquante : ${key}`);
  assert.strictEqual(new Set(rendered).size, rendered.length, "clés de navigation dupliquées");
  const socs = [...w.document.querySelectorAll("#society-select option")].map((o) => [o.value, o.textContent]);
  assert.deepStrictEqual(socs, [["", "Toutes mes sociétés"], ["SocA", "SocA"], ["SocB", "SocB"]]);
  const sites = [...w.document.querySelectorAll("#site-select option")].map((o) => o.textContent);
  assert.deepStrictEqual(sites, ["Tous mes sites", "A1", "A2", "B1"]);
  assert.match(w.document.querySelector(".scope-chip").textContent, /Toutes mes sociétés — tous mes sites \(3\)/);
});

test("sélecteurs : société → sites de la société ; site → requêtes filtrées ; retour à tous les sites", async () => {
  const calls = [];
  const w = shellWindow(scopedFetch(calls));
  await w.SiteWorkforceShell.renderShell();
  const soc = w.document.querySelector("#society-select");
  soc.value = "SocA"; soc.dispatchEvent(new w.Event("change"));
  await tick();
  assert.deepStrictEqual([...w.document.querySelectorAll("#site-select option")].map((o) => o.textContent), ["Tous mes sites", "A1", "A2"]);
  assert.ok(calls.at(-1).includes("society=SocA") && !calls.at(-1).includes("site_id"), calls.at(-1));
  const site = w.document.querySelector("#site-select");
  site.value = "2"; site.dispatchEvent(new w.Event("change"));
  await tick();
  assert.ok(calls.at(-1).includes("site_id=2"), calls.at(-1));
  assert.match(w.document.querySelector(".scope-chip").textContent, /Site : A2 — SocA/);
  // Sidebar : périmètre AUTORISÉ (3 sites), indépendant de la sélection ; jamais « Site : — ».
  assert.match(w.document.querySelector(".shell-role-badge").textContent, /Périmètre : 3 sites/);
  assert.doesNotMatch(w.document.querySelector(".shell-role-badge").textContent, /Site : —/);
  const soc2 = w.document.querySelector("#society-select");
  soc2.value = ""; soc2.dispatchEvent(new w.Event("change"));
  await tick();
  assert.ok(!calls.at(-1).includes("site_id") && !calls.at(-1).includes("society"), calls.at(-1));
  assert.match(w.document.querySelector(".scope-chip").textContent, /tous mes sites \(3\)/);
});

test("une valeur mémorisée hors périmètre n'est jamais envoyée (retour à tout le périmètre autorisé)", async () => {
  const calls = [];
  const w = shellWindow(scopedFetch(calls));
  w.localStorage.setItem("sw_scope", JSON.stringify({ society: "SocC", site_id: "99" }));
  await w.SiteWorkforceShell.renderShell();
  assert.deepStrictEqual({ ...w.SW.state.scope }, { society: "", site_id: "" });
  assert.ok(calls.every((u) => !u.includes("SocC") && !u.includes("site_id=99")), calls.join("\n"));
});

test("la sélection mémorisée d'un autre compte n'est jamais reprise", async () => {
  const w = shellWindow(scopedFetch([]));
  w.localStorage.setItem("sw_scope", JSON.stringify({ society: "SocA", site_id: "1", user: "autre_compte" }));
  await w.SiteWorkforceShell.renderShell();
  assert.deepStrictEqual({ ...w.SW.state.scope }, { society: "", site_id: "" });
  assert.strictEqual(JSON.parse(w.localStorage.getItem("sw_scope")).user, "ce01");
});

test("aucune donnée périmée : une réponse de l'ancien périmètre est ignorée après un changement", async () => {
  let release;
  const calls = [];
  const w = shellWindow((url) => {
    calls.push(url);
    if (url.includes("/employees") && url.includes("site_id=1")) {
      return new Promise((resolve) => { release = () => resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ items: [{ id: 1, code: "OLD-A1", first_name: "Old", last_name: "A1" }], total: 1, page: 1, pages: 1 })) }); });
    }
    return scopedFetch([])(url);
  });
  w.localStorage.setItem("sw_scope", JSON.stringify({ society: "SocA", site_id: "1", user: "ce01" }));
  w.location.hash = "#/personnel";
  await w.SiteWorkforceShell.renderShell();
  await tick();
  const site = w.document.querySelector("#site-select");
  site.value = "2"; site.dispatchEvent(new w.Event("change"));
  await tick();
  release();
  await tick(); await tick();
  assert.ok(!w.document.querySelector("#view").textContent.includes("OLD-A1"), "réponse du site A1 affichée sous le site A2");
});

test("guardedApi rejette (AbortError) une réponse arrivée après un changement de périmètre", async () => {
  let release;
  const w = freshWindow({ fetchImpl: (url) => (url.includes("/scope")
    ? Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(SCOPE)) })
    : new Promise((resolve) => { release = () => resolve({ ok: true, text: () => Promise.resolve('{"items":["périmé"]}') }); })) });
  await w.SW.loadScope();
  const pending = w.SW.guardedApi("personnel", "/site-workforce/employees");
  await tick();
  w.SW.setScope({ society: "SocB", site_id: "" });
  release();
  await assert.rejects(pending, (err) => err.name === "AbortError");
});

test("navigation rapide : la réponse tardive du tableau de bord n'écrase jamais l'écran suivant", async () => {
  let releaseDashboard;
  const w = shellWindow((url) => {
    if (url.includes("/site-workforce/dashboard")) {
      return new Promise((resolve) => { releaseDashboard = () => resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ site: null, kpi: {}, actions_rapides: { prochains_conges: [] }, by_site: [] })) }); });
    }
    return scopedFetch([], { "/api/site-workforce/employees": () => ({ items: [{ id: 1, code: "E1", first_name: "Visible", last_name: "Personnel" }], total: 1, page: 1, pages: 1 }) })(url);
  });
  w.location.hash = "#/dashboard";
  await w.SiteWorkforceShell.renderShell();
  await tick();
  w.location.hash = "#/personnel";
  w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  await tick(); await tick();
  releaseDashboard();
  await tick(); await tick();
  const text = w.document.querySelector("#view").textContent;
  assert.doesNotMatch(text, /Impossible de charger/, "erreur de l'écran précédent affichée sur Personnel");
  assert.match(text, /Visible/);
});

test("compte historique 1 société / 1 site : sélection automatique, sélecteurs figés, comportement inchangé", async () => {
  const calls = [];
  const w = shellWindow(scopedFetch(calls, { scope: { societies: ["SocB"], sites: [{ id: 3, name: "HAMOUL 01", society: "SocB" }] } }));
  await w.SiteWorkforceShell.renderShell();
  assert.ok(w.document.querySelector("#society-select").disabled && w.document.querySelector("#site-select").disabled);
  assert.match(w.document.querySelector(".shell-role-badge").textContent, /Site : HAMOUL 01/);
  assert.ok(calls.filter((u) => u.includes("/dashboard")).every((u) => u.includes("site_id=3")));
});

test("la cloche agrège tout le périmètre autorisé et affiche société/site de chaque notification", async () => {
  const calls = [];
  const w = shellWindow(scopedFetch(calls, { "/api/site-workforce/notifications": () => [
    { id: 5, notif_type: "reclamation", message: "Nouvelle", status: "nouvelle", society: "SocB", site_name: "B1", site_id: 3 },
  ] }));
  w.localStorage.setItem("sw_scope", JSON.stringify({ society: "SocA", site_id: "1", user: "ce01" }));
  await w.SiteWorkforceShell.renderShell();
  assert.strictEqual(w.SW.state.scope.site_id, "1");
  w.document.querySelector("#notif-btn").click();
  await tick(); await tick();
  const notifCalls = calls.filter((u) => u.includes("/notifications"));
  assert.ok(notifCalls.length && notifCalls.every((u) => !u.includes("site_id") && !u.includes("society=")), notifCalls.join("\n"));
  assert.match(w.document.querySelector("#sw-drawer-scrim").textContent, /SocB · B1/);
});

test("vue agrégée « Tous mes sites » : colonnes Société et Site dans Personnel", async () => {
  const w = shellWindow(scopedFetch([], { "/api/site-workforce/employees": () => ({ items: [
    { id: 1, code: "E1", first_name: "A", last_name: "Un", society: "SocA", site_name: "A1", presence_status: "present" },
  ], total: 1, page: 1, pages: 1 }) }));
  w.location.hash = "#/personnel";
  await w.SiteWorkforceShell.renderShell();
  await tick(); await tick();
  const heads = [...w.document.querySelectorAll("#pers-list th")].map((t) => t.textContent);
  assert.ok(heads.includes("Société") && heads.includes("Site"), heads.join(","));
  assert.match(w.document.querySelector("#pers-list").textContent, /SocA/);
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

test("portail BEO : écran de connexion et badge affichent Bureau des Effectifs Ouest, Chargé des effectifs et le périmètre consulté", async () => {
  const w = shellWindow(scopedFetch([], { scope: { societies: ["SocB"], sites: [{ id: 7, name: "HAMOUL 01", society: "SocB" }] } }));
  w.SiteWorkforceShell.renderLogin();
  assert.match(w.document.querySelector("#login-screen").textContent, /Bureau des Effectifs Ouest/);
  await w.SiteWorkforceShell.renderShell();
  const badge = w.document.querySelector(".shell-role-badge").textContent;
  assert.match(badge, /Chargé des effectifs/);
  assert.match(badge, /Bureau des Effectifs Ouest/);
  assert.match(badge, /Site : HAMOUL 01/);
  assert.match(w.document.querySelector(".shell-header").textContent, /Bureau des Effectifs Ouest/);
});
