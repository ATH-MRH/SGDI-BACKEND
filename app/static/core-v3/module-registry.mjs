// ATLAS V3 — core-v3/module-registry.mjs
//
// Registre de modules V3, basé sur import() ES natif (§21 de la mission) — distinct du
// module-registry.js Legacy (scripts classiques injectés par <script src>, conservé tel
// quel pour les modules non encore migrés, voir legacy-bridge.mjs). Un module jamais
// visité : 0 JS métier chargé (le fichier .mjs n'est même pas récupéré tant que load()
// n'a pas été appelé).
//
// Contrat de module V3 (§5) :
//   key           identifiant unique (ex: "dashboard", "drh")
//   routes        racines de route gérées par ce module (ex: ["dashboard"])
//   permissions   clé de module pour permissions.mjs::canAccessModule, ou null si public
//   load          () => import("./modules-v3/xxx/index.mjs") — jamais appelé avant besoin
//   mount         (container, params) => void|Promise — rendu initial de la route
//   unmount       () => void — nettoyage au départ de la route (écouteurs, timers locaux)
//   dispose       () => void — remise à zéro complète (changement de session) ; par défaut
//                 identique à unmount si non fourni séparément
// Optionnel :
//   prefetch      () => Promise — précharge UNIQUEMENT le JS (jamais les données métier,
//                 voir §11 de la mission DRH Performance V2/prefetch intelligent déjà établi)
//   invalidate    (reason) => void — invalide l'état/cache propre à ce module
//
// Aucun module ne doit dépendre implicitement d'une fonction globale déclarée dans
// sgdi-app.js — toute communication inter-module passe par events.mjs ou par les données
// serveur elles-mêmes, jamais par un appel direct à une fonction d'un autre module.
import { canAccessModule } from "./permissions.mjs";

const registry = new Map(); // key -> definition
const routeIndex = new Map(); // route root -> key
const loadedImpl = new Map(); // key -> Promise<module implementation>
let activeKey = null;

export function registerModule(def) {
  if (!def || typeof def !== "object" || !def.key) {
    throw new Error("registerModule: un objet { key, routes, load, mount } est requis");
  }
  if (typeof def.load !== "function" || typeof def.mount !== "function") {
    throw new Error(`registerModule("${def.key}"): load() et mount() sont obligatoires`);
  }
  registry.set(def.key, def);
  for (const route of def.routes || []) routeIndex.set(route, def.key);
  return def;
}

export function moduleKeyForRoute(root) {
  return routeIndex.get(root) || null;
}

export function getModule(key) {
  return registry.get(key) || null;
}

export function canEnterModule(key) {
  const def = registry.get(key);
  if (!def) return false;
  if (!def.permissions) return true;
  return canAccessModule(def.permissions, def.permissionAliases || []);
}

// Charge l'implémentation (import() réel) UNE SEULE FOIS par clé, quel que soit le nombre
// d'appels concurrents — même patron de déduplication que data-loader.mjs.
export function loadModule(key) {
  const def = registry.get(key);
  if (!def) return Promise.reject(new Error(`Module V3 inconnu : "${key}"`));
  if (!loadedImpl.has(key)) loadedImpl.set(key, Promise.resolve(def.load()));
  return loadedImpl.get(key);
}

export function isModuleLoaded(key) {
  return loadedImpl.has(key);
}

/** Précharge le JS d'un module SANS jamais déclencher ses propres données métier — à
 * n'appeler que depuis un contexte idle (requestIdleCallback), jamais au bootstrap. */
export function prefetchModule(key) {
  const def = registry.get(key);
  if (!def || loadedImpl.has(key)) return Promise.resolve();
  return loadModule(key);
}

/** Démonte le module actif s'il diffère de la cible. no-op si identique ou aucun actif. */
export async function deactivateIfChanged(nextKey) {
  if (activeKey && activeKey !== nextKey) {
    const def = registry.get(activeKey);
    try { await def?.unmount?.(); } catch (e) { console.error(`Échec du démontage du module "${activeKey}"`, e); }
  }
}

export function markActive(key) {
  activeKey = key;
}

export function getActiveModule() {
  return activeKey;
}

/** Dispose TOUS les modules actuellement chargés (§11 — changement de session). */
export async function disposeAll() {
  for (const [key, def] of registry) {
    if (!loadedImpl.has(key)) continue;
    try { await (def.dispose || def.unmount)?.(); } catch (e) { console.error(`Échec de la remise à zéro du module "${key}"`, e); }
  }
  loadedImpl.clear();
  activeKey = null;
}

// Réservé aux tests.
export function _resetForTests() {
  registry.clear(); routeIndex.clear(); loadedImpl.clear(); activeKey = null;
}
