/* Administration user-forms : fonctions historiques, règles inchangées. */
function adminRoleGuide(){return[
  ["agent","Consultation","Accès simple aux modules et périmètres autorisés"],
  ["dispatch","Supervision terrain","Suivi opérationnel, sites, pointage et missions autorisées"],
  ["ops","Gestion métier","Exploitation OPS/DRH selon profil et périmètre"],
  ["ADM","Administration","Configuration système, utilisateurs, profils et sécurité"]
]}

function adminRoleDescription(role){const r=adminRoleGuide().find(x=>x[0]===String(role||""));return r?r[1]+" — "+r[2]:"Profil utilisateur SGDI"}

function adminUserByUsername(username){
  const key=String(username||"").trim();
  return (db.users||[]).find(x=>String(x.username||"")===key)||(db.users||[]).find(x=>String(x.username||"").toLowerCase()===key.toLowerCase());
}

function openAdminUserModalByKey(encodedUsername){
  openAdminUserModal(decodeURIComponent(String(encodedUsername||"")));
}

function adminUserFromApi(u){
  const cached=userPermissionCache()[u.username]||{};
  return {
    backendId:u.id||u.backendId||null,
    username:u.username,
    email:u.email||"",
    nom:u.full_name||u.nom||u.username,
    role:u.role||"agent",
    niveau:u.access_level||u.niveau||"",
    actif:u.is_active!==false,
    sitesAutorises:Array.isArray(u.authorized_sites)?u.authorized_sites.map(Number):(Array.isArray(u.sitesAutorises)?u.sitesAutorises:[]),
    societesAutorisees:Array.isArray(u.authorized_societies)?u.authorized_societies:(Array.isArray(u.societesAutorisees)?u.societesAutorisees:[]),
    structuresAutorisees:normalizeStructureList(Array.isArray(u.authorized_structures)?u.authorized_structures:u.structuresAutorisees),
    actionsAutorisees:Array.isArray(u.authorized_actions)?u.authorized_actions:(Array.isArray(u.actionsAutorisees)?u.actionsAutorisees:[]),
    modulesAutorises:Array.isArray(u.authorized_modules)?u.authorized_modules:(Array.isArray(u.modulesAutorises)?u.modulesAutorises:null),
    validationCodeEnabled:!!(cached.validationCodeEnabled??u.validationCodeEnabled),
    hasValidationPassword:!!u.has_validation_password,
    supervisorReadOnly:u.supervisor_read_only!==false
  };
}

function adminUsernamePrefixForStructure(structure){
  const k=normalizeStructureKey(structure);
  return ({drh:"DRH",ops:"OPS",superviseur:"SUP",materiel:"MAT",facturation:"FIN",facmod:"FAC",commercial:"COM",secretariat:"SEC",agenda:"AGD",pointage:"PTG",portail:"PRH",admin:"ADM"}[k])||"ATL";
}

function adminUsernamePrefixFromForm(form){
  if(!form)return"ATL";
  const role=normalizeAdminUserRole(form.role?.value||"agent");
  const niveau=String(form.niveau?.value||"").toUpperCase();
  const structures=[...form.querySelectorAll('input[name^="struct_"]:checked')].map(el=>normalizeStructureKey(el.value)).filter(Boolean);
  if(role==="ADM")return niveau==="H5"&&structures.includes("admin")?"ADG":"ADM";
  if(structures.length===1)return adminUsernamePrefixForStructure(structures[0]);
  if(role==="dispatch"||role==="ops")return"ATL";
  return structures.length?adminUsernamePrefixForStructure(structures[0]):"ATL";
}

function adminNextUsername(prefix){
  const p=String(prefix||"ATL").toUpperCase();
  const nums=(db.users||[]).map(u=>String(u.username||"").toUpperCase()).map(name=>{
    const m=name.match(new RegExp("^"+p+"(\\d+)$"));
    return m?parseInt(m[1],10):0;
  }).filter(Boolean);
  return p+String((nums.length?Math.max(...nums):0)+1).padStart(2,"0");
}

function adminSuggestUsernameForForm(force){
  const form=document.querySelector(".modal-bg form");
  if(!form)return;
  const input=form.querySelector('[name="username"]');
  if(!input||input.readOnly)return;
  const current=String(input.value||"").trim().toUpperCase();
  const generatedLike=/^(ADG|ADM|ATL|DRH|OPS|SUP|MAT|FIN|FAC|COM|SEC|AGD|PTG|PRH)\d+$/.test(current);
  if(!force&&current&&!generatedLike)return;
  input.value=adminNextUsername(adminUsernamePrefixFromForm(form));
}

function adminPasswordFieldHTML(name,label,isNew,isDefined){
  const id="admin-user-"+name;
  const hint=isNew?"":isDefined?"Mot de passe déjà défini — laissez vide pour le conserver.":"Aucun mot de passe de validation défini.";
  return `<div><label class="label" for="${id}">${label}${isNew?" *":""}</label><div style="display:flex;gap:6px;align-items:center"><input id="${id}" class="input" type="password" name="${name}" autocomplete="new-password" placeholder="${isNew?"Saisir un mot de passe":isDefined?"Inchangé":"Définir un mot de passe"}" aria-describedby="${id}-hint"/><button type="button" class="btn btn-secondary" aria-controls="${id}" aria-label="Afficher le ${label.toLowerCase()}" aria-pressed="false" data-password-label="${label.toLowerCase()}" onclick="adminTogglePasswordVisibility(this)"><span aria-hidden="true">👁</span></button></div><small id="${id}-hint" class="text-slate-500">${hint}</small></div>`;
}
function adminTogglePasswordVisibility(button){
  const input=document.getElementById(button.getAttribute("aria-controls"));if(!input)return;
  const visible=input.type==="password";
  input.type=visible?"text":"password";
  button.setAttribute("aria-pressed",String(visible));
  button.setAttribute("aria-label",`${visible?"Masquer":"Afficher"} le ${button.dataset.passwordLabel}`);
  button.title=button.getAttribute("aria-label");
}
async function openAdminUserModal(username){
  const current=adminCaptureView(document.getElementById("view"),document.getElementById("modal-host"));
  username=String(username||"").trim();
  // Le périmètre "sites autorisés" doit couvrir TOUTES les sociétés, pas seulement
  // celles déjà chargées en cache local (db.sites ne contient que ce qui a été
  // parcouru jusqu'ici côté "Sites"). On recharge la liste complète avant d'ouvrir.
  try{
    sgdiShowDataLoadingBar("Chargement des sites...");
    const rows=await SGDI.sites.list({});
    if(!current())return;
    (Array.isArray(rows)?rows:[]).map(siteFromApi).forEach(s=>sgdiUpsertServerItem("sites",s));
  }catch(e){if(current())console.warn("Liste complète des sites indisponible pour le périmètre sites",e);}
  finally{if(current()&&typeof sgdiHideDataLoadingBar==="function")sgdiHideDataLoadingBar();}
  if(!current())return;
  const isNew=!username;
  const selectedSoc=adminActiveSociete();
  const u=isNew?{username:"",email:"",password:"",validationPassword:"",nom:"",role:"agent",niveau:"H1",sitesAutorises:[],societesAutorisees:selectedSoc?[selectedSoc]:[],structuresAutorisees:[],actionsAutorisees:[],modulesAutorises:[],actif:true,validationCodeEnabled:false}:adminUserByUsername(username);
  if(!u){toast("Utilisateur introuvable","error");return}
  const niv=ensureNiveauxAcces();
  const selectedRole=normalizeAdminUserRole(u.role);
  const selectedNiveau=u.niveau||(selectedRole==="ADM"?"H5":selectedRole==="ops"?"H3":selectedRole==="dispatch"?"H2":"H1");
  openModal(`<h3 class="font-bold text-lg mb-4">${isNew?"➕ Nouvel utilisateur":"✏ Modifier "+escapeHTML(u.username)}</h3>
    <form data-no-critical-auth="1" onsubmit="event.preventDefault();confirmAdminUserByKey('${encodeURIComponent(u.username||"")}')">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Identifiant *</label><div class="flex gap-2"><input class="input" name="username" value="${escapeHTML(u.username)}" ${isNew?"":"readonly"}/>${isNew?`<button type="button" class="btn btn-secondary text-xs" onclick="adminSuggestUsernameForForm(true)">Générer</button>`:""}</div><div class="text-[11px] text-slate-500 mt-1">Convention : DRH01, OPS01, SUP01, ATL01, ADM01, ADG01.</div></div>
        <div><label class="label">Email personnel de l'utilisateur *</label><input class="input" type="email" name="email" value="${escapeHTML(u.email||"")}" placeholder="utilisateur@exemple.com" required/></div>
        ${adminPasswordFieldHTML("password","Mot de passe de connexion",isNew,!isNew)}
        ${adminPasswordFieldHTML("validationPassword","Mot de passe de validation",isNew,!!u.hasValidationPassword)}
        <div><label class="label">Nom complet *</label><input class="input" name="nom"  value="${escapeHTML(u.nom||"")}"/></div>
        <div><label class="label">Type de compte *</label><select class="input" name="role" onchange="syncUserAccessLevelWithRole(this.value);document.getElementById('user-role-preview').textContent=adminRoleDescription(this.value);adminSuggestUsernameForForm(false)">${ADMIN_USER_ROLES.map(r=>`<option value="${r}" ${selectedRole===r?"selected":""}>${escapeHTML(adminRoleDisplayLabel(r))} · ${escapeHTML(adminRoleGuide().find(x=>x[0]===r)?.[1]||'Profil')}</option>`).join("")}</select><div id="user-role-preview" class="text-[11px] text-slate-500 mt-1">${escapeHTML(adminRoleDescription(selectedRole))}</div></div>
        <div><label class="label">Profil d'accès *</label><select class="input" name="niveau" onchange="previewUserAccessLevel(this.value);adminSuggestUsernameForForm(false)">${niv.map(n=>`<option value="${n.code}" ${selectedNiveau===n.code?"selected":""}>${escapeHTML(n.label)}</option>`).join("")}</select><div id="user-level-preview" class="text-[11px] text-slate-500 mt-1"></div></div>
        <div><label class="label">Statut</label><select class="input" name="actif"><option value="true" ${u.actif!==false?"selected":""}>Actif</option><option value="false" ${u.actif===false?"selected":""}>Désactivé</option></select></div>
        <label class="flex items-center gap-2 p-3 rounded-lg text-sm font-bold" style="border:1px solid #dbeafe;background:#eff6ff"><input type="checkbox" name="validationCodeEnabled" ${u.validationCodeEnabled?"checked":""}/> Habilité au code de validation journalier</label>
        <label class="flex items-center gap-2 p-3 rounded-lg text-sm font-bold" style="border:1px solid #fecaca;background:#fef2f2"><input type="checkbox" name="peutReactiverSortant" ${u.peutReactiverSortant?"checked":""}/> Peut réactiver un employé SORTANT</label>
      </div>
      <div class="admin-access-separator"></div>
      <label class="label">Modules accessibles avec cet identifiant et ce mot de passe *</label>
      <p class="text-xs text-slate-500 mb-2">Cochez chaque application autorisée. L'utilisateur conservera la même identité de connexion sur tous ces sous-domaines.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2">${ADMIN_LOGIN_MODULES.map(m=>`<label class="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-white"><input type="checkbox" name="module_${m.key}" value="${m.key}" ${(u.modulesAutorises||[]).includes(m.key)?"checked":""}/><span><b class="block text-sm">${escapeHTML(m.label)}</b><small class="text-slate-500">${escapeHTML(m.host)}</small></span></label>`).join("")}</div>
      <label class="label mt-3">Périmètre sociétés (vide = toutes)</label>
      <div class="admin-access-societies">${SOCIETES.map(s=>`<label><input type="checkbox" name="soc_${s.replace(/[^a-z]/gi,"")}" value="${escapeHTML(s)}" ${u.societesAutorisees&&u.societesAutorisees.includes(s)?"checked":""}/><span>${escapeHTML(s)}</span></label>`).join("")}</div>
      <div class="admin-access-separator"></div>
      <label class="label">Périmètre structures (vide = toutes)</label>
      <div class="admin-access-primary">${ADMIN_PRIMARY_STRUCTURES.map(st=>adminAccessCheckboxHTML(st,u)).join("")}</div>
      <div class="admin-access-separator"></div>
      <div class="admin-access-functions">
        <div>${ADMIN_FUNCTION_ACCESS.slice(0,6).map(st=>adminAccessCheckboxHTML(st,u)).join("")}</div>
        <div>${ADMIN_FUNCTION_ACCESS.slice(6).map(st=>adminAccessCheckboxHTML(st,u)).join("")}</div>
      </div>
      <div class="admin-access-separator"></div>
      <label class="label">Actions individuelles</label>
      <p class="text-xs text-slate-500 mb-2">Aucune case cochée : héritage du profil. Dès qu'une action est cochée, cette sélection devient la règle effective de l'utilisateur.</p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">${ADMIN_LEVEL_ACTIONS.map(action=>`<label class="flex items-center gap-2 p-2 rounded border border-slate-200 bg-white text-sm"><input type="checkbox" name="action_${action.key}" value="${action.key}" ${(u.actionsAutorisees||[]).includes(action.key)?"checked":""}/><span>${escapeHTML(action.label)}</span></label>`).join("")}</div>
      <label class="label mt-3">Périmètre sites (vide = tous)</label>
      <div style="max-height:320px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px">${(()=>{
        const seen=new Set();
        const sites=(db.sites||[]).filter(s=>{const k=String(s.backendId||s.id||"");if(!k||seen.has(k))return false;seen.add(k);return s.actif!==false;});
        if(!sites.length)return `<div class="text-sm text-slate-500">Aucun site chargé.</div>`;
        const groups=new Map();
        sites.forEach(s=>{
          const soc=sitePrimarySociete(s)||"Sans société";
          if(!groups.has(soc))groups.set(soc,[]);
          groups.get(soc).push(s);
        });
        const socNames=[...groups.keys()].sort((a,b)=>a.localeCompare(b));
        return socNames.map(soc=>{
          const list=groups.get(soc).sort((a,b)=>String(a.nom||a.intitule||"").localeCompare(String(b.nom||b.intitule||"")));
          return `<div class="mb-3">
            <div class="text-xs font-black uppercase text-slate-500 mb-1 px-1">${escapeHTML(soc)} <span class="text-slate-400 font-normal normal-case">(${list.length} site${list.length>1?"s":""})</span></div>
            <table class="w-full text-sm" style="border-collapse:collapse"><tbody>${list.map(s=>{const sid=String(s.backendId||s.id||"");const checked=(u.sitesAutorises||[]).map(v=>String(v||"")).includes(sid);return`<tr><td style="width:28px;border-bottom:1px solid #f1f5f9"><input type="checkbox" name="site_${sid}" value="${sid}" ${checked?"checked":""}/></td><td style="border-bottom:1px solid #f1f5f9;padding:3px 6px">${escapeHTML(s.nom||s.intitule||"Site #"+sid)}</td></tr>`}).join("")}</tbody></table>
          </div>`;
        }).join("");
      })()}</div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
  setTimeout(()=>{previewUserAccessLevel(selectedNiveau);if(isNew)adminSuggestUsernameForForm(false)},0);
}

function adminAccessCheckboxHTML(st,user){
  const selected=normalizeStructureList(user&&user.structuresAutorisees).includes(st.key);
  return `<label><input type="checkbox" name="struct_${st.key}" value="${escapeHTML(st.key)}" ${selected?"checked":""} onchange="adminSuggestUsernameForForm(false)"/><span>${escapeHTML(st.label)}</span></label>`;
}

function previewUserAccessLevel(code){
  const n=ensureNiveauxAcces().find(x=>x.code===code);
  const box=document.getElementById("user-level-preview");
  if(!box||!n)return;
  box.innerHTML=`<span class="pill" style="background:${n.color}22;color:${n.color};font-weight:700">${escapeHTML(n.label)}</span> <span>${escapeHTML(n.description||"")}</span>`;
}

function syncUserAccessLevelWithRole(role){
  const sel=document.querySelector('.modal-bg [name="niveau"]');
  if(!sel)return;
  const r=normalizeAdminUserRole(role);
  const wanted=r==="ADM"?"H5":r==="ops"?"H3":r==="dispatch"?"H2":"H1";
  if([...sel.options].some(o=>o.value===wanted))sel.value=wanted;
  previewUserAccessLevel(sel.value);
}

async function confirmAdminUser(originalUsername){
  const f=document.querySelector(".modal-bg form");if(!f){toast("Formulaire introuvable","error");return}
  if(isAdminSystemSession()&&!(await ensureAdminSystemApiToken("enregistrer un utilisateur"))){if(window._sgdiSaveOverlayShown)closeSaveOverlay();return}
  const fd=new FormData(f);
  const rawUsername=String(fd.get("username")||"").trim();
  const username=originalUsername?rawUsername:rawUsername.toUpperCase();
  const password=String(fd.get("password")||"");
  const validationPassword=String(fd.get("validationPassword")||"");
  const data={username,email:String(fd.get("email")||"").trim().toLowerCase(),nom:String(fd.get("nom")||"").trim(),role:fd.get("role"),niveau:fd.get("niveau"),actif:fd.get("actif")==="true",validationCodeEnabled:fd.get("validationCodeEnabled")==="on",peutReactiverSortant:fd.get("peutReactiverSortant")==="on",societesAutorisees:SOCIETES.filter(s=>fd.get("soc_"+s.replace(/[^a-z]/gi,""))===s),structuresAutorisees:ADMIN_STRUCTURES.filter(st=>fd.get("struct_"+st.key)===st.key).map(st=>st.key),actionsAutorisees:ADMIN_LEVEL_ACTIONS.filter(action=>fd.get("action_"+action.key)===action.key).map(action=>action.key),modulesAutorises:ADMIN_LOGIN_MODULES.filter(m=>fd.get("module_"+m.key)===m.key).map(m=>m.key),sitesAutorises:(db.sites||[]).filter(s=>{const sid=String(s.backendId||s.id||"");return s.actif!==false&&fd.get("site_"+sid)===sid}).map(s=>String(s.backendId||s.id||"")).filter(Boolean)};
  const usernameInput=f.querySelector('[name="username"]');
  const nomInput=f.querySelector('[name="nom"]');
  [usernameInput,nomInput].forEach(el=>{if(el)el.style.background=""});
  if(username.length<3){if(usernameInput)usernameInput.style.background="#fee2e2";toast("Identifiant obligatoire : minimum 3 caractères","error");return}
  if(!data.nom){if(nomInput)nomInput.style.background="#fee2e2";toast("Nom complet obligatoire","error");return}
  if(!data.email||!f.querySelector('[name="email"]')?.checkValidity()){toast("Une adresse email valide et propre à cet utilisateur est obligatoire","error");return}
  if((db.users||[]).some(user=>String(user.email||"").toLowerCase()===data.email&&String(user.username||"").toLowerCase()!==String(originalUsername||"").toLowerCase())){toast("Cette adresse email est déjà attribuée à un autre utilisateur","error");return}
  if(!ensureNiveauxAcces().some(n=>n.code===data.niveau)){toast("Niveau d'accès obligatoire","error");return}
  if(normalizeAdminUserRole(data.role)!=="ADM"&&!data.modulesAutorises.length){toast("Sélectionnez au moins un module accessible","error");return}
  if(!originalUsername){
    if(db.users.find(x=>x.username===username)){toast("Identifiant déjà utilisé","error");return}
    if(!password){toast("Mot de passe requis","error");return}
    if(!validationPassword){toast("Mot de passe de validation requis","error");return}
    let savedUser=null;
    try{
      savedUser=await SGDI.auth.createUser({username,email:data.email,full_name:data.nom||username,role:data.role,access_level:data.niveau,authorized_societies:data.societesAutorisees,authorized_structures:data.structuresAutorisees,authorized_sites:data.sitesAutorises,authorized_actions:data.actionsAutorisees,authorized_modules:data.modulesAutorises,password,validation_password:validationPassword});
      if(!savedUser||!savedUser.username)throw new Error("Confirmation PostgreSQL invalide");
    }catch(e){
      const msg=String(e.message||e||"");
      toast("Création PostgreSQL refusée : "+(/at least 3 characters/i.test(msg)?"l'identifiant doit contenir au moins 3 caractères":msg),"error");
      return;
    }
    const backendUser={...adminUserFromApi(savedUser),email:data.email,validationCodeEnabled:data.validationCodeEnabled};
    db.users=(db.users||[]).filter(x=>String(x.username||"").toLowerCase()!==backendUser.username.toLowerCase());
    db.users.push(backendUser);
    if(savedUser.credentials_email_sent)toast("Identifiants envoyés à "+data.email,"success");else toast("Compte créé, mais l'email n'a pas pu être envoyé : "+(savedUser.credentials_email_error||"SMTP indisponible"),"warning");
    logActivity("Création utilisateur",username);
  }else{
    const existing=adminUserByUsername(originalUsername);
    const idx=existing?db.users.findIndex(x=>x.username===existing.username):-1;if(idx<0){toast("Utilisateur introuvable","error");return}
    originalUsername=existing.username;
    try{
      const payload={email:data.email,full_name:data.nom||username,role:data.role,access_level:data.niveau,authorized_societies:data.societesAutorisees,authorized_structures:data.structuresAutorisees,authorized_sites:data.sitesAutorises,authorized_actions:data.actionsAutorisees,authorized_modules:data.modulesAutorises,is_active:data.actif};
      if(password)payload.password=password;
      if(validationPassword)payload.validation_password=validationPassword;
      await SGDI.auth.updateUser(originalUsername,payload);
    }catch(e){
      const msg=String(e.message||e||"");
      if(/not found|introuvable|404/i.test(msg)){
        try{
          if(!password){toast("Mot de passe obligatoire pour recréer l'utilisateur côté backend","error");return}
          if(!validationPassword){toast("Mot de passe de validation obligatoire pour recréer l'utilisateur côté backend","error");return}
          await SGDI.auth.createUser({username,email:data.email,full_name:data.nom||username,role:data.role,access_level:data.niveau,authorized_societies:data.societesAutorisees,authorized_structures:data.structuresAutorisees,authorized_sites:data.sitesAutorises,authorized_actions:data.actionsAutorisees,authorized_modules:data.modulesAutorises,password,validation_password:validationPassword});
          toast("Utilisateur recréé dans PostgreSQL","warning");
        }catch(createErr){
          const createMsg=String(createErr.message||createErr||"");
          if(/déjà existant|deja existant|already/i.test(createMsg)){
            toast("Utilisateur déjà présent dans PostgreSQL : modification locale appliquée.","warning");
          }else{
            toast("Modification PostgreSQL refusée : "+createMsg,"error");
            return;
          }
        }
      }else{
        toast("Modification PostgreSQL refusée : "+msg,"error");
        return;
      }
    }
    db.users[idx]=Object.assign({},db.users[idx],data,password?{password}:{});
    logActivity("Modification utilisateur",username);
  }
  const savedForScope=adminUserByUsername(username);
  if(savedForScope&&(String(savedForScope.username||"").toUpperCase().startsWith("SUP")||normalizeStructureList(savedForScope.structuresAutorisees).includes("superviseur")||String(savedForScope.niveau||"").toUpperCase()==="SUP_TERRAIN")){
    if(!Array.isArray(db.supervisorScopes))db.supervisorScopes=[];
    const item=adminSupervisorBuildScope(savedForScope);
    const scopeIdx=db.supervisorScopes.findIndex(x=>String(x.username||"").toLowerCase()===String(item.username||"").toLowerCase());
    if(scopeIdx>=0)db.supervisorScopes[scopeIdx]=item;else db.supervisorScopes.push(item);
  }
  rememberUserPermissions(username,data.societesAutorisees,data.niveau,data.structuresAutorisees,data.validationCodeEnabled);
  if(session&&session.username===username){session={...session,role:data.role,niveau:data.niveau,nom:data.nom,structuresAutorisees:data.structuresAutorisees,societesAutorisees:data.societesAutorisees,sitesAutorises:data.sitesAutorises,actionsAutorisees:data.actionsAutorisees};saveSession(session)}
  try{await sgdiLoadAuthState()}catch(e){toast("Utilisateur enregistré, rechargement liste impossible : "+(e.message||e),"warning")}
  saveDB();closeModal();toastCenter("Données enregistrées","success");render();
}

function confirmAdminUserByKey(encodedUsername){
  return confirmAdminUser(decodeURIComponent(String(encodedUsername||"")));
}

function adminProfileModuleLabel(key){
  const item=ADMIN_PROFILE_MODULES.find(x=>x.key===key);
  return item?item.label:adminAccessModuleLabel(key);
}

function adminModuleRoute(module){return({"DRH":"drh/dashboard","OPS":"ops/dashboard","SUPERVISEUR":"superviseur/dashboard","MATERIEL/EQUIP":"materiel/dashboard","FINANCES/COMPTA":"facturation/dashboard","PAIE":"paie/dashboard","COMMERCIAL":"commercial/dashboard","SECRETARIAT GÉNÉRAL":"secretariat/dashboard","AGENDA":"agenda/dashboard","POINTAGE":"pointage/dashboard","PORTAIL RH":"portail","ADMINISTRATEUR GÉNÉRAL":"admin/dashboard","ADMINISTRATION SYSTEME":"admin/dashboard",dashboard:"dashboard",dossiers:"dossiers",recrutement:"recrutement",reserve:"reserve",candidats_archives:"candidats_archives","drh/social":"drh/social",demandes_personnel:"demandes_personnel/dashboard",demandes_structure:"demandes_structure/dashboard",contrats:"contrats/situation",a_contractualiser:"contrats/a_contractualiser",effectif:"effectif",agents:"agents",fiches:"fiches",badge:"badge",sites:"sites/actifs",incidents:"incidents/site",conges:"conges",paie:"paie/dashboard",rapports:"rapports",materiel:"materiel/dashboard","materiel/articles":"materiel/articles","materiel/magasins":"materiel/magasins","materiel/fournisseurs":"materiel/fournisseurs","materiel/dotation":"materiel/dotation","materiel/sites-dotation":"materiel/sites-dotation","materiel/reversement":"materiel/reversement",facturation:"facturation/dashboard","facturation/factures":"facturation/factures","facturation/paiements":"facturation/paiements","facturation/avances":"facturation/avances","facturation/avoirs":"facturation/avoirs","facturation/caisse":"facturation/caisse","facturation/situation":"facturation/situation",commercial:"commercial/dashboard","commercial/devis":"commercial/devis",secretariat:"secretariat/dashboard","secretariat/courriers":"secretariat/courriers","secretariat/parapheur":"secretariat/parapheur","secretariat/missions":"secretariat/missions","secretariat/agenda":"secretariat/agenda","secretariat/reunions":"secretariat/reunions","secretariat/decisions":"secretariat/decisions","secretariat/documents":"secretariat/documents","secretariat/messagerie":"secretariat/messagerie","secretariat/archives":"secretariat/archives","secretariat/historique":"secretariat/historique",agenda:"agenda/dashboard","agenda/liste":"agenda/liste","agenda/semaine":"agenda/semaine","agenda/rappels":"agenda/rappels","commercial/prospects":"commercial/prospects","commercial/clients":"commercial/clients","commercial/opportunites":"commercial/opportunites","commercial/visites":"commercial/visites","commercial/catalogue":"commercial/catalogue","commercial/tarifs":"commercial/tarifs","commercial/stats":"commercial/stats",pointage:"pointage/dashboard","pointage/recap":"pointage/recap","pointage/societe":"pointage/societe","pointage/stats":"pointage/stats","pointage/legende":"pointage/legende",superviseur:"superviseur/dashboard","superviseur/dashboard":"superviseur/dashboard",ops:"ops/dashboard","ops/missions":"ops/missions","ops/mouvements":"ops/mouvements","ops/supervision":"ops/supervision",portail:"portail",parametres:"parametres",admin:"admin/dashboard"}[module]||module)}

function adminAccessModuleLabel(module){
  const labels={
    "DRH":"DRH","OPS":"OPS","SUPERVISEUR":"Superviseur terrain","MATERIEL/EQUIP":"Matériel / équipement","FINANCES/COMPTA":"Finances / comptabilité","PAIE":"Paie","COMMERCIAL":"Commercial","SECRETARIAT GÉNÉRAL":"Secrétariat général","AGENDA":"Agenda","POINTAGE":"Pointage","PORTAIL RH":"Portail RH","ADMINISTRATEUR GÉNÉRAL":"Administrateur général",
    dashboard:"Tableau de bord",dossiers:"Dossiers",recrutement:"Recrutement",reserve:"Réserve",candidats_archives:"Candidats archivés","drh/social":"Social DRH",demandes_personnel:"Demandes personnel",demandes_structure:"Demandes structure",
    contrats:"Contrats",a_contractualiser:"Contrats à établir",effectif:"Effectifs",agents:"Agents",fiches:"Fiches de position",badge:"Badges",sites:"Sites",incidents:"Incidents",conges:"Congés",paie:"Paie",rapports:"Rapports",
    materiel:"Tableau de bord matériel","materiel/articles":"Articles","materiel/magasins":"Magasins","materiel/fournisseurs":"Fournisseurs","materiel/alertes":"Alertes stock","materiel/dotation":"Dotation employés","materiel/sites-dotation":"Dotation sites","materiel/reversement":"Reversement",
    facturation:"Tableau de bord finances","commercial/devis":"Devis","facturation/factures":"Factures","facturation/paiements":"Paiements","facturation/avances":"Avances","facturation/avoirs":"Avoirs","facturation/caisse":"Caisse","facturation/situation":"Situation client",
    commercial:"Tableau de bord commercial","commercial/prospects":"Prospects","commercial/clients":"Clients","commercial/opportunites":"Opportunités","commercial/visites":"Visites","commercial/catalogue":"Catalogue","commercial/tarifs":"Tarifs","commercial/stats":"Statistiques commerciales",
    secretariat:"Tableau de bord secrétariat","secretariat/courriers":"Courrier","secretariat/parapheur":"Parapheur","secretariat/missions":"Ordres de mission","secretariat/agenda":"Agenda SG","secretariat/reunions":"Réunions et PV","secretariat/decisions":"Décisions","secretariat/documents":"Documents officiels","secretariat/messagerie":"Messagerie","secretariat/archives":"Archives","secretariat/historique":"Historique",
    agenda:"Tableau de bord agenda","agenda/liste":"Liste agenda","agenda/semaine":"Vue semaine","agenda/rappels":"Rappels",
    pointage:"Tableau de bord pointage","pointage/recap":"Récapitulatif","pointage/societe":"Récap société","pointage/stats":"Statistiques pointage","pointage/legende":"Légende et codes",
    superviseur:"Tableau de bord superviseur","superviseur/dashboard":"Tableau de bord superviseur",
    ops:"Tableau de bord OPS","ops/missions":"Missions","ops/mouvements":"Mouvements","ops/supervision":"Supervision site",portail:"Portail RH",parametres:"Paramètres",admin:"Administration système"
  };
  if(labels[module])return labels[module];
  return String(module||"").replace(/[\/_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function adminAccessModuleGroup(module){
  const m=String(module||"");
  if(["DRH","OPS","SUPERVISEUR","MATERIEL/EQUIP","FINANCES/COMPTA","PAIE","COMMERCIAL","SECRETARIAT GÉNÉRAL","AGENDA","POINTAGE","PORTAIL RH","ADMINISTRATEUR GÉNÉRAL"].includes(m))return"Module principal";
  if(m.startsWith("materiel"))return"Matériel";
  if(m.startsWith("facturation"))return"Finances";
  if(m.startsWith("commercial"))return"Commercial";
  if(m.startsWith("secretariat"))return"Secrétariat";
  if(m.startsWith("agenda"))return"Agenda";
  if(m.startsWith("pointage"))return"Pointage";
  if(m.startsWith("superviseur"))return"Superviseur";
  if(m.startsWith("ops"))return"OPS";
  if(["dashboard","dossiers","recrutement","reserve","candidats_archives","drh/social","demandes_personnel","demandes_structure","contrats","a_contractualiser","effectif","agents","fiches","badge","sites","incidents","conges","paie","rapports","portail","parametres","admin"].includes(m))return"DRH / système";
  return"Module";
}

function normalizeAdminUserRole(role){const b=adminAccessBaseRole(role);if(b==="admin")return"ADM";if(b==="dispatch")return"dispatch";if(b==="ops"||b==="rh")return"ops";return"agent"}

function adminSupervisorUsers(){
  return (db.users||[]).filter(u=>{
    const username=String(u.username||"").toUpperCase();
    const structs=normalizeStructureList(u.structuresAutorisees||u.authorized_structures);
    return username.startsWith("SUP")||structs.includes("superviseur")||String(u.niveau||"").toUpperCase()==="SUP_TERRAIN";
  }).sort((a,b)=>String(a.username||"").localeCompare(String(b.username||"")));
}

function adminSupervisorSiteScopeFromUser(user){
  const values=(Array.isArray(user?.sitesAutorises)?user.sitesAutorises:Array.isArray(user?.authorized_sites)?user.authorized_sites:[]).map(v=>String(v||"")).filter(Boolean);
  const ids=new Set(values);
  const names=new Set(values.map(v=>normalizedSearchText(v)).filter(Boolean));
  const sites=(db.sites||[]).filter(site=>{
    if(site.actif===false||site.active===0)return false;
    const siteIds=[site.id,site.backendId].map(v=>String(v||"")).filter(Boolean);
    const siteNames=[site.nom,site.intitule].map(v=>normalizedSearchText(v||"")).filter(Boolean);
    const ok=siteIds.some(id=>ids.has(id))||siteNames.some(name=>names.has(name));
    if(ok){siteIds.forEach(id=>ids.add(id));siteNames.forEach(name=>names.add(name))}
    return ok;
  });
  return {ids,names,sites};
}
SGDIModules.registerModule({key:"administration-user-forms",routes:[]});
