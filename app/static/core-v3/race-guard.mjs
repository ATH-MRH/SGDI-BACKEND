// ATLAS V3 — core-v3/race-guard.mjs
//
// Primitive générale de garde anti-obsolescence (§8/§10/§29 de la mission), distincte de
// data-loader.mjs : celui-ci protège la LECTURE réseau elle-même (coalescing/cache/retry) ;
// race-guard.mjs protège la DÉCISION D'ÉCRIRE une réponse déjà reçue dans le DOM/état
// partagé — utile aussi pour des opérations async qui ne passent pas par data-loader (ex.
// import() d'un module paresseux, mutation suivie d'un re-rendu). Même patron déjà prouvé
// côté Legacy (sgdiCaptureRaceContext/sgdiRaceContextStillValid, utilisé pour le portillon
// de chargement de module Phase 2A) et côté DRH Next (sessionGeneration + navigationGeneration
// vérifiés avant tout rendu) — formalisé ici comme primitive explicite et réutilisable par
// tout module V3, plutôt que réimplémenté à la main dans chacun.
import { getSessionGeneration } from "./session.mjs";
import { getNavigationGeneration } from "./router.mjs";

/**
 * Capture le contexte de fraîcheur courant (session + navigation) AVANT de démarrer une
 * opération asynchrone. À revérifier via isStillValid() avant toute écriture DOM/état.
 * @returns {{sessionGeneration:number, navigationGeneration:number}}
 */
export function captureRaceContext() {
  return {
    sessionGeneration: getSessionGeneration(),
    navigationGeneration: getNavigationGeneration(),
  };
}

/**
 * @param {{sessionGeneration:number, navigationGeneration:number}} context capturé avant
 * @param {object} [options]
 * @param {boolean} [options.navigation=true] vérifier aussi la génération de navigation
 *   (mettre à false pour un appelant dont le résultat n'est pas lié à la route affichée,
 *   ex. un rafraîchissement de compteur en arrière-plan).
 */
export function isStillValid(context, options = {}) {
  const checkNavigation = options.navigation !== false;
  if (context.sessionGeneration !== getSessionGeneration()) return false;
  if (checkNavigation && context.navigationGeneration !== getNavigationGeneration()) return false;
  return true;
}
