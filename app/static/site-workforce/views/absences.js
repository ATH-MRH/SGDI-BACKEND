// Absences (§B9) : décision explicite justifiée/injustifiée — JAMAIS déduite d'un
// justificatif "conforme" (voir vue Justificatifs, statut de document strictement séparé).
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.absences = async function (container) {
    let filter = "en_attente";
    container.innerHTML = `
      <h1 class="section-title">Absences</h1>
      <p class="section-sub">Décision de justification — indépendante du statut d'un éventuel justificatif</p>
      <div class="filters-row">
        <div class="field"><label>Statut</label>
          <select id="abs-filter">
            <option value="en_attente" selected>En attente</option>
            <option value="justifiee">Justifiées</option>
            <option value="injustifiee">Injustifiées</option>
            <option value="">Toutes</option>
          </select>
        </div>
      </div>
      <div class="card"><div id="abs-list">${SW.skeletonRows(6)}</div></div>`;

    document.querySelector("#abs-filter").addEventListener("change", (e) => { filter = e.target.value; load(); });

    async function load() {
      const el = document.querySelector("#abs-list");
      try {
        const rows = await SW.guardedApi("absences", "/site-workforce/absences", { params: { decision_status: filter } });
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucune absence dans ce filtre."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Employé #</th><th>Date</th><th>Statut</th><th></th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td>#${r.employee_id}</td><td>${SW.dateFr(r.presence_date)}</td>
            <td>${SW.statusBadge(r.absence_decision_status, SW.ABSENCE_DECISION_STATUS)}</td>
            <td class="actions">${r.absence_decision_status === "en_attente" ? `
              <button class="btn btn-sm" data-decide="${r.id}" data-decision="justifiee">Justifier</button>
              <button class="btn btn-sm btn-danger" data-decide="${r.id}" data-decision="injustifiee">Injustifiée</button>` : ""}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-decide]").forEach((btn) => btn.addEventListener("click", async () => {
          const decision = btn.dataset.decision;
          const ok = await SW.confirmAction({
            title: decision === "justifiee" ? "Marquer cette absence comme justifiée ?" : "Marquer cette absence comme injustifiée ?",
            impact: [["Absence", "#" + btn.dataset.decide], ["Décision", decision]],
            confirmLabel: "Confirmer", danger: decision === "injustifiee",
          });
          if (!ok) return;
          try { await SW.api(`/site-workforce/absences/${btn.dataset.decide}/decision`, { method: "POST", body: { decision } }); load(); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
