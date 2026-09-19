// DRH NEXT — core/session.js
//
// Aucune auth parallèle : même clé sessionStorage que l'ancien frontend
// (sgdi_api_token_v1), pour qu'une session déjà ouverte sur drh.irongs.com
// dans le même navigateur soit reconnue directement ici, sans reconnexion.
// La session existante reste la référence unique — ce module ne fait que la
// lire/écrire, jamais de logique d'autorisation ici (voir permissions.js).
const TOKEN_KEY = "sgdi_api_token_v1";

let user = null;
// Génération de session (inspirée de R1, LOT REFACTOR V1) : incrémentée à
// chaque changement RÉEL d'identité (connexion, déconnexion). Toute tâche
// asynchrone doit capturer cette valeur avant de démarrer et la revérifier
// avant d'écrire dans un état partagé — voir data-loader.js.
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

// Réservé aux tests : ce module est un singleton réel en exécution normale (une
// seule instance dans la page), donc son état ne se réinitialise jamais tout seul
// entre deux tests qui l'importent — jamais appelé par l'application elle-même.
export function _resetForTests() { user = null; sessionGeneration = 0; setToken(null); }
