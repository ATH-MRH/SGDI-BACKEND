// DRH NEXT — LOT 10 : tests de finalisation transverses (pas de nouvelle fonctionnalité).
// 404, deep links directs de toutes les routes LOT 3-9, état hors-ligne/erreur réseau,
// accessibilité (labels de formulaire liés via for/id).
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import * as router from "../../app/static/drh-next/core/router.mjs";
import { renderEmployees } from "../../app/static/drh-next/modules/employees.mjs";
import { renderEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/drh-next/modules/employee-dossier.mjs";
import { renderContracts } from "../../app/static/drh-next/modules/contracts.mjs";
import { renderAssignments } from "../../app/static/drh-next/modules/assignments.mjs";
import { renderLeaves } from "../../app/static/drh-next/modules/leaves.mjs";
import { renderDiscipline } from "../../app/static/drh-next/modules/discipline.mjs";
import { renderDocuments } from "../../app/static/drh-next/modules/documents.mjs";
import { renderDashboard } from "../../app/static/drh-next/modules/dashboard.mjs";
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

test("deep link direct sur chaque route LOT 3-9 : rendu sans passer par une autre route d'abord", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/employees/page")) return jsonResp({ items: [employee(1)], page: 1, pages: 1, total: 1 });
    if (u.includes("/employees/1")) return jsonResp(employee(1));
    if (u.includes("/dashboard")) return jsonResp({ employees_total: 0, employees_by_status: {}, candidates_by_status: {}, leaves_pending: 0, trial_periods: [] });
    return jsonResp([]);
  };
  await renderEmployees();
  assert.ok(document.querySelector("#dn-emp-results"));
  await renderEmployeeDossier({ id: "1" });
  assert.ok(document.querySelector("#dn-dossier-tabs"));
  await renderContracts();
  assert.ok(document.querySelector("#dn-picker-search"));
  await renderAssignments();
  assert.ok(document.querySelector("#dn-picker-search"));
  await renderLeaves();
  assert.ok(document.querySelector("#dn-picker-search"));
  await renderDiscipline();
  assert.ok(document.querySelector("#dn-picker-search"));
  await renderDocuments();
  assert.ok(document.querySelector("#dn-picker-search"));
  await renderDashboard();
  assert.match(document.querySelector("#dn-view").textContent, /Tableau de bord RH/);
});

test("404 : route inconnue affiche un état explicite avec retour au tableau de bord, jamais un écran vide", async () => {
  const { window } = setup();
  router._resetForTests();
  router.registerNotFound(() => {
    document.querySelector("#dn-view").innerHTML = `<div class="dn-card dn-panel"><div class="dn-empty-state">Page introuvable. <a href="#/dashboard">Retour au tableau de bord</a>.</div></div>`;
  });
  router.startRouter();
  router.navigate("route/qui/nexiste/pas");
  await tick();
  assert.match(document.querySelector("#dn-view").textContent, /introuvable/i);
  assert.ok(document.querySelector('a[href="#/dashboard"]'));
});

test("hors-ligne / erreur réseau sur un sélecteur employé (Contrats) : état d'erreur avec retry, jamais un plantage", async () => {
  const { window } = setup();
  await renderContracts();
  window.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const input = document.querySelector("#dn-picker-search");
  input.value = "test"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 900)); // debounce + retry data-loader
  assert.match(document.querySelector("#dn-picker-results").innerHTML, /dn-error-state/);
  assert.ok(document.querySelector("[data-dn-retry-contracts-picker]"), "un bouton réessayer doit être proposé après une coupure réseau");
});

test("accessibilité : chaque label du formulaire Congés/Discipline est lié à son champ via for/id", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves") || String(url).includes("/sanctions")) return jsonResp([]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  for (const tab of ["conges", "discipline"]) {
    document.querySelector(`[data-dn-tab="${tab}"]`).click();
    await tick(); await tick();
    const labels = document.querySelectorAll("#dn-dossier-panel form label");
    assert.ok(labels.length > 0, `au moins un label dans le formulaire de l'onglet ${tab}`);
    labels.forEach(label => {
      const forId = label.getAttribute("for");
      assert.ok(forId, `label sans attribut for dans l'onglet ${tab}`);
      assert.ok(document.getElementById(forId), `label for="${forId}" ne correspond à aucun champ dans l'onglet ${tab}`);
    });
  }
});
