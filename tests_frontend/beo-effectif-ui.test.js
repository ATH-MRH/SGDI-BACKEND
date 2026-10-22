// Refonte BEO v2 (maquettes DG) — jsdom sur le VRAI code (api.js, shell.js, views/*.js) : seul
// fetch est simulé. Vérifie la navigation (EFFECTIF, STRUCTURE, barre et sidebar fixes), les
// compteurs cliquables du tableau de bord et les contrôles d'EFFECTIF (filtres combinables, tri,
// modes, réinitialisation). Les règles de statut et la sécurité sont serveur
// (tests/test_site_workforce_effectif_v2.py) : ici, l'écran envoie les bons paramètres et n'affiche
// que ce que l'API renvoie.
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const SW_DIR = path.join(__dirname, "..", "app", "static", "site-workforce");
const API_SRC = fs.readFileSync(path.join(SW_DIR, "api.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(SW_DIR, "shell.js"), "utf8");
const CSS = fs.readFileSync(path.join(SW_DIR, "app.css"), "utf8");
const VIEWS_DIR = path.join(SW_DIR, "views");
const VIEW_SRCS = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith(".js")).sort().map((f) => fs.readFileSync(path.join(VIEWS_DIR, f), "utf8"));

const SCOPE = { societies: ["SocA", "SocB"], sites: [
  { id: 1, name: "HAMOUL 01", society: "SocA" }, { id: 2, name: "HAMOUL 02", society: "SocB" }, { id: 3, name: "TILLET", society: "SocB" },
  { id: 4, name: "ORAN", society: "SocA" }, { id: 5, name: "ARZEW", society: "SocA" },
] };
const DASHBOARD = {
  site: null, kpi: { effectif_total: 142, presents_aujourdhui: 90, absents: 4, retards: 2, en_conge: 3, en_maladie: 1, pointages_incomplets: 44,
    justificatifs_a_verifier: 5, reclamations_ouvertes: 1, incidents_a_transmettre: 2 },
  actions_rapides: { absences_a_traiter: 4, justificatifs_en_attente: 5, prochains_conges: [{}, {}], incidents_discipline: 2 },
  by_site: [{ site_id: 1, site_name: "HAMOUL 01", society: "SocA", effectif: 94, presents: 60, absents: 2, non_pointes: 32, anomalies: 1 },
    { site_id: 2, site_name: "HAMOUL 02", society: "SocB", effectif: 11, presents: 9, absents: 1, non_pointes: 1, anomalies: 0 }],
};
const EMPLOYEES = {
  items: [
    { id: 7, code: "K01", first_name: "HABIB", last_name: "ABDELLAHI", position: "CARISTE", group_code: "A", site_id: 1, site_name: "HAMOUL 01", society: "SocA", status: "actif", status_label: "Actif" },
    { id: 8, code: "A04", first_name: "ADEL", last_name: "ADJROUD", position: "APS", group_code: "B", site_id: 2, site_name: "HAMOUL 02", society: "SocB", status: "blacklist", status_label: "Blacklist" },
  ],
  total: 2, page: 1, pages: 1, page_size: 24,
  facets: {
    groups: [{ key: "A", count: 58 }, { key: "B", count: 28 }, { key: "C", count: 42 }, { key: "D", count: 14 }],
    sites: [{ site_id: 1, site_name: "HAMOUL 01", society: "SocA", count: 94 }, { site_id: 2, site_name: "HAMOUL 02", society: "SocB", count: 11 },
      { site_id: 3, site_name: "TILLET", society: "SocB", count: 10 }, { site_id: 4, site_name: "ORAN", society: "SocA", count: 20 }, { site_id: 5, site_name: "ARZEW", society: "SocA", count: 7 }],
    statuses: [{ key: "blacklist", label: "Blacklist", count: 2 }, { key: "suspendu", label: "Suspendu", count: 8 }, { key: "conge", label: "Congé", count: 0 },
      { key: "non_pointe", label: "Non pointé", count: 12 }, { key: "actif", label: "Actif", count: 120 }],
  },
  capabilities: { lifecycle_status: true, sorts: ["name", "name_desc", "code", "structure", "site", "group", "position", "status", "contract_end"] },
};

function makeFetch(calls, routes = {}) {
  return (url, opts = {}) => {
    calls.push(url);
    const u = new URL(url, "http://localhost");
    let body = [];
    if (routes[u.pathname]) body = routes[u.pathname](u);
    else if (u.pathname === "/api/site-workforce/scope") body = SCOPE;
    else if (u.pathname === "/api/site-workforce/dashboard") body = DASHBOARD;
    else if (u.pathname === "/api/site-workforce/employees") body = EMPLOYEES;
    else if (u.pathname === "/api/site-workforce/positions") body = { columns: [], items: [], total: 0, page: 1, pages: 1, filters: {} };
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}
function shellWindow(fetchImpl, hash) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/site-workforce" + (hash || ""), runScripts: "outside-only" });
  const w = dom.window;
  w.localStorage.setItem("sw_token", "test-token");
  w.fetch = fetchImpl;
  w.eval(API_SRC);
  VIEW_SRCS.forEach((src) => w.eval(src));
  w.eval(SHELL_SRC.replace(/if \(state\.token\) \{[\s\S]*?\n  \}\n/, ""));
  w.SW.state.user = { full_name: "AYOUB", username: "ayoub" };
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 8; i += 1) await tick(); }
const lastEmployeesCall = (calls) => new URL(calls.filter((c) => c.includes("/site-workforce/employees")).at(-1), "http://localhost").searchParams;

test("navigation : sidebar et barre bleues fixes, EFFECTIF au lieu de Personnel, STRUCTURE au lieu de Société, sans capsule", async () => {
  const w = shellWindow(makeFetch([]));
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const doc = w.document;
  const labels = [...doc.querySelectorAll("[data-nav] .nav-link-label")].map((l) => l.textContent);
  assert.deepStrictEqual(labels, ["Tableau de bord", "EFFECTIF", "Fiche de position", "Pointage", "Absences", "Justificatifs", "Congés", "Maladies", "Discipline", "Réclamations"]);
  assert.ok(doc.querySelectorAll("[data-nav] svg.beo-ic").length === 10, "icône par entrée");
  assert.doesNotMatch(doc.querySelector("#root").textContent, /Personnel|Toutes mes sociétés|Société/);
  assert.strictEqual(doc.querySelector(".scope-chip"), null);
  assert.strictEqual(doc.querySelector('[data-nav="dashboard"]').getAttribute("aria-current"), "page");
  // Barre : date, notifications, utilisateur, déconnexion ; bandeau : STRUCTURE et SITE.
  const top = doc.querySelector(".beo-topbar");
  ["#notif-btn", ".user-chip", "#logout-btn", ".beo-top-date"].forEach((sel) => assert.ok(top.querySelector(sel), sel));
  assert.ok(doc.querySelector(".beo-pagebar #society-select") && doc.querySelector(".beo-pagebar #site-select"));
  // Fixes au défilement (règles du portail, hors design system partagé).
  assert.match(CSS, /\.shell-sidebar\{[^}]*position:sticky;top:0;height:100vh/);
  assert.match(CSS, /#root \.beo-app \.beo-topbar\{top:0;border:0;border-radius:0;position:sticky\}/);
  assert.match(CSS, /\.beo-pagebar\{position:sticky;top:var\(--beo-topbar-h\)/);
  // Alias #/effectif -> EFFECTIF.
  w.location.hash = "#/effectif"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await settle();
  assert.strictEqual(doc.querySelector("#view-title").textContent, "EFFECTIF");
  assert.match(doc.querySelector("#view-sub").textContent, /^Annuaire — lecture seule · Toutes mes structures — Tous mes sites \(5\)$/);
});

test("tableau de bord : 10 compteurs-boutons ; chaque clic ouvre l'écran filtré correspondant", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls), "#/dashboard");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const doc = w.document;
  assert.strictEqual(doc.querySelector("#view-title").textContent, "Tableau de bord");
  assert.match(doc.querySelector("#view-sub").textContent, /^Vue d'ensemble de la gestion des effectifs — Toutes mes structures/);
  assert.match(doc.querySelector(".beo-hello-title").textContent, /Bonjour AYOUB/);
  const kpis = [...doc.querySelectorAll(".beo-kpi")];
  assert.strictEqual(kpis.length, 10);
  assert.ok(kpis.every((k) => k.tagName === "BUTTON" && k.querySelector("svg") && k.getAttribute("aria-label")));
  assert.strictEqual(doc.querySelector('[data-kpi="effectif_total"] .beo-kpi-value').textContent, "142");
  const expected = {
    effectif_total: "#/personnel", presents_aujourdhui: "#/personnel?presence=present", absents: "#/personnel?presence=absent",
    retards: "#/pointage", en_conge: "#/personnel?status=conge", en_maladie: "#/personnel?status=maladie",
    pointages_incomplets: "#/personnel?presence=non_pointe", justificatifs_a_verifier: "#/justificatifs",
    reclamations_ouvertes: "#/reclamations", incidents_a_transmettre: "#/discipline",
  };
  for (const [key, hash] of Object.entries(expected)) assert.strictEqual("#/" + doc.querySelector(`[data-kpi="${key}"]`).dataset.to, hash, key);
  assert.strictEqual(doc.querySelectorAll(".beo-quick").length, 4);
  // Clic « Absents » : EFFECTIF filtré présence=absent côté serveur, pastille retirable.
  doc.querySelector('[data-kpi="absents"]').click();
  w.dispatchEvent(new w.HashChangeEvent("hashchange")); await settle();
  assert.strictEqual(lastEmployeesCall(calls).get("presence"), "absent");
  const pill = doc.querySelector('#pers-active [data-clear="presence"]');
  assert.match(pill.textContent, /Absents aujourd'hui/);
  pill.click(); await settle();
  assert.strictEqual(lastEmployeesCall(calls).get("presence"), null);
});

test("répartition par site : une ligne (souris ou clavier) ouvre EFFECTIF filtré sur ce site, périmètre inchangé", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls), "#/dashboard");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const row = w.document.querySelector('[data-site-row="2"]');
  assert.deepStrictEqual([...w.document.querySelectorAll("#dash-sites th")].map((t) => t.textContent), ["Site", "Structure", "Effectif", "Présents", "Absents", "Non pointés", "Anomalies"]);
  row.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
  assert.strictEqual(w.location.hash, "#/personnel?site=2");
  w.dispatchEvent(new w.HashChangeEvent("hashchange")); await settle();
  const params = lastEmployeesCall(calls);
  assert.strictEqual(params.get("site"), "2");
  assert.strictEqual(params.get("site_id"), null, "le bandeau garde « Tous mes sites »");
});

test("EFFECTIF : compteurs Groupe / Site / Statut, filtres combinables, tri, modes, réinitialisation", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls), "#/personnel");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const doc = w.document;
  const chip = (fam, key) => doc.querySelector(`[data-family="${fam}"][data-key="${key}"]`);
  assert.strictEqual(doc.querySelector("#pers-count").textContent, "2 employés");
  assert.match(chip("group", "A").textContent, /A\s*58/);
  assert.strictEqual(chip("group", "").textContent.trim(), "Tous les groupes");
  // Sites : les 3 premiers (ordre serveur, effectif décroissant) en raccourci, le reste dans « Autres sites ».
  assert.deepStrictEqual([...doc.querySelectorAll('[data-family="site"]')].map((b) => b.dataset.key), ["", "1", "2", "3"]);
  assert.deepStrictEqual([...doc.querySelectorAll("#pers-site-more option")].map((o) => o.textContent), ["Autres sites · 27", "ORAN (20)", "ARZEW (7)"]);
  // Statut : compteurs non nuls seulement (+ Tous) ; pastille de couleur ET libellé.
  assert.deepStrictEqual([...doc.querySelectorAll('[data-family="status"]')].map((b) => b.dataset.key), ["", "blacklist", "suspendu", "non_pointe", "actif"]);
  chip("group", "A").click(); await settle();
  chip("status", "blacklist").click(); await settle();
  const more = doc.querySelector("#pers-site-more");
  more.value = "4"; more.dispatchEvent(new w.Event("change")); await settle();
  let p = lastEmployeesCall(calls);
  assert.deepStrictEqual([p.get("group"), p.get("status"), p.get("site")], ["A", "blacklist", "4"]);
  assert.strictEqual(chip("group", "A").getAttribute("aria-pressed"), "true");
  // Recherche (debounce) + tri : combinés aux filtres.
  const q = doc.querySelector("#pers-q");
  q.value = "ABD"; q.dispatchEvent(new w.Event("input"));
  await new Promise((r) => setTimeout(r, 300)); await settle();
  const sort = doc.querySelector("#pers-sort");
  assert.ok(![...sort.options].some((o) => o.value === "recruit_date"), "tri non autorisé par le serveur : absent");
  sort.value = "code"; sort.dispatchEvent(new w.Event("change")); await settle();
  p = lastEmployeesCall(calls);
  assert.deepStrictEqual([p.get("q"), p.get("sort"), p.get("group"), p.get("status"), p.get("site")], ["ABD", "code", "A", "blacklist", "4"]);
  // Second clic sur un raccourci actif : filtre retiré.
  chip("group", "A").click(); await settle();
  assert.strictEqual(lastEmployeesCall(calls).get("group"), null);
  // Changer de mode ne perd ni ne relance les filtres.
  const before = calls.length;
  doc.querySelector('[data-view="mosaic"]').click();
  assert.strictEqual(calls.length, before, "aucune requête : simple changement d'affichage");
  assert.strictEqual(doc.querySelectorAll(".beo-card").length, 2);
  assert.strictEqual(doc.querySelector("#pers-q").value, "ABD");
  doc.querySelector('[data-view="list"]').click();
  // Regroupement « Par site » : tri serveur par site et en-têtes de section.
  doc.querySelector('[data-grouping="site"]').click(); await settle();
  assert.strictEqual(lastEmployeesCall(calls).get("sort"), "site");
  assert.deepStrictEqual([...doc.querySelectorAll(".beo-group-row")].map((r) => r.textContent.trim()), ["HAMOUL 01 — SocA", "HAMOUL 02 — SocB"]);
  // Réinitialiser : tout est retiré.
  const reset = doc.querySelector("#pers-reset");
  assert.strictEqual(reset.hidden, false);
  reset.click(); await settle();
  p = lastEmployeesCall(calls);
  assert.deepStrictEqual([p.get("q"), p.get("status"), p.get("site"), p.get("group"), p.get("sort")], [null, null, null, null, "name"]);
  assert.strictEqual(doc.querySelector("#pers-reset").hidden, true);
});

test("EFFECTIF : colonnes, statut métier coloré, bouton bleu « Voir la fiche de position »", async () => {
  const w = shellWindow(makeFetch([]), "#/personnel");
  w.localStorage.setItem("sw_pref_effectif_view", "list");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const doc = w.document;
  assert.deepStrictEqual([...doc.querySelectorAll("#pers-list thead th")].map((t) => t.textContent), ["Code", "Nom", "Structure", "Site", "Poste", "Groupe", "Statut", "Action"]);
  const statuses = [...doc.querySelectorAll("#pers-list .beo-status")].map((b) => [b.textContent, b.className]);
  assert.deepStrictEqual(statuses.map(([t]) => t), ["Actif", "Blacklist"]);
  assert.match(statuses[0][1], /tone-success/);
  assert.match(statuses[1][1], /tone-danger/);
  const link = doc.querySelector("#pers-list [data-position-link]");
  assert.ok(link.classList.contains("beo-btn-fiche"));
  assert.strictEqual(link.getAttribute("href"), "#/position/7");
  assert.match(CSS, /\.beo-btn-fiche\{[^}]*background:linear-gradient\(180deg,#2c6ee6,var\(--beo-blue\)\)/);
});

test("EFFECTIF : un filtre devenu invalide (403) est retiré au lieu de bloquer l'écran", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls, { "/api/site-workforce/employees": (u) => (u.searchParams.get("site") === "9" ? { __forbid: true } : EMPLOYEES) }), "#/personnel?site=9");
  const base = w.fetch;
  w.fetch = (url, opts) => (url.includes("site=9")
    ? Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve(JSON.stringify({ detail: "Site hors du périmètre consulté" })) })
    : base(url, opts));
  await w.SiteWorkforceShell.renderShell();
  await settle();
  assert.strictEqual(lastEmployeesCall(calls).get("site"), null);
  assert.strictEqual(w.document.querySelector("#pers-count").textContent, "2 employés");
});
