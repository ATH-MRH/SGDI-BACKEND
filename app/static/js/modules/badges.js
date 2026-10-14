/* Studio Badges DRH — rendu des badges et écrans de gestion (#/drh/badges/…).
   Le badge est dessiné en SVG à partir de la même maquette (en millimètres) que le PDF produit
   par le serveur. Le porte-badge et le cordon de l'aperçu réaliste sont un habillage d'écran :
   le PDF d'impression vient toujours du serveur et ne contient que la carte. */
(function () {
  "use strict";

  const API = "/drh/badges";
  const PT = 25.4 / 72;
  const SCREENS = [
    ["dashboard", "Tableau de bord"], ["creer", "Créer un badge"], ["personnel", "Badges du personnel"],
    ["studio", "Studio de conception"], ["modeles", "Modèles"], ["lot", "Impression en lot"],
    ["historique", "Historique"], ["parametres", "Paramètres"],
  ];
  const SAMPLE = {
    societe: "IRON GLOBAL", nom: "ABDELKADER", prenom: "MOHAMED", nom_complet: "ABDELKADER MOHAMED", matricule: "K26",
    fonction: "CARISTE", site: "SITE EXEMPLE", site_code: "ETP/DF/H01", statut: "ACTIF", numero: "BDG-0000-000000",
    date_emission: "01/01/2026", validite: "—",
  };
  const FONT_CSS = {
    Helvetica: "Helvetica, Arial, sans-serif", Times: "'Times New Roman', Times, serif", Courier: "'Courier New', Courier, monospace",
  };
  const ACTION_LABELS = {
    EMISSION: "Émission", IMPRESSION: "Impression", IMPRESSION_HORS_STUDIO: "Impression (écran historique)", REVOCATION: "Révocation", MODELE_CREE: "Modèle créé",
    MODELE_MODIFIE: "Modèle modifié", MODELE_DUPLIQUE: "Modèle dupliqué", MODELE_DEFAUT: "Modèle par défaut",
    MODELE_ARCHIVE: "Modèle archivé", PARAMETRES: "Paramètres",
  };
  const STATUS = { ACTIF: ["Actif", "ok"], REVOQUE: ["Révoqué", "bad"], REMPLACE: ["Remplacé", "muted"] };

  const state = { seq: 0, templates: null, fields: {}, fonts: [], photos: new Map(), selection: new Set(), uid: 0, rights: null };
  const NO_RIGHT = "Permission requise (Administration › Matrice des droits › DRH › Badges du personnel).";
  const can = action => !!(state.rights && state.rights[action]);
  async function loadRights(force) {
    if (!state.rights || force) state.rights = await api("/permissions");
    return state.rights;
  }

  // ── Outils ────────────────────────────────────────────────────────────────
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function num(value, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : (fallback || 0); }
  function color(value, fallback) { return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : (fallback || "none"); }
  function imageSrc(value) { return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(value || "")) ? value : ""; }
  function notify(message, type) { if (typeof toast === "function") toast(message, type || "info"); }
  function society() { return typeof drhActiveSocieteFilter === "function" ? (drhActiveSocieteFilter() || "") : ""; }
  function query(params) {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
    return entries.length ? "?" + new URLSearchParams(entries).toString() : "";
  }
  function dateFr(value, withTime) {
    if (!value) return "—";
    const text = String(value);
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(text) || text.length <= 10 ? text : text + "Z");
    if (Number.isNaN(d.getTime())) return "—";
    return withTime ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : d.toLocaleDateString("fr-FR");
  }
  function api(path, options) { return sgdiApi(API + path, { legacy: false, ...(options || {}) }); }
  async function apiBlob(path, body) {
    const res = await fetch(sgdiApiUrl(API + path, false), {
      method: body === undefined ? "GET" : "POST", cache: "no-store", headers: sgdiAuthHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let raw = "", out = null;
      try { raw = await res.text(); out = JSON.parse(raw); } catch (e) { /* réponse non JSON */ }
      throw new Error(typeof sgdiApiErrorMessage === "function" ? sgdiApiErrorMessage(res.status, raw, out) : "Erreur " + res.status);
    }
    const name = (/filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "") || [])[1] || "badge.pdf";
    return { blob: await res.blob(), name };
  }
  function saveBlob(file, open) {
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement("a");
    link.href = url;
    if (open) { link.target = "_blank"; link.rel = "noopener"; } else link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  /** Photo protégée (employé ou badge émis) : chargée avec le jeton, gardée en URL d'objet. */
  function loadPhoto(path) {
    if (!state.photos.has(path)) {
      state.photos.set(path, apiBlob(path).then(file => new Promise(resolve => {
        const url = URL.createObjectURL(file.blob);
        const img = new Image();
        img.onload = () => resolve({ url, w: img.naturalWidth || 3, h: img.naturalHeight || 4 });
        img.onerror = () => resolve(null);
        img.src = url;
      })).catch(() => null));
    }
    return state.photos.get(path);
  }
  function forgetPhotos() {
    state.photos.forEach(entry => entry.then(photo => { if (photo) URL.revokeObjectURL(photo.url); }));
    state.photos.clear();
  }
  async function loadTemplates(force) {
    if (!state.templates || force) {
      const out = await api("/templates");
      state.templates = out.items || [];
      state.fields = out.fields || {};
      state.fonts = out.fonts || ["Helvetica"];
    }
    return state.templates;
  }

  // ── Texte multilingue ─────────────────────────────────────────────────────
  // Hors du latin de Windows-1252 (arabe…), le PDF utilise la police DejaVu Sans embarquée ;
  // l'aperçu charge la MÊME police depuis l'application (aucun service externe). Le navigateur
  // lie les lettres arabes et ordonne la ligne lui-même ; chaque segment est isolé (FSI…PDI)
  // pour que son sens soit celui de son premier caractère, comme dans le PDF.
  const UNICODE_FAMILY = "BadgeUnicode";
  const NON_LATIN = /[^\u0000-\u007F\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/;
  const isLatin = text => !NON_LATIN.test(String(text || ""));
  const isolate = text => "\u2068" + text + "\u2069";
  let unicodeFont = null;
  /** Charge la police embarquée (une fois) ; l'aperçu est redessiné quand elle est prête. */
  function loadUnicodeFont() {
    if (unicodeFont || typeof FontFace === "undefined" || !document.fonts) return unicodeFont || Promise.resolve(false);
    const face = (weight, file) => new FontFace(UNICODE_FAMILY, `url(/static/fonts/${file})`, { weight });
    unicodeFont = Promise.all([face("400", "DejaVuSans.ttf").load(), face("700", "DejaVuSans-Bold.ttf").load()])
      .then(faces => { faces.forEach(f => document.fonts.add(f)); return true; })
      .catch(() => false);
    return unicodeFont;
  }

  // ── Rendu SVG d'une face ──────────────────────────────────────────────────
  function textWidth(text, font, bold, italic) {
    if (textWidth.ctx === undefined) {
      try { textWidth.ctx = document.createElement("canvas").getContext("2d") || null; } catch (e) { textWidth.ctx = null; }
    }
    if (!textWidth.ctx) return String(text).length * (bold ? 0.6 : 0.55);
    const latin = isLatin(text);
    textWidth.ctx.font = (italic && latin ? "italic " : "") + (bold ? "bold " : "") + "100px " + (latin ? (FONT_CSS[font] || FONT_CSS.Helvetica) : UNICODE_FAMILY + ", sans-serif");
    return textWidth.ctx.measureText(text).width / 100;
  }
  function fillFields(text, values, upper) {
    const out = String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key) => (key in SAMPLE ? String((values || {})[key] || "—") : all)).replace(/[ \t]+/g, " ");
    return upper ? out.toUpperCase() : out;
  }
  /** Position d'une image qui remplit son cadre (même calcul que badge_design.cover_box). */
  function coverBox(iw, ih, fw, fh, crop) {
    const c = crop || {};
    const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const scale = Math.max(fw / iw, fh / ih) * clamp(c.zoom, 1, 4, 1);
    const w = iw * scale, h = ih * scale;
    return { x: (fw - w) * (0.5 + clamp(c.dx, -0.5, 0.5, 0)), y: (fh - h) * (0.5 + clamp(c.dy, -0.5, 0.5, 0)), w, h };
  }
  function shapeSvg(el) {
    const paint = `fill="${el.fill ? color(el.fill) : "none"}"` + (el.stroke && el.strokeWidth ? ` stroke="${color(el.stroke)}" stroke-width="${num(el.strokeWidth)}"` : "");
    const px = nx => num(el.x + nx * el.w), py = ny => num(el.y + ny * el.h);
    if (el.shape === "ellipse") return `<ellipse cx="${num(el.x + el.w / 2)}" cy="${num(el.y + el.h / 2)}" rx="${num(el.w / 2)}" ry="${num(el.h / 2)}" ${paint}/>`;
    if (el.shape === "triangle" || el.shape === "polygon") {
      const points = el.shape === "polygon" && Array.isArray(el.points) ? el.points : [[0.5, 0], [1, 1], [0, 1]];
      return `<polygon points="${points.map(p => px(p[0]) + "," + py(p[1])).join(" ")}" ${paint}/>`;
    }
    if (el.shape === "path" && Array.isArray(el.path)) {
      const d = el.path.map(c => c[0] === "Z" ? "Z" : c[0] + c.slice(1).map((v, i) => (i % 2 ? py(v) : px(v))).join(" ")).join(" ");
      return `<path d="${d}" ${paint}/>`;
    }
    return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" rx="${num(Math.min(el.radius || 0, el.w / 2, el.h / 2))}" ${paint}/>`;
  }
  function textSvg(el, values) {
    if (!unicodeFont && !isLatin(el.text)) loadUnicodeFont();
    let size = num(el.size, 10) * PT;
    const family = FONT_CSS[el.font] || FONT_CSS.Helvetica;
    const attrs = `font-family="${family}" fill="${color(el.color, "#111111")}"${el.italic ? ' font-style="italic"' : ""} style="white-space:pre"`;
    const anchor = { center: "middle", right: "end" }[el.align] || "start";
    const unicodeAttrs = ` font-family="${UNICODE_FAMILY}, sans-serif" font-style="normal"`;
    const x = num(el.align === "center" ? el.x + el.w / 2 : el.align === "right" ? el.x + el.w : el.x);
    if (el.wrap) {
      const lines = [];
      fillFields(String(el.text || "").replace(/\*\*/g, ""), values, el.uppercase).split("\n").forEach(paragraph => {
        let current = "";
        paragraph.split(/\s+/).filter(Boolean).forEach(word => {
          const trial = (current + " " + word).trim();
          if (current && textWidth(trial, el.font, el.bold, el.italic) * size > el.w) { lines.push(current); current = word; } else current = trial;
        });
        lines.push(current);
      });
      const leading = size * 1.2, top = el.y + el.h / 2 - lines.length * leading / 2;
      return lines.map((line, i) => `<text x="${x}" y="${num(top + i * leading + leading / 2 + size * 0.35)}" font-size="${num(size)}" text-anchor="${anchor}"${el.bold ? ' font-weight="700"' : ""} ${attrs}${isLatin(line) ? "" : unicodeAttrs}>${esc(isLatin(line) ? line : isolate(line))}</text>`).join("");
    }
    const runs = String(el.text || "").split("**").map((part, i) => ({ text: fillFields(part, values, el.uppercase), bold: !!el.bold || i % 2 === 1 })).filter(run => run.text);
    const total = runs.reduce((sum, run) => sum + textWidth(run.text, el.font, run.bold, el.italic), 0) * size;
    if (el.autoFit && total > el.w && el.w > 0) size = Math.max(3 * PT, size * el.w / total);
    return `<text x="${x}" y="${num(el.y + el.h / 2 + size * 0.35)}" font-size="${num(size)}" text-anchor="${anchor}" ${attrs}>` +
      runs.map(run => isLatin(run.text) ? `<tspan font-weight="${run.bold ? 700 : 400}">${esc(run.text)}</tspan>`
        : `<tspan font-weight="${run.bold ? 700 : 400}"${unicodeAttrs}>${esc(isolate(run.text))}</tspan>`).join("") + "</text>";
  }
  function qrSvg(el, matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    let out = el.background ? `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" fill="${color(el.background)}"/>` : "";
    if (!rows.length) return out + `<rect x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}" fill="none" stroke="#9CA3AF" stroke-width="0.3" stroke-dasharray="1 1"/>`;
    const cw = el.w / rows.length, ch = el.h / rows.length;
    let d = "";
    rows.forEach((line, r) => { for (let c = 0; c < line.length; c++) if (line[c] === "1") d += `M${num(el.x + c * cw)} ${num(el.y + r * ch)}h${num(cw)}v${num(ch)}h${num(-cw)}z`; });
    return out + `<path d="${d}" fill="${color(el.color, "#111111")}" shape-rendering="crispEdges"/>`;
  }
  function badgeSvg(design, pageIndex, ctx, options) {
    ctx = ctx || {}; options = options || {};
    if (!unicodeFont && Object.values(ctx.values || {}).some(value => !isLatin(value))) loadUnicodeFont();
    const W = num(design.width, 54), H = num(design.height, 86);
    const page = (design.pages || [])[pageIndex] || { elements: [], background: "#FFFFFF" };
    const uid = "bs" + (++state.uid);
    let defs = `<clipPath id="${uid}c"><rect width="${W}" height="${H}" rx="${num(options.radius)}"/></clipPath>`, body = "";
    (page.elements || []).forEach((el, index) => {
      if (el.hidden) return;
      let inner = "";
      const box = `x="${num(el.x)}" y="${num(el.y)}" width="${num(el.w)}" height="${num(el.h)}"`;
      const radius = num(Math.min(el.radius || 0, el.w / 2, el.h / 2));
      if (el.type === "text") inner = textSvg(el, ctx.values || SAMPLE);
      else if (el.type === "shape") inner = shapeSvg(el);
      else if (el.type === "line") inner = `<line x1="${num(el.x)}" y1="${num(el.y + el.h / 2)}" x2="${num(el.x + el.w)}" y2="${num(el.y + el.h / 2)}" stroke="${color(el.stroke, "#111111")}" stroke-width="${num(el.strokeWidth, 0.3)}"${el.dash ? ` stroke-dasharray="${num(el.strokeWidth * 3)} ${num(el.strokeWidth * 2)}"` : ""}/>`;
      else if (el.type === "qr") inner = qrSvg(el, ctx.qr);
      else if (el.type === "photo" || el.type === "image") {
        const clip = `${uid}p${index}`;
        defs += `<clipPath id="${clip}"><rect ${box} rx="${radius}"/></clipPath>`;
        if (el.type === "image") {
          const fit = { cover: "xMidYMid slice", stretch: "none" }[el.fit] || "xMidYMid meet";
          const src = imageSrc(el.src);
          inner = src ? `<image href="${src}" ${box} preserveAspectRatio="${fit}" clip-path="url(#${clip})"/>` : `<rect ${box} fill="#E5E7EB"/>`;
        } else if (ctx.photo && ctx.photo.url) {
          const b = coverBox(ctx.photo.w, ctx.photo.h, el.w, el.h, ctx.crop);
          inner = `<image href="${esc(ctx.photo.url)}" x="${num(el.x + b.x)}" y="${num(el.y + b.y)}" width="${num(b.w)}" height="${num(b.h)}" preserveAspectRatio="none" clip-path="url(#${clip})"/>`;
        } else {
          const cx = el.x + el.w / 2;
          inner = `<g clip-path="url(#${clip})"><rect ${box} fill="#E5E7EB"/><circle cx="${num(cx)}" cy="${num(el.y + el.h * 0.38)}" r="${num(el.w * 0.2)}" fill="#9CA3AF"/>` +
            `<ellipse cx="${num(cx)}" cy="${num(el.y + el.h * 1.02)}" rx="${num(el.w * 0.38)}" ry="${num(el.h * 0.36)}" fill="#9CA3AF"/></g>`;
        }
        if (el.type === "photo" && el.stroke && el.strokeWidth) inner += `<rect ${box} rx="${radius}" fill="none" stroke="${color(el.stroke)}" stroke-width="${num(el.strokeWidth)}"/>`;
      }
      if (options.editable) inner += `<rect ${box} fill="transparent"/>`;
      const rotate = el.rotation ? ` transform="rotate(${num(el.rotation)} ${num(el.x + el.w / 2)} ${num(el.y + el.h / 2)})"` : "";
      body += `<g data-el="${esc(el.id)}"${rotate}${el.opacity < 1 ? ` opacity="${num(el.opacity, 1)}"` : ""}>${inner}</g>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" class="bs-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(options.label || "Badge")}"><defs>${defs}</defs>` +
      `<g clip-path="url(#${uid}c)"><rect width="${W}" height="${H}" fill="${color(page.background, "#FFFFFF")}"/>${body}</g></svg>`;
  }
  /** Aperçu : à plat, ou réaliste (porte-badge transparent et cordon — jamais imprimés). */
  function previewHTML(design, ctx, options) {
    options = options || {};
    const pages = (design.pages || []).map((page, index) => {
      const svg = badgeSvg(design, index, ctx, { radius: 2.6, label: page.name });
      const card = `<div class="bs-card" style="aspect-ratio:${num(design.width)}/${num(design.height)}">${svg}</div>`;
      if (!options.realistic) return `<figure class="bs-flat">${card}${design.pages.length > 1 ? `<figcaption>${esc(page.name)}</figcaption>` : ""}</figure>`;
      return `<figure class="bs-real"><div class="bs-lanyard" aria-hidden="true"></div><div class="bs-holder"><span class="bs-slot" aria-hidden="true"></span>${card}<span class="bs-gloss" aria-hidden="true"></span></div>${design.pages.length > 1 ? `<figcaption>${esc(page.name)}</figcaption>` : ""}</figure>`;
    }).join("");
    return `<div class="bs-preview${options.realistic ? " is-real" : ""}" style="--bs-card-w:${num(options.width, 250)}px">${pages}</div>`;
  }

  // ── Structure commune des écrans ──────────────────────────────────────────
  function shell(view, screen, bodyHTML, actionsHTML) {
    const title = (SCREENS.find(s => s[0] === screen) || SCREENS[0])[1];
    view.innerHTML = `<div class="bs-page" data-bs-screen="${screen}">
      <header class="bs-head">
        <div class="bs-head-title"><span class="bs-logo" aria-hidden="true">ID</span><div><div class="bs-title" role="heading" aria-level="1">${esc(title)}</div><div class="bs-subtitle">Gestion des badges${society() ? " · " + esc(society()) : ""}</div></div></div>
        <div class="bs-head-actions">${actionsHTML || ""}</div>
      </header>
      <nav class="bs-tabs" aria-label="Gestion des badges">${SCREENS.map(([key, label]) => `<a href="#/drh/badges/${key}" class="${key === screen ? "is-active" : ""}">${esc(label)}</a>`).join("")}</nav>
      <div class="bs-body">${bodyHTML}</div>
    </div>`;
  }
  function loading(view, screen) { shell(view, screen, `<div class="bs-empty">Chargement…</div>`); }
  function failure(view, screen, error) {
    shell(view, screen, `<div class="bs-empty bs-error"><strong>Impossible de charger cet écran.</strong><span>${esc(error && error.message || error)}</span><button class="btn btn-secondary" data-bs="reload">Réessayer</button></div>`);
  }
  function statusPill(badge) {
    if (!badge) return `<span class="bs-pill is-none">Aucun badge</span>`;
    if (badge.status === "ACTIF" && badge.expired) return `<span class="bs-pill is-warn">Expiré</span>`;
    const [label, tone] = STATUS[badge.status] || [badge.status, "muted"];
    return `<span class="bs-pill is-${tone}">${esc(label)}</span>`;
  }
  function templateOptions(selected) {
    return (state.templates || []).map(t => `<option value="${t.id}" ${String(t.id) === String(selected) ? "selected" : ""}>${esc(t.name)}${t.society ? " — " + esc(t.society) : ""}${t.is_default ? " (par défaut)" : ""}</option>`).join("");
  }
  function pager(data) {
    if (!data || data.pages <= 1) return "";
    return `<div class="bs-pager"><button class="btn btn-ghost" data-bs="page" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>← Précédent</button><span>Page ${data.page} / ${data.pages} · ${data.total} résultat${data.total > 1 ? "s" : ""}</span><button class="btn btn-ghost" data-bs="page" data-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>Suivant →</button></div>`;
  }

  // ── Tableau de bord ───────────────────────────────────────────────────────
  async function renderDashboard(view, alive) {
    loading(view, "dashboard");
    const data = await api("/dashboard" + query({ society: society() }));
    if (!alive()) return;
    const tiles = [
      ["Employés", data.employees, "personnel", "Hors sortants"],
      ["Avec badge actif", data.with_badge, "personnel/with", "Badge émis et valide"],
      ["Sans badge", data.without_badge, "personnel/without", "Badge à créer"],
      ["Sans photo", data.without_photo, "personnel/no_photo", "Photo à ajouter"],
      ["À imprimer", data.to_print, "personnel/to_print", "Émis, jamais imprimés"],
      ["Expirent sous 30 jours", data.expiring, "personnel/with", "Fin de validité proche"],
      ["Émis ce mois", data.issued_this_month, "historique", "Émissions du mois"],
      ["Révoqués", data.revoked, "historique", "Perdus, volés, départs"],
    ];
    shell(view, "dashboard", `
      <section class="bs-kpis">${tiles.map(([label, value, route, hint]) => `<a class="bs-kpi" href="#/drh/badges/${route}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></a>`).join("")}</section>
      <section class="bs-grid-2">
        <div class="card bs-panel"><h2>Actions rapides</h2><div class="bs-quick">
          <a class="btn btn-primary" href="#/drh/badges/creer">Créer un badge</a>
          <a class="btn btn-secondary" href="#/drh/badges/lot">Impression en lot</a>
          <a class="btn btn-secondary" href="#/drh/badges/studio">Ouvrir le studio</a>
          <a class="btn btn-ghost" href="#/drh/badges/modeles">Modèles (${esc(data.templates)})</a>
        </div></div>
        <div class="card bs-panel"><h2>Activité récente</h2>${(data.recent || []).length ? `<ul class="bs-activity">${data.recent.map(e => `<li><span class="bs-pill is-muted">${esc(ACTION_LABELS[e.action] || e.action)}</span><div><strong>${esc(e.label)}</strong><small>${esc(dateFr(e.created_at, true))} · ${esc(e.username || "—")}</small></div></li>`).join("")}</ul>` : `<p class="bs-muted">Aucune activité pour l'instant.</p>`}</div>
      </section>`, `<a class="btn btn-primary" href="#/drh/badges/creer">Créer un badge</a>`);
  }

  // ── Badges du personnel / Impression en lot ───────────────────────────────
  const listState = { q: "", state: "all", page: 1, layout: "", template: "" };
  async function renderList(view, alive, mode, param) {
    if (param && ["with", "without", "no_photo", "to_print", "all"].includes(param)) { listState.state = param; listState.page = 1; }
    const lot = mode === "lot";
    loading(view, mode);
    const [data] = await Promise.all([
      api("/employees" + query({ society: society(), q: listState.q, state: listState.state, page: listState.page, page_size: 50 })), loadTemplates(),
    ]);
    if (!alive()) return;
    const rows = data.items || [];
    const states = [["all", "Tous"], ["without", "Sans badge"], ["with", "Avec badge"], ["to_print", "À imprimer"], ["no_photo", "Sans photo"]];
    const table = rows.length ? `<div class="bs-table-wrap"><table class="bs-table"><thead><tr>
        ${lot ? `<th class="bs-check"><input type="checkbox" data-bs="check-all" aria-label="Tout sélectionner sur cette page" ${rows.every(r => state.selection.has(r.id)) ? "checked" : ""}></th>` : ""}
        <th>Employé</th><th>Matricule</th><th>Fonction</th><th>Site</th><th>Photo</th><th>Badge</th><th>Impressions</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          ${lot ? `<td class="bs-check"><input type="checkbox" data-bs="check" value="${r.id}" aria-label="Sélectionner ${esc(r.nom_complet)}" ${state.selection.has(r.id) ? "checked" : ""}></td>` : ""}
          <td><strong>${esc(r.nom)}</strong> ${esc(r.prenom)}<small>${esc(r.societe)}</small></td>
          <td>${esc(r.matricule)}</td><td>${esc(r.fonction || "—")}</td><td>${esc(r.site_code || "—")}</td>
          <td>${r.has_photo ? `<span class="bs-pill is-ok">Oui</span>` : `<span class="bs-pill is-bad">Manquante</span>`}</td>
          <td>${statusPill(r.badge)}${r.badge ? `<small>${esc(r.badge.number)} · ${esc(dateFr(r.badge.issued_at))}</small>` : ""}</td>
          <td>${r.badge ? esc(r.badge.print_count) : "—"}</td>
          <td class="bs-row-actions"><a class="btn btn-ghost" href="#/drh/badges/creer/${r.id}">${r.badge ? "Gérer" : "Créer"}</a></td></tr>`).join("")}
      </tbody></table></div>${pager(data)}` : `<div class="bs-empty">Aucun employé ne correspond à ces critères.</div>`;
    const lotBar = lot ? `<div class="card bs-panel bs-lotbar">
        <div><strong data-bs-count>${state.selection.size}</strong> employé(s) sélectionné(s)<button class="btn btn-ghost" data-bs="clear-selection">Vider la sélection</button></div>
        <label>Modèle<select class="select" data-bs-field="lot-template"><option value="">Modèle par défaut de la société</option>${templateOptions(listState.template)}</select></label>
        <label>Sortie<select class="select" data-bs-field="lot-layout"><option value="">Selon les paramètres</option><option value="card" ${listState.layout === "card" ? "selected" : ""}>Une carte par page</option><option value="a4" ${listState.layout === "a4" ? "selected" : ""}>Planche A4</option></select></label>
        <div class="bs-lot-actions">${can("create") && can("export") ? `<button class="btn btn-primary" data-bs="lot-issue-print">Émettre les badges manquants et imprimer</button>` : ""}${can("export") ? `<button class="btn btn-secondary" data-bs="lot-print">Imprimer les badges déjà émis</button>` : `<p class="bs-note is-warn">${NO_RIGHT}</p>`}</div>
        <div data-bs-report></div></div>` : "";
    shell(view, mode, `${lotBar}
      <div class="bs-filters"><input class="input bs-search" type="search" placeholder="Rechercher un nom, un matricule, un site…" value="${esc(listState.q)}" data-bs-field="q" aria-label="Rechercher">
        <div class="bs-chips">${states.map(([key, label]) => `<button class="${listState.state === key ? "is-active" : ""}" data-bs="state" data-state="${key}">${label}</button>`).join("")}</div></div>
      ${table}`, lot ? "" : `<a class="btn btn-secondary" href="#/drh/badges/lot">Impression en lot</a><a class="btn btn-primary" href="#/drh/badges/creer">Créer un badge</a>`);
  }
  async function lotRun(view, issue) {
    const ids = [...state.selection];
    if (!ids.length) return notify("Sélectionnez au moins un employé.", "error");
    const report = view.querySelector("[data-bs-report]");
    const buttons = view.querySelectorAll(".bs-lot-actions button");
    buttons.forEach(b => { b.disabled = true; });
    try {
      let badgeIds = [], skipped = [];
      if (issue) {
        const out = await api("/issue-batch", { method: "POST", body: { employee_ids: ids, template_id: Number(listState.template) || null, skip_existing: true } });
        badgeIds = out.issued.map(b => b.id);
        skipped = out.skipped;
      } else {
        const rows = [];
        for (let page = 1; page < 50; page++) {
          const data = await api("/employees" + query({ society: society(), state: "with", page, page_size: 200 }));
          rows.push(...data.items);
          if (page >= data.pages) break;
        }
        const withBadge = new Map(rows.map(r => [r.id, r.badge.id]));
        badgeIds = ids.filter(id => withBadge.has(id)).map(id => withBadge.get(id));
        skipped = ids.filter(id => !withBadge.has(id)).map(id => ({ employee_id: id, reason: "Aucun badge émis" }));
      }
      if (badgeIds.length) saveBlob(await apiBlob("/print/pdf", { badge_ids: badgeIds, layout: listState.layout || null }));
      notify(badgeIds.length ? `${badgeIds.length} badge(s) envoyé(s) à l'impression.` : "Aucun badge à imprimer.", badgeIds.length ? "success" : "error");
      if (report) report.innerHTML = skipped.length ? `<div class="bs-report"><strong>${skipped.length} employé(s) non traité(s)</strong><ul>${skipped.map(s => `<li><a href="#/drh/badges/creer/${esc(s.employee_id)}">Employé n° ${esc(s.employee_id)}</a> — ${esc(s.reason)}</li>`).join("")}</ul></div>` : "";
    } catch (error) { notify(error.message || String(error), "error"); }
    buttons.forEach(b => { b.disabled = false; });
  }

  // ── Créer / gérer un badge ────────────────────────────────────────────────
  const create = { employee: null, templateId: "", realistic: true, crop: { zoom: 1, dx: 0, dy: 0 }, results: [], q: "" };
  function createPreview(view) {
    const host = view.querySelector("[data-bs-preview]");
    const emp = create.employee;
    const template = (state.templates || []).find(t => String(t.id) === String(create.templateId));
    if (!host || !emp || !template) return;
    const draw = photo => {
      if (!host.isConnected) return;
      host.innerHTML = previewHTML(template.design, { values: { ...SAMPLE, ...emp, numero: emp.badge ? emp.badge.number : "—", date_emission: dateFr(new Date().toISOString()), validite: "—" }, qr: emp.qr, photo, crop: create.crop }, { realistic: create.realistic, width: 270 });
    };
    const start = () => { if (emp.has_photo) loadPhoto(`/employees/${emp.id}/photo`).then(draw); else draw(null); };
    // Texte non latin : attendre la police embarquée pour que les largeurs mesurées soient les bonnes.
    if (Object.values(emp).some(value => typeof value === "string" && !isLatin(value))) loadUnicodeFont().then(start); else start();
  }
  async function renderCreate(view, alive, param) {
    loading(view, "creer");
    await loadTemplates();
    const employeeId = Number(param) || (create.employee && create.employee.id) || 0;
    if (employeeId) {
      create.employee = await api("/employees/" + employeeId);
      if (!create.templateId || !state.templates.some(t => String(t.id) === String(create.templateId))) create.templateId = create.employee.default_template_id;
    }
    if (!alive()) return;
    const emp = create.employee;
    const search = `<div class="card bs-panel"><h2>Employé</h2>
      <input class="input bs-search" type="search" placeholder="Nom, prénom ou matricule…" value="${esc(create.q)}" data-bs-field="create-q" aria-label="Rechercher un employé">
      <div class="bs-results" data-bs-results>${resultsHTML()}</div></div>`;
    if (!emp) {
      shell(view, "creer", `<div class="bs-create">${search}<div class="card bs-panel bs-empty">Recherchez un employé pour préparer son badge. Ses informations sont reprises de sa fiche.</div></div>`);
      return;
    }
    const badge = emp.badge;
    const info = [["Société", emp.societe], ["Nom", emp.nom], ["Prénom", emp.prenom], ["Matricule", emp.matricule], ["Fonction", emp.fonction], ["Site", emp.site], ["Code du site", emp.site_code], ["Statut professionnel", emp.statut]];
    const missing = info.filter(([label, value]) => !value && ["Nom", "Matricule", "Fonction", "Code du site"].includes(label)).map(([label]) => label);
    shell(view, "creer", `<div class="bs-create">
      <div class="bs-col">${search}
        <div class="card bs-panel"><h2>Données de la fiche</h2>
          <dl class="bs-dl">${info.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || "—")}</dd></div>`).join("")}</dl>
          ${missing.length ? `<p class="bs-note is-warn">À compléter sur la fiche : ${esc(missing.join(", "))}.</p>` : ""}
          ${ficheId(emp.id) ? `<a class="btn btn-ghost" href="#/effectif/agent/${esc(ficheId(emp.id))}">Ouvrir la fiche employé</a>` : ""}</div>
        <div class="card bs-panel"><h2>Photo</h2>
          ${emp.has_photo ? `<p class="bs-note is-ok">Photo reprise de la fiche.</p>
            <label>Zoom<input type="range" min="1" max="3" step="0.02" value="${create.crop.zoom}" data-bs-field="crop-zoom"></label>
            <label>Horizontal<input type="range" min="-0.5" max="0.5" step="0.01" value="${create.crop.dx}" data-bs-field="crop-dx"></label>
            <label>Vertical<input type="range" min="-0.5" max="0.5" step="0.01" value="${create.crop.dy}" data-bs-field="crop-dy"></label>
            <button class="btn btn-ghost" data-bs="crop-reset">Recentrer</button>` : `<p class="bs-note is-bad">Aucune photo sur la fiche de cet employé.</p>`}
          <label class="btn btn-secondary bs-file">${emp.has_photo ? "Remplacer la photo" : "Ajouter une photo"}<input type="file" accept="image/jpeg,image/png" data-bs-field="photo-file" hidden></label></div>
      </div>
      <div class="bs-col bs-col-preview"><div class="card bs-panel">
        <div class="bs-preview-bar"><label>Modèle<select class="select" data-bs-field="template">${templateOptions(create.templateId)}</select></label>
          <div class="bs-chips"><button class="${create.realistic ? "is-active" : ""}" data-bs="view-real">Réaliste</button><button class="${create.realistic ? "" : "is-active"}" data-bs="view-flat">À plat</button></div></div>
        <div data-bs-preview class="bs-preview-host"><div class="bs-empty">Préparation de l'aperçu…</div></div>
        <p class="bs-muted">Le porte-badge et le cordon ne sont qu'un aperçu : seul le badge est imprimé.</p></div></div>
      <div class="bs-col">
        <div class="card bs-panel"><h2>${badge ? "Badge en cours" : "Émission"}</h2>
          ${badge ? `<dl class="bs-dl"><div><dt>Numéro</dt><dd>${esc(badge.number)}</dd></div><div><dt>État</dt><dd>${statusPill(badge)}</dd></div><div><dt>Émis le</dt><dd>${esc(dateFr(badge.issued_at))} par ${esc(badge.issued_by || "—")}</dd></div><div><dt>Validité</dt><dd>${badge.valid_until ? esc(dateFr(badge.valid_until)) : "Sans date de fin"}</dd></div><div><dt>Impressions</dt><dd>${esc(badge.print_count)}</dd></div></dl>
            <div class="bs-actions">${can("export") ? `<button class="btn btn-primary" data-bs="print" data-layout="card">Imprimer (carte)</button><button class="btn btn-secondary" data-bs="print" data-layout="a4">Imprimer (planche A4)</button>` : ""}
            <button class="btn btn-ghost" data-bs="show-issued">Voir le badge émis</button>${can("validate") ? `<button class="btn btn-danger" data-bs="revoke">Révoquer</button>` : ""}</div><hr>` : ""}
          ${(emp.unprintable || []).length ? `<p class="bs-note is-bad">Caractères non imprimables (alphabet non latin) : ${esc(emp.unprintable.join(", "))}. Saisissez ces informations en caractères latins sur la fiche.</p>` : ""}
          ${!can("create") ? `<p class="bs-note is-warn">Émission : ${NO_RIGHT}</p><div class="bs-actions"><button class="btn btn-ghost" data-bs="proof">Épreuve PDF</button></div>` : (emp.unprintable || []).length ? "" : emp.can_issue ? `<label>Fin de validité (facultatif)<input class="input" type="date" data-bs-field="valid-until"></label>
            <div class="bs-actions"><button class="btn ${badge ? "btn-secondary" : "btn-primary"}" data-bs="issue">${badge ? "Émettre un nouveau badge (remplace l'actuel)" : "Émettre le badge"}</button>
            <button class="btn btn-ghost" data-bs="proof">Épreuve PDF</button></div>
            <p class="bs-muted">L'émission fige les informations et la photo telles qu'elles sont aujourd'hui.</p>` : `<p class="bs-note is-bad">Employé sortant : aucun badge ne peut être émis.</p>`}</div>
        <div class="card bs-panel"><h2>Badges émis</h2>${emp.badges.length ? `<ul class="bs-activity">${emp.badges.map(b => `<li>${statusPill(b)}<div><strong>${esc(b.number)}</strong><small>${esc(dateFr(b.issued_at))} · ${esc(b.template_name || "—")}${b.revoke_reason ? " · " + esc(b.revoke_reason) : ""}</small></div></li>`).join("")}</ul>` : `<p class="bs-muted">Aucun badge émis pour cet employé.</p>`}</div>
      </div></div>`);
    createPreview(view);
  }
  function localAgent(employeeId) {
    return (typeof db !== "undefined" && db && Array.isArray(db.agents) ? db.agents : []).find(a => String(a.backendId) === String(employeeId)) || null;
  }
  function ficheId(employeeId) { const agent = localAgent(employeeId); return agent ? agent.id : ""; }
  function resultsHTML() {
    if (!create.results.length) return create.q.length >= 2 ? `<p class="bs-muted">Aucun employé trouvé.</p>` : "";
    return create.results.map(r => `<button class="bs-result" data-bs="pick" data-id="${r.id}"><strong>${esc(r.nom)} ${esc(r.prenom)}</strong><small>${esc(r.matricule)} · ${esc(r.site_code || "sans site")}</small>${statusPill(r.badge)}</button>`).join("");
  }
  let searchTimer = null;
  function createSearch(view, value) {
    create.q = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const asked = value;
      try {
        create.results = value.trim().length >= 2 ? (await api("/employees" + query({ society: society(), q: value.trim(), page_size: 8 }))).items : [];
      } catch (error) { create.results = []; }
      const host = view.querySelector("[data-bs-results]");
      if (host && create.q === asked) host.innerHTML = resultsHTML();
    }, 250);
  }
  /** Photo ajoutée depuis le studio : enregistrée par le circuit de la fiche employé (même API,
      même synchronisation de la référence faciale), jamais par un second chemin. */
  async function addPhoto(view, file) {
    const emp = create.employee;
    if (!file || !emp) return;
    let agent = localAgent(emp.id);
    if (!agent && typeof sgdiEnsureEmployeesForDisplay === "function") {
      try { await sgdiEnsureEmployeesForDisplay({ society: society() }); } catch (e) { /* signalé ci-dessous */ }
      agent = localAgent(emp.id);
    }
    if (!agent || typeof employeeApiPayload !== "function") return notify("Fiche non chargée : ajoutez la photo depuis la fiche de l'employé.", "error");
    try {
      const dataUrl = await resizeImage(file, 1000, "image/jpeg");
      const previous = agent.photo;
      agent.photo = dataUrl;
      try {
        const saved = await SGDI.employees.update(agent.backendId, employeeApiPayload(agent), "?photo_source=DRH_UPLOAD");
        if (typeof employeeFromApi === "function") Object.assign(agent, employeeFromApi(saved), { backendId: saved && saved.id || agent.backendId });
      } catch (error) { agent.photo = previous; throw error; }
      state.photos.delete(`/employees/${emp.id}/photo`);
      create.crop = { zoom: 1, dx: 0, dy: 0 };
      notify("Photo enregistrée sur la fiche de l'employé.", "success");
      rerender();
    } catch (error) { notify("Photo non enregistrée : " + (error.message || error), "error"); }
  }
  function resizeImage(file, maxSide, type) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error("Format accepté : JPEG ou PNG."));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        if (type === "image/jpeg") { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL(type, 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible.")); };
      img.src = url;
    });
  }
  function revokeDialog(badge) {
    if (typeof openModal !== "function") return;
    api("/settings").then(settings => {
      openModal(`<h2 class="text-xl font-bold mb-2">Révoquer le badge ${esc(badge.number)}</h2>
        <p class="text-sm text-slate-600 mb-3">Le badge ne pourra plus être imprimé et sa page de vérification indiquera « Badge désactivé ».</p>
        <label class="label">Motif</label><select class="select" id="bs-revoke-reason">${Object.entries(settings.revoke_reasons).map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join("")}</select>
        <label class="label mt-3">Précision (facultatif)</label><input class="input" id="bs-revoke-comment" maxlength="500">
        <div class="flex justify-end gap-2 mt-4"><button class="btn btn-ghost" id="bs-revoke-cancel">Annuler</button><button class="btn btn-danger" id="bs-revoke-ok">Révoquer le badge</button></div>`);
      document.getElementById("bs-revoke-cancel").onclick = closeModal;
      document.getElementById("bs-revoke-ok").onclick = async () => {
        try {
          await api(`/${badge.id}/revoke`, { method: "POST", body: { reason: document.getElementById("bs-revoke-reason").value, comment: document.getElementById("bs-revoke-comment").value } });
          closeModal();
          syncLocalBadgeState(badge.employee_id, false);
          notify("Badge révoqué.", "success");
          rerender();
        } catch (error) { notify(error.message || String(error), "error"); }
      };
    }).catch(error => notify(error.message || String(error), "error"));
  }
  /** La fiche en mémoire suit l'état du badge : un enregistrement ultérieur ne le réécrit pas à l'envers. */
  function syncLocalBadgeState(employeeId, active) {
    const agent = localAgent(employeeId);
    if (agent) agent.badgeActif = active;
  }
  async function showIssued(badge) {
    if (typeof openModal !== "function") return;
    const [detail, photo] = await Promise.all([api("/" + badge.id), badge.has_photo ? loadPhoto(`/${badge.id}/photo`) : null]);
    if (Object.values(detail.values || {}).some(value => !isLatin(value))) await loadUnicodeFont();
    openModal(`<h2 class="text-xl font-bold mb-3">Badge ${esc(detail.number)} — tel qu'émis</h2><div class="bs-modal-preview">${previewHTML(detail.design, { values: detail.values, qr: detail.qr, photo, crop: detail.crop }, { realistic: true, width: 230 })}</div><div class="flex justify-end mt-4"><button class="btn btn-ghost" id="bs-issued-close">Fermer</button></div>`);
    document.getElementById("bs-issued-close").onclick = closeModal;
  }

  // ── Modèles ───────────────────────────────────────────────────────────────
  async function renderTemplates(view, alive) {
    loading(view, "modeles");
    const templates = await loadTemplates(true);
    if (!alive()) return;
    shell(view, "modeles", `<div class="bs-templates">${templates.map(t => `<article class="card bs-template">
        <div class="bs-template-thumb">${previewHTML(t.design, { values: SAMPLE }, { width: 150 })}</div>
        <div class="bs-template-body"><h3>${esc(t.name)}</h3>
          <p>${t.is_system ? `<span class="bs-pill is-muted">Référence</span>` : ""}${t.is_default ? `<span class="bs-pill is-ok">Par défaut</span>` : ""}<span class="bs-pill is-none">${esc(t.society || "Toutes sociétés")}</span></p>
          <small>${num(t.width_mm)} × ${num(t.height_mm)} mm · ${t.design.pages.length > 1 ? "recto verso" : "recto"} · version ${esc(t.version)}</small>
          <div class="bs-actions">
            ${t.is_system || !can("admin") ? "" : `<a class="btn btn-primary" href="#/drh/badges/studio/${t.id}">Modifier</a>`}
            ${can("admin") ? `<button class="btn btn-secondary" data-bs="tpl-duplicate" data-id="${t.id}">Dupliquer</button>` : ""}
            ${t.is_default || !can("admin") ? "" : `<button class="btn btn-ghost" data-bs="tpl-default" data-id="${t.id}">Définir par défaut</button>`}
            <button class="btn btn-ghost" data-bs="tpl-proof" data-id="${t.id}">Épreuve PDF</button>
            ${t.is_system || t.is_default || !can("admin") ? "" : `<button class="btn btn-danger" data-bs="tpl-archive" data-id="${t.id}">Archiver</button>`}
          </div>${(t.warnings || []).length ? `<ul class="bs-warnings">${t.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</div></article>`).join("")}</div>`,
      can("admin") ? `<a class="btn btn-primary" href="#/drh/badges/studio/nouveau">Nouveau modèle</a>` : "");
  }

  // ── Historique ────────────────────────────────────────────────────────────
  const historyState = { q: "", action: "", page: 1 };
  async function renderHistory(view, alive) {
    loading(view, "historique");
    const data = await api("/history" + query({ society: society(), q: historyState.q, action: historyState.action, page: historyState.page, page_size: 50 }));
    if (!alive()) return;
    shell(view, "historique", `<div class="bs-filters"><input class="input bs-search" type="search" placeholder="Rechercher un badge, un employé, un utilisateur…" value="${esc(historyState.q)}" data-bs-field="history-q" aria-label="Rechercher dans l'historique">
        <select class="select" data-bs-field="history-action" aria-label="Type d'action"><option value="">Toutes les actions</option>${Object.entries(ACTION_LABELS).map(([key, label]) => `<option value="${key}" ${historyState.action === key ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
      ${data.items.length ? `<div class="bs-table-wrap"><table class="bs-table"><thead><tr><th>Date</th><th>Action</th><th>Détail</th><th>Société</th><th>Utilisateur</th></tr></thead><tbody>
        ${data.items.map(e => `<tr><td>${esc(dateFr(e.created_at, true))}</td><td><span class="bs-pill is-muted">${esc(ACTION_LABELS[e.action] || e.action)}</span></td><td>${e.employee_id ? `<a href="#/drh/badges/creer/${esc(e.employee_id)}">${esc(e.label)}</a>` : esc(e.label)}</td><td>${esc(e.society || "—")}</td><td>${esc(e.username || "—")}</td></tr>`).join("")}
      </tbody></table></div>${pager(data)}` : `<div class="bs-empty">Aucun événement.</div>`}`);
  }

  // ── Paramètres ────────────────────────────────────────────────────────────
  async function renderSettings(view, alive) {
    loading(view, "parametres");
    const out = await api("/settings" + query({ society: society() }));
    if (!alive()) return;
    const d = out.data;
    shell(view, "parametres", `<form class="card bs-panel bs-settings" data-bs-form="settings">
      <p class="bs-muted">Réglages ${society() ? "de la société " + esc(society()) : "communs à toutes les sociétés"}. Format de carte : ${num(out.card.width_mm)} × ${num(out.card.height_mm)} mm (CR80), modifiable par modèle dans le studio.</p>
      <label>Préfixe des numéros de badge<input class="input" name="number_prefix" maxlength="8" value="${esc(d.number_prefix)}"></label>
      <label>Durée de validité (mois, 0 = sans date de fin)<input class="input" type="number" min="0" max="120" name="validity_months" value="${esc(d.validity_months)}"></label>
      <label>Photo utilisée<select class="select" name="photo_source"><option value="portrait" ${d.photo_source === "portrait" ? "selected" : ""}>Portrait recadré sur le visage, fond blanc</option><option value="original" ${d.photo_source === "original" ? "selected" : ""}>Photo de la fiche telle quelle</option></select></label>
      <label class="bs-inline"><input type="checkbox" name="require_photo" ${d.require_photo ? "checked" : ""}> Refuser l'émission d'un badge sans photo</label>
      <label>Sortie d'impression par défaut<select class="select" name="print_layout"><option value="card" ${d.print_layout === "card" ? "selected" : ""}>Une carte par page (imprimante à cartes)</option><option value="a4" ${d.print_layout === "a4" ? "selected" : ""}>Planche A4 à découper</option></select></label>
      <label>Marge de la planche A4 (mm)<input class="input" type="number" min="5" max="30" step="0.5" name="sheet_margin_mm" value="${esc(d.sheet_margin_mm)}"></label>
      <label>Espace entre les cartes (mm)<input class="input" type="number" min="0" max="20" step="0.5" name="sheet_gap_mm" value="${esc(d.sheet_gap_mm)}"></label>
      <label class="bs-inline"><input type="checkbox" name="crop_marks" ${d.crop_marks ? "checked" : ""}> Traits de coupe sur la planche A4</label>
      <div class="bs-actions">${can("admin") ? `<button class="btn btn-primary" type="submit" data-no-save-overlay="1">Enregistrer les paramètres</button>` : `<p class="bs-note is-warn">${NO_RIGHT}</p>`}</div></form>`);
  }

  // ── Routage et événements ─────────────────────────────────────────────────
  let current = { view: null, screen: "dashboard", key: "" };
  function routeParam() { return decodeURIComponent(((location.hash || "").slice(2).split("/")[3]) || ""); }
  function rerender() { if (current.view && current.view.isConnected) renderBadgeStudio(current.view, current.screen, true); }
  function renderBadgeStudio(view, screen, force) {
    ensureStyles();
    screen = SCREENS.some(s => s[0] === screen) ? screen : "dashboard";
    // L'application redessine la vue à chaque synchronisation de ses données : un écran déjà
    // affiché pour la même route est laissé tel quel (saisie, sélection et maquette en cours).
    const key = [screen, routeParam(), society()].join("|");
    if (!force && current.view === view && current.key === key && view.querySelector(`.bs-page[data-bs-screen="${screen}"]`)) return;
    bind(view);
    current = { view, screen, key };
    const seq = ++state.seq;
    const alive = () => seq === state.seq && view.isConnected;
    const param = routeParam();
    const run = {
      dashboard: () => renderDashboard(view, alive), creer: () => renderCreate(view, alive, param),
      personnel: () => renderList(view, alive, "personnel", param), lot: () => renderList(view, alive, "lot", param),
      modeles: () => renderTemplates(view, alive), historique: () => renderHistory(view, alive), parametres: () => renderSettings(view, alive),
      studio: () => {
        if (!window.BadgeStudioEditor) throw new Error("Le studio de conception n'est pas chargé.");
        return window.BadgeStudioEditor.mount(view, param, alive);
      },
    }[screen];
    loading(view, screen);
    loadRights().then(() => (alive() ? run() : null)).catch(error => { if (alive()) failure(view, screen, error); });
  }
  function bind(view) {
    if (view.dataset.bsBound) return;
    view.dataset.bsBound = "1";
    view.addEventListener("click", event => {
      const target = event.target.closest("[data-bs]");
      if (!target || !view.contains(target) || !view.querySelector(".bs-page") || target.closest(".bs-studio")) return;
      const action = target.dataset.bs;
      const emp = create.employee;
      const guard = fn => Promise.resolve().then(fn).catch(error => notify(error.message || String(error), "error"));
      if (action === "reload") rerender();
      else if (action === "page") { (current.screen === "historique" ? historyState : listState).page = Number(target.dataset.page) || 1; rerender(); }
      else if (action === "state") { listState.state = target.dataset.state; listState.page = 1; rerender(); }
      else if (action === "check") { const id = Number(target.value); if (target.checked) state.selection.add(id); else state.selection.delete(id); const c = view.querySelector("[data-bs-count]"); if (c) c.textContent = state.selection.size; }
      else if (action === "check-all") { view.querySelectorAll('[data-bs="check"]').forEach(box => { box.checked = target.checked; const id = Number(box.value); if (target.checked) state.selection.add(id); else state.selection.delete(id); }); const c = view.querySelector("[data-bs-count]"); if (c) c.textContent = state.selection.size; }
      else if (action === "clear-selection") { state.selection.clear(); rerender(); }
      else if (action === "lot-issue-print") lotRun(view, true);
      else if (action === "lot-print") lotRun(view, false);
      else if (action === "pick") { create.q = ""; create.results = []; create.crop = { zoom: 1, dx: 0, dy: 0 }; create.templateId = ""; location.hash = "#/drh/badges/creer/" + target.dataset.id; }
      else if (action === "view-real" || action === "view-flat") { create.realistic = action === "view-real"; view.querySelectorAll('[data-bs="view-real"],[data-bs="view-flat"]').forEach(b => b.classList.toggle("is-active", b === target)); createPreview(view); }
      else if (action === "crop-reset") { create.crop = { zoom: 1, dx: 0, dy: 0 }; rerender(); }
      else if (action === "issue" && emp) guard(async () => {
        if (emp.badge && !confirm(`Le badge ${emp.badge.number} sera remplacé par un nouveau badge. Continuer ?`)) return;
        target.disabled = true;
        try {
          const badge = await api("/issue", { method: "POST", body: { employee_id: emp.id, template_id: Number(create.templateId) || null, crop: create.crop, valid_until: (view.querySelector('[data-bs-field="valid-until"]') || {}).value || null } });
          syncLocalBadgeState(emp.id, true);
          notify(`Badge ${badge.number} émis.`, "success");
          rerender();
        } finally { target.disabled = false; }
      });
      else if (action === "proof" && emp) guard(async () => saveBlob(await apiBlob("/preview/pdf", { employee_id: emp.id, template_id: Number(create.templateId) || null, crop: create.crop }), true));
      else if (action === "print" && emp && emp.badge) guard(async () => { saveBlob(await apiBlob("/print/pdf", { badge_ids: [emp.badge.id], layout: target.dataset.layout })); rerender(); });
      else if (action === "revoke" && emp && emp.badge) revokeDialog(emp.badge);
      else if (action === "show-issued" && emp && emp.badge) guard(() => showIssued(emp.badge));
      else if (action === "tpl-duplicate") guard(async () => { const copy = await api(`/templates/${target.dataset.id}/duplicate` + query({ society: society() }), { method: "POST" }); state.templates = null; location.hash = "#/drh/badges/studio/" + copy.id; });
      else if (action === "tpl-default") guard(async () => { await api(`/templates/${target.dataset.id}/default`, { method: "POST" }); notify("Modèle par défaut mis à jour.", "success"); rerender(); });
      else if (action === "tpl-archive") guard(async () => { if (!confirm("Archiver ce modèle ? Les badges déjà émis ne sont pas modifiés.")) return; await api(`/templates/${target.dataset.id}`, { method: "DELETE" }); notify("Modèle archivé.", "success"); rerender(); });
      else if (action === "tpl-proof") guard(async () => saveBlob(await apiBlob("/preview/pdf", { template_id: Number(target.dataset.id) }), true));
    });
    let typing = null;
    view.addEventListener("input", event => {
      const field = event.target.dataset && event.target.dataset.bsField;
      if (!field || event.target.closest(".bs-studio")) return;
      const value = event.target.value;
      if (field === "create-q") createSearch(view, value);
      else if (field.startsWith("crop-")) { create.crop[field.slice(5)] = Number(value); createPreview(view); }
      else if (field === "q" || field === "history-q") {
        clearTimeout(typing);
        typing = setTimeout(() => {
          if (field === "q") { listState.q = value; listState.page = 1; } else { historyState.q = value; historyState.page = 1; }
          const position = event.target.selectionStart;
          Promise.resolve(rerender()).then(() => setTimeout(() => { const input = view.querySelector(`[data-bs-field="${field}"]`); if (input) { input.focus(); try { input.setSelectionRange(position, position); } catch (e) { /* type search */ } } }, 350));
        }, 350);
      }
    });
    view.addEventListener("change", event => {
      const field = event.target.dataset && event.target.dataset.bsField;
      if (!field || event.target.closest(".bs-studio")) return;
      if (field === "template") { create.templateId = event.target.value; createPreview(view); }
      else if (field === "photo-file") addPhoto(view, event.target.files[0]);
      else if (field === "lot-template") listState.template = event.target.value;
      else if (field === "lot-layout") listState.layout = event.target.value;
      else if (field === "history-action") { historyState.action = event.target.value; historyState.page = 1; rerender(); }
    });
    view.addEventListener("submit", event => {
      const form = event.target.closest('[data-bs-form="settings"]');
      if (!form) return;
      event.preventDefault();
      const f = new FormData(form);
      api("/settings", { method: "PUT", body: { society: society() || null, data: {
        number_prefix: f.get("number_prefix"), validity_months: Number(f.get("validity_months")), photo_source: f.get("photo_source"),
        require_photo: f.has("require_photo"), print_layout: f.get("print_layout"), sheet_margin_mm: Number(f.get("sheet_margin_mm")),
        sheet_gap_mm: Number(f.get("sheet_gap_mm")), crop_marks: f.has("crop_marks") } } })
        .then(() => { notify("Paramètres enregistrés.", "success"); rerender(); })
        .catch(error => notify(error.message || String(error), "error"));
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("bs-styles")) return;
    const style = document.createElement("style");
    style.id = "bs-styles";
    style.textContent = `
.bs-page{--bs-navy:#043970;--bs-blue:#0d6ecc;--bs-ink:#10243e;--bs-muted:#64748b;--bs-line:#dbe5f0;--bs-yellow:#FFCB05;color:var(--bs-ink);display:flex;flex-direction:column;gap:14px;min-width:0}
.bs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:linear-gradient(135deg,#043970,#0d6ecc);color:#fff;border-radius:18px;padding:16px 18px}
.bs-head-title{display:flex;align-items:center;gap:12px;min-width:0}.bs-title{font-size:20px;font-weight:900;line-height:1.15;color:#fff}.bs-subtitle{margin-top:2px;font-size:12px;color:rgba(255,255,255,.88)}
.bs-logo{width:44px;height:44px;border-radius:13px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);display:grid;place-items:center;font-weight:900;flex:none}
.bs-head-actions{display:flex;gap:8px;flex-wrap:wrap}
.bs-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}.bs-tabs a{flex:none;padding:8px 14px;border-radius:999px;border:1px solid var(--bs-line);background:#fff;color:var(--bs-navy);font-size:12.5px;font-weight:800;text-decoration:none;white-space:nowrap}
.bs-tabs a.is-active{background:var(--bs-navy);border-color:var(--bs-navy);color:#fff}.bs-tabs a:focus-visible,.bs-chips button:focus-visible,.bs-result:focus-visible{outline:2px solid var(--bs-blue);outline-offset:2px}
.bs-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.bs-panel{padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}.bs-panel h2{margin:0;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:var(--bs-navy)}
.bs-panel label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#42566f}.bs-panel label.bs-inline{flex-direction:row;align-items:center;gap:8px;font-weight:700}
.bs-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.bs-kpi{background:#fff;border:1px solid var(--bs-line);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:2px;text-decoration:none;color:inherit;box-shadow:0 2px 8px rgba(15,23,42,.05)}
.bs-kpi:hover{border-color:var(--bs-blue)}.bs-kpi span{font-size:12px;font-weight:800;color:var(--bs-muted)}.bs-kpi strong{font-size:28px;font-weight:900;color:var(--bs-navy);font-variant-numeric:tabular-nums}.bs-kpi small{font-size:11px;color:var(--bs-muted)}
.bs-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.bs-quick,.bs-actions{display:flex;flex-wrap:wrap;gap:8px}
.bs-activity{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}.bs-activity li{display:flex;gap:10px;align-items:flex-start}.bs-activity strong{display:block;font-size:13px}.bs-activity small,.bs-table small{display:block;color:var(--bs-muted);font-size:11.5px}
.bs-muted{color:var(--bs-muted);font-size:12.5px;margin:0}
.bs-pill{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;margin-right:4px}
.bs-pill.is-ok{background:#dcfce7;color:#166534}.bs-pill.is-bad{background:#fee2e2;color:#991b1b}.bs-pill.is-warn{background:#fef3c7;color:#92400e}.bs-pill.is-muted{background:#e2e8f0;color:#334155}.bs-pill.is-none{background:#f1f5f9;color:#475569}
.bs-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.bs-search{border-radius:999px!important;padding:0 16px!important;height:40px;min-height:40px}.bs-filters .bs-search{flex:1 1 260px}
.bs-chips{display:flex;gap:6px;flex-wrap:wrap}.bs-chips button{padding:7px 13px;border-radius:999px;border:1px solid var(--bs-line);background:#fff;color:var(--bs-navy);font-size:12px;font-weight:800;cursor:pointer}.bs-chips button.is-active{background:var(--bs-navy);border-color:var(--bs-navy);color:#fff}
.bs-table-wrap{overflow-x:auto;background:#fff;border:1px solid var(--bs-line);border-radius:16px}.bs-table{width:100%;border-collapse:collapse;font-size:13px}
.bs-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--bs-muted);padding:10px 12px;border-bottom:1px solid var(--bs-line);white-space:nowrap}
.bs-table td{padding:10px 12px;border-bottom:1px solid #eef2f7;vertical-align:middle}.bs-table tr:last-child td{border-bottom:0}.bs-check{width:36px}.bs-row-actions{text-align:right;white-space:nowrap}
.bs-pager{display:flex;align-items:center;justify-content:center;gap:12px;font-size:12.5px;color:var(--bs-muted)}
.bs-empty{padding:32px 16px;text-align:center;color:var(--bs-muted);display:flex;flex-direction:column;gap:8px;align-items:center}.bs-error strong{color:#991b1b}
.bs-lotbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:end}.bs-lot-actions{display:flex;gap:8px;flex-wrap:wrap;grid-column:1/-1}.bs-lotbar [data-bs-report]{grid-column:1/-1}
.bs-report{background:#fef3c7;border-radius:12px;padding:10px 12px;font-size:12.5px}.bs-report ul{margin:6px 0 0 18px;padding:0}
.bs-create{display:grid;grid-template-columns:minmax(260px,320px) minmax(300px,1fr) minmax(260px,340px);gap:14px;align-items:start}.bs-col{display:flex;flex-direction:column;gap:14px;min-width:0}
@media(max-width:1100px){.bs-create{grid-template-columns:1fr}}
.bs-results{display:flex;flex-direction:column;gap:6px}.bs-result{display:grid;grid-template-columns:1fr auto;gap:2px 8px;text-align:left;border:1px solid var(--bs-line);background:#fff;border-radius:12px;padding:8px 10px;cursor:pointer}.bs-result small{grid-column:1;color:var(--bs-muted);font-size:11.5px}.bs-result .bs-pill{grid-column:2;grid-row:1/3;align-self:center}
.bs-dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.bs-dl dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--bs-muted);font-weight:800}.bs-dl dd{margin:0;font-size:13px;font-weight:700;overflow-wrap:anywhere}
.bs-note{margin:0;font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 10px}.bs-note.is-ok{background:#dcfce7;color:#166534}.bs-note.is-bad{background:#fee2e2;color:#991b1b}.bs-note.is-warn{background:#fef3c7;color:#92400e}
.bs-file{cursor:pointer;justify-content:center}.bs-preview-bar{display:flex;gap:10px;align-items:end;justify-content:space-between;flex-wrap:wrap}.bs-preview-bar label{flex:1 1 200px}
.bs-preview-host{display:flex;justify-content:center;background:linear-gradient(180deg,#eef2f7,#dfe5ee);border-radius:14px;padding:18px 10px;min-height:320px;overflow:auto}
.bs-preview{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;align-items:flex-start}.bs-preview figure{margin:0;display:flex;flex-direction:column;align-items:center}.bs-preview figcaption{margin-top:8px;font-size:11.5px;font-weight:800;color:var(--bs-muted)}
.bs-card{width:var(--bs-card-w,250px);border-radius:calc(var(--bs-card-w,250px)*.048);overflow:hidden;background:#fff;box-shadow:0 6px 18px rgba(15,23,42,.18)}.bs-svg{display:block;width:100%;height:100%}
.bs-lanyard{width:calc(var(--bs-card-w)*.21);height:calc(var(--bs-card-w)*.42);background:repeating-linear-gradient(135deg,#f2b600 0 3px,#ffcb05 3px 6px);border-radius:2px 2px 0 0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);margin-bottom:calc(var(--bs-card-w)*-.1);position:relative;z-index:0}
.bs-holder{position:relative;z-index:1;padding:calc(var(--bs-card-w)*.105) calc(var(--bs-card-w)*.04) calc(var(--bs-card-w)*.04);border-radius:calc(var(--bs-card-w)*.07);background:linear-gradient(145deg,rgba(255,255,255,.72),rgba(226,232,240,.38));border:1.5px solid rgba(255,255,255,.95);box-shadow:0 14px 34px rgba(15,23,42,.28),inset 0 0 0 1px rgba(148,163,184,.45)}
.bs-holder .bs-card{box-shadow:0 1px 3px rgba(15,23,42,.25)}
.bs-slot{position:absolute;top:calc(var(--bs-card-w)*.03);left:50%;transform:translateX(-50%);width:calc(var(--bs-card-w)*.26);height:calc(var(--bs-card-w)*.045);border-radius:999px;background:rgba(148,163,184,.25);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.95),inset 0 1px 3px rgba(15,23,42,.3)}
.bs-gloss{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.34) 0,rgba(255,255,255,0) 24%,rgba(255,255,255,0) 66%,rgba(255,255,255,.2) 100%)}
.bs-templates{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}.bs-template{display:flex;gap:14px;padding:14px}.bs-template-thumb{flex:none}.bs-template-body{display:flex;flex-direction:column;gap:8px;min-width:0}.bs-template h3{margin:0;font-size:15px;font-weight:900}.bs-template p{margin:0;display:flex;flex-wrap:wrap;gap:4px}.bs-template small{color:var(--bs-muted);font-size:11.5px}
.bs-settings{max-width:620px}.bs-warnings{margin:0;padding:8px 10px 8px 26px;background:#fef3c7;color:#92400e;border-radius:10px;font-size:12px;font-weight:700}.bs-modal-preview{display:flex;justify-content:center;background:#e8edf3;border-radius:14px;padding:18px}
@media(max-width:640px){.bs-head{border-radius:14px}.bs-dl{grid-template-columns:1fr}.bs-template{flex-direction:column;align-items:center}}`;
    document.head.appendChild(style);
  }

  function destroyAll() { state.seq++; clearTimeout(searchTimer); forgetPhotos(); if (window.BadgeStudioEditor) window.BadgeStudioEditor.destroy(); }
  window.renderBadgeStudio = renderBadgeStudio;
  window.badgeStudioDestroy = destroyAll;
  window.BadgeStudio = { isLatin, loadUnicodeFont, can, NO_RIGHT, api, apiBlob, saveBlob, badgeSvg, previewHTML, coverBox, fillFields, esc, num, color, notify, society, loadTemplates, resizeImage, shell, state, SAMPLE, PT, forgetPhotos };

  SGDIModules.registerModule({
    key: "badges", routes: [], dependencies: ["badges-studio"], init: function () {},
    destroy: destroyAll,
  });
})();
