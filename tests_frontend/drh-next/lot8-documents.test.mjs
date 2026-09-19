// DRH NEXT — LOT 8 : tests de l'écran Documents (documents.mjs) et de l'enrichissement
// de l'onglet Documents du dossier (employee-dossier.mjs) : métadonnées + aperçu image.
// Aucun formulaire de dépôt (aucune route d'upload backend pour ce modèle — voir audit).
// L'URL d'aperçu/ouverture réutilise exactement le file_path déjà retourné par l'endpoint
// RBAC, jamais une saisie libre de l'utilisateur.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser } from "../../app/static/drh-next/core/session.mjs";
import { renderDocuments } from "../../app/static/drh-next/modules/documents.mjs";
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

test("écran Documents : aucun appel réseau avant recherche", async () => {
  const { window } = setup();
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp({}); };
  await renderDocuments();
  assert.equal(calls, 0);
});

test("recherche : un seul appel à /employees/page, jamais /drh/documents depuis l'écran de recherche", async () => {
  const { window } = setup();
  await renderDocuments();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp({ items: [{ id: 6, code: "E0006", first_name: "Lina", last_name: "Brahimi" }], page: 1, pages: 1, total: 1 }); };
  const input = document.querySelector("#dn-picker-search");
  input.value = "brahimi"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls.length, 1);
  assert.ok(!calls.some(c => c.includes("/documents")));
  assert.ok(document.querySelector('a[href="#/employees/6"]'));
});

test("onglet Documents : métadonnées enrichies affichées (type, déposé par, date)", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents")) return jsonResp([{ id: 1, label: "Attestation", file_name: "att.pdf", file_path: "/uploads/att.pdf", mime_type: "application/pdf", uploaded_by: "admin", created_at: "2024-05-01T10:00:00" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  const text = document.querySelector("#dn-dossier-panel").textContent;
  assert.match(text, /Attestation/);
  assert.match(text, /application\/pdf/);
  assert.match(text, /admin/);
  assert.match(text, /2024-05-01/);
});

test("document image : aperçu inline avec le MÊME file_path que l'API a renvoyé (aucune saisie libre)", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents")) return jsonResp([{ id: 2, label: "Photo badge", file_name: "photo.jpg", file_path: "/uploads/photo.jpg", mime_type: "image/jpeg" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  const img = document.querySelector("#dn-dossier-panel img");
  assert.ok(img, "un document image doit avoir un aperçu <img>");
  assert.equal(img.getAttribute("src"), "/uploads/photo.jpg");
});

test("document non image : lien Ouvrir uniquement, aucun <img>", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents")) return jsonResp([{ id: 3, label: "Contrat", file_name: "c.pdf", file_path: "/uploads/c.pdf", mime_type: "application/pdf" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  assert.ok(!document.querySelector("#dn-dossier-panel img"));
  assert.ok(document.querySelector('#dn-dossier-panel a[href="/uploads/c.pdf"]'));
});

test("aucun formulaire de dépôt de document (aucune route d'upload backend)", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents")) return jsonResp([]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  assert.ok(!document.querySelector("#dn-dossier-panel form"), "aucun formulaire de création de document ne doit exister ce lot");
});
