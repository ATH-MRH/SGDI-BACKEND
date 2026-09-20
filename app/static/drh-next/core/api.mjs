// DRH NEXT — core/api.js
//
// Transport HTTP pur. Aucun cache métier ici (voir §11 de l'audit REFACTOR V1 :
// "sgdiApi ne doit pas devenir un cache métier" — même principe appliqué dès
// la conception ici, pas migré après coup). Le cache/coalescing vit exclusivement
// dans data-loader.js.
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

// P0 sécurité (fermeture DRH-NEXT-DOC-URL-AUTH) : apiFetch() ci-dessus ne convient pas au
// contenu binaire — il parse systématiquement la réponse comme JSON. Une balise <img>/<a>
// statique pointant directement sur une route authentifiée ne fonctionnerait pas non plus
// (le navigateur n'y joint jamais l'en-tête Authorization) : le seul moyen correct est un
// fetch() explicite avec le token, puis une URL objet locale (URL.createObjectURL) — jamais
// l'URL de l'API elle-même exposée dans le DOM en tant que src/href.
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
    try { const body = JSON.parse(await res.text()); message = body?.detail || body?.error || message; } catch (e) { /* pas de corps JSON, message par défaut conservé */ }
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
