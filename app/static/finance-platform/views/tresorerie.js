// Trésorerie (§4) : position par banque/compte, encaissements/décaissements attendus,
// solde prévisionnel. Agrégats serveur uniquement (treasury.service, déjà réel — somme des
// BankTransaction importées, jamais un solde saisi/estimé) — drill-down vers Banque pour les
// transactions sources.
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.tresorerie = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Trésorerie</h1>
      <p class="section-sub">Position bancaire réelle (somme des transactions importées) et échéancier des obligations ouvertes — ${FP.esc(ctx.society || "—")}.</p>
      <div id="tr-kpis">${FP.skeletonKpis(3)}</div>
      <div class="card"><div class="card-head"><h2>Solde par compte</h2></div><div id="tr-positions">${FP.skeletonRows(3)}</div></div>
      <div class="card"><div class="card-head"><h2>Échéancier</h2></div><div id="tr-echeancier">${FP.skeletonRows(4)}</div></div>`;

    if (!ctx.society) { container.innerHTML = FP.emptyState("Sélectionnez une société."); return; }

    await Promise.all([loadForecast(), loadPositions(), loadEcheancier()]);

    async function loadForecast() {
      const el = document.querySelector("#tr-kpis");
      try {
        const f = await FP.guardedApi("tr-forecast", "/treasury/forecast", { params: { society: ctx.society } });
        el.innerHTML = `<div class="kpi-grid">
          <div class="kpi-card"><span class="kpi-label">Position bancaire actuelle</span><span class="kpi-value">${FP.money(f.position_bancaire_actuelle)}</span></div>
          <div class="kpi-card tone-info"><span class="kpi-label">Net échéancier attendu</span><span class="kpi-value">${FP.money(f.net_echeancier_attendu)}</span></div>
          <div class="kpi-card ${parseFloat(f.solde_previsionnel) < 0 ? "tone-danger" : "tone-success"}"><span class="kpi-label">Solde prévisionnel</span><span class="kpi-value">${FP.money(f.solde_previsionnel)}</span><span class="kpi-sub">position + échéancier net</span></div>
        </div>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function loadPositions() {
      const el = document.querySelector("#tr-positions");
      try {
        const positions = await FP.guardedApi("tr-positions", "/treasury/positions", { params: { society: ctx.society } });
        if (!positions.length) { el.innerHTML = FP.emptyState("Aucun compte bancaire pour cette société."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Banque</th><th>N° compte</th><th class="num">Position</th><th></th></tr></thead><tbody>
          ${positions.map((p) => `<tr><td>${FP.esc(p.bank_name)}</td><td class="mono">${FP.esc(p.account_number)}</td><td class="num">${FP.money(p.position)}</td>
            <td class="actions"><button class="btn btn-sm" data-goto-account="${p.bank_account_id}">Transactions</button></td></tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-goto-account]").forEach((b) => b.addEventListener("click", () => {
          sessionStorage.setItem("fp_banking_account_filter", b.dataset.gotoAccount);
          ctx.navigate("banque");
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function loadEcheancier() {
      const el = document.querySelector("#tr-echeancier");
      try {
        const ech = await FP.guardedApi("tr-echeancier", "/treasury/echeancier", { params: { society: ctx.society } });
        const rows = (kind, items) => items.slice(0, 8).map((e) => `<tr>
          <td>${FP.esc(e.counterparty_name || "—")}</td><td>${kind}</td><td>${FP.dateFr(e.due_date)}</td><td class="num">${FP.money(e.amount_remaining)}</td>
        </tr>`).join("");
        const total = ech.encaissements_attendus.length + ech.decaissements_attendus.length;
        if (!total) { el.innerHTML = FP.emptyState("Aucune échéance ouverte."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Contrepartie</th><th>Sens</th><th>Échéance</th><th class="num">Montant</th></tr></thead><tbody>
          ${rows("Encaissement", ech.encaissements_attendus)}${rows("Décaissement", ech.decaissements_attendus)}
        </tbody></table></div>
        <p class="muted" style="font-size:11.5px;margin-top:8px">Total attendu — encaissements ${FP.money(ech.total_encaissements)} · décaissements ${FP.money(ech.total_decaissements)}</p>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }
  };
})();
