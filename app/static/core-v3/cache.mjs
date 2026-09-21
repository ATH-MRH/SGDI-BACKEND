// ATLAS V3 — core-v3/cache.mjs
//
// Choix architectural délibéré (documenté ici plutôt que silencieux) : le cache court/TTL
// et la déduplication des lectures en vol (coalescing) vivent dans data-loader.mjs, pas
// dans un fichier séparé — les deux sont inséparables en pratique (le cache DOIT être
// préfixé par la même génération de session que le coalescing, sous peine de fuite
// cross-session ; les garder ensemble dans un seul fichier a évité exactement ce bug lors
// de la conception de DRH Next, LOT 2 §7). Ce fichier réexporte les mêmes fonctions sous le
// nom attendu par la structure cible (§4 de la mission), pour qu'un import de
// "./cache.mjs" reste possible sans dupliquer la logique ni risquer une divergence entre
// deux implémentations du même cache.
export { invalidate, clearAllCache, loadData } from "./data-loader.mjs";
