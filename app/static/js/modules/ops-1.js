/* Phase 2 — ops-1. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
async function inspectionScan(id,siteId,kind){
  if(guardOpsSupervisorMutation("supervision","Accès superviseur OPS : scan inspection non autorisé."))return;
  const i=(db.siteInspections||[]).find(x=>x.id===id);if(!i)return;
  if(!i.scans)i.scans={};if(!i.scans[siteId])i.scans[siteId]={};
  if(kind==="sortie"&&!i.scans[siteId].entree){toast("Scanner l'entrée avant la sortie","error");return}
  i.scans[siteId][kind]=new Date().toISOString();i.updatedAt=new Date().toISOString();
  if(!(await saveDBAndWaitToast("Scan QR non confirmé")))return;
  toast("Scan QR enregistré","success");closeModal();renderView();
}

function renderUnexpectedInspections(view,soc,sites,supervisors,inspections){
  const opsReadOnly=isOpsSupervisorReadOnlySession();
  const list=inspections.filter(i=>i.type==="inopinee").sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  view.innerHTML=`<div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><h1 class="text-2xl font-black uppercase">SUPERVISION SITE</h1><div class="text-xs text-slate-500">Inspections inopinées créées automatiquement si aucun passage n'était programmé · ${soc?escapeHTML(soc):"Toutes sociétés"}</div></div></div>${opsSupervisorReadOnlyNoticeHTML()}${inspectionTabs("inopinees")}
  ${opsReadOnly?"":`<div class="card p-5 mb-5"><h3 class="font-black mb-3">Scan QR inspection inopinée</h3><form onsubmit="event.preventDefault();saveUnexpectedInspectionScan()"><div class="grid grid-cols-1 md:grid-cols-3 gap-3"><div><label class="label">Superviseur</label><select class="select" name="supervisorId"><option value="">— Choisir superviseur —</option>${supervisors.map(a=>`<option value="${a.id}">${escapeHTML((a.matricule? a.matricule+" · ":"")+(a.nom||"")+" "+(a.prenom||""))}</option>`).join("")}</select></div><div><label class="label">Site scanné</label><select class="select" name="siteId"><option value="">— Choisir site —</option>${sites.map(st=>`<option value="${st.id}">${escapeHTML((st.societe?st.societe+" · ":"")+(st.nom||st.intitule||"Site"))}</option>`).join("")}</select></div><div><label class="label">Action QR</label><select class="select" name="kind"><option value="entree">Arrivée / Entrée</option><option value="sortie">Départ / Sortie</option></select></div></div><div class="flex justify-end mt-4"><button class="btn btn-primary">Valider scan</button></div></form></div>`}
  <div class="card p-5 overflow-hidden"><table><thead><tr><th>Date</th><th>Superviseur</th><th>Site</th><th>Entrée</th><th>Sortie</th><th>Temps sur site</th><th>Alerte</th></tr></thead><tbody>${list.length?list.map(i=>{const id=(i.siteIds||[])[0];const sc=(i.scans||{})[id]||{};return`<tr><td>${formatDate(i.date)}</td><td>${escapeHTML(inspectionSupervisorName(i.supervisorId))}</td><td>${escapeHTML(inspectionSiteName(id))}</td><td>${sc.entree?new Date(sc.entree).toLocaleString("fr-FR"):"—"}</td><td>${sc.sortie?new Date(sc.sortie).toLocaleString("fr-FR"):"—"}</td><td>${escapeHTML(inspectionElapsed(sc)||"")}</td><td><span class="pill pill-red">Inspection non programmée</span></td></tr>`}).join(""):`<tr><td colspan="7" class="text-center text-slate-500 p-4">Aucune inspection inopinée.</td></tr>`}</tbody></table></div>`;
}

async function saveUnexpectedInspectionScan(){
  if(guardOpsSupervisorMutation("supervision","Accès superviseur OPS : scan inspection non autorisé."))return;
  const form=document.querySelector("#view form");if(!form)return;const fd=new FormData(form);const supervisorId=fd.get("supervisorId")||"",siteId=fd.get("siteId")||"",kind=fd.get("kind")||"entree";
  if(!supervisorId||!siteId){toast("Superviseur et site obligatoires","error");return}
  if(!db.siteInspections)db.siteInspections=[];
  let i=(db.siteInspections||[]).find(x=>x.type==="inopinee"&&x.supervisorId===supervisorId&&(x.siteIds||[]).includes(siteId)&&x.date===today()&&!((x.scans||{})[siteId]?.sortie));
  if(!i){i={id:uid("insp"),type:"inopinee",date:today(),supervisorId,siteIds:[siteId],vehicule:"",moyens:"",scans:{},societe:currentStructureSocieteFilter()||session?.societe||"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.siteInspections.unshift(i)}
  if(!i.scans)i.scans={};if(!i.scans[siteId])i.scans[siteId]={};
  if(kind==="sortie"&&!i.scans[siteId].entree){toast("Scanner l'arrivée avant le départ","error");return}
  i.scans[siteId][kind]=new Date().toISOString();i.updatedAt=new Date().toISOString();
  if(!(await saveDBAndWaitToast("Inspection inopinée non confirmée")))return;
  toast("Inspection inopinée enregistrée avec alerte","success");renderView();
}

SGDIModules.registerModule({key: "ops-1", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
