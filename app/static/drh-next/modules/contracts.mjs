// DRH NEXT — modules/contracts.mjs
//
// LOT 4 : écran "Contrats" de la navigation principale.
//
// Audit backend (avant tout code, app/modules/drh/routes.py::contracts) :
//   GET /drh/contracts?employee_id=&status=  → response_model=list[ContractOut]
// AUCUNE pagination (pas de page/page_size, contrairement à /employees/page). Sans
// employee_id, le backend retourne TOUS les contrats accessibles au périmètre de
// l'utilisateur (_filter_employee_owned_rows), potentiellement des milliers de lignes —
// exactement le type de "requête massive" que la mission interdit. Il n'existe donc
// AUCUNE capacité backend pour un tableau "tous les contrats de la société, paginé,
// trié" : le construire côté client en découpant une réponse non bornée reviendrait à
// fabriquer une pagination fictive ET à télécharger une collection complète — interdit
// deux fois (LOT 2 §"aucun full", LOT 4 "ne reconstruis pas une logique métier").
//
// Décision : cet écran reste EMPLOYÉ-CENTRÉ. Rechercher un employé (même endpoint
// paginé/sécurisé que l'annuaire LOT 2, page_size réduite car c'est un sélecteur, pas
// un tableau) puis atteindre ses contrats via le Dossier 360° (LOT 3, onglet Contrats,
// lui-même appelé avec ?employee_id= borné). Aucune nouvelle route contrat n'est créée :
// le lien pointe simplement vers #/employees/{id} déjà construit et testé au LOT 3.
//
// Dette documentée (non corrigée ici, hors périmètre frontend) : DRH-NEXT-CONTRACTS-PAGE
// — un futur GET /drh/contracts/page paginé côté backend permettrait un vrai tableau
// "tous les contrats" ; sans lui, cet écran reste volontairement un sélecteur.
import { api } from "../core/api.mjs";
import { loadData } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, mount, escapeHTML } from "../core/ui.mjs";

const VIEW_SELECTOR = "#dn-view";
const SEARCH_DEBOUNCE_MS = 300;
const PICKER_PAGE_SIZE = 10;

let searchDebounceTimer = null;
let searchSeq = 0;

export async function renderContracts() {
  mount(VIEW_SELECTOR, shellHTML());
  wireSearch();
}

function shellHTML() {
  return `<div class="dn-page-head"><h1>Contrats</h1><p class="dn-error-state-text" style="text-align:left;margin:2px 0 0">Recherchez un employé pour consulter ses contrats (aucune liste globale : le backend ne fournit pas de contrats paginés indépendamment d'un employé).</p></div>
  <div class="dn-search-row">
    <input type="search" class="dn-input" id="dn-contracts-search" aria-label="Rechercher un employé" placeholder="Nom, prénom, code, poste…">
  </div>
  <div class="dn-card dn-panel" id="dn-contracts-results">${emptyStateHTML("Tapez un nom, un code ou un poste pour retrouver un employé.")}</div>`;
}

function wireSearch() {
  const input = document.querySelector("#dn-contracts-search");
  input?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const q = input.value.trim();
    if (!q) { mount("#dn-contracts-results", emptyStateHTML("Tapez un nom, un code ou un poste pour retrouver un employé.")); return; }
    searchDebounceTimer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
  });
}

async function runSearch(q) {
  mount("#dn-contracts-results", skeletonHTML("table"));
  const mySeq = ++searchSeq;
  const raceCtx = captureRaceContext();
  try {
    const data = await loadData(`drh:contracts-picker:q=${q}`, (signal) => api.get("/drh/employees/page?" + new URLSearchParams({ page: "1", page_size: String(PICKER_PAGE_SIZE), q, mode: "tous" }), { signal }));
    if (mySeq !== searchSeq || !raceContextStillValid(raceCtx)) return;
    renderResults(data);
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== searchSeq || !raceContextStillValid(raceCtx)) return;
    mount("#dn-contracts-results", errorStateHTML(err, 'data-dn-retry-contracts-search'));
    document.querySelector("[data-dn-retry-contracts-search]")?.addEventListener("click", () => runSearch(q));
  }
}

function renderResults(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) { mount("#dn-contracts-results", emptyStateHTML("Aucun employé ne correspond à cette recherche.")); return; }
  mount("#dn-contracts-results", `<table class="dn-table"><thead><tr><th>Code</th><th>Nom et prénom</th><th>Poste</th><th></th></tr></thead><tbody>
    ${items.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(`${e.last_name || ""} ${e.first_name || ""}`.trim())}</td><td>${escapeHTML(e.position || "—")}</td><td><a class="dn-btn" href="#/employees/${e.id}">Voir ses contrats</a></td></tr>`).join("")}
  </tbody></table>`);
}
