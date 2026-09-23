// Justificatifs (§B10) : upload + vérification. validity_status du DOCUMENT uniquement —
// ne modifie jamais la décision d'absence (voir vue Absences, statut strictement séparé).
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.justificatifs = async function (container) {
    container.innerHTML = `
      <h1 class="section-title">Justificatifs</h1>
      <p class="section-sub">Réception et vérification — statut du document, jamais de l'absence elle-même</p>
      <div class="card">
        <div class="card-head"><h2>Déposer un justificatif</h2></div>
        <form id="just-form" class="form-row">
          <div class="field"><label>Type de dossier</label>
            <select name="owner_type" required>
              <option value="attendance">Pointage (absence)</option>
              <option value="leave">Congé / maladie</option>
              <option value="reclamation">Réclamation</option>
            </select>
          </div>
          <div class="field"><label>ID du dossier</label><input name="owner_id" type="number" required></div>
          <div class="field"><label>Libellé</label><input name="label" required placeholder="Certificat médical…"></div>
          <div class="field"><label>Fichier</label><input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png"></div>
          <button class="btn btn-primary" type="submit">Déposer</button>
        </form>
        <div id="just-msg" class="msg"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Justificatifs récents</h2></div><div id="just-list">${SW.skeletonRows(6)}</div></div>`;

    document.querySelector("#just-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const file = fd.get("file");
      const msg = document.querySelector("#just-msg");
      try {
        const dataUrl = await SW.readFileAsDataUrl(file);
        await SW.api("/site-workforce/documents", { method: "POST", body: {
          owner_type: fd.get("owner_type"), owner_id: Number(fd.get("owner_id")), label: fd.get("label"), data_url: dataUrl,
        } });
        msg.textContent = "Justificatif déposé."; msg.className = "msg ok";
        e.target.reset();
        load();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
    });

    async function load() {
      const el = document.querySelector("#just-list");
      try {
        const rows = await SW.guardedApi("justificatifs", "/site-workforce/documents");
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucun justificatif."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Libellé</th><th>Type</th><th>Dossier #</th><th>Statut</th><th>Vérifié par</th><th></th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td>${SW.esc(r.label)}</td><td>${SW.esc(r.owner_type)}</td><td>#${r.owner_id}</td>
            <td>${SW.statusBadge(r.validity_status, SW.DOCUMENT_STATUS)}</td>
            <td>${SW.esc(r.verified_by || "—")}</td>
            <td class="actions">${r.validity_status === "en_attente" ? `
              <button class="btn btn-sm" data-verify="${r.id}" data-status="conforme">Conforme</button>
              <button class="btn btn-sm btn-danger" data-verify="${r.id}" data-status="non_conforme">Non conforme</button>` : ""}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-verify]").forEach((btn) => btn.addEventListener("click", async () => {
          const validity_status = btn.dataset.status;
          const ok = await SW.confirmAction({
            title: "Vérifier ce justificatif ?",
            impact: [["Document", "#" + btn.dataset.verify], ["Statut du document", validity_status], ["Effet", "Ne modifie jamais une décision d'absence — action séparée"]],
            confirmLabel: "Confirmer",
          });
          if (!ok) return;
          try { await SW.api(`/site-workforce/documents/${btn.dataset.verify}/verify`, { method: "POST", body: { validity_status } }); load(); }
          catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
