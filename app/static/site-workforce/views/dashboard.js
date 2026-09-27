// Tableau de bord (§7) : KPI agrégés SERVEUR sur le périmètre consulté (un site, une société
// ou tous les sites autorisés) + répartition par site cliquable. Un seul appel à
// /site-workforce/dashboard, qui renvoie déjà les agrégats — aucun full-fetch.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.dashboard = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Bonjour ${SW.esc(SW.state.user?.full_name || "")}</h1>
      <p class="section-sub" id="dash-sub">${SW.esc(SW.scopeLabel())}</p>
      <div id="dash-kpis">${SW.skeletonKpis(10)}</div>
      <div class="card"><div class="card-head"><h2>Actions rapides</h2></div><div id="dash-actions">${SW.skeletonRows(4)}</div></div>
      <div class="card" id="dash-sites-card"><div class="card-head"><h2>Répartition par site</h2></div><div id="dash-sites">${SW.skeletonRows(3)}</div></div>`;

    try {
      const s = await SW.guardedApi("dashboard", "/site-workforce/dashboard");
      const k = s.kpi;
      const kpi = (label, value, tone) => `<div class="kpi-card ${tone || ""}"><span class="kpi-label">${SW.esc(label)}</span><span class="kpi-value">${value ?? 0}</span></div>`;
      document.querySelector("#dash-kpis").innerHTML = `<div class="kpi-grid">
        ${kpi("Effectif total", k.effectif_total)}
        ${kpi("Présents", k.presents_aujourdhui, "tone-success")}
        ${kpi("Absents", k.absents, k.absents > 0 ? "tone-danger" : "")}
        ${kpi("Retards", k.retards, k.retards > 0 ? "tone-warn" : "")}
        ${kpi("Congés", k.en_conge, "tone-info")}
        ${kpi("Maladies", k.en_maladie, "tone-warn")}
        ${kpi("Pointages incomplets", k.pointages_incomplets, k.pointages_incomplets > 0 ? "tone-warn" : "")}
        ${kpi("Justificatifs à vérifier", k.justificatifs_a_verifier, k.justificatifs_a_verifier > 0 ? "tone-warn" : "")}
        ${kpi("Réclamations ouvertes", k.reclamations_ouvertes)}
        ${kpi("Incidents à transmettre", k.incidents_a_transmettre, k.incidents_a_transmettre > 0 ? "tone-danger" : "")}
      </div>`;

      const actions = [
        { count: s.actions_rapides.absences_a_traiter, label: "Absences à traiter", nav: "absences" },
        { count: s.actions_rapides.justificatifs_en_attente, label: "Justificatifs en attente", nav: "justificatifs" },
        { count: s.actions_rapides.prochains_conges.length, label: "Prochains départs en congé", nav: "conges" },
        { count: s.actions_rapides.incidents_discipline, label: "Incidents / Discipline", nav: "discipline" },
      ];
      const el = document.querySelector("#dash-actions");
      el.innerHTML = `<div class="quick-actions">${actions.map((a, i) => `
        <button class="quick-action" data-action="${i}">
          <span class="quick-action-count">${a.count}</span>
          <span class="quick-action-label">${SW.esc(a.label)}</span>
        </button>`).join("")}</div>`;
      el.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => ctx.navigate(actions[btn.dataset.action].nav)));

      const rows = s.by_site || [];
      const sitesEl = document.querySelector("#dash-sites");
      if (rows.length <= 1) { sitesEl.innerHTML = ""; document.querySelector("#dash-sites-card").hidden = true; return; }
      sitesEl.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Site</th><th>Société</th><th>Effectif</th><th>Présents</th><th>Absents</th><th>Non pointés</th><th>Anomalies</th>
        </tr></thead><tbody>
        ${rows.map((r) => `<tr class="site-row-link" data-site-row="${r.site_id}" tabindex="0" title="Consulter ce site">
          <td><b>${SW.esc(r.site_name || "—")}</b></td><td>${SW.esc(r.society || "—")}</td>
          <td>${r.effectif}</td><td>${r.presents}</td><td>${r.absents}</td><td>${r.non_pointes}</td><td>${r.anomalies}</td>
        </tr>`).join("")}
        </tbody></table></div>`;
      sitesEl.querySelectorAll("[data-site-row]").forEach((row) => {
        const open = () => ctx.selectSite && ctx.selectSite(row.dataset.siteRow);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        document.querySelector("#dash-kpis").innerHTML = SW.errorState(err);
        document.querySelector("#dash-actions").innerHTML = "";
        document.querySelector("#dash-sites").innerHTML = "";
        document.querySelector("#dash-sites-card").hidden = true;
      }
    }
  };
})();
