// DRH NEXT — core/race-guard.js
//
// Même principe que LOT REFACTOR V1 (Legacy, sgdiCaptureRaceContext /
// sgdiRaceContextStillValid) : capturer un contexte AVANT une tâche async,
// le revérifier AVANT toute écriture dans un état partagé (DOM, cache). Pas
// de dépendance de code vers sgdi-app.js — deux codebases séparées, un seul
// principe partagé, réimplémenté indépendamment (pas d'import cross-app).
import { getSessionGeneration } from "./session.mjs";
import { getNavigationGeneration } from "./router.mjs";

/**
 * @param {object} [options]
 * @param {boolean} [options.navigation=true] mettre à false pour une tâche dont le
 *   résultat n'est pas lié à l'écran affiché (ex: une donnée réutilisable au-delà
 *   de la route courante) — seul un changement de SESSION doit alors invalider.
 */
export function captureRaceContext(options = {}) {
  return {
    sessionGen: getSessionGeneration(),
    navGen: options.navigation === false ? null : getNavigationGeneration(),
  };
}

export function raceContextStillValid(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (ctx.sessionGen !== getSessionGeneration()) return false;
  if (ctx.navGen !== null && ctx.navGen !== getNavigationGeneration()) return false;
  return true;
}
