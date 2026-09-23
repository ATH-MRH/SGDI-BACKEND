// Maladies (§B12) : gestion ADMINISTRATIVE minimale (début/fin prévue/justificatif/statut),
// aucune donnée médicale exposée au-delà de ce que le formulaire lui-même saisit.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.maladies = async function (container) {
    container.innerHTML = `
      <h1 class="section-title">Maladies</h1>
      <p class="section-sub">Suivi administratif — aucune donnée médicale au-delà de ce formulaire</p>
      <div class="card">
        <div class="card-head"><h2>Déclarer une maladie</h2></div>
        <form id="maladie-form" class="form-row">
          <div class="field"><label>Employé #</label><input name="employee_id" type="number" required></div>
          <div class="field"><label>Début</label><input name="start_date" type="date" required></div>
          <div class="field"><label>Fin prévue</label><input name="end_date" type="date" required></div>
          <div class="field"><label>Commentaire</label><input name="reason" placeholder="Type administratif, réception…"></div>
          <button class="btn btn-primary" type="submit">Déclarer</button>
        </form>
        <div id="maladie-msg" class="msg"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Déclarations</h2></div><div id="maladie-list">${SW.skeletonRows(5)}</div></div>`;

    document.querySelector("#maladie-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#maladie-msg");
      // §16 (revue finale d'intégration, double-submit) : désactivé pendant la requête.
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await SW.api("/site-workforce/leaves", { method: "POST", body: {
          employee_id: Number(fd.get("employee_id")), leave_type: "maladie",
          start_date: fd.get("start_date"), end_date: fd.get("end_date"), reason: fd.get("reason") || null,
        } });
        msg.textContent = "Déclaration enregistrée."; msg.className = "msg ok";
        e.target.reset();
        load();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
      finally { btn.disabled = false; }
    });

    async function load() {
      const el = document.querySelector("#maladie-list");
      try {
        const rows = await SW.guardedApi("maladies", "/site-workforce/leaves", { params: { leave_type: "maladie" } });
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucune déclaration."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Employé #</th><th>Début</th><th>Fin prévue</th><th>Statut</th><th>Commentaire</th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr><td>#${r.employee_id}</td><td>${SW.dateFr(r.start_date)}</td><td>${SW.dateFr(r.end_date)}</td>
            <td>${SW.statusBadge(r.status, SW.LEAVE_STATUS)}</td><td>${SW.esc(r.reason || "—")}</td></tr>`).join("")}
        </tbody></table></div>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
