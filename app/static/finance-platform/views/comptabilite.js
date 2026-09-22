// Comptabilité (§12) : vue de TRAÇABILITÉ des AccountingEvent (pont comptable) — jamais un
// second moteur comptable. Débit = Crédit toujours vérifié à l'affichage de l'écriture
// (jamais recalculé, juste affiché tel que posé par accounting_bridge/ecriture_settlement).
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.comptabilite = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Comptabilité</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")} — événements financiers et écritures générées par le pont comptable.</p>
      <div class="filters-row">
        <div class="field"><label>Statut</label><select id="ae-status">
          <option value="">Tous</option><option value="pending">En attente</option><option value="posted">Comptabilisée</option>
          <option value="skipped">Déjà postée ailleurs</option><option value="failed">Échec</option>
        </select></div>
      </div>
      <div class="card"><div class="card-head"><h2>Événements financiers</h2></div><div id="ae-list">${FP.skeletonRows(6)}</div></div>`;
    if (!ctx.society) { container.innerHTML = FP.emptyState("Sélectionnez une société."); return; }

    document.querySelector("#ae-status").addEventListener("change", load);
    load();

    async function load() {
      const el = document.querySelector("#ae-list");
      const status = document.querySelector("#ae-status").value;
      try {
        const events = await FP.guardedApi("comptabilite", "/finance-core/accounting-events", { params: { society: ctx.society, status_filter: status || undefined, limit: 100 } });
        if (!events.length) { el.innerHTML = FP.emptyState("Aucun événement comptable."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Source</th><th>Référence</th><th>Statut</th><th>Écriture</th><th></th>
        </tr></thead><tbody>
          ${events.map((e) => `<tr>
            <td>${FP.esc(e.source_type)}</td><td class="mono">${FP.esc(e.source_id)}</td>
            <td>${FP.statusBadge(e.status, FP.ACCOUNTING_STATUS)}${e.last_error ? ` <span class="muted" style="font-size:10.5px">${FP.esc(e.last_error).slice(0, 60)}</span>` : ""}</td>
            <td class="mono">${e.ecriture_id ? "#" + e.ecriture_id : "—"}</td>
            <td class="actions">${e.ecriture_id ? `<button class="btn btn-sm" data-open-ecriture="${e.ecriture_id}">Voir l'écriture</button>` : ""}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-open-ecriture]").forEach((b) => b.addEventListener("click", () => openEcriture(b.dataset.openEcriture)));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function openEcriture(id) {
      FP.openDrawer(`Écriture #${id}`, FP.skeletonRows(4));
      try {
        const ec = await FP.api(`/accounting/ecritures/${id}`);
        const balanced = parseFloat(ec.total_debit) === parseFloat(ec.total_credit);
        const body = `
          <div class="kv-list" style="margin-bottom:14px">
            ${FP.kvRow("Date", FP.dateFr(ec.date_ecriture || ec.date))}
            ${FP.kvRow("Total débit", FP.money(ec.total_debit))}
            ${FP.kvRow("Total crédit", FP.money(ec.total_credit))}
            ${FP.kvRow("Équilibrée", balanced ? '<span class="badge success">Débit = Crédit</span>' : '<span class="badge danger">Déséquilibrée</span>')}
          </div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Compte</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th></tr></thead><tbody>
            ${(ec.lignes || []).map((l) => `<tr><td class="mono">${FP.esc(l.compte_numero)}</td><td>${FP.esc(l.libelle || "—")}</td><td class="num">${FP.money(l.debit)}</td><td class="num">${FP.money(l.credit)}</td></tr>`).join("")}
          </tbody></table></div>`;
        FP.openDrawer(`Écriture #${id}`, body);
      } catch (err) { FP.openDrawer(`Écriture #${id}`, FP.errorState(err)); }
    }
  };
})();
