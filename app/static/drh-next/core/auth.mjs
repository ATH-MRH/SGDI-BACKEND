// DRH NEXT — core/auth.js
//
// Réutilise l'authentification existante (/api/auth/login, /api/auth/me) :
// aucun compte, token ou table parallèle. Un login échoué ne touche jamais
// la session (voir setUser/clearSession dans session.js — cohérent avec
// LOT REFACTOR V1 §3, ré-appliqué ici dès la conception).
import { api, ApiError } from "./api.mjs";
import { getToken, setToken, setUser, clearSession, getUser } from "./session.mjs";

export async function login(username, password) {
  const res = await api.post("/auth/login", { username, password });
  const token = res?.access_token || res?.token;
  if (!token) throw new ApiError("Réponse de connexion invalide", { code: "API_ERROR" });
  setToken(token);
  const user = res?.user || res;
  setUser(normalizeUser(user));
  return getUser();
}

export async function restoreSession() {
  if (!getToken()) return null;
  try {
    const me = await api.get("/auth/me");
    setUser(normalizeUser(me));
    return getUser();
  } catch (e) {
    // Token présent mais invalide/expiré : on nettoie, pas de faux positif "connecté".
    clearSession();
    return null;
  }
}

export function logout() {
  clearSession();
}

function normalizeUser(raw) {
  if (!raw) return null;
  return {
    username: raw.username,
    fullName: raw.full_name || raw.username,
    role: raw.role || "",
    accessLevel: raw.access_level || raw.niveau || "",
    authorizedModules: raw.authorized_modules,
    effectiveModules: raw.effective_modules || [],
    moduleAccessGlobal: raw.module_access_global === true,
    authorizedStructures: Array.isArray(raw.authorized_structures) ? raw.authorized_structures : [],
    authorizedSocieties: Array.isArray(raw.authorized_societies) ? raw.authorized_societies : [],
    authorizedSites: Array.isArray(raw.authorized_sites) ? raw.authorized_sites : [],
  };
}
