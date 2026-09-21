// ATLAS V3 — core-v3/session.mjs
//
// Adapté sans changement de logique depuis app/static/drh-next/core/session.mjs (déjà
// générique, déjà testé, déjà partagé implicitement avec Legacy via la MÊME clé
// sessionStorage). Promu ici pour servir de source de session unique à TOUS les modules V3,
// pas seulement DRH — une session ouverte sur n'importe quelle surface (Legacy, DRH Next,
// V3) reste reconnue partout dans le même navigateur, sans reconnexion ni compte parallèle.
const TOKEN_KEY = "sgdi_api_token_v1";

let user = null;
// Génération de session (§11 de la mission) : incrémentée à CHAQUE changement réel
// d'identité (connexion, déconnexion). Toute tâche asynchrone doit capturer cette valeur
// avant de démarrer et la revérifier avant d'écrire dans un état partagé — voir
// data-loader.mjs (préfixage automatique) et race-guard.mjs (primitive générale).
let sessionGeneration = 0;

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* stockage indisponible (navigation privée...) : session non persistée, pas fatal */ }
}

export function getUser() { return user; }

export function setUser(nextUser) {
  user = nextUser;
  sessionGeneration += 1;
}

export function clearSession() {
  user = null;
  setToken(null);
  sessionGeneration += 1;
}

export function getSessionGeneration() { return sessionGeneration; }

export function isAuthenticated() { return !!(getToken() && user); }

// Réservé aux tests : singleton réel en exécution normale, jamais réinitialisé seul.
export function _resetForTests() { user = null; sessionGeneration = 0; setToken(null); }
