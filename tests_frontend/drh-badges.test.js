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
const DRH = read("app/static/js/modules/drh.js");
const POSITIONS = read("app/static/js/modules/positions.js");

const DESIGN = {
  width: 54, height: 86,
  pages: [{ name: "Recto", background: "#FFFFFF", elements: [
    { id: "band", type: "shape", shape: "polygon", points: [[0, 0], [1, 0], [1, 1], [0, 1]], x: 0, y: 0, w: 54, h: 16, fill: "#111111", rotation: 0, opacity: 1 },
    { id: "site", type: "text", text: "SITE : {{site_code}}", x: 3, y: 5, w: 42, h: 6, size: 12, bold: true, color: "#FFFFFF", align: "center", uppercase: true, autoFit: true, rotation: 0, opacity: 1 },
    { id: "photo", type: "photo", x: 16, y: 18, w: 21, h: 24, stroke: "#FFCB05", strokeWidth: 0.45, radius: 1, rotation: 0, opacity: 1 },
    { id: "code", type: "text", text: "CODE : **{{matricule}}**", x: 3, y: 53, w: 48, h: 4, size: 9, color: "#111111", align: "center", rotation: 0, opacity: 1 },
    { id: "qr", type: "qr", x: 20, y: 58, w: 14, h: 14, color: "#111111", background: "", rotation: 0, opacity: 1 },
  ] }],
};
const TEMPLATE = { id: 1, name: "IRON GLOBAL — Référence", society: null, is_system: true, is_default: true, version: 1, width_mm: 54, height_mm: 86, design: DESIGN };
const EMPLOYEE = {
  id: 7, societe: "IGS", nom: "<img src=x onerror=alert(1)>", prenom: "Mohamed", nom_complet: "X Mohamed", matricule: "K26", fonction: "Cariste",
  site: "Site A", site_code: "ETP/DF/H01", statut: "actif", has_photo: false, badge: null, badges: [], qr: ["101", "010", "101"],
  default_template_id: 1, can_issue: true, settings: {},
};

const ALL = { create: true, validate: true, export: true, admin: true };

function setup(routes, hash) {
  routes = { "/permissions": { value: ALL }, ...routes };
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="view"></div><div id="modal-host"></div></body></html>', {
    runScripts: "outside-only", url: "https://drh.irongs.com/" + (hash || "#/drh/badges/dashboard"),
  });
  const w = dom.window;
  const calls = [];
  w.sgdiApi = async (url, options) => {
    calls.push([url, options]);
    const key = Object.keys(routes).find(k => url.startsWith("/drh/badges" + k) && ((options && options.method) || "GET") === (routes[k].method || "GET"));
    if (!key) throw new Error("Appel inattendu : " + url);
    const value = routes[key].value;
    return JSON.parse(JSON.stringify(typeof value === "function" ? value(url, options) : value));
  };
  w.sgdiApiUrl = p => "/api" + p;
  w.sgdiAuthHeaders = () => ({});
  w.toast = (message, type) => calls.push(["toast", message, type]);
  w.confirm = () => true;
  w.eval(REGISTRY);
  w.eval(STUDIO);
  w.eval(BADGES);
  return { dom, w, calls, view: w.document.getElementById("view") };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("badge modules are lazy dependencies of the DRH module, under the DRH route", () => {
  const { dom, w } = setup({});
  assert.deepEqual(Array.from(w.SGDIModules.getModule("badges").dependencies), ["badges-studio"]);
  assert.equal(w.SGDIModules.moduleKeyForRoute("badges"), null);
  assert.match(DRH, /dependencies: \["drh-dashboard", "leaves", "badges"\]/);
  assert.match(DRH, /if\(sub==="badges"\)\{[\s\S]*?return renderBadgeStudio\(view,arg\|\|"dashboard"\);\n  \}\n  sgdiEnsureEmployeesForDisplay/);
  dom.window.close();
});

test("the DRH sidebar no longer lists badge screens; the employee sheet opens the badge portal", () => {
  assert.equal([...SHELL.matchAll(/group:"GESTION DES BADGES"/g)].length, 0);              // phase B : portail badge.irongs.com
  assert.ok(SHELL.includes("data-badge-studio-link") && SHELL.includes(">Créer / gérer le badge</button>"));
  assert.ok(SHELL.includes(`onclick="openBadgeStudio(badgeStudioRoute(`));
  assert.ok(POSITIONS.includes('sub==="badge"){if(typeof badgeStudioAvailable==="function"&&badgeStudioAvailable()){const portal=typeof badgePortalUrl==="function"?badgePortalUrl(badgeStudioRoute()):null;location.replace(portal||'));
});

test("a badge face is drawn from the design with escaped employee values", () => {
  const { dom, w } = setup({});
  const svg = w.BadgeStudio.badgeSvg(DESIGN, 0, { values: { site_code: "etp/df/h01", matricule: "<b>K26</b>" }, qr: ["101", "010", "101"] }, {});
  assert.match(svg, /viewBox="0 0 54 86"/);
  assert.match(svg, />SITE : ETP\/DF\/H01</);
  assert.match(svg, /<tspan font-weight="400">CODE : <\/tspan><tspan font-weight="700">&lt;b&gt;K26&lt;\/b&gt;<\/tspan>/);
  assert.doesNotMatch(svg, /<b>K26/);
  assert.equal((svg.match(/<path d="M20 58h/g) || []).length, 1);
  const hostile = JSON.parse(JSON.stringify(DESIGN));
  hostile.pages[0].background = 'red" onload="alert(1)';
  hostile.pages[0].elements.push({ id: 'x" onclick="1', type: "image", src: "javascript:alert(1)", x: 0, y: 0, w: 5, h: 5, fit: "cover", opacity: 1 },
    { id: "t", type: "text", text: "a", x: 0, y: 0, w: 5, h: 5, size: 8, color: "url(#x)", font: '"><script>', opacity: 1 });
  const out = w.BadgeStudio.badgeSvg(hostile, 0, {}, {});
  assert.doesNotMatch(out, /onload=|javascript:|<script|onclick="1/);
  assert.match(out, /fill="#FFFFFF"/);
  dom.window.close();
});

test("the lanyard and holder only exist in the realistic on-screen preview", () => {
  const { dom, w } = setup({});
  const flat = w.BadgeStudio.previewHTML(DESIGN, {}, {});
  const real = w.BadgeStudio.previewHTML(DESIGN, {}, { realistic: true });
  assert.doesNotMatch(flat, /bs-lanyard|bs-holder/);
  assert.match(real, /bs-lanyard/); assert.match(real, /bs-holder/);
  assert.doesNotMatch(w.BadgeStudio.badgeSvg(DESIGN, 0, {}, {}), /lanyard|holder/);
  const box = w.BadgeStudio.coverBox(300, 400, 21, 24, { zoom: 2, dx: 0.5, dy: -0.5 });
  assert.ok(Math.abs(box.x + box.w - 21) < 1e-9 && Math.abs(box.y) < 1e-9 && box.w >= 21 && box.h >= 24);
  dom.window.close();
});

test("dashboard, staff list and history render from the scoped API", async () => {
  const row = { ...EMPLOYEE, badge: { id: 3, number: "BDG-2026-000003", status: "ACTIF", issued_at: "2026-10-01T08:00:00", print_count: 0 } };
  const { dom, w, calls, view } = setup({
    "/dashboard": { value: { employees: 12, with_badge: 5, without_badge: 7, without_photo: 2, to_print: 3, expiring: 0, revoked: 1, issued_this_month: 4, templates: 1, recent: [{ action: "EMISSION", label: "Badge <i>émis</i>", created_at: "2026-10-01T08:00:00", username: "drh" }] } },
    "/employees": { value: { items: [row], total: 1, page: 1, pages: 1, page_size: 50 } },
    "/templates": { value: { items: [TEMPLATE], fields: { nom: "Nom" }, fonts: ["Helvetica"] } },
    "/history": { value: { items: [{ id: 1, action: "IMPRESSION", label: "Badge imprimé", created_at: "2026-10-02T09:00:00", society: "IGS", username: "drh", employee_id: 7 }], total: 1, page: 1, pages: 1 } },
  });
  w.renderBadgeStudio(view, "dashboard"); await settle();
  assert.equal(view.querySelectorAll(".bs-kpi").length, 9);
  assert.equal(view.querySelectorAll(".bs-tabs a").length, 8);
  assert.match(view.textContent, /Badge <i>émis<\/i>/);                 // affiché comme du texte, jamais interprété
  assert.equal(view.querySelector(".bs-activity i"), null);

  w.location.hash = "#/drh/badges/personnel/to_print";
  w.renderBadgeStudio(view, "personnel"); await settle();
  assert.match(calls.find(c => String(c[0]).includes("/employees?"))[0], /state=to_print/);
  assert.equal(view.querySelector(".bs-table img"), null);
  assert.match(view.querySelector(".bs-table").textContent, /BDG-2026-000003/);
  assert.equal(view.querySelector('.bs-row-actions a').getAttribute("href"), "#/drh/badges/creer/7");
  assert.equal(view.querySelector('[data-bs="check"]'), null);

  w.location.hash = "#/drh/badges/lot";
  w.renderBadgeStudio(view, "lot"); await settle();
  view.querySelector('[data-bs="check"]').click();
  assert.equal(view.querySelector("[data-bs-count]").textContent, "1");

  w.renderBadgeStudio(view, "historique"); await settle();
  assert.match(view.querySelector(".bs-table").textContent, /Impression/);
  const before = calls.length, node = view.querySelector(".bs-table");
  w.renderBadgeStudio(view, "historique"); await settle();              // nouveau rendu demandé par l'application : rien n'est rechargé
  assert.equal(calls.length, before); assert.equal(view.querySelector(".bs-table"), node);
  dom.window.close();
});

test("issuing a badge posts the employee, the chosen template and the photo framing", async () => {
  const issued = [];
  const { dom, w, calls, view } = setup({
    "/templates": { value: { items: [TEMPLATE], fields: {}, fonts: ["Helvetica"] } },
    "/employees/7": { value: EMPLOYEE },
    "/issue": { method: "POST", value: (url, options) => { issued.push(options.body); return { id: 9, number: "BDG-2026-000009" }; } },
  }, "#/drh/badges/creer/7");
  w.renderBadgeStudio(view, "creer"); await settle();
  assert.equal(view.querySelector(".bs-dl img"), null);
  assert.match(view.querySelector(".bs-dl").textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(view.querySelector("[data-bs-preview]").innerHTML, /bs-holder/);
  assert.match(view.textContent, /Aucune photo sur la fiche/);
  view.querySelector('[data-bs="view-flat"]').click();
  assert.doesNotMatch(view.querySelector("[data-bs-preview]").innerHTML, /bs-holder/);
  view.querySelector('[data-bs="issue"]').click(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(issued[0])), { employee_id: 7, template_id: 1, crop: { zoom: 1, dx: 0, dy: 0 }, valid_until: null });
  assert.ok(calls.some(c => c[0] === "toast" && /BDG-2026-000009/.test(c[1])));
  dom.window.close();
});

test("the studio edits a copy of the reference: add, move, undo, arrange, save", async () => {
  const saved = [];
  const { dom, w, view } = setup({
    "/templates": { value: { items: [TEMPLATE], fields: { nom: "Nom", matricule: "Matricule" }, fonts: ["Helvetica", "Times"] } },
    "/templates ": { value: null },
  }, "#/drh/badges/studio/1");
  const original = w.sgdiApi;
  w.sgdiApi = async (url, options) => {
    if (options && options.method === "POST" && url === "/drh/badges/templates") { saved.push(options.body); return { id: 5, name: options.body.name, version: 1, design: options.body.design }; }
    return original(url, options);
  };
  w.renderBadgeStudio(view, "studio"); await settle();
  const ed = w.BadgeStudioEditor.state;
  assert.equal(ed.id, null);                                             // le modèle de référence s'ouvre en copie
  assert.equal(view.querySelectorAll('[data-st="tool"]').length, 14);
  assert.ok(view.querySelector('[data-st="tool"][data-tool="blood"]'), "outil Groupe sanguin");
  assert.equal(view.querySelector('[data-st="save"]').dataset.noSaveOverlay, "1");   // pas d'indicateur global « Enregistrement en cours »

  // Règles graduées en millimètres, grille, aimant et guides.
  const rulerH = view.querySelector('[data-st-ruler="h"]'), rulerV = view.querySelector('[data-st-ruler="v"]');
  assert.equal(Number(rulerH.getAttribute("width")), 54 * ed.zoom); assert.equal(Number(rulerV.getAttribute("height")), 86 * ed.zoom);
  assert.deepEqual([...rulerH.querySelectorAll("text")].map(t => t.textContent), ["0", "10", "20", "30", "40", "50"]);
  assert.equal(rulerV.querySelectorAll("text").length, 9);
  assert.match(rulerH.getAttribute("aria-label"), /millimètres \(54 mm\)/);
  assert.ok(view.querySelector(".bs-st-grid"));
  view.querySelector('[data-st="toggle-grid"]').click();
  assert.equal(view.querySelector(".bs-st-grid"), null);
  assert.equal(ed.snap, true);
  ed.guides.v.push(20);
  view.querySelector('[data-st="toggle-grid"]').click();
  assert.equal(view.querySelectorAll('.bs-st-guide[data-guide="v"]').length, 1);
  assert.equal(view.querySelectorAll(".bs-st-pin").length, 1);
  view.querySelector('[data-st="clear-guides"]').click();
  assert.equal(ed.guides.v.length, 0);
  assert.match(view.querySelector("[data-st-warnings]").textContent, /QR code conforme/);
  const qr = ed.design.pages[0].elements.find(e => e.type === "qr");
  qr.w = 8; qr.color = "#FFEE88";
  view.querySelector('[data-st="toggle-snap"]').click();
  assert.equal(ed.snap, false);
  assert.match(view.querySelector("[data-st-warnings]").textContent, /12 mm au minimum[\s\S]*carré[\s\S]*contraste insuffisant/);
  qr.w = 14; qr.color = "#111111";
  view.querySelector('[data-st="toggle-snap"]').click();
  assert.equal(view.querySelectorAll(".bs-st-layers li").length, 5);
  const count = () => ed.design.pages[0].elements.length;

  view.querySelector('[data-tool="rect"]').click();
  assert.equal(count(), 6); assert.equal(ed.sel.length, 1);
  const rect = ed.design.pages[0].elements.at(-1);
  assert.equal(rect.x, 17); assert.equal(rect.y, 37);                    // centré sur la carte, sur la grille
  view.querySelector('[data-st="align-left"]').click();
  assert.equal(ed.design.pages[0].elements.at(-1).x, 0);
  view.querySelector('[data-st="duplicate"]').click();
  assert.equal(count(), 7);
  view.querySelector('[data-st="back"]').click();
  assert.equal(ed.design.pages[0].elements[0].id, ed.sel[0]);
  view.querySelector('[data-st="lock"]').click();
  view.querySelector('[data-st="delete"]').click();
  assert.equal(count(), 7);                                              // un élément verrouillé ne se supprime pas
  for (let i = 0; i < 4; i++) view.querySelector('[data-st="undo"]').click();
  assert.equal(count(), 6);
  view.querySelector('[data-st="undo"]').click(); view.querySelector('[data-st="undo"]').click();
  assert.equal(count(), 5);
  view.querySelector('[data-st="redo"]').click();
  assert.equal(count(), 6);

  view.querySelector('[data-tool="field"]').click();
  view.querySelector('[data-field="matricule"]').click();
  assert.equal(ed.design.pages[0].elements.at(-1).text, "{{matricule}}");
  const size = view.querySelector('[data-p="size"]');
  size.value = "14"; size.dispatchEvent(new w.Event("input", { bubbles: true })); size.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(ed.design.pages[0].elements.at(-1).size, 14);
  view.querySelector('[data-st="add-back"]').click();
  assert.equal(ed.design.pages.length, 2); assert.equal(ed.page, 1);

  const name = view.querySelector('[data-st="name"]');
  name.value = "IGS vertical"; name.dispatchEvent(new w.Event("input", { bubbles: true }));
  view.querySelector('[data-st="save"]').click(); await settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "IGS vertical");
  assert.equal(saved[0].design.pages.length, 2);
  assert.equal(w.location.hash, "#/drh/badges/studio/5");
  w.badgeStudioDestroy();
  dom.window.close();
});

test("without explicit badge permissions the screens stay read-only", async () => {
  const badge = { id: 3, number: "BDG-2026-000003", status: "ACTIF", issued_at: "2026-10-01T08:00:00", print_count: 0, employee_id: 7 };
  const { dom, w, view } = setup({
    "/permissions": { value: { create: false, validate: false, export: false, admin: false } },
    "/templates": { value: { items: [{ ...TEMPLATE, is_system: false, warnings: ["QR « QR code » : 8 mm de côté, 12 mm au minimum pour une lecture fiable."] }], fields: {}, fonts: ["Helvetica"] } },
    "/employees/7": { value: { ...EMPLOYEE, nom: "عبد القادر", unprintable: ["Nom"], badge, badges: [badge] } },
    "/employees": { value: { items: [], total: 0, page: 1, pages: 1 } },
    "/settings": { value: { data: { number_prefix: "BDG", validity_months: 0, photo_source: "portrait", require_photo: true, print_layout: "card", sheet_margin_mm: 10, sheet_gap_mm: 4, crop_marks: true }, card: { width_mm: 54, height_mm: 86 } } },
  }, "#/drh/badges/creer/7");
  w.renderBadgeStudio(view, "creer"); await settle();
  for (const action of ["issue", "print", "revoke"]) assert.equal(view.querySelector(`[data-bs="${action}"]`), null, action);
  assert.ok(view.querySelector('[data-bs="show-issued"]')); assert.ok(view.querySelector('[data-bs="proof"]'));
  assert.match(view.textContent, /Permission requise/); assert.match(view.textContent, /Caractères non imprimables[\s\S]*Nom/);
  w.location.hash = "#/drh/badges/modeles";
  w.renderBadgeStudio(view, "modeles"); await settle();
  assert.equal(view.querySelector('[data-bs="tpl-duplicate"],[data-bs="tpl-archive"],[data-bs="tpl-default"],a[href*="studio/"]:not(.bs-tabs a)'), null);
  assert.match(view.querySelector(".bs-warnings").textContent, /12 mm au minimum/);
  w.location.hash = "#/drh/badges/lot";
  w.renderBadgeStudio(view, "lot"); await settle();
  assert.equal(view.querySelector('[data-bs="lot-issue-print"],[data-bs="lot-print"]'), null);
  w.location.hash = "#/drh/badges/parametres";
  w.renderBadgeStudio(view, "parametres"); await settle();
  assert.equal(view.querySelector('button[type="submit"]'), null);
  w.location.hash = "#/drh/badges/studio/1";
  w.renderBadgeStudio(view, "studio"); await settle();
  assert.equal(view.querySelector('[data-st="save"]'), null);
  w.badgeStudioDestroy();
  dom.window.close();
});

test("the legacy badge screen draws its QR from the server and logs every print before printing", () => {
  const start = SHELL.indexOf("function badgeQrSrc(");
  const body = SHELL.slice(start, SHELL.indexOf("\n}", start));
  assert.doesNotMatch(body, /https?:\/\//);
  assert.match(body, /badgePublicQrCache\[ref\]/);
  assert.equal((POSITIONS.match(/if\(!\(await badgeLegacyPrintLog\(/g) || []).length, 2);
  assert.doesNotMatch(POSITIONS + BADGES + STUDIO, /qrserver/);
  assert.match(SHELL, /Impression non tracée, donc annulée/);
});

test("the preview draws Arabic and mixed names with the bundled font, each run isolated for its own direction", () => {
  const { dom, w } = setup({});
  const B = w.BadgeStudio;
  for (const latin of ["ÉLÉONORE BEN-AÏSSA", "Zoé Œuvre – « ça » €", "K26", ""]) assert.equal(B.isLatin(latin), true, latin);
  for (const other of ["عبد القادر", "Mohamed محمد", "漢字"]) assert.equal(B.isLatin(other), false, other);
  const design = { width: 54, height: 86, pages: [{ name: "Recto", background: "#FFFFFF", elements: [
    { id: "nom", type: "text", text: "{{nom}}", x: 3, y: 43, w: 48, h: 5, size: 11.5, bold: true, color: "#111111", align: "center", uppercase: true, autoFit: true, opacity: 1 },
    { id: "prenom", type: "text", text: "{{prenom}}", x: 3, y: 48, w: 48, h: 4, size: 8, color: "#222222", align: "center", uppercase: true, opacity: 1 },
    { id: "code", type: "text", text: "CODE : **{{matricule}}**", x: 3, y: 53, w: 48, h: 4, size: 9, color: "#111111", align: "center", opacity: 1 },
    { id: "bloc", type: "text", text: "{{fonction}}", x: 3, y: 60, w: 20, h: 12, size: 8, color: "#111111", align: "right", wrap: true, opacity: 1 },
  ] }] };
  const cases = [["عبد القادر", "Mohamed"], ["Abdelkader", "محمد"], ["Bensalem", "ياسين"], ["بن سالم", "Yacine"], ["عبد القادر Abdelkader", "Zoé محمد"]];
  for (const [nom, prenom] of cases) {
    const svg = B.badgeSvg(design, 0, { values: { nom, prenom, matricule: "K26", fonction: "مشرف الموقع الرئيسي" } }, {});
    for (const value of [nom, prenom]) {
      if (B.isLatin(value)) { assert.ok(svg.includes(`>${value.toUpperCase()}</tspan>`), value); continue; }
      const shown = value.toUpperCase();
      assert.ok(svg.includes(`font-family="BadgeUnicode, sans-serif" font-style="normal">⁨${shown}⁩</tspan>`), value);   // texte logique, isolé
    }
    assert.match(svg, /<tspan font-weight="400">CODE : <\/tspan><tspan font-weight="700">K26<\/tspan>/);               // segments latins inchangés
    assert.match(svg, /text-anchor="end"[^>]*font-family="BadgeUnicode, sans-serif"[^>]*>⁨/);                      // bloc multiligne arabe
  }
  const accents = B.badgeSvg(design, 0, { values: { nom: "Éléonore", prenom: "Zoé", matricule: "K1", fonction: "Contrôleur" } }, {});
  assert.doesNotMatch(accents, /BadgeUnicode|⁨/);                                                                   // le français garde Helvetica
  assert.ok(BADGES.includes("url(/static/fonts/${file})") && BADGES.includes('"DejaVuSans.ttf"') && BADGES.includes('"DejaVuSans-Bold.ttf"'));
  assert.doesNotMatch(BADGES + STUDIO, /https?:\/\/(?!www\.w3\.org)/);                                                  // aucune ressource externe
  for (const file of ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVu-LICENSE.txt"]) assert.ok(fs.existsSync(path.join(ROOT, "app/static/fonts", file)), file);
  dom.window.close();
});
