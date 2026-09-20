// DRH NEXT — LOT 8 : tests de l'écran Documents (documents.mjs) et de l'enrichissement
// de l'onglet Documents du dossier (employee-dossier.mjs) : métadonnées + aperçu image.
// Aucun formulaire de dépôt (aucune route d'upload backend pour ce modèle — voir audit).
// L'URL d'aperçu/ouverture réutilise exactement le file_path déjà retourné par l'endpoint
// RBAC, jamais une saisie libre de l'utilisateur.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser, setToken } from "../../app/static/drh-next/core/session.mjs";
import { renderDocuments } from "../../app/static/drh-next/modules/documents.mjs";
import { renderEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/drh-next/modules/employee-dossier.mjs";
import { _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";

function jsonResp(body, status = 200) { return { ok: status < 400, status, text: async () => JSON.stringify(body) }; }
function employee(id, overrides = {}) { return { id, code: `E${id}`, first_name: "A", last_name: "B", ...overrides }; }
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  // Un token réel est nécessaire ici (contrairement aux autres tests de ce fichier, qui
  // mockent tout le fetch) pour vérifier que l'en-tête Authorization est bien joint aux
  // requêtes de contenu de document — exactement ce qu'un <img src> statique ne pourrait
  // jamais faire (voir P0 DRH-NEXT-DOC-URL-AUTH).
  setToken("fake-test-token");
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

// P0 sécurité (finalisation, DRH-NEXT-DOC-URL-AUTH fermée) : un document image n'affiche
// plus jamais un <img src="/uploads/..."> statique (le navigateur n'y joindrait aucun
// token) — seulement un bouton "Aperçu", qui déclenche au clic un fetch authentifié vers
// /drh/documents/{id}/content puis affiche l'image via une URL objet locale (blob:).
test("document image : aucun <img src=\"/uploads/...\"> statique ; le clic sur Aperçu charge le contenu de façon authentifiée", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents") && !String(url).includes("/content")) return jsonResp([{ id: 2, label: "Photo badge", file_name: "photo.jpg", file_path: "/uploads/photo.jpg", mime_type: "image/jpeg" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  assert.ok(!document.querySelector("#dn-dossier-panel img"), "aucun <img> avant le clic (chargement à la demande, pas eager)");
  const btn = document.querySelector('[data-dn-doc-open="2"]');
  assert.ok(btn, "un bouton Aperçu doit exister pour un document image");

  let contentUrl = null, contentHeaders = null;
  window.fetch = async (url, opts) => {
    contentUrl = String(url); contentHeaders = opts?.headers;
    return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }) };
  };
  btn.click();
  await tick(); await tick();
  assert.match(contentUrl, /\/api\/drh\/documents\/2\/content$/, "le contenu doit être demandé via la route authentifiée, jamais /uploads/... directement");
  assert.ok(contentHeaders?.Authorization, "la requête doit porter le token (impossible avec un <img src> statique)");
  const img = document.querySelector("#dn-dossier-panel img");
  assert.ok(img, "l'aperçu doit apparaître après le chargement");
  assert.match(img.getAttribute("src"), /^blob:/, "l'image doit utiliser une URL objet locale, jamais l'URL /uploads/... brute");
});

test("document non image : bouton Ouvrir uniquement, jamais un href=\"/uploads/...\" exposé dans le DOM", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents") && !String(url).includes("/content")) return jsonResp([{ id: 3, label: "Contrat", file_name: "c.pdf", file_path: "/uploads/c.pdf", mime_type: "application/pdf" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  assert.ok(!document.querySelector("#dn-dossier-panel img"));
  assert.ok(!document.querySelector('#dn-dossier-panel a[href="/uploads/c.pdf"]'), "l'URL /uploads/... ne doit plus jamais apparaître directement dans le DOM");
  const btn = document.querySelector('[data-dn-doc-open="3"]');
  assert.ok(btn, "un bouton Ouvrir doit exister");
  assert.equal(btn.textContent, "Ouvrir");
});

test("document : 403 backend sur le contenu affiche un état d'erreur sur le bouton, jamais un contenu vide silencieux", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/documents") && !String(url).includes("/content")) return jsonResp([{ id: 4, label: "Confidentiel", file_name: "c.pdf", file_path: "/uploads/c.pdf", mime_type: "application/pdf" }]);
    return jsonResp(employee(1));
  };
  await renderEmployeeDossier({ id: "1" });
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  window.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ detail: "Accès refusé" }) });
  const btn = document.querySelector('[data-dn-doc-open="4"]');
  btn.click();
  await tick(); await tick();
  assert.match(btn.textContent, /refusé/i);
  assert.ok(!btn.hasAttribute("disabled"), "le bouton redevient utilisable après l'échec");
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
