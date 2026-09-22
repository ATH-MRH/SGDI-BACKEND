// Clients/Créances (direction=receivable) et Fournisseurs/Dettes (direction=payable) —
// même modèle FinancialObligation, deux vues distinctes dans la navigation (§6 de la
// mission : "Séparer clairement créances clients / dettes fournisseurs / salaires / CNAS /
// IRG / fiscalité / autres obligations"). Les salaires/CNAS/IRG/fiscalité restent visibles
// ici via leur source_type (payroll_slip/payroll_cnas/payroll_irg/fiscal_obligation) — pas
// dupliqués, juste filtrables.
(function () {
  "use strict";
  const FP = window.FP;

  const SOURCE_LABELS = {
    invoice: "Facture client", manual: "Manuel", facture_fournisseur: "Facture fournisseur",
    payroll_slip: "Salaire net", payroll_cnas: "CNAS", payroll_irg: "IRG", fiscal_obligation: "Fiscalité",
  };

  function makeView(direction, title) {
    return async function renderObligationsView(container, ctx) {
      const state = { page: 1, status: "", source_type: "", q: "" };
      draw();

      function draw() {
        container.innerHTML = `
          <h1 class="section-title">${FP.esc(title)}</h1>
          <p class="section-sub">${direction === "receivable" ? "Montants dus par des tiers (clients, salariés, organismes) à la société." : "Montants dus par la société à des tiers (fournisseurs, salariés, organismes)."}</p>
          <div class="card"><div class="card-head"><h2>Nouvelle obligation (manuelle)</h2></div>
            ${ctx.canWrite ? `<form id="obl-form" class="form-row">
              <div class="field"><label>Contrepartie</label><input name="counterparty_name"></div>
              <div class="field"><label>Montant</label><input name="amount_total" type="number" step="0.01" required></div>
              <div class="field"><label>Référence source</label><input name="source_id" required placeholder="ex: FAC-001"></div>
              <button class="btn btn-primary" type="submit">Créer</button>
            </form><div id="obl-msg" class="msg"></div>` : FP.noAccessNotice("création d'obligation")}
          </div>
          <div class="card">
            <div class="card-head"><h2>Liste</h2></div>
            <div class="filters-row">
              <div class="field"><label>Statut</label><select id="f-status">
                <option value="">Tous</option><option value="open">Ouverte</option><option value="partially_settled">Partielle</option>
                <option value="settled">Réglée</option><option value="cancelled">Annulée</option>
              </select></div>
              <div class="field"><label>Type</label><select id="f-source">
                <option value="">Tous</option>
                ${Object.entries(SOURCE_LABELS).map(([k, v]) => `<option value="${k}">${FP.esc(v)}</option>`).join("")}
              </select></div>
              <div class="field search-input"><label>Recherche (contrepartie/référence)</label><input id="f-q" placeholder="Rechercher…"></div>
            </div>
            <div id="obl-list">${FP.skeletonRows(6)}</div>
            <div id="obl-pagination"></div>
          </div>`;

        if (ctx.canWrite) {
          document.querySelector("#obl-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const msg = document.querySelector("#obl-msg");
            const impact = [
              ["Société", ctx.society], ["Sens", direction === "receivable" ? "Créance" : "Dette"],
              ["Montant", FP.money(fd.get("amount_total"))], ["Contrepartie", fd.get("counterparty_name") || "—"],
              ["Référence", fd.get("source_id")],
            ];
            const ok = await FP.confirmAction({ title: "Créer cette obligation ?", impact, confirmLabel: "Créer" });
            if (!ok) return;
            msg.textContent = ""; msg.className = "msg";
            try {
              await FP.api("/finance-core/obligations", { method: "POST", body: {
                society: ctx.society, direction, source_type: "manual", source_id: fd.get("source_id"),
                amount_total: fd.get("amount_total"), counterparty_name: fd.get("counterparty_name") || null,
                idempotency_key: "ui:" + fd.get("source_id") + ":" + Date.now(),
              } });
              msg.textContent = "Obligation créée."; msg.className = "msg ok";
              e.target.reset();
              loadList();
            } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
          });
        }
        document.querySelector("#f-status").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; loadList(); });
        document.querySelector("#f-source").addEventListener("change", (e) => { state.source_type = e.target.value; state.page = 1; loadList(); });
        let searchTimer;
        document.querySelector("#f-q").addEventListener("input", (e) => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => { state.q = e.target.value; state.page = 1; loadList(); }, 300);
        });
        loadList();
      }

      async function loadList() {
        const el = document.querySelector("#obl-list");
        const pager = document.querySelector("#obl-pagination");
        el.innerHTML = FP.skeletonRows(6);
        try {
          const data = await FP.guardedApi("obligations", "/finance-core/obligations", {
            params: { society: ctx.society, direction, status_filter: state.status || undefined, page: state.page, page_size: 20 },
          });
          let items = data.items;
          if (state.source_type) items = items.filter((o) => o.source_type === state.source_type);
          if (state.q) {
            const q = state.q.toLowerCase();
            items = items.filter((o) => (o.counterparty_name || "").toLowerCase().includes(q) || (o.source_id || "").toLowerCase().includes(q));
          }
          if (!items.length) { el.innerHTML = FP.emptyState("Aucune obligation."); pager.innerHTML = ""; return; }
          el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
            <th>Contrepartie</th><th>Type</th><th>Référence</th><th>Échéance</th><th class="num">Total</th><th class="num">Réglé</th><th class="num">Reste</th><th>Statut</th><th></th>
          </tr></thead><tbody>
            ${items.map((o) => {
              const reste = (parseFloat(o.amount_total) - parseFloat(o.amount_settled)).toFixed(2);
              const days = FP.daysUntil(o.due_date);
              const lateBadge = o.status !== "settled" && o.status !== "cancelled" && days !== null && days < 0
                ? `<span class="badge danger" style="margin-left:6px">retard ${Math.abs(days)}j</span>` : "";
              return `<tr data-open="${o.id}">
                <td>${FP.esc(o.counterparty_name || "—")}</td>
                <td>${FP.esc(SOURCE_LABELS[o.source_type] || o.source_type)}</td>
                <td class="mono">${FP.esc(o.source_id)}</td>
                <td>${FP.dateFr(o.due_date)}${lateBadge}</td>
                <td class="num">${FP.money(o.amount_total, o.currency)}</td>
                <td class="num">${FP.money(o.amount_settled)}</td>
                <td class="num">${FP.money(reste)}</td>
                <td>${FP.statusBadge(o.status, FP.OBLIGATION_STATUS)}</td>
                <td class="actions"><button class="btn btn-sm" data-detail="${o.id}">Détail</button></td>
              </tr>`;
            }).join("")}
          </tbody></table></div>`;
          pager.innerHTML = "";
          pager.appendChild(FP.paginationBar(data, (p) => { state.page = p; loadList(); }));
          el.querySelectorAll("[data-detail]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.detail, items)));
        } catch (err) {
          if (err.name === "AbortError") return;
          el.innerHTML = FP.errorState(err, "Réessayer");
          el.querySelector("[data-retry]")?.addEventListener("click", loadList);
          pager.innerHTML = "";
        }
      }

      function openDetail(id, items) {
        const o = items.find((x) => String(x.id) === String(id));
        if (!o) return;
        const reste = (parseFloat(o.amount_total) - parseFloat(o.amount_settled)).toFixed(2);
        const body = `<div class="kv-list">
          ${FP.kvRow("Société", FP.esc(o.society))}
          ${FP.kvRow("Sens", direction === "receivable" ? "Créance" : "Dette")}
          ${FP.kvRow("Contrepartie", FP.esc(o.counterparty_name || "—"))}
          ${FP.kvRow("Source", `${FP.esc(SOURCE_LABELS[o.source_type] || o.source_type)} · ${FP.esc(o.source_id)}`)}
          ${FP.kvRow("Montant total", FP.money(o.amount_total, o.currency))}
          ${FP.kvRow("Réglé", FP.money(o.amount_settled))}
          ${FP.kvRow("Reste à régler", FP.money(reste))}
          ${FP.kvRow("Échéance", FP.dateFr(o.due_date))}
          ${FP.kvRow("Statut", FP.statusBadge(o.status, FP.OBLIGATION_STATUS))}
          ${FP.kvRow("Créée le", FP.dateFr(o.created_at))}
        </div>
        ${ctx.canWrite && o.status !== "settled" && o.status !== "cancelled" ? `
          <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
          <div class="field" style="margin-bottom:8px"><label>Régler (montant)</label><input id="settle-amount" type="number" step="0.01" max="${reste}" value="${reste}"></div>
          <button class="btn btn-primary" id="settle-btn" style="width:100%;justify-content:center">Régler cette obligation</button>
          <div id="settle-msg" class="msg"></div>` : ""}`;
        FP.openDrawer(`Obligation #${o.id}`, body);
        document.querySelector("#settle-btn")?.addEventListener("click", async () => {
          const amount = document.querySelector("#settle-amount").value;
          const impact = [
            ["Obligation", "#" + o.id], ["Contrepartie", o.counterparty_name || "—"], ["Société", o.society],
            ["Montant réglé", FP.money(amount)], ["Reste avant", FP.money(reste)],
          ];
          const ok = await FP.confirmAction({ title: "Confirmer le règlement ?", impact, confirmLabel: "Régler" });
          if (!ok) return;
          const msg = document.querySelector("#settle-msg");
          try {
            await FP.api(`/finance-core/obligations/${o.id}/settle`, { method: "POST", body: { amount, idempotency_key: "ui-settle:" + o.id + ":" + Date.now() } });
            msg.textContent = "Réglé."; msg.className = "msg ok";
            FP.closeDrawer();
            loadList();
          } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
        });
      }
    };
  }

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.creances = makeView("receivable", "Clients / Créances");
  window.FinanceViews.dettes = makeView("payable", "Fournisseurs / Dettes");
})();
