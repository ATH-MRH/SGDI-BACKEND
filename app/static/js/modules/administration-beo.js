/* Administration système — Bureau des Effectifs Ouest (BEO).
   Identité fonctionnelle/UI d'ATLAS Site Workforce (portail beo.irongs.com, rôle backend
   CHARGE_EFFECTIFS_SITE). La clé RBAC réellement persistée reste EXCLUSIVEMENT
   "site_workforce" (ADMIN_LOGIN_MODULES, voir sgdi-app.js) — ce fichier ne crée ni
   deuxième catalogue ni deuxième clé : il affiche/édite le même authorized_modules que le
   reste d'Administration, filtré sur cette seule clé, et réutilise sitesAutorises/
   societesAutorisees/actionsAutorisees déjà en place sur chaque compte. Le backend
   (resolve_scoped_site) reste seul autoritaire sur la règle "exactement un site" — cette
   vue ne fait qu'en refléter honnêtement l'état, jamais ne la contourne.
*/

function beoUsers(){
  return (db.users||[]).filter(u=>Array.isArray(u.modulesAutorises)&&u.modulesAutorises.includes("site_workforce"));
}

// Même pont "société d'un site" que le backend (app/modules/site_workforce/security.py::
// _site_society, lui-même copié de ops/routes.py) : Site n'a pas de colonne société propre,
// elle vit dans equipment_plan (JSON). db.sites doit avoir été chargé au moins une fois
// (Administration -> Sites, ou le formulaire Utilisateur qui recharge la liste complète).
function beoSiteById(siteId){
  const sid=String(siteId||"");
  return (db.sites||[]).find(s=>String(s.backendId||s.id||"")===sid)||null;
}
function beoSiteSociete(site){
  if(!site)return null;
  const plan=site.equipmentPlan||site.equipment_plan||{};
  const legacy=(plan&&typeof plan==="object"&&plan._legacy)||{};
  return plan.societe||plan.society||legacy.societe||legacy.society||null;
}
function beoSiteLabel(siteId){
  const s=beoSiteById(siteId);
  return s?(s.nom||s.intitule||("Site #"+siteId)):("Site #"+siteId+" (introuvable)");
}

// Reflète honnêtement resolve_scoped_site() côté backend (§7/§10) — jamais une seconde
// règle divergente : mêmes conditions, mêmes causes affichées.
function beoConfigState(u){
  const sites=Array.isArray(u.sitesAutorises)?u.sitesAutorises:[];
  const societes=Array.isArray(u.societesAutorisees)?u.societesAutorisees:[];
  if(u.actif===false)return{state:"inactive",label:"COMPTE INACTIF",reason:"Compte inactif",tone:"#64748b"};
  if(sites.length===0)return{state:"incomplete",label:"CONFIGURATION INCOMPLÈTE",reason:"Aucun site affecté",tone:"#d97706"};
  if(sites.length>1)return{state:"invalid",label:"PÉRIMÈTRE INVALIDE",reason:"Plusieurs sites affectés ("+sites.length+")",tone:"#dc2626"};
  if(societes.length===0)return{state:"incomplete",label:"CONFIGURATION INCOMPLÈTE",reason:"Aucune société autorisée",tone:"#d97706"};
  if(societes.length>1)return{state:"invalid",label:"PÉRIMÈTRE INVALIDE",reason:"Plusieurs sociétés autorisées ("+societes.length+")",tone:"#dc2626"};
  const site=beoSiteById(sites[0]);
  const siteSoc=beoSiteSociete(site);
  if(site&&siteSoc&&!societes.some(s=>String(s).trim()===String(siteSoc).trim())){
    return{state:"invalid",label:"PÉRIMÈTRE INVALIDE",reason:"Le site affecté n'appartient à aucune société autorisée du compte",tone:"#dc2626"};
  }
  return{state:"ok",label:"CONFIGURÉ",reason:"",tone:"#16a34a"};
}

// Libellés réels (ADMIN_LEVEL_ACTIONS) des actions accordées. Liste vide = aucune restriction
// individuelle : le backend (_require_action) laisse alors passer toute action du profil.
function beoActionLabels(u){
  const actions=Array.isArray(u&&u.actionsAutorisees)?u.actionsAutorisees:[];
  return actions.map(a=>{const def=(typeof ADMIN_LEVEL_ACTIONS!=="undefined"?ADMIN_LEVEL_ACTIONS:[]).find(x=>x.key===a);return def?def.label:a});
}
function beoOtherModules(u){
  return (Array.isArray(u&&u.modulesAutorises)?u.modulesAutorises:[]).filter(m=>m!=="site_workforce");
}
// Comptes existants pouvant recevoir l'accès BEO : jamais les comptes Administration
// (ADM), dont les droits se gèrent ailleurs, et jamais un compte qui l'a déjà.
function beoCandidateUsers(){
  return (db.users||[]).filter(u=>normalizeAdminUserRole(u.role)!=="ADM"&&!(Array.isArray(u.modulesAutorises)&&u.modulesAutorises.includes("site_workforce")))
    .sort((a,b)=>String(a.username||"").localeCompare(String(b.username||"")));
}
// Ajoute ou retire UNIQUEMENT la clé site_workforce — le reste de la liste est conservé tel quel.
function beoModulesWithAccess(modules,grant){
  const rest=(Array.isArray(modules)?modules:[]).filter(m=>m!=="site_workforce");
  return grant?[...rest,"site_workforce"]:rest;
}

function renderAdminBeo(view){
  const rows=beoUsers();
  const configured=rows.filter(u=>beoConfigState(u).state==="ok").length;
  const siteIds=new Set();
  rows.forEach(u=>(u.sitesAutorises||[]).forEach(s=>siteIds.add(String(s))));
  const candidates=beoCandidateUsers();
  view.innerHTML=`<div class="mb-5">
      <div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div>
      <h1 class="text-3xl font-black mt-1">🏢 Bureau des Effectifs Ouest</h1>
      <p class="text-sm text-slate-500 mt-1">Code <b>BEO</b> · Module <code>site_workforce</code> — Gestion opérationnelle des effectifs limitée aux sites affectés.</p>
      <div class="flex items-center gap-3 mt-2 text-sm">
        <span class="pill pill-blue">beo.irongs.com</span>
        <a class="btn btn-ghost text-xs" href="https://beo.irongs.com" target="_blank" rel="noopener">↗ Ouvrir le portail</a>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
      <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Utilisateurs BEO</div><div class="text-3xl font-black text-slate-900">${rows.length}</div></div>
      <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Configurés</div><div class="text-3xl font-black text-emerald-700">${configured}</div></div>
      <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Sites couverts</div><div class="text-3xl font-black text-blue-700">${siteIds.size}</div></div>
      <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Statut</div><div class="text-lg font-black text-slate-900 mt-1">Actif</div></div>
    </div>
    <div class="card p-4 mb-4 text-sm text-slate-600">
      <b class="text-slate-900">Configuration type d'un chargé des effectifs (ex. CE01)</b> —
      Type de compte « Chargé des effectifs (BEO) », module <code>site_workforce</code> seul,
      <b>une</b> société cochée explicitement, <b>un seul</b> site autorisé,
      actions Consulter / Créer / Modifier / Valider. Aucun accès DRH, OPS, Finance ou autre module sauf décision explicite.
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2 mb-3">
      <select id="beo-add-existing" class="input" style="max-width:320px">
        <option value="">Ajouter un utilisateur existant…</option>
        ${candidates.map(u=>`<option value="${escapeHTML(u.username)}">${escapeHTML(u.username)}${u.nom?" — "+escapeHTML(u.nom):""}</option>`).join("")}
      </select>
      <button class="btn btn-secondary" onclick="adminAddBeoAccess(document.getElementById('beo-add-existing').value)">Accorder l'accès BEO</button>
      <button class="btn btn-primary" onclick="openAdminBeoUserModal()">➕ Nouvel utilisateur BEO</button>
    </div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr>
        <th class="text-left p-3">Identifiant</th><th class="text-left p-3">Nom</th><th class="text-left p-3">Statut</th>
        <th class="text-left p-3">Profil</th><th class="text-left p-3">Société</th><th class="text-left p-3">Site autorisé</th>
        <th class="text-left p-3">Actions autorisées</th><th class="text-left p-3">Autres modules</th><th class="text-left p-3">Configuration</th><th class="text-left p-3">Actions</th>
      </tr></thead>
      <tbody>${rows.map(u=>{
        const cfg=beoConfigState(u);
        const sites=Array.isArray(u.sitesAutorises)?u.sitesAutorises:[];
        const socs=Array.isArray(u.societesAutorisees)?u.societesAutorisees:[];
        const actions=beoActionLabels(u);
        const others=beoOtherModules(u);
        return`<tr class="border-t">
          <td class="p-3 font-mono font-bold">${escapeHTML(u.username)}</td>
          <td class="p-3">${escapeHTML(u.nom||"")}</td>
          <td class="p-3">${u.actif!==false?'<span class="pill pill-green">Actif</span>':'<span class="pill pill-gray">Suspendu</span>'}</td>
          <td class="p-3 text-xs">${escapeHTML(adminRoleDisplayLabel(normalizeAdminUserRole(u.role)))}</td>
          <td class="p-3 text-xs">${socs.length?escapeHTML(socs.join(", ")):'<span class="text-red-600">Aucune</span>'}</td>
          <td class="p-3 text-xs">${sites.length===1?escapeHTML(beoSiteLabel(sites[0])):(sites.length===0?'<span class="text-amber-600">Aucun</span>':'<span class="text-red-600">'+sites.length+' sites</span>')}</td>
          <td class="p-3 text-xs">${actions.length?actions.map(a=>`<span class="pill pill-gray mr-1">${escapeHTML(a)}</span>`).join(""):'<span class="text-slate-400">Héritage profil (aucune restriction)</span>'}</td>
          <td class="p-3 text-xs">${others.length?`<span class="text-amber-700">${escapeHTML(others.join(", "))}</span>`:'<span class="text-slate-400">Aucun</span>'}</td>
          <td class="p-3"><span class="pill" style="background:${cfg.tone}22;color:${cfg.tone};font-weight:900">${cfg.label}</span>${cfg.reason?`<div class="text-[11px] text-slate-500 mt-1">${escapeHTML(cfg.reason)}</div>`:""}</td>
          <td class="p-3 whitespace-nowrap">
            <button class="btn btn-ghost text-xs" onclick="openAdminUserModalByKey('${encodeURIComponent(u.username)}')">✏ Périmètre & actions</button>
            <button class="btn btn-ghost text-xs text-red-600" onclick="adminRemoveBeoAccess('${encodeURIComponent(u.username)}')">Retirer BEO</button>
          </td>
        </tr>`;
      }).join("")||`<tr><td colspan="10" class="p-6 text-center text-slate-400">Aucun utilisateur n'a le module site_workforce.</td></tr>`}</tbody>
    </table></div>`;
}

// §4/§14 : accorder ou retirer l'accès BEO ne touche QUE la clé site_workforce — jamais le
// compte lui-même (aucune suppression), jamais les autres modules. Le backend reste seul
// juge (PATCH /api/auth/users est réservé aux administrateurs) ; on refuse en plus, côté
// interface, qu'un administrateur modifie son propre accès depuis cet écran.
async function adminSetBeoAccess(username,grant){
  username=String(username||"").trim();
  if(!username){toast("Sélectionnez un utilisateur","error");return false}
  const u=adminUserByUsername(username);
  if(!u){toast("Utilisateur introuvable","error");return false}
  if(String(u.username).toLowerCase()===String(session?.username||"").toLowerCase()){toast("Vous ne pouvez pas modifier votre propre accès BEO.","error");return false}
  const msg=grant
    ?`Accorder l'accès Bureau des Effectifs Ouest (site_workforce) à ${u.username} ?\n\nSes autres modules ne sont pas modifiés. Pensez ensuite à définir sa société et son site.`
    :`Retirer l'accès Bureau des Effectifs Ouest (site_workforce) à ${u.username} ?\n\nLe compte et ses autres modules ne sont pas modifiés.`;
  if(!confirm(msg))return false;
  const next=beoModulesWithAccess(u.modulesAutorises,grant);
  try{
    await SGDI.auth.updateUser(u.username,{authorized_modules:next});
    u.modulesAutorises=next;
    logActivity(grant?"Octroi accès BEO (site_workforce)":"Retrait accès BEO (site_workforce)",u.username);
    saveDB();toast(grant?"Accès BEO accordé":"Accès BEO retiré","success");renderView();
    return true;
  }catch(e){toast("Modification refusée : "+(e.message||e),"error");return false}
}
function adminAddBeoAccess(username){return adminSetBeoAccess(username,true)}
function adminRemoveBeoAccess(encodedUsername){return adminSetBeoAccess(decodeURIComponent(String(encodedUsername||"")),false)}

SGDIModules.registerModule({key:"administration-beo",routes:[]});
