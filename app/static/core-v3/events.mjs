// ATLAS V3 — core-v3/events.mjs
//
// Bus d'évènements minimal (§5/§11 de la mission — "aucun module ne doit dépendre
// implicitement d'une fonction globale déclarée dans sgdi-app.js"). Remplace le patron
// Legacy où un module notifie un autre en appelant directement sa fonction globale (ex.
// renderView(), sgdiAutoRender()) : un module V3 publie un évènement, les modules
// intéressés s'y abonnent explicitement — couplage par contrat, pas par nom de fonction.
//
// Évènements de plateforme déjà utilisés par bootstrap.mjs/module-registry.mjs :
//   "session:changed"    { user } — après login/logout/expiration.
//   "route:changed"      { path, params } — après un changement de route réel.
//   "module:mounted"     { key } — après le montage réussi d'un module.
//   "module:unmounted"   { key } — après dispose() d'un module.
const listeners = new Map(); // eventName -> Set<handler>

export function on(eventName, handler) {
  if (!listeners.has(eventName)) listeners.set(eventName, new Set());
  listeners.get(eventName).add(handler);
  return () => off(eventName, handler);
}

export function off(eventName, handler) {
  listeners.get(eventName)?.delete(handler);
}

export function emit(eventName, detail) {
  const set = listeners.get(eventName);
  if (!set) return;
  // Copie défensive : un handler qui se désabonne pendant l'itération ne doit jamais
  // perturber la diffusion aux autres abonnés de ce même tour.
  for (const handler of [...set]) {
    try { handler(detail); } catch (e) { console.error(`[events] handler pour "${eventName}" a levé`, e); }
  }
}

// Réservé aux tests.
export function _resetForTests() { listeners.clear(); }
