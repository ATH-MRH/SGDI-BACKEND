// Couverture terrain : attendus du planning officiel (moteur central ou V7) par site et par
// vacation, présents rattachés à la vacation par Attendance Core, points critiques et employés à
// surveiller. Lecture seule ; tous les calculs sont faits par /site-workforce/attendance/coverage.
(function () {
  "use strict";
  const SW = window.SW;
  const COLORS = { A: ["#2563eb", "#dbeafe"], B: ["#16a34a", "#dcfce7"], C: ["#ea580c", "#ffedd5"], D: ["#9333ea", "#f3e8ff"] };
  const STATUS = { COVERED: "cov-ok", ATTENTION: "cov-warn", UNDERSTAFFED: "cov-bad", UNCOVERED: "cov-bad", CRITICAL: "cov-crit" };
  const TYPE_ICON = { LATE: "clock", ABANDON_POSTE: "userx", UNDERSTAFFED: "users", UNCOVERED_SHIFT: "alert", ABSENT: "userx" };

  function styles() {
    if (document.getElementById("cov-styles")) return;
    const s = document.createElement("style");
    s.id = "cov-styles";
    s.textContent = `.cov{display:grid;gap:16px;min-width:0}.cov *{box-sizing:border-box}
.cov-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:12px;align-items:end;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px}
.cov-field{display:grid;gap:5px;font-size:13px;font-weight:600;color:#334155;min-width:0}.cov-field select,.cov-field input{height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font:inherit;background:#fff;min-width:0;width:100%}
.cov-seg{display:flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}.cov-seg button{flex:1;height:40px;border:0;background:#fff;font-weight:700;cursor:pointer;color:#1e293b}.cov-seg button[aria-pressed="true"]{background:#1d4ed8;color:#fff}
.cov-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,165px),1fr));gap:12px}
.cov-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;display:flex;gap:10px;align-items:center;min-width:0}.cov-kpi.is-alert{border-color:#fca5a5;background:#fff5f5}
.cov-kpi-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}.cov-kpi-ic svg{width:22px;height:22px}
.cov-kpi b{display:block;font-size:13px;color:#0f172a;white-space:nowrap}.cov-kpi strong{font-size:26px;font-weight:900;color:#0b1f44;line-height:1.1}
.cov-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px}@media(max-width:1320px){.cov-grid{grid-template-columns:1fr}}
.cov-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;min-width:0}.cov-card h2{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:900;color:#0b1f44;margin:0 0 12px}
.cov-table{overflow:auto;border:1px solid #e2e8f0;border-radius:10px}.cov-table table{width:100%;border-collapse:collapse;font-size:13px;min-width:440px}.cov-table table.cov-crit-table{min-width:0}.cov-site .cov-muted{font-size:12px}.cov-table th,.cov-table td{padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:left}.cov-table th{background:#f8fafc;font-weight:800;color:#334155}.cov-table tfoot td{background:#eff6ff;font-weight:900}
.cov-num{text-align:right!important;font-variant-numeric:tabular-nums}.cov-neg{color:#dc2626;font-weight:800}
.cov-group{display:inline-flex;align-items:center;gap:7px;font-weight:700;white-space:nowrap}.cov-site b{white-space:nowrap}.cov-pill{white-space:nowrap}.cov-group i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#fff;font-style:normal;font-size:12px;font-weight:900}
.cov-pill{display:inline-block;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:800;white-space:nowrap}.cov-ok{background:#dcfce7;color:#15803d}.cov-warn{background:#fef3c7;color:#b45309}.cov-bad{background:#fee2e2;color:#b91c1c}.cov-crit{background:#b91c1c;color:#fff}.cov-info{background:#ffedd5;color:#c2410c}
.cov-type{display:inline-flex;gap:6px;align-items:center;color:#dc2626;font-weight:700}.cov-type svg{flex:0 0 auto}.cov-type svg{width:18px;height:18px}
.cov-watch{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
.cov-person{display:flex;gap:12px;align-items:center;border:1px solid #e2e8f0;border-radius:12px;padding:12px;min-width:0}.cov-avatar{width:52px;height:52px;border-radius:50%;background:#e2e8f0;display:grid;place-items:center;font-weight:900;color:#334155;overflow:hidden;flex:0 0 auto}.cov-avatar img{width:100%;height:100%;object-fit:cover}
.cov-person b{display:block}.cov-person small{color:#64748b}.cov-issue{display:inline-block;margin-top:6px;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:700}.cov-issue.is-incoherent{background:#ffedd5;color:#c2410c}
.cov-gpill{border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;margin-left:6px}
.cov-note{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#eff6ff;border-radius:10px;padding:10px 14px;margin-top:12px;font-size:13px;color:#1e3a8a}
.cov-muted{color:#64748b;font-size:13px}
@media(max-width:620px){.cov-table{border:0;overflow:visible}.cov-table table,.cov-table table.cov-crit-table{min-width:0}.cov-table thead{display:none}
.cov-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px}
.cov-table td{display:block;border:0;padding:0;text-align:left!important}.cov-table td::before{content:attr(data-label);display:block;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
.cov-table td[data-label="Site"],.cov-table td[data-label="Détail"],.cov-table td[data-label="Type"]{grid-column:1/-1}.cov-table .cov-hide-mobile{display:none}.cov-table tfoot td{background:none}.cov-table tfoot tr{background:#eff6ff}}`;
    document.head.appendChild(s);
  }
  const groupPill = (g) => g ? `<span class="cov-group"><i style="background:${COLORS[g][0]}">${g}</i>Groupe ${g}</span>` : `<span class="cov-pill cov-bad">Aucun groupe</span>`;
  const kpi = (icon, color, bg, label, value, alert) => `<div class="cov-kpi${alert ? " is-alert" : ""}"><div class="cov-kpi-ic" style="background:${bg};color:${color}">${SW.icon(icon)}</div><div><b>${SW.esc(label)}</b><strong>${value === null || value === undefined ? "—" : SW.esc(value)}</strong></div></div>`;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.couverture = async function (container, ctx) {
    styles();
    const today = new Date().toISOString().slice(0, 10);
    // Sans date ni vacation choisies, le serveur retient la vacation en cours (celle du Pointeur) ;
    // l'écran reprend ensuite sa date et sa nature dans les filtres.
    const chosen = ctx.query.get("date") || ctx.query.get("vacation");
    const f = { date: ctx.query.get("date") || (chosen ? today : ""), shift: ctx.query.get("vacation") || "", group: ctx.query.get("groupe") || "" };
    container.innerHTML = `<div class="cov">
      <div class="cov-filters" role="search" aria-label="Filtres de couverture">
        <label class="cov-field">Groupe<select id="cov-group"><option value="">Tous les groupes</option>${["A", "B", "C", "D"].map((g) => `<option value="${g}" ${g === f.group ? "selected" : ""}>Groupe ${g}</option>`).join("")}</select></label>
        <div class="cov-field">Vacation<div class="cov-seg" role="group" aria-label="Vacation"><button type="button" data-shift="JOUR" aria-pressed="${f.shift === "JOUR"}">Jour</button><button type="button" data-shift="NUIT" aria-pressed="${f.shift === "NUIT"}">Nuit</button></div></div>
        <label class="cov-field">Date<input type="date" id="cov-date" value="${SW.esc(f.date)}"></label>
      </div>
      <div id="cov-body">${SW.skeletonKpis(6)}${SW.skeletonRows(6)}</div></div>`;
    container.querySelector("#cov-group").addEventListener("change", (e) => { f.group = e.target.value; load(); });
    container.querySelector("#cov-date").addEventListener("change", (e) => { if (e.target.value) { f.date = e.target.value; load(); } });
    container.querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () => {
      f.shift = b.dataset.shift; container.querySelectorAll("[data-shift]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load();
    }));
    let stopPhotos = () => {};
    let showAllCrit = false;

    async function load() {
      const body = container.querySelector("#cov-body");
      try {
        const params = f.date || f.shift ? { date: f.date || today, shift: f.shift, group: f.group } : { group: f.group };
        const data = await SW.guardedApi("coverage", "/site-workforce/attendance/coverage", { params });
        if (!f.date) {
          f.date = data.date; f.shift = data.shift || "";
          container.querySelector("#cov-date").value = f.date;
          container.querySelectorAll("[data-shift]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.shift === f.shift)));
        }
        stopPhotos();
        const k = data.kpis;
        const rows = data.rows.map((r) => `<tr><td class="cov-site" data-label="Site"><b>${SW.esc(r.site || "—")}</b><div class="cov-muted">${SW.esc(r.shift_label)} ${SW.esc(r.start)} – ${SW.esc(r.end)}</div><div class="cov-muted">${SW.esc(r.regime_label)}${r.configuration_version ? " · v" + SW.esc(r.configuration_version) : ""}</div></td>
          <td data-label="Groupe">${groupPill(r.group)}</td><td class="cov-num" data-label="Attendus">${r.expected}</td><td class="cov-num" data-label="Présents">${r.present === null ? "—" : r.present}</td>
          <td class="cov-num ${r.gap < 0 ? "cov-neg" : ""}" data-label="Écart">${r.gap === null ? "—" : r.gap}</td><td data-label="Statut"><span class="cov-pill ${STATUS[r.status]}">${SW.esc(r.status_label)}</span></td></tr>`).join("");
        const total = data.rows.length ? `<tfoot><tr><td data-label="Total"><b>Total</b></td><td class="cov-hide-mobile">-</td><td class="cov-num" data-label="Attendus">${data.total.expected}</td><td class="cov-num" data-label="Présents">${data.total.present}</td><td class="cov-num ${data.total.gap < 0 ? "cov-neg" : ""}" data-label="Écart">${data.total.gap}</td><td data-label="Statut"><span class="cov-pill ${data.total.status_label === "Couvert" ? "cov-ok" : data.total.status_label === "Attention" ? "cov-warn" : "cov-bad"}">${SW.esc(data.total.status_label)}</span></td></tr></tfoot>` : "";
        const unplanned = data.unplanned_sites.length ? `<p class="cov-muted" style="margin-top:8px">Sans planning officiel publié : ${data.unplanned_sites.map((s) => SW.esc(s.site || "—")).join(", ")}.</p>` : "";
        const LIMIT = 6, allCrit = data.critical_points, shownCrit = showAllCrit ? allCrit : allCrit.slice(0, LIMIT);
        const crit = shownCrit.map((c) => `<tr><td data-label="Type"><span class="cov-type">${SW.icon(TYPE_ICON[c.type] || "alert")}${SW.esc(c.label)}</span></td><td data-label="Site">${SW.esc(c.site || "—")}</td>
          <td data-label="Employé">${c.employee ? `${SW.esc(c.employee.name)}<div class="cov-muted">${SW.esc(c.employee.matricule)}</div>` : "—"}</td><td data-label="Détail">${SW.esc(c.detail || "")}</td>
          <td data-label="Statut"><span class="cov-pill ${c.status_label === "Critique" ? "cov-crit" : c.status_label === "Investigation" ? "cov-info" : "cov-bad"}">${SW.esc(c.status_label)}</span></td></tr>`).join("");
        const watch = data.watch.map((w) => `<div class="cov-person"><div class="cov-avatar">${w.photo_url ? `<img hidden alt="" data-photo-src="${SW.esc(w.photo_url)}">` : ""}<span>${SW.esc(SW.initials(w.name.replace(",", "")))}</span></div>
          <div style="min-width:0"><b>${SW.esc(w.name)}${w.group ? `<span class="cov-gpill" style="background:${COLORS[w.group][1]};color:${COLORS[w.group][0]}">Groupe ${w.group}</span>` : ""}</b><small>${SW.esc(w.matricule)}${w.site ? " · " + SW.esc(w.site) : ""}</small>
          <div><span class="cov-issue ${w.kind === "incoherent" ? "is-incoherent" : ""}">${SW.esc(w.label)}</span></div></div></div>`).join("");
        body.innerHTML = `<div class="cov-kpis">${kpi("users", "#1d4ed8", "#dbeafe", "Effectif attendu", k.expected)}${kpi("user", "#15803d", "#dcfce7", "Présents", k.present)}${kpi("clock", "#b45309", "#fef3c7", "Retards", k.late)}${kpi("usercheck", "#1d4ed8", "#dbeafe", "Maintenus", k.maintained)}${kpi("userx", "#dc2626", "#fee2e2", "Absences", k.absent)}${kpi("alert", "#dc2626", "#fee2e2", "Points critiques", k.critical_points, k.critical_points > 0)}</div>
          <div class="cov-grid" style="margin-top:16px">
            <section class="cov-card" aria-label="Couverture par site"><h2>${SW.icon("building")}Couverture par site</h2>${data.rows.length ? `<div class="cov-table"><table><thead><tr><th>Site</th><th>Groupe</th><th class="cov-num">Attendus</th><th class="cov-num">Présents</th><th class="cov-num">Écart</th><th>Statut</th></tr></thead><tbody>${rows}</tbody>${total}</table></div>` : SW.emptyState("Aucune vacation officielle pour ces filtres.")}${unplanned}</section>
            <section class="cov-card" aria-label="Points critiques"><h2 style="justify-content:space-between"><span style="display:inline-flex;gap:8px;align-items:center"><span style="color:#dc2626">${SW.icon("alert")}</span>Points critiques</span>${allCrit.length > LIMIT ? `<button type="button" class="btn btn-sm" data-crit-all>${showAllCrit ? "Réduire" : `Voir tous les points critiques (${allCrit.length})`}</button>` : ""}</h2>${crit ? `<div class="cov-table"><table class="cov-crit-table"><thead><tr><th>Type</th><th>Site</th><th>Employé</th><th>Détail</th><th>Statut</th></tr></thead><tbody>${crit}</tbody></table></div>` : SW.emptyState("Aucun point critique ouvert.")}</section>
          </div>
          <section class="cov-card" style="margin-top:16px" aria-label="Employés à surveiller"><h2>${SW.icon("user")}Employés à surveiller</h2>${watch ? `<div class="cov-watch">${watch}</div>` : SW.emptyState("Aucun employé à surveiller sur les 7 derniers jours.")}
            <div class="cov-note"><span>${SW.icon("idcard")} Consultez la fiche de position de l'employé pour l'historique des pointages, affectations et incidents.</span><button type="button" class="btn btn-sm" data-go="position">Ouvrir les fiches de position</button></div></section>`;
        body.querySelector('[data-go="position"]').addEventListener("click", () => ctx.navigate("position"));
        body.querySelector("[data-crit-all]")?.addEventListener("click", () => { showAllCrit = !showAllCrit; load(); });
        stopPhotos = SW.lazyPhotos(body);
      } catch (err) {
        if (err && err.name === "AbortError") return;
        body.innerHTML = SW.errorState(err);
      }
    }
    await load();
    return () => stopPhotos();
  };
})();
