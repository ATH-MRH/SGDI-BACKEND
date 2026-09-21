// ATLAS V3 — modules-v3/drh/employees.mjs
//
// Adapté depuis app/static/drh-next/modules/employees.mjs (LOT 2, déjà audité et testé) —
// pagination SERVEUR exclusive, RBAC/scope déjà garantis backend. INTERDICTION ABSOLUE
// préservée (§7 de la mission) : jamais GET /drh/employees (collection complète), UNIQUEMENT
// GET /drh/employees/page (paginé, 50/page) et GET /drh/employees/{id} (fiche, sur clic).
// Aucun découpage de liste en mémoire côté client, aucun filtre/tri fabriqué que le backend
// n'expose pas réellement (voir commentaire d'audit détaillé dans le fichier source DRH Next).
//
// Différence avec DRH Next : ce module reçoit désormais un CONTENEUR DOM explicite (contrat
// core-v3/module-registry.mjs) plutôt que de cibler un sélecteur fixe "#dn-view" — mount()/
// unmount() suivent le même patron que modules-v3/dashboard/index.mjs.
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { captureRaceContext, isStillValid } from "../../core-v3/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, paginationHTML, initialsAvatarHTML, escapeHTML } from "../../core-v3/ui.mjs";
import { navigate } from "../../core-v3/router.mjs";
import { getSessionGeneration } from "../../core-v3/session.mjs";

const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

let root = null;
let state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() };
let searchDebounceTimer = null;
let listRequestSeq = 0;
let currentListPromise = null;

function employeesListKey() {
  return `drh:employees:page=${state.page}:size=${state.pageSize}:q=${state.q}:mode=${state.mode}`;
}

export function invalidateEmployeesList() { invalidate(/^drh:employees:/); }

export async function mountEmployees(container) {
  root = container;
  if (state.sessionGen !== getSessionGeneration()) {
    state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() };
  }
  root.innerHTML = employeesShellHTML();
  wireStaticControls();
  await loadList();
}

export function unmountEmployees() {
  clearTimeout(searchDebounceTimer);
  if (currentListPromise?.abort) currentListPromise.abort();
  root = null;
}

function employeesShellHTML() {
  return `<div class="dn-page-head"><h1>Employés</h1><p class="dn-error-state-text" style="text-align:left;margin:2px 0 0">Gestion du personnel de la société active</p></div>
  <div class="dn-search-row">
    <input type="search" class="dn-input" id="dn-emp-search" aria-label="Rechercher un employé" placeholder="Rechercher par code, nom, prénom, fonction…" value="${escapeHTML(state.q)}">
    <select class="dn-select" id="dn-emp-mode" aria-label="Filtrer par statut">
      <option value="actifs">Actifs</option>
      <option value="absents">Absents</option>
      <option value="suspension">Suspendus</option>
      <option value="sortants">Sortants</option>
      <option value="tous">Tous</option>
    </select>
    <span class="dn-loading-inline" id="dn-emp-loading-indicator" aria-live="polite"></span>
  </div>
  <div class="dn-card dn-panel" id="dn-emp-results">${skeletonHTML("table")}</div>`;
}

function wireStaticControls() {
  const search = root?.querySelector("#dn-emp-search");
  search?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.q = search.value.trim();
      state.page = 1; // nouvelle recherche -> retour page 1
      loadList();
    }, SEARCH_DEBOUNCE_MS);
  });
  const mode = root?.querySelector("#dn-emp-mode");
  if (mode) mode.value = state.mode;
  mode?.addEventListener("change", () => {
    state.mode = mode.value;
    state.page = 1;
    loadList();
  });
}

async function loadList() {
  if (!root) return;
  const mySeq = ++listRequestSeq;
  const raceCtx = captureRaceContext();
  const indicator = root.querySelector("#dn-emp-loading-indicator");
  if (indicator) indicator.textContent = "Actualisation…";
  if (currentListPromise?.abort) currentListPromise.abort();
  const promise = loadData(employeesListKey(), (signal) => api.get("/drh/employees/page?" + new URLSearchParams({
    page: String(state.page), page_size: String(state.pageSize), q: state.q, mode: state.mode,
  }), { signal }));
  currentListPromise = promise;
  try {
    const data = await promise;
    if (mySeq !== listRequestSeq || !root || !isStillValid(raceCtx)) return; // réponse obsolète
    renderResults(data);
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== listRequestSeq || !root || !isStillValid(raceCtx)) return;
    root.querySelector("#dn-emp-results").innerHTML = errorStateHTML(err, 'data-dn-retry-employees');
    root.querySelector("[data-dn-retry-employees]")?.addEventListener("click", () => loadList());
  } finally {
    if (mySeq === listRequestSeq && root) {
      const ind = root.querySelector("#dn-emp-loading-indicator");
      if (ind) ind.textContent = "";
    }
  }
}

function renderResults(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const results = root.querySelector("#dn-emp-results");
  if (!items.length) {
    results.innerHTML = emptyStateHTML(state.q ? "Aucun employé ne correspond à votre recherche." : "Aucun employé trouvé.");
    return;
  }
  const rows = items.map(rowHTML).join("");
  results.innerHTML = `<div style="overflow-x:auto"><table class="dn-table">
    <thead><tr><th></th><th>Code</th><th>Nom et prénom</th><th>Fonction</th><th>Site actuel</th><th>Contrat</th><th>Statut</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${paginationHTML(data.page, data.pages, data.total, 'data-dn-emp-page')}`;
  results.querySelectorAll("[data-dn-emp-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.hasAttribute("disabled")) return;
      state.page = Number(btn.getAttribute("data-dn-emp-page"));
      loadList();
    });
  });
  results.querySelectorAll("[data-dn-emp-open]").forEach(el => {
    el.addEventListener("click", () => navigate("drh/employees/" + el.getAttribute("data-dn-emp-open")));
  });
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "actif" || s === "active") return "dn-badge-success";
  if (s === "suspendu") return "dn-badge-danger";
  if (s === "absent") return "dn-badge-warning";
  return "dn-badge";
}

function rowHTML(e) {
  const name = `${e.last_name || ""} ${e.first_name || ""}`.trim();
  return `<tr class="dn-table-row-link" data-dn-emp-open="${e.id}">
    <td>${initialsAvatarHTML(e.first_name, e.last_name)}</td>
    <td>${escapeHTML(e.code)}</td>
    <td>${escapeHTML(name)}</td>
    <td>${escapeHTML(e.position || "—")}</td>
    <td>${escapeHTML(e.current_site_name || "—")}</td>
    <td>${escapeHTML(e.contract_type || "—")}</td>
    <td><span class="dn-badge ${statusBadgeClass(e.status)}">${escapeHTML(e.status || "—")}</span></td>
    <td><a class="dn-btn" href="#/drh/employees/${e.id}">Voir</a></td>
  </tr>`;
}

// Chargement partagé d'un employé par ID — même point d'appel unique pour le dossier et
// toute autre fiche minimale, même clé/TTL de cache (jamais deux implémentations qui
// pourraient diverger silencieusement).
export async function loadEmployeeById(id) {
  return loadData(`drh:employee:${id}`, (signal) => api.get(`/drh/employees/${encodeURIComponent(id)}`, { signal }), { ttlMs: 10000 });
}

export function _resetForTests() {
  state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() };
  listRequestSeq = 0; currentListPromise = null; root = null;
}
