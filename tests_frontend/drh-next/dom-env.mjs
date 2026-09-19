// DRH NEXT — harnais de test minimal. Charge une vraie JSDOM et l'assigne aux
// globals Node AVANT chaque test — nécessaire car les modules testés lisent
// `document`/`sessionStorage`/`location` comme des globals de navigateur, pas
// via `window.X`. Les modules core (session/router/data-loader) sont de VRAIS
// singletons en exécution normale (une seule instance dans la page) : on ne
// cherche pas à en obtenir une instance "fraîche" par test (impossible sans
// réécrire tous les imports relatifs internes en cache-busting, ce qui ne
// refléterait plus le comportement réel) — on réinitialise explicitement leur
// état via les fonctions _resetForTests() exportées par chacun, appelées ici.
import { JSDOM } from "jsdom";
import { _resetForTests as resetSession } from "../../app/static/drh-next/core/session.mjs";
import { _resetForTests as resetRouter } from "../../app/static/drh-next/core/router.mjs";
import { _resetForTests as resetDataLoader } from "../../app/static/drh-next/core/data-loader.mjs";

export function freshEnv(url = "http://localhost/drh-next") {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"dn-root\"></div></body></html>", {
    url, runScripts: "outside-only", pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.localStorage = window.localStorage;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
  globalThis.CustomEvent = window.CustomEvent;
  // api.js appelle `fetch(...)` en global bare (comme dans un vrai navigateur, où fetch
  // EST window.fetch) — Node 22 fournit son propre fetch global qui masquerait sinon
  // silencieusement tout mock posé sur window.fetch dans un test. Ce pont délègue
  // toujours au window.fetch COURANT, pour que réassigner window.fetch dans un test
  // prenne effet immédiatement.
  globalThis.fetch = (...args) => window.fetch(...args);

  resetSession();
  resetRouter();
  resetDataLoader();

  return { dom, window };
}

export const tick = () => new Promise(r => setTimeout(r, 0));
