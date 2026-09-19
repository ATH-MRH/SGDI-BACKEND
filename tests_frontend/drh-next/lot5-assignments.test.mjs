// DRH NEXT — LOT 5 : tests de l'écran Affectations & mouvements RH (assignments.mjs).
// Même sélecteur partagé que Contrats (_employee-picker.mjs) : recherche -> résultats ->
// lien vers le dossier employé (onglet Affectation, LOT 3). Aucun appel /api/ops/* (la
// permission "ops" est un module séparé de "drh" — voir audit dans assignments.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderAssignments } from "../../app/static/drh-next/modules/assignments.mjs";
import { _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";

function jsonResp(body, status = 200) { return { ok: status < 400, status, text: async () => JSON.stringify(body) }; }
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  resetLoader();
  return { window };
}

test("aucun appel réseau tant qu'aucune recherche n'est tapée", async () => {
  const { window } = setup();
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp({}); };
  await renderAssignments();
  assert.equal(calls, 0);
});

test("recherche : un seul appel à /employees/page, jamais /api/ops/*", async () => {
  const { window } = setup();
  await renderAssignments();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ items: [{ id: 3, code: "E0003", first_name: "Sara", last_name: "Amrani", position: "Superviseur" }], page: 1, pages: 1, total: 1 }); };
  const input = document.querySelector("#dn-picker-search");
  input.value = "amrani"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls.length, 1);
  const url = new URL(calls[0], "http://x");
  assert.equal(url.pathname, "/api/drh/employees/page");
  assert.ok(!calls.some(c => c.includes("/api/ops/")), "aucun appel au module OPS depuis DRH Next");
  assert.ok(document.querySelector('a[href="#/employees/3"]'), "le résultat doit lier vers le dossier employé (onglet Affectation)");
  assert.match(document.querySelector("#dn-picker-results").textContent, /AMRANI|Amrani/i);
});

test("le texte de l'écran explique honnêtement l'absence d'historique (aucune donnée fabriquée)", async () => {
  setup();
  await renderAssignments();
  assert.match(document.querySelector("#dn-view").textContent, /Aucun historique de mouvements/);
});
