// Personnel du site (§B15) : annuaire paginé SERVEUR (jamais un full-fetch), recherche
// serveur. Champs volontairement limités — jamais salaire/RIB/paie/IRG/CNAS.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.personnel = async function (container) {
    let page = 1;
    let q = "";
    container.innerHTML = `
      <h1 class="section-title">Personnel du site</h1>
      <p class="section-sub">Annuaire — lecture seule</p>
      <div class="filters-row">
        <div class="field search-input"><label>Recherche</label><input id="pers-q" placeholder="Nom, code, poste…"></div>
      </div>
      <div class="card"><div id="pers-list">${SW.skeletonRows(6)}</div></div>`;

    let debounceTimer;
    document.querySelector("#pers-q").addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { q = e.target.value; page = 1; load(); }, 250);
    });

    async function load() {
      const el = document.querySelector("#pers-list");
      try {
        const data = await SW.guardedApi("personnel", "/site-workforce/employees", { params: { q, page, page_size: 20 } });
        if (!data.items.length) { el.innerHTML = SW.emptyState("Aucun employé ne correspond."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Code</th><th>Nom</th><th>Poste</th><th>Groupe</th><th>Statut</th>
        </tr></thead><tbody>
          ${data.items.map((r) => `<tr>
            <td class="mono">${SW.esc(r.code)}</td>
            <td>${SW.esc(r.first_name)} ${SW.esc(r.last_name)}</td>
            <td>${SW.esc(r.position || "—")}</td>
            <td>${SW.esc(r.group_code || "—")}</td>
            <td>${SW.statusBadge(r.presence_status, SW.ATTENDANCE_STATUS)}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.appendChild(SW.paginationBar(data, (p) => { page = p; load(); }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
