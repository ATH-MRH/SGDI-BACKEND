// Tableau de bord (§7) : KPI agrégés SERVEUR sur le périmètre consulté (un site, une société
// ou tous les sites autorisés) + répartition par site. Un seul appel à /site-workforce/dashboard,
// qui renvoie déjà les agrégats — aucun full-fetch.
// Chaque compteur est un bouton : il ouvre l'écran correspondant, filtré (EFFECTIF filtré par
// présence ou statut, Justificatifs, Discipline…). Les filtres d'EFFECTIF reprennent les mêmes
// règles serveur que ces compteurs (journée réelle du jour, congé approuvé du jour).
(function () {
  "use strict";
  const SW = window.SW;

  const KPIS = [
    { key: "effectif_total", label: "Effectif total", icon: "users", tone: "blue", to: "personnel" },
    { key: "presents_aujourdhui", label: "Présents", icon: "usercheck", tone: "green", to: "personnel?presence=present" },
    { key: "absents", label: "Absents", icon: "userx", tone: "red", to: "personnel?presence=absent" },
    { key: "retards", label: "Retards", icon: "clock", tone: "orange", to: "pointage" },
    { key: "en_conge", label: "Congés", icon: "calendar", tone: "blue", to: "personnel?status=conge" },
    { key: "en_maladie", label: "Maladies", icon: "medical", tone: "violet", to: "personnel?status=maladie" },
    { key: "pointages_incomplets", label: "Pointages incomplets", icon: "filetext", tone: "orange", to: "personnel?presence=non_pointe" },
    { key: "justificatifs_a_verifier", label: "Justificatifs à vérifier", icon: "filecheck", tone: "rose", to: "justificatifs" },
    { key: "reclamations_ouvertes", label: "Réclamations ouvertes", icon: "message", tone: "green", to: "reclamations" },
    { key: "incidents_a_transmettre", label: "Incidents à transmettre", icon: "alert", tone: "cyan", to: "discipline" },
  ];

  function kpiButton(def, value) {
    const n = Number(value) || 0;
    return `<button type="button" class="beo-kpi tone-${def.tone}" data-kpi="${def.key}" data-to="${SW.esc(def.to)}"
        aria-label="${SW.esc(def.label)} : ${n} — ouvrir">
      <span class="beo-kpi-icon">${SW.icon(def.icon)}</span>
      <span class="beo-kpi-text"><span class="beo-kpi-label">${SW.esc(def.label)}</span><span class="beo-kpi-value">${n}</span></span>
      <span class="beo-kpi-go">${SW.icon("chevron")}</span>
    </button>`;
  }

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.dashboard = async function (container, ctx) {
    container.innerHTML = `
      <section class="beo-panel beo-hello">
        <h2 class="beo-hello-title">Bonjour ${SW.esc(SW.state.user?.full_name || "")}</h2>
        <p class="beo-hello-sub" id="dash-sub">${SW.esc(SW.scopeLabel())}</p>
        <div id="dash-kpis">${SW.skeletonKpis(10)}</div>
      </section>
      <section class="beo-panel"><h2 class="beo-panel-title">Actions rapides</h2><div id="dash-actions">${SW.skeletonRows(2)}</div></section>
      <section class="beo-panel" id="dash-sites-card"><h2 class="beo-panel-title">${SW.icon("building")}Répartition par site</h2><div id="dash-sites">${SW.skeletonRows(3)}</div></section>`;

    // Éléments capturés AVANT l'appel : si l'utilisateur a quitté l'écran entre-temps, la
    // réponse s'écrit dans des nœuds détachés, jamais dans l'écran suivant.
    const kpisEl = container.querySelector("#dash-kpis");
    const actionsEl = container.querySelector("#dash-actions");
    const sitesCard = container.querySelector("#dash-sites-card");
    const sitesEl = container.querySelector("#dash-sites");
    try {
      const s = await SW.guardedApi("dashboard", "/site-workforce/dashboard");
      const k = s.kpi || {};
      kpisEl.innerHTML = `<div class="beo-kpi-grid">${KPIS.map((def) => kpiButton(def, k[def.key])).join("")}</div>`;
      kpisEl.querySelectorAll("[data-to]").forEach((btn) => btn.addEventListener("click", () => ctx.navigate(btn.dataset.to)));

      const quick = s.actions_rapides || {};
      const actions = [
        { count: quick.absences_a_traiter, label: "Absences à traiter", nav: "absences", icon: "plane", tone: "blue" },
        { count: quick.justificatifs_en_attente, label: "Justificatifs en attente", nav: "justificatifs", icon: "filetext", tone: "orange" },
        { count: (quick.prochains_conges || []).length, label: "Prochains départs en congé", nav: "conges", icon: "calendar", tone: "violet" },
        { count: quick.incidents_discipline, label: "Incidents / Discipline", nav: "discipline", icon: "alert", tone: "red" },
      ];
      actionsEl.innerHTML = `<div class="beo-quick-grid">${actions.map((a, i) => `
        <button type="button" class="beo-quick tone-${a.tone}" data-action="${i}" aria-label="${SW.esc(a.label)} : ${Number(a.count) || 0} — ouvrir">
          <span class="beo-kpi-icon">${SW.icon(a.icon)}</span>
          <span class="beo-kpi-text"><span class="beo-quick-count">${Number(a.count) || 0}</span><span class="beo-kpi-label">${SW.esc(a.label)}</span></span>
          <span class="beo-kpi-go">${SW.icon("chevron")}</span>
        </button>`).join("")}</div>`;
      actionsEl.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => ctx.navigate(actions[btn.dataset.action].nav)));

      const rows = s.by_site || [];
      if (rows.length <= 1) { sitesEl.innerHTML = ""; sitesCard.hidden = true; return; }
      sitesEl.innerHTML = `<div class="table-wrap"><table class="beo-table beo-site-table"><thead><tr>
          <th>Site</th><th>Structure</th><th class="num">Effectif</th><th class="num">Présents</th><th class="num">Absents</th><th class="num">Non pointés</th><th class="num">Anomalies</th>
        </tr></thead><tbody>
        ${rows.map((r) => `<tr class="site-row-link" data-site-row="${r.site_id}" tabindex="0" title="Ouvrir EFFECTIF filtré sur ce site">
          <td><b>${SW.esc(r.site_name || "—")}</b></td><td>${SW.esc(r.society || "—")}</td>
          <td class="num">${r.effectif}</td><td class="num">${r.presents}</td><td class="num">${r.absents}</td><td class="num">${r.non_pointes}</td>
          <td class="num">${r.anomalies ? `<span class="beo-count-alert">${r.anomalies}</span>` : r.anomalies}</td>
        </tr>`).join("")}
        </tbody></table></div>`;
      // Ligne cliquable : EFFECTIF filtré sur ce site (filtre local, le périmètre du bandeau ne change pas).
      sitesEl.querySelectorAll("[data-site-row]").forEach((row) => {
        const open = () => ctx.navigate(`personnel?site=${encodeURIComponent(row.dataset.siteRow)}`);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        kpisEl.innerHTML = SW.errorState(err);
        actionsEl.innerHTML = "";
        sitesEl.innerHTML = "";
        sitesCard.hidden = true;
      }
    }
  };
})();
