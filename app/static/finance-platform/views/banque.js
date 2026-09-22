// Banque (§5) : comptes, relevés, import, transactions, rapprochement, exceptions. Sous-
// onglets internes (contexte partagé : compte sélectionné). Jamais de rapprochement
// automatique irréversible — confirm_case() reste le seul chemin (§16), toujours confirmé
// explicitement par un humain ici.
(function () {
  "use strict";
  const FP = window.FP;
  const SUBTABS = [
    ["comptes", "Comptes"], ["releves", "Relevés"], ["import", "Import"],
    ["transactions", "Transactions"], ["rapprochement", "Rapprochement"], ["exceptions", "Exceptions"],
  ];

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.banque = async function (container, ctx) {
    let active = "comptes";
    let accounts = [];

    draw();
    async function draw() {
      container.innerHTML = `
        <h1 class="section-title">Banque</h1>
        <p class="section-sub">${FP.esc(ctx.society || "—")}</p>
        <div class="subtabs">${SUBTABS.map(([k, l]) => `<button class="subtab ${k === active ? "active" : ""}" data-sub="${k}">${l}</button>`).join("")}</div>
        <div id="banque-body"></div>`;
      document.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { active = b.dataset.sub; draw(); }));
      try { accounts = await FP.guardedApi("banque-accounts", "/banking/accounts", { params: { society: ctx.society } }); }
      catch (err) { if (err.name !== "AbortError") { document.querySelector("#banque-body").innerHTML = FP.errorState(err); return; } }
      renderSub();
    }

    function renderSub() {
      const body = document.querySelector("#banque-body");
      if (active === "comptes") return renderComptes(body);
      if (active === "releves") return renderReleves(body);
      if (active === "import") return renderImport(body);
      if (active === "transactions") return renderTransactions(body);
      if (active === "rapprochement") return renderRapprochement(body);
      if (active === "exceptions") return renderExceptions(body);
    }

    function renderComptes(body) {
      body.innerHTML = `
        ${ctx.canWrite ? `<div class="card"><div class="card-head"><h2>Nouveau compte bancaire</h2></div>
          <form id="acc-form" class="form-row">
            <div class="field"><label>Banque</label><input name="bank_name" required></div>
            <div class="field"><label>N° de compte</label><input name="account_number" required></div>
            <div class="field"><label>IBAN</label><input name="iban"></div>
            <button class="btn btn-primary" type="submit">Créer</button>
          </form><div id="acc-msg" class="msg"></div></div>` : FP.noAccessNotice("création de compte bancaire")}
        <div class="card"><div class="card-head"><h2>Comptes</h2></div>
          ${!accounts.length ? FP.emptyState("Aucun compte.") : `<div class="table-wrap"><table class="data"><thead><tr><th>ID</th><th>Banque</th><th>N° compte</th><th>IBAN</th></tr></thead><tbody>
            ${accounts.map((a) => `<tr><td>${a.id}</td><td>${FP.esc(a.bank_name)}</td><td class="mono">${FP.esc(a.account_number)}</td><td class="mono">${FP.esc(a.iban || "—")}</td></tr>`).join("")}
          </tbody></table></div>`}
        </div>`;
      if (ctx.canWrite) document.querySelector("#acc-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const msg = document.querySelector("#acc-msg");
        try {
          await FP.api("/banking/accounts", { method: "POST", body: { society: ctx.society, bank_name: fd.get("bank_name"), account_number: fd.get("account_number"), iban: fd.get("iban") || null } });
          msg.textContent = "Compte créé."; msg.className = "msg ok";
          draw();
        } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
      });
    }

    async function renderReleves(body) {
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Relevés importés</h2></div><div id="stmt-list">${FP.skeletonRows(4)}</div></div>`;
      const el = document.querySelector("#stmt-list");
      try {
        const data = await FP.guardedApi("banque-statements", "/banking/statements", { params: { society: ctx.society, page_size: 30 } });
        if (!data.items.length) { el.innerHTML = FP.emptyState("Aucun relevé importé."); return; }
        const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Compte</th><th>Format</th><th>Fichier</th><th class="num">Transactions</th><th class="num">Doublons</th><th>Contrôle solde</th><th>Statut</th>
        </tr></thead><tbody>
          ${data.items.map((s) => `<tr>
            <td>${FP.esc(accById[s.bank_account_id]?.account_number || "#" + s.bank_account_id)}</td>
            <td>${FP.esc((s.import_format || "").toUpperCase())}</td>
            <td>${FP.esc(s.file_name || "—")}</td>
            <td class="num">${s.transaction_count}</td>
            <td class="num">${s.duplicate_count}</td>
            <td>${FP.statusBadge(s.computed_balance_check, { ok: { tone: "success", label: "OK" }, mismatch: { tone: "danger", label: "écart" }, "n/a": { tone: "neutral", label: "n/a" } })}</td>
            <td>${s.closed ? '<span class="badge neutral">clôturé</span>' : '<span class="badge info">ouvert</span>'}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    function renderImport(body) {
      body.innerHTML = ctx.canWrite ? `
        <div class="card"><div class="card-head"><h2>Importer un relevé</h2></div>
          <p class="section-sub">Format supporté aujourd'hui : <b>CSV</b>. Les autres formats (XLSX, CAMT.053, MT940, OCR PDF) ne sont jamais simulés — l'import est refusé explicitement plutôt que de faire semblant de réussir.</p>
          <form id="import-form" class="form-row">
            <div class="field"><label>Compte bancaire</label><select name="bank_account_id" required>
              <option value="">Choisir…</option>${accounts.map((a) => `<option value="${a.id}">${FP.esc(a.bank_name)} · ${FP.esc(a.account_number)}</option>`).join("")}
            </select></div>
            <div class="field"><label>Fichier CSV</label><input name="file" type="file" accept=".csv" required></div>
            <div class="field"><label>Solde ouverture</label><input name="opening_balance" type="number" step="0.01"></div>
            <div class="field"><label>Solde clôture</label><input name="closing_balance" type="number" step="0.01"></div>
            <button class="btn btn-primary" type="submit">Importer</button>
          </form><div id="import-msg" class="msg"></div></div>` : FP.noAccessNotice("import de relevé");
      document.querySelector("#import-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const msg = document.querySelector("#import-msg");
        const file = fd.get("file");
        if (!file || !file.size) { msg.textContent = "Choisissez un fichier CSV."; msg.className = "msg error"; return; }
        const body2 = new FormData();
        body2.append("society", ctx.society);
        body2.append("bank_account_id", fd.get("bank_account_id"));
        body2.append("import_format", "csv");
        body2.append("idempotency_key", "ui-import-" + Date.now());
        if (fd.get("opening_balance")) body2.append("opening_balance", fd.get("opening_balance"));
        if (fd.get("closing_balance")) body2.append("closing_balance", fd.get("closing_balance"));
        body2.append("file", file);
        try {
          const statement = await FP.api("/banking/statements/import", { method: "POST", formData: body2 });
          msg.textContent = `Import OK : ${statement.transaction_count} transaction(s), ${statement.duplicate_count} doublon(s), contrôle solde : ${statement.computed_balance_check}.`;
          msg.className = "msg ok";
        } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
      });
    }

    async function renderTransactions(body) {
      const presetAccount = sessionStorage.getItem("fp_banking_account_filter") || "";
      sessionStorage.removeItem("fp_banking_account_filter");
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Transactions</h2></div>
        <div class="filters-row">
          <div class="field"><label>Compte</label><select id="tx-acc"><option value="">Tous</option>${accounts.map((a) => `<option value="${a.id}" ${String(a.id) === presetAccount ? "selected" : ""}>${FP.esc(a.account_number)}</option>`).join("")}</select></div>
          <div class="field"><label>Statut</label><select id="tx-status"><option value="">Tous</option><option value="unmatched">Non rapproché</option><option value="matched">Rapproché</option></select></div>
        </div>
        <div id="tx-list">${FP.skeletonRows(5)}</div><div id="tx-pagination"></div></div>`;
      let page = 1;
      async function load() {
        const el = document.querySelector("#tx-list");
        const acc = document.querySelector("#tx-acc").value;
        const status = document.querySelector("#tx-status").value;
        try {
          const data = await FP.guardedApi("banque-tx", "/banking/transactions", { params: { society: ctx.society, bank_account_id: acc || undefined, reconcile_status: status || undefined, page, page_size: 20 } });
          if (!data.items.length) { el.innerHTML = FP.emptyState("Aucune transaction."); document.querySelector("#tx-pagination").innerHTML = ""; return; }
          el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Libellé</th><th>Référence</th><th class="num">Montant</th><th>Statut</th><th></th></tr></thead><tbody>
            ${data.items.map((t) => `<tr><td>${FP.dateFr(t.value_date)}</td><td>${FP.esc(t.label)}</td><td class="mono">${FP.esc(t.reference || "—")}</td>
              <td class="num">${FP.money(t.amount)}</td><td>${FP.statusBadge(t.reconcile_status, FP.RECONCILE_STATUS)}</td>
              <td class="actions">${t.reconcile_status === "unmatched" && ctx.canWrite ? `<button class="btn btn-sm" data-propose="${t.id}">Proposer</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>`;
          document.querySelector("#tx-pagination").innerHTML = "";
          document.querySelector("#tx-pagination").appendChild(FP.paginationBar(data, (p) => { page = p; load(); }));
          el.querySelectorAll("[data-propose]").forEach((btn) => btn.addEventListener("click", async () => {
            btn.disabled = true; btn.textContent = "…";
            try {
              const c = await FP.api(`/reconciliation/transactions/${btn.dataset.propose}/propose`, { method: "POST" });
              if (c) { alert(`Proposition créée (cas #${c.id}, confiance ${c.confidence_score}%) — voir l'onglet Rapprochement.`); active = "rapprochement"; draw(); }
              else { alert("Aucune proposition suffisamment fiable — transaction envoyée en exception."); load(); }
            } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = "Proposer"; }
          }));
        } catch (err) { if (err.name !== "AbortError") document.querySelector("#tx-list").innerHTML = FP.errorState(err); }
      }
      document.querySelector("#tx-acc").addEventListener("change", () => { page = 1; load(); });
      document.querySelector("#tx-status").addEventListener("change", () => { page = 1; load(); });
      load();
    }

    async function renderRapprochement(body) {
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Cas de rapprochement proposés</h2></div><div id="case-list">${FP.skeletonRows(4)}</div></div>`;
      const el = document.querySelector("#case-list");
      try {
        const cases = await FP.guardedApi("banque-cases", "/reconciliation/cases", { params: { society: ctx.society, status_filter: "proposed" } });
        if (!cases.length) { el.innerHTML = FP.emptyState("Aucun cas en attente."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Type</th><th>Score</th><th class="num">Montant</th><th>Explication</th><th></th></tr></thead><tbody>
          ${cases.map((c) => `<tr><td>${c.id}</td><td>${FP.esc(c.kind)}</td><td>${c.confidence_score}%</td><td class="num">${FP.money(c.total_amount)}</td>
            <td style="font-size:11px;color:var(--text-faint)">${FP.esc(c.explanation || "—")}</td>
            <td class="actions">${ctx.canWrite ? `<button class="btn btn-sm btn-primary" data-confirm="${c.id}">Confirmer</button> <button class="btn btn-sm btn-danger" data-reject="${c.id}">Rejeter</button>` : '<span class="muted">lecture seule</span>'}</td></tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-confirm]").forEach((btn) => btn.addEventListener("click", async () => {
          const row = cases.find((c) => String(c.id) === btn.dataset.confirm);
          const impact = [["Cas", "#" + row.id], ["Type", row.kind], ["Montant", FP.money(row.total_amount)], ["Confiance", row.confidence_score + "%"]];
          const ok = await FP.confirmAction({ title: "Confirmer ce rapprochement ?", impact, confirmLabel: "Confirmer" });
          if (!ok) return;
          try { await FP.api(`/reconciliation/cases/${btn.dataset.confirm}/confirm`, { method: "POST" }); renderRapprochement(body); }
          catch (err) { alert(err.message); }
        }));
        el.querySelectorAll("[data-reject]").forEach((btn) => btn.addEventListener("click", async () => {
          const reason = prompt("Motif du rejet ?") || "rejeté depuis l'interface";
          try { await FP.api(`/reconciliation/cases/${btn.dataset.reject}/reject`, { method: "POST", body: { reason } }); renderRapprochement(body); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function renderExceptions(body) {
      body.innerHTML = `<div class="card"><div class="card-head"><h2>File d'exceptions (non rapprochées)</h2></div><div id="exc-list">${FP.skeletonRows(3)}</div></div>`;
      const el = document.querySelector("#exc-list");
      try {
        const items = await FP.guardedApi("banque-exc", "/reconciliation/exceptions", { params: { society: ctx.society, resolved: false } });
        if (!items.length) { el.innerHTML = FP.emptyState("Aucune exception ouverte."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Transaction</th><th>Motif</th></tr></thead><tbody>
          ${items.map((e) => `<tr><td>#${e.bank_transaction_id}</td><td>${FP.esc(e.reason)}</td></tr>`).join("")}
        </tbody></table></div>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }
  };
})();
