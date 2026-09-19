// DRH NEXT — LOT 6 : tests de l'écran Congés (leaves.mjs) et des interactions ajoutées à
// l'onglet Congés du dossier (employee-dossier.mjs) : demande + validation. Aucune
// vérification frontend "validate" fabriquée (le backend n'en applique aucune pour
// approve/refuse — voir audit dans employee-dossier.mjs) : les boutons sont visibles à
// quiconque voit déjà l'onglet, exactement comme le backend l'autorise réellement.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderLeaves } from "../../app/static/drh-next/modules/leaves.mjs";
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

test("écran Congés : sélecteur employé, un seul appel à /employees/page", async () => {
  const { window } = setup();
  await renderLeaves();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ items: [{ id: 5, code: "E0005", first_name: "Yacine", last_name: "Ouali" }], page: 1, pages: 1, total: 1 }); };
  const input = document.querySelector("#dn-picker-search");
  input.value = "ouali"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls.length, 1);
  assert.ok(document.querySelector('a[href="#/employees/5"]'));
});

test("onglet Congés : une demande en attente affiche Approuver/Refuser, une décidée non", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves")) return jsonResp([
      { id: 1, leave_type: "conge", start_date: "2024-07-01", end_date: "2024-07-10", status: "instance" },
      { id: 2, leave_type: "maladie", start_date: "2024-05-01", end_date: "2024-05-03", status: "approuve" },
    ]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  const panel = document.querySelector("#dn-dossier-panel");
  assert.ok(panel.querySelector('[data-dn-leave-approve="1"]'), "demande en attente : bouton Approuver présent");
  assert.ok(panel.querySelector('[data-dn-leave-refuse="1"]'));
  assert.ok(!panel.querySelector('[data-dn-leave-approve="2"]'), "demande déjà décidée : aucun bouton d'action");
  assert.match(panel.textContent, /En attente/);
  assert.match(panel.textContent, /Approuvé/);
});

test("approuver une demande : POST /leaves/{id}/approve puis rechargement de la liste", async () => {
  const { window } = setup();
  let approveCalled = false;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/leaves/1/approve")) { approveCalled = true; assert.equal(opts?.method, "POST"); return jsonResp({ id: 1, status: "approuve" }); }
    if (u.includes("/leaves")) return jsonResp(approveCalled ? [{ id: 1, leave_type: "conge", start_date: "2024-07-01", end_date: "2024-07-10", status: "approuve" }] : [{ id: 1, leave_type: "conge", start_date: "2024-07-01", end_date: "2024-07-10", status: "instance" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  document.querySelector('[data-dn-leave-approve="1"]').click();
  await tick(); await tick(); await tick();
  assert.ok(approveCalled);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Approuvé/);
  assert.ok(!document.querySelector('[data-dn-leave-approve="1"]'), "une fois approuvée, plus de bouton d'action");
});

test("refuser une demande : POST /leaves/{id}/refuse", async () => {
  const { window } = setup();
  let refuseCalled = false;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/leaves/1/refuse")) { refuseCalled = true; return jsonResp({ id: 1, status: "refuse" }); }
    if (u.includes("/leaves")) return jsonResp(refuseCalled ? [{ id: 1, leave_type: "conge", status: "refuse" }] : [{ id: 1, leave_type: "conge", status: "instance" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  document.querySelector('[data-dn-leave-refuse="1"]').click();
  await tick(); await tick(); await tick();
  assert.ok(refuseCalled);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Refusé/);
});

test("nouvelle demande : formulaire masqué par défaut, soumission POST /leaves avec employee_id correct", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves")) return jsonResp([]);
    return jsonResp(employee(9));
  };
  await renderEmployeeDossier({ id: "9" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  const form = document.querySelector("#dn-leave-new-form");
  assert.equal(form.hidden, true);
  document.querySelector("#dn-leave-new-toggle").click();
  assert.equal(form.hidden, false);

  let posted = null;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts?.method === "POST" && u.includes("/drh/leaves") && !u.includes("/approve") && !u.includes("/refuse")) {
      posted = JSON.parse(opts.body);
      return jsonResp({ id: 42, ...posted, status: "instance" });
    }
    if (u.includes("/leaves")) return jsonResp([{ id: 42, leave_type: "conge", start_date: "2024-08-01", end_date: "2024-08-05", status: "instance" }]);
    return jsonResp(employee(9));
  };
  form.querySelector('[name="leave_type"]').value = "conge";
  form.querySelector('[name="start_date"]').value = "2024-08-01";
  form.querySelector('[name="end_date"]').value = "2024-08-05";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick(); await tick();
  assert.equal(posted.employee_id, 9);
  assert.equal(posted.leave_type, "conge");
  assert.equal(posted.start_date, "2024-08-01");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /En attente/);
});

test("erreur à la création : message inline, pas de crash, formulaire reste utilisable", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/leaves")) return jsonResp([]);
    return jsonResp(employee(3));
  };
  await renderEmployeeDossier({ id: "3" });
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  document.querySelector("#dn-leave-new-toggle").click();
  window.fetch = async () => jsonResp({ detail: "Dates invalides" }, 422);
  const form = document.querySelector("#dn-leave-new-form");
  form.querySelector('[name="leave_type"]').value = "conge";
  form.querySelector('[name="start_date"]').value = "2024-08-01";
  form.querySelector('[name="end_date"]').value = "2024-08-05";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#dn-leave-new-error").textContent, /Dates invalides|impossible/i);
});
