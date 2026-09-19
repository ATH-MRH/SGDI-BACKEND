// DRH NEXT — LOT 1 : tests (§25 de la mission).
// auth ok/refusée, permissions, scope société, dashboard, navigation, deep
// links, back/forward, loading, erreur+retry, course session, course
// navigation.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { login } from "../../app/static/drh-next/core/auth.mjs";
import { setUser, getUser, clearSession } from "../../app/static/drh-next/core/session.mjs";
import { canAccessDrh, currentSocietyScope } from "../../app/static/drh-next/core/permissions.mjs";
import * as router from "../../app/static/drh-next/core/router.mjs";
import { renderDashboard, invalidateDashboard } from "../../app/static/drh-next/modules/dashboard.mjs";
import { loadData, invalidate as invalidateLoader } from "../../app/static/drh-next/core/data-loader.mjs";
import { ApiError } from "../../app/static/drh-next/core/api.mjs";

function fetchJson(body, status = 200) {
  return async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
}
function dashboardPayload(overrides = {}) {
  return { employees_total: 1, employees_by_status: {}, candidates_by_status: {}, leaves_pending: 0, trial_periods: [], ...overrides };
}

test("auth : login réussi peuple la session, aucune table/compte parallèle (même clé sessionStorage que Legacy)", async () => {
  const { window } = freshEnv();
  window.fetch = fetchJson({ access_token: "token-A", user: { username: "RH01" } });
  const user = await login("RH01", "pw");
  assert.equal(user.username, "RH01");
  assert.equal(window.sessionStorage.getItem("sgdi_api_token_v1"), "token-A", "même clé que le frontend historique");
});

test("auth : login refusé (identifiants invalides) ne crée aucune session", async () => {
  const { window } = freshEnv();
  window.fetch = fetchJson({ detail: "Identifiants invalides" }, 401);
  await assert.rejects(() => login("x", "bad"));
  assert.equal(getUser(), null);
});

test("permissions : accès DRH accordé si authorized_modules contient drh, refusé sinon", () => {
  freshEnv();
  setUser({ username: "a", authorizedModules: ["ops"], moduleAccessGlobal: false, authorizedStructures: [] });
  assert.equal(canAccessDrh(), false, "authorized_modules explicite sans drh -> refusé");
  setUser({ username: "b", authorizedModules: ["drh", "ops"], moduleAccessGlobal: false, authorizedStructures: [] });
  assert.equal(canAccessDrh(), true);
});

test("scope société : reflète authorizedSocieties de la session, rien d'autre", () => {
  freshEnv();
  setUser({ username: "a", authorizedSocieties: ["SOCIETE-A", "SOCIETE-B"] });
  assert.deepEqual(currentSocietyScope(), ["SOCIETE-A", "SOCIETE-B"]);
});

test("dashboard : consomme /drh/dashboard uniquement, jamais /drh/employees (liste complète interdite au bootstrap)", async () => {
  const { window } = freshEnv();
  setUser({ username: "a" });
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload({ employees_total: 42, employees_by_status: { actif: 40 }, leaves_pending: 3 })) }; };
  document.body.innerHTML = '<div id="dn-view"></div>';
  await renderDashboard();
  assert.deepEqual(calls, ["/api/drh/dashboard"], "aucun autre endpoint appelé, surtout pas employees");
  assert.match(document.querySelector("#dn-view").textContent, /40/);
  assert.doesNotMatch(document.querySelector("#dn-view").innerHTML.toLowerCase(), /chargement\.\.\./, "pas de texte de chargement statique une fois les données là");
});

test("dashboard : squelette affiché de façon synchrone avant la résolution du fetch (§19)", async () => {
  const { window } = freshEnv();
  setUser({ username: "a" });
  let resolveFetch;
  window.fetch = () => new Promise(r => { resolveFetch = r; });
  document.body.innerHTML = '<div id="dn-view"></div>';
  const pending = renderDashboard();
  assert.match(document.querySelector("#dn-view").innerHTML, /dn-skeleton/, "squelette visible immédiatement, jamais un vide silencieux");
  resolveFetch({ ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload()) });
  await pending;
});

test("dashboard : erreur API -> état d'erreur explicite + Réessayer fonctionnel (§20)", async () => {
  const { window } = freshEnv();
  setUser({ username: "a" });
  let calls = 0;
  // data-loader retry:1 par défaut => 2 tentatives internes avant d'échouer réellement.
  window.fetch = async () => { calls++; return calls <= 2 ? { ok: false, status: 500, text: async () => "{}" } : { ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload({ employees_total: 5 })) }; };
  document.body.innerHTML = '<div id="dn-view"></div>';
  await renderDashboard();
  assert.match(document.querySelector("#dn-view").innerHTML, /dn-error-state/, "après épuisement du retry interne, l'erreur doit être visible");
  document.querySelector("[data-dn-retry-dashboard]").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#dn-view").textContent, /5/, "le clic Réessayer doit aboutir sur les vraies données");
});

test("data loader §8 : coalescing — deux appelants simultanés sur la même clé partagent une seule requête réseau", async () => {
  freshEnv();
  let calls = 0;
  const loaderFn = () => { calls++; return new Promise(r => setTimeout(() => r("valeur"), 5)); };
  const [a, b] = await Promise.all([loadData("coalesce-test", loaderFn), loadData("coalesce-test", loaderFn)]);
  assert.equal(calls, 1, "une seule requête réseau pour deux appelants simultanés");
  assert.equal(a, "valeur"); assert.equal(b, "valeur");
});

test("data loader §8 : TTL — une deuxième lecture dans la fenêtre de fraîcheur ne refait pas de requête", async () => {
  freshEnv();
  let calls = 0;
  const loaderFn = async () => { calls++; return "v" + calls; };
  const first = await loadData("ttl-test", loaderFn, { ttlMs: 5000 });
  const second = await loadData("ttl-test", loaderFn, { ttlMs: 5000 });
  assert.equal(calls, 1, "la deuxième lecture doit venir du cache court, pas du réseau");
  assert.equal(first, second);
});

test("data loader §8 : invalidation — force une nouvelle requête même dans la fenêtre TTL", async () => {
  freshEnv();
  let calls = 0;
  const loaderFn = async () => { calls++; return "v" + calls; };
  await loadData("invalidate-test", loaderFn, { ttlMs: 5000 });
  invalidateLoader("invalidate-test");
  const after = await loadData("invalidate-test", loaderFn, { ttlMs: 5000 });
  assert.equal(calls, 2, "après invalidation, une nouvelle requête doit repartir");
  assert.equal(after, "v2");
});

test("data loader §8 : retry sur 5xx, mais jamais sur 401/403/404 (échecs permanents, pas transitoires)", async () => {
  freshEnv();
  for (const status of [401, 403, 404]) {
    let calls = 0;
    const loaderFn = async () => { calls++; throw new ApiError("échec", { status }); };
    await assert.rejects(() => loadData("no-retry-" + status, loaderFn, { retry: 3 }));
    assert.equal(calls, 1, `un ${status} ne doit jamais être réessayé automatiquement`);
  }
  let calls5xx = 0;
  const loaderFn5xx = async () => { calls5xx++; throw new ApiError("échec serveur", { status: 500 }); };
  await assert.rejects(() => loadData("retry-500", loaderFn5xx, { retry: 2, retryDelayMs: 1 }));
  assert.equal(calls5xx, 3, "un 5xx doit être réessayé (1 tentative initiale + 2 retries)");
});

test("navigation : changement réel de route incrémente navigationGeneration, route rejouée non", async () => {
  freshEnv();
  const calls = [];
  router.registerRoute("a", () => calls.push("a"));
  router.registerRoute("b", () => calls.push("b"));
  router.startRouter();
  await tick();
  const g0 = router.getNavigationGeneration();
  router.navigate("a"); await tick();
  const g1 = router.getNavigationGeneration();
  assert.ok(g1 > g0);
  router.navigate("a"); await tick(); // même route rejouée
  assert.equal(router.getNavigationGeneration(), g1, "pas de double incrément sur la même route");
  router.navigate("b"); await tick();
  assert.ok(router.getNavigationGeneration() > g1);
  assert.deepEqual(calls.slice(-3), ["a", "a", "b"], "rejouer une route doit quand même redéclencher son rendu");
});

test("router §9 : route inconnue déclenche le gestionnaire 404 interne, jamais une page blanche silencieuse", () => {
  freshEnv("http://localhost/drh-next#/route-qui-nexiste-pas");
  let notFoundCalled = false;
  router.registerRoute("dashboard", () => {});
  router.registerNotFound(() => { notFoundCalled = true; });
  router.startRouter();
  assert.equal(notFoundCalled, true);
});

test("deep link : accès direct à employees/:id capture le paramètre", () => {
  freshEnv("http://localhost/drh-next#/employees/emp-42");
  let captured = null;
  router.registerRoute("employees/:id", (params) => { captured = params; });
  router.startRouter();
  assert.deepEqual(captured, { id: "emp-42" });
});

test("back/forward simulés : rejouer une navigation via hashchange redéclenche le bon module", async () => {
  const { window } = freshEnv();
  const seen = [];
  router.registerRoute("dashboard", () => seen.push("dashboard"));
  router.registerRoute("employees", () => seen.push("employees"));
  router.startRouter();
  await tick();
  router.navigate("employees"); await tick();
  window.location.hash = "#/dashboard"; await tick(); // "Back"
  window.location.hash = "#/employees"; await tick(); // "Forward"
  assert.deepEqual(seen, ["dashboard", "employees", "dashboard", "employees"]);
});

test("course de session (§21, le plus important) : requête A en vol -> logout -> login B -> réponse A -> DOM de B intact", async () => {
  const { window } = freshEnv();
  setUser({ username: "USER-A", authorizedSocieties: ["SOCIETE-A"] });
  let resolveFetch;
  window.fetch = () => new Promise(r => { resolveFetch = r; });
  document.body.innerHTML = '<div id="dn-view"></div>';
  const pending = renderDashboard();
  await tick(); // laisser la capture du contexte + le départ du fetch s'exécuter avant la course
  clearSession(); // logout A
  setUser({ username: "USER-B", authorizedSocieties: ["SOCIETE-B"] }); // login B
  document.querySelector("#dn-view").innerHTML = '<div data-b-marker>Vue de B déjà affichée</div>';
  resolveFetch({ ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload({ employees_total: 999 })) });
  await pending;
  assert.ok(document.querySelector("[data-b-marker]"), "le DOM de B ne doit jamais être remplacé par la réponse tardive de A");
  assert.doesNotMatch(document.querySelector("#dn-view").textContent, /999/, "la donnée de A ne doit jamais apparaître");
});

test("course de navigation (§21) : Dashboard -> Employés pendant une réponse Dashboard tardive -> Employés reste affiché", async () => {
  const { window } = freshEnv();
  setUser({ username: "a" });
  let resolveFetch;
  window.fetch = () => new Promise(r => { resolveFetch = r; });
  document.body.innerHTML = '<div id="dn-view"></div>';
  router.registerRoute("dashboard", () => renderDashboard());
  router.registerRoute("employees", () => { document.querySelector("#dn-view").innerHTML = '<div data-employees-marker>Employés</div>'; });
  router.startRouter(); // dispatch initial synchrone vers #/dashboard -> renderDashboard() démarre, fetch en vol
  await tick();
  router.navigate("employees"); await tick(); // la navigation doit être traitée AVANT la réponse tardive
  assert.ok(document.querySelector("[data-employees-marker]"), "Employés doit déjà être affiché avant la réponse tardive");
  resolveFetch({ ok: true, status: 200, text: async () => JSON.stringify(dashboardPayload()) });
  await tick(); await tick();
  assert.ok(document.querySelector("[data-employees-marker]"), "Employés doit rester affiché");
  assert.doesNotMatch(document.querySelector("#dn-view").innerHTML, /dn-kpi/, "le contenu du Dashboard ne doit jamais écraser Employés");
});
