import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv } from "./dom-env.mjs";
import { canAccessModule, canValidateSensitiveActions } from "../../app/static/core-v3/permissions.mjs";
import { setUser } from "../../app/static/core-v3/session.mjs";
import { describeError, ApiError } from "../../app/static/core-v3/errors.mjs";
import { recordApi, getEvents } from "../../app/static/core-v3/telemetry.mjs";

test("canAccessModule : aucun utilisateur -> toujours refusé", () => {
  freshEnv();
  assert.equal(canAccessModule("drh"), false);
});

test("canAccessModule : admin global accède à n'importe quel module", () => {
  freshEnv();
  setUser({ role: "admin", authorizedModules: [] });
  assert.equal(canAccessModule("materiel"), true);
});

test("canAccessModule : authorized_modules explicite fait autorité, avec alias legacy acceptés", () => {
  freshEnv();
  setUser({ role: "rh", authorizedModules: ["recrute"] });
  assert.equal(canAccessModule("drh"), false, "sans la clé exacte ni un alias déclaré -> refusé");
  assert.equal(canAccessModule("drh", ["recrute"]), true, "l'alias déclaré par l'appelant doit être reconnu");
});

test("canAccessModule : moduleAccessGlobal accorde tout module quand authorized_modules est défini", () => {
  freshEnv();
  setUser({ role: "rh", authorizedModules: ["autre"], moduleAccessGlobal: true });
  assert.equal(canAccessModule("materiel"), true);
});

test("canAccessModule : repli sur authorized_structures quand authorized_modules est absent (null)", () => {
  freshEnv();
  setUser({ role: "rh", authorizedModules: null, authorizedStructures: ["ops"] });
  assert.equal(canAccessModule("ops"), true);
  assert.equal(canAccessModule("materiel"), false);
});

test("canValidateSensitiveActions : admin ou action validate/admin explicite uniquement", () => {
  freshEnv();
  setUser({ role: "rh", authorizedActions: [] });
  assert.equal(canValidateSensitiveActions(), false);
  setUser({ role: "rh", authorizedActions: ["validate"] });
  assert.equal(canValidateSensitiveActions(), true);
  setUser({ role: "admin", authorizedActions: [] });
  assert.equal(canValidateSensitiveActions(), true);
});

test("errors : describeError classe chaque code ApiError avec un message utilisateur honnête, jamais générique pour un cas connu", () => {
  assert.equal(describeError(new ApiError("x", { code: "FORBIDDEN" })).title, "Accès refusé");
  assert.equal(describeError(new ApiError("x", { code: "NOT_FOUND" })).title, "Ressource introuvable");
  assert.equal(describeError(new ApiError("x", { code: "UNAUTHORIZED" })).title, "Session expirée");
  assert.equal(describeError(new Error("inconnu")).title, "Une erreur est survenue");
});

test("telemetry : recordApi n'enregistre que des durées/statuts/chemins, jamais de contenu de réponse", () => {
  freshEnv();
  recordApi("/drh/dashboard", 42.5, 200);
  const events = getEvents();
  const apiEvent = events.find(e => e.type === "api");
  assert.equal(apiEvent.path, "/drh/dashboard");
  assert.equal(apiEvent.status, 200);
  assert.equal(typeof apiEvent.durationMs, "number");
});
