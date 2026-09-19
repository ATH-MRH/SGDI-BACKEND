// DRH NEXT — modules/_employee-picker.mjs
//
// Sélecteur d'employé réutilisable (LOT 5 : extrait du LOT 4 contracts.mjs, seconde
// consommation immédiate par assignments.mjs — refactor en rapport direct avec ce lot,
// pas un nettoyage général). Recherche via l'UNIQUE endpoint paginé/sécurisé existant
// (/drh/employees/page, mode="tous"), page_size réduite (c'est un sélecteur, pas un
// tableau). Chaque module appelant fournit juste le libellé du lien de destination — la
// logique de recherche/debounce/course/état vide/erreur est écrite une seule fois ici.
import { api } from "../core/api.mjs";
import { loadData } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, mount, escapeHTML } from "../core/ui.mjs";

const SEARCH_DEBOUNCE_MS = 300;
const PICKER_PAGE_SIZE = 10;

/**
 * @param {object} options
 * @param {string} options.viewSelector ex: "#dn-view"
 * @param {string} options.title ex: "Contrats"
 * @param {string} options.subtitle texte expliquant pourquoi c'est un sélecteur, pas une liste
 * @param {string} options.linkTargetHash fonction (employeeId) -> hash de destination
 * @param {string} options.linkLabel ex: "Voir ses contrats"
 * @param {string} options.cacheNamespace clé de cache distincte par module (ex: "contracts-picker")
 */
export function renderEmployeePicker(options) {
  const { viewSelector, title, subtitle, linkTargetHash, linkLabel, cacheNamespace } = options;
  // IDs fixes (non namespacés) : un seul picker est jamais monté à la fois — la route
  // précédente est entièrement remplacée par mount(viewSelector, ...) avant celui-ci.
  const searchId = "dn-picker-search";
  const resultsId = "dn-picker-results";
  mount(viewSelector, `<div class="dn-page-head"><h1>${escapeHTML(title)}</h1><p class="dn-error-state-text" style="text-align:left;margin:2px 0 0">${escapeHTML(subtitle)}</p></div>
    <div class="dn-search-row"><input type="search" class="dn-input" id="${searchId}" aria-label="Rechercher un employé" placeholder="Nom, prénom, code, poste…"></div>
    <div class="dn-card dn-panel" id="${resultsId}">${emptyStateHTML("Tapez un nom, un code ou un poste pour retrouver un employé.")}</div>`);

  let debounceTimer = null;
  let seq = 0;
  const input = document.querySelector(`#${searchId}`);

  async function runSearch(q) {
    mount(`#${resultsId}`, skeletonHTML("table"));
    const mySeq = ++seq;
    const raceCtx = captureRaceContext();
    try {
      const data = await loadData(`drh:${cacheNamespace}:q=${q}`, (signal) => api.get("/drh/employees/page?" + new URLSearchParams({ page: "1", page_size: String(PICKER_PAGE_SIZE), q, mode: "tous" }), { signal }));
      if (mySeq !== seq || !raceContextStillValid(raceCtx)) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) { mount(`#${resultsId}`, emptyStateHTML("Aucun employé ne correspond à cette recherche.")); return; }
      mount(`#${resultsId}`, `<table class="dn-table"><thead><tr><th>Code</th><th>Nom et prénom</th><th>Poste</th><th></th></tr></thead><tbody>
        ${items.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(`${e.last_name || ""} ${e.first_name || ""}`.trim())}</td><td>${escapeHTML(e.position || "—")}</td><td><a class="dn-btn" href="${escapeHTML(linkTargetHash(e.id))}">${escapeHTML(linkLabel)}</a></td></tr>`).join("")}
      </tbody></table>`);
    } catch (err) {
      if (err?.aborted) return;
      if (mySeq !== seq || !raceContextStillValid(raceCtx)) return;
      mount(`#${resultsId}`, errorStateHTML(err, `data-dn-retry-${cacheNamespace}`));
      document.querySelector(`[data-dn-retry-${cacheNamespace}]`)?.addEventListener("click", () => runSearch(q));
    }
  }

  input?.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) { mount(`#${resultsId}`, emptyStateHTML("Tapez un nom, un code ou un poste pour retrouver un employé.")); return; }
    debounceTimer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
  });
}
