/* Administration système — Gestion des équipements.
   SEUL endroit où un équipement (terminal mobile, caméra IP) est enregistré, appairé (une seule
   fois, à l'installation), remplacé, révoqué, et affecté aux comptes Pointeur.
   Réutilise les registres et routes existants de /api/biometrics (aucun second système) :
   - terminaux mobiles autonomes (page /borne) : création, modification, code d'association à
     usage unique, rotation de clé pour un remplacement de matériel, révocation, suppression ;
   - caméras IP lues par le serveur : déclarées dans Gestion du pointage → Caméras ; ici, état,
     fiche, historique et comptes affectés.
   Une affectation donne seulement l'usage de l'équipement depuis le poste Pointeur : aucun droit
   biométrique, aucun accès société, aucune activation faciale. Le serveur reste seul
   autoritaire (périmètre Société/Site de chaque compte, refus par défaut, tout ou rien).
   Aucune clé, aucun identifiant de connexion ni adresse d'équipement n'est jamais reçu ici. */

let adminFacialState={items:[],dashboard:{},filters:{},categories:[],error:"",loaded:false};
let adminEquipFilter={tab:"",society:"",site:"",type:"",state:"",user:""};
const adminEquipSelected=new Set();
const ADMIN_FACIAL_TYPES=[["TABLET_ANDROID","Tablette Android"],["SMARTPHONE_ANDROID","Smartphone Android"],["IPAD","iPad"],["IPHONE","iPhone"]];
const ADMIN_FACIAL_PILLS={ACTIVE:"pill-green",INACTIVE:"pill-gray",OFFLINE:"pill-amber",UNKNOWN:"pill-gray",REVOKED:"pill-red"};
const ADMIN_EQUIP_MODAL_STYLE=`<style>#modal-host .modal:has(.admin-equip-modal){max-width:min(760px,calc(100vw - 16px))!important}#modal-host #admin-equip-confirm:disabled{background:#e2e8f0!important;border-color:#cbd5e1!important;color:#64748b!important;opacity:1!important;cursor:not-allowed!important;box-shadow:none!important}</style>`;
const ADMIN_EQUIP_AVAIL={ONLINE:["En ligne","pill-green"],OFFLINE:["Hors ligne","pill-amber"],UNKNOWN:["Inconnue","pill-gray"]};

function adminFacialWhen(value){
  if(!value)return "—";
  const d=new Date(value);if(isNaN(d))return "—";
  return d.toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function adminFacialDevice(key){return adminFacialState.items.find(item=>item.key===key)||null}
async function adminFacialCall(method,path,body){
  const res=await agentRemoteCall(method,"/biometrics"+path,body);
  if(!res.ok){
    const detail=res.data&&res.data.detail;
    const error=new Error((detail&&detail.message)||res.message||("Erreur "+res.status));
    error.refused=detail&&Array.isArray(detail.refused)?detail.refused:[];
    throw error;
  }
  return res.data;
}

async function renderAdminFacialTerminals(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6">Accès réservé Administration système</div>`;return}
  const current=adminCaptureView(view);
  if(!adminFacialState.loaded)view.innerHTML=`<div class="card p-6 text-slate-500">Chargement des équipements…</div>`;
  try{
    const data=await adminFacialCall("GET","/equipment");
    if(!current())return;
    adminFacialState={items:data.items||[],dashboard:data.dashboard||{},filters:data.filters||{},categories:data.categories||[],error:"",loaded:true};
  }catch(e){
    if(!current())return;
    adminFacialState={...adminFacialState,error:e.message||"Liste indisponible",loaded:true};
  }
  const known=new Set(adminFacialState.items.map(i=>i.key));
  [...adminEquipSelected].forEach(k=>{if(!known.has(k))adminEquipSelected.delete(k)});
  view.innerHTML=adminFacialHTML();
}

function adminEquipVisible(){
  const f=adminEquipFilter;
  return adminFacialState.items.filter(i=>(!f.tab||i.kind===f.tab)&&(!f.society||i.society===f.society)&&(!f.site||String(i.site_id)===f.site)
    &&(!f.type||i.type===f.type)&&(!f.state||[i.admin_state,i.availability,i.status].includes(f.state))
    &&(!f.user||(i.users||[]).some(u=>String(u.id)===f.user)));
}
function adminEquipSetFilter(field,value){adminEquipFilter[field]=String(value||"");const view=document.getElementById("admin-facial-terminals");if(view)view.outerHTML=adminFacialHTML()}
function adminEquipToggle(key,on){if(on)adminEquipSelected.add(key);else adminEquipSelected.delete(key);const bar=document.getElementById("admin-equip-bulk");if(bar)bar.outerHTML=adminEquipBulkHTML()}
function adminEquipToggleAll(on){adminEquipVisible().filter(i=>i.admin_state!=="REVOKED").forEach(i=>on?adminEquipSelected.add(i.key):adminEquipSelected.delete(i.key));adminEquipSetFilter("tab",adminEquipFilter.tab)}
function adminEquipBulkHTML(){
  const n=adminEquipSelected.size;
  return `<div id="admin-equip-bulk" class="flex flex-wrap items-center gap-2 mb-3"><span class="text-sm font-bold">${n} équipement${n>1?"s":""} sélectionné${n>1?"s":""}</span>
    <button class="btn btn-primary text-xs" id="admin-equip-assign" ${n?"":"disabled"} onclick="openAdminEquipAssign('grant')">👥 Affecter à des utilisateurs</button>
    <button class="btn btn-secondary text-xs" id="admin-equip-unassign" ${n?"":"disabled"} onclick="openAdminEquipAssign('revoke')">Retirer des utilisateurs</button></div>`;
}
function adminEquipSelect(id,label,field,options){
  return `<label class="text-xs font-bold flex flex-col gap-1" style="min-width:150px">${label}<select class="select" id="${id}" onchange="adminEquipSetFilter('${field}',this.value)"><option value="">Tous</option>${options.map(([v,l])=>`<option value="${escapeHTML(v)}" ${String(adminEquipFilter[field])===String(v)?"selected":""}>${escapeHTML(l)}</option>`).join("")}</select></label>`;
}

function adminFacialHTML(){
  const s=adminFacialState,b=s.dashboard||{},f=s.filters||{};
  const items=adminEquipVisible();
  const rows=items.map(item=>{
    const users=item.users||[];
    const terminal=item.kind==="TERMINAL",revoked=item.status==="REVOKED";
    const pairing=terminal?(item.paired?`Appairé le ${escapeHTML(adminFacialWhen(item.paired_at))}`:(item.pairing_pending?"Code d'association en attente":"Non appairé")):`Enregistrée le ${escapeHTML(adminFacialWhen(item.paired_at))}`;
    const avail=ADMIN_EQUIP_AVAIL[item.availability]||["—","pill-gray"];
    const main=[
      `<button class="btn btn-ghost text-xs" data-equip-sheet="${escapeHTML(item.key)}" onclick="openAdminEquipSheet('${escapeHTML(item.key)}')">📄 Fiche</button>`,
      terminal&&!revoked&&!item.paired?`<button class="btn btn-primary text-xs" data-facial-pair="${escapeHTML(item.key)}" onclick="adminFacialPair('${escapeHTML(item.key)}')">🔗 Associer un appareil</button>`:"",
      revoked?"":`<button class="btn btn-ghost text-xs" data-facial-users="${escapeHTML(item.key)}" onclick="openAdminFacialUsers('${escapeHTML(item.key)}')">👥 Utilisateurs autorisés</button>`,
    ].join("");
    const more=[
      terminal&&!revoked?`<button class="btn btn-ghost text-xs" data-equip-edit="${escapeHTML(item.key)}" onclick="openAdminEquipEdit('${escapeHTML(item.key)}')">✏ Modifier</button>`:"",
      terminal&&!revoked&&item.paired?`<button class="btn btn-ghost text-xs" data-facial-pair="${escapeHTML(item.key)}" onclick="adminFacialPair('${escapeHTML(item.key)}')">🔁 Remplacer le matériel</button>`:"",
      terminal&&!revoked&&item.paired?`<button class="btn btn-ghost text-xs" data-facial-toggle="${escapeHTML(item.key)}" onclick="adminFacialToggle('${escapeHTML(item.key)}')">${item.facial_attendance_enabled?"Couper le pointage facial":"Autoriser le pointage facial"}</button>`:"",
      terminal&&!revoked?`<button class="btn btn-ghost text-xs text-red-600" data-facial-revoke="${escapeHTML(item.key)}" onclick="adminFacialRevoke('${escapeHTML(item.key)}')">⛔ Révoquer</button>`:"",
      terminal?`<button class="btn btn-ghost text-xs text-red-600" data-facial-delete="${escapeHTML(item.key)}" onclick="adminFacialDelete('${escapeHTML(item.key)}')">🗑 Supprimer</button>`:"",
    ].join("");
    const actions=main+(more?`<details class="admin-equip-more"><summary class="btn btn-ghost text-xs" style="list-style:none">⋯ Plus</summary><div class="flex flex-col gap-1" style="margin-top:4px">${more}</div></details>`:"");
    return `<tr class="border-t" data-facial-row="${escapeHTML(item.key)}">
      <td class="p-3"><input type="checkbox" class="admin-equip-pick" value="${escapeHTML(item.key)}" aria-label="Sélectionner ${escapeHTML(item.name||"")}" ${adminEquipSelected.has(item.key)?"checked":""} ${revoked?"disabled":""} onchange="adminEquipToggle(this.value,this.checked)"></td>
      <td class="p-3" data-label="Équipement"><div class="font-black">${escapeHTML(item.name||"")}</div><div class="text-xs text-slate-500">${escapeHTML(item.key)} · ${escapeHTML(item.type_label||item.hardware||"")}</div><div class="text-xs text-slate-500">${escapeHTML(item.equipment||"")}</div></td>
      <td class="p-3" data-label="Société">${escapeHTML(item.society||"")}</td>
      <td class="p-3" data-label="Site">${escapeHTML(item.site||"")}</td>
      <td class="p-3" data-label="État"><span class="pill ${ADMIN_FACIAL_PILLS[item.status]||"pill-gray"}">${escapeHTML(item.status_label||item.status||"")}</span>${revoked&&item.revoked_reason?`<div class="text-xs text-slate-500">${escapeHTML(item.revoked_reason)}</div>`:""}${terminal&&!revoked&&item.paired&&item.connection&&item.connection!=="ONLINE"?`<div class="text-xs text-slate-500">${escapeHTML(item.connection_label||"")}${item.connection==="SILENT"?" — borne à recharger pour le suivi de connexion":""}</div>`:""}</td>
      <td class="p-3 text-xs" data-label="Appairage">${pairing}</td>
      <td class="p-3 text-xs" data-label="Disponibilité"><span class="pill ${avail[1]}">${escapeHTML(avail[0])}</span><div class="text-slate-500">${escapeHTML(adminFacialWhen(item.last_communication))}</div></td>
      <td class="p-3 text-xs" data-label="Reconnaissance faciale"><span class="pill ${item.facial_attendance_enabled?"pill-green":"pill-gray"}">${item.facial_attendance_enabled?"Facial autorisé":"Facial coupé"}</span><div class="text-slate-500">${item.remote_activation?"Activée depuis le poste Pointeur":"Autonome — surveillance seulement"}</div></td>
      <td class="p-3 text-xs" data-label="Utilisateurs affectés"><span class="pill pill-blue">${users.length} compte${users.length>1?"s":""}</span><div class="text-slate-500">${users.map(u=>escapeHTML(u.username)).join(", ")}</div></td>
      <td class="p-3" data-label="Actions"><div class="flex flex-col gap-1" style="min-width:170px">${actions}</div></td></tr>`;
  }).join("");
  const categories=(s.categories||[]).map(c=>`<li><span class="pill ${c.supported?"pill-green":"pill-gray"}">${c.supported?"Pris en charge":"Non pris en charge"}</span> ${escapeHTML(c.label)}${c.supported?(c.remote_activation?" — activée depuis le poste Pointeur":" — fonctionne seule, le Pointeur la surveille"):""}</li>`).join("");
  const card=(label,value,tone)=>`<div class="rounded-xl border p-3 min-w-[120px] ${tone||""}"><div class="text-xs text-slate-500 font-bold">${label}</div><div class="text-2xl font-black">${Number(value||0)}</div></div>`;
  const tab=(key,label,count)=>`<button class="btn ${adminEquipFilter.tab===key?"btn-primary":"btn-secondary"} text-xs" data-equip-tab="${key}" onclick="adminEquipSetFilter('tab','${key}')">${label} (${Number(count||0)})</button>`;
  const camerasHref=/\.irongs\.com$/.test(location.hostname)?"https://pointage.irongs.com/#/cameras":"/static/pointage/index.html#/cameras";
  // Téléphone : une carte par équipement (libellé avant chaque valeur), jamais de défilement horizontal.
  const responsive=`<style>@media(max-width:760px){#admin-facial-terminals table thead{display:none}#admin-facial-terminals table,#admin-facial-terminals tbody,#admin-facial-terminals tr[data-facial-row],#admin-facial-terminals tr[data-facial-row] td{display:block;width:100%}#admin-facial-terminals tr[data-facial-row]{border:1px solid #e2e8f0;border-radius:12px;margin:0 0 12px;padding:6px 0}#admin-facial-terminals tr[data-facial-row] td{padding:4px 12px!important;font-size:13px!important;box-sizing:border-box}#admin-facial-terminals td[data-label]::before{content:attr(data-label);display:block;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}#admin-facial-terminals td[data-label="Actions"] > div{flex-direction:row;flex-wrap:wrap;min-width:0!important}}</style>`;
  return `<div class="card p-5" id="admin-facial-terminals">${responsive}
    <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div><h2 class="text-xl font-black">Gestion des équipements</h2>
        <p class="text-sm text-slate-600">Terminaux de pointage, tablettes, smartphones et caméras IP : enregistrement, appairage (une seule fois, à l'installation), affectation aux comptes Pointeur, révocation. Une affectation n'active jamais la reconnaissance faciale et n'accorde aucun droit supplémentaire.</p></div>
      <div class="flex flex-wrap gap-2"><button class="btn btn-secondary" onclick="renderView()">↻ Actualiser</button><a class="btn btn-secondary" id="admin-equip-cameras" href="${camerasHref}" target="_blank" rel="noopener">◉ Déclarer une caméra</a><button class="btn btn-primary" id="admin-facial-add" onclick="openAdminFacialCreate()">➕ Enregistrer un terminal</button></div>
    </div>
    <div class="flex flex-wrap gap-2 mb-3" id="admin-equip-dashboard">
      ${card("Équipements",b.total)}${card("Terminaux",b.terminals)}${card("Caméras",b.cameras)}${card("Actifs",b.admin_active)}${card("Inactifs",b.admin_inactive)}${card("Révoqués",b.admin_revoked)}
      ${card("En ligne",b.availability_online)}${card("Hors ligne",b.availability_offline)}${card("Non affectés",b.unassigned)}${card("Facial autorisé",b.facial_enabled)}
    </div>
    <div class="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Type d'équipement">${tab("","Tous",b.total)}${tab("TERMINAL","Terminaux",b.terminals)}${tab("CAMERA","Caméras",b.cameras)}</div>
    <div class="flex flex-wrap gap-3 mb-3" id="admin-equip-filters">
      ${adminEquipSelect("af-f-society","Société","society",(f.societies||[]).map(v=>[v,v]))}
      ${adminEquipSelect("af-f-site","Site","site",(f.sites||[]).map(([id,name])=>[String(id),name||("Site "+id)]))}
      ${adminEquipSelect("af-f-type","Type","type",(f.types||[]).map(t=>[t.key,t.label]))}
      ${adminEquipSelect("af-f-state","État","state",(f.states||[]).map(t=>[t.key,t.label]))}
      ${adminEquipSelect("af-f-user","Utilisateur","user",(f.users||[]).map(u=>[String(u.id),u.username]))}
    </div>
    ${adminEquipBulkHTML()}
    ${s.error?`<div class="p-3 mb-3 text-red-700" role="alert">${escapeHTML(s.error)}</div>`:""}
    <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-xs text-slate-500">
      <th class="p-3"><input type="checkbox" id="admin-equip-all" aria-label="Sélectionner les équipements affichés" onchange="adminEquipToggleAll(this.checked)"></th><th class="p-3">Équipement</th><th class="p-3">Société</th><th class="p-3">Site</th><th class="p-3">État</th><th class="p-3">Appairage</th><th class="p-3">Disponibilité</th><th class="p-3">Reconnaissance faciale</th><th class="p-3">Utilisateurs affectés</th><th class="p-3">Actions</th>
    </tr></thead><tbody>${rows||`<tr><td colspan="10" class="p-6 text-center text-slate-500">${s.error?"":(s.items.length?"Aucun équipement ne correspond aux filtres.":"Aucun équipement enregistré.")}</td></tr>`}</tbody></table></div>
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
    closeModal();
    await renderView();adminFacialPair("trm:"+term.id,true);
  }catch(e){toast(e.message,"error")}
}

// Appairage : code à usage unique saisi UNE fois sur l'appareil (page /borne). La clé privée est
// créée sur l'appareil et n'en sort jamais. Sur un terminal déjà appairé : remplacement du
// matériel (l'ancienne clé reste valable jusqu'à l'association du nouvel appareil).
// « Associer un appareil » : un grand QR (l'adresse /borne portant le code à usage unique) et le
// même code en clair pour une saisie manuelle. Une seule opération, validée par le serveur seul
// (10 minutes, usage unique). La fenêtre suit l'association et l'annonce dès qu'elle a eu lieu.
let adminPairTimers=[];
function adminPairStop(){adminPairTimers.forEach(clearInterval);adminPairTimers=[]}
function adminPairClose(){adminPairStop();closeModal();renderView()}
function adminPairState(text,tone){const el=document.getElementById("admin-pair-state");if(!el)return;el.textContent=text;el.dataset.tone=tone||"ok"}
async function adminFacialPair(key,fresh){
  const item=adminFacialDevice(key);
  if(item&&item.paired&&!fresh&&!confirm("Remplacer le matériel de « "+item.name+" » ?\nLa clé actuelle restera valable jusqu'à l'association du nouvel appareil. Les utilisateurs autorisés sont conservés."))return;
  adminPairStop();
  let out;
  try{out=await adminFacialCall("POST","/terminals/"+encodeURIComponent(key.split(":")[1])+"/pairing-code")}
  catch(e){toast(e.message,"error");return}
  const pairedAt=item?item.paired_at||null:null;
  const deviceName=(item&&item.name)||(out.terminal&&out.terminal.name)||"";
  const origin=/\.irongs\.com$/.test(location.hostname)?"https://pointeur.irongs.com":location.origin;
  const size=Math.max(200,Math.min(340,Math.floor((window.innerWidth||400)*0.72)));
  openModal(ADMIN_EQUIP_MODAL_STYLE+`<div id="admin-pair-modal" class="admin-equip-modal" data-key="${escapeHTML(key)}">
    <style>#admin-pair-state{font-weight:900;text-align:center;border-radius:10px;padding:8px 12px;margin:0 0 10px}#admin-pair-state[data-tone="ok"]{background:#dcfce7;color:#14532d}#admin-pair-state[data-tone="warn"]{background:#fef3c7;color:#78350f}#admin-pair-state[data-tone="error"]{background:#fee2e2;color:#7f1d1d}#admin-facial-qr.is-expired{opacity:.15;filter:grayscale(1)}#admin-facial-qr canvas,#admin-facial-qr img{width:100%!important;height:auto!important;image-rendering:pixelated}</style>
    <h3 class="text-lg font-black mb-1">Associer un appareil${deviceName?" — "+escapeHTML(deviceName):""}</h3>
    <div id="admin-pair-state" role="status" data-tone="ok">QR d'association prêt</div>
    <p class="text-sm text-slate-600 mb-2" style="text-align:center">Sur la tablette ou le smartphone : ouvrez <b>pointeur.irongs.com/borne</b>, touchez « Scanner le QR d'association » et visez ce code.</p>
    <div id="admin-facial-qr" style="width:${size}px;max-width:100%;margin:8px auto;background:#fff;padding:12px;border-radius:12px;box-sizing:border-box" aria-label="QR d'association"></div>
    <div class="text-xs text-slate-500" style="text-align:center">Code manuel (si la caméra est indisponible)</div>
    <div class="text-3xl font-black tracking-widest text-center" style="margin:4px 0" id="admin-facial-code">${escapeHTML(out.code||"")}</div>
    <div class="text-sm" style="text-align:center" id="admin-pair-ttl"></div>
    <p class="text-xs text-slate-500" style="text-align:center;margin:8px 0 12px">Usage unique. Une fois l'appareil associé, aucun nouvel appairage n'est demandé ; la reconnaissance faciale n'est jamais activée par l'association.</p>
    <div class="flex flex-wrap justify-end gap-2"><button class="btn btn-secondary" id="admin-pair-new" onclick="adminFacialPair('${escapeHTML(key)}',true)">Générer un nouveau QR</button><button class="btn btn-primary" id="admin-pair-close" onclick="adminPairClose()">Fermer</button></div></div>`);
  const box=document.getElementById("admin-facial-qr");
  try{if(typeof window.sgdiLoadQRLib==="function")await window.sgdiLoadQRLib()}catch(e){/* code manuel ci-dessous */}
  if(box&&window.QRCode&&out.pair_path)new window.QRCode(box,{text:origin+out.pair_path,width:size-24,height:size-24,correctLevel:window.QRCode.CorrectLevel.M});
  else if(box)box.innerHTML=`<p class="text-sm" style="text-align:center">QR indisponible sur cet écran — utilisez le code manuel.</p>`;
  const expiresAt=Date.now()+Number(out.expires_in||600)*1000;
  const tick=()=>{
    const left=Math.max(0,Math.round((expiresAt-Date.now())/1000)),ttl=document.getElementById("admin-pair-ttl");
    if(!document.getElementById("admin-pair-modal")){adminPairStop();return}
    if(ttl)ttl.textContent=left?`Valide encore ${Math.floor(left/60)} min ${String(left%60).padStart(2,"0")} s`:"";
    if(!left){adminPairStop();document.getElementById("admin-facial-qr")?.classList.add("is-expired");adminPairState("QR expiré — générez un nouveau code","warn")}
  };
  // Suivi : l'appareil associé apparaît « Appairé » côté serveur (nouvelle date d'appairage).
  const watch=async()=>{
    if(!document.getElementById("admin-pair-modal")){adminPairStop();return}
    try{
      const row=await adminFacialCall("GET","/equipment/"+encodeURIComponent(key));
      if(row&&row.paired_at&&row.paired_at!==pairedAt&&document.getElementById("admin-pair-modal")){
        adminPairStop();adminPairState("Association réussie","ok");
        document.getElementById("admin-facial-qr")?.classList.add("is-expired");
        const ttl=document.getElementById("admin-pair-ttl");if(ttl)ttl.textContent=row.equipment?"Appareil : "+row.equipment:"";
        const again=document.getElementById("admin-pair-new");if(again)again.hidden=true;
      }
    }catch(e){/* suivi facultatif : l'association reste valable */}
  };
  tick();
  adminPairTimers.push(setInterval(tick,1000),setInterval(watch,3000));
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
    <div class="overflow-y-auto mb-4" style="max-height:18rem" id="admin-facial-users">${boxes||`<p class="text-slate-500">Aucun compte Pointage n'a ce site dans son périmètre.</p>`}</div>
    <div class="flex justify-end gap-2"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" id="admin-facial-users-save" onclick="adminFacialSaveUsers('${escapeHTML(key)}')">Enregistrer</button></div>`);
}
async function adminFacialSaveUsers(key){
  const ids=[...document.querySelectorAll(".admin-facial-user:checked")].map(box=>Number(box.value));
  try{await adminFacialCall("POST","/facial-devices/authorizations",{key,user_ids:ids});closeModal();toast("Autorisations enregistrées","success");renderView()}
  catch(e){toast(e.message,"error")}
}

// Fiche équipement : identité, états séparés (administratif, appairage, disponibilité),
// autorisation faciale distincte, capacités, comptes affectés et historique (journal d'audit).
const ADMIN_EQUIP_CAPS={FACIAL_ATTENDANCE:"Pointage facial",ENROLLMENT_CAPTURE:"Capture d'enrôlement",PREVIEW:"Aperçu relayé par le serveur",HEARTBEAT:"Signal de vie"};
async function openAdminEquipSheet(key){
  let d;
  try{d=await adminFacialCall("GET","/equipment/"+encodeURIComponent(key))}catch(e){toast(e.message,"error");return}
  const line=(label,value)=>`<div class="flex justify-between gap-3 py-1 border-b"><span class="text-slate-500">${label}</span><b class="text-right">${value}</b></div>`;
  const history=(d.history||[]).map(h=>`<li class="py-1 border-b"><b>${escapeHTML(adminFacialWhen(h.at))}</b> · ${escapeHTML(h.label||h.action)}${h.by?" · par "+escapeHTML(h.by):""}${h.result&&h.result!=="success"?` · <span class="text-red-600">${escapeHTML(h.result)}</span>`:""}${(h.added||[]).length?`<div class="text-xs text-green-700">+ ${h.added.map(escapeHTML).join(", ")}</div>`:""}${(h.removed||[]).length?`<div class="text-xs text-red-700">− ${h.removed.map(escapeHTML).join(", ")}</div>`:""}${h.reason?`<div class="text-xs text-slate-500">${escapeHTML(h.reason)}</div>`:""}${(h.changes||[]).length?`<div class="text-xs text-slate-500">Champs : ${h.changes.map(escapeHTML).join(", ")}</div>`:""}</li>`).join("");
  openModal(ADMIN_EQUIP_MODAL_STYLE+`<div id="admin-equip-sheet" class="admin-equip-modal"><h3 class="text-lg font-black mb-1">${escapeHTML(d.name||"")}</h3>
    <p class="text-sm text-slate-600 mb-3">${escapeHTML(d.key)} · ${escapeHTML(d.type_label||"")}</p>
    <div class="text-sm mb-3">${line("Société",escapeHTML(d.society||"—"))}${line("Site",escapeHTML(d.site||"—"))}${line("Emplacement",escapeHTML(d.location||"—"))}${d.kind==="TERMINAL"&&d.equipment&&d.equipment!==d.location?line("Appareil associé",escapeHTML(d.equipment)):""}
      ${line("État administratif",escapeHTML(d.admin_state_label||""))}${line("Appairage",escapeHTML(d.pairing_label||""))}${line("Disponibilité",escapeHTML(d.availability_label||""))}
      ${line("Dernière communication",escapeHTML(adminFacialWhen(d.last_communication)))}${line("Reconnaissance faciale",d.facial_authorization?"Autorisée sur cet équipement":"Non autorisée")}
      ${line("Capacités",escapeHTML((d.capabilities||[]).map(c=>ADMIN_EQUIP_CAPS[c]||c).join(", ")||"—"))}
      ${line("Utilisateurs affectés",escapeHTML((d.users||[]).map(u=>u.username).join(", ")||"Aucun"))}</div>
    <div class="font-black mb-1">Historique</div><ul class="text-sm overflow-y-auto mb-4" style="max-height:16rem" id="admin-equip-history">${history||'<li class="text-slate-500">Aucun événement enregistré.</li>'}</ul>
    <div class="flex justify-end"><button class="btn btn-primary" onclick="closeModal()">Fermer</button></div></div>`);
}

// Modification d'un terminal : nom et emplacement (route existante, Administration Système).
function openAdminEquipEdit(key){
  const item=adminFacialDevice(key);if(!item)return;
  openModal(`<form id="admin-equip-edit" onsubmit="event.preventDefault();adminEquipSave('${escapeHTML(key)}')">
    <h3 class="text-lg font-black mb-3">Modifier ${escapeHTML(item.name||"")}</h3>
    <label class="block text-xs font-bold mb-1" for="ae-name">Nom</label><input class="input mb-3" id="ae-name" required minlength="2" maxlength="80" value="${escapeHTML(item.name||"")}">
    <label class="block text-xs font-bold mb-1" for="ae-loc">Emplacement</label><input class="input mb-4" id="ae-loc" maxlength="120" value="${escapeHTML(item.location||"")}">
    <div class="flex justify-end gap-2"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div></form>`);
}
async function adminEquipSave(key){
  const name=String(document.getElementById("ae-name")?.value||"").trim(),location=String(document.getElementById("ae-loc")?.value||"").trim();
  if(name.length<2){toast("Nom obligatoire (2 caractères minimum)","error");return}
  try{await adminFacialCall("PATCH","/terminals/"+encodeURIComponent(key.split(":")[1]),{name,location:location||null});closeModal();toast("Terminal modifié","success");renderView()}
  catch(e){toast(e.message,"error")}
}

// Affectation groupée : 1. équipements cochés · 2. comptes · 3. vérification serveur (société,
// site, éligibilité) · 4. confirmation. Tout ou rien ; rien n'est écrit avant la confirmation.
async function openAdminEquipAssign(action){
  const keys=[...adminEquipSelected];if(!keys.length)return;
  let accounts;
  try{accounts=await adminFacialCall("GET","/equipment/accounts")}catch(e){toast(e.message,"error");return}
  if(action==="revoke"){const assigned=new Set(keys.flatMap(k=>(adminFacialDevice(k)?.users||[]).map(u=>u.id)));accounts=accounts.filter(a=>assigned.has(a.id))}
  const names=keys.map(k=>adminFacialDevice(k)?.name||k);
  const boxes=accounts.map(a=>`<label class="flex items-center gap-2 py-1 admin-equip-account" data-search="${escapeHTML((a.username+" "+(a.full_name||"")).toLowerCase())}"><input type="checkbox" class="admin-equip-user" value="${Number(a.id)}"><span><b>${escapeHTML(a.username)}</b> <span class="text-slate-500">${escapeHTML(a.full_name||"")}</span>${(a.societies||[]).length?` <span class="text-xs text-slate-500">· ${a.societies.map(escapeHTML).join(", ")}</span>`:""}</span></label>`).join("");
  openModal(ADMIN_EQUIP_MODAL_STYLE+`<div id="admin-equip-assign-modal" class="admin-equip-modal" data-action="${action}"><h3 class="text-lg font-black mb-1">${action==="grant"?"Affecter":"Retirer"} ${keys.length} équipement${keys.length>1?"s":""}</h3>
    <p class="text-sm text-slate-600 mb-2">${names.map(escapeHTML).join(", ")}</p>
    <p class="text-xs text-slate-500 mb-2">${action==="grant"?"Seuls les comptes actifs du module Pointeur sont proposés. Le serveur vérifie société et site de chaque compte pour chaque équipement ; l'affectation n'ajoute aucun droit et n'active pas la reconnaissance faciale.":"Comptes actuellement affectés à au moins un des équipements choisis."}</p>
    <input class="input mb-2" id="admin-equip-search" placeholder="Rechercher un compte" oninput="adminEquipFilterAccounts(this.value)">
    <div class="overflow-y-auto mb-3" style="max-height:15rem" id="admin-equip-accounts">${boxes||'<p class="text-slate-500">Aucun compte disponible.</p>'}</div>
    <div id="admin-equip-check" class="text-sm mb-3"></div>
    <div class="flex justify-end gap-2"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-secondary" id="admin-equip-verify" onclick="adminEquipCheck('${action}')">Vérifier</button><button class="btn btn-primary" id="admin-equip-confirm" disabled onclick="adminEquipConfirm('${action}')">Confirmer</button></div></div>`);
}
function adminEquipFilterAccounts(q){const v=String(q||"").trim().toLowerCase();document.querySelectorAll(".admin-equip-account").forEach(el=>{el.style.display=!v||el.dataset.search.includes(v)?"":"none"})}
function adminEquipChosen(){return [...document.querySelectorAll(".admin-equip-user:checked")].map(b=>Number(b.value))}
async function adminEquipCheck(action){
  const user_ids=adminEquipChosen(),box=document.getElementById("admin-equip-check"),confirmBtn=document.getElementById("admin-equip-confirm");
  if(!user_ids.length){toast("Choisissez au moins un compte","error");return}
  let out;
  try{out=await adminFacialCall("POST","/equipment/assignments/check",{keys:[...adminEquipSelected],user_ids,action})}catch(e){toast(e.message,"error");return}
  const lines=(out.pairs||[]).map(p=>`<li class="${p.allowed?(p.change?"text-green-700":"text-slate-500"):"text-red-700"}">${p.allowed?(p.change?"✓":"="):"✗"} ${escapeHTML(p.device)} → ${escapeHTML(p.username)} : ${escapeHTML(p.message)}</li>`).join("");
  if(box)box.innerHTML=`<div class="font-black">${out.allowed?`${Number(out.changes||0)} modification(s) prête(s)`:"Affectation impossible : corrigez les refus"}</div><ul class="overflow-y-auto" style="max-height:10rem">${lines}</ul>`;
  if(confirmBtn)confirmBtn.disabled=!out.allowed||!out.changes;
}
async function adminEquipConfirm(action){
  const user_ids=adminEquipChosen();if(!user_ids.length)return;
  try{
    const out=await adminFacialCall("POST","/equipment/assignments",{keys:[...adminEquipSelected],user_ids,action});
    closeModal();toast(`${Number(out.changed||0)} ${action==="grant"?"affectation(s) enregistrée(s)":"affectation(s) retirée(s)"}`,"success");adminEquipSelected.clear();renderView();
  }catch(e){
    const box=document.getElementById("admin-equip-check");
    if(box&&e.refused&&e.refused.length)box.innerHTML=`<div class="font-black text-red-700">${escapeHTML(e.message)}</div><ul>${e.refused.map(r=>`<li class="text-red-700">✗ ${escapeHTML(r.device)} → ${escapeHTML(r.username)} : ${escapeHTML(r.message)}</li>`).join("")}</ul>`;
    const confirmBtn=document.getElementById("admin-equip-confirm");if(confirmBtn)confirmBtn.disabled=true;
    toast(e.message,"error");
  }
}

SGDIModules.registerModule({key:"administration-facial-terminals",routes:[]});
