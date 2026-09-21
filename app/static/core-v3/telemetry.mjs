// ATLAS V3 — core-v3/telemetry.mjs
//
// Métriques frontend minimales (§24 de la mission) : durée de bootstrap, durée de route,
// durée d'appel API, durée de chargement de module, durée de rendu, taille de payload
// estimée, erreurs. AUCUNE donnée personnelle — jamais un nom, un identifiant employé, un
// contenu métier ; uniquement des durées, des clés de route/module et des compteurs. Stocke
// en mémoire (dernier N évènements) ; l'envoi vers un backend d'observabilité, s'il est un
// jour ajouté, sera une décision séparée et explicite — ce module ne transmet rien seul.
const MAX_EVENTS = 500;
const events = [];

function record(type, payload) {
  events.push({ type, at: Date.now(), ...payload });
  if (events.length > MAX_EVENTS) events.shift();
}

export function recordBootstrap(durationMs) { record("bootstrap", { durationMs }); }
export function recordRoute(routeKey, durationMs) { record("route", { routeKey, durationMs }); }
export function recordApi(path, durationMs, status) { record("api", { path, durationMs, status }); }
export function recordModuleLoad(moduleKey, durationMs) { record("module_load", { moduleKey, durationMs }); }
export function recordRender(moduleKey, durationMs) { record("render", { moduleKey, durationMs }); }
export function recordPayloadEstimate(routeKey, bytes) { record("payload", { routeKey, bytes }); }
export function recordError(context, message) { record("error", { context, message: String(message || "").slice(0, 300) }); }

/** Chronomètre une opération asynchrone et enregistre sa durée sous le type donné. */
export async function time(type, key, fn) {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - t0;
    if (type === "route") recordRoute(key, durationMs);
    else if (type === "api") recordApi(key, durationMs);
    else if (type === "module_load") recordModuleLoad(key, durationMs);
    else if (type === "render") recordRender(key, durationMs);
  }
}

export function getEvents() { return [...events]; }

// Réservé aux tests.
export function _resetForTests() { events.length = 0; }
