// ATLAS V3 — harnais de test minimal (même patron que tests_frontend/drh-next/dom-env.mjs).
import { JSDOM } from "jsdom";
import { _resetForTests as resetSession } from "../../app/static/core-v3/session.mjs";
import { _resetForTests as resetRouter } from "../../app/static/core-v3/router.mjs";
import { _resetForTests as resetDataLoader } from "../../app/static/core-v3/data-loader.mjs";
import { _resetForTests as resetModuleRegistry } from "../../app/static/core-v3/module-registry.mjs";
import { _resetForTests as resetEvents } from "../../app/static/core-v3/events.mjs";
import { _resetForTests as resetTelemetry } from "../../app/static/core-v3/telemetry.mjs";

export function freshEnv(url = "http://localhost/v3") {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"v3-root\"></div></body></html>", {
    url, runScripts: "outside-only", pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.localStorage = window.localStorage;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.fetch = (...args) => window.fetch(...args);
  // performance.now() : le global natif de Node reste utilisé tel quel (telemetry.mjs
  // l'appelle en global bare) — ne PAS l'aliaser sur window.performance (jsdom), qui
  // provoquerait une récursion infinie sur PerformanceImpl.now() dans cet environnement.

  resetSession();
  resetRouter();
  resetDataLoader();
  resetModuleRegistry();
  resetEvents();
  resetTelemetry();

  return { dom, window };
}

export const tick = () => new Promise(r => setTimeout(r, 0));
