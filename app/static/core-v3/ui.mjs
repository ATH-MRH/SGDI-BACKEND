// ATLAS V3 — core-v3/ui.mjs
//
// États d'écran standardisés (§13/§25 de la mission) : aucun module ne doit inventer son
// propre "Chargement..." statique. skeleton -> contenu, ou skeleton -> erreur + Réessayer.
// Jamais de "Chargement..." indéfiniment silencieux. Adapté depuis
// app/static/drh-next/core/ui.mjs ; la classification d'erreur est maintenant déléguée à
// errors.mjs (séparation demandée par la structure cible), ce fichier reste focalisé sur le
// balisage HTML.
import { describeError } from "./errors.mjs";

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function skeletonHTML(kind = "cards") {
  if (kind === "cards") {
    return `<div class="v3-skeleton-grid" aria-busy="true" aria-label="Chargement">
      ${Array.from({ length: 4 }).map(() => '<div class="v3-skeleton v3-skeleton-card"></div>').join("")}
    </div>`;
  }
  if (kind === "table") {
    return `<div aria-busy="true" aria-label="Chargement">
      ${Array.from({ length: 8 }).map(() => '<div class="v3-skeleton" style="height:40px;margin-bottom:6px"></div>').join("")}
    </div>`;
  }
  return `<div class="v3-skeleton v3-skeleton-block" aria-busy="true" aria-label="Chargement"></div>`;
}

// Pagination toujours server-driven : ce composant ne fait qu'afficher page/pages et
// notifier via onPageAttr, jamais de découpage local d'une liste déjà en mémoire.
export function paginationHTML(page, pages, total, onPageAttrPrefix) {
  if (pages <= 1) return "";
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= pages ? "disabled" : "";
  return `<div class="v3-pagination">
    <span class="v3-error-state-text" style="margin:0 8px 0 0">${total} résultat(s) · page ${page}/${pages}</span>
    <button type="button" class="v3-btn" ${prevDisabled} ${onPageAttrPrefix}="${page - 1}">← Précédent</button>
    <button type="button" class="v3-btn" ${nextDisabled} ${onPageAttrPrefix}="${page + 1}">Suivant →</button>
  </div>`;
}

export function initialsAvatarHTML(firstName, lastName) {
  const initials = ((firstName || "")[0] || "") + ((lastName || "")[0] || "");
  return `<div class="v3-avatar" aria-hidden="true">${escapeHTML(initials.toUpperCase() || "?")}</div>`;
}

/**
 * @param {Error} err
 * @param {string} [retryAttr] attribut HTML déclenchant un nouvel essai (ex: data-v3-retry="dashboard")
 */
export function errorStateHTML(err, retryAttr) {
  const { title, text } = describeError(err);
  const retryBtn = retryAttr ? `<button type="button" class="v3-btn v3-btn-primary" ${retryAttr}>Réessayer</button>` : "";
  return `<div class="v3-error-state">
    <div class="v3-error-state-title">${escapeHTML(title)}</div>
    <div class="v3-error-state-text">${escapeHTML(text)}</div>
    ${retryBtn}
  </div>`;
}

export function emptyStateHTML(text) {
  return `<div class="v3-empty-state">${escapeHTML(text)}</div>`;
}

export function mount(selector, html) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = html;
  return el;
}
