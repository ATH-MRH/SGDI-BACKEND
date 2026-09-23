// Tableau de bord (§B6/§B7) : bannière + 5 KPI agrégés serveur + actions rapides. Aucun
// full-fetch — un seul appel à /site-workforce/dashboard, qui renvoie déjà les agrégats.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.dashboard = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Bonjour ${SW.esc(SW.state.user?.full_name || "")}</h1>
      <p class="section-sub" id="dash-sub">Chargé des effectifs — chargement…</p>
      <div id="dash-kpis">${SW.skeletonKpis(5)}</div>
      <div class="card"><div class="card-head"><h2>Actions rapides</h2></div><div id="dash-actions">${SW.skeletonRows(4)}</div></div>`;

    try {
      const s = await SW.guardedApi("dashboard", "/site-workforce/dashboard");
      SW.state.site = s.site;
      document.querySelector("#dash-sub").textContent = `Chargé des effectifs — Site ${s.site.name}`;

      document.querySelector("#dash-kpis").innerHTML = `<div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Effectif total</span><span class="kpi-value">${s.kpi.effectif_total}</span></div>
        <div class="kpi-card tone-success"><span class="kpi-label">Présents aujourd'hui</span><span class="kpi-value">${s.kpi.presents_aujourdhui}</span></div>
        <div class="kpi-card ${s.kpi.absents > 0 ? "tone-danger" : ""}"><span class="kpi-label">Absents</span><span class="kpi-value">${s.kpi.absents}</span></div>
        <div class="kpi-card tone-info"><span class="kpi-label">En congé</span><span class="kpi-value">${s.kpi.en_conge}</span></div>
        <div class="kpi-card tone-warn"><span class="kpi-label">En maladie</span><span class="kpi-value">${s.kpi.en_maladie}</span></div>
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
    } catch (err) {
      if (err.name !== "AbortError") {
        document.querySelector("#dash-kpis").innerHTML = SW.errorState(err);
        document.querySelector("#dash-actions").innerHTML = "";
      }
    }
  };
})();
