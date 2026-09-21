// ATLAS V3 — core-v3/errors.mjs
//
// Classification et messages utilisateur centralisés pour les erreurs API (§ "errors.mjs"
// de la structure cible demandée). Extrait de la logique auparavant intégrée directement
// dans errorStateHTML (DRH Next core/ui.mjs) pour que TOUT module — pas seulement un
// rendu HTML — puisse classifier une erreur de la même façon (ex: télémétrie, toast,
// log), sans dupliquer les règles.
export { ApiError } from "./api.mjs";

/**
 * @param {Error} err une ApiError (ou toute erreur) à classifier pour l'utilisateur.
 * @returns {{title:string, text:string}}
 */
export function describeError(err) {
  const code = err?.code;
  if (code === "FORBIDDEN") return { title: "Accès refusé", text: "Vous n'avez pas l'autorisation d'accéder à cette ressource." };
  if (code === "NOT_FOUND") return { title: "Ressource introuvable", text: "Cet élément n'existe pas ou plus." };
  if (code === "UNAUTHORIZED") return { title: "Session expirée", text: "Reconnectez-vous pour continuer." };
  if (code === "NETWORK_ERROR" || code === "TIMEOUT") return { title: "Connexion impossible", text: "Vérifiez votre connexion puis réessayez." };
  if (code === "SERVER_ERROR") return { title: "Erreur serveur", text: "Le service est temporairement indisponible. Réessayez dans quelques instants." };
  return { title: "Une erreur est survenue", text: err?.message || "Erreur inconnue." };
}
