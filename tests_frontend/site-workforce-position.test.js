// Fiche de position BEO — tests jsdom sur le VRAI code (api.js, shell.js, views/*.js) : seul
// fetch est simulé. La sécurité champ par champ est serveur (tests/test_site_workforce_position_file.py) ;
// ici on vérifie que l'écran n'affiche QUE ce que l'API renvoie et qu'il ne propose aucune écriture.
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const SW_DIR = path.join(__dirname, "..", "app", "static", "site-workforce");
const API_SRC = fs.readFileSync(path.join(SW_DIR, "api.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(SW_DIR, "shell.js"), "utf8");
const VIEWS_DIR = path.join(SW_DIR, "views");
const VIEW_SRCS = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith(".js")).sort().map((f) => fs.readFileSync(path.join(VIEWS_DIR, f), "utf8"));
const POSITION_SRC = fs.readFileSync(path.join(VIEWS_DIR, "position.js"), "utf8");

const SCOPE = { societies: ["IRON GLOBAL SOLUTION"], sites: [{ id: 1, name: "DHL FORWARDING / HAMOUL 01", society: "IRON GLOBAL SOLUTION" }, { id: 2, name: "SITE B", society: "IRON GLOBAL SOLUTION" }] };

const FULL_DETAIL = {
  employee_id: 7, site_id: 1, read_only: true, allowed_count: 9,
  sections: [
    { key: "identity", label: "Identité", fields: [
      { key: "identity.last_name", label: "Nom", kind: "text", value: "ABDELLAHI" },
      { key: "identity.first_name", label: "Prénom", kind: "text", value: "HABIB CHAWKI ABDELMAJID" },
      { key: "identity.employee_code", label: "Code employé", kind: "text", value: "K01" },
      { key: "identity.status", label: "Statut", kind: "badge", value: "actif" },
    ] },
    { key: "assignment", label: "Position actuelle", fields: [
      { key: "assignment.site", label: "Site", kind: "text", value: "DHL FORWARDING / HAMOUL 01" },
      { key: "assignment.position", label: "Poste (affectation)", kind: "text", value: "CARISTE" },
      { key: "assignment.start_date", label: "Date d'affectation", kind: "date", value: "2026-03-24" },
    ] },
    { key: "contract", label: "Contrat", fields: [
      { key: "contract.status", label: "État du contrat", kind: "badge", value: { label: "En cours", tone: "success" } },
    ] },
    { key: "history", label: "Historique", fields: [
      { key: "history.assignments", label: "Historique des affectations (sites et postes)", kind: "table",
        columns: [{ key: "site", label: "Site" }, { key: "position", label: "Poste" }, { key: "start_date", label: "Du" }, { key: "end_date", label: "Au" }],
        value: [{ site: "DHL FORWARDING / HAMOUL 01", position: "CARISTE", start_date: "2026-03-24", end_date: null }] },
    ] },
  ],
};

const LIST = {
  columns: [
    { key: "identity.last_name", label: "Nom", kind: "text" }, { key: "identity.first_name", label: "Prénom", kind: "text" },
    { key: "identity.employee_code", label: "Code employé", kind: "text" }, { key: "assignment.position", label: "Poste (affectation)", kind: "text" },
    { key: "assignment.site", label: "Site", kind: "text" }, { key: "assignment.start_date", label: "Date d'affectation", kind: "date" },
    { key: "identity.status", label: "Statut", kind: "badge" },
  ],
  items: [{ employee_id: 7, site_id: 1, fields: { "identity.last_name": "ABDELLAHI", "identity.first_name": "HABIB", "identity.employee_code": "K01",
    "assignment.position": "CARISTE", "assignment.site": "DHL FORWARDING / HAMOUL 01", "assignment.start_date": "2026-03-24", "identity.status": "actif" } }],
  total: 1, page: 1, page_size: 20, pages: 1, filters: { search: true, position: true, statuses: ["actif"] },
};

function makeFetch(calls, routes = {}) {
  return (url, opts = {}) => {
    calls.push({ url, method: (opts.method || "GET").toUpperCase(), body: opts.body });
    const u = new URL(url, "http://localhost");
    let body = [];
    if (routes[u.pathname]) body = routes[u.pathname](u, opts);
    else if (u.pathname === "/api/site-workforce/scope") body = SCOPE;
    else if (u.pathname === "/api/site-workforce/dashboard") body = { site: null, kpi: {}, actions_rapides: { prochains_conges: [] }, by_site: [] };
    else if (u.pathname === "/api/site-workforce/employees") body = { items: [{ id: 7, code: "K01", first_name: "HABIB", last_name: "ABDELLAHI", position: "CARISTE", group_code: "A", presence_status: "present" }], total: 1, page: 1, pages: 1 };
    else if (u.pathname === "/api/site-workforce/positions") body = LIST;
    else if (u.pathname === "/api/site-workforce/positions/7") body = FULL_DETAIL;
    if (body && body.__status) return Promise.resolve({ ok: false, status: body.__status, text: () => Promise.resolve(JSON.stringify({ detail: body.detail })) });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)), blob: () => Promise.resolve(new Blob([])) });
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
  w.SW.state.user = { full_name: "CE01", username: "ce01" };
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i += 1) await tick(); }

test("menu : EFFECTIF puis « Fiche de position », routes existantes conservées", async () => {
  const w = shellWindow(makeFetch([]));
  await w.SiteWorkforceShell.renderShell();
  const nav = [...w.document.querySelectorAll("[data-nav]")].map((b) => [b.dataset.nav, b.lastChild.textContent.trim()]);
  assert.deepStrictEqual(nav.map(([k]) => k), ["dashboard", "personnel", "position", "pointage", "couverture", "absences", "justificatifs", "conges", "maladies", "discipline", "reclamations"]);
  assert.strictEqual(nav[1][1], "EFFECTIF");
  assert.strictEqual(nav[2][1], "Fiche de position");
  assert.ok(!nav.some(([, label]) => /Personnel/.test(label)), "libellé « Personnel » encore présent");
});

test("annuaire : fichettes (champs de l'API seulement, lampe serveur), clic → fiche, mode Liste, filtres envoyés au serveur", async () => {
  const calls = [];
  const list = {
    ...LIST,
    columns: [...LIST.columns, { key: "assignment.group", label: "Groupe", kind: "text" }, { key: "contract.end_date", label: "Date de fin", kind: "date" }],
    items: [{ ...LIST.items[0], fields: { ...LIST.items[0].fields, "assignment.group": "B", "contract.end_date": null }, indicator: { level: "orange", label: "Sanction / discipline à signaler" } }],
    filters: { ...LIST.filters, groups: [{ key: "A", count: 3 }, { key: "B", count: 1 }],
      sites: [{ site_id: 1, site_name: "DHL FORWARDING / HAMOUL 01", count: 1 }, { site_id: 2, site_name: "SITE B", count: 3 }] },
  };
  const w = shellWindow(makeFetch(calls, { "/api/site-workforce/positions": () => list }), "#/position");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const doc = w.document;
  assert.strictEqual(doc.querySelector("#view-title").textContent, "Fiches de position");
  assert.match(doc.querySelector("#view-sub").textContent, /Accueil → Lecture seule → Structure : IRON GLOBAL SOLUTION → Tous mes sites \(2\)/);
  // Mosaïque par défaut : une fichette, sans la ligne « Structure » (champ non renvoyé = non autorisé).
  const card = doc.querySelector(".beo-fiche");
  assert.ok(card, "fichette absente");
  assert.match(card.textContent, /ABDELLAHI/);
  assert.match(card.textContent, /K01/);
  const rows = [...card.querySelectorAll(".beo-card-rows dt")].map((dt) => dt.textContent.trim());
  assert.deepStrictEqual(rows, ["Site", "Groupe", "Poste", "Fin de contrat"]);
  assert.match(card.textContent, /Fin de contrat\s*—/, "champ autorisé mais vide : tiret");
  // Une seule lampe allumée, libellée (pas seulement une couleur).
  const lamps = card.querySelector(".beo-lamps");
  assert.strictEqual(lamps.getAttribute("aria-label"), "Indicateur : Sanction / discipline à signaler");
  assert.deepStrictEqual([...lamps.querySelectorAll(".on")].map((l) => l.className.match(/lamp-(\w+)/)[1]), ["orange"]);
  assert.strictEqual(card.querySelector("a.beo-btn-open").getAttribute("href"), "#/position/7");
  card.querySelector(".beo-card-rows").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.strictEqual(w.location.hash, "#/position/7", "fichette entière cliquable");
  w.location.hash = "#/position"; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await settle();
  // Mode Liste : colonnes de l'API (photo exclue), lampe en tête, action « Ouvrir la fiche ».
  doc.querySelector('[data-view="list"]').click();
  const heads = [...doc.querySelectorAll("#pf-list thead th")].map((th) => th.textContent);
  assert.deepStrictEqual(heads, ["Indicateur", "Employé", "Code employé", "Poste (affectation)", "Site", "Date d'affectation", "Statut", "Groupe", "Date de fin", "Action"]);
  assert.strictEqual(doc.querySelector("#pf-list tbody a").getAttribute("href"), "#/position/7");
  doc.querySelector('[data-view="mosaic"]').click();
  // Filtres : recherche, groupe, site → serveur ; puis le sélecteur SITE du bandeau.
  const q = doc.querySelector("#pf-q");
  q.value = "K01"; q.dispatchEvent(new w.Event("input"));
  await new Promise((r) => setTimeout(r, 300)); await settle();
  assert.ok(calls.some((c) => c.url.includes("/positions?") && c.url.includes("q=K01")), calls.map((c) => c.url).join("\n"));
  const group = doc.querySelector("#pf-group");
  assert.deepStrictEqual([...group.options].map((o) => o.textContent), ["Tous les groupes", "Groupe A (3)", "Groupe B (1)"]);
  group.value = "B"; group.dispatchEvent(new w.Event("change")); await settle();
  assert.ok(calls.at(-1).url.includes("group=B") && calls.at(-1).url.includes("q=K01"), "filtres combinés : " + calls.at(-1).url);
  const pfSite = doc.querySelector("#pf-site");
  pfSite.value = "2"; pfSite.dispatchEvent(new w.Event("change")); await settle();
  assert.ok(calls.at(-1).url.includes("site=2") && calls.at(-1).url.includes("group=B"), calls.at(-1).url);
  const site = doc.querySelector("#site-select");
  site.value = "1"; site.dispatchEvent(new w.Event("change"));
  await settle();
  assert.ok(calls.at(-1).url.includes("/positions?") && calls.at(-1).url.includes("site_id=1"), calls.at(-1).url);
});

test("annuaire : indicateur incomplet → aucune lampe allumée (jamais un vert par défaut)", async () => {
  const list = { ...LIST, items: [{ ...LIST.items[0], indicator: { level: "unknown", label: "Indicateur incomplet (champs non autorisés pour ce compte)" } }] };
  const w = shellWindow(makeFetch([], { "/api/site-workforce/positions": () => list }), "#/position");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const lamps = w.document.querySelector(".beo-fiche .beo-lamps");
  assert.strictEqual(lamps.querySelectorAll(".on").length, 0);
  assert.match(lamps.getAttribute("aria-label"), /incomplet/);
});

test("liste : aucune colonne autorisée → message explicite, aucune donnée", async () => {
  const w = shellWindow(makeFetch([], { "/api/site-workforce/positions": () => ({ columns: [], items: [{ employee_id: 7, site_id: 1, fields: {} }], total: 1, page: 1, pages: 1, filters: {} }) }), "#/position");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  assert.match(w.document.querySelector("#view").textContent, /Aucun champ de la fiche de position n'est autorisé/);
  assert.strictEqual(w.document.querySelector("#view table"), null);
});

test("EFFECTIF : chaque employé a « Voir la fiche de position » qui ouvre sa fiche", async () => {
  const w = shellWindow(makeFetch([]), "#/personnel");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const link = w.document.querySelector("#view [data-position-link]");
  assert.ok(link, "bouton absent");
  assert.strictEqual(link.textContent.trim(), "Voir la fiche de position");
  assert.strictEqual(link.getAttribute("href"), "#/position/7");
  w.location.hash = "#/position/7";
  w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  await settle();
  assert.match(w.document.querySelector(".pf-name").textContent, /ABDELLAHI HABIB CHAWKI ABDELMAJID/);
  assert.ok(w.document.querySelector('[data-nav="position"]').classList.contains("active"));
});

test("fiche : sections et champs de l'API, en-tête, historique, lecture seule absolue", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls), "#/position/7");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const view = w.document.querySelector("#view");
  assert.deepStrictEqual([...view.querySelectorAll("[data-pf-section]")].map((s) => s.dataset.pfSection), ["identity", "assignment", "contract", "history"]);
  assert.match(view.querySelector(".pf-head").textContent, /Code K01/);
  assert.match(view.querySelector(".pf-head .badge").textContent, /actif/);
  assert.match(view.querySelector('[data-pf-field="assignment.position"]').textContent, /CARISTE/);
  assert.match(view.querySelector('[data-pf-field="history.assignments"]').textContent, /DHL FORWARDING/);
  // Lecture seule : aucun champ de saisie, aucun bouton d'édition sur la fiche.
  assert.strictEqual(view.querySelectorAll("input, select, textarea, form, [contenteditable]").length, 0);
  const buttons = [...view.querySelectorAll("button")].map((b) => b.textContent.trim());
  assert.deepStrictEqual(buttons, ["Signaler une anomalie"]);
  for (const forbidden of ["Modifier", "Enregistrer", "Affecter", "Muter", "Supprimer", "Suspendre", "Créer contrat"]) {
    assert.ok(!view.textContent.includes(forbidden), `action interdite affichée : ${forbidden}`);
  }
  assert.ok(calls.every((c) => c.method === "GET"), "la consultation a émis une écriture");
});

test("fiche : un champ ou une section absents de l'API ne sont jamais affichés", async () => {
  const partial = { ...FULL_DETAIL, sections: [FULL_DETAIL.sections[1]] };
  const w = shellWindow(makeFetch([], { "/api/site-workforce/positions/7": () => partial }), "#/position/7");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  const view = w.document.querySelector("#view");
  assert.deepStrictEqual([...view.querySelectorAll("[data-pf-section]")].map((s) => s.dataset.pfSection), ["assignment"]);
  assert.ok(!view.textContent.includes("Identité") && !view.textContent.includes("Contrat") && !view.textContent.includes("K01"));
  assert.match(view.querySelector(".pf-name").textContent, /Employé #7/);
});

test("fiche : aucun champ autorisé → message explicite ; employé hors périmètre → erreur serveur affichée", async () => {
  let w = shellWindow(makeFetch([], { "/api/site-workforce/positions/7": () => ({ ...FULL_DETAIL, sections: [] }) }), "#/position/7");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  assert.match(w.document.querySelector("#view").textContent, /Aucun champ de la fiche de position n'est autorisé/);
  w = shellWindow(makeFetch([], { "/api/site-workforce/positions/9": () => ({ __status: 403, detail: "Employé hors du périmètre de ce compte" }) }), "#/position/9");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  assert.match(w.document.querySelector("#view").textContent, /hors du périmètre/);
});

test("Signaler une anomalie : réclamation puis transmission au destinataire, sans aucune écriture sur la fiche", async () => {
  const calls = [];
  const w = shellWindow(makeFetch(calls, {
    "/api/site-workforce/reclamations": () => ({ id: 41, status: "nouvelle", site_id: 1 }),
    "/api/site-workforce/transmissions": () => ({ id: 5, status: "envoyee", site_id: 1 }),
  }), "#/position/7");
  await w.SiteWorkforceShell.renderShell();
  await settle();
  w.document.querySelector("#pf-report").click();
  const form = w.document.querySelector("#pf-report-form");
  form.querySelector("[name=nature]").value = "site";
  form.querySelector("[name=nature]").dispatchEvent(new w.Event("change"));
  assert.strictEqual(form.querySelector("[name=destinataire]").value, "ops");
  form.querySelector("[name=description]").value = "Affecté à SITE B depuis lundi";
  form.dispatchEvent(new w.Event("submit", { cancelable: true }));
  await settle();
  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepStrictEqual(writes.map((c) => new URL(c.url, "http://x").pathname), ["/api/site-workforce/reclamations", "/api/site-workforce/transmissions"]);
  const rec = JSON.parse(writes[0].body);
  assert.deepStrictEqual([rec.employee_id, rec.site_id, rec.category], [7, 1, "fiche_position"]);
  const tr = JSON.parse(writes[1].body);
  assert.deepStrictEqual([tr.resource_type, tr.resource_id, tr.destinataire], ["reclamation", 41, "ops"]);
  assert.match(w.document.querySelector("#pf-report-msg").textContent, /Signalement transmis \(OPS\)/);
});

test("position.js ne lit jamais une liste de champs codée en dur : tout vient de la réponse", () => {
  for (const key of ["identity.phone", "contract.salary", "contract.bank", "identity.nin", "history.sanctions"]) {
    assert.ok(!POSITION_SRC.includes(key), `champ codé en dur dans la vue : ${key}`);
  }
  assert.ok(!/\/api\/drh/.test(POSITION_SRC), "la vue BEO n'appelle jamais un endpoint DRH");
});
