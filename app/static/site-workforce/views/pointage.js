// Pointage (§B8) : saisie du statut quotidien par employé du site, progression X/Y,
// clôture, correction post-clôture (auditée côté serveur, jamais silencieuse).
(function () {
  "use strict";
  const SW = window.SW;
  const STATUSES = ["present", "absent", "conge", "maladie", "repos", "mission"];

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.pointage = async function (container) {
    let date = todayIso();
    container.innerHTML = `
      <h1 class="section-title">Pointage</h1>
      <p class="section-sub">Statut quotidien du personnel du site</p>
      <div class="filters-row">
        <div class="field"><label>Date</label><input type="date" id="pt-date" value="${date}"></div>
        <button class="btn btn-sm btn-primary" id="pt-close">Clôturer la journée</button>
      </div>
      <div class="card">
        <div class="card-head"><h2>Progression</h2></div>
        <div id="pt-progress"></div>
      </div>
      <div class="card"><div id="pt-list">${SW.skeletonRows(6)}</div></div>`;

    document.querySelector("#pt-date").addEventListener("change", (e) => { date = e.target.value; load(); });
    document.querySelector("#pt-close").addEventListener("click", async () => {
      const ok = await SW.confirmAction({
        title: "Clôturer la journée de pointage ?",
        impact: [["Date", SW.dateFr(date)], ["Effet", "Verrouille le pointage — toute correction ultérieure sera tracée"]],
        confirmLabel: "Clôturer",
      });
      if (!ok) return;
      try {
        const r = await SW.api("/site-workforce/attendance/close", { method: "POST", params: { presence_date: date } });
        alert(`${r.closed} pointage(s) clôturé(s)${r.missing ? `, ${r.missing} employé(s) resté(s) non pointé(s)` : ""}.`);
        load();
      } catch (err) { alert(err.message); }
    });

    async function load() {
      const progEl = document.querySelector("#pt-progress");
      const listEl = document.querySelector("#pt-list");
      try {
        const data = await SW.guardedApi("pointage", "/site-workforce/attendance", { params: { presence_date: date } });
        const pct = data.progress.total ? Math.round((data.progress.pointed / data.progress.total) * 100) : 0;
        progEl.innerHTML = `<p class="muted" style="margin:0 0 8px">${data.progress.pointed}/${data.progress.total} pointés</p>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
        if (!data.entries.length) { listEl.innerHTML = SW.emptyState("Aucun employé affecté à ce site."); return; }
        listEl.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Employé #</th><th>Statut</th><th>Clôturé</th><th></th>
        </tr></thead><tbody>
          ${data.entries.map((e) => `<tr data-row="${e.employee_id}">
            <td>#${e.employee_id}</td>
            <td>${SW.statusBadge(e.status, SW.ATTENDANCE_STATUS)}</td>
            <td>${e.closed_at ? "oui" : "non"}</td>
            <td class="actions">
              ${e.closed_at
                ? `<button class="btn btn-sm" data-correct="${e.id}">Corriger</button>`
                : `<select class="status-select" data-set="${e.employee_id}">
                     <option value="">Choisir…</option>
                     ${STATUSES.map((s) => `<option value="${s}" ${e.status === s ? "selected" : ""}>${SW.esc((SW.ATTENDANCE_STATUS[s] || {}).label || s)}</option>`).join("")}
                   </select>`}
            </td>
          </tr>`).join("")}
        </tbody></table></div>`;
        listEl.querySelectorAll("[data-set]").forEach((sel) => sel.addEventListener("change", async (e) => {
          if (!e.target.value) return;
          try {
            await SW.api("/site-workforce/attendance", { method: "POST", body: { employee_id: Number(e.target.dataset.set), presence_date: date, status: e.target.value } });
            load();
          } catch (err) { alert(err.message); }
        }));
        listEl.querySelectorAll("[data-correct]").forEach((btn) => btn.addEventListener("click", async () => {
          const reason = prompt("Motif de la correction post-clôture (obligatoire, tracé) :");
          if (!reason) return;
          const status = prompt("Nouveau statut (present/absent/conge/maladie/repos/mission) :");
          if (!status || !STATUSES.includes(status)) return;
          try {
            await SW.api(`/site-workforce/attendance/${btn.dataset.correct}/correct`, { method: "POST", body: { status, reason } });
            load();
          } catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") listEl.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
