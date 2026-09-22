// Réglementation (§11) : vue administrateur du référentiel versionné (source/règle/version/
// proposition). AUCUNE activation automatique depuis Internet — RegulatoryChangeProposal
// reste le SEUL chemin de création d'une version, toujours approuvée/rejetée ici par un
// humain, jamais déclenchée par cette interface elle-même.
(function () {
  "use strict";
  const FP = window.FP;

  window.FinanceViews = window.FinanceViews || {};
  window.FinanceViews.reglementation = async function (container, ctx) {
    let subtab = "proposals";
    draw();

    function draw() {
      container.innerHTML = `
        <h1 class="section-title">Réglementation</h1>
        <p class="section-sub">Référentiel versionné — une règle "non vérifiée" ne peut jamais produire d'obligation financière réelle (garde backend, non modifiée ici).</p>
        <div class="subtabs">
          <button class="subtab ${subtab === "proposals" ? "active" : ""}" data-sub="proposals">Propositions</button>
          <button class="subtab ${subtab === "rules" ? "active" : ""}" data-sub="rules">Règles &amp; sources</button>
        </div>
        <div id="reg-body"></div>`;
      document.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { subtab = b.dataset.sub; draw(); }));
      if (subtab === "proposals") renderProposals(); else renderRules();
    }

    async function renderProposals() {
      const body = document.querySelector("#reg-body");
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Propositions de changement</h2></div><div id="prop-list">${FP.skeletonRows(4)}</div></div>`;
      const el = document.querySelector("#prop-list");
      try {
        const items = await FP.guardedApi("reg-proposals", "/regulatory/proposals", {});
        if (!items.length) { el.innerHTML = FP.emptyState("Aucune proposition."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Règle</th><th>Effet à partir de</th><th>Statut</th><th></th></tr></thead><tbody>
          ${items.map((p) => `<tr><td>${p.id}</td><td>${p.rule_id ?? "—"}</td><td>${FP.dateFr(p.proposed_effective_from)}</td>
            <td><span class="badge ${p.status === "approved" ? "success" : p.status === "rejected" ? "danger" : "neutral"}">${FP.esc(p.status)}</span></td>
            <td class="actions">${ctx.isAdmin && p.status === "proposed" ? `<button class="btn btn-sm btn-primary" data-approve-unverified="${p.id}">Approuver (non vérifié)</button> <button class="btn btn-sm" data-approve-verified="${p.id}" ${p.source_id ? "" : "disabled title=\"source requise\""}>Approuver vérifié</button> <button class="btn btn-sm btn-danger" data-reject="${p.id}">Rejeter</button>` : ""}</td>
          </tr>`).join("")}
        </tbody></table></div>
        ${!ctx.isAdmin ? '<p class="muted" style="margin-top:10px">Approbation/rejet réservés à l\'administration.</p>' : ""}`;
        el.querySelectorAll("[data-approve-unverified]").forEach((b) => b.addEventListener("click", () => approve(b.dataset.approveUnverified, false)));
        el.querySelectorAll("[data-approve-verified]").forEach((b) => b.addEventListener("click", () => approve(b.dataset.approveVerified, true)));
        el.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", async () => {
          try { await FP.api(`/regulatory/proposals/${b.dataset.reject}/reject`, { method: "POST" }); renderProposals(); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = FP.errorState(err); }
    }

    async function approve(id, markVerified) {
      const impact = [["Proposition", "#" + id], ["Marquer vérifiée", markVerified ? "Oui — nécessite une source" : "Non — reste une simulation"]];
      const ok = await FP.confirmAction({ title: "Approuver cette proposition ?", impact, confirmLabel: "Approuver" });
      if (!ok) return;
      try { await FP.api(`/regulatory/proposals/${id}/approve`, { method: "POST", body: { mark_verified: markVerified } }); renderProposals(); }
      catch (err) { alert(err.message); }
    }

    async function renderRules() {
      const body = document.querySelector("#reg-body");
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Sources</h2></div><div id="src-list">${FP.skeletonRows(2)}</div></div>
        <div class="card"><div class="card-head"><h2>Règles</h2></div><div id="rule-list">${FP.skeletonRows(3)}</div></div>`;
      try {
        const sources = await FP.api("/regulatory/sources");
        document.querySelector("#src-list").innerHTML = sources.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Nom</th><th>Référence</th><th>Fiabilité</th></tr></thead><tbody>
          ${sources.map((s) => `<tr><td>${FP.esc(s.name)}</td><td class="mono">${FP.esc(s.reference || "—")}</td><td><span class="badge ${s.reliability === "verified" ? "success" : "neutral"}">${FP.esc(s.reliability)}</span></td></tr>`).join("")}
        </tbody></table></div>` : FP.emptyState("Aucune source.");
      } catch (err) { document.querySelector("#src-list").innerHTML = FP.errorState(err); }
      try {
        const rules = await FP.api("/regulatory/rules");
        const el = document.querySelector("#rule-list");
        if (!rules.length) { el.innerHTML = FP.emptyState("Aucune règle."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Société</th><th>Libellé</th><th></th></tr></thead><tbody>
          ${rules.map((r) => `<tr><td class="mono">${FP.esc(r.rule_type)}</td><td>${FP.esc(r.society || "Nationale")}</td><td>${FP.esc(r.label)}</td>
            <td class="actions"><button class="btn btn-sm" data-versions="${r.id}">Versions</button></td></tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-versions]").forEach((b) => b.addEventListener("click", () => openVersions(b.dataset.versions, rules)));
      } catch (err) { document.querySelector("#rule-list").innerHTML = FP.errorState(err); }
    }

    async function openVersions(ruleId, rules) {
      const rule = rules.find((r) => String(r.id) === String(ruleId));
      FP.openDrawer(`Versions — ${rule.label}`, FP.skeletonRows(3));
      try {
        const versions = await FP.api(`/regulatory/rules/${ruleId}/versions`);
        const body = !versions.length ? FP.emptyState("Aucune version.") : `<div class="kv-list">
          ${versions.map((v) => `<div class="card" style="padding:10px;margin-bottom:8px">
            ${FP.kvRow("Version", "#" + v.version_number)}
            ${FP.kvRow("Statut", FP.statusBadge(v.status, FP.REGULATORY_STATUS))}
            ${FP.kvRow("Effet à partir de", FP.dateFr(v.effective_from))}
            ${FP.kvRow("Effet jusqu'à", v.effective_to ? FP.dateFr(v.effective_to) : "en cours")}
            ${FP.kvRow("Source", v.source_id ? "#" + v.source_id : '<span class="badge danger">aucune</span>')}
          </div>`).join("")}
        </div>`;
        FP.openDrawer(`Versions — ${rule.label}`, body);
      } catch (err) { FP.openDrawer(`Versions — ${rule.label}`, FP.errorState(err)); }
    }
  };
})();
