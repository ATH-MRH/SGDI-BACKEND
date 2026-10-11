/* Studio Badges DRH — éditeur graphique des modèles (#/drh/badges/studio[/id]).
   Outils à gauche, surface de conception au centre, propriétés et calques autour. La maquette
   est le même document en millimètres que celui rendu en PDF par le serveur. */
(function () {
  "use strict";

  const B = () => window.BadgeStudio;
  const GRID = 0.5;
  const TOOLS = [
    ["text", "Texte"], ["field", "Champ"], ["photo", "Photo"], ["logo", "Logo"], ["image", "Image"], ["qr", "QR code"], ["rect", "Rectangle"],
    ["line", "Ligne"], ["ellipse", "Forme ronde"], ["triangle", "Triangle"], ["band", "Bandeau"], ["background", "Fond"], ["layers", "Calques"],
  ];
  // Icônes dessinées (aucune dépendance à une police de symboles ou d'émojis).
  const ICONS = {
    text: "M5 6V4h14v2M12 4v16M9 20h6", field: "M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 2-1 3-3 3",
    photo: "M4 4h16v16H4zM12 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7 20c0-3 2-5 5-5s5 2 5 5", logo: "M12 3l9 9-9 9-9-9z",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4", qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 16h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
    rect: "M4 7h16v10H4z", line: "M4 12h16", ellipse: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", triangle: "M12 5l8 14H4z", band: "M3 5h18v6H3zM3 15h18",
    background: "M4 4h16v16H4zM4 14L14 4M9 20L20 9M4 9l5-5", layers: "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5",
    "align-left": "M4 4v16M8 7h10v4H8zM8 14h6v4H8z", "align-hcenter": "M12 3v18M6 7h12v4H6zM8 14h8v4H8z", "align-right": "M20 4v16M6 7h10v4H6zM10 14h6v4h-6z",
    "align-top": "M4 4h16M7 8h4v10H7zM14 8h4v6h-4z", "align-vcenter": "M3 12h18M7 6h4v12H7zM14 8h4v8h-4z", "align-bottom": "M4 20h16M7 6h4v10H7zM14 10h4v6h-4z",
    front: "M9 9h11v11H9zM4 15V4h11", forward: "M12 19V6M6 11l6-6 6 6", backward: "M12 5v13M6 13l6 6 6-6", back: "M4 4h11v11H4zM20 9v11H9",
    duplicate: "M8 8h12v12H8zM16 8V4H4v12h4", copy: "M9 4h10v12H9zM5 8v12h10", paste: "M9 4h6v3H9zM9 5H6v15h12V5h-3",
    lock: "M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11", unlock: "M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1", delete: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
    undo: "M8 8L4 12l4 4M4 12h11a4 4 0 0 1 0 8h-3", redo: "M16 8l4 4-4 4M20 12H9a4 4 0 0 0 0 8h3",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "eye-off": "M3 3l18 18M2 12s4-7 10-7c2 0 3.8.7 5.3 1.7M22 12s-4 7-10 7c-2 0-3.8-.7-5.3-1.7",
  };
  const ico = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONS[name] || ""}"/></svg>`;
  const TYPE_LABELS = { text: "Texte", photo: "Photo", qr: "QR code", image: "Image", shape: "Forme", line: "Ligne" };
  const ed = { view: null, id: null, system: false, name: "", society: "", design: null, page: 0, sel: [], zoom: 6, undo: [], redo: [], clip: [], dirty: false, drag: null, typing: false, fieldMenu: false };

  const clone = value => JSON.parse(JSON.stringify(value));
  const page = () => ed.design.pages[ed.page];
  const byId = id => page().elements.find(el => el.id === id);
  const selected = () => ed.sel.map(byId).filter(Boolean);
  const snap = value => Math.round(value / GRID) * GRID;
  const round = value => Math.round(value * 100) / 100;
  function newId() { return "e" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function draftKey() { return "bsDraft:" + (ed.id || "nouveau"); }

  function checkpoint() {
    ed.undo.push(JSON.stringify(ed.design));
    if (ed.undo.length > 80) ed.undo.shift();
    ed.redo = [];
  }
  function changed() {
    ed.dirty = true;
    try { sessionStorage.setItem(draftKey(), JSON.stringify({ name: ed.name, society: ed.society, design: ed.design })); } catch (e) { /* maquette trop lourde pour un brouillon local */ }
    const flag = ed.view && ed.view.querySelector("[data-st-dirty]");
    if (flag) flag.hidden = false;
  }
  function restore(snapshot, from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(ed.design));
    ed.design = JSON.parse(from.pop());
    ed.page = Math.min(ed.page, ed.design.pages.length - 1);
    ed.sel = ed.sel.filter(id => byId(id));
    changed();
    renderAll();
  }

  // ── Montage ───────────────────────────────────────────────────────────────
  async function mount(view, param, alive) {
    B().shell(view, "studio", `<div class="bs-empty">Chargement du studio…</div>`);
    const templates = await B().loadTemplates(true);
    if (!alive()) return;
    const source = templates.find(t => String(t.id) === String(param)) || null;
    const reference = templates.find(t => t.is_system) || templates[0];
    const base = source || reference;
    ed.view = view;
    ed.id = source && !source.is_system ? source.id : null;
    ed.system = !!(source && source.is_system);
    ed.name = source ? (source.is_system ? source.name + " — copie" : source.name) : "Nouveau modèle";
    ed.society = (source && source.society) || B().society() || "";
    ed.design = clone(base.design);
    ed.page = 0; ed.sel = []; ed.undo = []; ed.redo = []; ed.dirty = false; ed.drag = null;
    let restored = false;
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey()) || "null");
      if (draft && draft.design && JSON.stringify(draft.design) !== JSON.stringify(ed.design)) {
        ed.design = draft.design; ed.name = draft.name || ed.name; ed.society = draft.society || ed.society; ed.dirty = true; restored = true;
      }
    } catch (e) { /* brouillon illisible : ignoré */ }
    ensureStyles();
    renderAll();
    fitZoom();
    document.removeEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey);
    if (restored) B().notify("Brouillon non enregistré restauré.", "info");
  }
  function destroy() {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    ed.view = null; ed.drag = null;
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function societies() {
    const list = typeof drhAuthorizedSocieties === "function" ? (drhAuthorizedSocieties() || []) : [];
    return [...new Set([...list, ed.society, B().society()].filter(Boolean))];
  }
  function renderAll() {
    const view = ed.view, esc = B().esc;
    if (!view || !view.isConnected) return;
    const d = ed.design;
    B().shell(view, "studio", `<div class="bs-studio">
      <div class="bs-st-top card">
        <label class="bs-st-name">Nom du modèle<input class="input" data-st="name" maxlength="150" value="${esc(ed.name)}"></label>
        <label>Société<select class="select" data-st="society"><option value="">Toutes sociétés</option>${societies().map(s => `<option ${s === ed.society ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <div class="bs-st-group" role="group" aria-label="Faces">${d.pages.map((p, i) => `<button class="${i === ed.page ? "is-active" : ""}" data-st="page" data-i="${i}">${esc(p.name)}</button>`).join("")}
          ${d.pages.length < 2 ? `<button data-st="add-back" title="Ajouter un verso">+ Verso</button>` : `<button data-st="remove-back" title="Supprimer le verso">− Verso</button>`}</div>
        <div class="bs-st-group" role="group" aria-label="Historique"><button data-st="undo" title="Annuler (Ctrl+Z)" aria-label="Annuler" ${ed.undo.length ? "" : "disabled"}>${ico("undo")}</button><button data-st="redo" title="Rétablir (Ctrl+Y)" aria-label="Rétablir" ${ed.redo.length ? "" : "disabled"}>${ico("redo")}</button></div>
        <div class="bs-st-group" role="group" aria-label="Zoom"><button data-st="zoom-out" title="Réduire">−</button><button data-st="zoom-fit" title="Ajuster">${Math.round(ed.zoom / 6 * 100)} %</button><button data-st="zoom-in" title="Agrandir">+</button></div>
        <span class="bs-pill is-warn" data-st-dirty ${ed.dirty ? "" : "hidden"}>Non enregistré</span>
      </div>
      <div class="bs-st-main">
        <aside class="bs-st-left card"><h2>Outils</h2><div class="bs-st-tools">${TOOLS.map(([key, label]) => `<button data-st="tool" data-tool="${key}">${ico(key)}${label}</button>`).join("")}</div>
          ${ed.fieldMenu ? `<div class="bs-st-fields">${Object.entries(B().state.fields).map(([key, label]) => `<button data-st="add-field" data-field="${esc(key)}">${esc(label)}</button>`).join("")}</div>` : ""}
          <input type="file" accept="image/png,image/jpeg" data-st="file" hidden>
          <h2 data-st-layers>Calques</h2><ul class="bs-st-layers">${layersHTML()}</ul></aside>
        <section class="bs-st-stage" data-st-stage tabindex="0" aria-label="Surface de conception">
          <div class="bs-st-canvas" data-st-canvas style="width:${d.width * ed.zoom}px;height:${d.height * ed.zoom}px"><div data-st-art></div><svg class="bs-st-overlay" data-st-overlay viewBox="0 0 ${d.width} ${d.height}"></svg></div></section>
        <aside class="bs-st-right card">${arrangeHTML()}<div data-st-props>${propsHTML()}</div></aside>
      </div></div>`,
      `<button class="btn btn-ghost" data-st="preview">Aperçu réaliste</button><button class="btn btn-ghost" data-st="proof">Épreuve PDF</button>${ed.id ? `<button class="btn btn-secondary" data-st="save-copy" data-no-save-overlay="1">Enregistrer une copie</button>` : ""}<button class="btn btn-primary" data-st="save" data-no-save-overlay="1">${ed.id ? "Enregistrer" : "Enregistrer le modèle"}</button>`);
    bind(view);
    renderCanvas();
  }
  function renderCanvas() {
    const view = ed.view;
    if (!view) return;
    const art = view.querySelector("[data-st-art]"), overlay = view.querySelector("[data-st-overlay]");
    if (!art || !overlay) return;
    art.innerHTML = B().badgeSvg(ed.design, ed.page, { values: B().SAMPLE, qr: sampleQr() }, { editable: true });
    const h = 7 / ed.zoom, stroke = 1.4 / ed.zoom;
    let out = "";
    if (ed.drag && ed.drag.guideX !== undefined && ed.drag.guideX !== null) out += `<line x1="${ed.drag.guideX}" y1="-5" x2="${ed.drag.guideX}" y2="${ed.design.height + 5}" stroke="#ec4899" stroke-width="${stroke}"/>`;
    if (ed.drag && ed.drag.guideY !== undefined && ed.drag.guideY !== null) out += `<line x1="-5" y1="${ed.drag.guideY}" x2="${ed.design.width + 5}" y2="${ed.drag.guideY}" stroke="#ec4899" stroke-width="${stroke}"/>`;
    const items = selected();
    items.forEach(el => {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      out += `<g transform="rotate(${el.rotation || 0} ${cx} ${cy})"><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="none" stroke="${el.locked ? "#f59e0b" : "#0d6ecc"}" stroke-width="${stroke}"${el.locked ? ` stroke-dasharray="${stroke * 3}"` : ""}/>`;
      if (items.length === 1 && !el.locked) {
        [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([hx, hy]) => {
          out += `<rect class="bs-st-handle" data-hx="${hx}" data-hy="${hy}" x="${cx + hx * el.w / 2 - h / 2}" y="${cy + hy * el.h / 2 - h / 2}" width="${h}" height="${h}" fill="#fff" stroke="#0d6ecc" stroke-width="${stroke}"/>`;
        });
        out += `<line x1="${cx}" y1="${el.y}" x2="${cx}" y2="${el.y - h * 2.4}" stroke="#0d6ecc" stroke-width="${stroke}"/><circle class="bs-st-handle" data-rotate="1" cx="${cx}" cy="${el.y - h * 2.4}" r="${h / 1.6}" fill="#fff" stroke="#0d6ecc" stroke-width="${stroke}"/>`;
      }
      out += "</g>";
    });
    if (ed.drag && ed.drag.mode === "marquee") { const m = ed.drag; out += `<rect x="${Math.min(m.x0, m.x1)}" y="${Math.min(m.y0, m.y1)}" width="${Math.abs(m.x1 - m.x0)}" height="${Math.abs(m.y1 - m.y0)}" fill="rgba(13,110,204,.1)" stroke="#0d6ecc" stroke-width="${stroke}"/>`; }
    overlay.innerHTML = out;
  }
  let qrCache = null;
  function sampleQr() {
    if (!qrCache) { // motif d'aperçu (le vrai QR est calculé par le serveur à l'émission)
      const n = 25, rows = [];
      for (let r = 0; r < n; r++) {
        let line = "";
        for (let c = 0; c < n; c++) {
          const finder = (a, b) => a < 7 && b < 7 && (a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5));
          const zone = (r < 8 && c < 8) || (r < 8 && c > n - 9) || (r > n - 9 && c < 8);
          line += (finder(r, c) || finder(r, n - 1 - c) || finder(n - 1 - r, c) || (!zone && ((r * 7 + c * 13 + r * c) % 5 < 2))) ? "1" : "0";
        }
        rows.push(line);
      }
      qrCache = rows;
    }
    return qrCache;
  }
  function layersHTML() {
    const esc = B().esc;
    const items = page().elements.slice().reverse();
    if (!items.length) return `<li class="bs-muted">Aucun élément sur cette face.</li>`;
    return items.map(el => `<li class="${ed.sel.includes(el.id) ? "is-active" : ""}">
      <button class="bs-st-layer" data-st="layer" data-id="${esc(el.id)}">${esc(el.name || TYPE_LABELS[el.type] || el.type)}</button>
      <button data-st="layer-hide" data-id="${esc(el.id)}" title="${el.hidden ? "Afficher" : "Masquer"}" aria-label="${el.hidden ? "Afficher" : "Masquer"}" aria-pressed="${!!el.hidden}">${ico(el.hidden ? "eye-off" : "eye")}</button>
      <button data-st="layer-lock" data-id="${esc(el.id)}" title="${el.locked ? "Déverrouiller" : "Verrouiller"}" aria-label="${el.locked ? "Déverrouiller" : "Verrouiller"}" aria-pressed="${!!el.locked}">${ico(el.locked ? "lock" : "unlock")}</button></li>`).join("");
  }
  function arrangeHTML() {
    const off = ed.sel.length ? "" : "disabled";
    const b = (action, title) => `<button data-st="${action}" title="${title}" aria-label="${title}" ${action === "paste" ? (ed.clip.length ? "" : "disabled") : off}>${ico(action)}</button>`;
    return `<h2>Disposition</h2><div class="bs-st-arrange">
      ${b("align-left", "Aligner à gauche")}${b("align-hcenter", "Centrer horizontalement")}${b("align-right", "Aligner à droite")}
      ${b("align-top", "Aligner en haut")}${b("align-vcenter", "Centrer verticalement")}${b("align-bottom", "Aligner en bas")}
      ${b("front", "Premier plan")}${b("forward", "Avancer")}${b("backward", "Reculer")}${b("back", "Arrière-plan")}
      ${b("duplicate", "Dupliquer (Ctrl+D)")}${b("copy", "Copier (Ctrl+C)")}${b("paste", "Coller (Ctrl+V)")}
      ${b("lock", "Verrouiller / déverrouiller")}${b("delete", "Supprimer (Suppr)")}</div>`;
  }
  function field(label, prop, value, kind, extra) {
    const esc = B().esc;
    if (kind === "bool") return `<label class="bs-inline"><input type="checkbox" data-p="${prop}" data-kind="bool" ${value ? "checked" : ""}> ${label}</label>`;
    if (kind === "color") return `<label>${label}<input type="color" data-p="${prop}" data-kind="color" value="${esc(value || "#000000")}"></label>`;
    if (kind === "nullable") return `<label>${label}<span class="bs-st-nullable"><input type="color" data-p="${prop}" data-kind="color" value="${esc(value || "#FFFFFF")}" ${value ? "" : "disabled"}><label class="bs-inline"><input type="checkbox" data-p="${prop}" data-kind="none" ${value ? "" : "checked"}> Aucun</label></span></label>`;
    if (kind === "select") return `<label>${label}<select class="select" data-p="${prop}" data-kind="text">${extra.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    if (kind === "area") return `<label>${label}<textarea class="input" rows="3" data-p="${prop}" data-kind="text" maxlength="500">${esc(value)}</textarea></label>`;
    if (kind === "text") return `<label>${label}<input class="input" data-p="${prop}" data-kind="text" value="${esc(value)}" maxlength="80"></label>`;
    return `<label>${label}<input class="input" type="number" data-p="${prop}" data-kind="num" value="${round(Number(value) || 0)}" step="${(extra && extra.step) || 0.5}" ${extra && extra.min !== undefined ? `min="${extra.min}"` : ""} ${extra && extra.max !== undefined ? `max="${extra.max}"` : ""}></label>`;
  }
  function propsHTML() {
    const items = selected();
    if (!items.length) {
      const d = ed.design;
      return `<h2>Face — ${B().esc(page().name)}</h2><div class="bs-st-form">
        <label>Fond<input type="color" data-pp="background" value="${B().esc(page().background)}"></label>
        <label>Largeur (mm)<input class="input" type="number" data-pp="width" min="20" max="300" step="0.5" value="${d.width}"></label>
        <label>Hauteur (mm)<input class="input" type="number" data-pp="height" min="20" max="300" step="0.5" value="${d.height}"></label>
        <button class="btn btn-ghost" data-st="swap-size">Inverser portrait / paysage</button>
        <p class="bs-muted">Format CR80 : 54 × 86 mm. Sélectionnez un élément pour modifier ses propriétés ; Maj + clic pour en sélectionner plusieurs.</p></div>`;
    }
    if (items.length > 1) return `<h2>${items.length} éléments</h2><div class="bs-st-form">${field("Opacité", "opacity", items[0].opacity, "num", { step: 0.05, min: 0, max: 1 })}<p class="bs-muted">Utilisez la disposition pour aligner, centrer, dupliquer ou verrouiller la sélection.</p></div>`;
    const el = items[0];
    let specific = "";
    if (el.type === "text") specific = field("Texte (champs {{…}}, gras entre **)", "text", el.text, "area") +
      `<label>Insérer un champ<select class="select" data-st="insert-field"><option value="">Choisir…</option>${Object.entries(B().state.fields).map(([key, label]) => `<option value="${B().esc(key)}">${B().esc(label)}</option>`).join("")}</select></label>` +
      field("Police", "font", el.font, "select", (B().state.fonts || ["Helvetica"]).map(f => [f, f])) + field("Taille (pt)", "size", el.size, "num", { step: 0.5, min: 3, max: 160 }) +
      field("Alignement", "align", el.align, "select", [["left", "Gauche"], ["center", "Centré"], ["right", "Droite"]]) + field("Couleur", "color", el.color, "color") +
      `<div class="bs-st-checks">${field("Gras", "bold", el.bold, "bool")}${field("Italique", "italic", el.italic, "bool")}${field("Majuscules", "uppercase", el.uppercase, "bool")}${field("Réduire si trop long", "autoFit", el.autoFit, "bool")}${field("Retour à la ligne", "wrap", el.wrap, "bool")}</div>`;
    else if (el.type === "shape") specific = field("Remplissage", "fill", el.fill, "nullable") + field("Contour", "stroke", el.stroke, "nullable") + field("Épaisseur du contour (mm)", "strokeWidth", el.strokeWidth, "num", { step: 0.1, min: 0, max: 10 }) + (el.shape === "rect" ? field("Arrondi (mm)", "radius", el.radius, "num", { step: 0.5, min: 0, max: 100 }) : "");
    else if (el.type === "line") specific = field("Couleur", "stroke", el.stroke, "color") + field("Épaisseur (mm)", "strokeWidth", el.strokeWidth, "num", { step: 0.05, min: 0.05, max: 10 }) + field("Pointillés", "dash", el.dash, "bool");
    else if (el.type === "photo") specific = field("Bordure", "stroke", el.stroke, "nullable") + field("Épaisseur de la bordure (mm)", "strokeWidth", el.strokeWidth, "num", { step: 0.05, min: 0, max: 10 }) + field("Arrondi (mm)", "radius", el.radius, "num", { step: 0.5, min: 0, max: 100 }) + `<p class="bs-muted">La photo vient de la fiche de l'employé.</p>`;
    else if (el.type === "image") specific = field("Ajustement", "fit", el.fit, "select", [["contain", "Entière"], ["cover", "Remplir le cadre"], ["stretch", "Étirer"]]) + field("Arrondi (mm)", "radius", el.radius, "num", { step: 0.5, min: 0, max: 100 }) + `<button class="btn btn-ghost" data-st="replace-image">Remplacer l'image</button>`;
    else if (el.type === "qr") specific = field("Couleur", "color", el.color, "color") + field("Fond", "background", el.background, "nullable") + `<p class="bs-muted">Le QR ouvre la page de vérification du badge. Gardez-le sombre sur fond clair, 12 mm au minimum.</p>`;
    return `<h2>${B().esc(TYPE_LABELS[el.type] || "Élément")}</h2><div class="bs-st-form">${field("Nom du calque", "name", el.name, "text")}
      <div class="bs-st-grid">${field("X (mm)", "x", el.x, "num")}${field("Y (mm)", "y", el.y, "num")}${field("Largeur", "w", el.w, "num", { min: 0.2 })}${field("Hauteur", "h", el.h, "num", { min: 0.2 })}${field("Rotation (°)", "rotation", el.rotation, "num", { step: 1, min: -360, max: 360 })}${field("Opacité", "opacity", el.opacity, "num", { step: 0.05, min: 0, max: 1 })}</div>
      ${specific}</div>`;
  }
  function refreshSide() {
    const view = ed.view;
    if (!view) return;
    const props = view.querySelector("[data-st-props]"), layers = view.querySelector(".bs-st-layers"), arrange = view.querySelector(".bs-st-arrange");
    if (props) props.innerHTML = propsHTML();
    if (layers) layers.innerHTML = layersHTML();
    if (arrange) arrange.parentNode.querySelectorAll(".bs-st-arrange button").forEach(button => { if (button.dataset.st !== "paste") button.disabled = !ed.sel.length; else button.disabled = !ed.clip.length; });
    view.querySelectorAll('[data-st="undo"]').forEach(b => { b.disabled = !ed.undo.length; });
    view.querySelectorAll('[data-st="redo"]').forEach(b => { b.disabled = !ed.redo.length; });
  }
  function select(ids) { ed.sel = ids; renderCanvas(); refreshSide(); }
  function fitZoom() {
    const stage = ed.view && ed.view.querySelector("[data-st-stage]");
    if (!stage) return;
    const available = Math.max(260, stage.clientHeight || 560) - 90;
    ed.zoom = Math.max(2, Math.min(12, Math.floor(Math.min(available / ed.design.height, (Math.max(320, stage.clientWidth) - 80) / ed.design.width) * 2) / 2));
    renderAll();
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function add(element) {
    checkpoint();
    const d = ed.design;
    const el = { id: newId(), rotation: 0, opacity: 1, locked: false, hidden: false, ...element };
    if (el.x === undefined) el.x = snap((d.width - el.w) / 2);
    if (el.y === undefined) el.y = snap((d.height - el.h) / 2);
    page().elements.push(el);
    ed.sel = [el.id];
    changed();
    renderAll();
  }
  function tool(key) {
    const d = ed.design, yellow = "#FFCB05", black = "#111111";
    if (key === "text") add({ type: "text", name: "Texte", text: "Texte", w: 30, h: 6, font: "Helvetica", size: 10, color: black, align: "center", bold: false, italic: false, uppercase: false, autoFit: true, wrap: false });
    else if (key === "field") { ed.fieldMenu = !ed.fieldMenu; renderAll(); }
    else if (key === "photo") add({ type: "photo", name: "Photo", w: 21.3, h: 24.5, stroke: yellow, strokeWidth: 0.45, radius: 0.9 });
    else if (key === "qr") add({ type: "qr", name: "QR code", w: 15, h: 15, color: black, background: "" });
    else if (key === "rect") add({ type: "shape", name: "Rectangle", shape: "rect", w: 20, h: 12, fill: yellow, stroke: "", strokeWidth: 0, radius: 0 });
    else if (key === "ellipse") add({ type: "shape", name: "Forme ronde", shape: "ellipse", w: 16, h: 16, fill: yellow, stroke: "", strokeWidth: 0, radius: 0 });
    else if (key === "triangle") add({ type: "shape", name: "Triangle", shape: "triangle", w: 16, h: 14, fill: yellow, stroke: "", strokeWidth: 0, radius: 0 });
    else if (key === "line") add({ type: "line", name: "Ligne", w: 30, h: 1, stroke: black, strokeWidth: 0.3, dash: false });
    else if (key === "band") add({ type: "shape", name: "Bandeau", shape: "rect", x: 0, y: 0, w: d.width, h: 14, fill: black, stroke: "", strokeWidth: 0, radius: 0 });
    else if (key === "background") { select([]); const input = ed.view.querySelector('[data-pp="background"]'); if (input) input.focus(); }
    else if (key === "layers") { const title = ed.view.querySelector("[data-st-layers]"); if (title) title.scrollIntoView({ block: "nearest" }); }
    else if (key === "logo" || key === "image") pickImage(key, null);
  }
  function pickImage(kind, replaceId) {
    const input = ed.view.querySelector('[data-st="file"]');
    if (!input) return;
    input.value = "";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        let src = "";
        for (const side of [1200, 800, 500, 320]) {
          src = await B().resizeImage(file, side, file.type === "image/png" ? "image/png" : "image/jpeg");
          if (src.length * 0.75 <= 580000) break;
        }
        if (src.length * 0.75 > 580000) throw new Error("Image trop lourde, même réduite.");
        if (replaceId && byId(replaceId)) { checkpoint(); byId(replaceId).src = src; changed(); renderAll(); return; }
        const ratio = await new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalHeight / img.naturalWidth || 1); img.onerror = () => resolve(1); img.src = src; });
        const w = kind === "logo" ? 18 : 30;
        add({ type: "image", name: kind === "logo" ? "Logo" : "Image", src, fit: kind === "logo" ? "contain" : "cover", radius: 0, w, h: round(Math.min(ed.design.height, w * ratio)) });
      } catch (error) { B().notify(error.message || String(error), "error"); }
    };
    input.click();
  }
  function mutate(fn) { const items = selected(); if (!items.length) return; checkpoint(); fn(items); changed(); renderCanvas(); refreshSide(); }
  function align(mode) {
    mutate(items => {
      const free = items.filter(el => !el.locked);
      const ref = items.length > 1
        ? { x0: Math.min(...items.map(e => e.x)), y0: Math.min(...items.map(e => e.y)), x1: Math.max(...items.map(e => e.x + e.w)), y1: Math.max(...items.map(e => e.y + e.h)) }
        : { x0: 0, y0: 0, x1: ed.design.width, y1: ed.design.height };
      free.forEach(el => {
        if (mode === "left") el.x = ref.x0; else if (mode === "right") el.x = ref.x1 - el.w; else if (mode === "hcenter") el.x = (ref.x0 + ref.x1 - el.w) / 2;
        else if (mode === "top") el.y = ref.y0; else if (mode === "bottom") el.y = ref.y1 - el.h; else if (mode === "vcenter") el.y = (ref.y0 + ref.y1 - el.h) / 2;
        el.x = round(el.x); el.y = round(el.y);
      });
    });
  }
  function reorder(mode) {
    mutate(items => {
      const list = page().elements, ids = new Set(items.map(el => el.id));
      if (mode === "front" || mode === "back") {
        const moved = list.filter(el => ids.has(el.id)), rest = list.filter(el => !ids.has(el.id));
        page().elements = mode === "front" ? [...rest, ...moved] : [...moved, ...rest];
        return;
      }
      const order = mode === "forward" ? [...list.keys()].reverse() : [...list.keys()];
      order.forEach(i => { const j = mode === "forward" ? i + 1 : i - 1; if (ids.has(list[i].id) && list[j] && !ids.has(list[j].id)) [list[i], list[j]] = [list[j], list[i]]; });
    });
  }
  function copy() { ed.clip = clone(selected()); refreshSide(); }
  function paste(source) {
    const items = clone(source || ed.clip);
    if (!items.length) return;
    checkpoint();
    items.forEach(el => { el.id = newId(); el.x = round(el.x + 2); el.y = round(el.y + 2); el.locked = false; page().elements.push(el); });
    if (!source) ed.clip = clone(items);
    ed.sel = items.map(el => el.id);
    changed();
    renderAll();
  }
  function remove() { const ids = new Set(selected().filter(el => !el.locked).map(el => el.id)); if (!ids.size) return; checkpoint(); page().elements = page().elements.filter(el => !ids.has(el.id)); ed.sel = []; changed(); renderAll(); }
  function payload() { return { name: (ed.name || "").trim() || "Modèle sans nom", society: ed.society || null, design: ed.design }; }
  async function save(asCopy) {
    try {
      const body = payload();
      if (asCopy) body.name = (body.name + " — copie").slice(0, 150);
      const previousKey = draftKey();
      const saved = ed.id && !asCopy ? await B().api("/templates/" + ed.id, { method: "PUT", body }) : await B().api("/templates", { method: "POST", body });
      try { sessionStorage.removeItem(previousKey); } catch (e) { /* stockage indisponible */ }
      B().state.templates = null;
      ed.dirty = false;
      B().notify(`Modèle « ${saved.name} » enregistré (version ${saved.version}).`, "success");
      if (String(saved.id) !== String(ed.id)) location.hash = "#/drh/badges/studio/" + saved.id;
      else { ed.design = clone(saved.design); ed.name = saved.name; renderAll(); }
    } catch (error) { B().notify(error.message || String(error), "error"); }
  }

  // ── Souris : déplacement, redimensionnement, rotation, sélection au lasso ──
  function toMm(event) {
    const rect = ed.view.querySelector("[data-st-canvas]").getBoundingClientRect();
    return { x: (event.clientX - rect.left) / ed.zoom, y: (event.clientY - rect.top) / ed.zoom };
  }
  function onDown(event) {
    if (event.button !== 0 || !event.target.closest("[data-st-stage]")) return;
    const p = toMm(event), handle = event.target.closest(".bs-st-handle");
    const single = selected().length === 1 ? selected()[0] : null;
    if (handle && single) {
      ed.drag = handle.dataset.rotate ? { mode: "rotate", el: single, start: clone(single) } : { mode: "resize", el: single, start: clone(single), hx: Number(handle.dataset.hx), hy: Number(handle.dataset.hy), p0: p };
    } else {
      const node = event.target.closest("[data-el]");
      const el = node && byId(node.dataset.el);
      if (el) {
        if (event.shiftKey) ed.sel = ed.sel.includes(el.id) ? ed.sel.filter(id => id !== el.id) : [...ed.sel, el.id];
        else if (!ed.sel.includes(el.id)) ed.sel = [el.id];
        ed.drag = { mode: "move", p0: p, starts: selected().filter(item => !item.locked).map(item => ({ el: item, x: item.x, y: item.y })) };
      } else {
        if (!event.shiftKey) ed.sel = [];
        ed.drag = { mode: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: ed.sel.slice() };
      }
      renderCanvas();
      refreshSide();
    }
    event.preventDefault();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }
  function onMove(event) {
    const drag = ed.drag;
    if (!drag || !ed.view) return;
    const p = toMm(event);
    if ((drag.mode === "move" || drag.mode === "resize" || drag.mode === "rotate") && !drag.saved) { checkpoint(); drag.saved = true; }
    if (drag.mode === "move") {
      let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      drag.guideX = drag.guideY = null;
      drag.starts.forEach(s => { s.el.x = event.altKey ? round(s.x + dx) : snap(s.x + dx); s.el.y = event.altKey ? round(s.y + dy) : snap(s.y + dy); });
      if (drag.starts.length === 1 && !event.altKey) {            // aimantation au centre de la carte
        const el = drag.starts[0].el, cx = ed.design.width / 2, cy = ed.design.height / 2;
        if (Math.abs(el.x + el.w / 2 - cx) < 0.8) { el.x = round(cx - el.w / 2); drag.guideX = cx; }
        if (Math.abs(el.y + el.h / 2 - cy) < 0.8) { el.y = round(cy - el.h / 2); drag.guideY = cy; }
      }
    } else if (drag.mode === "resize") {
      const s = drag.start, angle = (s.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const gx = p.x - drag.p0.x, gy = p.y - drag.p0.y;
      let lx = gx * cos + gy * sin, ly = -gx * sin + gy * cos;        // déplacement dans le repère de l'élément
      let w = Math.max(0.5, s.w + drag.hx * lx), h = Math.max(0.5, s.h + drag.hy * ly);
      if (event.shiftKey && drag.hx && drag.hy) { const k = Math.max(w / s.w, h / s.h); w = s.w * k; h = s.h * k; }
      if (!event.altKey) { w = Math.max(GRID, snap(w)); h = Math.max(GRID, snap(h)); }
      const sx = drag.hx * (w - s.w) / 2, sy = drag.hy * (h - s.h) / 2; // le bord opposé reste fixe
      const cx = s.x + s.w / 2 + sx * cos - sy * sin, cy = s.y + s.h / 2 + sx * sin + sy * cos;
      Object.assign(drag.el, { w: round(w), h: round(h), x: round(cx - w / 2), y: round(cy - h / 2) });
    } else if (drag.mode === "rotate") {
      const s = drag.start;
      let angle = Math.atan2(p.y - (s.y + s.h / 2), p.x - (s.x + s.w / 2)) * 180 / Math.PI + 90;
      angle = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      drag.el.rotation = ((angle + 540) % 360) - 180;
    } else if (drag.mode === "marquee") {
      drag.x1 = p.x; drag.y1 = p.y;
      const x0 = Math.min(drag.x0, p.x), x1 = Math.max(drag.x0, p.x), y0 = Math.min(drag.y0, p.y), y1 = Math.max(drag.y0, p.y);
      const hit = page().elements.filter(el => !el.hidden && el.x < x1 && el.x + el.w > x0 && el.y < y1 && el.y + el.h > y0).map(el => el.id);
      ed.sel = [...new Set([...drag.base, ...hit])];
    }
    renderCanvas();
  }
  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    const drag = ed.drag;
    ed.drag = null;
    if (drag && drag.saved) changed();
    renderCanvas();
    refreshSide();
  }
  function onKey(event) {
    if (!ed.view || !ed.view.isConnected || !ed.view.querySelector(".bs-studio")) { document.removeEventListener("keydown", onKey); return; }
    if (document.querySelector("#modal-host .modal-bg")) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target && event.target.tagName) || "");
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === "s") { event.preventDefault(); save(false); return; }
    if (typing) return;
    const step = event.shiftKey ? 5 : GRID;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) restore(null, ed.redo, ed.undo); else restore(null, ed.undo, ed.redo); }
    else if (mod && key === "y") { event.preventDefault(); restore(null, ed.redo, ed.undo); }
    else if (mod && key === "c") { if (ed.sel.length) { event.preventDefault(); copy(); } }
    else if (mod && key === "v") { if (ed.clip.length) { event.preventDefault(); paste(); } }
    else if (mod && key === "d") { event.preventDefault(); paste(selected()); }
    else if (mod && key === "a") { event.preventDefault(); select(page().elements.filter(el => !el.hidden).map(el => el.id)); }
    else if (key === "delete" || key === "backspace") { event.preventDefault(); remove(); }
    else if (key === "escape") select([]);
    else if (arrows[key] && ed.sel.length) { event.preventDefault(); mutate(items => items.filter(el => !el.locked).forEach(el => { el.x = round(el.x + arrows[key][0]); el.y = round(el.y + arrows[key][1]); })); }
  }

  // ── Événements des panneaux ───────────────────────────────────────────────
  function bind(view) {
    if (view.dataset.stBound) return;
    view.dataset.stBound = "1";
    view.addEventListener("pointerdown", event => { if (ed.view === view && view.querySelector(".bs-studio")) onDown(event); });
    view.addEventListener("click", event => {
      const target = event.target.closest("[data-st]");
      if (!target || ed.view !== view || !view.querySelector(".bs-studio")) return;
      const action = target.dataset.st;
      if (action === "tool") tool(target.dataset.tool);
      else if (action === "add-field") { const key = target.dataset.field; ed.fieldMenu = false; add({ type: "text", name: B().state.fields[key] || key, text: `{{${key}}}`, w: 40, h: 6, font: "Helvetica", size: 10, color: "#111111", align: "center", bold: true, italic: false, uppercase: true, autoFit: true, wrap: false }); }
      else if (action === "page") { ed.page = Number(target.dataset.i) || 0; ed.sel = []; renderAll(); }
      else if (action === "add-back") { checkpoint(); ed.design.pages.push({ name: "Verso", background: "#FFFFFF", elements: [] }); ed.page = 1; ed.sel = []; changed(); renderAll(); }
      else if (action === "remove-back") { if (confirm("Supprimer le verso et tous ses éléments ?")) { checkpoint(); ed.design.pages.length = 1; ed.page = 0; ed.sel = []; changed(); renderAll(); } }
      else if (action === "undo") restore(null, ed.undo, ed.redo);
      else if (action === "redo") restore(null, ed.redo, ed.undo);
      else if (action === "zoom-in") { ed.zoom = Math.min(16, ed.zoom + 1); renderAll(); }
      else if (action === "zoom-out") { ed.zoom = Math.max(2, ed.zoom - 1); renderAll(); }
      else if (action === "zoom-fit") fitZoom();
      else if (action === "layer") { const id = target.dataset.id; select(event.shiftKey ? (ed.sel.includes(id) ? ed.sel.filter(x => x !== id) : [...ed.sel, id]) : [id]); }
      else if (action === "layer-hide" || action === "layer-lock") { const el = byId(target.dataset.id); if (el) { checkpoint(); if (action === "layer-hide") el.hidden = !el.hidden; else el.locked = !el.locked; changed(); renderCanvas(); refreshSide(); } }
      else if (action.startsWith("align-")) align(action.slice(6));
      else if (["front", "forward", "backward", "back"].includes(action)) reorder(action);
      else if (action === "duplicate") paste(selected());
      else if (action === "copy") copy();
      else if (action === "paste") paste();
      else if (action === "lock") mutate(items => { const lock = items.some(el => !el.locked); items.forEach(el => { el.locked = lock; }); });
      else if (action === "delete") remove();
      else if (action === "swap-size") { checkpoint(); [ed.design.width, ed.design.height] = [ed.design.height, ed.design.width]; changed(); fitZoom(); }
      else if (action === "replace-image") pickImage("image", ed.sel[0]);
      else if (action === "save") save(false);
      else if (action === "save-copy") save(true);
      else if (action === "preview") { if (typeof openModal === "function") { openModal(`<h2 class="text-xl font-bold mb-3">Aperçu réaliste</h2><div class="bs-modal-preview">${B().previewHTML(ed.design, { values: B().SAMPLE, qr: sampleQr() }, { realistic: true, width: 220 })}</div><p class="text-sm text-slate-500 mt-3">Le porte-badge et le cordon ne sont jamais imprimés.</p><div class="flex justify-end mt-3"><button class="btn btn-ghost" id="bs-st-close">Fermer</button></div>`); document.getElementById("bs-st-close").onclick = closeModal; } }
      else if (action === "proof") B().apiBlob("/preview/pdf", { design: ed.design }).then(file => B().saveBlob(file, true)).catch(error => B().notify(error.message || String(error), "error"));
    });
    const apply = (event, final) => {
      const t = event.target;
      if (ed.view !== view || !t.closest || !t.closest(".bs-studio")) return;
      if (t.dataset.st === "name") { ed.name = t.value; changed(); return; }
      if (t.dataset.st === "society") { ed.society = t.value; changed(); return; }
      if (t.dataset.st === "insert-field") {
        const el = selected()[0];
        if (el && t.value) { checkpoint(); el.text = (el.text || "") + `{{${t.value}}}`; changed(); renderCanvas(); refreshSide(); }
        return;
      }
      if (t.dataset.pp) {
        if (!ed.typing) { checkpoint(); ed.typing = true; }
        if (t.dataset.pp === "background") page().background = t.value;
        else { const v = Number(t.value); if (v >= 20 && v <= 300) ed.design[t.dataset.pp] = v; }
        changed();
        if (final) { ed.typing = false; if (t.dataset.pp !== "background") { renderAll(); return; } }
        renderCanvas();
        return;
      }
      const prop = t.dataset.p;
      if (!prop) return;
      if (!ed.typing) { checkpoint(); ed.typing = true; }
      const kind = t.dataset.kind;
      selected().forEach(el => {
        if (!(prop in el) && !["opacity", "rotation", "name"].includes(prop)) return;
        if (kind === "bool") el[prop] = t.checked;
        else if (kind === "none") el[prop] = t.checked ? "" : (t.closest(".bs-st-nullable").querySelector('input[type="color"]').value || "#FFFFFF");
        else if (kind === "num") { const v = Number(t.value); if (Number.isFinite(v)) el[prop] = ["w", "h"].includes(prop) ? Math.max(0.2, v) : v; }
        else el[prop] = t.value;
      });
      changed();
      renderCanvas();
      if (final || kind === "bool" || kind === "none") { ed.typing = false; refreshSide(); }
    };
    view.addEventListener("input", event => apply(event, false));
    view.addEventListener("change", event => apply(event, true));
  }

  function ensureStyles() {
    if (document.getElementById("bs-studio-styles")) return;
    const style = document.createElement("style");
    style.id = "bs-studio-styles";
    style.textContent = `
.bs-studio{display:flex;flex-direction:column;gap:12px;min-width:0}
.bs-st-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:12px 14px}.bs-st-top label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:800;color:#42566f}.bs-st-name{flex:1 1 220px}
.bs-st-group{display:inline-flex;border:1px solid var(--bs-line);border-radius:999px;overflow:hidden;background:#fff}.bs-st-group button{border:0;background:transparent;padding:8px 13px;font-size:12.5px;font-weight:800;color:var(--bs-navy);cursor:pointer;min-width:38px}
.bs-st-group button+button{border-left:1px solid var(--bs-line)}.bs-st-group button.is-active{background:var(--bs-navy);color:#fff}.bs-st-group button:disabled{opacity:.4;cursor:default}
.bs-st-main{display:grid;grid-template-columns:230px minmax(0,1fr) 280px;gap:12px;align-items:start}
@media(max-width:1180px){.bs-st-main{grid-template-columns:1fr}}
.bs-st-left,.bs-st-right{padding:12px;display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 150px);overflow:auto}.bs-st-left h2,.bs-st-right h2{margin:0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--bs-navy)}
.bs-st-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px}.bs-st-tools button{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border:1px solid var(--bs-line);border-radius:12px;background:#fff;font-size:11.5px;font-weight:800;color:var(--bs-ink);cursor:pointer}
.bs-st-tools button svg{color:var(--bs-navy)}.bs-st-group button svg,.bs-st-arrange button svg,.bs-st-layers button svg{display:block;margin:auto;width:16px;height:16px}.bs-st-tools button:hover,.bs-st-fields button:hover{border-color:var(--bs-blue);background:#f0f7ff}
.bs-st-fields{display:flex;flex-wrap:wrap;gap:5px}.bs-st-fields button{border:1px solid var(--bs-line);border-radius:999px;background:#fff;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer}
.bs-st-layers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}.bs-st-layers li{display:grid;grid-template-columns:1fr auto auto;gap:2px;border-radius:8px}.bs-st-layers li.is-active{background:#dbeafe}
.bs-st-layers button{border:0;background:transparent;padding:6px;cursor:pointer;font-size:12px;border-radius:8px}.bs-st-layer{text-align:left;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-st-stage{background:#e7ecf2;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:14px 14px;border-radius:16px;border:1px solid var(--bs-line);min-height:560px;max-height:calc(100vh - 150px);overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:44px 40px;touch-action:none;outline:0}
.bs-st-stage:focus-visible{border-color:var(--bs-blue)}.bs-st-canvas{position:relative;flex:none;background:#fff;box-shadow:0 8px 26px rgba(15,23,42,.22)}.bs-st-canvas .bs-svg{position:absolute;inset:0;user-select:none}.bs-st-canvas [data-el]{cursor:move}
.bs-st-overlay{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.bs-st-handle{pointer-events:all;cursor:pointer}
.bs-st-arrange{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}.bs-st-arrange button{border:1px solid var(--bs-line);background:#fff;border-radius:9px;padding:7px 0;color:var(--bs-navy);cursor:pointer}.bs-st-arrange button:hover:not(:disabled){border-color:var(--bs-blue);background:#f0f7ff}.bs-st-arrange button:disabled{opacity:.4;cursor:default}
.bs-st-form{display:flex;flex-direction:column;gap:8px}.bs-st-form label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:800;color:#42566f}.bs-st-form label.bs-inline{flex-direction:row;align-items:center;gap:6px;font-weight:700}
.bs-st-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.bs-st-checks{display:grid;grid-template-columns:1fr 1fr;gap:4px}.bs-st-nullable{display:flex;align-items:center;gap:8px}.bs-st-form input[type=color]{width:100%;height:32px;padding:2px;border:1px solid var(--bs-line);border-radius:8px;background:#fff}.bs-st-nullable input[type=color]{width:60px}`;
    document.head.appendChild(style);
  }

  window.BadgeStudioEditor = { mount, destroy, state: ed };
  SGDIModules.registerModule({ key: "badges-studio", routes: [], dependencies: [], init: function () {}, destroy: destroy });
})();
