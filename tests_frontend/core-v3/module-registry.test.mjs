import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import * as registry from "../../app/static/core-v3/module-registry.mjs";
import { setUser } from "../../app/static/core-v3/session.mjs";

test("registerModule : exige key/load/mount, rejette un contrat incomplet", () => {
  freshEnv();
  assert.throws(() => registry.registerModule({ key: "x" }), /load\(\) et mount\(\) sont obligatoires/);
  assert.throws(() => registry.registerModule({}), /un objet/);
});

test("loadModule : import() n'est appelé qu'une seule fois, même pour des appels concurrents (dédoublonnage)", async () => {
  freshEnv();
  let loadCalls = 0;
  registry.registerModule({
    key: "dashboard", routes: ["dashboard"],
    load: async () => { loadCalls++; return { mount() {} }; },
    mount: () => {},
  });
  await Promise.all([registry.loadModule("dashboard"), registry.loadModule("dashboard"), registry.loadModule("dashboard")]);
  assert.equal(loadCalls, 1, "un module ne doit jamais être importé deux fois");
});

test("un module jamais chargé : isModuleLoaded reste false tant que loadModule n'a pas été appelé (0 JS métier avant besoin)", () => {
  freshEnv();
  registry.registerModule({ key: "drh", routes: ["drh"], load: async () => ({}), mount: () => {} });
  assert.equal(registry.isModuleLoaded("drh"), false);
});

test("canEnterModule : respecte permissions.mjs (aucun accès accordé sans module autorisé)", () => {
  freshEnv();
  registry.registerModule({ key: "drh", routes: ["drh"], permissions: "drh", load: async () => ({}), mount: () => {} });
  setUser({ role: "rh", authorizedModules: ["ops"] });
  assert.equal(registry.canEnterModule("drh"), false, "sans le module drh dans authorized_modules -> refusé côté affichage");
  setUser({ role: "rh", authorizedModules: ["drh", "ops"] });
  assert.equal(registry.canEnterModule("drh"), true);
});

test("canEnterModule : un module sans permissions déclarées reste accessible (module public)", () => {
  freshEnv();
  registry.registerModule({ key: "dashboard", routes: ["dashboard"], load: async () => ({}), mount: () => {} });
  setUser({ role: "rh", authorizedModules: [] });
  assert.equal(registry.canEnterModule("dashboard"), true);
});

test("deactivateIfChanged : démonte le module actif seulement s'il diffère de la cible", async () => {
  freshEnv();
  let unmountCalls = 0;
  registry.registerModule({ key: "a", routes: ["a"], load: async () => ({}), mount: () => {}, unmount: () => { unmountCalls++; } });
  registry.registerModule({ key: "b", routes: ["b"], load: async () => ({}), mount: () => {} });
  registry.markActive("a");
  await registry.deactivateIfChanged("a"); // même module -> no-op
  assert.equal(unmountCalls, 0);
  await registry.deactivateIfChanged("b"); // module différent -> démonté
  assert.equal(unmountCalls, 1);
});

test("disposeAll : remet à zéro tous les modules chargés (§11 — changement de session)", async () => {
  freshEnv();
  let disposedA = false, disposedB = false;
  registry.registerModule({ key: "a", routes: ["a"], load: async () => ({}), mount: () => {}, dispose: () => { disposedA = true; } });
  registry.registerModule({ key: "b", routes: ["b"], load: async () => ({}), mount: () => {}, unmount: () => { disposedB = true; } }); // pas de dispose dédié -> repli sur unmount
  await registry.loadModule("a");
  await registry.loadModule("b");
  await registry.disposeAll();
  assert.equal(disposedA, true);
  assert.equal(disposedB, true, "sans dispose() dédié, unmount() sert de repli");
  assert.equal(registry.isModuleLoaded("a"), false, "après disposeAll, un module redevient 'jamais chargé'");
  assert.equal(registry.getActiveModule(), null);
});

test("prefetchModule : charge le JS sans jamais appeler mount() (aucune donnée métier déclenchée)", async () => {
  freshEnv();
  let mounted = false;
  registry.registerModule({ key: "ops", routes: ["ops"], load: async () => ({}), mount: () => { mounted = true; } });
  await registry.prefetchModule("ops");
  assert.equal(registry.isModuleLoaded("ops"), true);
  assert.equal(mounted, false, "le préchargement ne doit jamais monter le module (données métier)");
});
