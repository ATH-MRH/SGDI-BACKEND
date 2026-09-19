// DRH NEXT — core/data-loader.js
//
// Primitive commune pour toute lecture de données depuis un module : requête
// par clé, coalescing (deux appelants simultanés partagent la même requête
// réseau), cache court optionnel, invalidation, AbortController, retry sur
// échec transitoire uniquement. Le contrôle de fraîcheur (session/navigation)
// est délibérément laissé au CONSOMMATEUR via race-guard.js — data-loader.js
// ne décide jamais lui-même qu'une réponse doit être jetée, il fournit la
// donnée et laisse l'appelant vérifier avant d'écrire dans le DOM/état,
// exactement le patron déjà établi côté Legacy (LOT REFACTOR V1).
import { ApiError } from "./api.mjs";

const inFlight = new Map(); // key -> Promise
const cache = new Map(); // key -> { value, expiresAt }

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

  if (ttlMs > 0) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const controller = new AbortController();
  const run = async (attempt) => {
    try {
      const value = await loaderFn(controller.signal);
      if (ttlMs > 0) cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      if (attempt < retry && isRetryable(err) && !controller.signal.aborted) {
        await sleep(retryDelayMs * (attempt + 1));
        return run(attempt + 1);
      }
      throw err;
    }
  };

  const promise = run(0).finally(() => { inFlight.delete(key); });
  promise.abort = () => controller.abort();
  inFlight.set(key, promise);
  return promise;
}

/** @param {string|RegExp} keyOrPrefix une clé exacte, ou un préfixe si un RegExp est fourni */
export function invalidate(keyOrPrefix) {
  if (keyOrPrefix instanceof RegExp) {
    for (const k of cache.keys()) if (keyOrPrefix.test(k)) cache.delete(k);
    return;
  }
  cache.delete(keyOrPrefix);
}

export function clearAllCache() { cache.clear(); }

// Réservé aux tests — voir session.js pour la même remarque sur les singletons réels.
export function _resetForTests() { inFlight.clear(); cache.clear(); }
