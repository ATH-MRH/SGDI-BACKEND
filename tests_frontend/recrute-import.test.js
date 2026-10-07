const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const staticDir = path.join(__dirname, "..", "app", "static");
const source = fs.readFileSync(path.join(staticDir, "recrute.html"), "utf8");
const wizard = fs.readFileSync(path.join(staticDir, "recrute-import.js"), "utf8");
const css = fs.readFileSync(path.join(staticDir, "recruitment-v6.css"), "utf8");
const inline = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes("const SESSION_KEY="));

const FIELDS = [["last_name", "Nom", true], ["first_name", "Prénom", true], ["phone", "Téléphone", false], ["email", "E-mail", false], ["desired_position", "Poste souhaité", false]]
  .map(([key, label, required]) => ({ key, label, required, hint: "", values: [] }));
const CONFIG = { limits: { max_file_bytes: 5242880, max_file_mb: 5, max_rows: 1000, max_columns: 60, max_sheets: 10, extensions: [".xlsx", ".xls"], session_minutes: 30 }, can_update: true, fields: FIELDS };
const UPLOAD = { session_id: "abc123", file_name: "vivier.xlsx", file_size: 20480, default_sheet: 1, sheets: [
  { index: 0, name: "Notes", importable: false, reason: "Feuille vide", header_row: null, row_count: 0, columns: [] },
  { index: 1, name: "Avril", importable: true, reason: null, header_row: 1, row_count: 23, columns: [
    { index: 0, letter: "A", header: "Nom", samples: ["BENALI"], suggested: "last_name", duplicate_of: null },
    { index: 1, letter: "B", header: "Prénom", samples: ["Karim"], suggested: "first_name", duplicate_of: null },
    { index: 2, letter: "C", header: "GSM", samples: ["0555123456"], suggested: "phone", duplicate_of: null },
    { index: 3, letter: "D", header: "Diplôme", samples: ["<b>Licence</b>"], suggested: null, duplicate_of: null }] },
  { index: 2, name: "Mai", importable: true, reason: null, header_row: 1, row_count: 2, columns: [
    { index: 0, letter: "A", header: "Nom", samples: [], suggested: "last_name", duplicate_of: null }] }] };
const line = (row, extra = {}) => ({ row, values: { last_name: `NOM${row}`, first_name: "Test", phone: "0555000000" }, errors: [], warnings: [], matches: [], internal: [], changes: [], update_target: null, status: "valid", actions: ["create"], default_action: "create", ...extra });
function previewPayload() {
  const rows = Array.from({ length: 23 }, (_, index) => line(index + 2));
  rows[1] = line(3, { status: "error", actions: [], default_action: null, errors: [{ field: "email", label: "E-mail", message: "E-mail invalide : « <img src=x> »" }] });
  rows[2] = line(4, { status: "duplicate", actions: ["skip", "create", "update"], default_action: "skip", update_target: 77,
    matches: [{ type: "candidat", reasons: ["telephone"], visible: true, updatable: true, id: 77, name: "NOM4 TEST", society: null, state: "Nouvelle candidature" }],
    changes: [{ field: "email", label: "E-mail", old: "", new: "n4@example.com" }] });
  rows[3] = line(5, { status: "duplicate", actions: ["skip", "create"], default_action: "skip", matches: [{ type: "salarie", reasons: ["email"], visible: false, updatable: false }],
    warnings: [{ field: "phone", label: "Téléphone", message: "Zéro initial manquant" }] });
  return { session_id: "abc123", sheet: { index: 1, name: "Avril", header_row: 1 }, mapping: {}, ignored_columns: ["D (Diplôme)"], can_update: true, rows,
    counts: { analyzed: 23, valid: 20, duplicates: 2, errors: 1, warnings: 1, empty_rows: 1 } };
}
const RESULT = { session_id: "abc123", file_name: "vivier.xlsx", sheet: "Avril", already_processed: false,
  counts: { analyzed: 23, created: 20, updated: 1, skipped: 1, errors: 1, failed: 0, empty_rows: 1 },
  rows: [{ row: 3, outcome: "error", field: "E-mail", reason: "E-mail invalide", candidate_id: null }, { row: 5, outcome: "skipped", field: "", reason: "Doublon : fiche hors de votre périmètre", candidate_id: null }] };

function boot(actions = ["read", "create", "update"]) {
  const dom = new JSDOM(source, { runScripts: "outside-only", url: "https://recrute.irongs.com/" });
  const ctx = dom.getInternalVMContext();
  const realAdd = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (name, ...args) => { if (name !== "DOMContentLoaded") realAdd(name, ...args); };
  vm.runInContext(inline, ctx);
  vm.runInContext(wizard, ctx);
  const calls = [];
  const pending = {};
  dom.window.__api = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (url.endsWith("/config")) return CONFIG;
    if (url.endsWith("/preview")) return previewPayload();
    if (url.endsWith("/confirm")) return pending.confirm ? pending.confirm : RESULT;
    if (url.endsWith("/cancel")) return { status: "cancelled" };
    if (url.includes("/candidates/page")) return { items: [], total: 0, pages: 1, page: 1 };
    if (url.includes("recruitment-stats")) return { transferred_this_month: 0 };
    return UPLOAD;
  };
  const run = code => vm.runInContext(code, ctx);
  run(`apiFetch=(url,options)=>window.__api(url,options);recruteSession={token:"qa",user:{recruitment_access:true,authorized_actions:${JSON.stringify(actions)}}};`);
  return { dom, doc: dom.window.document, run, calls, pending, modal: () => dom.window.document.getElementById("importBackdrop") };
}
const file = (dom, name = "vivier.xlsx", size = 2048) => new dom.window.File([new Uint8Array(size)], name);
const texts = nodes => [...nodes].map(node => node.textContent.replace(/\s+/g, " ").trim());

test("bouton « Importer Excel » : secondaire, immédiatement à côté de « Nouvelle candidature »", async () => {
  const app = boot();
  await app.run("renderRecruitDashboard(true)");
  const buttons = [...app.doc.querySelectorAll("#dashboardSection .dashboard-actions > button")];
  assert.deepEqual(texts(buttons).slice(0, 2), ["＋ Nouvelle candidature", "Importer Excel"]);
  assert.equal(buttons[1].className, "secondary");
  assert.equal(buttons[1].getAttribute("onclick"), "openCandidateImport()");
  assert.equal(buttons[0].nextElementSibling, buttons[1]);
  // En-tête de la page Candidatures : même action, à côté de l'ajout de candidat.
  const header = app.doc.getElementById("importCandidatesBtn");
  assert.equal(header.nextElementSibling.id, "addCandidateBtn");
  assert.equal(header.getAttribute("onclick"), "openCandidateImport()");
  // L'ancien import côté navigateur (création ligne à ligne sans vérification) a disparu.
  assert.doesNotMatch(source, /importRecruitmentExcel|candidateExcelInput|xlsx\.full\.min/);
  const reader = boot(["read"]);
  await reader.run("renderRecruitDashboard(true)");
  assert.doesNotMatch(reader.doc.getElementById("dashboardSection").textContent, /Importer Excel/);
  await reader.run("openCandidateImport()");
  assert.equal(reader.modal(), null);
});

test("assistant : Fichier → Correspondance → Vérification → Résultat", async () => {
  const app = boot();
  await app.run("openCandidateImport()");
  let modal = app.modal();
  assert.deepEqual(texts(modal.querySelectorAll(".imp-step")), ["1Fichier", "2Correspondance des colonnes", "3Vérification", "4Résultat"]);
  assert.equal(modal.querySelector(".imp-step.is-current").textContent, "1Fichier");
  assert.equal(modal.querySelector("#importFileInput").getAttribute("accept"), ".xlsx,.xls");
  assert.match(modal.textContent, /Glissez-déposez votre fichier Excel/);
  assert.match(modal.textContent, /5 Mo et 1000 lignes maximum/);
  assert.ok(texts(modal.querySelectorAll("button")).includes("Télécharger le modèle Excel"));
  // Formats et taille contrôlés avant tout envoi.
  await app.run("importUpload(new File(['x'],'cv.pdf'))");
  assert.match(app.modal().querySelector("#importError").textContent, /\.xlsx ou \.xls/);
  assert.equal(app.calls.filter(call => call.method === "POST").length, 0);

  app.dom.window.__file = file(app.dom);
  await app.run("importUpload(window.__file)");
  modal = app.modal();
  const upload = app.calls.find(call => call.url === "/api/drh/candidates/import");
  assert.equal(upload.method, "POST");
  assert.ok(upload.body instanceof app.dom.window.FormData);
  assert.equal(modal.querySelector(".imp-step.is-current").textContent, "2Correspondance des colonnes");
  // Classeur à plusieurs feuilles : choix de la feuille, feuilles non importables désactivées.
  const sheets = [...modal.querySelectorAll("#importSheetSelect option")];
  assert.deepEqual(sheets.map(option => [option.value, option.disabled, option.selected]), [["0", true, false], ["1", false, true], ["2", false, false]]);
  // Correspondance automatique proposée, corrigeable par liste déroulante, colonne inconnue ignorée.
  const selects = () => [...app.modal().querySelectorAll(".imp-mapping select")];
  assert.deepEqual(selects().map(select => select.value), ["last_name", "first_name", "phone", ""]);
  assert.equal(selects()[3].options[0].textContent, "— Ignorer cette colonne —");
  assert.match(modal.querySelector(".imp-mapping").textContent, /En-tête non reconnu/);
  assert.equal(modal.querySelector(".imp-samples").innerHTML.includes("<b>"), false);
  assert.match(modal.querySelector(".imp-mapping").innerHTML, /&lt;b&gt;Licence/);        // valeurs du fichier échappées
  // Correspondance contradictoire empêchée : un champ = une seule colonne.
  app.run("importSetMapping(3,'last_name')");
  assert.deepEqual(selects().map(select => select.value), ["", "first_name", "phone", "last_name"]);
  assert.match(app.modal().querySelector("#importError").textContent, /colonne A/);
  app.run("importSetMapping(3,'')");
  assert.match(app.modal().textContent, /Champs obligatoires sans colonne : Nom/);
  assert.equal(app.modal().querySelector("#importPreviewBtn").disabled, true);
  app.run("importSetMapping(0,'last_name')");
  assert.equal(app.modal().querySelector("#importPreviewBtn").disabled, false);

  await app.run("importRunPreview()");
  modal = app.modal();
  const preview = app.calls.find(call => call.url.endsWith("/preview"));
  assert.deepEqual(JSON.parse(preview.body), { sheet: 1, mapping: { 0: "last_name", 1: "first_name", 2: "phone", 3: null } });
  assert.equal(modal.querySelector(".imp-step.is-current").textContent, "3Vérification");
  // Aperçu paginé et filtrable.
  assert.equal(modal.querySelectorAll(".imp-preview tbody tr").length, 20);
  assert.match(modal.querySelector(".imp-pagination").textContent, /Lignes 1–20 sur 23/);
  app.run("importSetPage(2)");
  assert.equal(app.modal().querySelectorAll(".imp-preview tbody tr").length, 3);
  assert.deepEqual(texts(app.modal().querySelectorAll(".imp-filter")), ["Toutes 23", "À créer 20", "Doublons 2", "Erreurs 1", "Avertissements 1"]);
  app.run("importSetFilter('error')");
  const errorRow = app.modal().querySelector(".imp-preview tbody tr");
  assert.equal(errorRow.querySelector("td").textContent, "3");
  assert.match(errorRow.textContent, /E-mail : E-mail invalide/);
  assert.equal(errorRow.querySelector("img"), null);                                    // jamais d'injection HTML
  app.run("importSetFilter('duplicate')");
  const [updatable, hidden] = app.modal().querySelectorAll(".imp-preview tbody tr");
  assert.match(updatable.textContent, /Dossier n° 77 — NOM4 TEST · Nouvelle candidature \(même téléphone\)/);
  assert.match(hidden.textContent, /Fiche hors de votre périmètre \(même e-mail\)/);
  assert.match(hidden.textContent, /Zéro initial manquant/);
  // Doublons ignorés par défaut ; mise à jour = choix explicite, changements affichés avant confirmation.
  assert.deepEqual([...updatable.querySelectorAll(".imp-decision option")].map(option => [option.value, option.selected]), [["skip", true], ["create", false], ["update", false]]);
  assert.deepEqual([...hidden.querySelectorAll(".imp-decision option")].map(option => option.value), ["skip", "create"]);
  assert.match(app.modal().querySelector(".imp-summary").textContent, /20 à créer · 0 à mettre à jour · 2 doublon\(s\) ignoré\(s\) · 1 ligne\(s\) en erreur exclue\(s\)/);
  assert.equal(app.modal().querySelector("#importConfirmBtn").textContent, "Confirmer l’import (20)");
  app.run("importSetDecision(4,'update')");
  assert.match(app.modal().querySelector(".imp-preview tbody tr").textContent, /Modifications de la fiche n° 77 : E-mail \(vide\) → n4@example\.com/);
  assert.equal(app.modal().querySelector("#importConfirmBtn").textContent, "Confirmer l’import (21)");
  assert.deepEqual(texts(app.modal().querySelectorAll(".modal-actions button")), ["Annuler", "Retour", "Confirmer l’import (21)"]);
  // Retour puis nouvelle vérification : la correspondance est conservée.
  app.run("importBack()");
  assert.deepEqual(selects().map(select => select.value), ["last_name", "first_name", "phone", ""]);
  await app.run("importRunPreview()");
  app.run("importSetDecision(4,'update')");
  assert.equal(app.calls.filter(call => call.url.endsWith("/confirm")).length, 0);       // rien confirmé jusqu'ici

  // Double clic : une seule confirmation, bouton désactivé pendant le traitement.
  let release;
  app.pending.confirm = new Promise(resolve => { release = resolve; });
  const first = app.run("importConfirm()");
  const second = app.run("importConfirm()");
  assert.equal(app.modal().querySelector("#importConfirmBtn").disabled, true);
  assert.equal(app.modal().querySelector("#importConfirmBtn").textContent, "Import en cours…");
  assert.equal(app.modal().querySelector(".imp-modal").getAttribute("aria-busy"), "true");
  await app.run("closeCandidateImport()");                                               // fermeture impossible en cours d'import
  assert.ok(app.modal());
  release(RESULT);
  await Promise.all([first, second]);
  const confirms = app.calls.filter(call => call.url.endsWith("/confirm"));
  assert.equal(confirms.length, 1);
  assert.deepEqual(JSON.parse(confirms[0].body), { decisions: { 4: "update", 5: "skip" } });
  modal = app.modal();
  assert.equal(modal.querySelector(".imp-step.is-current").textContent, "4Résultat");
  assert.deepEqual(texts(modal.querySelectorAll(".imp-tile")), ["23Lignes analysées", "20Candidats créés", "1Fiches mises à jour", "1Doublons ignorés", "1Lignes en erreur"]);
  assert.ok(texts(modal.querySelectorAll(".modal-actions button")).includes("Télécharger le rapport"));
  assert.match(modal.querySelector(".imp-table").textContent, /Doublon ignoré/);
  // Liste et compteurs actualisés sans rechargement complet.
  assert.ok(app.calls.some(call => call.url.includes("/candidates/page") || call.url.includes("recruitment-stats")));
  await app.run("closeCandidateImport()");
  assert.equal(app.modal(), null);
  assert.equal(app.calls.filter(call => call.url.endsWith("/cancel")).length, 0);        // import confirmé : rien à annuler
});

test("annuler ou fermer avant confirmation : session abandonnée, aucune création", async () => {
  for (const close of ["closeCandidateImport()", "eval(document.querySelector('#importBackdrop .modal-close').getAttribute('onclick'))", "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))"]) {
    const app = boot();
    await app.run("openCandidateImport()");
    app.dom.window.__file = file(app.dom);
    await app.run("importUpload(window.__file)");
    await app.run("importRunPreview()");
    await app.run(close);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.modal(), null, close);
    assert.deepEqual(app.calls.filter(call => /\/(cancel|confirm)$/.test(call.url)).map(call => [call.url, call.method]), [["/api/drh/candidates/import/abc123/cancel", "POST"]]);
  }
  // Fermeture avant tout envoi : aucun appel serveur d'annulation.
  const idle = boot();
  await idle.run("openCandidateImport()");
  await idle.run("closeCandidateImport()");
  assert.deepEqual(idle.calls.map(call => call.url), ["/api/drh/candidates/import/config"]);
});

test("erreur serveur à l'analyse : message affiché, on reste à l'étape Fichier", async () => {
  const app = boot();
  await app.run("openCandidateImport()");
  const api = app.dom.window.__api;
  app.dom.window.__api = async (url, options) => { if (url === "/api/drh/candidates/import") throw new Error("Classeur protégé par mot de passe : retirez la protection avant l'import."); return api(url, options); };
  app.dom.window.__file = file(app.dom);
  await app.run("importUpload(window.__file)");
  assert.equal(app.modal().querySelector(".imp-step.is-current").textContent, "1Fichier");
  assert.match(app.modal().querySelector("#importError.show").textContent, /protégé par mot de passe/);
  assert.equal(app.modal().querySelector(".imp-drop").classList.contains("is-busy"), false);
});

test("styles de l'assistant : feuille partagée, valides et adaptés aux petits écrans", () => {
  const errors = [];
  require("css-tree").parse(css, { onParseError: error => errors.push(error.message) });
  assert.deepEqual(errors, []);
  for (const rule of ["#importBackdrop .imp-steps", "#importBackdrop .imp-drop", "#importBackdrop .imp-table-wrap{overflow-x:auto", "#importBackdrop .imp-tiles"]) assert.ok(css.includes(rule), rule);
  const mobile = css.slice(css.lastIndexOf("@media(max-width:800px)"));
  assert.match(mobile, /#importBackdrop \.imp-table thead\{display:none\}/);
  assert.match(mobile, /td\[data-label\]::before\{content:attr\(data-label\)/);
  assert.match(source, /<script src="\/static\/recrute-import\.js\?v=[^"]+"><\/script>\s*<\/body>/);
});
