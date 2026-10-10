/* Administration système — Terminaux de reconnaissance faciale.
   SEUL endroit où un équipement facial est enregistré, appairé (une seule fois, à
   l'installation), remplacé, révoqué, et où les comptes Pointeur sont autorisés à l'utiliser.
   Réutilise les routes existantes de /api/biometrics (aucun second système) :
   - terminaux mobiles autonomes (page /borne) : création, code d'association à usage unique,
     rotation de clé pour un remplacement de matériel, révocation ;
   - caméras IP lues par le serveur : déjà enregistrées ; ici, état et comptes autorisés.
   Le serveur reste seul autoritaire : périmètre Société/Site de chaque compte, refus par défaut.
   Aucune clé, aucun identifiant de connexion ni adresse d'équipement n'est jamais reçu ici. */

let adminFacialState={items:[],kpi:{},categories:[],error:"",loaded:false};
const ADMIN_FACIAL_TYPES=[["TABLET_ANDROID","Tablette Android"],["SMARTPHONE_ANDROID","Smartphone Android"],["IPAD","iPad"],["IPHONE","iPhone"]];
const ADMIN_FACIAL_PILLS={ACTIVE:"pill-green",INACTIVE:"pill-gray",OFFLINE:"pill-amber",UNKNOWN:"pill-gray",REVOKED:"pill-red"};

function adminFacialWhen(value){
  if(!value)return "—";
  const d=new Date(value);if(isNaN(d))return "—";
  return d.toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function adminFacialDevice(key){return adminFacialState.items.find(item=>item.key===key)||null}
async function adminFacialCall(method,path,body){
  const res=await agentRemoteCall(method,"/biometrics"+path,body);
  if(!res.ok)throw new Error(res.message||("Erreur "+res.status));
  return res.data;
}

async function renderAdminFacialTerminals(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6">Accès réservé Administration système</div>`;return}
  const current=adminCaptureView(view);
  if(!adminFacialState.loaded)view.innerHTML=`<div class="card p-6 text-slate-500">Chargement des terminaux…</div>`;
  try{
    const data=await adminFacialCall("GET","/facial-devices");
    if(!current())return;
    adminFacialState={items:data.items||[],kpi:data.kpi||{},categories:data.categories||[],error:"",loaded:true};
  }catch(e){
    if(!current())return;
    adminFacialState={...adminFacialState,error:e.message||"Liste indisponible",loaded:true};
  }
  view.innerHTML=adminFacialHTML();
}

function adminFacialHTML(){
  const s=adminFacialState,kpi=s.kpi||{};
  const rows=s.items.map(item=>{
    const users=item.users||[];
    const terminal=item.kind==="TERMINAL",revoked=item.status==="REVOKED";
    const pairing=terminal?(item.paired?`Appairé le ${escapeHTML(adminFacialWhen(item.paired_at))}`:(item.pairing_pending?"Code d'association en attente":"Non appairé")):`Enregistrée le ${escapeHTML(adminFacialWhen(item.paired_at))}`;
    const actions=[
      revoked?"":`<button class="btn btn-ghost text-xs" data-facial-users="${escapeHTML(item.key)}" onclick="openAdminFacialUsers('${escapeHTML(item.key)}')">👥 Utilisateurs autorisés</button>`,
      terminal&&!revoked?`<button class="btn btn-ghost text-xs" data-facial-pair="${escapeHTML(item.key)}" onclick="adminFacialPair('${escapeHTML(item.key)}')">${item.paired?"🔁 Remplacer le matériel":"🔗 Appairer"}</button>`:"",
      terminal&&!revoked&&item.paired?`<button class="btn btn-ghost text-xs" data-facial-toggle="${escapeHTML(item.key)}" onclick="adminFacialToggle('${escapeHTML(item.key)}')">${item.facial_attendance_enabled?"Couper le pointage facial":"Autoriser le pointage facial"}</button>`:"",
      terminal&&!revoked?`<button class="btn btn-ghost text-xs text-red-600" data-facial-revoke="${escapeHTML(item.key)}" onclick="adminFacialRevoke('${escapeHTML(item.key)}')">⛔ Révoquer</button>`:"",
      terminal?`<button class="btn btn-ghost text-xs text-red-600" data-facial-delete="${escapeHTML(item.key)}" onclick="adminFacialDelete('${escapeHTML(item.key)}')">🗑 Supprimer</button>`:"",
    ].join("");
    return `<tr class="border-t" data-facial-row="${escapeHTML(item.key)}">
      <td class="p-3"><div class="font-black">${escapeHTML(item.name||"")}</div><div class="text-xs text-slate-500">${escapeHTML(item.key)} · ${escapeHTML(item.hardware||"")}</div></td>
      <td class="p-3">${escapeHTML(item.society||"")}</td>
      <td class="p-3">${escapeHTML(item.site||"")}</td>
      <td class="p-3 text-xs">${escapeHTML(item.equipment||"—")}<div class="text-slate-500">${item.remote_activation?"Activée depuis le poste Pointeur":"Autonome — surveillance seulement"}</div></td>
      <td class="p-3"><span class="pill ${ADMIN_FACIAL_PILLS[item.status]||"pill-gray"}">${escapeHTML(item.status_label||item.status||"")}</span>${revoked&&item.revoked_reason?`<div class="text-xs text-slate-500">${escapeHTML(item.revoked_reason)}</div>`:""}${!revoked&&!item.facial_attendance_enabled?`<div class="text-xs text-slate-500">Pointage facial coupé</div>`:""}${terminal&&!revoked&&item.paired&&item.connection&&item.connection!=="ONLINE"?`<div class="text-xs text-slate-500">${escapeHTML(item.connection_label||"")}${item.connection==="SILENT"?" — borne à recharger pour le suivi de connexion":""}</div>`:""}</td>
      <td class="p-3 text-xs">${pairing}</td>
      <td class="p-3 text-xs">${escapeHTML(adminFacialWhen(item.last_communication))}</td>
      <td class="p-3 text-xs"><span class="pill pill-blue">${users.length} compte${users.length>1?"s":""}</span><div class="text-slate-500">${users.map(u=>escapeHTML(u.username)).join(", ")}</div></td>
      <td class="p-3"><div class="flex flex-wrap gap-1">${actions}</div></td></tr>`;
  }).join("");
  const categories=(s.categories||[]).map(c=>`<li><span class="pill ${c.supported?"pill-green":"pill-gray"}">${c.supported?"Pris en charge":"Non pris en charge"}</span> ${escapeHTML(c.label)}${c.supported?(c.remote_activation?" — activée depuis le poste Pointeur":" — fonctionne seule, le Pointeur la surveille"):""}</li>`).join("");
  return `<div class="card p-5" id="admin-facial-terminals">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div><h2 class="text-xl font-black">Terminaux de reconnaissance faciale</h2>
        <p class="text-sm text-slate-600">Enregistrement, appairage (une seule fois, à l'installation), remplacement, révocation et comptes autorisés. Aucun appairage n'est possible depuis Pointeur.</p></div>
      <div class="flex flex-wrap gap-2"><button class="btn btn-secondary" onclick="renderView()">↻ Actualiser</button><button class="btn btn-primary" id="admin-facial-add" onclick="openAdminFacialCreate()">➕ Enregistrer un terminal</button></div>
    </div>
    <div class="flex flex-wrap gap-2 mb-3" id="admin-facial-kpi">
      <span class="pill pill-green">${Number(kpi.active||0)} actif(s)</span><span class="pill pill-gray">${Number(kpi.inactive||0)} inactif(s)</span>
      <span class="pill pill-amber">${Number(kpi.offline||0)} hors ligne</span><span class="pill pill-gray">${Number(kpi.unknown||0)} sans signal</span><span class="pill pill-red">${Number(kpi.revoked||0)} révoqué(s)</span>
    </div>
    ${s.error?`<div class="p-3 mb-3 text-red-700" role="alert">${escapeHTML(s.error)}</div>`:""}
    <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-xs text-slate-500">
      <th class="p-3">Terminal</th><th class="p-3">Société</th><th class="p-3">Site</th><th class="p-3">Équipement</th><th class="p-3">État</th><th class="p-3">Appairage</th><th class="p-3">Dernière communication</th><th class="p-3">Utilisateurs autorisés</th><th class="p-3">Actions</th>
    </tr></thead><tbody>${rows||`<tr><td colspan="9" class="p-6 text-center text-slate-500">${s.error?"":"Aucun terminal enregistré."}</td></tr>`}</tbody></table></div>
    <div class="mt-4 text-xs text-slate-600"><div class="font-black mb-1">Matériel pris en charge pour le pointage facial</div><ul class="space-y-1">${categories}</ul>
      <p class="mt-2">Les caméras IP sont déclarées (modèle, adresse, identifiants chiffrés) dans Gestion du pointage → Caméras, par un compte Administration système.</p></div>
  </div>`;
}

// Sites proposés : ceux que le serveur autorise à ce compte, avec leur société (un terminal
// appartient à la société de son site).
async function openAdminFacialCreate(){
  let sites=[];
  try{const res=await agentRemoteCall("GET","/portal/attendance-sites");if(res.ok&&Array.isArray(res.data))sites=res.data}catch(e){sites=[]}
  if(!sites.length){toast("Aucun site disponible","error");return}
  openModal(`<form id="admin-facial-form" onsubmit="event.preventDefault();adminFacialCreate()">
    <h3 class="text-lg font-black mb-3">Enregistrer un terminal</h3>
    <label class="block text-xs font-bold mb-1" for="af-name">Nom du terminal</label><input class="input mb-3" id="af-name" required minlength="2" maxlength="80">
    <label class="block text-xs font-bold mb-1" for="af-type">Type de matériel</label><select class="select mb-3" id="af-type">${ADMIN_FACIAL_TYPES.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select>
    <label class="block text-xs font-bold mb-1" for="af-site">Site de rattachement (la société est celle du site)</label><select class="select mb-3" id="af-site" required><option value="">— Choisir —</option>${sites.map(s=>`<option value="${Number(s.id)}">${escapeHTML(s.name||"")}${s.society?" — "+escapeHTML(s.society):""}</option>`).join("")}</select>
    <label class="block text-xs font-bold mb-1" for="af-loc">Emplacement / équipement associé</label><input class="input mb-4" id="af-loc" maxlength="120">
    <div class="flex justify-end gap-2"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>`);
}
async function adminFacialCreate(){
  const value=id=>String(document.getElementById(id)?.value||"").trim();
  const siteId=Number(value("af-site"));
  if(!value("af-name")||!siteId){toast("Nom et site obligatoires","error");return}
  try{
    const term=await adminFacialCall("POST","/terminals",{name:value("af-name"),terminal_type:value("af-type"),site_id:siteId,location:value("af-loc")||null});
    closeModal();toast("Terminal enregistré — générez le code d'association","success");
    await renderView();adminFacialPair("trm:"+term.id,true);
  }catch(e){toast(e.message,"error")}
}

// Appairage : code à usage unique saisi UNE fois sur l'appareil (page /borne). La clé privée est
// créée sur l'appareil et n'en sort jamais. Sur un terminal déjà appairé : remplacement du
// matériel (l'ancienne clé reste valable jusqu'à l'association du nouvel appareil).
async function adminFacialPair(key,fresh){
  const item=adminFacialDevice(key);
  if(item&&item.paired&&!fresh&&!confirm("Remplacer le matériel de « "+item.name+" » ?\nLa clé actuelle restera valable jusqu'à l'association du nouvel appareil. Les utilisateurs autorisés sont conservés."))return;
  try{
    const out=await adminFacialCall("POST","/terminals/"+encodeURIComponent(key.split(":")[1])+"/pairing-code");
    openModal(`<h3 class="text-lg font-black mb-2">Code d'association</h3>
      <p class="text-sm text-slate-600 mb-3">À saisir une seule fois sur l'appareil, page <b>/borne</b> de pointeur.irongs.com. Valable ${Math.round((out.expires_in||600)/60)} minutes, utilisable une fois.</p>
      <div class="text-3xl font-black tracking-widest text-center my-4" id="admin-facial-code">${escapeHTML(out.code||"")}</div>
      <div id="admin-facial-qr" class="flex justify-center mb-3"></div>
      <p class="text-xs text-slate-500 mb-4">Une fois l'appareil associé, aucun nouvel appairage n'est demandé — ni à la connexion du Pointeur, ni à l'activation.</p>
      <div class="flex justify-end"><button class="btn btn-primary" onclick="closeModal();renderView()">Fermer</button></div>`);
    // QR facultatif (même lien que le code) si la bibliothèque est chargée ; jamais conservé.
    const qr=document.getElementById("admin-facial-qr");
    if(qr&&window.QRCode&&out.pair_path){
      const origin=/\.irongs\.com$/.test(location.hostname)?"https://pointeur.irongs.com":location.origin;
      new window.QRCode(qr,{text:origin+out.pair_path,width:180,height:180,correctLevel:window.QRCode.CorrectLevel.M});
    }
  }catch(e){toast(e.message,"error")}
}
async function adminFacialToggle(key){
  const item=adminFacialDevice(key);if(!item)return;
  const on=!item.facial_attendance_enabled;
  if(on&&!confirm("Autoriser le pointage facial RÉEL sur « "+item.name+" » ?"))return;
  try{await adminFacialCall("PATCH","/terminals/"+encodeURIComponent(key.split(":")[1]),{facial_attendance_enabled:on});toast(on?"Pointage facial autorisé":"Pointage facial coupé","success");renderView()}
  catch(e){toast(e.message,"error")}
}
async function adminFacialRevoke(key){
  const item=adminFacialDevice(key);if(!item)return;
  const reason=String(prompt("Révocation DÉFINITIVE de « "+item.name+" » (effet immédiat).\nMotif (3 caractères minimum) :")||"").trim();
  if(reason.length<3){if(reason)toast("Motif trop court","error");return}
  try{await adminFacialCall("POST","/terminals/"+encodeURIComponent(key.split(":")[1])+"/revoke",{reason});toast("Terminal révoqué","success");renderView()}
  catch(e){toast(e.message,"error")}
}

// Suppression : retrait opérationnel définitif ; l'historique et les preuves de pointage sont
// conservés côté serveur. Le nom redevient disponible sur le site.
async function adminFacialDelete(key){
  const item=adminFacialDevice(key);if(!item)return;
  const reason=prompt("Supprimer « "+item.name+" » ? Il disparaîtra de la liste et ne pourra plus pointer ; son historique est conservé.\nMotif (facultatif) :");
  if(reason===null)return;
  try{await adminFacialCall("DELETE","/terminals/"+encodeURIComponent(key.split(":")[1]),{reason:String(reason).trim()||null});toast("Terminal supprimé — historique conservé","success");renderView()}
  catch(e){toast(e.message,"error")}
}

// Comptes autorisés : seuls les comptes dont le périmètre Société/Site couvre l'équipement sont
// proposés (liste calculée par le serveur) ; il revalide tout à l'enregistrement.
async function openAdminFacialUsers(key){
  const item=adminFacialDevice(key);if(!item)return;
  let eligible;
  try{eligible=await adminFacialCall("GET","/facial-devices/users?key="+encodeURIComponent(key))}catch(e){toast(e.message,"error");return}
  const granted=new Set((item.users||[]).map(u=>u.id));
  const boxes=eligible.map(u=>`<label class="flex items-center gap-2 py-1"><input type="checkbox" class="admin-facial-user" value="${Number(u.id)}" ${granted.has(u.id)?"checked":""}><span><b>${escapeHTML(u.username)}</b> <span class="text-slate-500">${escapeHTML(u.full_name||"")}</span></span></label>`).join("");
  openModal(`<h3 class="text-lg font-black mb-1">Utilisateurs autorisés — ${escapeHTML(item.name)}</h3>
    <p class="text-sm text-slate-600 mb-3">${escapeHTML(item.site||"")} · ${escapeHTML(item.society||"")}. Seuls les comptes Pointage dont le périmètre couvre ce site sont proposés.</p>
    <div class="max-h-72 overflow-y-auto mb-4" id="admin-facial-users">${boxes||`<p class="text-slate-500">Aucun compte Pointage n'a ce site dans son périmètre.</p>`}</div>
    <div class="flex justify-end gap-2"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" id="admin-facial-users-save" onclick="adminFacialSaveUsers('${escapeHTML(key)}')">Enregistrer</button></div>`);
}
async function adminFacialSaveUsers(key){
  const ids=[...document.querySelectorAll(".admin-facial-user:checked")].map(box=>Number(box.value));
  try{await adminFacialCall("POST","/facial-devices/authorizations",{key,user_ids:ids});closeModal();toast("Autorisations enregistrées","success");renderView()}
  catch(e){toast(e.message,"error")}
}

SGDIModules.registerModule({key:"administration-facial-terminals",routes:[]});
