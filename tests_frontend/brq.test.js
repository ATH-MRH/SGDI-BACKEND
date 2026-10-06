const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const MODULE_SRC = fs.readFileSync(path.join(ROOT, "app/static/js/modules/brq.js"), "utf8");
const REGISTRY_SRC = fs.readFileSync(path.join(ROOT, "app/static/js/core/module-registry.js"), "utf8");
const SHELL_SRC = fs.readFileSync(path.join(ROOT, "app/static/sgdi-app.js"), "utf8");

function setupDom(request) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="view"></div></body></html>', {
    runScripts: "outside-only",
    url: "https://brq.irongs.com/#/brq",
  });
  dom.window.SGDI_API = { request };
  dom.window.today = () => "2026-10-01";
  dom.window.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
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
      kpis: { effectif_prevu: 1, presents: 1, absents: 0, abandons_poste: 0, sortants: 0, couverture_pct: 100, ecart: 0 },
      filters: {},
      notes: [],
      items: [{ matricule: "BRQ-1", nom: "Test Employé", society: "Société A", site: "Site A", state: "present", expected: true, planning: { start_time: "14:00", end_time: "22:00" } }],
    };
  });
  const target = dom.window.document.getElementById("view");
  await dom.window.renderBrqPage(target, "situation");

  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^\/api\/brq\/situation\?date=2026-10-01$/);
  assert.equal(calls[0][1].method, "GET");
  assert.match(target.textContent, /Effectif prévu/);
  assert.match(target.textContent, /Test Employé/);
  assert.match(target.innerHTML, /Exporter CSV/);
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
  form.innerHTML = '<input name="date" value="2026-10-02"><input name="society" value="Société A"><input name="wilaya" value="Oran"><input name="site_id" value="12">';
  dom.window.brqApplyFilters(form);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/brq\/presences\?/);
  const query = new URLSearchParams(calls[0].split("?")[1]);
  assert.equal(query.get("date"), "2026-10-02");
  assert.equal(query.get("society"), "Société A");
  assert.equal(query.get("wilaya"), "Oran");
  assert.equal(query.get("site_id"), "12");
  dom.window.close();
});

test("dedicated BRQ host, navigation, and route are wired into the ERP shell", () => {
  assert.match(SHELL_SRC, /brq:\s*\{\s*key:"brq"/);
  assert.match(SHELL_SRC, /case"brq":if\(typeof renderBrqPage==="function"\)/);
  assert.match(SHELL_SRC, /route:"brq\/abandons-poste"/);
  assert.match(SHELL_SRC, /\{key:"brq",label:"Rapports quotidiens \(BRQ\)",host:"brq\.irongs\.com"\}/);
});
