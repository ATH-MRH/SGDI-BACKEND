// DRH NEXT — LOT 9 : tests de l'enrichissement du cockpit (dashboard.mjs). Toujours un
// seul appel réseau (/drh/dashboard, déjà prouvé LOT 1) — ce lot n'ajoute AUCUN nouvel
// appel, il affiche simplement la répartition complète déjà reçue. Aucun KPI fabriqué
// (entrées/sorties, répartition société/site) : absent de la réponse -> absent de l'écran.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderDashboard } from "../../app/static/drh-next/modules/dashboard.mjs";

function dashboardPayload(overrides = {}) {
  return { employees_total: 1, employees_by_status: {}, candidates_by_status: {}, leaves_pending: 0, trial_periods: [], ...overrides };
}
function fetchJson(body) { return async (url) => { return { ok: true, status: 200, text: async () => JSON.stringify(body) }; }; }
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh" });
  document.body.innerHTML = '<div id="dn-view"></div>';
  return { window };
}

test("répartition employés par statut : affichée intégralement (pas seulement 'actif'), toujours un seul appel réseau", async () => {
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload({ employees_by_status: { actif: 40, absent: 3, suspendu: 1 } })) }; };
  await renderDashboard();
  assert.deepEqual(calls, ["/api/drh/dashboard"]);
  const text = document.querySelector("#dn-view").textContent;
  assert.match(text, /Actif/);
  assert.match(text, /Absent/);
  assert.match(text, /Suspendu/);
  assert.match(text, /40/);
  assert.match(text, /3/);
});

test("répartition candidats par statut : affichée intégralement", async () => {
  const { window } = setup();
  window.fetch = fetchJson(dashboardPayload({ candidates_by_status: { nouvelle: 5, a_contractualiser: 2 } }));
  await renderDashboard();
  const text = document.querySelector("#dn-view").textContent;
  assert.match(text, /Nouvelle/);
  assert.match(text, /À contractualiser/);
});

test("statut inconnu : affiché tel quel (clé brute), jamais masqué silencieusement", async () => {
  const { window } = setup();
  window.fetch = fetchJson(dashboardPayload({ employees_by_status: { statut_exotique_backend: 2 } }));
  await renderDashboard();
  assert.match(document.querySelector("#dn-view").textContent, /statut_exotique_backend/);
});

test("répartition vide : aucun panneau de répartition vide affiché (pas de section fantôme)", async () => {
  const { window } = setup();
  window.fetch = fetchJson(dashboardPayload());
  await renderDashboard();
  assert.doesNotMatch(document.querySelector("#dn-view").innerHTML, /Répartition des employés/);
  assert.doesNotMatch(document.querySelector("#dn-view").innerHTML, /Répartition des candidats/);
});

test("aucun KPI fabriqué : ni entrées/sorties, ni répartition société/site (absents de la réponse backend)", async () => {
  const { window } = setup();
  window.fetch = fetchJson(dashboardPayload({ employees_by_status: { actif: 10 } }));
  await renderDashboard();
  const text = document.querySelector("#dn-view").textContent.toLowerCase();
  assert.doesNotMatch(text, /entrées|sorties|répartition par société|répartition par site/);
});
