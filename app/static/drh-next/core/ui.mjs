// DRH NEXT — core/ui.js
//
// États d'écran standardisés (§19/§20 du lot) : aucun module ne doit inventer
// son propre "Chargement..." statique. skeleton -> contenu, ou skeleton ->
// erreur + Réessayer. Jamais de "Chargement..." indéfiniment silencieux.
export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function skeletonHTML(kind = "cards") {
  if (kind === "cards") {
    return `<div class="dn-skeleton-grid" aria-busy="true" aria-label="Chargement">
      ${Array.from({ length: 4 }).map(() => '<div class="dn-skeleton dn-skeleton-card"></div>').join("")}
    </div>`;
  }
  return `<div class="dn-skeleton dn-skeleton-block" aria-busy="true" aria-label="Chargement"></div>`;
}

/**
 * @param {Error} err
 * @param {() => void} onRetry
 */
export function errorStateHTML(err, retryAttr) {
  const status = err?.status;
  let title = "Une erreur est survenue";
  let text = err?.message || "Erreur inconnue.";
  if (err?.code === "FORBIDDEN") { title = "Accès refusé"; text = "Vous n'avez pas l'autorisation d'accéder à cette ressource."; }
  else if (err?.code === "NOT_FOUND") { title = "Ressource introuvable"; text = "Cet élément n'existe pas ou plus."; }
  else if (err?.code === "UNAUTHORIZED") { title = "Session expirée"; text = "Reconnectez-vous pour continuer."; }
  else if (err?.code === "NETWORK_ERROR" || err?.code === "TIMEOUT") { title = "Connexion impossible"; text = "Vérifiez votre connexion puis réessayez."; }
  else if (err?.code === "SERVER_ERROR") { title = "Erreur serveur"; text = "Le service est temporairement indisponible. Réessayez dans quelques instants."; }
  const retryBtn = retryAttr ? `<button type="button" class="dn-btn dn-btn-primary" ${retryAttr}>Réessayer</button>` : "";
  return `<div class="dn-error-state">
    <div class="dn-error-state-title">${escapeHTML(title)}</div>
    <div class="dn-error-state-text">${escapeHTML(text)}</div>
    ${retryBtn}
  </div>`;
}

export function emptyStateHTML(text) {
  return `<div class="dn-empty-state">${escapeHTML(text)}</div>`;
}

export function mount(selector, html) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = html;
  return el;
}
