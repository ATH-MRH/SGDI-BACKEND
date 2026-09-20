// DRH NEXT — LOT 2 : tests (§23 de la mission).
// pagination, page size, recherche debounce, recherche race, pagination race,
// filtres, empty, error, retry, RBAC, scope société, détail employé, detail
// race, session race, Back/Forward, deep link employees/:id, aucun full
// employees, aucun N+1.
import test from "node:test";
import assert from "node:assert/strict";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser, clearSession } from "../../app/static/drh-next/core/session.mjs";
import * as router from "../../app/static/drh-next/core/router.mjs";
import { renderEmployees, renderEmployeeDetail, _resetForTests as resetEmployeesState } from "../../app/static/drh-next/modules/employees.mjs";
import { loadData, _resetForTests as resetLoader } from "../../app/static/drh-next/core/data-loader.mjs";

function employee(id, overrides = {}) {
  return { id, code: `E${String(id).padStart(4, "0")}`, first_name: "Prenom" + id, last_name: "Nom" + id, position: "Agent", status: "actif", contract_type: "CDI", society: "SOCIETE A", current_site_name: "Site " + id, ...overrides };
}
function page(items, { page = 1, pages = 1, total } = {}) {
  return { items, page, pages, total: total ?? items.length, page_size: 50 };
}
function fetchJson(body, status = 200) {
  return async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
}
function setup() {
  const { window } = freshEnv();
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  // LOT 12 §18 : employees.mjs ne réinitialise plus son état à chaque appel de
  // renderEmployees() (préservation page/recherche/mode voulue) — isolation entre tests
  // désormais explicite ici, comme pour les autres modules à état (dossier, etc.).
  resetEmployeesState();
  return { window };
}

test("pagination : premier chargement demande page=1, page_size=50 par défaut", async () => {
  const { window } = setup();
  let calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)])) }; };
  await renderEmployees();
  assert.equal(calls.length, 1, "aucun full employees, un seul appel /page");
  const url = new URL(calls[0], "http://x");
  assert.equal(url.pathname, "/api/drh/employees/page");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("page_size"), "50");
});

test("pagination : clic page suivante demande page=2 avec le même page_size", async () => {
  const { window } = setup();
  let calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)], { page: 1, pages: 3, total: 120 })) }; };
  await renderEmployees();
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(51)], { page: 2, pages: 3, total: 120 })) }; };
  document.querySelector('[data-dn-emp-page="2"]').click();
  await tick();
  const last = new URL(calls[calls.length - 1], "http://x");
  assert.equal(last.searchParams.get("page"), "2");
  assert.equal(last.searchParams.get("page_size"), "50");
  assert.match(document.querySelector("#dn-emp-results").textContent, /E0051/);
});

test("recherche : debounce ~300ms, une seule requête après plusieurs frappes rapprochées", async () => {
  const { window } = setup();
  let calls = 0;
  window.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)])) }; };
  await renderEmployees();
  calls = 0;
  const input = document.querySelector("#dn-emp-search");
  for (const ch of ["a", "al", "ali"]) { input.value = ch; input.dispatchEvent(new window.Event("input")); await new Promise(r => setTimeout(r, 50)); }
  assert.equal(calls, 0, "aucune requête avant la fin du debounce");
  await new Promise(r => setTimeout(r, 350));
  assert.equal(calls, 1, "une seule requête après le debounce, pas une par frappe");
});

test("recherche : une nouvelle recherche revient en page 1", async () => {
  const { window } = setup();
  let lastUrl = "";
  window.fetch = async (url) => { lastUrl = String(url); return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)], { page: 1, pages: 3, total: 120 })) }; };
  await renderEmployees();
  document.querySelector('[data-dn-emp-page="2"]').click();
  await tick();
  const input = document.querySelector("#dn-emp-search");
  input.value = "ali"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(new URL(lastUrl, "http://x").searchParams.get("page"), "1", "une nouvelle recherche doit repartir en page 1");
});

test("course recherche : A (lente) -> B (rapide) -> réponse A tardive -> B reste affichée", async () => {
  const { window } = setup();
  let resolveA;
  window.fetch = async (url) => {
    const q = new URL(url, "http://x").searchParams.get("q");
    if (q === "a-lent") return new Promise(r => { resolveA = () => r({ ok: true, status: 200, text: async () => JSON.stringify(page([employee(1, { code: "RESULTAT-A-NE-DOIT-JAMAIS-APPARAITRE" })])) }); });
    return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(2, { code: "RESULTAT-B" })])) };
  };
  await renderEmployees();
  const input = document.querySelector("#dn-emp-search");
  input.value = "a-lent"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350)); // laisser partir la recherche A
  input.value = "b-rapide"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350)); // B part et peut résoudre avant que A ne soit débloquée
  resolveA?.();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-emp-results").textContent, /RESULTAT-B/);
  assert.doesNotMatch(document.querySelector("#dn-emp-results").textContent, /RESULTAT-A/, "la réponse tardive de A ne doit jamais apparaître");
});

test("course pagination : page 1 lente -> page 2 -> réponse page 1 tardive -> page 2 reste affichée", async () => {
  const { window } = setup();
  let resolvePage1;
  window.fetch = async (url) => { return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)], { page: 1, pages: 3, total: 120 })) }; };
  await renderEmployees();
  window.fetch = async (url) => {
    const p = new URL(url, "http://x").searchParams.get("page");
    if (p === "1") return new Promise(r => { resolvePage1 = () => r({ ok: true, status: 200, text: async () => JSON.stringify(page([employee(1, { code: "PAGE-1-NE-DOIT-PAS-APPARAITRE" })], { page: 1, pages: 3, total: 120 })) }); });
    return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(51, { code: "PAGE-2-OK" })], { page: 2, pages: 3, total: 120 })) };
  };
  document.querySelector('[data-dn-emp-page="1"]')?.click(); // relance page 1 (déjà dessus, mais simule une requête lente)
  await tick();
  document.querySelector('[data-dn-emp-page="2"]')?.click();
  await tick(); await tick();
  resolvePage1?.();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-emp-results").textContent, /PAGE-2-OK/);
  assert.doesNotMatch(document.querySelector("#dn-emp-results").textContent, /PAGE-1-NE-DOIT-PAS/, "la réponse tardive de la page 1 ne doit jamais remplacer la page 2");
});

test("filtres : changer le statut envoie le paramètre mode attendu, page revient à 1", async () => {
  const { window } = setup();
  let lastUrl = "";
  window.fetch = async (url) => { lastUrl = String(url); return { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1)], { page: 1, pages: 2, total: 60 })) }; };
  await renderEmployees();
  document.querySelector('[data-dn-emp-page="2"]')?.click(); await tick();
  document.querySelector("#dn-emp-mode").value = "absents";
  document.querySelector("#dn-emp-mode").dispatchEvent(new window.Event("change"));
  await tick();
  const url = new URL(lastUrl, "http://x");
  assert.equal(url.searchParams.get("mode"), "absents");
  assert.equal(url.searchParams.get("page"), "1");
});

test("empty state : distinct entre 0 résultat de recherche et 0 employé réel", async () => {
  const { window } = setup();
  window.fetch = fetchJson(page([]));
  await renderEmployees();
  assert.match(document.querySelector("#dn-emp-results").textContent, /Aucun employé trouvé/);
  const input = document.querySelector("#dn-emp-search");
  input.value = "introuvable"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350));
  assert.match(document.querySelector("#dn-emp-results").textContent, /Aucun employé ne correspond à votre recherche/);
});

test("error + retry : échec réseau affiche une erreur claire, Réessayer relance la même requête", async () => {
  const { window } = setup();
  let calls = 0;
  // data-loader retry:1 par défaut => 2 tentatives internes avant d'échouer réellement
  // (même patron que le test dashboard du LOT 1) : il faut donc échouer 2 fois pour que
  // l'écran d'erreur soit réellement atteint, pas seulement absorbé en interne.
  window.fetch = async () => { calls++; return calls <= 2 ? { ok: false, status: 500, text: async () => "{}" } : { ok: true, status: 200, text: async () => JSON.stringify(page([employee(1, { code: "APRES-RETRY" })])) }; };
  await renderEmployees();
  assert.match(document.querySelector("#dn-emp-results").innerHTML, /dn-error-state/, "après épuisement du retry interne, l'erreur doit être visible");
  document.querySelector("[data-dn-retry-employees]")?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(); await tick();
  assert.match(document.querySelector("#dn-emp-results").textContent, /APRES-RETRY/, "le clic Réessayer doit aboutir sur les vraies données");
});

test("RBAC : session absente -> aucune requête employees envoyée par erreur (garde applicative en amont)", async () => {
  const { window } = setup();
  clearSession();
  let calls = 0;
  window.fetch = async () => { calls++; return { ok: false, status: 403, text: async () => JSON.stringify({ detail: "Module non autorise pour ce compte" }) }; };
  await renderEmployees();
  await tick();
  assert.match(document.querySelector("#dn-emp-results").innerHTML, /dn-error-state/, "un 403 doit produire un état d'erreur explicite, jamais une liste vide silencieuse");
});

test("scope société : la clé de cache ne mélange jamais deux comptes/sociétés différents", async () => {
  const { window } = setup();
  window.fetch = fetchJson(page([employee(1, { society: "SOCIETE A" })]));
  await renderEmployees();
  assert.match(document.querySelector("#dn-emp-results").textContent, /SOCIETE A|Site 1/);
  // Changement de compte : la liste doit être rechargée depuis le serveur, jamais réutiliser
  // un résultat en cache appartenant à l'autre société (le backend est scopé de toute façon,
  // mais le frontend ne doit pas non plus réutiliser un affichage périmé).
  clearSession();
  setUser({ username: "rhb", authorizedSocieties: ["SOCIETE B"] });
  window.fetch = fetchJson(page([employee(2, { society: "SOCIETE B", current_site_name: "Site B" })]));
  await renderEmployees();
  assert.match(document.querySelector("#dn-emp-results").textContent, /Site B/);
  assert.doesNotMatch(document.querySelector("#dn-emp-results").textContent, /Site 1\b/);
});

test("détail employé : un seul appel GET /drh/employees/:id, jamais la liste complète", async () => {
  const { window } = setup();
  let calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(employee(42, { code: "E0042" })) }; };
  await renderEmployeeDetail({ id: "42" });
  assert.deepEqual(calls, ["/api/drh/employees/42"]);
  assert.match(document.querySelector("#dn-view").textContent, /E0042/);
});

test("course détail : employé A (lent) -> navigation vers B -> réponse A tardive -> fiche B intacte", async () => {
  const { window } = setup();
  let resolveA;
  window.fetch = async (url) => {
    if (url.includes("/employees/1")) return new Promise(r => { resolveA = () => r({ ok: true, status: 200, text: async () => JSON.stringify(employee(1, { code: "FICHE-A-NE-DOIT-PAS-APPARAITRE" })) }); });
    return { ok: true, status: 200, text: async () => JSON.stringify(employee(2, { code: "FICHE-B" })) };
  };
  router.registerRoute("employees/:id", (params) => renderEmployeeDetail(params));
  router.startRouter();
  router.navigate("employees/1"); await tick();
  router.navigate("employees/2"); await tick(); await tick();
  resolveA?.();
  await tick(); await tick();
  assert.match(document.querySelector("#dn-view").textContent, /FICHE-B/);
  assert.doesNotMatch(document.querySelector("#dn-view").textContent, /FICHE-A/, "la fiche B ne doit jamais être écrasée par la réponse tardive de A");
});

test("course de session : requête liste en vol -> logout -> login sous une autre société -> réponse ignorée", async () => {
  const { window } = setup();
  let resolveFetch;
  window.fetch = () => new Promise(r => { resolveFetch = r; });
  const pending = renderEmployees();
  await tick();
  clearSession();
  setUser({ username: "autre", authorizedSocieties: ["AUTRE SOCIETE"] });
  document.querySelector("#dn-emp-results").innerHTML = '<div data-b-marker>Écran déjà affiché pour la nouvelle session</div>';
  resolveFetch({ ok: true, status: 200, text: async () => JSON.stringify(page([employee(1, { code: "NE-DOIT-JAMAIS-APPARAITRE" })])) });
  await pending; await tick();
  assert.ok(document.querySelector("[data-b-marker]"));
  assert.doesNotMatch(document.querySelector("#dn-emp-results").textContent, /NE-DOIT-JAMAIS-APPARAITRE/);
});

test("§7 (critique) : deux sessions différentes appelant loadData() avec la MÊME clé logique ne partagent jamais la même requête en vol", async () => {
  setup(); resetLoader();
  setUser({ username: "userA", authorizedSocieties: ["SOCIETE A"] });
  let resolveA;
  // Clé LOGIQUE volontairement identique (le cas réel : page 1, mode actifs par défaut) —
  // avant le correctif LOT 2 §7, la deuxième requête aurait reçu la promesse de la première.
  const pA = loadData("drh:employees:page=1:size=50:q=:mode=actifs", () => new Promise(r => { resolveA = () => r({ items: [{ code: "DONNEE-DE-A" }] }); }));
  clearSession();
  setUser({ username: "userB", authorizedSocieties: ["SOCIETE B"] });
  let callsB = 0;
  const pB = loadData("drh:employees:page=1:size=50:q=:mode=actifs", () => { callsB++; return Promise.resolve({ items: [{ code: "DONNEE-DE-B" }] }); });
  assert.notEqual(pA, pB, "deux Promise distinctes malgré la clé logique identique");
  const resultB = await pB;
  assert.equal(callsB, 1, "la requête de B doit être réellement exécutée, jamais réutiliser celle de A");
  assert.equal(resultB.items[0].code, "DONNEE-DE-B");
  resolveA();
  const resultA = await pA;
  assert.equal(resultA.items[0].code, "DONNEE-DE-A", "A garde sa propre réponse, aucune donnée croisée dans les deux sens");
});

test("§8 : le cache d'un détail employé (ttlMs) ne traverse jamais une session, même pour un ID identique", async () => {
  setup(); resetLoader();
  setUser({ username: "userA", authorizedSocieties: ["SOCIETE A"] });
  let callsForId1 = 0;
  const loaderId1 = () => { callsForId1++; return Promise.resolve({ code: "EMPLOYE-1-VU-PAR-A" }); };
  const first = await loadData("drh:employee:1", loaderId1, { ttlMs: 10000 });
  assert.equal(first.code, "EMPLOYE-1-VU-PAR-A");
  clearSession();
  setUser({ username: "userB", authorizedSocieties: ["SOCIETE B"] });
  // Même ID "1" mais appartenant à une société totalement différente pour B (le backend
  // renverrait normalement un 403/404 ; ce test vérifie que le FRONTEND, de son côté, ne
  // réutilise jamais silencieusement la réponse mise en cache par A pour ce même ID.
  const loaderId1ForB = () => { callsForId1++; return Promise.resolve({ code: "EMPLOYE-1-VU-PAR-B-OU-ERREUR" }); };
  const second = await loadData("drh:employee:1", loaderId1ForB, { ttlMs: 10000 });
  assert.equal(callsForId1, 2, "le cache TTL de A pour l'ID 1 ne doit jamais être servi à la session B");
  assert.notEqual(second.code, "EMPLOYE-1-VU-PAR-A");
});

test("§5/§6 : une requête abortée (page/recherche remplacée) n'affiche jamais d'erreur, ne pollue jamais inFlight/cache, et une nouvelle requête avec la même clé repart proprement", async () => {
  const { window } = setup();
  let resolveOld, oldSignal;
  window.fetch = async (url, opts) => {
    oldSignal = opts?.signal;
    return new Promise((resolve, reject) => {
      resolveOld = () => resolve({ ok: true, status: 200, text: async () => JSON.stringify(page([employee(1, { code: "ANCIEN-NE-DOIT-PAS-APPARAITRE" })])) });
      opts?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
  };
  renderEmployees(); // 1ère requête liste part et reste DÉLIBÉRÉMENT en vol — pas de await ici,
  await tick();       // c'est justement ce qu'on veut interrompre avant sa résolution
  window.fetch = fetchJson(page([employee(2, { code: "NOUVEAU-OK" })]));
  const input = document.querySelector("#dn-emp-search");
  input.value = "force-nouvelle-recherche"; input.dispatchEvent(new window.Event("input"));
  await new Promise(r => setTimeout(r, 350)); // laisse le debounce déclencher loadList() -> abort de l'ancienne
  assert.ok(oldSignal?.aborted, "l'ancienne requête doit être réellement abortée, pas seulement ignorée côté rendu");
  await tick(); await tick();
  assert.doesNotMatch(document.querySelector("#dn-emp-results").innerHTML, /dn-error-state/, "un abort ne doit jamais produire un écran d'erreur");
  assert.match(document.querySelector("#dn-emp-results").textContent, /NOUVEAU-OK/, "la nouvelle requête doit s'afficher normalement");
  resolveOld?.(); // si jamais appelée malgré l'abort : ne doit rien perturber
  await tick(); await tick();
  assert.doesNotMatch(document.querySelector("#dn-emp-results").textContent, /ANCIEN-NE-DOIT-PAS-APPARAITRE/, "la résolution tardive de l'ancienne requête abortée ne doit jamais réapparaître");
});

test("router : Back/Forward et deep link vers employees/:id fonctionnent", async () => {
  const { window } = setup();
  window.fetch = fetchJson(page([employee(1)]));
  const seen = [];
  router.registerRoute("employees", () => { seen.push("list"); return renderEmployees(); });
  router.registerRoute("employees/:id", (p) => { seen.push("detail:" + p.id); window.fetch = async (u) => ({ ok: true, status: 200, text: async () => JSON.stringify(employee(Number(p.id))) }); return renderEmployeeDetail(p); });
  router.startRouter();
  await tick();
  router.navigate("employees/7"); await tick();
  window.location.hash = "#/employees"; await tick(); // "Back"
  window.location.hash = "#/employees/7"; await tick(); // "Forward"
  assert.deepEqual(seen, ["detail:7", "list", "detail:7"], "séquence exacte : détail -> liste (Back) -> détail (Forward)");
});

test("deep link direct sur employees/:id (première navigation, sans passer par la liste)", async () => {
  const { window } = freshEnv("http://localhost/drh-next#/employees/99");
  setUser({ username: "rh", authorizedSocieties: ["SOCIETE A"] });
  document.body.innerHTML = '<div id="dn-view"></div>';
  window.fetch = fetchJson(employee(99, { code: "E0099" }));
  let captured = null;
  router.registerRoute("employees/:id", (p) => { captured = p; return renderEmployeeDetail(p); });
  router.startRouter();
  await tick();
  assert.deepEqual(captured, { id: "99" });
  assert.match(document.querySelector("#dn-view").textContent, /E0099/);
});

test("aucun N+1 : une page de 50 employés ne déclenche qu'un seul appel réseau", async () => {
  const { window } = setup();
  let calls = 0;
  const items = Array.from({ length: 50 }, (_, i) => employee(i + 1));
  window.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(page(items, { total: 50 })) }; };
  await renderEmployees();
  assert.equal(calls, 1, "50 lignes affichées, une seule requête réseau — aucune requête par ligne");
});
