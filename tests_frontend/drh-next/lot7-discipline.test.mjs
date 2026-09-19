// DRH NEXT — LOT 7 : tests de l'écran Discipline (discipline.mjs) et de la création de
// sanction ajoutée à l'onglet Discipline du dossier (employee-dossier.mjs). Le backend ne
// modélise ni incident, ni convocation, ni commission, ni décision — seulement un
// enregistrement de sanction plat : les tests ne portent que sur cela, rien de fabriqué.
// Sensibilité : /drh/sanctions ne doit jamais être appelé avant une recherche + ouverture
// explicite de l'onglet.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderDiscipline } from "../../app/static/drh-next/modules/discipline.mjs";
import { renderEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/drh-next/modules/employee-dossier.mjs";
import { _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";

function jsonResp(body, status = 200) { return { ok: status < 400, status, text: async () => JSON.stringify(body) }; }
function employee(id, overrides = {}) { return { id, code: `E${id}`, first_name: "A", last_name: "B", ...overrides }; }
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  resetLoader();
  resetDossier();
  return { window };
}

test("écran Discipline : aucun appel réseau avant recherche (données sensibles)", async () => {
  const { window } = setup();
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp({}); };
  await renderDiscipline();
  assert.equal(calls, 0);
});

test("recherche : un seul appel à /employees/page, jamais /drh/sanctions depuis l'écran de recherche", async () => {
  const { window } = setup();
  await renderDiscipline();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ items: [{ id: 4, code: "E0004", first_name: "Omar", last_name: "Ziani" }], page: 1, pages: 1, total: 1 }); };
  const input = document.querySelector("#dn-picker-search");
  input.value = "ziani"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls.length, 1);
  assert.ok(!calls.some(c => c.includes("/sanctions")));
  assert.ok(document.querySelector('a[href="#/employees/4"]'));
});

test("onglet Discipline : sanctions existantes affichées, aucun appel avant ouverture de l'onglet", async () => {
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/sanctions")) return jsonResp([{ id: 1, infraction_date: "2024-03-01", fault: "Retard répété", sanction_type: "avertissement", suspension_days: 0, site_name: "Site X" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  assert.ok(!calls.some(c => c.includes("/sanctions")), "aucun appel sanctions avant d'ouvrir l'onglet");
  document.querySelector('[data-dn-tab="discipline"]').click();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Retard répété/);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Site X/);
});

test("nouvelle sanction : formulaire masqué par défaut, soumission POST /sanctions avec employee_id correct", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/sanctions")) return jsonResp([]);
    return jsonResp(employee(7));
  };
  await renderEmployeeDossier({ id: "7" });
  document.querySelector('[data-dn-tab="discipline"]').click();
  await tick(); await tick();
  const form = document.querySelector("#dn-sanction-new-form");
  assert.equal(form.hidden, true);
  document.querySelector("#dn-sanction-new-toggle").click();
  assert.equal(form.hidden, false);

  let posted = null;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts?.method === "POST" && u.includes("/drh/sanctions")) { posted = JSON.parse(opts.body); return jsonResp({ id: 99, ...posted }); }
    if (u.includes("/sanctions")) return jsonResp([{ id: 99, infraction_date: "2024-09-01", fault: "Absence injustifiée", sanction_type: "avertissement", suspension_days: 2 }]);
    return jsonResp(employee(7));
  };
  form.querySelector('[name="infraction_date"]').value = "2024-09-01";
  form.querySelector('[name="fault"]').value = "Absence injustifiée";
  form.querySelector('[name="sanction_type"]').value = "avertissement";
  form.querySelector('[name="suspension_days"]').value = "2";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick(); await tick();
  assert.equal(posted.employee_id, 7);
  assert.equal(posted.fault, "Absence injustifiée");
  assert.equal(posted.suspension_days, 2);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Absence injustifiée/);
});

test("erreur à la création : message inline, pas de crash", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/sanctions")) return jsonResp([]);
    return jsonResp(employee(2));
  };
  await renderEmployeeDossier({ id: "2" });
  document.querySelector('[data-dn-tab="discipline"]').click();
  await tick(); await tick();
  document.querySelector("#dn-sanction-new-toggle").click();
  window.fetch = async () => jsonResp({ detail: "Champ requis manquant" }, 422);
  const form = document.querySelector("#dn-sanction-new-form");
  form.querySelector('[name="infraction_date"]').value = "2024-09-01";
  form.querySelector('[name="fault"]').value = "Test";
  form.querySelector('[name="sanction_type"]').value = "avertissement";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#dn-sanction-new-error").textContent, /Champ requis|impossible/i);
});
