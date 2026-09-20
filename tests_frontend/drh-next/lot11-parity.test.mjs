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

// ── LOT 11B : Nouveau contrat / Fin de contrat ─────────────────────────────────

test("nouveau contrat : formulaire masqué par défaut, soumission POST /contracts avec employee_id correct", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/contracts")) return jsonResp([]);
    return jsonResp(employee(4));
  };
  await renderEmployeeDossier({ id: "4" });
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  const form = document.querySelector("#dn-contract-new-form");
  assert.equal(form.hidden, true);
  document.querySelector("#dn-contract-new-toggle").click();
  assert.equal(form.hidden, false);

  let posted = null;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts?.method === "POST" && u.includes("/drh/contracts")) { posted = JSON.parse(opts.body); return jsonResp({ id: 55, ...posted, status: "actif" }); }
    if (u.includes("/contracts")) return jsonResp([{ id: 55, contract_type: "CDI", position: "Agent", start_date: "2025-01-01", status: "actif" }]);
    return jsonResp(employee(4));
  };
  form.querySelector('[name="contract_type"]').value = "CDI";
  form.querySelector('[name="position"]').value = "Agent";
  form.querySelector('[name="start_date"]').value = "2025-01-01";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick(); await tick();
  assert.equal(posted.employee_id, 4);
  assert.equal(posted.contract_type, "CDI");
  assert.match(document.querySelector("#dn-dossier-panel").textContent, /Actif/);
});

test("fin de contrat : PUT /contracts/{id} avec end_date=aujourd'hui et status=termine, bouton disparaît", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/contracts")) return jsonResp([{ id: 7, contract_type: "CDD", start_date: "2024-01-01", status: "actif" }]);
    return jsonResp(employee(4));
  };
  await renderEmployeeDossier({ id: "4" });
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  assert.ok(document.querySelector('[data-dn-contract-end="7"]'), "un contrat actif doit avoir un bouton Terminer");

  let putBody = null, putUrl = null;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (opts?.method === "PUT") { putUrl = u; putBody = JSON.parse(opts.body); return jsonResp({ id: 7, status: "termine" }); }
    if (u.includes("/contracts")) return jsonResp([{ id: 7, contract_type: "CDD", start_date: "2024-01-01", status: "termine", end_date: putBody?.end_date }]);
    return jsonResp(employee(4));
  };
  document.querySelector('[data-dn-contract-end="7"]').click();
  await tick(); await tick(); await tick();
  assert.match(putUrl, /\/drh\/contracts\/7$/);
  assert.equal(putBody.status, "termine");
  assert.equal(putBody.end_date, new Date().toISOString().slice(0, 10));
  assert.ok(!document.querySelector('[data-dn-contract-end="7"]'), "le bouton Terminer disparaît une fois le contrat terminé");
});

test("aucune logique contractuelle recalculée côté client (pas de préavis/reconduction inventés)", async () => {
  const { window } = setup();
  window.fetch = async (url) => {
    if (String(url).includes("/contracts")) return jsonResp([]);
    return jsonResp(employee(4));
  };
  await renderEmployeeDossier({ id: "4" });
  document.querySelector('[data-dn-tab="contrats"]').click();
  await tick(); await tick();
  const text = document.querySelector("#dn-view").textContent.toLowerCase();
  assert.doesNotMatch(text, /préavis|reconduction|renouvellement automatique/);
});

// ── LOT 11B : Recrutement ───────────────────────────────────────────────────
import { renderRecruitment } from "../../app/static/drh-next/modules/recruitment.mjs";

function candidate(id, overrides = {}) {
  return { id, first_name: "Amine", last_name: "Kaci", phone: "0550000001", email: "a@x.com", desired_position: "Agent", society: "SOCIETE A", expected_salary: 45000, recruiter_opinion: null, status: "nouvelle", ...overrides };
}
function candPage(items, opts = {}) { return { items, page: opts.page || 1, pages: opts.pages || 1, total: opts.total ?? items.length, page_size: 25 }; }

test("recrutement : premier chargement demande page=1, mode=new, jamais /candidates complet", async () => {
  const { window } = setup();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp(candPage([candidate(1)])); };
  await renderRecruitment();
  assert.equal(calls.length, 1);
  const url = new URL(calls[0], "http://x");
  assert.equal(url.pathname, "/api/drh/candidates/page");
  assert.equal(url.searchParams.get("mode"), "new");
  assert.ok(!calls.some(c => c.endsWith("/candidates")), "jamais l'endpoint liste complète");
});

test("clic sur une ligne : détail affiché SANS appel réseau supplémentaire (données déjà en mémoire)", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(1, { first_name: "Amine", last_name: "Kaci" })]));
  await renderRecruitment();
  let calls = 0;
  window.fetch = async () => { calls++; return jsonResp({}); };
  document.querySelector('[data-dn-rec-open="1"]').click();
  await tick();
  assert.equal(calls, 0, "le détail vient des données déjà reçues par la liste, aucun GET /candidates/{id} (qui n'existe pas côté backend)");
  assert.match(document.querySelector("#dn-view").textContent, /Kaci/);
});

test("convocation : POST /candidates/{id}/convocation-email avec les bons champs", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(2)]));
  await renderRecruitment();
  document.querySelector('[data-dn-rec-open="2"]').click();
  await tick();
  document.querySelector("#dn-rec-convoke-toggle").click();
  let posted = null, postedUrl = null;
  window.fetch = async (url, opts) => { postedUrl = String(url); posted = JSON.parse(opts.body); return jsonResp({ data: { email_sent: true } }); };
  document.querySelector("#dn-rec-convoke-date").value = "2026-01-01";
  document.querySelector("#dn-rec-convoke-heure").value = "09:00";
  document.querySelector("#dn-rec-convoke-lieu").value = "Siège";
  document.querySelector("#dn-rec-convoke-motif").value = "Entretien";
  document.querySelector("#dn-rec-convoke-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.match(postedUrl, /\/candidates\/2\/convocation-email$/);
  assert.equal(posted.lieu, "Siège");
  assert.match(document.querySelector("#dn-rec-action-success").textContent, /envoyée/i);
});

// Trouvé en vérification live (backend réel) : /convocation-email répond 200 MÊME quand
// l'envoi échoue réellement (ex. candidat sans email) — le vrai résultat est dans
// data.email_sent, jamais dans le seul code HTTP. Un 200 ne doit jamais être confondu avec
// un succès métier.
test("convocation : un 200 HTTP avec email_sent=false affiche une erreur, jamais un faux succès", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(2)]));
  await renderRecruitment();
  document.querySelector('[data-dn-rec-open="2"]').click();
  await tick();
  document.querySelector("#dn-rec-convoke-toggle").click();
  window.fetch = async () => jsonResp({ data: { email_sent: false, delivery: { error: "Le candidat ne possède aucune adresse email" } } });
  document.querySelector("#dn-rec-convoke-date").value = "2026-01-01";
  document.querySelector("#dn-rec-convoke-heure").value = "09:00";
  document.querySelector("#dn-rec-convoke-lieu").value = "Siège";
  document.querySelector("#dn-rec-convoke-motif").value = "Entretien";
  document.querySelector("#dn-rec-convoke-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.equal(document.querySelector("#dn-rec-action-success").textContent, "", "aucun succès affiché");
  assert.match(document.querySelector("#dn-rec-action-error").textContent, /adresse email/i);
});

test("recruter : POST /candidates/{id}/recruit, message de succès honnête", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(3)]));
  await renderRecruitment();
  document.querySelector('[data-dn-rec-open="3"]').click();
  await tick();
  let postedUrl = null;
  window.fetch = async (url) => { postedUrl = String(url); return jsonResp({ data: { status: "recrute" } }); };
  document.querySelector("#dn-rec-recruit").click();
  await tick(); await tick();
  assert.match(postedUrl, /\/candidates\/3\/recruit$/);
  assert.match(document.querySelector("#dn-rec-action-success").textContent, /recruté/i);
});

test("validation finale : mot de passe requis, erreur affichée si refusé (401/403)", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(4)]));
  await renderRecruitment();
  document.querySelector('[data-dn-rec-open="4"]').click();
  await tick();
  document.querySelector("#dn-rec-validate-toggle").click();
  window.fetch = async () => jsonResp({ detail: "Mot de passe de validation incorrect" }, 401);
  document.querySelector("#dn-rec-validate-pwd").value = "mauvais-mdp";
  document.querySelector("#dn-rec-validate-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#dn-rec-action-error").textContent, /incorrect|impossible/i);
});

test("RBAC recrutement : 403 (accès recrutement absent) -> état d'erreur, jamais un vide silencieux", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp({ detail: "Accès recrutement refusé" }, 403);
  await renderRecruitment();
  assert.match(document.querySelector("#dn-rec-results").innerHTML, /dn-error-state/);
});

test("changement de filtre (mode) revient en page 1", async () => {
  const { window } = setup();
  window.fetch = async () => jsonResp(candPage([candidate(1)], { page: 2, pages: 3, total: 60 }));
  await renderRecruitment();
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return jsonResp(candPage([candidate(1)])); };
  const mode = document.querySelector("#dn-rec-mode");
  mode.value = "reserve"; mode.dispatchEvent(new window.Event("change"));
  await tick();
  const url = new URL(calls[0], "http://x");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("mode"), "reserve");
});

// ── LOT 12 §18 : préservation d'état Employés (page/recherche/mode) ──────────
import { renderEmployees, renderEmployeeDetail, _resetForTests as resetEmployeesState2 } from "../../app/static/drh-next/modules/employees.mjs";

test("Employés : page/recherche/mode sont préservés après ouverture d'un détail puis retour à la liste", async () => {
  const { window } = setup();
  resetEmployeesState2();
  window.fetch = async () => jsonResp({ items: [{ id: 1, code: "E0001", first_name: "A", last_name: "B" }], page: 1, pages: 3, total: 120 });
  await renderEmployees();
  document.querySelector("#dn-emp-search").value = "dupont";
  document.querySelector("#dn-emp-search").dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  document.querySelector("#dn-emp-mode").value = "tous";
  document.querySelector("#dn-emp-mode").dispatchEvent(new window.Event("change"));
  await tick();
  // "ouvrir le détail" : on quitte simplement l'écran liste sans jamais toucher au module
  await renderEmployeeDetail({ id: "1" });
  // "retour à la liste" : nouvel appel à renderEmployees(), comme le ferait un clic sur
  // "Retour" ou le bouton précédent du navigateur (même route, même écran)
  await renderEmployees();
  assert.equal(document.querySelector("#dn-emp-search").value, "dupont", "recherche préservée");
  assert.equal(document.querySelector("#dn-emp-mode").value, "tous", "filtre préservé");
});

test("Employés : le changement de session réinitialise l'état (pas de recherche d'un autre compte affichée)", async () => {
  const { window } = setup();
  resetEmployeesState2();
  window.fetch = async () => jsonResp({ items: [], page: 1, pages: 1, total: 0 });
  await renderEmployees();
  document.querySelector("#dn-emp-search").value = "recherche-de-A";
  document.querySelector("#dn-emp-search").dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  const { clearSession, setUser: setUserB } = await import("../../app/static/drh-next/core/session.mjs");
  clearSession();
  setUserB({ username: "autre", authorizedSocieties: ["SOCIETE B"] });
  await renderEmployees();
  assert.equal(document.querySelector("#dn-emp-search").value, "", "aucune recherche de l'ancien compte visible pour le nouveau");
});
