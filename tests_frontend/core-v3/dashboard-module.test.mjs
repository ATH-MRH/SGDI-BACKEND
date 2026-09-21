import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser, setToken, clearSession } from "../../app/static/core-v3/session.mjs";
import { mountDashboard, unmountDashboard } from "../../app/static/modules-v3/dashboard/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function statsPayload(overrides = {}) {
  return {
    scope: { active_society: "IRON" },
    erp: { employees: { total: 164, active: 140, leave_current: 5, sick_leave_current: 2, absent: 3 } },
    staffing: { contract: 150, actual: 140, gap: -10 },
    ...overrides,
  };
}

test("ARCHITECTURAL (§26/§13) : le module Dashboard V3 n'importe jamais un module employés/contrats/congés complet", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../app/static/modules-v3/dashboard/index.mjs"), "utf8");
  const importLines = source.split("\n").filter(l => /^\s*import\b/.test(l)).join("\n");
  for (const forbidden of ["employee", "contract", "leave", "sanction", "document", "assignment", "equipment", "candidate", "movement"]) {
    assert.doesNotMatch(importLines, new RegExp(forbidden, "i"), `dashboard V3 ne doit jamais importer un module lié à "${forbidden}"`);
  }
});

test("Dashboard V3 : monte, appelle UNIQUEMENT /api/ui/sidebar-stats, jamais /api/drh/employees", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  setUser({ username: "u", authorizedSocieties: ["IRON"] });
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(statsPayload()) }; };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountDashboard(container);
  await tick();
  assert.ok(calls.every(u => u.includes("/ui/sidebar-stats")), `seul sidebar-stats attendu, reçu: ${JSON.stringify(calls)}`);
  assert.ok(!calls.some(u => /\/drh\/employees|\/employees\/page/.test(u)), "aucun appel employés, complet ou paginé");
  unmountDashboard();
});

test("Dashboard V3 : affiche les KPI à partir de l'agrégat serveur, aucun 0 trompeur si en attente", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  setUser({ username: "u", authorizedSocieties: ["IRON"] });
  window.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(statsPayload()) });
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountDashboard(container);
  await tick();
  const text = document.querySelector("#view").textContent;
  assert.match(text, /140/, "effectif actif serveur attendu");
  assert.match(text, /164/, "total serveur attendu");
  unmountDashboard();
});

test("Dashboard V3 : erreur API -> état d'erreur explicite avec Réessayer fonctionnel", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  setUser({ username: "u", authorizedSocieties: ["IRON"] });
  let calls = 0;
  window.fetch = async () => { calls++; return calls <= 2 ? { ok: false, status: 500, text: async () => "{}" } : { ok: true, status: 200, text: async () => JSON.stringify(statsPayload()) }; };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountDashboard(container);
  await tick();
  assert.match(document.querySelector("#view").innerHTML, /v3-error-state/, "après épuisement du retry interne, l'erreur doit être visible");
  document.querySelector("[data-v3-retry='dashboard']").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#view").textContent, /140/, "le clic Réessayer doit aboutir sur les vraies données");
  unmountDashboard();
});

test("Dashboard V3 — multi-société (§29) : une réponse tardive de la société A ne s'affiche jamais après un changement vers B", async () => {
  const { window } = freshEnv();
  setToken("fake-token");
  setUser({ username: "u", authorizedSocieties: ["SOCIETE-A"] });
  let resolveA;
  window.fetch = () => new Promise(r => { resolveA = r; });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const pending = mountDashboard(container);
  await tick();
  // Changement de session pendant que la réponse A est en vol (générations différentes).
  clearSession();
  setToken("fake-token-b");
  setUser({ username: "v", authorizedSocieties: ["SOCIETE-B"] });
  document.querySelector("#view").innerHTML = '<div data-b-marker>Vue de B déjà affichée</div>';
  resolveA({ ok: true, status: 200, text: async () => JSON.stringify(statsPayload({ scope: { active_society: "SOCIETE-A" }, erp: { employees: { total: 999, active: 999 } } })) });
  await pending.catch(() => null);
  await tick();
  assert.ok(document.querySelector("[data-b-marker]"), "le DOM de B ne doit jamais être remplacé par la réponse tardive de A");
  assert.doesNotMatch(document.querySelector("#view").textContent, /999/, "les données de A ne doivent jamais apparaître après le changement de société");
  unmountDashboard();
});
