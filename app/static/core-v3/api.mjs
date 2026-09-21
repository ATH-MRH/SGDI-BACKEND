// ATLAS V3 — core-v3/api.mjs
//
// Transport HTTP pur, générique (§9 de la mission — cette couche brute reste indépendante
// du domaine ; les modules-v3/*/api.mjs par domaine, quand nécessaire, s'appuient dessus
// plutôt que de construire des URLs à la main dispersées dans le code, comme le fait encore
// Legacy). Aucun cache métier ici — coalescing/TTL/invalidation vivent exclusivement dans
// data-loader.mjs. Adapté sans changement de logique depuis
// app/static/drh-next/core/api.mjs (déjà générique, déjà testé).
import { getToken } from "./session.mjs";

const API_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.code = code || classifyStatus(status);
  }
}

function classifyStatus(status) {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "SERVER_ERROR";
  if (!status) return "NETWORK_ERROR";
  return "API_ERROR";
}

/**
 * @param {string} path chemin relatif à /api (ex: "/drh/dashboard")
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]
 * @param {AbortSignal} [options.signal] signal externe (data-loader peut en fournir un) ;
 *   sinon un timeout interne s'applique.
 */
export async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  const ownController = options.signal ? null : new AbortController();
  const timer = ownController ? setTimeout(() => ownController.abort(), DEFAULT_TIMEOUT_MS) : null;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal || ownController?.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e?.name === "AbortError") {
      const err = new ApiError("Délai dépassé : vérifiez votre connexion puis réessayez.", { code: "TIMEOUT" });
      err.aborted = true;
      throw err;
    }
    throw new ApiError(e?.message || "Erreur réseau", { code: "NETWORK_ERROR" });
  }
  if (timer) clearTimeout(timer);

  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }

  if (!res.ok) {
    const message = (body && (body.detail || body.error || body.message)) || ("Erreur API " + res.status);
    throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), { status: res.status });
  }
  return body;
}

// Contenu binaire (photos/documents authentifiés) : une balise <img>/<a> statique ne joint
// jamais l'en-tête Authorization — seul un fetch() explicite avec le token, suivi d'une URL
// objet locale (URL.createObjectURL), est correct. Jamais l'URL de l'API exposée dans le DOM.
export async function apiFetchBlob(path, options = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch(API_BASE + path, { method: "GET", headers, signal: options.signal, cache: "no-store" });
  } catch (e) {
    throw new ApiError(e?.message || "Erreur réseau", { code: "NETWORK_ERROR" });
  }
  if (!res.ok) {
    let message = "Erreur API " + res.status;
    try { const body = JSON.parse(await res.text()); message = body?.detail || body?.error || message; } catch (e) { /* pas de corps JSON */ }
    throw new ApiError(message, { status: res.status });
  }
  return res.blob();
}

export const api = {
  get: (path, options) => apiFetch(path, { ...options, method: "GET" }),
  post: (path, body, options) => apiFetch(path, { ...options, method: "POST", body }),
  put: (path, body, options) => apiFetch(path, { ...options, method: "PUT", body }),
  delete: (path, options) => apiFetch(path, { ...options, method: "DELETE" }),
  getBlob: (path, options) => apiFetchBlob(path, options),
};
