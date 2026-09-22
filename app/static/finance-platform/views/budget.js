// Budget (§8) : workflow draft → submitted → approved → locked, réalisé/engagé/écart
// calculés serveur (budget.service.line_summary — écritures VALIDÉES réelles, jamais une
// saisie parallèle). Révision = nouvelle ligne (revises_id), jamais un écrasement de
// l'historique — reflété ici en rechargeant la liste après révision plutôt qu'en mutant la
// ligne existante côté client.
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.budget = async function (container, ctx) {
    container.innerHTML = `
      <h1 class="section-title">Budget</h1>
      <p class="section-sub">${FP.esc(ctx.society || "—")} — période ${FP.esc(ctx.period || "—")}</p>
      ${ctx.canWrite ? `<div class="card"><div class="card-head"><h2>Nouvelle ligne budgétaire</h2></div>
        <form id="bl-form" class="form-row">
          <div class="field"><label>Compte</label><input name="compte" placeholder="ex: 607"></div>
          <div class="field"><label>Centre de coût</label><input name="centre_cout"></div>
          <div class="field"><label>Montant budgété</label><input name="montant_budgete" type="number" step="0.01" required></div>
          <button class="btn btn-primary" type="submit">Créer</button>
        </form><div id="bl-msg" class="msg"></div></div>` : FP.noAccessNotice("création de ligne budgétaire")}
      <div class="card"><div class="card-head"><h2>Lignes</h2></div><div id="bl-list">${FP.skeletonRows(4)}</div></div>`;
    if (!ctx.society) { container.innerHTML = FP.emptyState("Sélectionnez une société."); return; }

    if (ctx.canWrite) document.querySelector("#bl-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#bl-msg");
      try {
        await FP.api("/budget/lines", { method: "POST", body: {
          society: ctx.society, period: ctx.period, compte: fd.get("compte") || null,
          centre_cout: fd.get("centre_cout") || null, montant_budgete: fd.get("montant_budgete"),
        } });
        msg.textContent = "Ligne créée."; msg.className = "msg ok";
        e.target.reset();
        loadLines();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
    });
    loadLines();

    async function loadLines() {
      const el = document.querySelector("#bl-list");
      try {
        const lines = await FP.guardedApi("budget-lines", "/budget/lines", { params: { society: ctx.society, period: ctx.period } });
        if (!lines.length) { el.innerHTML = FP.emptyState("Aucune ligne budgétaire pour cette période."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Compte</th><th>Centre de coût</th><th class="num">Budget</th><th class="num">Réalisé</th><th class="num">Engagé</th><th class="num">Écart</th><th>% conso.</th><th>Statut</th><th></th>
        </tr></thead><tbody>
          ${lines.map((l) => {
            const budget = parseFloat(l.budget) || 0;
            const realise = parseFloat(l.realise) || 0;
            const pctConso = budget > 0 ? (realise / budget) * 100 : 0;
            const over = pctConso > 100;
            return `<tr>
              <td>${FP.esc(l.compte || "—")}</td><td>${FP.esc(l.centre_cout || "—")}</td>
              <td class="num">${FP.money(l.budget)}</td><td class="num">${FP.money(l.realise)}</td><td class="num">${FP.money(l.engage)}</td>
              <td class="num">${FP.money(l.ecart)}</td>
              <td><div class="progress-track" style="width:70px;display:inline-block;vertical-align:middle"><div class="progress-fill ${over ? "over" : ""}" style="width:${Math.min(pctConso, 100)}%"></div></div> ${FP.pct(pctConso)}</td>
              <td>${FP.statusBadge(l.status, FP.BUDGET_STATUS)}</td>
              <td class="actions">${ctx.canWrite ? actionsFor(l) : ""}</td>
            </tr>`;
          }).join("")}
        </tbody></table></div>`;
        wireActions(lines);
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    function actionsFor(l) {
      if (l.status === "draft") return `<button class="btn btn-sm" data-submit="${l.id}">Soumettre</button>`;
      if (l.status === "submitted") return `<button class="btn btn-sm btn-primary" data-approve="${l.id}">Approuver</button> <button class="btn btn-sm btn-danger" data-reject="${l.id}">Rejeter</button>`;
      if (l.status === "approved") return `<button class="btn btn-sm" data-lock="${l.id}">Verrouiller</button>`;
      if (l.status === "locked") return `<button class="btn btn-sm" data-revise="${l.id}">Réviser</button>`;
      return "";
    }

    function wireActions(lines) {
      document.querySelectorAll("[data-submit]").forEach((b) => b.addEventListener("click", () => act(`/budget/lines/${b.dataset.submit}/submit`, "Soumettre cette ligne budgétaire ?", lines, b.dataset.submit)));
      document.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => act(`/budget/lines/${b.dataset.approve}/approve`, "Approuver cette ligne budgétaire ?", lines, b.dataset.approve)));
      document.querySelectorAll("[data-lock]").forEach((b) => b.addEventListener("click", () => act(`/budget/lines/${b.dataset.lock}/lock`, "Verrouiller cette ligne budgétaire ?", lines, b.dataset.lock)));
      document.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => act(`/budget/lines/${b.dataset.reject}/reject`, "Rejeter cette ligne budgétaire ?", lines, b.dataset.reject, true)));
      document.querySelectorAll("[data-revise]").forEach((b) => b.addEventListener("click", async () => {
        const line = lines.find((l) => String(l.id) === b.dataset.revise);
        const amount = prompt(`Nouveau montant budgété (actuel : ${line.budget}) :`, line.budget);
        if (!amount) return;
        const impact = [["Ligne", "#" + line.id], ["Ancien montant", FP.money(line.budget)], ["Nouveau montant", FP.money(amount)]];
        const ok = await FP.confirmAction({ title: "Créer une révision (nouvelle version) ?", impact, confirmLabel: "Réviser" });
        if (!ok) return;
        try { await FP.api(`/budget/lines/${line.id}/revise`, { method: "POST", body: { montant_budgete: amount } }); loadLines(); }
        catch (err) { alert(err.message); }
      }));
    }

    async function act(path, title, lines, id, danger) {
      const line = lines.find((l) => String(l.id) === String(id));
      const impact = [["Ligne", "#" + line.id], ["Compte", line.compte || "—"], ["Montant", FP.money(line.budget)], ["Société", ctx.society]];
      const ok = await FP.confirmAction({ title, impact, confirmLabel: "Confirmer", danger });
      if (!ok) return;
      try { await FP.api(path, { method: "POST" }); loadLines(); }
      catch (err) { alert(err.message); }
    }
  };
})();
