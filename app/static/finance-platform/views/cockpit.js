// Cockpit DG (§3 + §13) : vision société (cockpit.service.summary, agrégat serveur pur) et
// vision groupe pour un compte multi-société/admin — simple juxtaposition des cockpits par
// société (jamais une consolidation inventée côté client : chaque carte reste EXACTEMENT le
// même agrégat que la vue société, pas une somme fabriquée d'entités légales distinctes).
(function () {
  "use strict";
  const FP = window.FP;

  function alertsFor(s) {
    const alerts = [];
    (s.fiscalite_a_echeance || []).forEach((o) => {
      const days = FP.daysUntil(o.echeance);
      if (days !== null && days < 0) alerts.push({ danger: true, text: `Fiscalité en retard : ${o.type} (${FP.esc(o.echeance)})` });
      else if (days !== null && days < 7) alerts.push({ danger: false, text: `Échéance fiscale < 7 jours : ${o.type} (${FP.esc(o.echeance)})` });
    });
    if ((s.rapprochements_non_resolus || 0) > 0) alerts.push({ danger: false, text: `${s.rapprochements_non_resolus} rapprochement(s) non résolu(s)` });
    if ((s.exceptions_bancaires_ouvertes || 0) > 0) alerts.push({ danger: false, text: `${s.exceptions_bancaires_ouvertes} exception(s) bancaire(s) ouverte(s)` });
    (s.budget_vs_realise || []).forEach((b) => {
      const budget = parseFloat(b.budget) || 0, realise = parseFloat(b.realise) || 0;
      if (budget > 0 && realise > budget) alerts.push({ danger: true, text: `Budget dépassé : ${b.compte || b.centre_cout || "ligne #" + b.id} (${FP.pct((realise / budget) * 100)})` });
    });
    return alerts;
  }

  function summaryCard(s) {
    const alerts = alertsFor(s);
    return `<div class="card">
      <div class="card-head"><h2>${FP.esc(s.society)}</h2></div>
      <div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Trésorerie disponible</span><span class="kpi-value">${FP.money(s.tresorerie.position_bancaire)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Créances ouvertes</span><span class="kpi-value">${FP.money(s.creances_ouvertes)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Dettes ouvertes</span><span class="kpi-value">${FP.money(s.dettes_ouvertes)}</span></div>
        <div class="kpi-card"><span class="kpi-label">Masse salariale</span><span class="kpi-value">${FP.money(s.masse_salariale)}</span></div>
        <div class="kpi-card ${parseFloat(s.marge_brute) < 0 ? "tone-danger" : "tone-success"}"><span class="kpi-label">Marge brute</span><span class="kpi-value">${FP.money(s.marge_brute)}</span><span class="kpi-sub">${s.taux_marge_pct !== null ? FP.pct(s.taux_marge_pct) : "—"}</span></div>
        <div class="kpi-card ${parseFloat(s.tresorerie.solde_previsionnel) < 0 ? "tone-danger" : ""}"><span class="kpi-label">Solde prévisionnel</span><span class="kpi-value">${FP.money(s.tresorerie.solde_previsionnel)}</span></div>
      </div>
      ${alerts.length ? `<div class="alert-list">${alerts.map((a) => `<div class="alert-item ${a.danger ? "danger" : ""}"><span class="alert-item-icon">${a.danger ? "⛔" : "⚠"}</span><span>${a.text}</span></div>`).join("")}</div>` : `<p class="muted" style="margin:0">Aucune alerte.</p>`}
    </div>`;
  }

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.cockpit = async function (container, ctx) {
    const societies = await FP.api("/finance-core/societies").then((r) => r.items).catch(() => []);
    const multi = societies.length > 1;
    container.innerHTML = `
      <h1 class="section-title">Cockpit DG</h1>
      <p class="section-sub">Vision ${multi ? "groupe (toutes sociétés autorisées) et société" : "société"} — période ${FP.esc(ctx.period || "—")}. Agrégats serveur uniquement, jamais une collection complète recalculée côté client.</p>
      ${multi ? `<div class="subtabs">
        <button class="subtab active" data-scope="group">Vue groupe</button>
        <button class="subtab" data-scope="society">Vue société (${FP.esc(ctx.society)})</button>
      </div>` : ""}
      <div id="cockpit-body">${FP.skeletonKpis(6)}</div>`;

    if (!ctx.period) { container.innerHTML = FP.emptyState("Sélectionnez une période."); return; }

    if (multi) {
      document.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("[data-scope]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        b.dataset.scope === "group" ? loadGroup() : loadSociety();
      }));
      loadGroup();
    } else {
      loadSociety();
    }

    async function loadSociety() {
      const el = document.querySelector("#cockpit-body");
      el.innerHTML = FP.skeletonKpis(6);
      if (!ctx.society) { el.innerHTML = FP.emptyState("Sélectionnez une société."); return; }
      try {
        const s = await FP.guardedApi("cockpit", "/cockpit/summary", { params: { society: ctx.society, period: ctx.period } });
        el.innerHTML = summaryCard(s);
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function loadGroup() {
      const el = document.querySelector("#cockpit-body");
      el.innerHTML = FP.skeletonKpis(6);
      try {
        const results = await Promise.all(societies.map((s) =>
          FP.api("/cockpit/summary", { params: { society: s, period: ctx.period } }).catch(() => null)));
        const cards = results.filter(Boolean);
        if (!cards.length) { el.innerHTML = FP.emptyState("Aucune donnée pour cette période."); return; }
        el.innerHTML = cards.map(summaryCard).join("");
      } catch (err) { el.innerHTML = FP.errorState(err); }
    }
  };
})();
