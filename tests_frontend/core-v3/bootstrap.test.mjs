import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshEnv, tick } from "./dom-env.mjs";
import { bootstrap } from "../../app/static/core-v3/bootstrap.mjs";
import { setUser, setToken } from "../../app/static/core-v3/session.mjs";
import { getEvents } from "../../app/static/core-v3/telemetry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("bootstrap : sans session, affiche uniquement l'écran de connexion — jamais la coquille", async () => {
  freshEnv();
  const calls = [];
  await bootstrap({
    renderLogin: () => calls.push("login"),
    renderForbidden: () => calls.push("forbidden"),
    renderShell: () => calls.push("shell"),
  });
  assert.deepEqual(calls, ["login"]);
});

test("bootstrap : session présente mais canAccessApp refuse -> écran d'accès refusé, jamais la coquille", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ username: "rh01", role: "rh", authorized_modules: [] }) });
  const calls = [];
  await bootstrap({
    renderLogin: () => calls.push("login"),
    renderForbidden: () => calls.push("forbidden"),
    renderShell: () => calls.push("shell"),
    canAccessApp: () => false,
  });
  assert.deepEqual(calls, ["forbidden"]);
});

test("bootstrap : session valide -> coquille puis routes puis routeur, dans cet ordre, jamais avant la session connue", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ username: "rh01", role: "rh", authorized_modules: ["dashboard"] }) });
  const calls = [];
  await bootstrap({
    renderLogin: () => calls.push("login"),
    renderForbidden: () => calls.push("forbidden"),
    renderShell: () => calls.push("shell"),
    canAccessApp: () => true,
    registerRoutes: () => calls.push("routes"),
  });
  assert.deepEqual(calls, ["shell", "routes"]);
});

test("bootstrap : enregistre une durée de bootstrap en télémétrie, sans donnée personnelle", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ username: "rh01", role: "rh", authorized_modules: ["dashboard"] }) });
  await bootstrap({ renderLogin: () => {}, renderForbidden: () => {}, renderShell: () => {}, canAccessApp: () => true });
  const events = getEvents();
  const bootstrapEvents = events.filter(e => e.type === "bootstrap");
  assert.equal(bootstrapEvents.length, 1);
  assert.equal(typeof bootstrapEvents[0].durationMs, "number");
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /rh|dashboard/i, "aucune donnée personnelle ou métier ne doit apparaître en télémétrie");
});

test("ARCHITECTURAL (§26) : bootstrap.mjs n'IMPORTE jamais un module de domaine métier interdit au bootstrap", () => {
  // Ne vérifie que les lignes `import ... from "..."` (le code réellement exécuté), pas les
  // commentaires — le commentaire qui EXPLIQUE cette règle listerait sinon les mots interdits
  // et se ferait échouer lui-même.
  const source = fs.readFileSync(path.join(__dirname, "../../app/static/core-v3/bootstrap.mjs"), "utf8");
  const importLines = source.split("\n").filter(line => /^\s*import\b/.test(line)).join("\n");
  for (const forbidden of ["employee", "contract", "leave", "sanction", "document", "assignment", "equipment", "candidate", "movement"]) {
    assert.doesNotMatch(importLines, new RegExp(forbidden, "i"), `bootstrap.mjs ne doit jamais importer un module lié à "${forbidden}"`);
  }
});
