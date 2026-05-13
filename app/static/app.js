(function () {
  const app = document.getElementById("app");
  let cache = { employees: [], sites: [], stores: [], suppliers: [], articles: [] };

  const NAV = [
    { section: "Général",   icon: "📊", label: "Situation générale",  path: "/dashboard" },
    { section: "DRH",       icon: "👤", label: "Employés",            path: "/drh/employees" },
    { section: "DRH",       icon: "📝", label: "Candidats",           path: "/drh/candidates" },
    { section: "DRH",       icon: "📄", label: "Contrats",            path: "/drh/contracts" },
    { section: "DRH",       icon: "📆", label: "Congés",              path: "/drh/leaves" },
    { section: "DRH",       icon: "⚖", label: "Sanctions",           path: "/drh/sanctions" },
    { section: "OPS",       icon: "📍", label: "Sites",               path: "/ops/sites" },
    { section: "OPS",       icon: "🎯", label: "Situation sites",     path: "/ops/situation" },
    { section: "OPS",       icon: "🔁", label: "Affectations",        path: "/ops/assignments" },
    { section: "OPS",       icon: "⏱", label: "Pointage quotidien",  path: "/ops/pointage" },
    { section: "OPS",       icon: "📌", label: "Main courante",       path: "/ops/events" },
    { section: "Matériel",  icon: "🏠", label: "Tableau de bord",     path: "/materiel/dashboard" },
    { section: "Matériel",  icon: "🏬", label: "Magasins",            path: "/materiel/stores" },
    { section: "Matériel",  icon: "🤝", label: "Fournisseurs",        path: "/materiel/suppliers" },
    { section: "Matériel",  icon: "📦", label: "Articles",            path: "/materiel/articles" },
    { section: "Matériel",  icon: "📋", label: "Inventaire",          path: "/materiel/inventory" },
    { section: "Matériel",  icon: "↕", label: "Mouvements",          path: "/materiel/movements" },
    { section: "Matériel",  icon: "🎒", label: "Dotations",           path: "/materiel/dotations" },
    { section: "Matériel",  icon: "↩", label: "Reversements",        path: "/materiel/reversements" }
  ];

  /* ---- utils ---- */
  function h(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function money(v) {
    return Number(v || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function qty(v) {
    return Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  function currentPath() {
    return (location.hash || "#/dashboard").replace(/^#/, "");
  }
  function setPath(path) {
    location.hash = path;
  }
  window.setPath = setPath;
  function user() {
    try { return JSON.parse(localStorage.getItem("sgdi_fastapi_user") || "null"); } catch (_e) { return null; }
  }
  function toast(message, type = "info") {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.className = "toast";
    if (type === "error")   el.style.background = "#b91c1c";
    else if (type === "success") el.style.background = "#047857";
    else                    el.style.background = "#111827";
    setTimeout(() => el.classList.add("hidden"), 3200);
  }
  function badge(text, kind = "") {
    return `<span class="badge ${kind}">${h(text)}</span>`;
  }
  function empty(text) {
    return `<div class="empty">${h(text)}</div>`;
  }
  function openModal(title, body) {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="modal-backdrop" id="modal">
        <div class="modal">
          <div class="page-head">
            <div><h2>${h(title)}</h2></div>
            <button class="btn btn-ghost btn-sm" onclick="closeModal()">Fermer</button>
          </div>
          ${body}
        </div>
      </div>`);
  }
  window.closeModal = function () {
    const modal = document.getElementById("modal");
    if (modal) modal.remove();
  };
  function formPayload(form, numbers = []) {
    const fd = new FormData(form);
    const out = {};
    for (const [k, v] of fd.entries()) out[k] = v === "" ? null : v;
    numbers.forEach(k => { if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k] || 0); });
    return out;
  }
  function field(label, name, type = "text", value = "", extra = "") {
    return `<div class="field"><label>${h(label)}</label><input class="input" name="${h(name)}" type="${h(type)}" value="${h(value)}" ${extra}></div>`;
  }
  function selectField(label, name, options, value = "", extra = "") {
    return `<div class="field"><label>${h(label)}</label><select class="select" name="${h(name)}" ${extra}>
      ${options.map(o => `<option value="${h(o.value ?? o)}" ${(o.value ?? o) === value ? "selected" : ""}>${h(o.label ?? o)}</option>`).join("")}
    </select></div>`;
  }
  function textareaField(label, name, value = "", cls = "") {
    return `<div class="field ${cls}"><label>${h(label)}</label><textarea class="input" name="${h(name)}">${h(value)}</textarea></div>`;
  }
  function tableEl(headers, rows, colspan) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>
      ${rows.length ? rows.join("") : `<tr><td colspan="${colspan || headers.length}">${empty("Aucune donnée.")}</td></tr>`}
    </tbody></table></div>`;
  }

  async function apiCall(fn, success) {
    try {
      const out = await fn();
      if (success) toast(success, "success");
      return out;
    } catch (e) {
      toast(e.message || "Erreur API", "error");
      throw e;
    }
  }

  /* ================================================================
     LOGIN — identique au référentiel IRONGS
     ================================================================ */
  function renderLogin() {
    SGDI.logout();
    app.innerHTML = `<div class="min-h-screen flex items-center justify-center p-6" style="background:#f8fafc;color:#0f172a">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="text-4xl font-black tracking-wide text-slate-950">SGDI</div>
        <div class="text-sm text-slate-500 mt-1 tracking-widest uppercase">Algérie</div>
      </div>
      <div class="p-7 rounded-xl" style="background:#ffffff;border:1px solid #e2e8f0;box-shadow:0 24px 60px rgba(15,23,42,.10)">
        <form onsubmit="event.preventDefault();login(this.username.value,this.password.value)">
          <label class="block text-xs font-semibold text-slate-600 mb-2">Identifiant</label>
          <input class="input mb-4" style="background:#fff;color:#0f172a;border-color:#cbd5e1" name="username" required autofocus/>
          <label class="block text-xs font-semibold text-slate-600 mb-2">Mot de passe</label>
          <input class="input mb-4" style="background:#fff;color:#0f172a;border-color:#cbd5e1" type="password" name="password" required/>
          <label class="flex items-center gap-2 text-sm text-slate-600 mb-5">
            <input type="checkbox" name="remember" style="width:16px;height:16px;accent-color:#043970"/>
            Se souvenir de moi
          </label>
          <button class="btn w-full justify-center" style="background:#043970;color:#111;font-weight:800">Se connecter</button>
        </form>
        <div class="mt-5 text-center"><button class="text-xs text-slate-500 hover:text-amber-600" onclick="if(confirm('Réinitialiser toutes les données ?')){localStorage.clear();location.reload()}">Réinitialiser les données</button></div>
      </div>
    </div>
  </div>`;
  }

  window.login = async function (username, password) {
    await apiCall(() => SGDI.login(username, password), "Connexion réussie");
    setPath("/dashboard");
  };

  /* ================================================================
     SHELL — barre latérale + topbar IRONGS
     ================================================================ */
  function shell(content, title = "Situation générale") {
    const u = user();
    const path = currentPath();
    const grouped = NAV.reduce((acc, item) => {
      (acc[item.section] ||= []).push(item);
      return acc;
    }, {});
    const initial = u ? (u.full_name || u.username || "?").slice(0, 1).toUpperCase() : "?";
    const role = u ? (u.role || "") : "";
    return `
      <div class="flex h-screen app-shell">
        <aside class="sidebar w-72 flex flex-col shrink-0">
          <div class="px-5 py-5 border-b border-slate-200">
            <div class="text-4xl font-black tracking-tight"><span class="text-amber-600">SGD</span><span class="text-slate-950">I</span></div>
          </div>
          <nav class="flex-1 overflow-y-auto py-3 px-2" id="sidebar-nav">
            ${Object.entries(grouped).map(([section, items]) => `
              <div class="nav-group"><span style="display:flex;align-items:center;gap:6px"><span class="arrow">▾</span>${h(section)}</span></div>
              ${items.map(item => `
                <a class="sub-link ${path === item.path ? "active" : ""}" href="#${item.path}"><span>${h(item.icon)}</span>${h(item.label)}</a>
              `).join("")}
            `).join("")}
          </nav>
          <div class="px-4 py-3 border-t border-slate-200 text-xs text-slate-500">
            <div class="flex items-center gap-2 mb-2">
              <div class="avatar" style="width:28px;height:28px;font-size:11px">${h(initial)}</div>
              <div class="leading-tight">
                <div class="text-slate-900 font-semibold">${h(u ? u.full_name || u.username : "")}</div>
                <div class="text-[10px] uppercase tracking-wider text-slate-500">${h(role)}</div>
              </div>
            </div>
            <button class="btn btn-ghost w-full justify-center" onclick="logout()">Se déconnecter</button>
          </div>
        </aside>
        <main class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-2 no-print" style="background:#04397011;border-bottom:2px solid #043970">
            <div class="flex items-center gap-3">
              <button type="button" class="btn btn-ghost text-xs" onclick="goBackSmart()" title="Retour" style="min-width:36px;height:36px;padding:0;font-size:18px">←</button>
              <div>
                <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Module actif</div>
                <div class="font-bold" style="color:#043970">${h(title)}</div>
              </div>
            </div>
            <button class="btn btn-secondary text-xs" onclick="setPath('/dashboard')">Tableau de bord</button>
          </div>
          <div class="search-box flex items-center gap-2 no-print">
            <span class="text-slate-500 text-sm">🔎</span>
            <input id="global-search" class="input flex-1 max-w-xl mx-auto" placeholder="Rechercher dans cette vue…" oninput="filterCurrentView(this.value)"/>
          </div>
          <div class="flex-1 overflow-y-auto p-6" id="view">${content}</div>
        </main>
      </div>`;
  }

  window.goBackSmart = function () {
    if (history.length > 1) history.back();
    else setPath("/dashboard");
  };

  window.filterCurrentView = function (value) {
    const q = String(value || "").trim().toLowerCase();
    document.querySelectorAll("#view tbody tr").forEach(row => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };

  window.logout = function () {
    SGDI.logout();
    setPath("/login");
  };

  /* ================================================================
     DASHBOARD
     ================================================================ */
  async function renderDashboard() {
    const [drh, ops, mt] = await Promise.all([
      SGDI.drh.dashboard(),
      SGDI.ops.dashboard(),
      SGDI.materiel.dashboard()
    ]);
    app.innerHTML = shell(`
      <div class="page-head">
        <div>
          <h1>Situation générale</h1>
          <div class="muted">Vue synthétique des trois modules raccordés au backend FastAPI.</div>
        </div>
      </div>
      <div class="grid grid-4">
        ${kpi("Effectif total",       drh.employees_total || 0,    "/drh/employees")}
        ${kpi("Sites actifs",         ops.active_sites || 0,       "/ops/sites")}
        ${kpi("Évènements ouverts",   ops.open_events || 0,        "/ops/events")}
        ${kpi("Articles matériel",    mt.articles || 0,            "/materiel/articles")}
      </div>
      <div class="grid grid-3" style="margin-top:16px">
        <div class="card">
          <h2>DRH</h2>
          ${statusList(drh.employees_by_status)}
          <div class="muted" style="margin-top:8px">Congés en instance : ${h(drh.leaves_pending || 0)}</div>
        </div>
        <div class="card">
          <h2>OPS</h2>
          <div class="muted">Affectations actives : ${h(ops.active_assignments || 0)}</div>
          <div class="muted">Lignes pointage aujourd'hui : ${h(ops.daily_presence_rows_today || 0)}</div>
        </div>
        <div class="card">
          <h2>Matériel</h2>
          <div class="muted">Magasins : ${h(mt.stores || 0)}</div>
          <div class="muted">Fournisseurs : ${h(mt.suppliers || 0)}</div>
          <div class="muted">Dotations actives : ${h(mt.active_employee_dotations || 0)}</div>
        </div>
      </div>`, "Situation générale");
  }
  function kpi(label, value, path) {
    return `<div class="card kpi" onclick="location.hash='${path}'"><div class="kpi-label">${h(label)}</div><div class="kpi-value">${h(value)}</div></div>`;
  }
  function statusList(obj = {}) {
    const keys = Object.keys(obj);
    return keys.length
      ? keys.map(k => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #eef2f7;padding:7px 0"><span>${h(k)}</span><strong>${h(obj[k])}</strong></div>`).join("")
      : `<div class="muted">Aucune donnée.</div>`;
  }

  /* ================================================================
     DRH — Employés
     ================================================================ */
  async function renderEmployees() {
    cache.employees = await SGDI.drh.employees();
    const rows = cache.employees.map(e => `<tr>
      <td><button class="btn btn-sm btn-secondary" onclick="location.hash='/drh/fiche/${e.id}'">${h(e.code)}</button></td>
      <td><strong>${h(e.last_name)} ${h(e.first_name)}</strong><div class="muted">${h(e.phone || "")}</div></td>
      <td>${h(e.position || "")}</td>
      <td>${h(e.society || "")}</td>
      <td>${badge(e.status, e.status === "actif" ? "ok" : "warn")}</td>
      <td>${money(e.salary_net)} DA</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Employés</h1><div class="muted">Effectif et fiches de position.</div></div>
        <button class="btn btn-primary" onclick="openEmployeeForm()">+ Nouvel employé</button>
      </div>
      ${tableEl(["Code","Employé","Poste","Société","Situation","Salaire net"], rows)}`, "DRH · Employés");
  }
  window.openEmployeeForm = function () {
    openModal("Nouvel employé", `
      <form id="employeeForm" class="form-grid">
        ${field("Code",           "code",         "text",   "", "required")}
        ${field("Nom",            "last_name",     "text",   "", "required")}
        ${field("Prénom",         "first_name",    "text",   "", "required")}
        ${field("Téléphone",      "phone")}
        ${field("Email",          "email",         "email")}
        ${field("Poste",          "position")}
        ${field("Société",        "society")}
        ${selectField("Situation","status",        ["actif","conge","maladie","absent","suspendu","sortant"], "actif")}
        ${field("Salaire net",    "salary_net",    "number", "0")}
        ${field("Date recrutement","recruit_date", "date")}
        <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
      </form>`);
    document.getElementById("employeeForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.drh.createEmployee(formPayload(e.target, ["salary_net"])), "Employé créé");
      closeModal(); renderEmployees();
    });
  };

  /* ================================================================
     DRH — Fiche de position
     ================================================================ */
  async function renderFiche(id) {
    const fiche = await SGDI.drh.fiche(id);
    const e = fiche.employee;
    const eq = fiche.equipment || [];
    const assignments = fiche.assignments || [];
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Fiche de position</h1><div class="muted">${h(e.last_name)} ${h(e.first_name)}</div></div>
        <button class="btn btn-ghost" onclick="history.back()">← Retour</button>
      </div>
      <div class="grid grid-3">
        <div class="card"><div class="kpi-label">Code</div><div class="kpi-value" style="font-size:20px">${h(e.code)}</div></div>
        <div class="card"><div class="kpi-label">Situation</div><div class="kpi-value" style="font-size:20px">${h(e.status)}</div></div>
        <div class="card"><div class="kpi-label">Salaire net</div><div class="kpi-value" style="font-size:20px">${money(e.salary_net)} DA</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>Contrats</h2>${simpleList(fiche.contracts, c => `${c.contract_type} · ${c.position || ""} · ${c.start_date || ""}`)}</div>
        <div class="card"><h2>Affectations</h2>${simpleList(assignments, a => `Site ${a.site_id} · Groupe ${a.group_code} · ${a.start_date}`)}</div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Matériel & équipement attribué</h2>
        ${tableEl(["Article","Quantité","P.U.","Valeur","Date dotation","Motif","N° bon"], eq.map(x => `<tr>
          <td>${h(x.article_id)}</td>
          <td>${qty(x.quantity)}</td>
          <td>${money(x.unit_price)}</td>
          <td>${money((x.quantity||0)*(x.unit_price||0))}</td>
          <td>${h(x.dotation_date)}</td>
          <td>${h(x.dotation_reason||"")}</td>
          <td>${h(x.voucher_number||"")}</td>
        </tr>`))}
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>Congés / absences</h2>${simpleList(fiche.leaves, l => `${l.leave_type} · ${l.start_date} au ${l.end_date} · ${l.status}`)}</div>
        <div class="card"><h2>Sanctions</h2>${simpleList(fiche.sanctions, s => `${s.infraction_date} · ${s.sanction_type} · ${s.fault}`)}</div>
      </div>`, "DRH · Fiche de position");
  }
  function simpleList(items, fn) {
    return items && items.length
      ? `<ul style="margin:0;padding-left:16px">${items.map(x => `<li style="margin:7px 0;font-size:13px">${h(fn(x))}</li>`).join("")}</ul>`
      : `<div class="muted">Aucune donnée.</div>`;
  }

  /* ================================================================
     DRH — Candidats
     ================================================================ */
  async function renderCandidates() {
    const items = await SGDI.drh.candidates();
    const rows = items.map(c => `<tr>
      <td><strong>${h(c.last_name)} ${h(c.first_name)}</strong><div class="muted">${h(c.phone||"")}</div></td>
      <td>${h(c.desired_position||"")}</td>
      <td>${h(c.society||"")}</td>
      <td>${money(c.expected_salary)} DA</td>
      <td>${badge(c.status, c.status==="reserve"?"warn":"")}</td>
      <td><button class="btn btn-sm btn-success" onclick="recruitCandidate(${c.id})">Recruter</button></td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Candidats</h1><div class="muted">Nouvelle candidature, réserve et recrutement.</div></div>
        <button class="btn btn-primary" onclick="openCandidateForm()">+ Nouveau candidat</button>
      </div>
      ${tableEl(["Candidat","Poste","Société","Salaire prévu","Statut","Action"], rows)}`, "DRH · Candidats");
  }
  window.openCandidateForm = function () {
    openModal("Nouveau candidat", `<form id="candidateForm" class="form-grid">
      ${field("Nom",              "last_name",          "text","","required")}
      ${field("Prénom",           "first_name",         "text","","required")}
      ${field("Téléphone",        "phone")}
      ${field("Email",            "email",              "email")}
      ${field("Poste souhaité",   "desired_position")}
      ${field("Société",          "society")}
      ${field("Salaire prévu",    "expected_salary",    "number","0")}
      ${selectField("Statut",     "status",             ["nouvelle","reserve","a_contractualiser","embauche","refuse"],"nouvelle")}
      ${textareaField("Avis recruteur","recruiter_opinion","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("candidateForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.drh.createCandidate(formPayload(e.target,["expected_salary"])), "Candidat créé");
      closeModal(); renderCandidates();
    });
  };
  window.recruitCandidate = async id => {
    await apiCall(() => SGDI.drh.recruit(id), "Candidat recruté");
    renderCandidates();
  };

  /* ================================================================
     DRH — Contrats
     ================================================================ */
  async function renderContracts() {
    const contracts = await SGDI.drh.contracts();
    const rows = contracts.map(c => `<tr>
      <td>${h(c.employee_id)}</td><td>${h(c.contract_type)}</td>
      <td>${h(c.position||"")}</td><td>${h(c.start_date||"")}</td>
      <td>${h(c.end_date||"")}</td><td>${money(c.salary_net)} DA</td>
      <td>${badge(c.status)}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Contrats</h1></div>
        <button class="btn btn-primary" onclick="openContractForm()">+ Nouveau contrat</button>
      </div>
      ${tableEl(["Employé","Type","Poste","Début","Fin","Salaire","Statut"], rows)}`, "DRH · Contrats");
  }
  window.openContractForm = function () {
    openModal("Nouveau contrat", `<form id="contractForm" class="form-grid">
      ${field("ID employé",           "employee_id",      "number","","required")}
      ${selectField("Type contrat",   "contract_type",    ["CDI","CDD","Stage","Prestation"],"CDI")}
      ${field("Poste",                "position")}
      ${field("Date début",           "start_date",       "date")}
      ${field("Date fin",             "end_date",         "date")}
      ${field("Fin période essai",    "trial_end_date",   "date")}
      ${field("Salaire net",          "salary_net",       "number","0")}
      ${selectField("Statut",         "status",           ["actif","expire","suspendu"],"actif")}
      ${textareaField("Contenu / observation","content","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("contractForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.drh.createContract(formPayload(e.target,["employee_id","salary_net"])), "Contrat créé");
      closeModal(); renderContracts();
    });
  };

  /* ================================================================
     DRH — Congés
     ================================================================ */
  async function renderLeaves() {
    const leaves = await SGDI.drh.leaves();
    const rows = leaves.map(l => `<tr>
      <td>${h(l.employee_id)}</td><td>${h(l.leave_type)}</td>
      <td>${h(l.start_date)}</td><td>${h(l.end_date)}</td>
      <td>${h(l.reason||"")}</td>
      <td>${badge(l.status, l.status==="approuve"?"ok":l.status==="refuse"?"bad":"warn")}</td>
      <td>
        <button class="btn btn-sm btn-success" onclick="approveLeave(${l.id})">Valider</button>
        <button class="btn btn-sm btn-danger"  onclick="refuseLeave(${l.id})">Refuser</button>
      </td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Congés et absences</h1></div>
        <button class="btn btn-primary" onclick="openLeaveForm()">+ Nouvelle demande</button>
      </div>
      ${tableEl(["Employé","Type","Du","Au","Motif","Statut","Actions"], rows)}`, "DRH · Congés");
  }
  window.openLeaveForm = function () {
    openModal("Nouvelle demande", `<form id="leaveForm" class="form-grid">
      ${field("ID employé",   "employee_id",  "number","","required")}
      ${selectField("Type",   "leave_type",   ["conge","absence","maladie"],"conge")}
      ${field("Du",           "start_date",   "date", today(), "required")}
      ${field("Au",           "end_date",     "date", today(), "required")}
      ${selectField("Statut", "status",       ["instance","approuve","refuse","programme"],"instance")}
      ${textareaField("Motif","reason","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("leaveForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.drh.createLeave(formPayload(e.target,["employee_id"])), "Demande créée");
      closeModal(); renderLeaves();
    });
  };
  window.approveLeave = async id => { await apiCall(() => SGDI.drh.approveLeave(id), "Demande validée"); renderLeaves(); };
  window.refuseLeave  = async id => { await apiCall(() => SGDI.drh.refuseLeave(id),  "Demande refusée"); renderLeaves(); };

  /* ================================================================
     DRH — Sanctions
     ================================================================ */
  async function renderSanctions() {
    const items = await SGDI.drh.sanctions();
    const rows = items.map(s => `<tr>
      <td>${h(s.employee_id)}</td><td>${h(s.infraction_date)}</td>
      <td>${h(s.site_name||"")}</td><td>${h(s.fault)}</td>
      <td>${h(s.sanction_type)}</td><td>${h(s.suspension_days||0)}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Sanctions disciplinaires</h1></div>
        <button class="btn btn-primary" onclick="openSanctionForm()">+ Nouvelle sanction</button>
      </div>
      ${tableEl(["Employé","Date infraction","Site","Faute","Sanction","Jours MAP"], rows)}`, "DRH · Sanctions");
  }
  window.openSanctionForm = function () {
    openModal("Nouvelle sanction", `<form id="sanctionForm" class="form-grid">
      ${field("ID employé",               "employee_id",      "number","","required")}
      ${field("Date infraction",          "infraction_date",  "date", today(), "required")}
      ${field("Site",                     "site_name")}
      ${selectField("Sanction",           "sanction_type",    ["Observation","Avertissement","Mise à pied","Suspension","Licenciement"],"Avertissement")}
      ${field("Nombre jours mise à pied", "suspension_days",  "number","0")}
      ${field("Date début sanction",      "sanction_start",   "date")}
      ${field("Date prochaine prise",     "next_return_date", "date")}
      ${textareaField("Faute reprochée",  "fault","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("sanctionForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.drh.createSanction(formPayload(e.target,["employee_id","suspension_days"])), "Sanction créée");
      closeModal(); renderSanctions();
    });
  };

  /* ================================================================
     OPS — Sites
     ================================================================ */
  async function renderSites() {
    const sites = await SGDI.ops.sites();
    const rows = sites.map(s => `<tr>
      <td><button class="btn btn-sm btn-secondary" onclick="location.hash='/ops/site/${s.id}'">${h(s.name)}</button>
          <div class="muted">${h(s.indicatif||"")}</div></td>
      <td>${h(s.client_name||"")}</td>
      <td>${h(s.wilaya||"")}</td>
      <td>${h(s.rotation_system||"")}</td>
      <td>${h(s.contractual_staff)}</td>
      <td>${badge(s.active?"Actif":"Inactif", s.active?"ok":"bad")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Sites</h1></div>
        <button class="btn btn-primary" onclick="openSiteForm()">+ Nouveau site</button>
      </div>
      ${tableEl(["Site","Client","Wilaya","Rotation","Effectif contractuel","Statut"], rows)}`, "OPS · Sites");
  }
  window.openSiteForm = function () {
    openModal("Nouveau site", `<form id="siteForm" class="form-grid">
      ${field("Dénomination site",      "name",               "text","","required")}
      ${field("Indicatif",              "indicatif")}
      ${field("Client",                 "client_name")}
      ${field("Wilaya",                 "wilaya")}
      ${field("Commune",                "commune")}
      ${field("Type site",              "site_type")}
      ${selectField("Rotation",         "rotation_system",    ["24/48","1/3","1/2","1/1"],"24/48")}
      ${field("Nombre de groupes",      "groups_count",       "number","4")}
      ${field("Effectif contractuel",   "contractual_staff",  "number","0")}
      ${field("Effectif jour",          "day_staff",          "number","0")}
      ${field("Effectif nuit",          "night_staff",        "number","0")}
      ${field("Effectif week-end",      "weekend_staff",      "number","0")}
      ${field("Effectif jours fériés",  "holiday_staff",      "number","0")}
      ${textareaField("Adresse",        "address","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("siteForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.ops.createSite(formPayload(e.target,["groups_count","contractual_staff","day_staff","night_staff","weekend_staff","holiday_staff"])), "Site créé");
      closeModal(); renderSites();
    });
  };

  async function renderSiteDetail(id) {
    const s = await SGDI.ops.site(id);
    const groups = s.by_group || {};
    app.innerHTML = shell(`
      <div class="page-head">
        <div>
          <h1>${h(s.site.name)}</h1>
          <div class="muted">Effectif contractuel ${h(s.contractual_staff)} · Réalisé ${h(s.realized_staff)} · Manque ${h(s.missing_staff)}</div>
        </div>
        <button class="btn btn-ghost" onclick="history.back()">← Retour</button>
      </div>
      <div class="grid grid-4">
        ${["A","B","C","D"].map(g => `
          <div class="card">
            <h2>Groupe ${g}</h2>
            ${simpleList(groups[g]||[], x => `${x.code} · ${x.name} · ${x.position||""}`)}
          </div>`).join("")}
      </div>`, "OPS · Site");
  }

  async function renderSitesSituation() {
    const s = await SGDI.ops.situation();
    app.innerHTML = shell(`
      <div class="page-head"><div><h1>Situation générale des sites</h1></div></div>
      <div class="grid grid-4">
        ${kpi("Sites actifs",         s.active_sites,       "/ops/sites")}
        ${kpi("Sites opérationnels",  s.operational_sites,  "/ops/sites")}
        ${kpi("Effectif contractuel", s.contractual_staff,  "/ops/sites")}
        ${kpi("Manque effectif",      s.missing_staff,      "/ops/sites")}
      </div>
      <div style="margin-top:16px">
        ${tableEl(["Site","Contractuel","Réalisé","Manque"],
          (s.sites||[]).map(r => `<tr>
            <td>${h(r.site.name)}</td>
            <td>${h(r.contractual_staff)}</td>
            <td>${h(r.realized_staff)}</td>
            <td>${badge(r.missing_staff, r.missing_staff?"bad":"ok")}</td>
          </tr>`))}
      </div>`, "OPS · Situation sites");
  }

  /* ================================================================
     OPS — Affectations
     ================================================================ */
  async function ensureReferenceData() {
    const [employees, sites, stores, suppliers, articles] = await Promise.all([
      SGDI.drh.employees().catch(() => []),
      SGDI.ops.sites().catch(() => []),
      SGDI.materiel.stores().catch(() => []),
      SGDI.materiel.suppliers().catch(() => []),
      SGDI.materiel.articles().catch(() => [])
    ]);
    cache = { employees, sites, stores, suppliers, articles };
  }

  async function renderAssignments() {
    await ensureReferenceData();
    const assignments = await SGDI.ops.assignments();
    const rows = assignments.map(a => `<tr>
      <td>${employeeName(a.employee_id)}</td>
      <td>${siteName(a.site_id)}</td>
      <td>${h(a.group_code)}</td>
      <td>${h(a.position||"")}</td>
      <td>${h(a.start_date)}</td>
      <td>${badge(a.active?"Active":"Clôturée", a.active?"ok":"")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Affectations par groupe</h1></div>
        <button class="btn btn-primary" onclick="openAssignmentForm()">+ Nouvelle affectation</button>
      </div>
      ${tableEl(["Employé","Site","Groupe","Poste","Début","Statut"], rows)}`, "OPS · Affectations");
  }
  window.openAssignmentForm = function () {
    openModal("Nouvelle affectation", `<form id="assignmentForm" class="form-grid">
      ${selectField("Employé",    "employee_id",  cache.employees.map(e=>({value:e.id,label:`${e.code} · ${e.last_name} ${e.first_name}`})), "")}
      ${selectField("Site",       "site_id",      cache.sites.map(s=>({value:s.id,label:s.name})), "")}
      ${selectField("Groupe",     "group_code",   ["A","B","C","D"], "A")}
      ${field("Poste",            "position")}
      ${field("Date prise de service","start_date","date",today(),"required")}
      ${textareaField("Motif changement","change_reason","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("assignmentForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.ops.createAssignment(formPayload(e.target,["employee_id","site_id"])), "Affectation créée");
      closeModal(); renderAssignments();
    });
  };

  /* ================================================================
     OPS — Pointage
     ================================================================ */
  async function renderPointage() {
    const date = sessionStorage.getItem("pointage_date") || today();
    const rowsData = await SGDI.ops.daily({ presence_date: date });
    await ensureReferenceData();
    const rows = rowsData.map(p => `<tr>
      <td>${h(p.presence_date)}</td>
      <td>${employeeName(p.employee_id)}</td>
      <td>${siteName(p.site_id)}</td>
      <td>${h(p.group_code||"")}</td>
      <td>${h(p.arrival_time||"")}</td>
      <td>${h(p.departure_time||"")}</td>
      <td>${h(p.relief_time||"")}</td>
      <td>${badge(p.closed_at?"Clôturé":"Ouvert", p.closed_at?"ok":"warn")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Pointage quotidien</h1><div class="muted">Génération automatique depuis les affectations actives.</div></div>
      </div>
      <div class="toolbar">
        <input class="input" style="max-width:180px" type="date" value="${h(date)}"
          onchange="sessionStorage.setItem('pointage_date',this.value);renderRoute()">
        <button class="btn btn-primary"  onclick="generatePointage()">Générer pointage</button>
        <button class="btn btn-secondary" onclick="closePointage()">Clôturer journée</button>
      </div>
      ${tableEl(["Date","Employé","Site","Groupe","Arrivée","Départ","Relève","Statut"], rows)}`, "OPS · Pointage");
  }
  window.generatePointage = async () => {
    const d = sessionStorage.getItem("pointage_date") || today();
    await apiCall(() => SGDI.ops.generateDaily(d), "Pointage généré");
    renderPointage();
  };
  window.closePointage = async () => {
    const d = sessionStorage.getItem("pointage_date") || today();
    await apiCall(() => SGDI.ops.closeDaily(d), "Journée clôturée");
    renderPointage();
  };

  /* ================================================================
     OPS — Main courante
     ================================================================ */
  async function renderEvents() {
    const items = await SGDI.ops.events();
    const rows = items.map(e => `<tr>
      <td>${h(new Date(e.event_date).toLocaleString("fr-FR"))}</td>
      <td>${badge(e.level, e.level==="tres_elevee"?"bad":e.level==="elevee"?"warn":"")}</td>
      <td><strong>${h(e.title)}</strong><div class="muted">${h(e.message)}</div></td>
      <td>${siteName(e.site_id)}</td>
      <td>${badge(e.status, e.status==="clos"?"ok":"warn")}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="closeEvent(${e.id})">Clôturer</button></td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Main courante</h1></div>
        <button class="btn btn-primary" onclick="openEventForm()">+ Nouvel évènement</button>
      </div>
      ${tableEl(["Date","Niveau","Sujet","Site","Statut","Action"], rows)}`, "OPS · Main courante");
  }
  window.openEventForm = async function () {
    await ensureReferenceData();
    openModal("Nouvel évènement", `<form id="eventForm" class="form-grid">
      ${selectField("Type",    "event_type", ["site","autre","incident","instruction"],"autre")}
      ${selectField("Niveau",  "level",      ["normal","elevee","tres_elevee"],"normal")}
      ${field("Sujet",         "title",      "text","","required")}
      ${selectField("Site",    "site_id",    [{value:"",label:"Aucun"}].concat(cache.sites.map(s=>({value:s.id,label:s.name}))),"" )}
      ${textareaField("Message",         "message","","span-2")}
      ${textareaField("Conduite / action","action_taken","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("eventForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.ops.createEvent(formPayload(e.target,["site_id"])), "Évènement créé");
      closeModal(); renderEvents();
    });
  };
  window.closeEvent = async id => {
    await apiCall(() => SGDI.ops.closeEvent(id, "Clôturé depuis frontend"), "Évènement clôturé");
    renderEvents();
  };

  /* ================================================================
     MATÉRIEL — Tableau de bord
     ================================================================ */
  async function renderMaterielDashboard() {
    const mt = await SGDI.materiel.dashboard();
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Matériel & Équipement</h1><div class="muted">Magasins, articles, mouvements et dotations.</div></div>
      </div>
      <div class="grid grid-4">
        ${kpi("Articles",       mt.articles,          "/materiel/articles")}
        ${kpi("Magasins",       mt.stores,            "/materiel/stores")}
        ${kpi("Fournisseurs",   mt.suppliers,         "/materiel/suppliers")}
        ${kpi("Alertes stock",  mt.low_stock_alerts,  "/materiel/inventory")}
      </div>
      <div class="grid grid-3" style="margin-top:16px">
        <button class="card kpi" onclick="location.hash='/materiel/movements'"><div class="kpi-label">Entrées / sorties</div><div class="kpi-value" style="font-size:18px">Mouvements</div></button>
        <button class="card kpi" onclick="location.hash='/materiel/dotations'"><div class="kpi-label">Personnel</div><div class="kpi-value" style="font-size:18px">Dotations</div></button>
        <button class="card kpi" onclick="location.hash='/materiel/reversements'"><div class="kpi-label">Sortants</div><div class="kpi-value" style="font-size:18px">Reversements</div></button>
      </div>`, "Matériel · Tableau de bord");
  }

  /* ================================================================
     MATÉRIEL — Magasins
     ================================================================ */
  async function renderStores() {
    const items = await SGDI.materiel.stores();
    const rows = items.map(s => `<tr>
      <td><strong>${h(s.name)}</strong><div class="muted">${h(s.code||"")}</div></td>
      <td>${h(s.society||"")}</td>
      <td>${h(s.manager_name||"")}</td>
      <td>${h(s.phone||"")}</td>
      <td>${h(s.address||"")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Magasins</h1></div>
        <button class="btn btn-primary" onclick="openStoreForm()">+ Nouveau magasin</button>
      </div>
      ${tableEl(["Magasin","Société","Responsable","Téléphone","Adresse"], rows)}`, "Matériel · Magasins");
  }
  window.openStoreForm = function () {
    openModal("Nouveau magasin", `<form id="storeForm" class="form-grid">
      ${field("Nom",          "name",         "text","","required")}
      ${field("Code",         "code")}
      ${field("Société",      "society")}
      ${field("Responsable",  "manager_name")}
      ${field("Téléphone",    "phone")}
      ${field("Email",        "email",        "email")}
      ${field("Chemin icône", "icon_path")}
      ${textareaField("Adresse","address","","span-2")}
      ${textareaField("Notes", "notes",  "","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("storeForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.materiel.createStore(formPayload(e.target)), "Magasin créé");
      closeModal(); renderStores();
    });
  };

  /* ================================================================
     MATÉRIEL — Fournisseurs
     ================================================================ */
  async function renderSuppliers() {
    const items = await SGDI.materiel.suppliers();
    const rows = items.map(s => `<tr>
      <td><strong>${h(s.name)}</strong><div class="muted">${h(s.contact_name||"")}</div></td>
      <td>${h(s.phone||"")}</td>
      <td>${h(s.email||"")}</td>
      <td>${h(s.nif||"")}</td>
      <td>${h(s.rating||0)}/5</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Fournisseurs</h1></div>
        <button class="btn btn-primary" onclick="openSupplierForm()">+ Nouveau fournisseur</button>
      </div>
      ${tableEl(["Fournisseur","Téléphone","Email","NIF","Note"], rows)}`, "Matériel · Fournisseurs");
  }
  window.openSupplierForm = function () {
    openModal("Nouveau fournisseur", `<form id="supplierForm" class="form-grid">
      ${field("Raison sociale",      "name",         "text","","required")}
      ${field("Contact",             "contact_name")}
      ${field("Téléphone",           "phone")}
      ${field("Email",               "email",        "email")}
      ${field("RC",                  "rc")}
      ${field("NIF",                 "nif")}
      ${field("NIS",                 "nis")}
      ${field("AI",                  "ai")}
      ${field("Note /5",             "rating",       "number","0")}
      ${textareaField("Adresse",     "address","","span-2")}
      ${textareaField("Produits",    "products","","span-2")}
      ${textareaField("Conditions",  "notes","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("supplierForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.materiel.createSupplier(formPayload(e.target,["rating"])), "Fournisseur créé");
      closeModal(); renderSuppliers();
    });
  };

  /* ================================================================
     MATÉRIEL — Articles
     ================================================================ */
  async function renderArticles() {
    await ensureReferenceData();
    const rows = cache.articles.map(a => `<tr>
      <td><strong>${h(a.code)}</strong></td>
      <td>${h(a.designation)}</td>
      <td>${h(a.category||"")}</td>
      <td>${storeName(a.store_id)}</td>
      <td>${qty(a.quantity)} ${h(a.unit)}</td>
      <td>${money(a.unit_price)} DA</td>
      <td>${h([a.size,a.shirt_size,a.pants_size,a.shoe_size].filter(Boolean).join(" / "))}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Articles</h1></div>
        <button class="btn btn-primary" onclick="openArticleForm()">+ Nouvel article</button>
      </div>
      ${tableEl(["Code","Article","Catégorie","Magasin","Stock","P.U.","Tailles"], rows)}`, "Matériel · Articles");
  }
  window.openArticleForm = function () {
    openModal("Nouvel article", `<form id="articleForm" class="form-grid">
      ${field("Code",           "code",         "text","","required")}
      ${field("Désignation",    "designation",  "text","","required")}
      ${field("Catégorie",      "category")}
      ${field("Sous-catégorie", "sub_category")}
      ${field("Société",        "society")}
      ${selectField("Magasin",  "store_id",    [{value:"",label:"Aucun"}].concat(cache.stores.map(s=>({value:s.id,label:s.name}))),"" )}
      ${selectField("Fournisseur","supplier_id",[{value:"",label:"Aucun"}].concat(cache.suppliers.map(s=>({value:s.id,label:s.name}))),"" )}
      ${field("Unité",          "unit",         "text","Pièce")}
      ${field("Quantité",       "quantity",     "number","0")}
      ${field("Prix unitaire",  "unit_price",   "number","0")}
      ${field("Stock minimum",  "min_quantity", "number","0")}
      ${field("Couleur",        "color")}
      ${field("Taille",         "size")}
      ${field("Taille chemise", "shirt_size")}
      ${field("Taille pantalon","pants_size")}
      ${field("Pointure",       "shoe_size")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("articleForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.materiel.createArticle(formPayload(e.target,["store_id","supplier_id","quantity","unit_price","min_quantity"])), "Article créé");
      closeModal(); renderArticles();
    });
  };

  /* ================================================================
     MATÉRIEL — Inventaire
     ================================================================ */
  async function renderInventory() {
    const inv = await SGDI.materiel.inventory();
    const rows = (inv.articles||[]).map(a => `<tr>
      <td>${h(a.code)}</td>
      <td>${h(a.designation)}</td>
      <td>${h(a.category||"")}</td>
      <td>${storeName(a.store_id)}</td>
      <td>${qty(a.quantity)} ${h(a.unit)}</td>
      <td>${badge(a.quantity<=a.min_quantity?"Stock bas":"OK", a.quantity<=a.min_quantity?"bad":"ok")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Inventaire général</h1><div class="muted">${qty(inv.total_quantity)} unité(s) au total.</div></div>
      </div>
      ${tableEl(["Code","Article","Catégorie","Magasin","Quantité","Alerte"], rows)}`, "Matériel · Inventaire");
  }

  /* ================================================================
     MATÉRIEL — Mouvements
     ================================================================ */
  async function renderMovements() {
    await ensureReferenceData();
    const items = await SGDI.materiel.movements();
    const rows = items.map(m => `<tr>
      <td>${h(m.movement_date)}</td>
      <td>${h(m.movement_type)}</td>
      <td>${articleName(m.article_id)}</td>
      <td>${qty(m.quantity)}</td>
      <td>${money(m.unit_price)} DA</td>
      <td>${employeeName(m.employee_id)||h(m.recipient||"")}</td>
      <td>${h(m.reason||"")}</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Mouvements stock</h1></div>
        <button class="btn btn-primary" onclick="openMovementForm()">+ Nouveau mouvement</button>
      </div>
      ${tableEl(["Date","Type","Article","Qté","P.U.","Bénéficiaire","Motif"], rows)}`, "Matériel · Mouvements");
  }
  window.openMovementForm = function () {
    openModal("Nouveau mouvement", `<form id="movementForm" class="form-grid">
      ${selectField("Article",        "article_id",   cache.articles.map(a=>({value:a.id,label:`${a.code} · ${a.designation}`})),"" )}
      ${field("Date",                 "movement_date","date",today())}
      ${selectField("Type",           "movement_type",["entree","achat","sortie","nouvelle_dotation","renouvellement_dotation","dotation_pret_mission","retour_employe","reformer","perte","casse"],"entree")}
      ${field("Quantité",             "quantity",     "number","1")}
      ${field("Prix unitaire",        "unit_price",   "number","0")}
      ${selectField("Magasin",        "store_id",    [{value:"",label:"Aucun"}].concat(cache.stores.map(s=>({value:s.id,label:s.name}))),"" )}
      ${selectField("Fournisseur",    "supplier_id", [{value:"",label:"Aucun"}].concat(cache.suppliers.map(s=>({value:s.id,label:s.name}))),"" )}
      ${selectField("Employé bénéficiaire","employee_id",[{value:"",label:"Aucun"}].concat(cache.employees.map(e=>({value:e.id,label:`${e.code} · ${e.last_name} ${e.first_name}`}))),"" )}
      ${field("N° bon",               "voucher_number")}
      ${textareaField("Motif",        "reason","","span-2")}
      ${textareaField("Motif renouvellement","renewal_reason","","span-2")}
      <div class="span-2"><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
    document.getElementById("movementForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.materiel.createMovement(formPayload(e.target,["article_id","quantity","unit_price","store_id","supplier_id","employee_id"])), "Mouvement créé");
      closeModal(); renderMovements();
    });
  };

  /* ================================================================
     MATÉRIEL — Dotations
     ================================================================ */
  async function renderDotations() {
    await ensureReferenceData();
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Dotation employé</h1><div class="muted">La dotation est automatiquement reportée sur la fiche de position via l'API.</div></div>
        <button class="btn btn-primary" onclick="openDotationForm()">+ Nouvelle dotation</button>
      </div>
      <div class="card">
        <h2>Mode de fonctionnement</h2>
        <p class="muted">Choisissez l'employé et l'article. Le backend crée le mouvement de sortie et la ligne de dotation employé.</p>
      </div>`, "Matériel · Dotations");
  }
  window.openDotationForm = function () {
    openModal("Nouvelle dotation", `<form id="dotationForm" class="form-grid">
      ${selectField("Employé",  "employee_id",    cache.employees.map(e=>({value:e.id,label:`${e.code} · ${e.last_name} ${e.first_name}`})),"" )}
      ${selectField("Article",  "article_id",     cache.articles.map(a=>({value:a.id,label:`${a.code} · ${a.designation}`})),"" )}
      ${field("Quantité",       "quantity",       "number","1")}
      ${field("Date dotation",  "dotation_date",  "date",today())}
      ${field("N° bon",         "voucher_number")}
      ${selectField("Motif",    "dotation_reason",["Nouvelle dotation","Renouvellement de dotation","Dotation à titre de prêt (mission)"],"Nouvelle dotation")}
      <div class="span-2"><button class="btn btn-primary">Doter</button></div>
    </form>`);
    document.getElementById("dotationForm").addEventListener("submit", async e => {
      e.preventDefault();
      await apiCall(() => SGDI.materiel.createDotation(formPayload(e.target,["employee_id","article_id","quantity"])), "Dotation créée");
      closeModal(); renderDotations();
    });
  };

  /* ================================================================
     MATÉRIEL — Reversements
     ================================================================ */
  async function renderReversements() {
    const rowsData = await SGDI.materiel.reversements();
    const rows = rowsData.map(r => `<tr>
      <td>${h(r.code)}</td>
      <td>${h(r.name)}</td>
      <td>${h(r.articles_count)}</td>
      <td>${money(r.total_value)} DA</td>
    </tr>`);
    app.innerHTML = shell(`
      <div class="page-head">
        <div><h1>Équipement en instance de reversement</h1><div class="muted">Employés sortants avec dotation non reversée.</div></div>
      </div>
      ${tableEl(["Code","Employé","Articles","Valeur"], rows)}`, "Matériel · Reversements");
  }

  /* ================================================================
     Helpers lookup
     ================================================================ */
  function employeeName(id) {
    const e = cache.employees.find(x => Number(x.id) === Number(id));
    return e ? `${h(e.code)} · ${h(e.last_name)} ${h(e.first_name)}` : id ? `Employé ${h(id)}` : "";
  }
  function siteName(id) {
    const s = cache.sites.find(x => Number(x.id) === Number(id));
    return s ? h(s.name) : id ? `Site ${h(id)}` : "";
  }
  function storeName(id) {
    const s = cache.stores.find(x => Number(x.id) === Number(id));
    return s ? h(s.name) : id ? `Magasin ${h(id)}` : "";
  }
  function articleName(id) {
    const a = cache.articles.find(x => Number(x.id) === Number(id));
    return a ? `${h(a.code)} · ${h(a.designation)}` : id ? `Article ${h(id)}` : "";
  }

  /* ================================================================
     ROUTER
     ================================================================ */
  async function renderRoute() {
    if (!SGDI.token() || currentPath() === "/login") {
      renderLogin();
      return;
    }
    try {
      const path = currentPath();
      if (path === "/" || path === "/dashboard")          return renderDashboard();
      if (path === "/drh/employees")                      return renderEmployees();
      if (path.startsWith("/drh/fiche/"))                 return renderFiche(path.split("/").pop());
      if (path === "/drh/candidates")                     return renderCandidates();
      if (path === "/drh/contracts")                      return renderContracts();
      if (path === "/drh/leaves")                         return renderLeaves();
      if (path === "/drh/sanctions")                      return renderSanctions();
      if (path === "/ops/sites")                          return renderSites();
      if (path.startsWith("/ops/site/"))                  return renderSiteDetail(path.split("/").pop());
      if (path === "/ops/situation")                      return renderSitesSituation();
      if (path === "/ops/assignments")                    return renderAssignments();
      if (path === "/ops/pointage")                       return renderPointage();
      if (path === "/ops/events")                         return renderEvents();
      if (path === "/materiel/dashboard")                 return renderMaterielDashboard();
      if (path === "/materiel/stores")                    return renderStores();
      if (path === "/materiel/suppliers")                 return renderSuppliers();
      if (path === "/materiel/articles")                  return renderArticles();
      if (path === "/materiel/inventory")                 return renderInventory();
      if (path === "/materiel/movements")                 return renderMovements();
      if (path === "/materiel/dotations")                 return renderDotations();
      if (path === "/materiel/reversements")              return renderReversements();
      setPath("/dashboard");
    } catch (e) {
      if (/Token|401|403|Unauthorized/i.test(e.message || "")) {
        SGDI.logout();
        renderLogin();
      } else {
        app.innerHTML = shell(`
          <div class="card">
            <h1>Erreur</h1>
            <p class="muted">${h(e.message || e)}</p>
            <button class="btn btn-secondary" style="margin-top:12px" onclick="renderRoute()">Réessayer</button>
          </div>`, "Erreur");
      }
    }
  }

  window.renderRoute = renderRoute;
  window.addEventListener("hashchange", renderRoute);
  if (!location.hash) location.hash = SGDI.token() ? "#/dashboard" : "#/login";
  renderRoute();
})();
