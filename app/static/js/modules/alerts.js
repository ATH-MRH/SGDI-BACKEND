/* Cockpit Alertes (Lot 0.6-A) — module lazy, chargé à la demande sur #/alerts.
 * N'ajoute rien à sgdi-app.js : utilise directement sgdiApi()/toast()/openModal()
 * déjà globaux, sans passer par window.SGDI_API (aucune modification du monolithe). */
let alertsFilters = { status: "", severity: "", module: "", rule_key: "", society: "", site_id: "", assigned_user_id: "" };
let alertsListCache = null;

function alertsSeverityLabel(sev) {
  return { critical: "Critique", warning: "Attention", info: "Info" }[sev] || sev;
}
function alertsSeverityBadgeClass(sev) {
  return { critical: "pill pill-red", warning: "pill pill-amber", info: "pill pill-blue" }[sev] || "pill pill-gray";
}
function alertsStatusLabel(status) {
  return {
    open: "Ouverte", acknowledged: "Acquittée", assigned: "Assignée", deferred: "Différée",
    treated: "Traitée", ignored: "Ignorée", resolved: "Résolue",
  }[status] || status;
}
function alertsStatusBadgeClass(status) {
  if (status === "open") return "pill pill-red";
  if (["acknowledged", "assigned"].includes(status)) return "pill pill-amber";
  if (status === "deferred") return "pill pill-gray";
  if (["treated", "resolved"].includes(status)) return "pill pill-green";
  return "pill pill-gray";
}

function alertsQuery(params) {
  const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const qs = new URLSearchParams(clean).toString();
  return qs ? "?" + qs : "";
}

async function renderAlerts(view, sub, arg) {
  // Même mécanisme de visibilité que les autres modules lazy (agenda.js, ops.js,
  // pointage.js…) : canAccess() existant, aucun nouveau droit créé. L'accès réel
  // reste de toute façon imposé côté backend (app/modules/alerts/routes.py).
  if (typeof canAccess === "function" && !canAccess("alerts")) {
    view.innerHTML = '<div class="card p-6">🔐 Accès refusé</div>';
    return;
  }
  // Route détail = "alerts/<id>" (2 segments — cf. href="#/alerts/${a.id}" dans
  // alertsTableHTML, navigate('alerts/'+id) dans alertsAction). renderView()
  // détruit [root,sub,arg] par split("/") : pour "alerts/1", arg est undefined.
  // L'ancienne condition (sub && arg) exigeait à tort un 3e segment inexistant :
  // le bouton "Ouvrir" et le clic sur une ligne ne déclenchaient donc jamais la
  // fiche détail (retombée silencieuse sur la liste). Seul `sub` porte l'ID.
  if (sub) return renderAlertDetail(view, sub);
  view.innerHTML = '<div class="card p-10 text-center text-slate-400">Chargement des alertes…</div>';
  let stats, page;
  try {
    [stats, page] = await Promise.all([
      sgdiApi("/alerts/stats", { legacy: false }),
      sgdiApi("/alerts" + alertsQuery({ ...alertsFilters, page: 1, page_size: 50 }), { legacy: false }),
    ]);
  } catch (e) {
    view.innerHTML = `<div class="card p-6" role="alert">Chargement des alertes impossible : ${escapeHTML(e.message || String(e))}<button class="btn btn-ghost" onclick="renderView()">Réessayer</button></div>`;
    return;
  }
  alertsListCache = page.items;
  view.innerHTML = `<div data-alerts-view="1">
    <div class="flex items-center justify-between mb-4">
      <div><h1 class="text-2xl font-bold">Cockpit Alertes</h1><p class="text-slate-500 text-sm">Détection déterministe — contrats et présences.</p></div>
    </div>
    <div class="grid grid-4 mb-4" style="gap:12px">
      ${alertsKpiCard("Ouvertes", stats.total_open, "")}
      ${alertsKpiCard("Critiques", stats.critical, "pill-red")}
      ${alertsKpiCard("Non acquittées", stats.unacknowledged, "pill-amber")}
      ${alertsKpiCard("Assignées à moi", stats.assigned_to_me, "pill-blue")}
    </div>
    <div class="card p-4 mb-4 flex gap-2 flex-wrap items-end" data-nav-filter="1">
      ${alertsFilterSelect("status", "Statut", ["open", "acknowledged", "assigned", "deferred", "treated", "ignored", "resolved"], alertsStatusLabel)}
      ${alertsFilterSelect("severity", "Criticité", ["critical", "warning", "info"], alertsSeverityLabel)}
      ${alertsFilterSelect("rule_key", "Règle", ["drh.employee_contract.expiring", "attendance.presence.missing_checkout"], k => k)}
      <div><label class="label">Société</label><input class="input" value="${escapeHTML(alertsFilters.society)}" oninput="alertsSetFilter('society',this.value)"/></div>
      <button type="button" class="btn btn-secondary" onclick="alertsResetFilters()">Réinitialiser</button>
    </div>
    ${alertsTableHTML(page)}
  </div>`;
}

function alertsKpiCard(label, value, toneClass) {
  return `<div class="card p-4 erp-kpi"><div class="text-xs text-slate-500 uppercase font-bold">${escapeHTML(label)}</div><div class="text-3xl font-black mt-1 ${toneClass ? "" : ""}">${value}</div></div>`;
}

function alertsFilterSelect(key, label, options, labelFn) {
  const current = alertsFilters[key] || "";
  return `<div><label class="label">${escapeHTML(label)}</label><select class="select" onchange="alertsSetFilter('${key}',this.value)">
    <option value="">Tous</option>
    ${options.map(o => `<option value="${escapeHTML(o)}" ${current === o ? "selected" : ""}>${escapeHTML(labelFn(o))}</option>`).join("")}
  </select></div>`;
}

function alertsSetFilter(key, value) {
  alertsFilters[key] = value || "";
  renderView();
}
function alertsResetFilters() {
  alertsFilters = { status: "", severity: "", module: "", rule_key: "", society: "", site_id: "", assigned_user_id: "" };
  renderView();
}

function alertsTableHTML(page) {
  const items = (page && page.items) || [];
  if (!items.length) {
    return `<div class="card p-10 text-center text-slate-500">
      <div class="font-bold mb-1">Aucune alerte trouvée</div>
      <div class="text-sm mb-3">Aucune alerte ne correspond aux filtres actuels.</div>
      <button type="button" class="btn btn-secondary text-xs" onclick="alertsResetFilters()">Réinitialiser les filtres</button>
    </div>`;
  }
  return `<div class="card overflow-hidden"><table>
    <thead><tr><th>Criticité</th><th>Règle</th><th>Titre</th><th>Société / Site</th><th>Score</th><th>Statut</th><th>Dernière détection</th><th></th></tr></thead>
    <tbody>${items.map(a => `<tr data-searchable style="cursor:pointer" onclick="navigate('alerts/${a.id}')">
      <td><span class="${alertsSeverityBadgeClass(a.severity)}">${escapeHTML(alertsSeverityLabel(a.severity))}</span></td>
      <td class="text-xs font-mono">${escapeHTML(a.rule_key)}</td>
      <td>${escapeHTML(a.title)}</td>
      <td class="text-xs">${escapeHTML(a.society)}${a.site_id ? " · site #" + a.site_id : ""}</td>
      <td class="font-bold">${a.score}/100</td>
      <td><span class="${alertsStatusBadgeClass(a.status)}">${escapeHTML(alertsStatusLabel(a.status))}</span></td>
      <td class="text-xs">${escapeHTML(String(a.last_detected_at || "").slice(0, 16).replace("T", " "))}</td>
      <td class="text-right"><a class="btn btn-ghost text-xs" href="#/alerts/${a.id}">Ouvrir →</a></td>
    </tr>`).join("")}</tbody>
  </table><div class="p-3 text-sm text-slate-500">${page.total} alerte(s) · page ${page.page}/${page.pages}</div></div>`;
}

async function renderAlertDetail(view, id) {
  view.innerHTML = '<div class="card p-10 text-center text-slate-400">Chargement…</div>';
  let alert;
  try {
    alert = await sgdiApi("/alerts/" + encodeURIComponent(id), { legacy: false });
  } catch (e) {
    view.innerHTML = `<div class="card p-6" role="alert">Alerte introuvable ou accès refusé : ${escapeHTML(e.message || String(e))}<button class="btn btn-ghost" onclick="navigate('alerts')">← Retour</button></div>`;
    return;
  }
  view.innerHTML = `<div data-alerts-detail="1">
    <button type="button" class="btn btn-ghost mb-3" onclick="navigate('alerts')">← Retour au cockpit</button>
    <div class="card p-5 mb-4">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div>
          <span class="${alertsSeverityBadgeClass(alert.severity)}">${escapeHTML(alertsSeverityLabel(alert.severity))}</span>
          <span class="${alertsStatusBadgeClass(alert.status)}" style="margin-left:6px">${escapeHTML(alertsStatusLabel(alert.status))}</span>
          <h1 class="text-xl font-bold mt-2">${escapeHTML(alert.title)}</h1>
          <p class="text-slate-500 text-sm">${escapeHTML(alert.summary || "")}</p>
        </div>
        <div class="text-right">
          <div class="text-3xl font-black">${alert.score}<span class="text-sm text-slate-400">/100</span></div>
          <div class="text-xs text-slate-500">Confiance ${alert.confidence}%</div>
        </div>
      </div>
      <div class="text-xs text-slate-500 font-mono">${escapeHTML(alert.rule_key)} · ${escapeHTML(alert.society)}${alert.site_id ? " · site #" + alert.site_id : ""} · ${alert.occurrence_count} occurrence(s)</div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-2">Pourquoi ce score ?</h3>
      <p class="text-sm text-slate-600 mb-3">${escapeHTML(alert.explanation || "")}</p>
      <div class="space-y-1">${(alert.score_factors || []).map(f => `<div class="flex justify-between text-sm border-b py-1"><span>${escapeHTML(f.label)}</span><b class="text-emerald-700">+${f.contribution}</b></div>`).join("") || '<div class="text-sm text-slate-400">Aucun facteur disponible.</div>'}</div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-2">Actions</h3>
      <div class="flex gap-2 flex-wrap">
        <button type="button" class="btn btn-secondary" onclick="alertsAction(${alert.id},'acknowledge')">Acquitter</button>
        <button type="button" class="btn btn-secondary" onclick="alertsAction(${alert.id},'assign')">M'assigner</button>
        <button type="button" class="btn btn-secondary" onclick="alertsDeferPrompt(${alert.id})">Différer</button>
        <button type="button" class="btn btn-secondary" onclick="alertsIgnorePrompt(${alert.id})">Ignorer</button>
        <button type="button" class="btn btn-primary" onclick="alertsAction(${alert.id},'treated')">Marquer traitée</button>
      </div>
    </div>
    <div class="grid grid-2" style="gap:16px">
      <div class="card p-5">
        <h3 class="font-bold mb-2">Preuves</h3>
        ${(alert.evidence || []).map(ev => `<div class="text-xs border-b py-2"><div class="text-slate-400">${escapeHTML(String(ev.observed_at || "").slice(0, 16).replace("T", " "))}</div><pre style="white-space:pre-wrap;font-family:inherit">${escapeHTML(JSON.stringify(ev.evidence_value_json, null, 2))}</pre></div>`).join("") || '<div class="text-sm text-slate-400">Aucune preuve.</div>'}
      </div>
      <div class="card p-5">
        <h3 class="font-bold mb-2">Historique</h3>
        ${(alert.history || []).map(h => `<div class="text-xs border-b py-2"><b>${escapeHTML(h.action)}</b> ${h.previous_status ? escapeHTML(h.previous_status) + " → " : ""}${escapeHTML(h.new_status || "")}<div class="text-slate-400">${escapeHTML(String(h.created_at || "").slice(0, 16).replace("T", " "))}${h.reason ? " · " + escapeHTML(h.reason) : ""}</div></div>`).join("") || '<div class="text-sm text-slate-400">Aucun historique.</div>'}
      </div>
    </div>
  </div>`;
}

async function alertsAction(id, action, payload) {
  try {
    await sgdiApi(`/alerts/${id}/${action}`, { method: "POST", body: payload || {}, legacy: false });
    toast("Action enregistrée", "success");
    navigate("alerts/" + id);
  } catch (e) {
    toast("Action refusée : " + (e.message || e), "error");
  }
}
function alertsIgnorePrompt(id) {
  openModal(`<h3 class="font-bold text-lg mb-3">Ignorer l'alerte</h3>
    <form onsubmit="event.preventDefault();closeModal();alertsAction(${id},'ignore',{reason:this.reason.value})">
      <label class="label">Motif *</label><textarea class="textarea" name="reason" rows="3" required></textarea>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-danger">Ignorer</button></div>
    </form>`);
}
function alertsDeferPrompt(id) {
  openModal(`<h3 class="font-bold text-lg mb-3">Différer l'alerte</h3>
    <form onsubmit="event.preventDefault();closeModal();alertsAction(${id},'defer',{deferred_until:new Date(this.until.value).toISOString()})">
      <label class="label">Reporter jusqu'au *</label><input class="input" type="datetime-local" name="until" required/>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Différer</button></div>
    </form>`);
}

SGDIModules.registerModule({
  key: "alerts",
  routes: ["alerts"],
  init: function () {},
  destroy: function () { alertsListCache = null; },
});
