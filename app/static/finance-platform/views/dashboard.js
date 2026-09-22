// Tableau de bord (§3) : page d'accueil Finance — même agrégat serveur que Cockpit DG
// (cockpit.service.summary, étendu), présenté pour un usage quotidien DAF/Trésorerie/
// Contrôle de gestion. Alertes : échéance < 7 jours, retard, rapprochement non résolu,
// budget dépassé, obligation fiscale proche, événement comptable en échec — dérivées de
// l'agrégat serveur, jamais recalculées depuis une collection complète.
(function () {
  "use strict";
  const FP = window.FP;

  function buildAlerts(s, failedEvents) {
    const alerts = [];
    (s.fiscalite_a_echeance || []).forEach((o) => {
      const days = FP.daysUntil(o.echeance);
      if (days !== null && days < 0) alerts.push({ danger: true, text: `Obligation fiscale en retard : ${o.type} — échéance ${FP.dateFr(o.echeance)}`, nav: "fiscalite" });
      else if (days !== null && days < 7) alerts.push({ danger: false, text: `Échéance fiscale proche (${days}j) : ${o.type}`, nav: "fiscalite" });
    });
    if ((s.rapprochements_non_resolus || 0) > 0) alerts.push({ danger: false, text: `${s.rapprochements_non_resolus} cas de rapprochement en attente de confirmation`, nav: "banque" });
    if ((s.exceptions_bancaires_ouvertes || 0) > 0) alerts.push({ danger: false, text: `${s.exceptions_bancaires_ouvertes} transaction(s) bancaire(s) non rapprochée(s) (exception)`, nav: "banque" });
    (s.budget_vs_realise || []).forEach((b) => {
      const budget = parseFloat(b.budget) || 0, realise = parseFloat(b.realise) || 0;
      if (budget > 0 && realise > budget) alerts.push({ danger: true, text: `Budget dépassé : ${b.compte || b.centre_cout || "ligne #" + b.id} (${FP.pct((realise / budget) * 100)} consommé)`, nav: "budget" });
    });
    if (parseFloat(s.creances_echues) > 0) alerts.push({ danger: true, text: `${FP.money(s.creances_echues)} de créances échues`, nav: "creances" });
    if (parseFloat(s.dettes_echues) > 0) alerts.push({ danger: true, text: `${FP.money(s.dettes_echues)} de dettes échues`, nav: "dettes" });
    if (failedEvents > 0) alerts.push({ danger: true, text: `${failedEvents} événement(s) comptable(s) en échec`, nav: "comptabilite" });
    return alerts;
  }

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.dashboard = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Tableau de bord</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")} — période ${FP.esc(ctx.period || "—")}</p>
      <div id="dash-kpis">${FP.skeletonKpis(8)}</div>
      <div class="card"><div class="card-head"><h2>Alertes</h2></div><div id="dash-alerts">${FP.skeletonRows(3)}</div></div>`;
    if (!ctx.society || !ctx.period) { container.innerHTML = FP.emptyState("Sélectionnez une société et une période."); return; }

    try {
      const [s, failedEvents] = await Promise.all([
        FP.guardedApi("dash-summary", "/cockpit/summary", { params: { society: ctx.society, period: ctx.period } }),
        FP.api("/finance-core/accounting-events", { params: { society: ctx.society, status_filter: "failed", limit: 100 } }).then((r) => r.length).catch(() => 0),
      ]);

      document.querySelector("#dash-kpis").innerHTML = `<div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Trésorerie disponible</span><span class="kpi-value">${FP.money(s.tresorerie.position_bancaire)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Créances</span><span class="kpi-value">${FP.money(s.creances_ouvertes)}</span></div>
        <div class="kpi-card ${parseFloat(s.creances_echues) > 0 ? "tone-danger" : ""}"><span class="kpi-label">Créances échues</span><span class="kpi-value">${FP.money(s.creances_echues)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Dettes</span><span class="kpi-value">${FP.money(s.dettes_ouvertes)}</span></div>
        <div class="kpi-card ${parseFloat(s.dettes_echues) > 0 ? "tone-danger" : ""}"><span class="kpi-label">Dettes échues</span><span class="kpi-value">${FP.money(s.dettes_echues)}</span></div>
        <div class="kpi-card tone-success"><span class="kpi-label">Encaissements (période)</span><span class="kpi-value">${FP.money(s.encaissements_periode)}</span></div>
        <div class="kpi-card tone-warn"><span class="kpi-label">Décaissements (période)</span><span class="kpi-value">${FP.money(s.decaissements_periode)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Masse salariale</span><span class="kpi-value">${FP.money(s.masse_salariale)}</span></div>
        <div class="kpi-card"><span class="kpi-label">CNAS à payer</span><span class="kpi-value">${FP.money(s.cnas_a_payer)}</span></div>
        <div class="kpi-card"><span class="kpi-label">IRG à payer</span><span class="kpi-value">${FP.money(s.irg_a_payer)}</span></div>
        <div class="kpi-card ${parseFloat(s.marge_brute) < 0 ? "tone-danger" : "tone-success"}"><span class="kpi-label">Marge</span><span class="kpi-value">${FP.money(s.marge_brute)}</span><span class="kpi-sub">${s.taux_marge_pct !== null ? FP.pct(s.taux_marge_pct) : "—"}</span></div>
        <div class="kpi-card ${s.rapprochements_non_resolus > 0 ? "tone-warn" : "tone-success"}"><span class="kpi-label">Rapprochements non résolus</span><span class="kpi-value">${s.rapprochements_non_resolus}</span></div>
      </div>`;

      const alerts = buildAlerts(s, failedEvents);
      const el = document.querySelector("#dash-alerts");
      el.innerHTML = alerts.length
        ? `<div class="alert-list">${alerts.map((a, i) => `<div class="alert-item ${a.danger ? "danger" : ""}" data-alert="${i}" style="cursor:pointer">
            <span class="alert-item-icon">${a.danger ? "⛔" : "⚠"}</span><span>${a.text}</span></div>`).join("")}</div>`
        : FP.emptyState("Aucune alerte — tout est à jour.");
      el.querySelectorAll("[data-alert]").forEach((row) => row.addEventListener("click", () => ctx.navigate(alerts[row.dataset.alert].nav)));
    } catch (err) {
      if (err.name !== "AbortError") {
        document.querySelector("#dash-kpis").innerHTML = FP.errorState(err, "Réessayer");
        document.querySelector("#dash-alerts").innerHTML = "";
        document.querySelector("[data-retry]")?.addEventListener("click", () => window.FinanceViews.dashboard(container, ctx));
      }
    }
  };
})();
