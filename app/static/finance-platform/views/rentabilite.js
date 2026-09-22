// Rentabilité (§9) : CA/coût personnel/achats/marge depuis les sources canoniques
// (profitability.service.margin, déjà réel). Axes réellement disponibles uniquement —
// contrat/site ne sont PAS fabriqués si la source ne les porte pas encore : affichés
// explicitement comme indisponibles plutôt que masqués silencieusement.
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.rentabilite = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Rentabilité</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")} — période ${FP.esc(ctx.period || "—")}</p>
      <div id="marge-kpis">${FP.skeletonKpis(4)}</div>
      <div class="card"><div class="card-head"><h2>Marge par client</h2></div><div id="marge-client">${FP.skeletonRows(4)}</div></div>
      <div class="card"><div class="card-head"><h2>Dimensions</h2></div>
        <p class="muted" style="margin:0">Axes réellement traçables aujourd'hui : société, client, période.
        <b>Contrat</b> et <b>site</b> ne sont pas encore des dimensions portées par les documents source
        (Invoice/FactureFournisseur/PayrollSlip) — non affichés ici pour ne fabriquer aucune donnée, dette documentée.</p>
      </div>`;
    if (!ctx.society || !ctx.period) { container.innerHTML = FP.emptyState("Sélectionnez une société et une période."); return; }

    try {
      const m = await FP.guardedApi("rentabilite", "/profitability/margin", { params: { society: ctx.society, period: ctx.period } });
      document.querySelector("#marge-kpis").innerHTML = `<div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Chiffre d'affaires</span><span class="kpi-value">${FP.money(m.ca)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Coût personnel</span><span class="kpi-value">${FP.money(m.cout_personnel)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Achats</span><span class="kpi-value">${FP.money(m.cout_achats)}</span></div>
        <div class="kpi-card ${parseFloat(m.marge_brute) < 0 ? "tone-danger" : "tone-success"}"><span class="kpi-label">Marge brute</span><span class="kpi-value">${FP.money(m.marge_brute)}</span><span class="kpi-sub">${m.taux_marge_pct !== null ? FP.pct(m.taux_marge_pct) : "—"}</span></div>
      </div>`;
    } catch (err) { if (err.name !== "AbortError") document.querySelector("#marge-kpis").innerHTML = FP.errorState(err); }

    try {
      const byClient = await FP.guardedApi("rentabilite-client", "/profitability/margin-by-client", { params: { society: ctx.society, period: ctx.period } });
      const el = document.querySelector("#marge-client");
      if (!byClient.length) { el.innerHTML = FP.emptyState("Aucune donnée pour cette période."); return; }
      el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Client</th><th class="num">CA</th><th class="num">Marge brute</th><th>Taux</th></tr></thead><tbody>
        ${byClient.map((c) => `<tr><td>${FP.esc(c.client)}</td><td class="num">${FP.money(c.ca)}</td><td class="num">${FP.money(c.marge_brute)}</td><td>${c.taux_marge_pct !== null ? FP.pct(c.taux_marge_pct) : "—"}</td></tr>`).join("")}
      </tbody></table></div>`;
    } catch (err) { if (err.name !== "AbortError") document.querySelector("#marge-client").innerHTML = FP.errorState(err); }
  };
})();
