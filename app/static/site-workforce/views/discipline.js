// Discipline (§B13) : le chargé déclare et signale (Brouillon -> Signalé), jamais de
// décision/clôture — ces actions n'existent tout simplement pas dans ce module (backend
// autoritaire : aucune route ne les expose, pas seulement masquées côté UI).
(function () {
  "use strict";
  const SW = window.SW;
  const EVENT_TYPES = ["retard", "absence_injustifiee", "non_respect_consigne", "comportement", "autre"];

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.discipline = async function (container) {
    container.innerHTML = `
      <h1 class="section-title">Discipline</h1>
      <p class="section-sub">Déclaration d'incident — la décision reste exclusivement DRH</p>
      <div class="card">
        <div class="card-head"><h2>Déclarer un incident</h2></div>
        <form id="disc-form" class="form-row">
          <div class="field"><label>Employé # (optionnel)</label><input name="employee_id" type="number"></div>
          <div class="field"><label>Type</label>
            <select name="event_type" required>${EVENT_TYPES.map((t) => `<option value="${t}">${t.replace(/_/g, " ")}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Objet</label><input name="subject" required></div>
          <div class="field"><label>Description</label><input name="description"></div>
          <button class="btn btn-primary" type="submit">Créer (brouillon)</button>
        </form>
        <div id="disc-msg" class="msg"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Incidents</h2></div><div id="disc-list">${SW.skeletonRows(5)}</div></div>`;

    document.querySelector("#disc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.querySelector("#disc-msg");
      try {
        const eid = fd.get("employee_id");
        await SW.api("/site-workforce/discipline", { method: "POST", body: {
          employee_id: eid ? Number(eid) : null, event_type: fd.get("event_type"),
          subject: fd.get("subject"), description: fd.get("description") || null,
        } });
        msg.textContent = "Incident créé en brouillon."; msg.className = "msg ok";
        e.target.reset();
        load();
      } catch (err) { msg.textContent = err.message; msg.className = "msg error"; }
    });

    async function load() {
      const el = document.querySelector("#disc-list");
      try {
        const rows = await SW.guardedApi("discipline", "/site-workforce/discipline");
        if (!rows.length) { el.innerHTML = SW.emptyState("Aucun incident."); return; }
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
          <th>Objet</th><th>Type</th><th>Employé #</th><th>Statut</th><th></th>
        </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td>${SW.esc(r.subject)}</td><td>${SW.esc(r.event_type)}</td><td>${r.employee_id ? "#" + r.employee_id : "—"}</td>
            <td>${SW.statusBadge(r.status, SW.DISCIPLINE_STATUS)}</td>
            <td class="actions">
              ${r.status === "brouillon" ? `<button class="btn btn-sm" data-signal="${r.id}">Signaler</button>` : ""}
              ${r.status === "signale" ? `<button class="btn btn-sm" data-transmit="${r.id}" data-subject="${SW.esc(r.subject)}">Transmettre à la DRH</button>` : ""}
            </td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.querySelectorAll("[data-signal]").forEach((btn) => btn.addEventListener("click", async () => {
          const ok = await SW.confirmAction({ title: "Signaler cet incident ?", impact: [["Incident", "#" + btn.dataset.signal]], confirmLabel: "Signaler" });
          if (!ok) return;
          try { await SW.api(`/site-workforce/discipline/${btn.dataset.signal}/signaler`, { method: "POST" }); load(); }
          catch (err) { alert(err.message); }
        }));
        el.querySelectorAll("[data-transmit]").forEach((btn) => btn.addEventListener("click", async () => {
          // TROUVÉ EN REVUE DE SÉCURITÉ (§B22) : btn.dataset.subject revient DÉCODÉ des
          // entités HTML par le navigateur (l'attribut data-subject avait pourtant été
          // écrit via SW.esc()) — kvRow() n'échappe jamais sa "value" (convention réutilisée
          // depuis Finance V2, où "value" est déjà du HTML de confiance comme money()).
          // Repassé par SW.esc() ici : XSS stocké sinon possible via le sujet d'un incident.
          const ok = await SW.confirmAction({
            title: "Transmettre cet incident à la DRH ?",
            impact: [["Incident", "#" + btn.dataset.transmit], ["Objet", SW.esc(btn.dataset.subject)], ["Destinataire", "DRH"], ["Effet", "Le dossier source change de statut — aucune copie créée"]],
            confirmLabel: "Transmettre",
          });
          if (!ok) return;
          try {
            await SW.api("/site-workforce/transmissions", { method: "POST", body: {
              resource_type: "incident", resource_id: Number(btn.dataset.transmit), destinataire: "drh", objet: btn.dataset.subject,
            } });
            load();
          } catch (err) { alert(err.message); }
        }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
  };
})();
