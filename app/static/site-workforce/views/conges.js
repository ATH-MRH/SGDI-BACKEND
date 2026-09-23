// Congés (§B11) : le chargé PRÉPARE la demande — validation exclusivement DRH, jamais
// exposée ici (aucune route approve/refuse dans ce module). "Prochains départs" affiché.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.conges = async function (container) {
    container.innerHTML = `
      <h1 class="section-title">Congés</h1>
      <p class="section-sub">Planning et demandes — la validation reste exclusivement DRH</p>
      <div class="card">
        <div class="card-head"><h2>Nouvelle demande</h2></div>
        <form id="conge-form" class="form-row">
          <div class="field"><label>Employé #</label><input name="employee_id" type="number" required></div>
          <div class="field"><label>Début</label><input name="start_date" type="date" required></div>
          <div class="field"><label>Fin</label><input name="end_date" type="date" required></div>
          <div class="field"><label>Motif</label><input name="reason"></div>
          <button class="btn btn-primary" type="submit">Préparer la demande</button>
        </form>
        <div id="conge-msg" class="msg"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Prochains départs</h2></div><div id="conge-list">${SW.skeletonRows(5)}</div></div>`;

    document.querySelector("#conge-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#conge-msg");
      // §16 (revue finale d'intégration, double-submit) : désactivé pendant la requête —
      // un double-clic réel créait deux demandes de congé identiques.
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await SW.api("/site-workforce/leaves", { method: "POST", body: {
          employee_id: Number(fd.get("employee_id")), leave_type: "conge",
          start_date: fd.get("start_date"), end_date: fd.get("end_date"), reason: fd.get("reason") || null,
        } });
        msg.textContent = "Demande préparée — en attente de validation DRH."; msg.className = "msg ok";
        e.target.reset();
        load();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
      finally { btn.disabled = false; }
    });

    async function load() {
      const el = document.querySelector("#conge-list");
      try {
        const rows = await SW.guardedApi("conges", "/site-workforce/leaves", { params: { leave_type: "conge" } });
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucun congé."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Employé #</th><th>Début</th><th>Fin</th><th>Statut</th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr><td>#${r.employee_id}</td><td>${SW.dateFr(r.start_date)}</td><td>${SW.dateFr(r.end_date)}</td>
            <td>${SW.statusBadge(r.status, SW.LEAVE_STATUS)}</td></tr>`).join("")}
        </tbody></table></div>`;
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
