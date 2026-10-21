// Administration système › Bureau des Effectifs Ouest › « Champs accessibles » : VRAI code de
// app/static/js/modules/administration-beo.js. Seuls l'hôte (openModal, toast, sgdiApi…) et le
// réseau sont simulés ; la validation et le filtrage restent serveur
// (tests/test_site_workforce_position_file.py).
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "static", "js", "modules", "administration-beo.js"), "utf8");

const CATALOG = {
  module_key: "site_workforce", resource_key: "position_file", total: 7,
  standard_profile: ["assignment.site", "contract.end_date", "identity.first_name", "identity.last_name"],
  sections: [
    { key: "identity", label: "Identité", order: 0, fields: [
      { key: "identity.last_name", label: "Nom", sensitive: false, default: true },
      { key: "identity.first_name", label: "Prénom", sensitive: false, default: true },
      { key: "identity.phone", label: "Téléphone personnel", sensitive: true, default: false },
    ] },
    { key: "assignment", label: "Position actuelle", order: 1, fields: [{ key: "assignment.site", label: "Site", sensitive: false, default: true }] },
    { key: "contract", label: "Contrat", order: 2, fields: [
      { key: "contract.type", label: "Type de contrat", sensitive: false, default: false },
      { key: "contract.end_date", label: "Date de fin", sensitive: false, default: true },
      { key: "contract.salary", label: "Salaire net", sensitive: true, default: false },
    ] },
  ],
};

function adminWindow({ saved = ["identity.last_name"], putImpl, confirmAnswer = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="view"></div><div id="modal-host"></div></body></html>', { url: "https://atlas.irongs.com/", runScripts: "dangerously" });
  const w = dom.window;
  const state = { saved: [...saved], calls: [], toasts: [], confirms: [] };
  w.eval(`
    var db = { users: [{ username: "CE01", nom: "Chargé 01", backendId: 41, role: "charge_effectifs_site", actif: true,
      modulesAutorises: ["site_workforce"], societesAutorisees: ["IRON GLOBAL SOLUTION"], sitesAutorises: [] }], sites: [] };
    var session = { username: "admin" };
    var SGDIModules = { registerModule: function () {} };
    function escapeHTML(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
    function adminUserByUsername(name) { return db.users.find((u) => u.username === name) || null; }
    function openModal(html) { document.getElementById("modal-host").innerHTML = '<div class="modal">' + html + '</div>'; }
    function closeModal() { document.getElementById("modal-host").innerHTML = ""; }
    function normalizeAdminUserRole(r) { return r; } function adminRoleDisplayLabel(r) { return r; }
  `);
  w.toast = (msg, type) => state.toasts.push([msg, type]);
  w.logActivity = () => {};
  w.confirm = (msg) => { state.confirms.push(msg); return confirmAnswer; };
  w.sgdiApi = async (p, opts) => {
    state.calls.push([opts.method, p, opts.body, opts.legacy]);
    if (p === "/auth/site-workforce/position-fields") return CATALOG;
    if (opts.method === "PUT") {
      if (putImpl) return putImpl(opts.body);
      state.saved = [...opts.body.fields];
      return { fields: state.saved, count: state.saved.length, total: 7 };
    }
    return { fields: [...state.saved], count: state.saved.length, total: 7 };
  };
  w.eval(SRC);
  return { w, state };
}
const $ = (w, sel) => w.document.querySelector(sel);
const checked = (w) => [...w.document.querySelectorAll("[data-beo-pf-field]")].filter((c) => c.checked).map((c) => c.dataset.beoPfField).sort();
const counter = (w) => $(w, "#beo-pf-counter").textContent;
function click(w, label) { [...w.document.querySelectorAll("#modal-host button")].find((b) => b.textContent.trim() === label).click(); }

test("tableau BEO : bouton « Champs accessibles » dans la colonne Actions", () => {
  const { w } = adminWindow();
  w.renderAdminBeo($(w, "#view"));
  const btn = $(w, "[data-beo-fields=CE01]");
  assert.ok(btn && /Champs accessibles/.test(btn.textContent));
});

test("ouverture : catalogue serveur, état enregistré coché, sensibles signalés, compteurs", async () => {
  const { w, state } = adminWindow();
  await w.openAdminBeoPositionFields("CE01");
  assert.deepStrictEqual(state.calls.map((c) => c[1]), ["/auth/site-workforce/position-fields", "/auth/users/41/site-workforce/position-fields"]);
  assert.ok(state.calls.every((c) => c[3] === false));
  assert.match($(w, "#modal-host").textContent, /Utilisateur : CE01/);
  assert.deepStrictEqual(checked(w), ["identity.last_name"]);
  assert.strictEqual(counter(w), "1 champ autorisé / 7");
  assert.match($(w, '[data-beo-pf-section="identity"] [data-beo-pf-section-count]').textContent, /1\/3/);
  assert.match($(w, '[data-beo-pf-row="contract.salary"]').textContent, /Sensible/);
  assert.doesNotMatch($(w, '[data-beo-pf-row="contract.type"]').textContent, /Sensible/);
});

test("BEO Standard, Tout décocher, Tout cocher (confirmation des sensibles), section entière", async () => {
  const { w, state } = adminWindow();
  await w.openAdminBeoPositionFields("CE01");
  click(w, "Profil BEO Standard");
  assert.deepStrictEqual(checked(w), [...CATALOG.standard_profile].sort());
  click(w, "Tout décocher");
  assert.deepStrictEqual(checked(w), []);
  assert.strictEqual(counter(w), "0 champ autorisé / 7");
  click(w, "Tout cocher");
  assert.strictEqual(checked(w).length, 7);
  assert.match(state.confirms.at(-1), /Salaire net/);
  click(w, "Tout décocher");
  const all = $(w, '[data-beo-pf-section-all="contract"]');
  all.checked = true; all.dispatchEvent(new w.Event("change"));
  assert.deepStrictEqual(checked(w), ["contract.end_date", "contract.salary", "contract.type"]);
  assert.match($(w, '[data-beo-pf-section="contract"] [data-beo-pf-section-count]').textContent, /3\/3/);
});

test("refus de la confirmation : aucun champ sensible coché en masse", async () => {
  const { w } = adminWindow({ confirmAnswer: false, saved: [] });
  await w.openAdminBeoPositionFields("CE01");
  click(w, "Tout cocher");
  assert.deepStrictEqual(checked(w), []);
});

test("recherche : « contrat » ne montre que la section Contrat", async () => {
  const { w } = adminWindow();
  await w.openAdminBeoPositionFields("CE01");
  const input = $(w, "#beo-pf-search");
  input.value = "contrat"; input.dispatchEvent(new w.Event("input"));
  const visible = [...w.document.querySelectorAll("[data-beo-pf-row]")].filter((r) => r.style.display !== "none" && r.closest("[data-beo-pf-section]").style.display !== "none").map((r) => r.dataset.beoPfRow);
  assert.deepStrictEqual(visible, ["contract.type", "contract.end_date", "contract.salary"]);
  input.value = "salaire"; input.dispatchEvent(new w.Event("input"));
  const visible2 = [...w.document.querySelectorAll("[data-beo-pf-row]")].filter((r) => r.style.display !== "none" && r.closest("[data-beo-pf-section]").style.display !== "none").map((r) => r.dataset.beoPfRow);
  assert.deepStrictEqual(visible2, ["contract.salary"]);
});

test("sauvegarde : PUT des clés cochées, fermeture, et réouverture sur l'état enregistré", async () => {
  const { w, state } = adminWindow();
  await w.openAdminBeoPositionFields("CE01");
  const box = $(w, '[data-beo-pf-field="contract.end_date"]');
  box.checked = true; box.dispatchEvent(new w.Event("change"));
  assert.strictEqual(await w.beoPfSave(), true);
  const put = state.calls.find((c) => c[0] === "PUT");
  assert.strictEqual(put[1], "/auth/users/41/site-workforce/position-fields");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(put[2])), { fields: ["contract.end_date", "identity.last_name"] });
  assert.strictEqual($(w, "#modal-host").innerHTML, "");
  await w.openAdminBeoPositionFields("CE01");
  assert.deepStrictEqual(checked(w), ["contract.end_date", "identity.last_name"]);
});

test("erreur API : message affiché, modal conservée, rien n'est perdu", async () => {
  const { w } = adminWindow({ putImpl: () => { throw new Error("Champ(s) inconnu(s) : x"); } });
  await w.openAdminBeoPositionFields("CE01");
  assert.strictEqual(await w.beoPfSave(), false);
  assert.match($(w, "#beo-pf-msg").textContent, /Enregistrement refusé : Champ\(s\) inconnu\(s\)/);
  assert.ok($(w, "#beo-pf-sections"));
  assert.strictEqual($(w, "#beo-pf-save").disabled, false);
});

test("l'administrateur ne peut pas ouvrir ses propres champs", async () => {
  const { w, state } = adminWindow();
  w.eval('db.users.push({ username: "admin", backendId: 1, modulesAutorises: ["site_workforce"] })');
  await w.openAdminBeoPositionFields("admin");
  assert.strictEqual(state.calls.length, 0);
  assert.match(state.toasts.at(-1)[0], /propres champs/);
});

test("aucune liste de champs codée en dur dans l'administration", () => {
  for (const key of ["identity.phone", "contract.salary", "assignment.site", "history.assignments"]) {
    assert.ok(!SRC.includes(key), `clé codée en dur : ${key}`);
  }
});
