const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const MODULE_SRC = fs.readFileSync(path.join(ROOT, "app/static/js/modules/brq.js"), "utf8");
const REGISTRY_SRC = fs.readFileSync(path.join(ROOT, "app/static/js/core/module-registry.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(ROOT, "app/static/sgdi-app.js"), "utf8");
const SHELL_CSS = fs.readFileSync(path.join(ROOT, "app/static/sgdi-app.css"), "utf8");

function setupDom(request, session) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="view"></div></body></html>', {
    runScripts: "outside-only",
    url: "https://brq.irongs.com/#/brq",
  });
  dom.window.SGDI_API = { request };
  dom.window.today = () => "2026-10-01";
  dom.window.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  if (session) dom.window.session = session;
  dom.window.eval(REGISTRY_SRC);
  dom.window.eval(MODULE_SRC);
  return dom;
}

test("BRQ is registered as one lazy module rooted at brq", () => {
  const dom = setupDom(async () => ({}));
  assert.deepEqual(Array.from(dom.window.SGDIModules.getModule("brq").routes), ["brq"]);
  assert.equal(dom.window.SGDIModules.moduleKeyForRoute("brq"), "brq");
  dom.window.close();
});

test("BRQ renders the read-only report from its scoped API endpoint", async () => {
  const calls = [];
  const dom = setupDom(async (url, options) => {
    calls.push([url, options]);
    return {
      date: "2026-10-01",
      total: 1,
      kpis: { effectif_prevu: 1, presents: 1, absents: 0, abandons_poste: 0, sortants: 0, effectif_disponible: 1, couverture_pct: 100, ecart: 0 },
      filters: {},
      notes: [],
      items: [{ matricule: "BRQ-1", nom: "Test Employé", society: "Société A", site: "Site A", state: "present", expected: true, available: true, planning: { start_time: "14:00", end_time: "22:00" } }],
    };
  });
  const target = dom.window.document.getElementById("view");
  await dom.window.renderBrqPage(target, "situation");

  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^\/api\/brq\/situation\?date=2026-10-01$/);
  assert.equal(calls[0][1].method, "GET");
  assert.match(target.textContent, /Effectif prévu/);
  assert.match(target.textContent, /Disponible/);
  assert.match(target.textContent, /Test Employé/);
  assert.doesNotMatch(target.innerHTML, /export|csv/i);
  assert.match(target.innerHTML, /Présence historique|Disponibilité|Disponible/);
  dom.window.close();
});

test("BRQ dashboard renders site/function, absence, abandon, and exit sections", async () => {
  const dom = setupDom(async () => ({
    date: "2026-10-01",
    total: 0,
    kpis: { effectif_prevu: 0, presents: 0, absents: 0, abandons_poste: 0, sortants: 0, effectif_disponible: 0, couverture_pct: null, ecart: 0 },
    filters: {},
    items: [],
    site_function: [],
    absence_items: [],
    abandon_items: [],
    sortant_items: [],
  }));
  const target = dom.window.document.getElementById("view");
  await dom.window.renderBrqPage(target, "situation");

  for (const label of ["Répartition par site et fonction", "Absences / Abandons", "Sortants"]) {
    assert.ok(target.textContent.includes(label));
  }
  for (const label of ["Client", "Site", "Fonction", "Vacation"]) {
    assert.ok(target.textContent.includes(label));
  }
  assert.equal((target.textContent.match(/Aucune donnée pour ces filtres\./g) || []).length, 2);
  dom.window.close();
});

test("BRQ keeps one shell and its filters visible while results are loading", async () => {
  let resolveRequest;
  const dom = setupDom(() => new Promise(resolve => { resolveRequest = resolve; }));
  const target = dom.window.document.getElementById("view");
  const rendering = dom.window.renderBrqPage(target, "presences");

  assert.equal(target.querySelectorAll(".brq-page").length, 1);
  assert.equal(target.querySelectorAll("h1").length, 1);
  assert.equal(target.querySelectorAll(".brq-tabs").length, 1);
  assert.equal(target.querySelectorAll(".brq-filters").length, 1);
  assert.equal(target.querySelectorAll("[data-brq-results]").length, 1);
  assert.match(dom.window.document.getElementById("brq-module-styles").textContent, /\.brq-results\{min-height:320px/);
  assert.equal(target.querySelector('[data-brq-results]').getAttribute("aria-busy"), "true");
  assert.match(target.querySelector("h1").textContent, /Présences/);
  assert.match(target.querySelector(".brq-tabs").textContent, /Absences/);
  assert.match(target.querySelector(".brq-filters").textContent, /Date/);
  assert.match(target.querySelector("[role=status]").textContent, /Chargement/);

  resolveRequest({ items: [], total: 0, date: "2026-10-01" });
  await rendering;
  assert.equal(target.querySelectorAll(".brq-page").length, 1);
  assert.equal(target.querySelectorAll(".brq-filters").length, 1);
  assert.equal(target.querySelector('[data-brq-results]').getAttribute("aria-busy"), "false");
  assert.match(target.querySelector("[data-brq-results]").textContent, /Aucune donnée pour ces filtres/);
  dom.window.close();
});

test("BRQ API errors stay inside the stable results area", async () => {
  const dom = setupDom(async () => { throw new Error("Service indisponible"); });
  const target = dom.window.document.getElementById("view");
  await dom.window.renderBrqPage(target, "absences");

  assert.equal(target.querySelectorAll(".brq-page").length, 1);
  assert.equal(target.querySelectorAll("h1").length, 1);
  assert.equal(target.querySelectorAll(".brq-filters").length, 1);
  assert.equal(target.querySelectorAll("[data-brq-results]").length, 1);
  assert.match(target.querySelector('[role="alert"]').textContent, /Service indisponible/);
  assert.equal(target.querySelector('[data-brq-results]').getAttribute("aria-busy"), "false");
  dom.window.close();
});

test("rapid BRQ navigation ignores an obsolete API response without duplicating the shell", async () => {
  const pending = new Map();
  const dom = setupDom(url => new Promise(resolve => pending.set(url, resolve)));
  const target = dom.window.document.getElementById("view");
  const oldRender = dom.window.renderBrqPage(target, "presences");
  const currentRender = dom.window.renderBrqPage(target, "absences");
  const oldUrl = [...pending.keys()].find(url => url.includes("/presences"));
  const currentUrl = [...pending.keys()].find(url => url.includes("/absences"));

  pending.get(currentUrl)({ items: [{ nom: "Résultat courant", state: "absent" }], total: 1, date: "2026-10-01" });
  await currentRender;
  pending.get(oldUrl)({ items: [{ nom: "Résultat obsolète", state: "present" }], total: 1, date: "2026-10-01" });
  await oldRender;

  assert.match(target.querySelector("h1").textContent, /Absences/);
  assert.equal(target.querySelectorAll(".brq-page").length, 1);
  assert.equal(target.querySelectorAll(".brq-filters").length, 1);
  assert.equal(target.querySelectorAll("[data-brq-results]").length, 1);
  assert.match(target.querySelector("[data-brq-results]").textContent, /Résultat courant/);
  assert.doesNotMatch(target.querySelector("[data-brq-results]").textContent, /Résultat obsolète/);
  dom.window.close();
});

test("BRQ submits date and scope filters to the API", async () => {
  const calls = [];
  const dom = setupDom(async url => {
    calls.push(url);
    return { items: [], total: 0, date: "2026-10-02" };
  });
  const target = dom.window.document.getElementById("view");
  dom.window.renderView = () => dom.window.renderBrqPage(target, "presences");
  const form = dom.window.document.createElement("form");
  form.innerHTML = '<input name="date" value="2026-10-02"><input name="society" value="Société A"><input name="wilaya" value="Oran"><input name="client" value="Client A"><input name="site" value="Site A"><input name="fonction" value="Agent"><input name="vacation" value="14:00"><input name="site_id" value="">';
  dom.window.brqApplyFilters(form);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/brq\/presences\?/);
  const query = new URLSearchParams(calls[0].split("?")[1]);
  assert.equal(query.get("date"), "2026-10-02");
  assert.equal(query.get("society"), "Société A");
  assert.equal(query.get("wilaya"), "Oran");
  assert.equal(query.get("client"), "Client A");
  assert.equal(query.get("site"), "Site A");
  assert.equal(query.get("fonction"), "Agent");
  assert.equal(query.get("vacation"), "14:00");
  dom.window.close();
});

test("BRQ defaults the society filter to the active ERP society", async () => {
  const calls = [];
  const dom = setupDom(async url => {
    calls.push(url);
    return { items: [], total: 0, date: "2026-10-02" };
  }, { societe: "IRON GLOBAL SÉCURITÉ" });
  dom.window.SGDIModules.getModule("brq").init();
  const target = dom.window.document.getElementById("view");
  await dom.window.renderBrqPage(target, "situation");

  assert.ok(calls[0].includes("society=IRON+GLOBAL+S%C3%89CURIT%C3%89"));
  assert.equal(target.querySelector('[name="society"]').value, "IRON GLOBAL SÉCURITÉ");
  dom.window.close();
});

test("dedicated BRQ host, navigation, and route are wired into the ERP shell", () => {
  assert.match(SHELL_SRC, /brq:\s*\{\s*key:"brq"/);
  assert.match(SHELL_SRC, /case"brq":if\(typeof renderBrqPage==="function"\)/);
  assert.match(SHELL_SRC, /route:"brq\/abandons-poste"/);
  assert.match(SHELL_SRC, /\{key:"brq",label:"Rapports quotidiens \(BRQ\)",host:"brq\.irongs\.com"\}/);
  assert.match(SHELL_SRC, /sgdi-login-page-\$\{escapeHTML\(hostCfg\.key\)\}/);
  assert.match(SHELL_SRC, /brq:\["BRQ · BULLETIN DE RENSEIGNEMENT QUOTIDIEN"/);
  assert.match(SHELL_SRC, /hostCfg\?\.key==="brq"\?"BRQ – Bulletin de Renseignement Quotidien"/);
  assert.match(SHELL_SRC, /iron-securite-logo\.png/);
  assert.match(SHELL_SRC, /if\(\["agenda","global","brq"\]\.includes/);
  assert.match(SHELL_SRC, /if\(opt\.render!==false&&document\.getElementById\("view"\)&&typeof renderView==="function"\)renderView\(\)/);
  assert.match(SHELL_CSS, /\.sgdi-login-page-brq/);
  assert.match(SHELL_CSS, /\.sgdi-login-page-brq \.sgdi-login-brand img/);
  assert.match(SHELL_CSS, /\.sgdi-login-page-brq \.login-admin-system-shortcut\{display:none!important\}/);
  assert.match(SHELL_CSS, /body:has\(\.brq-page\) button\[aria-label="Ouvrir l'assistant ATLAS"\],[\s\S]*body:has\(\.module-host-brq\) button\[aria-label="Ouvrir l'assistant ATLAS"\]\{display:none!important\}/);
  assert.match(SHELL_SRC, /sgdiPullState\(\{render:false,silent:true,force:true,deferSql:true,deferSecondary:true\}\)/);
  assert.match(MODULE_SRC, /function brqNavHTML\(active\)[\s\S]*?href="#\/brq[\s\S]*?aria-current="page"/);
  assert.doesNotMatch(MODULE_SRC.match(/function brqNavHTML\(active\)[\s\S]*?\n\}/)?.[0] || "", /onclick=/);
  assert.match(SHELL_SRC, /window\.addEventListener\("hashchange",\(\)=>\{[\s\S]*?render\(\);[\s\S]*?\}\);/);
});

test("BRQ login reuses the shared ERP login endpoint and token", () => {
  assert.match(SHELL_SRC, /const SGDI_API_TOKEN_KEY\s*=\s*"sgdi_api_token_v1"/);
  assert.match(SHELL_SRC, /login:async\(username,password\)=>\{\s*const r=await sgdiApi\("\/auth\/login",\{method:"POST",body:\{username,password\},legacy:false\}\)/);
  assert.match(SHELL_SRC, /sessionStorage\.setItem\(SGDI_API_TOKEN_KEY,token\)/);
  assert.match(SHELL_SRC, /async function login\(u,p,opt=\{\}\)\{\s*u=String\(u\|\|""\)\.trim\(\);[\s\S]*window\.SGDI_API\.auth\.login\(u,p\)/);
  assert.doesNotMatch(SHELL_SRC, /brq[^;\n]{0,100}(?:new\s+JWT|password_hash|second.?auth)/i);
});
