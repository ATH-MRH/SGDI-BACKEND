// Studio Badges DRH : verrou de consultation, groupe sanguin, aperçu et impression (jsdom).
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const REGISTRY = read("app/static/js/core/module-registry.js");
const STUDIO = read("app/static/js/modules/badges-studio.js");
const BADGES = read("app/static/js/modules/badges.js");
const SHELL = read("app/static/sgdi-app.js");
const POSITIONS = read("app/static/js/modules/positions.js");
// Le VRAI verrou de l'application (extrait de sgdi-app.js), appliqué comme après une navigation.
const LOCK_SOURCE = /function sgdiApplyViewModeLocks\(root\)\{[\s\S]*?\n\}/.exec(SHELL)[0];

const MINUS = "−";
const BLOOD = { id: "gs", type: "blood", name: "Groupe sanguin", x: 4, y: 59, w: 14, h: 12, size: 22, color: "#111111", background: "#FFCB05",
  stroke: "#111111", strokeWidth: 0.3, radius: 1.2, align: "center", caption: "GROUPE SANGUIN", captionSize: 4.6, rotation: 0, opacity: 1 };
const DESIGN = { width: 54, height: 86, pages: [{ name: "Recto", background: "#FFFFFF", elements: [
  { id: "code", type: "text", text: "CODE : **{{matricule}}**", x: 3, y: 53, w: 48, h: 4, size: 9, color: "#111111", align: "center", rotation: 0, opacity: 1 },
  { id: "qr", type: "qr", x: 20, y: 58, w: 14, h: 14, color: "#111111", background: "", rotation: 0, opacity: 1 }, BLOOD,
] }, { name: "Verso", background: "#FFFFFF", elements: [] }] };
const TEMPLATE = { id: 1, name: "IRON GLOBAL — Référence", society: null, is_system: true, is_default: true, version: 2, width_mm: 54, height_mm: 86, design: DESIGN };
const BADGE = { id: 3, number: "BDG-2026-000003", status: "ACTIF", issued_at: "2026-10-01T08:00:00", print_count: 1, has_photo: false };
const EMPLOYEE = { id: 7, societe: "IGS", nom: "BENALI", prenom: "Karim", nom_complet: "BENALI Karim", matricule: "K26", fonction: "Cariste", site: "Site A",
  site_code: "ETP/DF/H01", statut: "actif", has_photo: false, badge: null, badges: [], qr: ["101", "010", "101"], default_template_id: 1, can_issue: true,
  settings: {}, blood_group: { status: "non_autorise", authorized: false } };
const FACETS = { societies: ["IGS"], sites: [{ id: 5, name: "Site A", code: "ETP/DF/H01" }, { id: 6, name: "Site B", code: "ETP/DF/H02" }], functions: ["Cariste", "Agent"] };
const SETTINGS = { society: null, data: { number_prefix: "BDG", validity_months: 0, require_photo: true, photo_source: "portrait", print_layout: "card",
  sheet_margin_mm: 10, sheet_gap_mm: 4, crop_marks: true, show_blood_group: false, blood_group_authorization: "" }, revoke_reasons: {}, card: { width_mm: 54, height_mm: 86 } };
const ALL = { create: true, validate: true, export: true, admin: true };
const NONE = { create: false, validate: false, export: false, admin: false };

// PDF minimal à pages dimensionnées (MediaBox en points, comme ceux du serveur).
const pdfText = pages => "%PDF-1.4\n" + pages.map(([w, h], i) => `${i + 1} 0 obj << /Type /Page /MediaBox [ 0 0 ${(w * 72 / 25.4).toFixed(3)} ${(h * 72 / 25.4).toFixed(3)} ] >> endobj`).join("\n");
function setup(routes, rights) {
  routes = {
    "/permissions": { value: rights || ALL }, "/templates": { value: { items: [TEMPLATE], fields: { nom: "Nom" }, fonts: ["Helvetica"] } },
    "/employees/facets": { value: FACETS }, "/settings": { value: SETTINGS }, ...routes,
  };
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><div id="view"></div></main><div id="modal-host"></div></body></html>', {
    runScripts: "outside-only", url: "https://drh.irongs.com/#/drh/badges/dashboard",
  });
  const w = dom.window;
  const calls = [];
  w.sgdiApi = async (url, options) => {
    calls.push([url, options]);
    const keys = Object.keys(routes).sort((a, b) => b.length - a.length);           // le chemin le plus précis d'abord
    const key = keys.find(k => url.split("?")[0] === "/drh/badges" + k && ((options && options.method) || "GET") === (routes[k].method || "GET"))
      || keys.find(k => url.startsWith("/drh/badges" + k) && ((options && options.method) || "GET") === (routes[k].method || "GET"));
    if (!key) throw new Error("Appel inattendu : " + url);
    const value = routes[key].value;
    return JSON.parse(JSON.stringify(typeof value === "function" ? value(url, options) : value));
  };
  w.sgdiApiUrl = p => "/api" + p;
  w.sgdiAuthHeaders = () => ({});
  // PDF renvoyé : w.__pdf = { pages: [[w, h]…], header } (A4 par défaut, comme une planche).
  w.__pdf = { pages: [[210, 297]], header: "A4" };
  w.fetch = async (url, options) => {
    calls.push(["fetch", url, options]);
    const pdf = w.__pdf;
    return { ok: true, headers: { get: name => (name.toLowerCase() === "x-badge-page-size-mm" ? pdf.header : 'attachment; filename="badge.pdf"') },
      blob: async () => new w.Blob([pdfText(pdf.pages)], { type: "application/pdf" }) };
  };
  w.TextDecoder = w.TextDecoder || TextDecoder;
  // Cadre d'impression : chargement simulé, appel de print() espionné (w.__printBlocked : refus du navigateur).
  const append = w.document.body.appendChild.bind(w.document.body);
  w.document.body.appendChild = node => {
    const out = append(node);
    if (node.dataset && node.dataset.bsPrintFrame) {
      node.contentWindow.print = () => { if (w.__printBlocked) throw new Error("blocked"); calls.push(["print", node.src]); };
      setTimeout(() => node.dispatchEvent(new w.Event("load")), 0);
    }
    return out;
  };
  w.URL.createObjectURL = () => "blob:pdf";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { calls.push(["download", this.href, this.download || "onglet"]); };
  w.toast = (message, type) => calls.push(["toast", message, type]);
  w.confirm = () => true;
  w.openModal = html => { w.document.getElementById("modal-host").innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`; };
  w.closeModal = () => { w.document.getElementById("modal-host").innerHTML = ""; };
  w.eval(REGISTRY);
  w.eval(STUDIO);
  w.eval(BADGES);
  w.eval("var sgdiViewModeActive = true;" + LOCK_SOURCE);
  return { dom, w, calls, view: w.document.getElementById("view") };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
async function show(env, screen, hash) {
  env.w.location.hash = hash || "#/drh/badges/" + screen;
  env.w.renderBadgeStudio(env.view, screen, true);
  await settle();
  env.w.sgdiApplyViewModeLocks(env.view);                // verrou appliqué comme par l'application
}
const fields = view => [...view.querySelectorAll("input,select,textarea")].filter(el => el.type !== "hidden");

test("the view-mode lock never disables searches and filters, whatever the rights", async () => {
  for (const rights of [ALL, NONE]) {
    const env = setup({ "/employees": { value: { items: [{ ...EMPLOYEE, badge: BADGE }], total: 1, page: 1, pages: 1 } },
      "/history": { value: { items: [], total: 0, page: 1, pages: 1 } } }, rights);
    for (const screen of ["personnel", "lot", "historique", "creer"]) {
      await show(env, screen);
      const search = env.view.querySelector(".bs-search");
      assert.ok(search && !search.disabled && search.hasAttribute("data-no-lock"), `${screen} : recherche utilisable`);
      for (const select of env.view.querySelectorAll('.bs-filters select')) assert.ok(!select.disabled && select.hasAttribute("data-no-lock"), `${screen} : filtre utilisable`);
      assert.ok(env.view.querySelector(".bs-filters, [data-nav-filter]").hasAttribute("data-nav-filter"));
    }
    env.dom.window.close();
  }
});

test("typing in the employee search works after the lock and queries the API", async () => {
  const env = setup({ "/employees": { value: { items: [EMPLOYEE], total: 1, page: 1, pages: 1 } } }, NONE);
  await show(env, "creer");
  const search = env.view.querySelector('[data-bs-field="create-q"]');
  search.value = "K2";
  search.dispatchEvent(new env.w.Event("input", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 320));
  assert.ok(env.calls.some(c => String(c[0]).includes("/employees?") && String(c[0]).includes("q=K2")));
  assert.equal(env.view.querySelectorAll('[data-bs="pick"]').length, 1);
  env.dom.window.close();
});

test("batch selection and print options follow the print and issue rights", async () => {
  const items = { value: { items: [EMPLOYEE, { ...EMPLOYEE, id: 8, nom: "HADDAD", badge: BADGE }], total: 2, page: 1, pages: 1 } };
  const full = setup({ "/employees": items }, ALL);
  await show(full, "lot");
  const boxes = [...full.view.querySelectorAll('[data-bs="check"],[data-bs="check-all"]')];
  assert.ok(boxes.length === 3 && boxes.every(box => !box.disabled && box.hasAttribute("data-no-lock")));
  for (const name of ["lot-template", "lot-layout"]) assert.ok(!full.view.querySelector(`[data-bs-field="${name}"]`).disabled);
  full.view.querySelector('[data-bs="check"]').click();
  assert.equal(full.view.querySelector("[data-bs-count]").textContent, "1");
  full.dom.window.close();

  const reader = setup({ "/employees": items }, NONE);
  await show(reader, "lot");
  assert.ok([...reader.view.querySelectorAll('[data-bs="check"]')].every(box => box.disabled));
  assert.ok(reader.view.querySelector('[data-bs-field="lot-layout"]').disabled && reader.view.querySelector('[data-bs-field="lot-template"]').disabled);
  assert.equal(reader.view.querySelector('[data-bs="lot-print"]'), null);
  assert.equal(reader.view.querySelector('[data-bs="lot-issue-print"]'), null);
  reader.dom.window.close();
});

test("site and function filters, select-all and collective preview", async () => {
  const env = setup({
    "/employees": { value: url => ({ items: url.includes("site_id=6") ? [] : [EMPLOYEE, { ...EMPLOYEE, id: 8, nom: "HADDAD", nom_complet: "HADDAD Sara" }], total: 2, page: 1, pages: 1 }) },
    "/employees/7": { value: EMPLOYEE }, "/employees/8": { value: { ...EMPLOYEE, id: 8, nom: "HADDAD", nom_complet: "HADDAD Sara" } },
  }, ALL);
  await show(env, "lot");
  const site = env.view.querySelector('[data-bs-field="f-site"]');
  assert.deepEqual([...site.options].map(o => o.textContent), ["Tous les sites", "ETP/DF/H01 — Site A", "ETP/DF/H02 — Site B"]);
  assert.deepEqual([...env.view.querySelector('[data-bs-field="f-fonction"]').options].map(o => o.value), ["", "Cariste", "Agent"]);
  env.view.querySelector('[data-bs="select-results"]').click(); await settle();
  assert.equal(env.view.querySelector("[data-bs-count]").textContent, "2");
  env.view.querySelector('[data-bs="lot-preview"]').click(); await settle(); await settle();
  const modal = env.w.document.querySelector("#modal-host [data-bs-pv]");
  assert.ok(modal && modal.querySelectorAll(".bs-pv-item").length === 2);
  assert.match(modal.textContent, /BENALI Karim/); assert.match(modal.textContent, /HADDAD Sara/);
  assert.ok(!env.calls.some(c => /\/issue|\/print/.test(String(c[0])) || (c[0] === "fetch" && /print/.test(c[1]))), "l'aperçu n'émet ni n'imprime rien");
  env.w.closeModal();
  env.view.querySelector('[data-bs-field="f-site"]').value = "6";
  env.view.querySelector('[data-bs-field="f-site"]').dispatchEvent(new env.w.Event("change", { bubbles: true })); await settle();
  assert.ok(env.calls.some(c => String(c[0]).includes("/employees?") && String(c[0]).includes("site_id=6")));
  env.dom.window.close();
});

test("the blood group is drawn large when present and never when absent", () => {
  const env = setup({}, ALL);
  const B = env.w.BadgeStudio;
  for (const value of ["O+", `AB${MINUS}`]) {
    const svg = B.badgeSvg(DESIGN, 0, { values: { matricule: "K26", groupe_sanguin: value } });
    assert.match(svg, new RegExp(`data-blood="1">${value.replace("+", "\\+")}<`));
    const size = Number(/font-size="([0-9.]+)"[^>]*data-blood/.exec(svg)[1]);
    const code = Number(/<text[^>]*font-size="([0-9.]+)"[^>]*>(?:<tspan[^>]*>)?CODE/.exec(svg)[1]);
    assert.ok(size > code, "plus grand que le matricule");
    assert.match(svg, /GROUPE SANGUIN/);
  }
  const absent = B.badgeSvg(DESIGN, 0, { values: { matricule: "K26", groupe_sanguin: "" } });
  assert.doesNotMatch(absent, /GROUPE SANGUIN|data-blood/);
  assert.match(B.badgeSvg(DESIGN, 0, { values: {} }, { editable: true }), /stroke-dasharray="1 1"/);   // repère dans l'éditeur
  env.dom.window.close();
});

test("the create screen states the blood group status and previews without issuing", async () => {
  const states = [
    [{ status: "ok", authorized: true, value: `AB${MINUS}` }, /Groupe sanguin AB−/],
    [{ status: "absent", authorized: true }, /non renseigné/],
    [{ status: "ok", authorized: false }, /en attente de validation de conformité[\s\S]*Fiche : renseigné/],
  ];
  for (const [blood, text] of states) {
    const emp = { ...EMPLOYEE, blood_group: blood, ...(blood.value ? { groupe_sanguin: blood.value } : {}) };
    const env = setup({ "/employees/7": { value: emp } }, ALL);
    await show(env, "creer", "#/drh/badges/creer/7");
    assert.match(env.view.textContent, text);
    const svg = env.view.querySelector("[data-bs-preview]").innerHTML;
    if (blood.value) assert.match(svg, /data-blood="1">AB−</); else assert.doesNotMatch(svg, /data-blood/);   // jamais l'exemple « O+ »
    env.view.querySelector('[data-bs="preview-open"]').click(); await settle();
    const modal = env.w.document.querySelector("[data-bs-pv]");
    assert.ok(modal, "aperçu ouvert");
    modal.querySelector('[data-pv="real"]').click();
    assert.ok(modal.querySelector(".bs-lanyard"), "mode réaliste");
    modal.querySelector('[data-pv="flat"]').click();
    assert.equal(modal.querySelector(".bs-lanyard"), null);
    modal.querySelector('[data-pv="actual"]').click();
    assert.equal(modal.querySelector("[data-pv-zoom]").textContent, "100 %");
    const card = modal.querySelector(".bs-preview").getAttribute("style");
    assert.match(card, /--bs-card-w:204px/);                         // 54 mm à 96 px/pouce = taille réelle
    modal.querySelector('[data-pv="front"]').click();
    assert.equal(modal.querySelectorAll(".bs-card").length, 1);
    modal.querySelector('[data-pv="both"]').click();
    assert.equal(modal.querySelectorAll(".bs-card").length, 2);       // recto et verso
    assert.ok(!env.calls.some(c => /\/issue|\/print/.test(String(c[0]))), "l'aperçu n'émet rien");
    env.dom.window.close();
  }
});

test("printing a badge: identical reprint, format choice, PDF requested from the server", async () => {
  const detail = { ...BADGE, design: DESIGN, values: { nom_complet: "BENALI Karim", matricule: "K26", fonction: "Cariste", site_code: "ETP/DF/H01", societe: "IGS" },
    qr: ["1"], crop: {}, width_mm: 54, height_mm: 86, template_name: "IRON GLOBAL — Référence" };
  const env = setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } }, "/3": { value: detail } }, ALL);
  await show(env, "creer", "#/drh/badges/creer/7");
  env.view.querySelector('[data-bs="print-dialog"]').click(); await settle();
  const modal = env.w.document.querySelector("[data-bs-pv]");
  assert.match(modal.textContent, /Imprimer le badge BDG-2026-000003/);
  assert.match(modal.textContent, /BENALI Karim/); assert.match(modal.textContent, /masqué/);   // groupe sanguin non transmis
  assert.match(modal.textContent, /Imprimez à 100 %/);
  const layout = modal.querySelector("[data-pv-layout]");
  assert.deepEqual([...layout.options].map(o => o.value), ["card", "a4"]);
  assert.match(layout.options[0].textContent, /54 × 86 mm/);
  layout.value = "a4";
  modal.querySelector("[data-pv-print]").click(); await settle(); await settle();
  const sent = env.calls.find(c => c[0] === "fetch");
  assert.equal(sent[1], "/api/drh/badges/print/pdf");
  assert.deepEqual(JSON.parse(sent[2].body), { badge_ids: [3], layout: "a4" });
  assert.ok(env.calls.some(c => c[0] === "print"), "fenêtre d'impression ouverte directement");
  assert.ok(!env.calls.some(c => c[0] === "download"), "aucun téléchargement préalable");
  assert.equal(env.w.document.querySelector("[data-bs-pv]"), null);
  env.dom.window.close();
});

test("without the print right there is no print action, the backend refuses anyway", async () => {
  const env = setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } } }, NONE);
  await show(env, "creer", "#/drh/badges/creer/7");
  assert.equal(env.view.querySelector('[data-bs="print-dialog"]'), null);
  assert.equal(env.view.querySelector('[data-bs="issue"]'), null);
  assert.match(env.view.textContent, /Impression : Réservé aux comptes autorisés au module Studio Badges/);
  env.dom.window.close();
});

test("settings: blood group display needs the admin right and an authorization reference", async () => {
  const saved = [];
  const env = setup({ "/settings": { value: SETTINGS }, "/settings ": {} }, ALL);
  env.w.sgdiApi = (orig => async (url, options) => {
    if (options && options.method === "PUT") { saved.push(options.body); return { society: null, data: { ...SETTINGS.data, ...options.body.data, show_blood_group: !!options.body.data.blood_group_authorization } }; }
    return orig(url, options);
  })(env.w.sgdiApi);
  await show(env, "parametres");
  const form = env.view.querySelector('[data-bs-form="settings"]');
  assert.ok(fields(form).every(el => !el.disabled && el.hasAttribute("data-no-lock")));
  assert.match(form.textContent, /jamais affichée sur la page publique/);
  form.querySelector('[name="show_blood_group"]').checked = true;
  form.querySelector('[name="blood_group_authorization"]').value = "Note DRH n° 12/2026";
  form.dataset.dirty = "1";
  form.dispatchEvent(new env.w.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.equal(saved[0].data.show_blood_group, true);
  assert.equal(saved[0].data.blood_group_authorization, "Note DRH n° 12/2026");
  assert.equal(form.dataset.dirty, undefined);                     // plus de garde « non enregistré »
  env.dom.window.close();

  const reader = setup({}, NONE);
  await show(reader, "parametres");
  assert.ok(fields(reader.view.querySelector("form")).every(el => el.disabled));
  assert.equal(reader.view.querySelector('button[type="submit"]'), null);
  reader.dom.window.close();
});

test("studio: the blood group element can be added, styled, hidden, locked and saved", async () => {
  const saves = [];
  const env = setup({ "/templates": { value: { items: [TEMPLATE], fields: {}, fonts: ["Helvetica"] } },
    "/templates ": {} }, ALL);
  env.w.sgdiApi = (orig => async (url, options) => {
    if (options && options.method === "POST" && url === "/drh/badges/templates") { saves.push(options.body); return { ...options.body, id: 9, version: 1 }; }
    return orig(url, options);
  })(env.w.sgdiApi);
  await show(env, "studio");
  const ed = env.w.BadgeStudioEditor.state;
  assert.ok(fields(env.view).every(el => el.disabled ? el.closest(".bs-st-nullable") : el.hasAttribute("data-no-lock")), "champs de l'éditeur libres");
  env.view.querySelector('[data-st="tool"][data-tool="blood"]').click();
  const el = ed.design.pages[0].elements.at(-1);
  assert.equal(el.type, "blood"); assert.deepEqual([...ed.sel], [el.id]);
  const props = env.view.querySelector("[data-st-props]");
  for (const prop of ["caption", "captionSize", "size", "align", "color", "background", "stroke", "strokeWidth", "radius", "visible", "locked", "x", "y", "w", "h"])
    assert.ok(props.querySelector(`[data-p="${prop}"]`), `propriété ${prop}`);
  const set = (prop, value) => { const input = props.querySelector(`[data-p="${prop}"]`); if (input.type === "checkbox") input.checked = value; else input.value = value; input.dispatchEvent(new env.w.Event("change", { bubbles: true })); };
  set("size", "30"); set("w", "16"); set("x", "30");
  assert.equal(el.size, 30); assert.equal(el.w, 16); assert.equal(el.x, 30);
  env.view.querySelector("[data-st-props] [data-p='visible']").checked = false;
  env.view.querySelector("[data-st-props] [data-p='visible']").dispatchEvent(new env.w.Event("change", { bubbles: true }));
  assert.equal(el.hidden, true);
  env.view.querySelector("[data-st-props] [data-p='locked']").checked = true;
  env.view.querySelector("[data-st-props] [data-p='locked']").dispatchEvent(new env.w.Event("change", { bubbles: true }));
  assert.equal(el.locked, true);
  env.w.document.dispatchEvent(new env.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));   // désélection : propriétés de la face
  env.view.querySelector('[data-st="format"][data-w="85.6"]').click();
  assert.equal(ed.design.width, 85.6); assert.equal(ed.design.height, 54);
  env.view.querySelector('[data-st="save"]').click(); await settle();
  const blood = saves[0].design.pages[0].elements.find(item => item.id === el.id);
  assert.ok(blood && blood.size === 30 && blood.hidden === true && blood.locked === true && saves[0].design.width === 85.6);
  env.dom.window.close();
});

test("studio without the template right is a read-only consultation", async () => {
  const env = setup({}, NONE);
  await show(env, "studio");
  const ed = env.w.BadgeStudioEditor.state;
  assert.equal(ed.readonly, true);
  assert.ok(env.view.querySelector("[data-st-readonly]"));
  assert.ok([...env.view.querySelectorAll('[data-st="tool"]')].filter(b => b.dataset.tool !== "layers").every(b => b.disabled));
  assert.ok(fields(env.view).every(el => el.disabled));
  const before = JSON.stringify(ed.design);
  env.view.querySelector('[data-st="tool"][data-tool="blood"]').click();
  env.view.querySelector('[data-st="preview"]').click(); await settle();
  assert.ok(env.w.document.querySelector("[data-bs-pv]"), "l'aperçu reste disponible");
  assert.equal(JSON.stringify(ed.design), before);
  assert.equal(env.view.querySelector('[data-st="save"]'), null);
  env.dom.window.close();
});

test("public QR page and legacy badge screen never show the blood group", () => {
  const verify = /async function renderBadgeVerify[\s\S]*?\n\}/.exec(SHELL)[0];
  assert.doesNotMatch(verify, /groupeSanguin|Groupe sanguin :/);
  assert.doesNotMatch(verify, /public-badge-blood/);
  assert.doesNotMatch(POSITIONS, /badge-blood|Groupe sanguin :/);
});

test("studio text fields keep their case: {{nom}} must stay a field once typed", async () => {
  const env = setup({}, ALL);
  await show(env, "studio");
  // Règle globale de l'application (sgdi-app.js) : toute saisie est mise en majuscules sauf data-no-uppercase="1".
  const shouldUpper = env.w.eval("(" + /function sgdiShouldUppercaseInput\(el\)\{[\s\S]*?\n\}/.exec(SHELL)[0] + ")");
  assert.equal(shouldUpper(env.view.querySelector('[data-st="name"]')), false);
  env.view.querySelector('[data-st="tool"][data-tool="text"]').click();
  for (const prop of ["text", "name"]) assert.equal(shouldUpper(env.view.querySelector(`[data-st-props] [data-p="${prop}"]`)), false, prop);
  env.view.querySelector('[data-st="tool"][data-tool="blood"]').click();
  assert.equal(shouldUpper(env.view.querySelector('[data-st-props] [data-p="caption"]')), false);
  env.dom.window.close();
});

test("read-only profile: the specimen PDF is offered and downloaded, no write action is available", async () => {
  const env = setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } } }, NONE);
  await show(env, "creer", "#/drh/badges/creer/7");
  const proof = env.view.querySelector('[data-bs="proof"]');
  assert.ok(proof && !proof.disabled, "bouton « Épreuve PDF » visible");
  for (const action of ["issue", "issue-print", "print-dialog", "revoke"]) assert.equal(env.view.querySelector(`[data-bs="${action}"]`), null, action);
  proof.click(); await settle();
  const sent = env.calls.find(c => c[0] === "fetch");
  assert.equal(sent[1], "/api/drh/badges/preview/pdf");
  assert.equal(sent[2].method, "POST");
  assert.deepEqual(JSON.parse(sent[2].body), { employee_id: 7, template_id: 1, crop: { zoom: 1, dx: 0, dy: 0 } });
  assert.ok(env.calls.some(c => c[0] === "download" && c[2] === "onglet"), "épreuve ouverte (aucun enregistrement)");
  assert.ok(!env.calls.some(c => c[0] === "toast" && c[2] === "error"), "aucune erreur affichée");
  assert.ok(!env.calls.some(c => /\/issue|\/print\/pdf|\/revoke|\/settings|\/templates/.test(String(c[1] || "")) && c[0] === "fetch"));
  assert.ok(!env.calls.some(c => c[1] && c[1].method && c[1].method !== "GET" && c[0] !== "fetch"), "aucune écriture via l'API");
  env.dom.window.close();
});

// ── badge.irongs.com : code officiel du site, groupe sanguin obligatoire, raisons précises ──
const SITE_TEXT = { id: "site", type: "text", text: "SITE : {{site_code}}", x: 3, y: 4.6, w: 42, h: 6.5, size: 12, color: "#FFFFFF", align: "center", rotation: 0, opacity: 1 };
const WITH_SITE = { ...TEMPLATE, design: { ...DESIGN, pages: [{ ...DESIGN.pages[0], elements: [SITE_TEXT, ...DESIGN.pages[0].elements] }, DESIGN.pages[1]] } };
const NO_CODE = { ...EMPLOYEE, site_code: "", site_code_status: "absent",
  site_code_problem: "Code officiel du site non renseigné pour le site « Site A ». Complétez-le dans Gestion des sites (fiche du site › Code officiel du site), puis émettez le badge." };

test("a missing official site code blocks issuance only when the template prints it", async () => {
  const blocked = setup({ "/templates": { value: { items: [WITH_SITE], fields: {}, fonts: ["Helvetica"] } }, "/employees/7": { value: NO_CODE } }, ALL);
  await show(blocked, "creer", "#/drh/badges/creer/7");
  assert.equal(blocked.view.querySelector('[data-bs="issue"]'), null);
  assert.equal(blocked.view.querySelector('[data-bs="issue-print"]'), null);
  assert.ok(blocked.view.querySelector('[data-bs="proof"]'), "l'épreuve reste possible");
  assert.match(blocked.view.querySelector("[data-bs-site-problem]").textContent, /Code officiel du site non renseigné[\s\S]*Gestion des sites/);
  assert.match(blocked.view.querySelector(".bs-dl").textContent, /Code officiel du site—/);
  assert.doesNotMatch(blocked.view.textContent, /ETP\/DF\/H01/);                          // jamais l'exemple
  blocked.dom.window.close();
  const free = setup({ "/employees/7": { value: NO_CODE } }, ALL);                         // modèle sans code site
  await show(free, "creer", "#/drh/badges/creer/7");
  assert.ok(free.view.querySelector('[data-bs="issue"]'));
  free.dom.window.close();
});

test("an authorized but missing blood group asks to regularize the record, a manager may issue with a documented waiver", async () => {
  const emp = { ...EMPLOYEE, blood_group: { status: "absent", authorized: true },
    blood_waivers: { non_communique: "Groupe sanguin non communiqué par l'employé", analyse_en_attente: "Analyse de groupage sanguin en attente" } };
  const operator = setup({ "/employees/7": { value: emp } }, { ...ALL, validate: false });
  await show(operator, "creer", "#/drh/badges/creer/7");
  assert.match(operator.view.querySelector("[data-bs-blood-problem]").textContent, /obligatoire sur les badges officiels/);
  assert.equal(operator.view.querySelector('[data-bs="issue"]'), null);
  assert.match(operator.view.querySelector("[data-bs-issue-blocked]").textContent, /groupe sanguin n'est pas régularisé/);
  operator.dom.window.close();
  const issued = [];
  const manager = setup({ "/employees/7": { value: emp }, "/issue": { method: "POST", value: (url, options) => { issued.push(options.body); return { id: 9, number: "BDG-2026-000009" }; } } }, ALL);
  await show(manager, "creer", "#/drh/badges/creer/7");
  const select = manager.view.querySelector('[data-bs-field="blood-waiver"]');
  assert.deepEqual([...select.options].map(o => o.value), ["", "non_communique", "analyse_en_attente"]);
  assert.equal(select.disabled, false);
  select.value = "analyse_en_attente";
  manager.view.querySelector('[data-bs="issue"]').click(); await settle();
  assert.equal(issued[0].blood_group_waiver, "analyse_en_attente");
  assert.equal(issued[0].groupe_sanguin, undefined);                                      // aucune valeur envoyée ni supposée
  manager.dom.window.close();
});

test("the studio badges operator sees issue and print actions, refusals carry the server's precise reason", async () => {
  const operator = setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } } },
    { create: true, export: true, validate: false, admin: false, operational: true, reasons: { validate: "Révocation réservée aux responsables habilités.", admin: "Réservé." } });
  await show(operator, "creer", "#/drh/badges/creer/7");
  assert.ok(operator.view.querySelector('[data-bs="print-dialog"]'));
  assert.ok(operator.view.querySelector('[data-bs="issue"]'));
  assert.equal(operator.view.querySelector('[data-bs="revoke"]'), null);
  assert.doesNotMatch(operator.view.textContent, /Permission requise/);
  operator.dom.window.close();
  const reader = setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } } },
    { ...NONE, read_only: true, reasons: { create: "Votre compte est limité à la consultation : aperçus et épreuves SPÉCIMEN uniquement.",
      export: "Votre compte est limité à la consultation : aperçus et épreuves SPÉCIMEN uniquement." } });
  await show(reader, "creer", "#/drh/badges/creer/7");
  assert.match(reader.view.textContent, /Impression : Votre compte est limité à la consultation/);
  assert.match(reader.view.textContent, /Émission : Votre compte est limité à la consultation/);
  reader.dom.window.close();
});

function printEnv(design) {
  const detail = { ...BADGE, design, values: { nom_complet: "BENALI Karim", matricule: "K26" }, qr: ["1"], crop: {}, width_mm: design.width, height_mm: design.height, template_name: "Paysage" };
  return setup({ "/employees/7": { value: { ...EMPLOYEE, badge: BADGE, badges: [BADGE] } }, "/3": { value: detail } }, ALL);
}
const LANDSCAPE = { ...DESIGN, width: 85.6, height: 54, pages: [DESIGN.pages[0], { ...DESIGN.pages[0], name: "Verso" }] };

test("direct print: 85,6 × 54 mm card, recto and verso, checked against the model before the print dialog", async () => {
  const env = printEnv(LANDSCAPE);
  env.w.__pdf = { pages: [[85.6, 54], [85.6, 54]], header: "85.6x54" };
  await show(env, "creer", "#/drh/badges/creer/7");
  env.view.querySelector('[data-bs="print-dialog"]').click(); await settle();
  const modal = env.w.document.querySelector("[data-bs-pv]");
  assert.match(modal.querySelector("[data-pv-layout]").options[0].textContent, /85,6 × 54 mm/);
  assert.match(modal.querySelector("[data-pv-print]").textContent, /^Imprimer$/);
  modal.querySelector("[data-pv-print]").click(); await settle(); await settle();
  assert.deepEqual(JSON.parse(env.calls.find(c => c[0] === "fetch")[2].body), { badge_ids: [3], layout: "card" });
  assert.ok(env.calls.some(c => c[0] === "print"));
  assert.ok(env.calls.some(c => c[0] === "toast" && /85,6 × 54 mm — 2 pages \(recto et verso\)/.test(c[1]) && c[2] === "success"));
  assert.ok(!env.calls.some(c => c[0] === "download"));
  env.dom.window.close();
});

test("direct print refuses a document whose size differs from the model (never a silent 54 × 86)", async () => {
  const env = printEnv(LANDSCAPE);
  env.w.__pdf = { pages: [[54, 86]], header: "54x86" };
  await show(env, "creer", "#/drh/badges/creer/7");
  env.view.querySelector('[data-bs="print-dialog"]').click(); await settle();
  env.w.document.querySelector("[data-pv-print]").click(); await settle(); await settle();
  assert.ok(!env.calls.some(c => c[0] === "print"));
  assert.ok(env.calls.some(c => c[0] === "toast" && /Taille du document \(54 × 86 mm\) différente du modèle \(85,6 × 54 mm\)/.test(c[1]) && c[2] === "error"));
  assert.ok(env.w.document.querySelector("[data-bs-pv]"), "la fenêtre reste ouverte pour corriger");
  env.dom.window.close();
});

test("when the browser blocks the print dialog, an explicit message is shown and the PDF opens in a tab", async () => {
  const env = printEnv(LANDSCAPE);
  env.w.__pdf = { pages: [[85.6, 54], [85.6, 54]], header: "85.6x54" }; env.w.__printBlocked = true;
  await show(env, "creer", "#/drh/badges/creer/7");
  env.view.querySelector('[data-bs="print-dialog"]').click(); await settle();
  env.w.document.querySelector("[data-pv-print]").click(); await settle(); await settle();
  assert.ok(env.calls.some(c => c[0] === "download" && c[2] === "onglet"));
  assert.ok(env.calls.some(c => c[0] === "toast" && /bloqué l'ouverture automatique de la fenêtre d'impression/.test(c[1]) && /85,6 × 54 mm/.test(c[1])));
  env.dom.window.close();
});

test("the PDF can still be downloaded on purpose, without printing", async () => {
  const env = printEnv(DESIGN);
  env.w.__pdf = { pages: [[54, 86]], header: "54x86" };
  await show(env, "creer", "#/drh/badges/creer/7");
  env.view.querySelector('[data-bs="print-dialog"]').click(); await settle();
  env.w.document.querySelector("[data-pv-download]").click(); await settle(); await settle();
  assert.ok(env.calls.some(c => c[0] === "download" && c[2] === "badge.pdf"));
  assert.ok(!env.calls.some(c => c[0] === "print"));
  env.dom.window.close();
});
