// Réclamations (§B14) : Nouvelle -> En cours -> Transmise -> Réponse reçue -> Clôturée.
// Transmission (§B16) réutilise le dossier source, ne le duplique jamais.
(function () {
  "use strict";
  const SW = window.SW;

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.reclamations = async function (container) {
    container.innerHTML = `
      <h1 class="section-title">Réclamations</h1>
      <p class="section-sub">Suivi des réclamations du personnel du site</p>
      <div class="card">
        <div class="card-head"><h2>Nouvelle réclamation</h2></div>
        <form id="rec-form" class="form-row">
          <div class="field"><label>Employé #</label><input name="employee_id" type="number" required></div>
          <div class="field"><label>Sujet</label><input name="subject" required></div>
          <div class="field"><label>Description</label><input name="description" required></div>
          <div class="field"><label>Priorité</label>
            <select name="priority"><option value="normale">Normale</option><option value="haute">Haute</option><option value="basse">Basse</option></select>
          </div>
          <button class="btn btn-primary" type="submit">Créer</button>
        </form>
        <div id="rec-msg" class="msg"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Réclamations</h2></div><div id="rec-list">${SW.skeletonRows(5)}</div></div>`;

    document.querySelector("#rec-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#rec-msg");
      // §16 (revue finale d'intégration, double-submit) : désactivé pendant la requête —
      // rejoué et démontré : un double-clic réel créait deux réclamations identiques.
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await SW.api("/site-workforce/reclamations", { method: "POST", body: {
          employee_id: Number(fd.get("employee_id")), subject: fd.get("subject"),
          description: fd.get("description"), priority: fd.get("priority"),
        } });
        msg.textContent = "Réclamation créée."; msg.className = "msg ok";
        e.target.reset();
        load();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
      finally { btn.disabled = false; }
    });

    async function load() {
      const el = document.querySelector("#rec-list");
      try {
        const rows = await SW.guardedApi("reclamations", "/site-workforce/reclamations");
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucune réclamation."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Sujet</th><th>Employé #</th><th>Priorité</th><th>Statut</th><th></th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td>${SW.esc(r.subject)}</td><td>#${r.employee_id}</td><td>${SW.esc(r.priority)}</td>
            <td>${SW.statusBadge(r.status, SW.RECLAMATION_STATUS)}</td>
            <td class="actions">${r.status === "nouvelle" || r.status === "en_cours" ? `<button class="btn btn-sm" data-transmit="${r.id}" data-subject="${SW.esc(r.subject)}">Transmettre</button>` : ""}</td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-transmit]").forEach((btn) => btn.addEventListener("click", async () => {
          const destinataire = prompt("Destinataire (drh / ops / direction) :", "drh");
          if (!destinataire || !["drh", "ops", "direction"].includes(destinataire)) return;
          // TROUVÉ EN REVUE DE SÉCURITÉ (§B22, même défaut que views/discipline.js) :
          // btn.dataset.subject revient décodé des entités HTML — repassé par SW.esc() ici,
          // sinon XSS stocké possible via le sujet d'une réclamation.
          const ok = await SW.confirmAction({
            title: "Transmettre cette réclamation ?",
            impact: [["Réclamation", "#" + btn.dataset.transmit], ["Objet", SW.esc(btn.dataset.subject)], ["Destinataire", destinataire], ["Effet", "Le dossier source change de statut — aucune copie créée"]],
            confirmLabel: "Transmettre",
          });
          if (!ok) return;
          try {
            await SW.api("/site-workforce/transmissions", { method: "POST", body: {
              resource_type: "reclamation", resource_id: Number(btn.dataset.transmit), destinataire, objet: btn.dataset.subject,
            } });
            load();
          } catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
