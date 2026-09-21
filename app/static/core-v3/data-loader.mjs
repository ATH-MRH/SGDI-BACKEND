// ATLAS V3 — core-v3/data-loader.mjs
//
// Primitive commune (§8 de la mission) pour toute lecture de données depuis un module :
// requête par clé, coalescing (deux appelants simultanés partagent la même requête réseau),
// cache court optionnel (TTL), invalidation, AbortController, retry sur échec transitoire
// uniquement. Le contrôle de fraîcheur (session/navigation) pour la DÉCISION DE RENDU reste
// délibérément laissé au CONSOMMATEUR via race-guard.mjs — data-loader.mjs ne décide jamais
// lui-même qu'une réponse doit être jetée du DOM, il fournit la donnée et laisse l'appelant
// vérifier avant d'écrire dans le DOM/état.
//
// Clé conceptuelle (§8) : session + module + ressource + paramètres. En pratique, la
// génération de session est préfixée AUTOMATIQUEMENT ici (une seule fois, pour tous les
// appelants présents et futurs — jamais de fuite cross-session possible par oubli d'un
// module) ; société/site/module/ressource/paramètres font partie de la clé LOGIQUE fournie
// par l'appelant (ex: "drh:dashboard:SOCIETE_X"), pas de champs séparés — même patron déjà
// prouvé par sgdiDrhReadContext() côté Legacy. Adapté sans changement de logique depuis
// app/static/drh-next/core/data-loader.mjs.
import { ApiError } from "./api.mjs";
import { getSessionGeneration } from "./session.mjs";

const inFlight = new Map(); // internalKey (préfixée session) -> Promise
const cache = new Map(); // internalKey (préfixée session) -> { value, expiresAt }

function internalKey(key) {
  return `s${getSessionGeneration()}:${key}`;
}

function isRetryable(err) {
  if (!(err instanceof ApiError)) return true;
  return err.code === "NETWORK_ERROR" || err.code === "TIMEOUT" || err.code === "SERVER_ERROR";
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * @param {string} key clé de cache/coalescing (ex: "drh:dashboard:SOCIETE_X")
 * @param {(signal: AbortSignal) => Promise<any>} loaderFn
 * @param {object} [options]
 * @param {number} [options.ttlMs=0] durée de fraîcheur du cache court (0 = pas de cache)
 * @param {number} [options.retry=1] tentatives supplémentaires sur échec transitoire
 * @param {number} [options.retryDelayMs=400]
 */
export function loadData(key, loaderFn, options = {}) {
  const { ttlMs = 0, retry = 1, retryDelayMs = 400 } = options;
  const ikey = internalKey(key);

  if (ttlMs > 0) {
    const cached = cache.get(ikey);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  }
  if (inFlight.has(ikey)) return inFlight.get(ikey);

  const controller = new AbortController();
  const run = async (attempt) => {
    try {
      const value = await loaderFn(controller.signal);
      // Une session différente au moment où la réponse arrive ne doit jamais alimenter le
      // cache de la nouvelle session (ikey a changé de préfixe entre-temps).
      if (ttlMs > 0 && internalKey(key) === ikey) cache.set(ikey, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      if (attempt < retry && isRetryable(err) && !controller.signal.aborted) {
        await sleep(retryDelayMs * (attempt + 1));
        return run(attempt + 1);
      }
      throw err;
    }
  };

  const promise = run(0).finally(() => { inFlight.delete(ikey); });
  promise.abort = () => controller.abort();
  inFlight.set(ikey, promise);
  return promise;
}

/** @param {string|RegExp} keyOrPrefix une clé exacte, ou un préfixe si un RegExp est fourni —
 *  toujours relatif à la clé LOGIQUE fournie par l'appelant (sans le préfixe de génération de
 *  session, ajouté et retiré ici de façon transparente). */
export function invalidate(keyOrPrefix) {
  const currentPrefix = `s${getSessionGeneration()}:`;
  if (keyOrPrefix instanceof RegExp) {
    for (const k of cache.keys()) {
      if (!k.startsWith(currentPrefix)) continue;
      if (keyOrPrefix.test(k.slice(currentPrefix.length))) cache.delete(k);
    }
    return;
  }
  cache.delete(currentPrefix + keyOrPrefix);
}

export function clearAllCache() { cache.clear(); }

// Réservé aux tests.
export function _resetForTests() { inFlight.clear(); cache.clear(); }
