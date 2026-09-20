// DRH NEXT — LOT 11A : test du retour utilisateur honnête sur 403 (approbation/refus de
// congé) — DRH-NEXT-LEAVE-ACTION-RBAC. Le bouton reste affiché (jamais masqué a priori côté
// frontend, le backend reste seul juge), mais un 403 doit produire un message clair, pas un
// échec silencieux.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
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

test("403 sur approbation de congé (action 'validate' absente) : message honnête, bouton reste visible, jamais un échec silencieux", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves")) return jsonResp([{ id: 5, leave_type: "conge", start_date: "2025-01-01", end_date: "2025-01-02", status: "instance" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  window.fetch = async () => jsonResp({ detail: "Action 'validate' requise pour approuver ou refuser un congé" }, 403);
  document.querySelector('[data-dn-leave-approve="5"]').click();
  await tick(); await tick();
  const errText = document.querySelector('[data-dn-leave-error="5"]').textContent;
  assert.match(errText, /permission|validation/i, "un message clair doit expliquer le refus, pas un silence");
  assert.ok(document.querySelector('[data-dn-leave-approve="5"]'), "le bouton reste affiché : le frontend ne décide jamais seul de le masquer");
  assert.ok(!document.querySelector('[data-dn-leave-approve="5"]').hasAttribute("disabled"), "le bouton redevient utilisable après l'échec (permet de réessayer si les droits changent)");
});

test("approbation réussie (200) : aucun message d'erreur résiduel", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves")) return jsonResp([{ id: 6, leave_type: "conge", start_date: "2025-01-01", end_date: "2025-01-02", status: "instance" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  window.fetch = async (url) => {
    if (String(url).includes("/approve")) return jsonResp({ id: 6, status: "approuve" });
    return jsonResp([{ id: 6, leave_type: "conge", status: "approuve" }]);
  };
  document.querySelector('[data-dn-leave-approve="6"]').click();
  await tick(); await tick(); await tick();
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Approuvé/);
});

// ── LOT 11B : onglets Pointage et Matériel (vues composées) ───────────────────

test("onglet Pointage : 1 appel à /attendance, données réelles affichées", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/attendance")) return jsonResp([{ id: 1, presence_date: "2025-01-01", site_name: "SITE Y", status: "present", arrival_time: "08:00", departure_time: "16:00" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp([{ id: 1, presence_date: "2025-01-01", site_name: "SITE Y", status: "present", arrival_time: "08:00", departure_time: "16:00" }]); };
  document.querySelector('[data-dn-tab="pointage"]').click();
  await tick(); await tick();
  assert.equal(calls, 1);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /SITE Y/);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /08:00/);
});

test("onglet Matériel : 1 appel à /equipment, données réelles affichées", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/equipment")) return jsonResp([{ id: 1, article_designation: "Gilet pare-balles", quantity: 1, dotation_date: "2024-01-01", status: "attribue" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp([{ id: 1, article_designation: "Gilet pare-balles", quantity: 1, dotation_date: "2024-01-01", status: "attribue" }]); };
  document.querySelector('[data-dn-tab="materiel"]').click();
  await tick(); await tick();
  assert.equal(calls, 1);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Gilet pare-balles/);
});

test("aucun onglet lazy chargé avant clic, même avec 9 onglets désormais disponibles", async () => {
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp(employee(1)); };
  await renderEmployeeDossier({ id: "1" });
  assert.equal(calls.length, 1, "un seul appel (identité) au chargement du dossier, quel que soit le nombre d'onglets");
});
