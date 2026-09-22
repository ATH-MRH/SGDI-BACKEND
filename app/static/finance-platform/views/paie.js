// Paie (§7) : cockpit des cycles de paie (PayrollRun, avec totaux agrégés serveur — voir
// GET /payroll/runs enrichi) et détail bulletin (rules_used, VERIFIED/UNVERIFIED). Aucune
// garde backend modifiée ici : un bulletin avec une règle UNVERIFIED reste marqué
// "validatable: false" par le backend (voir slip_validation_blockers) et cette vue ne
// présente JAMAIS d'action de validation réelle dans ce cas — elle se contente d'afficher
// honnêtement la raison du blocage.
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.paie = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Paie</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")}</p>
      <div class="card"><div class="card-head"><h2>Cycles de paie</h2></div><div id="run-list">${FP.skeletonRows(4)}</div></div>`;
    if (!ctx.society) { container.innerHTML = FP.emptyState("Sélectionnez une société."); return; }
    loadRuns();

    async function loadRuns() {
      const el = document.querySelector("#run-list");
      try {
        const runs = await FP.guardedApi("paie-runs", "/payroll/runs", { params: { society: ctx.society } });
        if (!runs.length) { el.innerHTML = FP.emptyState("Aucun cycle de paie."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Période</th><th>Statut</th><th class="num">Salariés</th><th class="num">Validés</th>
          <th class="num">Brut</th><th class="num">CNAS sal.</th><th class="num">CNAS pat.</th><th class="num">IRG</th><th class="num">Net à payer</th><th></th>
        </tr></thead><tbody>
          ${runs.map((r) => `<tr>
            <td>${FP.esc(r.period)}</td>
            <td><span class="badge ${r.status === "validated" ? "success" : "neutral"}">${r.status === "validated" ? "validé" : "brouillon"}</span></td>
            <td class="num">${r.slip_count}</td>
            <td class="num">${r.validated_count}/${r.slip_count}</td>
            <td class="num">${FP.money(r.brut)}</td>
            <td class="num">${FP.money(r.cotisation_salariale)}</td>
            <td class="num">${FP.money(r.cotisation_patronale)}</td>
            <td class="num">${FP.money(r.irg)}</td>
            <td class="num">${FP.money(r.net_a_payer)}</td>
            <td class="actions"><button class="btn btn-sm" data-open-run="${r.id}">Bulletins</button></td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-open-run]").forEach((b) => b.addEventListener("click", () => openRun(b.dataset.openRun, runs)));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function openRun(runId, runs) {
      const run = runs.find((r) => String(r.id) === String(runId));
      const body = `<p class="muted" style="margin-top:0">Période ${FP.esc(run.period)} — ${run.slip_count} bulletin(s)</p><div id="slip-list">${FP.skeletonRows(3)}</div>`;
      FP.openDrawer(`Cycle #${runId}`, body);
      try {
        const slips = await FP.api(`/payroll/runs/${runId}/slips`);
        const el = document.querySelector("#slip-list");
        if (!slips.length) { el.innerHTML = FP.emptyState("Aucun bulletin."); return; }
        el.innerHTML = slips.map((s) => `<div class="card" style="margin-bottom:8px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b>Employé #${s.employee_id}</b>
            <span class="badge ${s.status === "validated" ? "success" : "neutral"}">${s.status === "validated" ? "validé" : "brouillon"}</span>
          </div>
          <div class="kv-list">
            ${FP.kvRow("Brut", FP.money(s.brut))}
            ${FP.kvRow("CNAS salarial", FP.money(s.cotisation_salariale))}
            ${FP.kvRow("CNAS patronal", FP.money(s.cotisation_patronale))}
            ${FP.kvRow("Imposable", FP.money(s.imposable))}
            ${FP.kvRow("IRG", FP.money(s.irg))}
            ${FP.kvRow("Net", FP.money(s.net))}
            ${FP.kvRow("Net à payer", FP.money(s.net_a_payer))}
          </div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            ${Object.entries(s.rules_used || {}).map(([k, v]) => v.error
              ? `<span class="badge danger">${FP.esc(k)} : absente</span>`
              : `<span class="badge ${v.status === "active" ? "success" : "warn"}">${FP.esc(k)} : ${v.status === "active" ? "VERIFIED" : "UNVERIFIED"}</span>`).join("")}
          </div>
          ${s.status === "draft" ? (s.validatable
            ? (ctx.canWrite ? `<button class="btn btn-primary btn-sm" style="margin-top:10px" data-validate="${s.id}">Valider ce bulletin</button>` : "")
            : `<div class="msg error" style="margin-top:8px">Validation impossible — ${FP.esc((s.validation_blockers || []).join(" ; "))}</div>`) : ""}
        </div>`).join("");
        el.querySelectorAll("[data-validate]").forEach((b) => b.addEventListener("click", async () => {
          const impact = [["Bulletin", "#" + b.dataset.validate], ["Cycle", run.period], ["Société", ctx.society]];
          const ok = await FP.confirmAction({ title: "Valider ce bulletin de paie ?", impact, confirmLabel: "Valider", danger: false });
          if (!ok) return;
          try { await FP.api(`/payroll/slips/${b.dataset.validate}/validate`, { method: "POST" }); openRun(runId, runs); loadRuns(); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { document.querySelector("#slip-list").innerHTML = FP.errorState(err); }
    }
  };
})();
