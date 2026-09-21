import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import * as raceGuard from "../../app/static/core-v3/race-guard.mjs";
import * as router from "../../app/static/core-v3/router.mjs";
import { setUser, clearSession } from "../../app/static/core-v3/session.mjs";
import { on, emit, off } from "../../app/static/core-v3/events.mjs";

test("race-guard : un contexte capturé avant un changement de session devient invalide", () => {
  freshEnv();
  setUser({ role: "rh" });
  const ctx = raceGuard.captureRaceContext();
  assert.equal(raceGuard.isStillValid(ctx), true);
  clearSession(); // nouvelle génération de session
  assert.equal(raceGuard.isStillValid(ctx), false, "une réponse tardive d'une session révolue ne doit jamais être considérée valide");
});

test("race-guard : un contexte capturé avant une navigation réelle devient invalide (sauf option navigation:false)", async () => {
  const { window } = freshEnv();
  router.registerRoute("a", () => {});
  router.registerRoute("b", () => {});
  router.startRouter();
  await tick();
  const ctx = raceGuard.captureRaceContext();
  router.navigate("b");
  await tick();
  assert.equal(raceGuard.isStillValid(ctx), false, "une navigation réelle invalide un contexte lié à la route affichée");
  assert.equal(raceGuard.isStillValid(ctx, { navigation: false }), true, "un appelant indépendant de la route (ex: rafraîchissement compteur) n'est pas affecté");
});

test("events : emit ne notifie que les abonnés de l'évènement exact, jamais les autres", () => {
  freshEnv();
  const seenA = [], seenB = [];
  on("session:changed", (d) => seenA.push(d));
  on("route:changed", (d) => seenB.push(d));
  emit("session:changed", { user: { username: "x" } });
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 0);
});

test("events : off désabonne proprement, un handler qui lève n'empêche pas les autres de recevoir l'évènement", () => {
  freshEnv();
  let called = 0;
  const unsubscribe = on("route:changed", () => { throw new Error("handler cassé"); });
  on("route:changed", () => { called++; });
  emit("route:changed", {});
  assert.equal(called, 1, "un handler qui lève ne doit jamais bloquer les autres abonnés");
  off("route:changed", () => {}); // handler différent, no-op attendu (pas d'erreur)
  unsubscribe();
});
