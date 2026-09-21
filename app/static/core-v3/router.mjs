// ATLAS V3 — core-v3/router.mjs
//
// Routeur minimal par hash (§10 de la mission). navigationGeneration s'incrémente sur
// chaque changement RÉEL de hash (jamais sur une même route rejouée) — même invariant que
// sgdiViewRenderGeneration côté Legacy, réimplémenté indépendamment (pas de dépendance
// runtime vers sgdi-app.js). data-loader.mjs/race-guard.mjs s'appuient dessus pour ignorer
// une réponse devenue obsolète après une navigation. Adapté sans changement de logique
// depuis app/static/drh-next/core/router.mjs.
let routes = [];
let notFoundHandler = null;
let currentHash = "";
let navigationGeneration = 0;
let currentParams = {};

export function registerRoute(pattern, handler) {
  // pattern : segments séparés par "/", un segment ":id" capture une valeur.
  const parts = pattern.split("/").filter(Boolean);
  routes.push({ parts, handler });
}

export function registerNotFound(handler) {
  notFoundHandler = handler;
}

function matchRoute(hash) {
  const path = hash.replace(/^#\/?/, "");
  const segments = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i++) {
      const part = route.parts[i];
      if (part.startsWith(":")) params[part.slice(1)] = segments[i];
      else if (part !== segments[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function getNavigationGeneration() { return navigationGeneration; }
export function getCurrentParams() { return currentParams; }

async function dispatch() {
  const hash = location.hash || "#/dashboard";
  if (hash !== currentHash) {
    currentHash = hash;
    navigationGeneration += 1;
  }
  const match = matchRoute(hash);
  if (!match) {
    currentParams = {};
    if (notFoundHandler) notFoundHandler();
    return;
  }
  currentParams = match.params;
  await match.route.handler(match.params);
}

export function navigate(path) {
  const hash = "#/" + String(path || "").replace(/^#\/?/, "");
  if (location.hash === hash) { dispatch(); return; } // même route : forcer un rendu, pas une navigation
  location.hash = hash;
}

export function startRouter() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}

// Réservé aux tests.
export function _resetForTests() {
  routes = []; notFoundHandler = null; currentHash = ""; navigationGeneration = 0; currentParams = {};
}
