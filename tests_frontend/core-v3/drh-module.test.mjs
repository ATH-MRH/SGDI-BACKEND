// ATLAS V3 — Phase 3 (migration DRH) : tests architecturaux + fonctionnels du domaine
// modules-v3/drh/**. Complète (ne remplace pas) tests_frontend/drh-next/* (logique
// d'origine déjà testée là-bas) et tests_frontend/core-v3/* (runtime générique déjà testé).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshEnv, tick } from "./dom-env.mjs";
import { setUser, setToken, clearSession } from "../../app/static/core-v3/session.mjs";
import { canEnterModule } from "../../app/static/core-v3/module-registry.mjs";
import { canAccessDrhV3, registerDrhRoutes } from "../../app/static/modules-v3/drh/index.mjs";
import { mountEmployees, unmountEmployees, _resetForTests as resetEmployees } from "../../app/static/modules-v3/drh/employees.mjs";
import { mountEmployeeDossier, unmountEmployeeDossier, _resetForTests as resetDossier } from "../../app/static/modules-v3/drh/employee-dossier.mjs";
import { drhNavItems } from "../../app/static/modules-v3/drh/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRH_DIR = path.join(__dirname, "../../app/static/modules-v3/drh");

function drhSourceFiles() {
  return fs.readdirSync(DRH_DIR).filter(f => f.endsWith(".mjs")).map(f => path.join(DRH_DIR, f));
}

function drhSource() {
  return drhSourceFiles().map(f => fs.readFileSync(f, "utf8")).join("\n\n");
}

// ── §15 : aucun accès à un store global façon Legacy ──────────────────────────────────────
test("ARCHITECTURAL (§15) : modules-v3/drh/** ne référence jamais window.db / db.agents / db.conges / db.contrats / db.documents / db.*", () => {
  const src = drhSource();
  for (const forbidden of [/\bwindow\.db\b/, /\bdb\.agents\b/, /\bdb\.conges\b/, /\bdb\.contrats\b/, /\bdb\.documents\b/, /(?<![.\w])db\.\w+/]) {
    assert.doesNotMatch(src, forbidden, `référence interdite à un store global détectée : ${forbidden}`);
  }
});

// ── §16 : aucun pont runtime vers le monolithe Legacy ──────────────────────────────────────
test("ARCHITECTURAL (§16) : modules-v3/drh/** n'importe jamais sgdi-app.js et n'appelle aucune fonction du runtime Legacy", () => {
  const src = drhSource();
  assert.doesNotMatch(src, /sgdi-app(\.js)?/i, "aucune référence à sgdi-app.js attendue");
  for (const file of drhSourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const importLines = source.split("\n").filter(l => /^\s*import\b/.test(l)).join("\n");
    assert.doesNotMatch(importLines, /\.\.\/\.\.\/js\//, `${path.basename(file)} : aucun import du dossier js/ Legacy attendu`);
  }
});

// ── §21 : critère réseau absolu — jamais la collection complète des employés ───────────────
test("ARCHITECTURAL (§21/§7) : modules-v3/drh/** n'appelle jamais GET /drh/employees (collection complète) ni ?light=1, uniquement /drh/employees/page et /drh/employees/{id}", () => {
  // Seuls les appels réseau réels (api.get/post/put/delete/getBlob) sont examinés — un lien
  // de navigation hash (#/drh/employees, href) n'est pas un appel API et n'a pas à être exclu.
  const callPattern = /\bapi\.(get|post|put|delete|getBlob)\(\s*[`"']([^`"']*)/g;
  for (const file of drhSourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    let m;
    while ((m = callPattern.exec(source))) {
      const apiPath = m[2];
      const basePath = apiPath.split("?")[0];
      assert.notEqual(basePath, "/drh/employees", `${path.basename(file)} : appel interdit à la collection complète des employés : "${apiPath}"`);
      assert.doesNotMatch(apiPath, /light=1/, `${path.basename(file)} : mode ?light=1 interdit côté DRH V3 (réservé au bootstrap Legacy) : "${apiPath}"`);
    }
  }
});

// ── §19 RBAC : canAccessDrhV3() ─────────────────────────────────────────────────────────────
test("RBAC (§19) : canAccessDrhV3 autorise admin global, rôle rh/drh/recruteur, préfixe REC, module drh/recrute, structure drh — refuse un compte OPS pur", () => {
  freshEnv();
  setToken("t");

  setUser({ username: "a1", role: "admin" });
  assert.equal(canAccessDrhV3(), true, "admin global toujours autorisé");

  setUser({ username: "u2", role: "rh" });
  assert.equal(canAccessDrhV3(), true, "rôle rh autorisé");

  setUser({ username: "u3", role: "recruteur" });
  assert.equal(canAccessDrhV3(), true, "rôle recruteur autorisé");

  setUser({ username: "REC12", role: "agent" });
  assert.equal(canAccessDrhV3(), true, "préfixe historique REC autorisé");

  setUser({ username: "u4", role: "agent", authorizedModules: ["drh", "ops"] });
  assert.equal(canAccessDrhV3(), true, "module autorisé drh explicite");

  setUser({ username: "u5", role: "agent", authorizedModules: ["recrute"] });
  assert.equal(canAccessDrhV3(), true, "alias module recrute autorisé");

  setUser({ username: "u6", role: "agent", authorizedStructures: ["DRH"] });
  assert.equal(canAccessDrhV3(), true, "structure DRH autorisée");

  setUser({ username: "ops1", role: "agent", authorizedModules: ["ops", "materiel"] });
  assert.equal(canAccessDrhV3(), false, "compte OPS pur sans indicateur DRH refusé");

  clearSession();
  assert.equal(canAccessDrhV3(), false, "aucune session -> refusé");
});

test("RBAC (§19) : le registre de modules refuse l'entrée sur les écrans DRH à un compte OPS non-DRH et l'autorise à un compte DRH", () => {
  freshEnv();
  registerDrhRoutes();
  setToken("t");
  setUser({ username: "ops1", role: "agent", authorizedModules: ["ops"] });
  assert.equal(canEnterModule("drh-employees"), false);
  assert.equal(canEnterModule("drh-dashboard"), false);

  setUser({ username: "rh1", role: "rh" });
  assert.equal(canEnterModule("drh-employees"), true);
  assert.equal(canEnterModule("drh-dashboard"), true);
  assert.equal(canEnterModule("drh-recruitment"), true);
});

// ── §7 Employés : pagination serveur exclusive ──────────────────────────────────────────────
function employeesPage(page, items) {
  return { items, page, pages: 2, total: items.length + 1 };
}

test("Employés V3 : mount appelle UNIQUEMENT GET /drh/employees/page, jamais /drh/employees", async () => {
  const { window } = freshEnv();
  resetEmployees();
  setToken("t");
  setUser({ username: "rh1", role: "rh", authorizedSocieties: ["IRON"] });
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify(employeesPage(1, [{ id: 1, code: "E1", first_name: "A", last_name: "B", status: "actif" }])) };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployees(container);
  await tick();
  assert.ok(calls.length >= 1, "au moins un appel réseau attendu");
  assert.ok(calls.every(u => u.includes("/drh/employees/page")), `seul /drh/employees/page attendu, reçu: ${JSON.stringify(calls)}`);
  unmountEmployees();
});

test("Employés V3 : cliquer 'Suivant' redemande la page 2 côté serveur (aucun découpage local)", async () => {
  const { window } = freshEnv();
  resetEmployees();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    const page = /page=(\d+)/.exec(String(url))?.[1] || "1";
    return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ id: Number(page), code: "E" + page, first_name: "A", last_name: "B", status: "actif" }], page: Number(page), pages: 2, total: 2 }) };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployees(container);
  await tick();
  container.querySelector("[data-dn-emp-page='2']")?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();
  assert.ok(calls.some(u => /page=2/.test(u)), "un appel avec page=2 est attendu après le clic Suivant");
  unmountEmployees();
});

test("Employés V3 — course recherche (§18) : une réponse tardive de la recherche A ne s'affiche jamais après une recherche B plus récente", async () => {
  const { window } = freshEnv();
  resetEmployees();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  let resolveA;
  let callCount = 0;
  window.fetch = async (url) => {
    callCount += 1;
    if (callCount === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ items: [], page: 1, pages: 1, total: 0 }) };
    if (/q=chercheA/.test(String(url))) return new Promise(r => { resolveA = r; });
    return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ id: 9, code: "B-RESULT", first_name: "Z", last_name: "Z", status: "actif" }], page: 1, pages: 1, total: 1 }) };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployees(container);
  await tick();

  const search = container.querySelector("#dn-emp-search");
  search.value = "chercheA";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 320)); // dépasse le debounce, la requête A part et reste en vol

  search.value = "chercheB";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 320));
  await tick();

  // La réponse tardive de A arrive APRÈS que B a déjà été demandée/affichée.
  resolveA?.({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ id: 1, code: "A-RESULT-OBSOLETE", first_name: "X", last_name: "X", status: "actif" }], page: 1, pages: 1, total: 1 }) });
  await tick(); await tick();

  assert.doesNotMatch(container.textContent, /A-RESULT-OBSOLETE/, "le résultat tardif de la recherche A ne doit jamais s'afficher après B");
  unmountEmployees();
});

// ── §8/§9 Dossier employé : appel unique + onglets paresseux ────────────────────────────────
function employeePayload(overrides = {}) {
  return { id: 42, code: "E42", first_name: "Jean", last_name: "Dupont", position: "Agent", status: "actif", society: "IRON", ...overrides };
}

test("Dossier employé V3 : mount appelle UNIQUEMENT GET /drh/employees/{id}, aucun onglet lourd n'est chargé avant ouverture", async () => {
  const { window } = freshEnv();
  resetDossier();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(employeePayload()) }; };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployeeDossier(container, { id: "42" });
  await tick();
  assert.equal(calls.length, 1, `un seul appel réseau attendu à l'ouverture du dossier, reçu: ${JSON.stringify(calls)}`);
  assert.match(calls[0], /\/drh\/employees\/42$/);
  assert.match(container.textContent, /Jean/);
  unmountEmployeeDossier();
});

test("Dossier employé V3 : ouvrir l'onglet Contrats déclenche GET /drh/contracts?employee_id=42 (jamais avant)", async () => {
  const { window } = freshEnv();
  resetDossier();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    if (/\/drh\/employees\/42$/.test(String(url))) return { ok: true, status: 200, text: async () => JSON.stringify(employeePayload()) };
    if (/\/drh\/contracts\?employee_id=42/.test(String(url))) return { ok: true, status: 200, text: async () => JSON.stringify([]) };
    return { ok: true, status: 200, text: async () => "[]" };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployeeDossier(container, { id: "42" });
  await tick();
  assert.ok(!calls.some(u => /\/drh\/contracts/.test(u)), "l'onglet Contrats ne doit pas être appelé avant ouverture");

  container.querySelector('[data-dn-tab="contrats"]')?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();
  assert.ok(calls.some(u => /\/drh\/contracts\?employee_id=42/.test(u)), "l'ouverture de l'onglet Contrats doit appeler /drh/contracts?employee_id=42");
  unmountEmployeeDossier();
});

test("Dossier employé V3 — course d'onglet (§18) : ouvrir Contrats puis Congés avant résolution n'affiche jamais Contrats après coup", async () => {
  const { window } = freshEnv();
  resetDossier();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  let resolveContracts;
  window.fetch = async (url) => {
    const u = String(url);
    if (/\/drh\/employees\/42$/.test(u)) return { ok: true, status: 200, text: async () => JSON.stringify(employeePayload()) };
    if (/\/drh\/contracts/.test(u)) return new Promise(r => { resolveContracts = r; });
    if (/\/drh\/leaves/.test(u)) return { ok: true, status: 200, text: async () => JSON.stringify([]) };
    return { ok: true, status: 200, text: async () => "[]" };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployeeDossier(container, { id: "42" });
  await tick();

  container.querySelector('[data-dn-tab="contrats"]')?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();
  container.querySelector('[data-dn-tab="conges"]')?.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();

  resolveContracts?.({ ok: true, status: 200, text: async () => JSON.stringify([{ id: 1, contract_type: "CDI-OBSOLETE", status: "actif" }]) });
  await tick(); await tick();

  assert.doesNotMatch(container.textContent, /CDI-OBSOLETE/, "la réponse tardive de l'onglet Contrats ne doit jamais s'afficher pendant que Congés est actif");
  unmountEmployeeDossier();
});

test("Dossier employé V3 — multi-société (§18/§29) : une réponse tardive après changement de session n'écrase jamais l'écran suivant", async () => {
  const { window } = freshEnv();
  resetDossier();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  let resolveEmployee;
  window.fetch = () => new Promise(r => { resolveEmployee = r; });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const pending = mountEmployeeDossier(container, { id: "42" });
  await tick();

  clearSession();
  setToken("t2");
  setUser({ username: "rh2", role: "rh" });
  container.innerHTML = '<div data-marker-suivant>Écran suivant déjà affiché</div>';

  resolveEmployee({ ok: true, status: 200, text: async () => JSON.stringify(employeePayload({ first_name: "Obsolete" })) });
  await pending.catch(() => null);
  await tick();

  assert.ok(container.querySelector("[data-marker-suivant]"), "l'écran affiché après le changement de session ne doit jamais être remplacé par la réponse tardive");
  assert.doesNotMatch(container.textContent, /Obsolete/, "les données de l'ancienne session ne doivent jamais apparaître après un changement de session");
  unmountEmployeeDossier();
});

// ── Phase finale DRH — tests structuraux UX (§17 de la mission) ────────────────────────────

test("UX structurel : les onglets du dossier sont 10 boutons distincts, jamais un seul bloc de texte concaténé, exactement un actif à la fois", async () => {
  const { window } = freshEnv();
  resetDossier();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  window.fetch = async (url) => {
    const u = String(url);
    if (/\/drh\/employees\/42$/.test(u)) return { ok: true, status: 200, text: async () => JSON.stringify(employeePayload()) };
    return { ok: true, status: 200, text: async () => "[]" };
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  await mountEmployeeDossier(container, { id: "42" });
  await tick();

  const tabButtons = Array.from(container.querySelectorAll("[data-dn-tab]"));
  assert.equal(tabButtons.length, 10, "10 onglets attendus (identité/affectation/contrats/congés/discipline/documents/historique/pointage/matériel/blacklist)");
  assert.ok(tabButtons.every(b => b.tagName === "BUTTON"), "chaque onglet doit être un <button> réel (navigation clavier native), jamais un <div> cliquable");
  const labels = tabButtons.map(b => b.textContent.trim());
  assert.equal(new Set(labels).size, labels.length, "chaque onglet doit avoir un libellé distinct, jamais un texte vide ou dupliqué");
  assert.ok(labels.every(l => l.length > 0), "aucun libellé d'onglet vide");

  const selected = () => tabButtons.filter(b => b.getAttribute("aria-selected") === "true");
  assert.equal(selected().length, 1, "exactement un onglet actif au montage");
  assert.equal(selected()[0].getAttribute("data-dn-tab"), "identite", "identité active par défaut");

  container.querySelector('[data-dn-tab="affectation"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick();
  assert.equal(selected().length, 1, "exactement un onglet actif après changement");
  assert.equal(selected()[0].getAttribute("data-dn-tab"), "affectation");
  unmountEmployeeDossier();
});

test("UX structurel : la navigation DRH ne pointe jamais vers une route morte (chaque lien de sidebar a un module/route réellement enregistré)", () => {
  freshEnv();
  registerDrhRoutes();
  setToken("t");
  setUser({ username: "rh1", role: "rh" });
  const items = drhNavItems();
  assert.ok(items.length > 0, "un compte DRH doit voir au moins un lien de navigation DRH");
  const REGISTERED_DRH_ROUTES = new Set(["drh", "drh/employees", "drh/recrutement"]); // voir modules-v3/drh/index.mjs::registerDrhRoutes
  for (const item of items) {
    assert.ok(REGISTERED_DRH_ROUTES.has(item.route), `lien de sidebar "${item.route}" ne correspond à aucune route DRH réellement enregistrée`);
    assert.ok(item.label && item.label.trim().length > 0, `lien de sidebar "${item.route}" doit avoir un libellé non vide`);
  }
});

test("ARCHITECTURAL (§11) : aucun texte de type placeholder (\"pas encore planifié\", \"à venir\"...) dans le domaine DRH V3", () => {
  // "placeholder" (attribut HTML de saisie, ex. input placeholder="...") est un usage
  // légitime, volontairement exclu — seules les formulations décrivant une fonctionnalité
  // non implémentée sont interdites.
  const forbiddenPhrases = [/pas encore planifi/i, /non planifi/i, /\bà venir\b/i, /\bTODO\b/, /coming soon/i, /\bstub\b/i];
  const filesToScan = [...drhSourceFiles(), path.join(__dirname, "../../app/static/atlas-v3/app.mjs")];
  for (const file of filesToScan) {
    const source = fs.readFileSync(file, "utf8");
    for (const phrase of forbiddenPhrases) {
      assert.doesNotMatch(source, phrase, `${path.basename(file)} : texte de type placeholder détecté (${phrase})`);
    }
  }
});
