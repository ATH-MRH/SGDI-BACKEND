// DRH NEXT — LOT 3 : tests du Dossier Employé 360° (employee-dossier.mjs).
// deep link, 1 seul GET employé au chargement, chargement paresseux par onglet (aucun
// appel avant clic), cache par onglet, historique honnête (non fabriqué), RBAC (403),
// erreur de section + retry, course entre onglets, aucun N+1, aucune fuite entre employés.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser, clearSession } from "../../app/static/drh-next/core/session.mjs";
import { renderEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/drh-next/modules/employee-dossier.mjs";
import { _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";

function employee(id, overrides = {}) {
  return { id, code: `E${String(id).padStart(4, "0")}`, first_name: "Prenom" + id, last_name: "Nom" + id, position: "Agent", status: "actif", society: "SOCIETE A", current_site_name: "Site " + id, ...overrides };
}
function jsonResp(body, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  resetLoader();
  resetDossier();
  return { window };
}

test("deep link direct #/employees/:id : exactement 1 GET (employé), aucun appel de section avant clic", async () => {
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp(employee(7)); };
  await renderEmployeeDossier({ id: "7" });
  assert.equal(calls.length, 1, "un seul GET au chargement du dossier");
  assert.match(calls[0], /\/api\/drh\/employees\/7$/);
  assert.match(document.querySelector("#dn-view").textContent, /NOM7|Nom7/i);
  assert.ok(document.querySelector('[data-dn-tab="identite"][aria-selected="true"]'), "onglet Identité actif par défaut");
});

test("onglet Contrats : chargement paresseux, exactement 1 GET /contracts?employee_id=", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(7));
  await renderEmployeeDossier({ id: "7" });
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp([{ contract_type: "CDI", position: "Agent", start_date: "2024-01-01", end_date: null, status: "actif" }]); };
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(calls.length, 1);
  const url = new URL(calls[0], "http://x");
  assert.equal(url.pathname, "/api/drh/contracts");
  assert.equal(url.searchParams.get("employee_id"), "7");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /CDI/);
});

test("onglet Congés : GET /leaves?employee_id=, onglet Discipline : GET /sanctions?employee_id=, onglet Documents : GET /documents?owner_type=employee&owner_id=", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(9));
  await renderEmployeeDossier({ id: "9" });

  window.fetch = async (url) => { return jsonResp([{ leave_type: "conge", start_date: "2024-06-01", end_date: "2024-06-10", status: "valide" }]); };
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /conge/i);

  let lastUrl;
  window.fetch = async (url) => { lastUrl = String(url); return jsonResp([{ infraction_date: "2024-02-01", fault: "Retard", sanction_type: "avertissement", suspension_days: 0 }]); };
  document.querySelector('[data-dn-tab="discipline"]').click();
  await tick(); await tick();
  assert.match(new URL(lastUrl, "http://x").pathname, /\/sanctions$/);
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Retard/);

  window.fetch = async (url) => { lastUrl = String(url); return jsonResp([{ label: "Carte AGS", file_name: "carte.pdf", file_path: "/uploads/carte.pdf" }]); };
  document.querySelector('[data-dn-tab="documents"]').click();
  await tick(); await tick();
  const u = new URL(lastUrl, "http://x");
  assert.equal(u.pathname, "/api/drh/documents");
  assert.equal(u.searchParams.get("owner_type"), "employee");
  assert.equal(u.searchParams.get("owner_id"), "9");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Carte AGS/);
});

test("onglet Historique : aucun appel réseau, état honnête (non fabriqué)", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(1));
  await renderEmployeeDossier({ id: "1" });
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp([]); };
  document.querySelector('[data-dn-tab="historique"]').click();
  await tick();
  assert.equal(calls, 0, "aucune requête pour un historique qu'aucune API ne fournit");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /non disponible/i);
});

test("cache par onglet (ttlMs) : revenir sur un onglet déjà chargé ne refait pas d'appel réseau", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(3));
  await renderEmployeeDossier({ id: "3" });
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp([{ contract_type: "CDI", status: "actif" }]); };
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(calls, 1);
  document.querySelector('[data-dn-tab="identite"]').click();
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(calls, 1, "le cache court (ttlMs) évite un second appel réseau immédiat pour le même onglet/employé");
});

test("RBAC : employé hors scope (403) -> état d'erreur avec retry, jamais un état vide silencieux", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp({ detail: "Accès refusé" }, 403);
  await renderEmployeeDossier({ id: "999" });
  const html = document.querySelector("#dn-view").innerHTML;
  assert.match(html, /Accès refusé|dn-error-state/);
  assert.ok(document.querySelector("[data-dn-retry-dossier]"), "un bouton réessayer doit être proposé");
});

test("erreur sur une section (ex: contrats) : état d'erreur + retry dans le panneau, sans casser le reste du dossier", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(4));
  await renderEmployeeDossier({ id: "4" });
  window.fetch = async () => jsonResp({ detail: "Erreur serveur" }, 500);
  document.querySelector('[data-dn-tab="contrats"]').click();
  // data-loader retente une fois sur 500 (retryDelayMs*1 = 400ms, comportement voulu — voir
  // LOT 2 §5/§6) avant de considérer l'échec définitif : attendre au-delà de ce délai.
  await new Promise(r => setTimeout(r, 500));
  assert.match(document.querySelector("#dn-dossier-panel").innerHTML, /dn-error-state/);
  assert.ok(document.querySelector('[data-dn-retry-tab="contrats"]'));
  // le reste du dossier (en-tête employé, onglets) reste affiché
  assert.match(document.querySelector("#dn-view").textContent, /NOM4|Nom4/i);
});

test("course entre onglets : la réponse tardive d'un onglet quitté n'écrase jamais l'onglet actif", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(employee(5));
  await renderEmployeeDossier({ id: "5" });
  let resolveContracts;
  window.fetch = async (url) => {
    if (String(url).includes("/contracts")) return new Promise(r => { resolveContracts = () => r(jsonResp([{ contract_type: "NE-DOIT-PAS-APPARAITRE" }])); });
    return jsonResp([{ leave_type: "NOUVEAU-OK" }]);
  };
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick();
  document.querySelector('[data-dn-tab="conges"]').click();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /NOUVEAU-OK/);
  resolveContracts?.();
  await tick(); await tick();
  assert.doesNotMatch(document.querySelector("#dn-dossier-panel").textContent, /NE-DOIT-PAS-APPARAITRE/, "la réponse tardive de l'onglet Contrats quitté ne doit jamais s'afficher par-dessus Congés");
});

test("aucun N+1 : ouvrir le dossier + un onglet ne produit que 2 requêtes réseau au total", async () => {
  const { window } = setup();
  let calls = 0;
  window.fetch = async (url) => {
    calls++;
    if (String(url).includes("/contracts")) return jsonResp([{ contract_type: "CDI" }]);
    return jsonResp(employee(6));
  };
  await renderEmployeeDossier({ id: "6" });
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(calls, 2);
});

test("aucune fuite entre employés : ouvrir le dossier de l'employé 10 puis 11 n'affiche jamais les données de 10", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).endsWith("/employees/10")) return jsonResp(employee(10, { code: "DONNEES-10" }));
    if (String(url).endsWith("/employees/11")) return jsonResp(employee(11, { code: "DONNEES-11" }));
    return jsonResp({}, 404);
  };
  await renderEmployeeDossier({ id: "10" });
  assert.match(document.querySelector("#dn-view").textContent, /DONNEES-10/);
  await renderEmployeeDossier({ id: "11" });
  assert.match(document.querySelector("#dn-view").textContent, /DONNEES-11/);
  assert.doesNotMatch(document.querySelector("#dn-view").textContent, /DONNEES-10/);
});

test("session différente : le cache d'un onglet (contrats) d'un employé ne traverse jamais une session", async () => {
  setup();
  setUser({ username: "userA", authorizedSocieties: ["SOCIETE A"] });
  const { window } = { window: globalThis.window };
  window.fetch = async () => jsonResp(employee(2));
  await renderEmployeeDossier({ id: "2" });
  let callsContracts = 0;
  window.fetch = async () => { callsContracts++; return jsonResp([{ contract_type: "VU-PAR-A" }]); };
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(callsContracts, 1);

  clearSession();
  setUser({ username: "userB", authorizedSocieties: ["SOCIETE B"] });
  window.fetch = async () => jsonResp(employee(2, { code: "VU-PAR-B" }));
  await renderEmployeeDossier({ id: "2" });
  window.fetch = async () => { callsContracts++; return jsonResp([{ contract_type: "VU-PAR-B" }]); };
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.equal(callsContracts, 2, "le cache de contrats de la session A pour l'employé 2 ne doit jamais être servi à la session B");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /VU-PAR-B/);
});
