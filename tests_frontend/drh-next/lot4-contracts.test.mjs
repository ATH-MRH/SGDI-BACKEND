// DRH NEXT — LOT 4 : tests de l'écran Contrats (contracts.mjs).
// Sélecteur employé-centré (aucun endpoint contrats paginé côté backend) : recherche
// debounce -> résultats -> lien vers le dossier employé. Aucun appel /drh/contracts SANS
// employee_id (ce serait la collection non bornée interdite). Statut contrat "Expiré"
// dérivé mécaniquement de end_date (employee-dossier.mjs), pas de seuil "à échéance" inventé.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderContracts } from "../../app/static/drh-next/modules/contracts.mjs";
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
  await renderContracts();
  assert.equal(calls, 0);
  assert.match(document.querySelector("#dn-picker-results").textContent, /Tapez un nom/);
});

test("recherche : debounce ~300ms, un seul appel à /employees/page (jamais /contracts sans employee_id)", async () => {
  const { window } = setup();
  await renderContracts();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ items: [{ id: 1, code: "E0001", first_name: "Karim", last_name: "Belaid", position: "Agent" }], page: 1, pages: 1, total: 1 }); };
  const input = document.querySelector("#dn-picker-search");
  for (const ch of ["b", "be", "bel"]) { input.value = ch; input.dispatchEvent(new window.Event("input")); await new Promise(r => setTimeout(r, 50)); }
  assert.equal(calls.length, 0, "rien avant la fin du debounce");
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls.length, 1, "une seule requête après debounce");
  const url = new URL(calls[0], "http://x");
  assert.equal(url.pathname, "/api/drh/employees/page");
  assert.match(document.querySelector("#dn-picker-results").textContent, /BELAID|Belaid/i);
  assert.ok(document.querySelector('a[href="#/employees/1"]'), "le résultat doit lier vers le dossier employé (contrats via LOT 3)");
});

test("vider la recherche revient à l'état neutre sans appel réseau", async () => {
  const { window } = setup();
  await renderContracts();
  window.fetch = async () => jsonResp({ items: [{ id: 1, code: "E0001", first_name: "A", last_name: "B" }], page: 1, pages: 1, total: 1 });
  const input = document.querySelector("#dn-picker-search");
  input.value = "b"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.match(document.querySelector("#dn-picker-results").textContent, /B/);
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp({}); };
  input.value = ""; input.dispatchEvent(new window.Event("input"));
  await tick();
  assert.equal(calls, 0);
  assert.match(document.querySelector("#dn-picker-results").textContent, /Tapez un nom/);
});

test("aucun résultat : état vide explicite, pas une erreur", async () => {
  const { window } = setup();
  await renderContracts();
  window.fetch = async () => jsonResp({ items: [], page: 1, pages: 1, total: 0 });
  const input = document.querySelector("#dn-picker-search");
  input.value = "zzzintrouvable"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.doesNotMatch(document.querySelector("#dn-picker-results").innerHTML, /dn-error-state/);
  assert.match(document.querySelector("#dn-picker-results").textContent, /Aucun employé/);
});

test("course recherche : une frappe plus récente doit gagner sur une réponse tardive d'une frappe précédente", async () => {
  const { window } = setup();
  await renderContracts();
  let resolveSlow;
  window.fetch = async (url) => {
    if (String(url).includes("q=lent")) return new Promise(r => { resolveSlow = () => r(jsonResp({ items: [{ id: 1, code: "LENT", first_name: "A", last_name: "A" }], page: 1, pages: 1, total: 1 })); });
    return jsonResp({ items: [{ id: 2, code: "RAPIDE", first_name: "B", last_name: "B" }], page: 1, pages: 1, total: 1 });
  };
  const input = document.querySelector("#dn-picker-search");
  input.value = "lent"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  input.value = "rapide"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.match(document.querySelector("#dn-picker-results").textContent, /RAPIDE/);
  resolveSlow?.();
  await tick(); await tick();
  assert.doesNotMatch(document.querySelector("#dn-picker-results").textContent, /LENT/);
});
