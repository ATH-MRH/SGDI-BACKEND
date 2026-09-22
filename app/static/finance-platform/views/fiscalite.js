// Fiscalité (§10) : calendrier fiscal, provenance non ambiguë (manual/calculated_verified —
// jamais présenté comme "calculé" quand le montant est saisi manuellement, seul mode
// actuellement possible : G50/TVA/IBS n'ont AUCUN calcul automatique, exigence explicite).
(function () {
  "use strict";
  const FP = window.FP;
  const TYPE_LABELS = { g50_tva: "G50 — TVA", g50_irg_retenue: "G50 — IRG retenue", ibs: "IBS", cnas_echeance: "CNAS", autre: "Autre" };
  const PROVENANCE_LABEL = { manual: "Saisie manuelle", calculated_verified: "Calculé (règle vérifiée)" };

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.fiscalite = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Fiscalité</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")} — calendrier des obligations fiscales. Aucun montant n'est calculé automatiquement par cette plateforme.</p>
      ${ctx.canWrite ? `<div class="card"><div class="card-head"><h2>Déclarer une obligation</h2></div>
        <form id="fisc-form" class="form-row">
          <div class="field"><label>Type</label><select name="obligation_type">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${FP.esc(v)}</option>`).join("")}</select></div>
          <div class="field"><label>Période</label><input name="period" value="${FP.esc(ctx.period)}" required></div>
          <div class="field"><label>Montant (saisi)</label><input name="montant" type="number" step="0.01" required></div>
          <div class="field"><label>Échéance</label><input name="echeance" type="date" required></div>
          <div class="field"><label>Référence</label><input name="proof_reference"></div>
          <button class="btn btn-primary" type="submit">Déclarer</button>
        </form><div id="fisc-msg" class="msg"></div></div>` : FP.noAccessNotice("déclaration fiscale")}
      <div class="card"><div class="card-head"><h2>Calendrier</h2></div><div id="fisc-list">${FP.skeletonRows(4)}</div></div>`;
    if (!ctx.society) { container.innerHTML = FP.emptyState("Sélectionnez une société."); return; }

    if (ctx.canWrite) document.querySelector("#fisc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#fisc-msg");
      try {
        await FP.api("/fiscalite/declare", { method: "POST", body: {
          society: ctx.society, obligation_type: fd.get("obligation_type"), period: fd.get("period"),
          montant: fd.get("montant"), echeance: fd.get("echeance"), proof_reference: fd.get("proof_reference") || null,
          idempotency_key: "ui-fisc:" + Date.now(),
        } });
        msg.textContent = "Obligation déclarée."; msg.className = "msg ok";
        e.target.reset();
        loadCalendar();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
    });
    loadCalendar();

    async function loadCalendar() {
      const el = document.querySelector("#fisc-list");
      try {
        const items = await FP.guardedApi("fiscalite", "/fiscalite/calendar", { params: { society: ctx.society } });
        if (!items.length) { el.innerHTML = FP.emptyState("Aucune obligation fiscale."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Type</th><th>Période</th><th class="num">Montant</th><th>Provenance</th><th>Échéance</th><th>Statut</th><th></th>
        </tr></thead><tbody>
          ${items.map((o) => {
            const days = FP.daysUntil(o.echeance);
            const soon = o.status !== "paid" && days !== null && days >= 0 && days < 7;
            const late = o.status !== "paid" && days !== null && days < 0;
            return `<tr>
              <td>${FP.esc(TYPE_LABELS[o.obligation_type] || o.obligation_type)}</td>
              <td>${FP.esc(o.period)}</td>
              <td class="num">${FP.money(o.montant)}</td>
              <td><span class="badge ${o.provenance === "calculated_verified" ? "success" : "neutral"}">${FP.esc(PROVENANCE_LABEL[o.provenance] || o.provenance)}</span></td>
              <td>${FP.dateFr(o.echeance)} ${soon ? '<span class="badge warn">bientôt</span>' : ""}${late ? '<span class="badge danger">retard</span>' : ""}</td>
              <td>${FP.statusBadge(o.status, FP.FISCAL_STATUS)}</td>
              <td class="actions">${ctx.canWrite && o.status !== "paid" ? `<button class="btn btn-sm" data-mark-paid="${o.id}">Marquer payée</button>` : ""}</td>
            </tr>`;
          }).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-mark-paid]").forEach((b) => b.addEventListener("click", async () => {
          const row = items.find((o) => String(o.id) === b.dataset.markPaid);
          const impact = [["Type", TYPE_LABELS[row.obligation_type] || row.obligation_type], ["Période", row.period], ["Montant", FP.money(row.montant)], ["Société", ctx.society]];
          const ok = await FP.confirmAction({ title: "Marquer cette obligation fiscale payée ?", impact, confirmLabel: "Confirmer" });
          if (!ok) return;
          try { await FP.api(`/fiscalite/${row.id}/mark-paid`, { method: "POST" }); loadCalendar(); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }
  };
})();
