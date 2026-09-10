/* Phase 2 — facturation. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function factTabs(active){
  if(window.__FAC_AUTONOMOUS_APP__)return "";
  const tabs=[["dashboard","Tableau de bord","facturation/dashboard"],["clients","Clients","facturation/clients"],["missions","Prestations à facturer","facturation/missions"],["factures","Factures","facturation/factures"],["paiements","Paiements","facturation/paiements"],["avances","Avances","facturation/avances"],["avoirs","Avoirs","facturation/avoirs"],["caisse","Caisse","facturation/caisse"],["balance","Balance agée","facturation/balance"],["situation","Situation","facturation/situation"]];
  return '<nav style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #e2e8f0;overflow-x:auto">'+tabs.map(([k,l,r])=>{const on=active===k;return'<a href="#/'+r+'" style="display:inline-block;padding:9px 14px;font-size:11px;font-weight:700;white-space:nowrap;text-decoration:none;border-bottom:2px solid '+(on?"#0f2d5a":"transparent")+';color:'+(on?"#0f2d5a":"#64748b")+';margin-bottom:-2px;'+(on?"background:#f8fafc;":"")+'">'+(l)+'</a>';}).join("")+"</nav>";
}

function statutFactPill(s){return{"emise":"pill-blue","partielle":"pill-amber","payee":"pill-green","echue":"pill-red","annulee":"pill-gray"}[s]||"pill-gray"}

function statutDevisPill(s){return{"brouillon":"pill-gray","envoye":"pill-blue","accepte":"pill-green","refuse":"pill-red","expire":"pill-amber"}[s]||"pill-gray"}

function renderFacturation(view,sub,arg){
  facturationLeaveEditor();
  if(sub==="dashboard")return renderFactDashboard(view);
  if(sub==="clients")return renderFactClients(view);
  if(sub==="missions")return renderFactMissionBillables(view);
  if(sub==="devis"){navigate("commercial/devis");return;}
  if(sub==="factures"){if(window.__factureEditId)return renderFactureEditor(view);return renderFactureListPage(view);}
  if(sub==="paiements")return renderFactPaiements(view);
  if(sub==="avances")return renderFactAvances(view);
  if(sub==="avoirs")return renderFactAvoirs(view);
  if(sub==="caisse")return renderFactCaisse(view);
  if(sub==="stock")return renderFactStock(view);
  if(sub==="situation")return renderFactSituation(view);
  if(sub==="balance")return renderFactBalance(view);
  if(sub==="compte")return renderFactCompteClient(view,arg);
  if(sub==="categories")return renderFactCategories(view);
  if(sub==="themes")return renderFactThemes(view);
  if(sub==="structures")return renderFactStructures(view);
  renderFactDashboard(view);
}

function renderFactMissionBillables(view){
  _renderFactMissionBillablesHTML(view);
  if(sgdiAuthToken())syncMissionWorkflowCollections(["missionBillables"]).then(()=>{
    if(document.body.contains(view)&&/facturation\/missions/.test(location.hash))_renderFactMissionBillablesHTML(view);
  }).catch(e=>{console.warn("Synchronisation des prestations à facturer indisponible",e);toast("Prestations à facturer non synchronisées : "+(e.message||e),"warning")});
}

function _renderFactMissionBillablesHTML(view){
  const soc=mySoc(),rows=(db.missionBillables||[]).filter(x=>!soc||normalizeSocieteName(x.societe||"")===normalizeSocieteName(soc)).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  const ready=rows.filter(x=>x.status==="prete_a_facturer").length,waiting=rows.filter(x=>x.status==="en_attente_execution").length,total=rows.reduce((s,x)=>s+(Number(x.priceHT)||0),0);
  const statusLabel=s=>({en_attente_execution:"En attente d'exécution",prete_a_facturer:"Prête à facturer",facturee:"Facturée",suspendue:"Suspendue",annulee:"Annulée"})[s]||s||"En attente";
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-4"><div><h1 class="text-2xl font-black">Prestations à facturer</h1><p class="text-sm text-slate-500">Missions validées par la Direction commerciale, suivies jusqu'à leur facturation.</p></div></div>${factTabs("missions")}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4"><div class="card p-4"><div class="text-xs uppercase font-bold text-slate-500">En attente d'exécution</div><div class="text-2xl font-black text-amber-700">${waiting}</div></div><div class="card p-4"><div class="text-xs uppercase font-bold text-slate-500">Prêtes à facturer</div><div class="text-2xl font-black text-emerald-700">${ready}</div></div><div class="card p-4"><div class="text-xs uppercase font-bold text-slate-500">Valeur HT transmise</div><div class="text-2xl font-black text-blue-900">${money(total)} DA</div></div></div>
    <div class="card overflow-hidden"><table><thead><tr><th>Mission</th><th>Client</th><th>Prestation</th><th>Période</th><th>Prix HT</th><th>TVA</th><th>TTC</th><th>Statut</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td class="font-mono text-xs font-bold">${escapeHTML(x.missionNumber||"")}</td><td class="font-semibold">${escapeHTML(x.clientName||"")}</td><td>${escapeHTML(x.designation||"")}</td><td class="text-xs">${formatDate(x.dateDebut)} → ${formatDate(x.dateFin)}</td><td class="font-bold">${money(x.priceHT||0)} DA</td><td>${Number(x.vatRate||19)}%</td><td class="font-bold">${money(x.priceTTC||0)} DA</td><td><span class="pill pill-amber">${escapeHTML(statusLabel(x.status))}</span></td></tr>`).join(""):`<tr><td colspan="8" class="text-center text-slate-500 p-6">Aucune prestation de mission transmise.</td></tr>`}</tbody></table></div>`;
}

async function renderFactClients(view){
  const soc=mySoc();const page=sgdiServerCurrentPage("fact-clients",soc||"all");
  view.innerHTML='<div style="padding:40px;text-align:center;color:#94a3b8;font-size:14px">Chargement des clients...</div>';
  sgdiShowDataLoadingBar("Chargement des clients...");
  let list=[];let result=null;
  try{
    result=await SGDI.commercial.clientsPage({society:soc||undefined,page,page_size:25});
    list=serverItems(result).map(clientFromApi);
    list.forEach(c=>sgdiUpsertServerItem("clients",c));
  }catch(e){
    console.warn("renderFactClients API error",e);
    list=bySoc(db.clients||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  }
  try{
    const rows=list.map(c=>{
      // Même référence contractuelle que la liste Commercial (tarifs et quantités par site).
      const ttc=clientMontantTTC(c);
      const totalEffectif=(c.tech_sites||[]).reduce((s,site)=>s+clientSiteEffectif(site),0);
      const nbrSite=clientNbrSites(c);
      return '<tr data-searchable style="cursor:pointer" onclick="openClientModal(\''+c.id+'\')">'+
        '<td class="font-semibold" style="color:#1d4ed8">'+escapeHTML(c.nom||"")+'</td>'+
        '<td class="text-xs">'+escapeHTML((c.prestationsServices||"").split("\n")[0]||"—")+'</td>'+
        '<td class="text-xs">'+escapeHTML(c.contact||"")+'</td>'+
        '<td class="text-xs">'+escapeHTML(c.tel||"")+'</td>'+
        '<td class="text-xs">'+escapeHTML(c.wilaya||"—")+'</td>'+
        '<td class="font-bold" style="text-align:center">'+nbrSite+'</td>'+
        '<td class="font-bold" style="text-align:center;color:#043970">'+totalEffectif+'</td>'+
        '<td class="font-mono font-bold" style="text-align:right;white-space:nowrap;color:#043970">'+(ttc>0?formatDZD(ttc):"—")+'</td>'+
        '<td><span class="pill '+(c.statut==="actif"?"pill-green":"pill-gray")+'">'+safe(c.statut)+'</span></td>'+
        '</tr>';
    }).join("");
    const total=result?.total??list.length;
    view.innerHTML=factTabs("clients")+
      '<div class="flex justify-between items-center mb-3"><div style="display:flex;align-items:center;gap:12px"><h1 class="text-2xl font-bold">Clients</h1><span style="background:#0f2d5a;color:#fff;font-size:13px;font-weight:800;padding:3px 12px;border-radius:20px">'+total+'</span></div>'+
      '<div style="display:flex;gap:8px;align-items:center"><button onclick="importClientsExcel()" style="background:#fff;color:#047857;border:1px solid #10b981;border-radius:7px;padding:10px 16px;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap">⬆ IMPORTER EXCEL</button></div></div>'+
      '<div class="card overflow-x-auto">'+
      (list.length===0?'<div class="p-10 text-center text-slate-500">Aucun client.</div>':
      '<table><thead><tr>'+
      '<th>Nom</th><th>Prestation fournie</th><th>Contact</th><th>Tel</th><th>Wilaya</th>'+
      '<th style="text-align:center">Nbr site</th><th style="text-align:center">Total eff.</th>'+
      '<th style="text-align:right">Montant TTC</th><th>Statut</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table>')+
      '</div>'+(result?sgdiServerPaginationHTML("fact-clients",soc||"all",result):"");
  }catch(e){
    console.error("renderFactClients render error",e);
    view.innerHTML=factTabs("clients")+'<div class="card p-8 text-center text-red-600">Erreur d\'affichage : '+(e.message||e)+'</div>';
  }
}

function factureEditorOpen(id){window.__factureEditId=id||"new";navigate("facturation/factures");}

function factureEditorClose(){delete window.__factureEditId;navigate("facturation/factures");}

function renderFactureListPage(view){
  const activeSoc=normalizeSocieteName(mySoc());
  const list=(db.factures||[]).filter(f=>!activeSoc||normalizeSocieteName(f?.societe)===activeSoc).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const drafts=list.filter(f=>String(f.statut||"").toLowerCase()==="brouillon");
  const issued=list.filter(f=>String(f.statut||"").toLowerCase()!=="brouillon");
  const totalIssued=issued.reduce((sum,f)=>sum+Number(f.ttc||f.montantTTC||0),0);
  const outstanding=issued.reduce((sum,f)=>sum+factureStatutPaye(f).reste,0);
  const thS="padding:10px 12px;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0;text-align:left;white-space:nowrap;background:#fff";
  const rows=list.map(f=>{
    const sp=factureStatutPaye(f);const ttcV=f.ttc||f.montantTTC||0;
    const sd=factStatutDisplay(f);const rc=f.clientRc||f.rc||"";
    const rowStatus=String(f.statut||"").toLowerCase()==="brouillon"?"brouillon":sp.statut;
    const imported=f.sourceImport==="excel"||String(f.id||"").startsWith("fc_import_");
    return '<tr data-searchable data-fact-id="'+escapeHTML(f.id||"")+'" data-fact-imported="'+(imported?"1":"0")+'" data-fact-status="'+escapeHTML(rowStatus)+'" style="border-bottom:1px solid #f1f5f9;cursor:pointer" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'" onclick="factureEditorOpen(\''+f.id+'\')" >'+
    '<td style="padding:10px 8px;text-align:center" onclick="event.stopPropagation()">'+(imported?'<input type="checkbox" class="fact-import-check" value="'+escapeHTML(f.id||"")+'" onchange="factureImportSelectionUpdate()" aria-label="Sélectionner la facture importée">':'')+'</td>'+
    '<td style="padding:10px 12px;font-family:monospace;font-size:12px;color:#1d4ed8;font-weight:700">'+safe(f.numero||"")+'</td>'+
    '<td style="padding:10px 12px"><div style="font-weight:700;font-size:12px;color:#0f172a">'+escapeHTML(f.client||f.clientNom||"")+'</div>'+(rc?'<div style="font-size:10px;color:#94a3b8;margin-top:1px">RC# '+escapeHTML(rc)+'</div>':"")+
    '</td>'+
    '<td style="padding:10px 12px;text-align:right;font-weight:700;font-size:13px;color:#0f2d5a;font-family:monospace">'+money(ttcV)+'</td>'+
    '<td style="padding:10px 12px;text-align:right;font-size:12px;font-family:monospace;color:#64748b">'+money(sp.paye)+'</td>'+
    '<td style="padding:10px 12px"><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:'+sd.bg+';color:'+sd.color+';white-space:nowrap">'+escapeHTML(sd.label)+'</span></td>'+
    '<td style="padding:10px 12px;font-size:12px;color:#475569">'+formatDate(f.date)+'</td>'+
    '<td style="padding:10px 12px;font-size:12px;color:#94a3b8">'+formatDate(f.createdAt||f.date)+'</td>'+
    '<td style="padding:10px 12px;text-align:right" onclick="event.stopPropagation()"><div style="display:flex;gap:6px;justify-content:flex-end;align-items:center">'+
    '<button title="Voir" style="background:none;border:none;cursor:pointer;font-size:15px;color:#64748b;padding:2px 4px" onclick="factureEditorOpen(\''+f.id+'\')">👁</button>'+
    (String(f.statut||"").toLowerCase()==="brouillon"?'<button title="Modifier le brouillon" style="background:none;border:none;cursor:pointer;font-size:14px;color:#64748b;padding:2px 4px" onclick="factureEditorOpen(\''+f.id+'\')">✏️</button><button title="Supprimer le brouillon" style="background:none;border:none;cursor:pointer;font-size:14px;color:#ef4444;padding:2px 4px" onclick="deleteFacture(\''+f.id+'\')">🗑</button>':'')+
    '</div></td></tr>';
  }).join("");
  view.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:16px">'+
    '<div><div style="display:flex;align-items:center;gap:8px;color:#64748b;font-size:12px;margin-bottom:4px"><a href="#/facturation/dashboard" style="color:#64748b;text-decoration:none">Accueil</a><span>/</span><span style="color:#0f2d5a;font-weight:700">Factures</span></div><h1 style="margin:0;color:#0f2d5a;font-size:24px;font-weight:900">Gestion des factures</h1><p style="margin:3px 0 0;color:#64748b;font-size:12px">Créez une facture ou consultez les factures émises.</p></div>'+
    '<div style="display:flex;gap:8px;align-items:center"><button onclick="importFacturesExcel()" style="background:#fff;color:#047857;border:1px solid #10b981;border-radius:7px;padding:10px 16px;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap">⬆ IMPORTER EXCEL</button><button onclick="factureEditorOpen()" style="background:#043970;color:#fff;border:0;border-radius:7px;padding:11px 18px;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap">+ NOUVELLE FACTURE</button></div>'+
    '</div>'+
    factTabs("factures")+
    '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px">'+
    [['Toutes',list.length,'#043970'],['Brouillons',drafts.length,'#64748b'],['Factures émises',issued.length,'#047857'],['Reste à encaisser',money(outstanding),'#d97706']].map(k=>'<div class="card" style="padding:13px 15px"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b">'+k[0]+'</div><div style="font-size:19px;font-weight:900;color:'+k[2]+';margin-top:4px">'+k[1]+'</div></div>').join('')+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
    '<input type="text" placeholder="Rechercher par numéro, client ou date…" oninput="filterFactureList()" style="flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:9px 12px;font-size:12px;outline:none" id="fact-search">'+
    '<select id="fact-status-filter" onchange="filterFactureList()" style="min-width:170px;border:1px solid #e2e8f0;border-radius:6px;padding:9px 12px;font-size:12px;background:#fff"><option value="">Tous les statuts</option><option value="brouillon">Brouillons</option><option value="emise">Émises</option><option value="partielle">Partiellement payées</option><option value="payee">Payées</option><option value="echue">Échues</option></select>'+
    '</div>'+
    '<div id="fact-import-actions" style="display:'+(list.some(f=>f.sourceImport==="excel"||String(f.id||"").startsWith("fc_import_"))?"flex":"none")+';align-items:center;gap:10px;margin:-2px 0 10px;padding:9px 12px;border:1px solid #d1fae5;background:#ecfdf5;border-radius:7px"><label style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#065f46"><input type="checkbox" id="fact-import-check-all" onchange="factureImportSelectAll(this.checked)"> Tout sélectionner les factures importées</label><span id="fact-import-selection-count" style="font-size:11px;color:#64748b">0 sélectionnée</span><button id="fact-import-delete-btn" disabled onclick="deleteSelectedImportedFactures()" style="margin-left:auto;background:#dc2626;color:#fff;border:0;border-radius:6px;padding:8px 13px;font-size:11px;font-weight:800;cursor:pointer;opacity:.45">Supprimer la sélection</button></div>'+
    '<div class="card" style="overflow:auto">'+
    (list.length===0?'<div style="padding:60px;text-align:center;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">🧾</div><div style="font-weight:700;font-size:15px">Aucune facture</div><button onclick="factureEditorOpen()" style="margin-top:16px;background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-weight:700;cursor:pointer">+ Créer une facture</button></div>':
    '<table style="width:100%;border-collapse:collapse" id="fact-list-table"><thead><tr>'+
    '<th style="'+thS+';width:34px"></th><th style="'+thS+'">Référence</th><th style="'+thS+'">Client</th>'+
    '<th style="'+thS+';text-align:right">Montant</th><th style="'+thS+';text-align:right">Montant Payé</th>'+
    '<th style="'+thS+'">Etat</th><th style="'+thS+'">Date</th><th style="'+thS+'">Créé le</th>'+
    '<th style="padding:10px 12px;border-bottom:2px solid #e2e8f0;background:#fff"></th>'+
    '</tr></thead><tbody id="fact-list-body">'+rows+'</tbody></table>')+
    '</div>';
}

function factureImportSelectionUpdate(){
  const all=Array.from(document.querySelectorAll(".fact-import-check"));const checked=all.filter(x=>x.checked);
  const count=document.getElementById("fact-import-selection-count");if(count)count.textContent=checked.length+" sélectionnée"+(checked.length>1?"s":"");
  const btn=document.getElementById("fact-import-delete-btn");if(btn){btn.disabled=!checked.length;btn.style.opacity=checked.length?"1":".45";}
  const master=document.getElementById("fact-import-check-all");if(master){master.checked=!!all.length&&checked.length===all.length;master.indeterminate=checked.length>0&&checked.length<all.length;}
}

function factureImportSelectAll(checked){document.querySelectorAll('.fact-import-check').forEach(x=>{const tr=x.closest("tr");if(!tr||tr.style.display!=="none")x.checked=checked;});factureImportSelectionUpdate();}

async function deleteSelectedImportedFactures(){
  const ids=Array.from(document.querySelectorAll(".fact-import-check:checked")).map(x=>x.value);if(!ids.length)return;
  const paid=new Set((db.paiements||[]).map(p=>String(p.factureId||p.invoiceId||"")));const blocked=ids.filter(id=>paid.has(String(id)));const removable=ids.filter(id=>!paid.has(String(id)));
  if(!removable.length)return toast("Suppression impossible : ces factures possèdent des paiements associés","error");
  const note=blocked.length?`\n${blocked.length} facture(s) avec paiement seront conservées.`:"";
  if(!confirm(`Supprimer définitivement ${removable.length} facture(s) importée(s) ?${note}`))return;
  let deleted=0,failed=0;
  for(const id of removable){try{await sgdiApi("/api/irongs/collections/factures/items/"+encodeURIComponent(id),{method:"DELETE",legacy:false});db.factures=db.factures.filter(f=>String(f.id)!==String(id));deleted++;}catch(e){console.error("Suppression facture importée",id,e);failed++;}}
  renderView();toast(`${deleted} facture(s) importée(s) supprimée(s)${blocked.length?` · ${blocked.length} protégée(s)`:""}${failed?` · ${failed} en erreur`:""}`,failed?"warning":"success");
}

function factureImportKey(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");}

function factureImportValue(row,aliases){
  const keys=Object.keys(row||{});const wanted=new Set(aliases.map(factureImportKey));
  const key=keys.find(k=>wanted.has(factureImportKey(k)));return key===undefined?"":row[key];
}

function factureImportDate(value){
  if(value instanceof Date&&!isNaN(value))return value.toISOString().slice(0,10);
  if(typeof value==="number"&&window.XLSX?.SSF?.parse_date_code){const d=XLSX.SSF.parse_date_code(value);if(d)return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;}
  const s=String(value||"").trim();if(!s)return today();
  const m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);if(m){const y=m[3].length===2?"20"+m[3]:m[3];return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;}
  return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):today();
}

async function importFacturesExcel(){
  try{await window.sgdiLoadXLSX();}catch(_e){return toast("Impossible de charger le lecteur Excel","error");}
  const input=document.createElement("input");input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});if(!rows.length)throw new Error("Le fichier ne contient aucune facture");
      let imported=0,skipped=0,failed=0;db.factures=db.factures||[];const importBatchId="fact_import_"+Date.now();
      const known=new Set(db.factures.map(f=>String(f.numero||"").trim().toUpperCase()).filter(Boolean));
      for(const row of rows){
        const numero=String(factureImportValue(row,["Référence","Reference","Numéro","Numero","N° facture","Facture"] )||"").trim();
        const client=String(factureImportValue(row,["Client","Nom client","Raison sociale"] )||"").trim();
        if(!numero&&!client){skipped++;continue;}if(numero&&known.has(numero.toUpperCase())){skipped++;continue;}
        const ht=parseFrNum(factureImportValue(row,["Total HT","Montant HT","HT"]));
        const ttc=parseFrNum(factureImportValue(row,["Total TTC","Montant TTC","TTC","Montant"]));
        const rawEcheance=factureImportValue(row,["Date échéance","Date echeance","Échéance","Echeance"]);
        const data={id:uid("fc_import"),numero:numero||"BROUILLON",date:factureImportDate(factureImportValue(row,["Date facture","Date"])),societe:mySoc()||"",client,clientNom:client,objet:String(factureImportValue(row,["Objet","Libellé","Libelle","Description"] )||"").trim(),statut:numero?"emise":"brouillon",totalHT:ht,montantHT:ht,ttc:ttc||ht,montantTTC:ttc||ht,modeReglement:String(factureImportValue(row,["Mode paiement","Mode de paiement","Règlement","Reglement"] )||"A terme"),dateEcheance:rawEcheance?factureImportDate(rawEcheance):"",createdAt:new Date().toISOString(),sourceImport:"excel",importBatchId,lignes:[]};
        try{const saved=await sgdiApi("/api/irongs/collections/factures/items",{method:"POST",body:{data},legacy:false});db.factures.push(saved&&typeof saved==="object"?saved:data);if(numero)known.add(numero.toUpperCase());imported++;}catch(err){console.error("Import facture",numero,err);failed++;}
      }
      renderView();toast(`${imported} facture(s) importée(s)${skipped?` · ${skipped} ignorée(s)`:""}${failed?` · ${failed} en erreur`:""}`,failed?"warning":"success");
    }catch(err){toast("Import impossible : "+(err.message||err),"error");}
  };reader.readAsArrayBuffer(file);};input.click();
}

async function importClientsExcel(){
  try{await window.sgdiLoadXLSX();}catch(_e){return toast("Impossible de charger le lecteur Excel","error");}
  const input=document.createElement("input");input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:true});const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true});if(!rows.length)throw new Error("Le fichier ne contient aucun client");
      let imported=0,skipped=0,failed=0;db.clients=db.clients||[];
      const known=new Set(db.clients.map(c=>factureImportKey(c.nom||"")).filter(Boolean));
      for(const row of rows){
        const nom=String(factureImportValue(row,["Nom","Client","Raison sociale","Nom / raison sociale"])||"").trim();
        if(!nom){skipped++;continue;}
        if(known.has(factureImportKey(nom))){skipped++;continue;}
        const c={
          nom,
          raisonSociale:String(factureImportValue(row,["Raison sociale"])||"").trim(),
          societe:mySoc()||"",
          statut:"actif",
          contact:String(factureImportValue(row,["Contact","Nom contact"])||"").trim(),
          tel:String(factureImportValue(row,["Tel","Téléphone","Telephone"])||"").trim(),
          email:String(factureImportValue(row,["Email","E-mail","Mail"])||"").trim(),
          adresse:String(factureImportValue(row,["Adresse"])||"").trim(),
          wilaya:String(factureImportValue(row,["Wilaya"])||"").trim(),
          commune:String(factureImportValue(row,["Commune"])||"").trim(),
          nif:String(factureImportValue(row,["NIF"])||"").trim(),
          rc:String(factureImportValue(row,["RC"])||"").trim(),
          prestationsServices:String(factureImportValue(row,["Prestation","Prestations","Prestations et Services Fournis"])||"").trim(),
          modePaiement:String(factureImportValue(row,["Mode paiement","Mode de paiement"])||"Virement bancaire").trim(),
          delaiPaiement:String(factureImportValue(row,["Délai paiement","Delai paiement"])||"30 jours").trim(),
        };
        try{await persistClientToPostgres(c);db.clients.push(c);known.add(factureImportKey(nom));imported++;}catch(err){console.error("Import client",nom,err);failed++;}
      }
      renderView();toast(`${imported} client(s) importé(s)${skipped?` · ${skipped} ignoré(s)`:""}${failed?` · ${failed} en erreur`:""}`,failed?"warning":"success");
    }catch(err){toast("Import impossible : "+(err.message||err),"error");}
  };reader.readAsArrayBuffer(file);};input.click();
}

function filterFactureList(){
  const q=(document.getElementById("fact-search")?.value||"").trim().toLowerCase();
  const status=document.getElementById("fact-status-filter")?.value||"";
  document.querySelectorAll("#fact-list-body tr").forEach(tr=>{
    const actual=tr.dataset.factStatus||"";
    const statusOk=!status||(status==="emise"?actual!=="brouillon":actual===status);
    tr.style.display=statusOk&&(!q||tr.textContent.toLowerCase().includes(q))?"":"none";
  });
}

function parseFrNum(s){return parseFloat(String(s||"").replace(/\s/g,"").replace(",","."))||0;}

function formatPrixHT(n){n=parseFloat(n)||0;return n.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});}

function factureEditorLigneHTML(l){
  l=l||{};
  const type=l.type||"article";
  const DEL='<td class="fact-line-actions"><div class="fact-line-buttons">'+
    '<button type="button" data-move="-1" onclick="factureEditorLigneMove(this,-1)" title="Monter la ligne" aria-label="Monter la ligne">↑</button>'+
    '<button type="button" data-move="1" onclick="factureEditorLigneMove(this,1)" title="Descendre la ligne" aria-label="Descendre la ligne">↓</button>'+
    (type==="article"?'<button type="button" class="fact-line-validate" onclick="factureEditorLigneValider(this)" title="Valider" aria-label="Valider la ligne">✓</button>':"")+
    '<button type="button" class="fact-line-delete" onclick="factureEditorLigneRemove(this)" title="Supprimer" aria-label="Supprimer la ligne">×</button></div></td>';

  if(type==="commentaire"){
    const TA="width:100%;border:none;padding:6px 10px;font-size:12px;background:transparent;resize:none;overflow:hidden;min-height:32px;line-height:1.5;box-sizing:border-box;display:block;outline:none;font-style:italic;color:#64748b";
    return '<tr class="fact-ligne-row" data-type="commentaire" style="border-bottom:1px solid #f1f5f9;background:#f8fafc">'+
      '<td colspan="5" style="padding:0"><textarea class="fact-ligne-desig" style="'+TA+'" rows="1" placeholder="Commentaire ou note..." oninput="devisEditorAutoResize(this)">'+escapeHTML(l.designation||"")+'</textarea></td>'+DEL+'</tr>';
  }
  if(type==="remise"){
    const IS="border:1px solid #fed7aa;border-radius:4px;padding:5px 8px;font-size:12px;background:#fff;text-align:right;width:100%;box-sizing:border-box;outline:none";
    const pct=parseFloat(l.remisePct)||0;
    return '<tr class="fact-ligne-row" data-type="remise" style="border-bottom:1px solid #f1f5f9;background:#fff7ed">'+
      '<td colspan="3" style="padding:4px 10px;vertical-align:middle">'+
      '<input class="fact-ligne-desig" style="border:none;background:transparent;font-size:12px;font-weight:600;color:#92400e;width:100%;outline:none" value="'+escapeHTML(l.designation||"Remise commerciale")+'" placeholder="Libellé remise"></td>'+
      '<td style="padding:4px 6px;vertical-align:middle;width:90px">'+
      '<input type="number" class="fact-ligne-remise-pct" min="0" max="100" step="0.01" value="'+pct+'" style="'+IS+'" placeholder="%" oninput="factureEditorCalcTotals()">'+
      '</td>'+
      '<td class="fact-ligne-total" style="padding:6px 10px;text-align:right;font-weight:700;color:#ef4444;white-space:nowrap;vertical-align:middle">'+formatDZD(0)+'</td>'+
      DEL+'</tr>';
  }
  if(type==="soustotal"){
    return '<tr class="fact-ligne-row" data-type="soustotal" style="border-bottom:2px solid #e5e7eb;background:#f1f5f9">'+
      '<td colspan="4" style="padding:8px 12px;font-weight:800;font-size:12px;text-align:right;color:#374151;vertical-align:middle">Sous-total</td>'+
      '<td class="fact-ligne-total" style="padding:8px 10px;text-align:right;font-weight:800;font-family:monospace;white-space:nowrap;vertical-align:middle;color:#0f172a">'+formatDZD(0)+'</td>'+
      DEL+'</tr>';
  }
  // article (default)
  const qte=parseFloat(l.qte||l.quantite)||1;
  const prix=parseFloat(l.prixUnitHT||l.prixUnitaire)||0;
  const total=qte*prix;
  const IS="border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px;font-size:12px;background:#fff;text-align:right;width:100%;box-sizing:border-box;outline:none";
  const TA="width:100%;border:none;border-radius:0;padding:6px 8px;font-size:12px;background:transparent;resize:none;overflow:hidden;min-height:34px;line-height:1.5;box-sizing:border-box;display:block;outline:none";
  const on="oninput=\"factureEditorCalcRow(this.closest('tr'));factureEditorCalcTotals()\"";
  const unite=l.unite||"Mois";
  const uniteOpts=DEVIS_UNITES.map(u=>'<option value="'+escapeHTML(u)+'" '+(unite===u?"selected":"")+'>'+escapeHTML(u)+'</option>').join("");
  const SEL="border:1px solid #e5e7eb;border-radius:4px;padding:5px 6px;font-size:12px;background:#fff;width:100%;box-sizing:border-box;outline:none";
  const total2=qte*prix;
  return '<tr class="fact-ligne-row" data-type="article"'+(l.catalogKey?' data-catalog-key="'+escapeHTML(l.catalogKey)+'" data-contract-quantity="'+Number(l.contractQuantity??l.qte??1)+'"':'')+(l.siteNom?' data-site-nom="'+escapeHTML(l.siteNom)+'"':'')+' style="border-bottom:1px solid #f1f5f9">'+
    '<td style="padding:0;vertical-align:top;border-right:1px solid #f1f5f9"><textarea class="fact-ligne-desig" style="'+TA+'" rows="1" placeholder="Ajouter / créer un article" oninput="devisEditorAutoResize(this)">'+escapeHTML(l.designation||"")+'</textarea>'+(l.siteNom?'<small style="display:block;padding:0 8px 6px;color:#64748b">'+escapeHTML(l.siteNom)+'</small>':'')+'</td>'+
    '<td style="padding:4px 6px;vertical-align:top;border-right:1px solid #f1f5f9;width:90px"><select class="fact-ligne-unite" data-previous-unit="'+escapeHTML(unite)+'" onchange="factureEditorUnitChange(this)" style="'+SEL+'">'+uniteOpts+'</select></td>'+
    '<td style="padding:4px 6px;vertical-align:top;border-right:1px solid #f1f5f9;width:140px"><input type="text" inputmode="decimal" class="fact-ligne-prix" '+(l.catalogKey?'readonly title="Tarif du contrat Commercial" ':'')+'style="'+IS+'" value="'+formatPrixHT(prix)+'" oninput="factureEditorCalcRow(this.closest(\'tr\'));factureEditorCalcTotals()" onblur="this.value=formatPrixHT(parseFrNum(this.value))" placeholder="0,00"/></td>'+
    '<td style="padding:4px 6px;vertical-align:top;border-right:1px solid #f1f5f9;width:90px"><input type="number" min="0" step="0.01" class="fact-ligne-qte" style="'+IS+'" value="'+qte+'" '+on+'/></td>'+
    '<td style="padding:6px 10px;text-align:right;font-weight:600;white-space:nowrap;color:#0f172a;vertical-align:top;border-right:1px solid #f1f5f9;width:130px" class="fact-ligne-total">'+formatDZD(total2)+'</td>'+
    DEL+
    '</tr>';
}

function factureEditorDayCount(start,end){
  const parse=value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||""))return NaN;
    const ms=Date.parse(value+"T00:00:00Z");
    return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:NaN;
  };
  const a=parse(start),b=parse(end);
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?(b-a)/86400000+1:0;
}

function factureEditorUnitChange(select){
  const invoice=(db.factures||[]).find(f=>f.id===window.__factureEditId);
  if(select.disabled||(invoice?.statut&&invoice.statut!=="brouillon"))return;
  if(select.value!=="Jour"){select.dataset.previousUnit=select.value;return;}
  const row=select.closest(".fact-ligne-row");
  if(!row||row.parentElement!==document.getElementById("fact-lignes-body"))return;
  // Keep the previous unit until confirmation, including when the dialog is dismissed.
  select.value=select.dataset.previousUnit||"Mois";
  const designation=row.querySelector(".fact-ligne-desig");
  const suffix=/\nPériode du (\d{2})\/(\d{2})\/(\d{4}) au (\d{2})\/(\d{2})\/(\d{4})$/;
  const previous=designation.value.match(suffix);
  const start=previous?previous[3]+"-"+previous[2]+"-"+previous[1]:"";
  const end=previous?previous[6]+"-"+previous[5]+"-"+previous[4]:"";
  openModal('<form id="fact-days-form" novalidate style="max-width:480px;margin:auto"><h3 style="margin:0 0 16px">Période à facturer en jours</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Du<input id="fact-days-start" class="input" type="date" required value="'+start+'"></label><label>Au<input id="fact-days-end" class="input" type="date" required value="'+end+'"></label></div><p id="fact-days-count" aria-live="polite" style="font-weight:700;margin:16px 0"></p><p id="fact-days-error" role="alert" style="color:#b91c1c;font-size:12px;margin:0"></p><p style="font-size:12px;color:#64748b">Jours calendaires, dates de début et de fin incluses.</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button id="fact-days-validate" class="btn btn-primary" type="submit">Valider</button></div></form>');
  const form=document.getElementById("fact-days-form"),from=form.querySelector("#fact-days-start"),to=form.querySelector("#fact-days-end");
  const update=()=>{
    const count=factureEditorDayCount(from.value,to.value);
    // Do not mutate native date constraints during typing: browsers may reset the active date segment.
    // The range is checked above and again on submit, once both dates are complete.
    form.querySelector("#fact-days-count").textContent=count?count+" jour"+(count>1?"s":""):"Sélectionnez une période valide.";
    form.querySelector("#fact-days-error").textContent="";
    return count;
  };
  [from,to].forEach(field=>{field.addEventListener("input",update);field.addEventListener("change",update)});update();
  form.addEventListener("submit",event=>{
    event.preventDefault();const count=update();
    const current=(db.factures||[]).find(f=>f.id===window.__factureEditId);
    if(!count){
      form.querySelector("#fact-days-error").textContent=!from.value||!to.value?"Complétez les deux dates (jour, mois et année).":"La date Au doit être égale ou postérieure à la date Du.";
      (!from.value?from:to).focus();return;
    }
    if(!row.isConnected||select.disabled||(current?.statut&&current.statut!=="brouillon")){
      form.querySelector("#fact-days-error").textContent="Cette ligne n’est plus modifiable. Fermez cette fenêtre et rouvrez le brouillon.";return;
    }
    const fmt=value=>value.split("-").reverse().join("/");
    designation.value=designation.value.replace(suffix,"").trimEnd()+"\nPériode du "+fmt(from.value)+" au "+fmt(to.value);
    row.querySelector(".fact-ligne-qte").value=count;
    select.value="Jour";select.dataset.previousUnit="Jour";
    devisEditorAutoResize(designation);factureEditorCalcTotals();factureEditorUpdateWorkflow();factureEditorScheduleDraft();closeModal();
  });
  from.focus();
}

function factureEditorLigneMove(button,direction){
  const invoice=(db.factures||[]).find(f=>f.id===window.__factureEditId);
  if(invoice?.statut&&invoice.statut!=="brouillon")return;
  const row=button.closest(".fact-ligne-row"),body=document.getElementById("fact-lignes-body");
  if(!row||row.parentElement!==body||![-1,1].includes(direction))return;
  const neighbour=direction===-1?row.previousElementSibling:row.nextElementSibling;
  if(!neighbour?.classList.contains("fact-ligne-row"))return;
  if(direction===-1)body.insertBefore(row,neighbour);else body.insertBefore(neighbour,row);
  factureEditorCatalogSites();
  factureEditorCalcTotals();
  factureEditorUpdateWorkflow();
  factureEditorScheduleDraft();
  const focusButton=button.disabled?row.querySelector('button[data-move]:not(:disabled)'):button;
  focusButton?.focus({preventScroll:true});
}

function factureEditorCalcRow(tr){
  if((tr.dataset.type||"article")!=="article")return;
  const p=parseFrNum(tr.querySelector(".fact-ligne-prix")?.value);
  const q=parseFloat(tr.querySelector(".fact-ligne-qte")?.value)||0;
  const t=tr.querySelector(".fact-ligne-total");
  if(t)t.textContent=formatDZD(q*p);
}

function factureEditorCalcTotals(){
  const body=document.getElementById("fact-lignes-body");
  if(body)body.querySelectorAll(".fact-ligne-row").forEach(row=>{
    const up=row.querySelector('[data-move="-1"]'),down=row.querySelector('[data-move="1"]');
    if(up)up.disabled=!row.previousElementSibling?.classList.contains("fact-ligne-row");
    if(down)down.disabled=!row.nextElementSibling?.classList.contains("fact-ligne-row");
  });
  let totalHT=0;let sectionHT=0;
  document.querySelectorAll(".fact-ligne-row").forEach(tr=>{
    const type=tr.dataset.type||"article";
    if(type==="article"){
      const p=parseFrNum(tr.querySelector(".fact-ligne-prix")?.value);
      const q=parseFloat(tr.querySelector(".fact-ligne-qte")?.value)||0;
      const lt=q*p;const t=tr.querySelector(".fact-ligne-total");if(t)t.textContent=formatDZD(lt);
      totalHT+=lt;sectionHT+=lt;
    } else if(type==="remise"){
      const pct=parseFloat(tr.querySelector(".fact-ligne-remise-pct")?.value)||0;
      const amt=sectionHT*pct/100;
      const t=tr.querySelector(".fact-ligne-total");if(t)t.textContent="-"+formatDZD(amt);
      totalHT-=amt;sectionHT-=amt;
    } else if(type==="soustotal"){
      const t=tr.querySelector(".fact-ligne-total");if(t)t.textContent=formatDZD(sectionHT);
      sectionHT=0;
    }
  });
  const tvaPct=parseFloat(document.getElementById("fact-tva-global")?.value)||19;
  const totalTVA=totalHT*tvaPct/100;
  const ttc=totalHT+totalTVA;
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=formatDZD(v);};
  s("fact-r-ht",totalHT);s("fact-r-tva",totalTVA);s("fact-r-ttc",ttc);s("fact-header-ttc",ttc);
}

function factureComputeLinesTotals(lignes,tvaPct){
  let totalHT=0;let sectionHT=0;
  (lignes||[]).forEach(l=>{
    const type=l.type||"article";
    if(type==="article"){
      const lt=Number(l.totalHT)||((Number(l.qte||l.quantite)||0)*(Number(l.prixUnitHT||l.prixUnitaire)||0));
      totalHT+=lt;sectionHT+=lt;
    }else if(type==="remise"){
      const amt=sectionHT*(Number(l.remisePct)||0)/100;
      l.totalHT=-amt;totalHT-=amt;sectionHT-=amt;
    }else if(type==="soustotal"){
      sectionHT=0;
    }
  });
  const totalTVA=totalHT*(Number(tvaPct)||0)/100;
  return{totalHT,totalTVA,totalTTC:totalHT+totalTVA};
}

function factureEditorLigneAdd(type){
  document.getElementById("fact-add-menu")?.remove();
  const tbody=document.getElementById("fact-lignes-body");if(!tbody)return;
  const emp=tbody.querySelector("#fact-lignes-empty");if(emp)emp.remove();
  const l={type:type||"article"};
  if(!type||type==="article"){l.designation="";l.qte=1;l.prixUnitHT=0;}
  tbody.insertAdjacentHTML("beforeend",factureEditorLigneHTML(l));
  factureEditorCalcTotals();
  tbody.lastElementChild?.querySelector(".fact-ligne-desig,.fact-ligne-remise-pct")?.focus();
}

function factureToggleAddMenu(btn){
  document.getElementById("fact-add-menu")?.remove();
  const wrap=btn.parentElement;wrap.style.position="relative";
  const menu=document.createElement("div");menu.id="fact-add-menu";
  menu.style.cssText="position:absolute;right:0;bottom:calc(100% + 4px);background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:300;min-width:180px;padding:4px 0";
  [["article","📦 Ligne article"],["remise","% Remise"],["soustotal","Σ Sous-total"],["commentaire","💬 Commentaire"]].forEach(([t,label])=>{
    const d=document.createElement("div");
    d.style.cssText="padding:9px 16px;cursor:pointer;font-size:13px;color:#374151;font-weight:500";
    d.onmouseenter=()=>{d.style.background="#f9fafb";};d.onmouseleave=()=>{d.style.background="";};
    d.onclick=()=>factureEditorLigneAdd(t);d.textContent=label;menu.appendChild(d);
  });
  wrap.appendChild(menu);
  facturationModuleTimeout(()=>{document.removeEventListener("click",facturationDismissMenu);document.addEventListener("click",facturationDismissMenu);},0);
}

function factureEditorLigneValider(btn){
  const tr=btn.closest("tr");if(!tr)return;
  const isVal=tr.dataset.validated==="1";
  if(isVal){
    tr.dataset.validated="0";tr.style.opacity="1";
    btn.style.background="#dcfce7";btn.style.color="#16a34a";btn.title="Valider";
  } else {
    tr.dataset.validated="1";tr.style.opacity="0.65";
    btn.style.background="#bbf7d0";btn.style.color="#15803d";btn.title="Dévalider";
  }
}

function factureEditorLigneRemove(btn){
  const tr=btn.closest("tr");
  const siteNom=tr?.dataset?.siteNom;
  tr?.remove();
  factureEditorCatalogSites();factureEditorCatalogRender();factureEditorScheduleDraft();
  if(siteNom){
    const remaining=Array.from(document.querySelectorAll(".fact-ligne-row")).filter(r=>r.dataset.siteNom===siteNom);
    if(remaining.length===0){
      const pill=Array.from(document.querySelectorAll(".fact-site-pill")).find(b=>b.dataset.nom===siteNom);
      if(pill){pill.dataset.selected="";pill.style.background="#fff";pill.style.color="#374151";pill.style.borderColor="#d1d5db";}
    }
  }
  factureEditorCalcTotals();
  const tbody=document.getElementById("fact-lignes-body");
  if(tbody&&!tbody.querySelector(".fact-ligne-row"))tbody.innerHTML='<tr id="fact-lignes-empty"><td colspan="6" style="padding:24px;text-align:center;color:#94a3b8;font-size:12px;font-style:italic">Aucun article — choisissez une prestation dans le catalogue ci-dessus</td></tr>';
}

function factureCalcEcheance(){
  const dateFacture=document.getElementById("fact-date")?.value;
  const echeance=document.getElementById("fact-echeance")?.value||"";
  const echDate=document.getElementById("fact-echDate");
  if(!echDate)return;
  const jours=parseInt(echeance);
  if(!dateFacture||Number.isNaN(jours)){echDate.value="";return;}
  const d=new Date(dateFacture+"T12:00:00");d.setDate(d.getDate()+jours);
  echDate.value=d.toISOString().slice(0,10);
}

function factureClientPaymentDefaults(c,dateFacture){
  const delayLabel=String(c?.delaiPaiement||"").trim();
  const paymentDays=/immédiat|immediat/i.test(delayLabel)?0:(parseInt(delayLabel,10)||0);
  const depositDays=Math.max(0,parseInt(c?.delaiDepotFacture,10)||0);
  const base=dateFacture||today();
  return{
    echeance:paymentDays?paymentDays+" jours":(/immédiat|immediat/i.test(delayLabel)?"0 jours":""),
    modeReglement:c?.modePaiement||"A terme",
    dateDepot:base?addDays(base,depositDays):"",
    dateEcheance:base&&(/immédiat|immediat/i.test(delayLabel)||paymentDays)?addDays(base,paymentDays):"",
    remarque:c?.remarqueFacture||c?.conditionsPaiement||""
  };
}

function factureCommercialArticles(client){
  const prices=clientCatalogMap(client),items=[],used=new Set();
  const append=(line,key,siteNom,price)=>{
    const designation=String(line.designation||"").trim();if(!designation)return;
    const q=Number(line.qte??line.quantite??1);
    items.push({catalogKey:JSON.stringify([String(client.id),key]),designation,siteNom,
      prixUnitHT:Number(price)||0,qte:Number.isFinite(q)&&q>0?q:1,
      unite:line.unite||"Mois"});
  };
  (client.tech_sites||[]).forEach((site,i)=>{
    (site.lignesFacturation||[]).forEach((line,j)=>{
      used.add(line.designation);
      append(line,"site:"+i+":"+j,site.denomination||site.nom||("Site "+(i+1)),prices[line.designation]);
    });
  });
  (client.lignesFacturation||[]).forEach((line,i)=>{
    if(line.qte!=null||!used.has(line.designation))append(line,"catalogue:"+i,"",line.prixUnitaire);
  });
  return items;
}

function factureEditorCatalogRender(){
  const el=document.getElementById("fact-commercial-catalog");if(!el)return;
  const invoice=(db.factures||[]).find(f=>f.id===window.__factureEditId);
  if(invoice&&invoice.statut&&invoice.statut!=="brouillon"){el.hidden=true;return;}
  const client=(db.clients||[]).find(c=>String(c.id)===String(document.getElementById("fact-clientId")?.value));
  if(!client||(mySoc()&&client.societe!==mySoc())){el.innerHTML='<p>Choisissez un client pour afficher ses prestations commerciales.</p>';return;}
  const items=factureCommercialArticles(client);
  const current=el.querySelector('select')?.value||"";
  const sites=[...new Set(items.map(x=>x.siteNom).filter(Boolean))];
  const filter=sites.includes(current)?current:"";
  const selected=new Set([...document.querySelectorAll('.fact-ligne-row[data-catalog-key]')].map(r=>r.dataset.catalogKey));
  el.innerHTML='<header><div><h3>Prestations du contrat Commercial</h3><p>Cliquez sur Ajouter. La quantité contractuelle est préremplie et reste ajustable pour la période facturée.</p></div><label>Site <select onchange="factureEditorCatalogRender()"><option value="">Tous les sites</option>'+sites.map(n=>'<option '+(n===filter?'selected ':'')+'value="'+escapeHTML(n)+'">'+escapeHTML(n)+'</option>').join('')+'</select></label></header><div class="fact-catalog-grid">'+
    items.map((item,i)=>({item,i})).filter(({item})=>!filter||item.siteNom===filter).map(({item,i})=>{
      const added=selected.has(item.catalogKey),missing=item.prixUnitHT<=0;
      return '<div class="fact-catalog-card"><strong>'+escapeHTML(item.designation)+'</strong><small>'+escapeHTML(item.siteNom||"Catalogue client")+'</small><b>'+formatDZD(item.prixUnitHT)+' HT / '+escapeHTML(item.unite)+'</b><span>Quantité contrat : '+item.qte+'</span><button type="button" '+(added||missing?'disabled ':'')+'onclick="factureEditorCatalogAdd('+i+')">'+(added?'Déjà ajouté':missing?'Tarif à compléter dans Commercial':'+ Ajouter')+'</button></div>';
    }).join('')+(items.length?'':'<p>Aucune prestation disponible dans le contrat Commercial.</p>')+'</div>';
}

function factureEditorCatalogSites(){
  const input=document.getElementById('fact-siteNom');
  if(input)input.value=[...new Set([...document.querySelectorAll('.fact-ligne-row[data-site-nom]')].map(r=>r.dataset.siteNom).filter(Boolean))].join(', ');
}

function factureEditorCatalogAdd(index){
  const invoice=(db.factures||[]).find(f=>f.id===window.__factureEditId);
  if(invoice&&invoice.statut&&invoice.statut!=="brouillon")return;
  const client=(db.clients||[]).find(c=>String(c.id)===String(document.getElementById("fact-clientId")?.value));
  if(!client||(mySoc()&&client.societe!==mySoc()))return;
  const item=factureCommercialArticles(client)[index];
  const body=document.getElementById('fact-lignes-body');
  if(!body||!item||item.prixUnitHT<=0||[...body.querySelectorAll('[data-catalog-key]')].some(r=>r.dataset.catalogKey===item.catalogKey))return;
  document.getElementById('fact-lignes-empty')?.remove();
  body.insertAdjacentHTML('beforeend',factureEditorLigneHTML({...item,contractQuantity:item.qte}));
  body.querySelectorAll('.fact-ligne-desig').forEach(devisEditorAutoResize);
  factureEditorCatalogSites();factureEditorCalcTotals();factureEditorCatalogRender();factureEditorScheduleDraft();
}

function factureEditorClientChange(sel){
  const c=(db.clients||[]).find(x=>x.id===sel.value);if(!c)return;
  const sv=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v||"";};
  sv("fact-clientNom",c.nom||"");sv("fact-adresse",c.adresseClient||c.adresse||"");
  sv("fact-nif",c.nif||"");sv("fact-rc",c.rc||"");sv("fact-email",c.email||"");
  sv("fact-siteNom","");
  const defaults=factureClientPaymentDefaults(c,document.getElementById("fact-date")?.value||today());
  sv("fact-echeance",defaults.echeance);sv("fact-mode",defaults.modeReglement);
  sv("fact-dateDepot",defaults.dateDepot);sv("fact-echDate",defaults.dateEcheance);
  sv("fact-remarque",defaults.remarque);
  // Objet ← Prestations et Services Fournis
  const objetEl=document.getElementById("fact-objet");
  if(objetEl){const prest=(c.prestationsServices||"").trim();if(prest)objetEl.value=prest;}
  // Le contrat alimente le catalogue ; seules les prestations choisies entrent en facture.
  factureEditorCatalogRender();
  factureEditorRenderClientInfo(c);
}

function factureEditorRenderClientResults(clients){
  const results=document.getElementById("fact-client-results");
  if(!results)return;
  results.innerHTML=clients.length?clients.map(c=>
    '<button type="button" onmousedown="event.preventDefault();factureEditorChooseClient(\''+jsString(c.id)+'\')" style="display:block;width:100%;padding:9px 12px;border:0;border-bottom:1px solid #f1f5f9;background:#fff;text-align:left;cursor:pointer">'+
    '<span style="display:block;font-size:12px;font-weight:800;color:#0f172a">'+escapeHTML(c.nom||"Client sans nom")+'</span>'+
    '<span style="display:block;font-size:10px;color:#64748b;margin-top:2px">'+escapeHTML([c.rc&&("RC "+c.rc),c.nif&&("NIF "+c.nif)].filter(Boolean).join(" · ")||"Cliquer pour sélectionner")+'</span></button>'
  ).join(""):'<div style="padding:12px;color:#94a3b8;font-size:12px">Aucun client trouvé</div>';
  results.style.display="block";
}

function factureEditorClientSearch(input){
  const hidden=document.getElementById("fact-clientId");if(!hidden)return;
  const selectedName=document.getElementById("fact-clientNom")?.value||"";
  if(input.value.trim()!==selectedName.trim())hidden.value="";
  const q=normalizedSearchText(input.value);
  const clients=(db.clients||[]).filter(c=>(!mySoc()||c.societe===mySoc())&&(!q||normalizedSearchText([c.nom,c.rc,c.nif,c.email].join(" ")).includes(q))).slice(0,12);
  factureEditorRenderClientResults(clients);
  clearTimeout(factureClientSearchTimer);
  factureClientSearchTimer=facturationModuleTimeout(async()=>{try{
    const response=await SGDI.commercial.clientsPage({society:mySoc()||undefined,q:input.value.trim()||undefined,page:1,page_size:20});
    const remote=serverItems(response).map(clientFromApi);
    remote.forEach(c=>sgdiUpsertServerItem("clients",c));
    if(document.activeElement===input)factureEditorRenderClientResults(remote);
  }catch(e){console.warn("Recherche client serveur indisponible",e)}},250);
}

function factureEditorChooseClient(id){
  const c=(db.clients||[]).find(x=>String(x.id)===String(id));if(!c)return;
  const hidden=document.getElementById("fact-clientId"),search=document.getElementById("fact-client-search"),results=document.getElementById("fact-client-results");
  if(hidden&&hidden.value&&hidden.value!==String(c.id)&&document.querySelector('.fact-ligne-row')){
    if(!confirm("Changer de client et retirer les articles de ce brouillon ?"))return;
    document.getElementById('fact-lignes-body').innerHTML='';
    factureEditorCalcTotals();
  }
  if(hidden)hidden.value=c.id;if(search){search.value=c.nom||"";search.style.borderColor="";search.style.background="";}if(results)results.style.display="none";
  factureEditorClientChange({value:c.id});factureEditorScheduleDraft();
}

function factureEditorClientSearchClose(){facturationModuleTimeout(()=>{const r=document.getElementById("fact-client-results");if(r)r.style.display="none";},150);}

function factureEditorNewClient(){
  openModal('<h3 class="font-bold text-lg mb-3">Nouveau client</h3><form onsubmit="event.preventDefault();factureEditorCreateClient(this)"><div class="grid grid-2 gap-3"><div class="col-span-2"><label class="label">Nom / raison sociale *</label><input class="input" name="nom" required autofocus></div><div><label class="label">RC</label><input class="input" name="rc"></div><div><label class="label">NIF</label><input class="input" name="nif"></div><div><label class="label">Téléphone</label><input class="input" name="tel"></div><div><label class="label">E-mail</label><input class="input" type="email" name="email"></div><div class="col-span-2"><label class="label">Adresse</label><input class="input" name="adresse"></div><div><label class="label">Mode de paiement</label><select class="select" name="modePaiement"><option>Virement bancaire</option><option>Chèque</option><option>Espèces</option><option>Traite</option></select></div><div><label class="label">Délai de paiement</label><select class="select" name="delaiPaiement"><option>Paiement immédiat</option><option selected>30 jours</option><option>45 jours</option><option>60 jours</option><option>90 jours</option></select></div><div><label class="label">Dépôt après facturation</label><select class="select" name="delaiDepotFacture"><option value="0">Le jour même</option><option value="1">1 jour</option><option value="3">3 jours</option><option value="5">5 jours</option><option value="7">7 jours</option><option value="15">15 jours</option></select></div><div class="col-span-2"><label class="label">Mention habituelle de facture</label><textarea class="input" name="remarqueFacture" rows="2"></textarea></div></div><div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Créer et sélectionner</button></div></form>');
}

async function factureEditorCreateClient(form){
  const fd=new FormData(form),c={nom:String(fd.get("nom")||"").trim(),societe:mySoc()||"",statut:"actif",rc:String(fd.get("rc")||"").trim(),nif:String(fd.get("nif")||"").trim(),tel:String(fd.get("tel")||"").trim(),email:String(fd.get("email")||"").trim(),adresse:String(fd.get("adresse")||"").trim(),modePaiement:String(fd.get("modePaiement")||"Virement bancaire"),delaiPaiement:String(fd.get("delaiPaiement")||"30 jours"),delaiDepotFacture:String(fd.get("delaiDepotFacture")||"0"),remarqueFacture:String(fd.get("remarqueFacture")||"").trim()};
  if(!c.nom){toast("Le nom du client est obligatoire","error");return}
  try{const saved=clientFromApi(await SGDI.commercial.createClient(clientApiPayload(c)));sgdiUpsertServerItem("clients",saved);closeModal();factureEditorChooseClient(saved.id);toast("Client créé et sélectionné","success")}catch(e){toast("Création impossible : "+(e.message||e),"error")}
}

function factureEditorSelectSite(btn){
  const filter=document.querySelector('#fact-commercial-catalog select');
  if(filter){filter.value=btn.dataset.nom||"";factureEditorCatalogRender();}
}

function factureEditorRenderClientInfo(c){
  const el=document.getElementById("fact-client-info");if(!el)return;
  if(!c){el.innerHTML="";return;}
  const nom=c.nom||document.getElementById("fact-clientNom")?.value||"";
  const rc=c.rc||document.getElementById("fact-rc")?.value||"";
  const nif=c.nif||document.getElementById("fact-nif")?.value||"";
  const adresse=c.adresse||"";
  const ai=c.ai||"";
  el.innerHTML='<div style="margin-top:8px;padding:10px;background:#f8fafc;border-radius:6px;font-size:12px;color:#475569;line-height:1.8">'+
    (adresse?'<div>'+escapeHTML(adresse)+'</div>':"")+
    (rc?'<div>RC: '+escapeHTML(rc)+'</div>':"")+
    (nif?'<div>NIF: '+escapeHTML(nif)+'</div>':"")+
    (ai?'<div>AI: '+escapeHTML(ai)+'</div>':"")+
    '</div>';
}

function factureEditorMarkInvalid(el){
  if(!el)return;
  el.style.borderColor="#ef4444";el.style.background="#fff7f7";
  el.addEventListener("input",()=>{el.style.borderColor="";el.style.background=""},{once:true});
}

function factureEditorValidate(){
  const errors=[];
  const periodStart=document.getElementById("fact-periode-debut"),periodEnd=document.getElementById("fact-periode-fin");
  if(!!periodStart?.value!==!!periodEnd?.value||(periodStart?.value&&periodEnd?.value&&periodStart.value>periodEnd.value)){
    errors.push("Renseignez une période de facturation complète, avec une fin après le début.");
    factureEditorMarkInvalid(periodStart);factureEditorMarkInvalid(periodEnd);
  }
  const client=document.getElementById("fact-clientId");
  const clientSearch=document.getElementById("fact-client-search");
  const objet=document.getElementById("fact-objet");
  if(!client?.value){errors.push("Recherchez puis sélectionnez un client.");factureEditorMarkInvalid(clientSearch);}
  if(!(objet?.value||"").trim()){errors.push("Renseignez l’objet de la facture.");factureEditorMarkInvalid(objet);}
  const rows=Array.from(document.querySelectorAll('.fact-ligne-row[data-type="article"]'));
  if(!rows.length)errors.push("Ajoutez au moins un article.");
  rows.forEach((tr,i)=>{
    const d=tr.querySelector(".fact-ligne-desig"),p=tr.querySelector(".fact-ligne-prix"),q=tr.querySelector(".fact-ligne-qte");
    if(!(d?.value||"").trim()){errors.push("Article "+(i+1)+" : désignation obligatoire.");factureEditorMarkInvalid(d);}
    if(parseFrNum(p?.value)<=0){errors.push("Article "+(i+1)+" : prix unitaire obligatoire.");factureEditorMarkInvalid(p);}
    if((parseFloat(q?.value)||0)<=0){errors.push("Article "+(i+1)+" : quantité obligatoire.");factureEditorMarkInvalid(q);}
  });
  if(errors.length){toast(errors[0],"error");return false;}
  return true;
}

function factureEditorScheduleDraft(){
  const state=document.getElementById("fact-draft-state");if(state)state.textContent="Modifications en attente…";
  clearTimeout(factureDraftTimer);
  factureDraftTimer=setTimeout(()=>{factureDraftTimer=null;factureEditorSave({draft:true,silent:true})},1400);
}

function factureEditorUpdateWorkflow(){
  const clientOk=!!document.getElementById("fact-clientId")?.value;
  const rows=Array.from(document.querySelectorAll('.fact-ligne-row[data-type="article"]'));
  const linesOk=rows.length>0&&rows.every(r=>(r.querySelector(".fact-ligne-desig")?.value||"").trim()&&parseFrNum(r.querySelector(".fact-ligne-prix")?.value)>0&&(parseFloat(r.querySelector(".fact-ligne-qte")?.value)||0)>0);
  const objectOk=!!(document.getElementById("fact-objet")?.value||"").trim();
  [["fact-step-client",clientOk],["fact-step-lines",linesOk],["fact-step-validation",clientOk&&linesOk&&objectOk]].forEach(([id,ok])=>{const e=document.getElementById(id);if(e){e.style.background=ok?"#ecfdf5":"#eff6ff";e.style.color=ok?"#047857":"#1d4ed8";e.style.borderColor=ok?"#a7f3d0":"#bfdbfe"}});
  const b=document.getElementById("fact-validate-btn");if(b){b.disabled=!(clientOk&&linesOk&&objectOk);b.style.opacity=b.disabled?".45":"1";b.title=b.disabled?"Sélectionnez un client, renseignez l’objet et au moins un article complet":""}
}

async function factureEditorSave(options){
  options=options||{};
  const saveState=document.getElementById("fact-draft-state");
  clearTimeout(factureDraftTimer);factureDraftTimer=null;
  const gv=id=>document.getElementById(id)?.value||"";
  const validate=options.validate===true;
  if(validate&&!factureEditorValidate())return null;
  if(validate&&!confirm("Valider et numéroter cette facture ? Après validation, elle sera considérée comme émise."))return null;
  const date=gv("fact-date")||today();
  const dateEcheance=gv("fact-echDate")||"";
  const dateDepot=gv("fact-dateDepot")||"";
  const id=window.__factureEditId;
  db.factures=db.factures||[];
  let existing=db.factures.find(x=>x.id===id);
  const periodeDebut=document.getElementById("fact-periode-debut")?.value??existing?.periodeDebut??"";
  const periodeFin=document.getElementById("fact-periode-fin")?.value??existing?.periodeFin??"";
  const wasValidated=existing&&existing.statut!=="brouillon";
  if(options.draft&&wasValidated){const state=saveState;if(state)state.textContent="Facture validée";return existing;}
  // Le numéro définitif et le passage à "émise" ne sont JAMAIS décidés ici : calculé côté
  // navigateur, un numéro pouvait entrer en collision avec celui d'un autre onglet/session
  // validé au même moment (contrainte d'unicité en base). Le serveur les attribue de façon
  // atomique via /factures/{id}/valider, appelé juste après cet enregistrement des champs.
  const statut=existing?.statut||"brouillon";
  const numero=existing?.numero||gv("fact-numero")||"BROUILLON";
  const remarque=(gv("fact-remarque")||gv("fact-objet")||"").trim();
  const objet=(gv("fact-objet")||gv("fact-remarque")||"").trim();
  const modeReglement=gv("fact-mode")||"A terme";
  const texteSupp=gv("fact-texteSupp");
  const clientId=gv("fact-clientId");
  const clientNom=(gv("fact-clientNom")||"").trim();
  const siteNom=(gv("fact-siteNom")||"").trim();
  const adresseClient=gv("fact-adresse");
  const nif=gv("fact-nif"),rc=gv("fact-rc"),email=gv("fact-email");
  const lignes=[];
  const tvaPct=parseFloat(document.getElementById("fact-tva-global")?.value)||19;
  document.querySelectorAll(".fact-ligne-row").forEach(tr=>{
    const type=tr.dataset.type||"article";
    if(type==="commentaire"){
      const text=(tr.querySelector(".fact-ligne-desig")?.value||"").trim();
      if(text)lignes.push({id:uid("fl"),type:"commentaire",designation:text});
    } else if(type==="remise"){
      const designation=(tr.querySelector(".fact-ligne-desig")?.value||"Remise commerciale").trim();
      const remisePct=parseFloat(tr.querySelector(".fact-ligne-remise-pct")?.value)||0;
      lignes.push({id:uid("fl"),type:"remise",designation,remisePct});
    } else if(type==="soustotal"){
      lignes.push({id:uid("fl"),type:"soustotal"});
    } else {
      const designation=(tr.querySelector(".fact-ligne-desig")?.value||"").trim();
      const unite=tr.querySelector(".fact-ligne-unite")?.value||"";
      const prixUnitHT=parseFrNum(tr.querySelector(".fact-ligne-prix")?.value);
      const qte=parseFloat(tr.querySelector(".fact-ligne-qte")?.value)||0;
      const totalHT=qte*prixUnitHT;
      if(designation||prixUnitHT)lignes.push({id:uid("fl"),type:"article",designation,unite,qte,prixUnitHT,prixUnitaire:prixUnitHT,quantite:qte,tva:tvaPct,totalHT,siteNom:tr.dataset.siteNom||"",catalogKey:tr.dataset.catalogKey||"",contractQuantity:Number(tr.dataset.contractQuantity)||null});
    }
  });
  const totals=factureComputeLinesTotals(lignes,tvaPct);
  const montantHT=totals.totalHT;
  const tvaAmt=totals.totalTVA;
  const montantTTC=totals.totalTTC;
  const echeance=gv("fact-echeance")||"";
  const data={id:existing?.id||id||uid("fc"),numero,date,dateDepot,dateEcheance,periodeDebut,periodeFin,statut,remarque,objet,societe:mySoc()||"",clientId,clientNom,client:clientNom,siteNom,adresseClient,nif,rc,clientRc:rc,email,modeReglement,echeance,texteSupp,lignes,montantHT,totalHT:montantHT,tvaAmt,montantTTC,ttc:montantTTC,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),validatedAt:existing?.validatedAt||""};
  const creating=!existing;
  if(existing){Object.assign(existing,data);}else{db.factures.push(data);window.__factureEditId=data.id;}
  try{
    let saved;
    try{
      saved=await sgdiApi("/api/irongs/collections/factures/items"+(creating?"":"/"+encodeURIComponent(data.id)),{method:creating?"POST":"PUT",body:{data},legacy:false});
    }catch(writeError){
      // Compatibilité avec les anciennes factures stockées avant l'API par élément :
      // si l'identifiant local n'existe pas encore côté serveur, on le crée.
      const missing=/introuvable|not found|404/i.test(String(writeError?.message||writeError||""));
      if(creating||!missing)throw writeError;
      saved=await sgdiApi("/api/irongs/collections/factures/items",{method:"POST",body:{data},legacy:false});
    }
    if(saved&&typeof saved==="object")Object.assign(data,saved);
    if(validate){
      const validated=await sgdiApi("/api/irongs/factures/"+encodeURIComponent(data.id)+"/valider",{method:"POST",legacy:false});
      Object.assign(data,validated);
      if(existing)Object.assign(existing,validated);
      const state=saveState;if(state)state.textContent="Facture validée";
      if(!options.silent)toast("Facture "+validated.numero+" validée et numérotée","success");
      renderView();
      return data;
    }
    const state=saveState;if(state)state.textContent="Enregistré à "+new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    if(!options.silent)toast("Brouillon enregistré","success");
    return data;
  }catch(e){
    const state=saveState;if(state)state.textContent=validate?"Échec de la validation":"Échec de sauvegarde";
    if(!options.silent)toast("Erreur : "+(e.message||e),"error");
    return null;
  }
}

function factureVoirApercu(fId){
  const id=fId||window.__factureEditId;
  let f=id&&id!=="new"?(db.factures||[]).find(x=>x.id===id):null;
  const gv=eid=>document.getElementById(eid)?.value||"";
  const numero=gv("fact-numero")||(f?.numero||"APERÇU");
  const date=gv("fact-date")||f?.date||today();
  const dateEcheance=gv("fact-echDate")||f?.dateEcheance||"";
  const periodeDebut=document.getElementById("fact-periode-debut")?.value??f?.periodeDebut??"";
  const periodeFin=document.getElementById("fact-periode-fin")?.value??f?.periodeFin??"";
  const internalRemark=document.getElementById("fact-remarque")?.value??f?.remarque??"";
  const invoiceSubject=document.getElementById("fact-objet")?.value??f?.objet??"";
  // Older drafts may have copied the internal remark into the subject.
  const publicSubject=invoiceSubject.trim()===internalRemark.trim()?"":invoiceSubject;
  const clientNom=gv("fact-clientNom")||f?.client||f?.clientNom||"";
  const adresse=gv("fact-adresse")||f?.adresseClient||"";
  const nif=gv("fact-nif")||f?.nif||"";
  const rc=gv("fact-rc")||f?.rc||f?.clientRc||"";
  const texteSupp=gv("fact-texteSupp")||f?.texteSupp||"";
  const afficherDate=document.getElementById("fact-afficherDate")?.checked!==false;
  const lignes=[];
  document.querySelectorAll(".fact-ligne-row").forEach(tr=>{
    const type=tr.dataset.type||"article";
    const desig=(tr.querySelector(".fact-ligne-desig")?.value||"").trim();
    if(type==="remise")lignes.push({type,designation:desig||"Remise commerciale",remisePct:parseFloat(tr.querySelector(".fact-ligne-remise-pct")?.value)||0});
    else if(type==="soustotal")lignes.push({type});
    else if(type==="commentaire"){if(desig)lignes.push({type,designation:desig});}
    else{
      const prix=parseFrNum(tr.querySelector(".fact-ligne-prix")?.value);
      const qte=parseFloat(tr.querySelector(".fact-ligne-qte")?.value)||0;
      if(desig||prix)lignes.push({type:"article",designation:desig,unite:tr.querySelector(".fact-ligne-unite")?.value||"",qte,prixUnitHT:prix,prixUnitaire:prix,quantite:qte,totalHT:qte*prix});
    }
  });
  const useLines=lignes.length?lignes:(f?.lignes||[]);
  if(!useLines.length&&(f?.designation||f?.prixUnitaire)){useLines.push({designation:f.designation||"",qte:f.quantite||1,prixUnitHT:f.prixUnitaire||0,prixUnitaire:f.prixUnitaire||0,tva:f.tva||19,totalHT:(f.quantite||1)*(f.prixUnitaire||0)});}
  const tvaPct=parseFloat(document.getElementById("fact-tva-global")?.value)||19;
  const previewTotals=factureComputeLinesTotals(useLines,tvaPct);
  const totalHT=previewTotals.totalHT;
  const totalTVA=previewTotals.totalTVA;
  const totalTTC=previewTotals.totalTTC;
  const DZD=v=>(v||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" DZD";
  const fmtD=v=>v?(()=>{try{return new Date(v).toLocaleDateString("fr-FR");}catch(e){return v;}})():"";
  const soc=mySoc();
  const param=(Array.isArray(db.parametres)?db.parametres.find(p=>p.societe===soc):db.parametres)||{};
  const companyName=param.nomSociete||param.nom||soc||"";
  const companyAddr=param.adresse||"";
  const companyRC=param.rc||"";
  const companyNIF=param.nif||"";
  const companyAI=param.ai||"";
  const companyNIS=param.nis||"";
  const normalizedInvoiceSociety=normalizeSocieteName(soc).toLowerCase();
  const companyLogo=param.logo||(normalizedInvoiceSociety.includes("securite")?"/static/iron-securite-logo.png":normalizedInvoiceSociety.includes("solution")?"/static/iron-solution-logo.png":"");
  const sp=f?factureStatutPaye(f):{paye:0,avoir:0,reste:totalTTC,statut:"emise"};
  const isPaid=sp.statut==="payee";const isLate=sp.statut==="echue";
  const stampLabel=isLate?"EN RETARD":(!isPaid&&totalTTC>0?"NON PAYÉE":"");
  const stampColor=isLate?"#f97316":"#ef4444";
  const tdC="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:10px";
  const thC="padding:8px 10px;background:#edf3f8;color:#425b78;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;text-align:left";
  const lignesRows=useLines.filter(l=>(l.type||"article")!=="soustotal").map((l,i)=>
    '<tr style="background:'+(i%2===0?"#fff":"#f9fafb")+';border-bottom:1px solid #e5e7eb">'+
    '<td style="'+tdC+'">'+escapeHTML(l.designation||"")+(l.type==="remise"?' ('+escapeHTML(String(l.remisePct||0))+' %)':'')+'</td>'+
    '<td style="'+tdC+';text-align:center;color:#6b7280">'+escapeHTML(l.unite||"")+'</td>'+
    '<td style="'+tdC+';text-align:right">'+(l.type==="remise"?'—':DZD(l.prixUnitHT||l.prixUnitaire||0))+'</td>'+
    '<td style="'+tdC+';text-align:center">'+(l.type==="remise"?'—':escapeHTML(String(l.qte||l.quantite||0)))+'</td>'+
    '<td style="'+tdC+';text-align:right;font-weight:700">'+DZD(l.totalHT||0)+'</td>'+
    '</tr>'
  ).join("");
  const montantEnLettres=typeof moneyToFrenchWords==="function"?moneyToFrenchWords(totalTTC):"";
  const statusLabel=String(f?.statut||"brouillon").toLowerCase()==="brouillon"?"BROUILLON":(isPaid?"PAYÉE":(isLate?"EN RETARD":"À PAYER"));
  const statusColor=statusLabel==="PAYÉE"?"#15803d":statusLabel==="EN RETARD"?"#dc2626":statusLabel==="BROUILLON"?"#d97706":"#d97706";
  const qrPayload=["IRON GROUP — FACTURE","Société: "+companyName,"N°: "+numero,"Date: "+fmtD(date),"Client: "+clientNom,"Total TTC: "+DZD(totalTTC),"Statut: "+statusLabel,"Identifiant: "+(f?.id||"APERÇU")].join("\n");
  const html='<div class="modal-box" style="max-width:960px;width:98vw;padding:0;overflow:hidden">'+
    '<style>@media print{@page{size:A4 portrait;margin:9mm}body *{visibility:hidden!important}#fact-print-area,#fact-print-area *{visibility:visible!important}#fact-print-area{position:absolute!important;left:0!important;top:0!important;width:100%!important;max-height:none!important;overflow:visible!important;padding:0!important;background:#fff!important}.modal-bg{position:static!important;background:#fff!important}.fact-pdf-sheet{box-shadow:none!important;border:0!important;min-height:277mm!important}.no-print{display:none!important}}</style>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0">'+
    '<div style="font-weight:800;font-size:14px;color:#0f2d5a">'+escapeHTML(numero)+'</div>'+
    '<div style="display:flex;gap:8px">'+
    '<button onclick="facturePrintApercu()" style="background:#043970;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:800;cursor:pointer">🖨 Imprimer</button>'+
    '<button onclick="factureTelechargerPDF()" style="background:#047857;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:800;cursor:pointer">📥 Télécharger PDF</button>'+
    '<button onclick="closeModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;line-height:1">✕</button>'+
    '</div></div>'+
    '<div id="fact-print-area" style="padding:22px;overflow:auto;max-height:80vh;background:#eef2f7">'+
    '<section class="fact-pdf-sheet" style="position:relative;max-width:794px;min-height:1080px;margin:auto;background:#fff;padding:22px 30px 28px;box-shadow:0 10px 30px rgba(15,23,42,.12);font-family:Arial,Helvetica,sans-serif;color:#172033">'+
    // Issuer details belong to the active company, separately from the recipient.
    '<header style="display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:22px;align-items:center;border-bottom:2px solid #043970;padding-bottom:12px;margin-bottom:12px;break-inside:avoid">'+
    '<div class="fact-issuer-identity" style="display:flex;gap:12px;align-items:center;min-width:0">'+
    (companyLogo?'<img src="'+escapeHTML(companyLogo)+'" style="width:96px;height:96px;object-fit:contain;flex-shrink:0" alt="Logo '+escapeHTML(companyName)+'"/>':"")+
    '<div style="flex:1;min-width:0"><div style="font-weight:900;font-size:15px;color:#043970;text-transform:uppercase;overflow-wrap:anywhere">'+escapeHTML(companyName)+'</div>'+
    '<section class="fact-issuer-details" aria-label="Société émettrice" style="margin-top:6px;font-size:10px;line-height:1.4;overflow-wrap:anywhere">'+
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px 12px">'+
    '<div style="grid-column:1/-1"><b style="color:#64748b">Adresse :</b> '+escapeHTML(companyAddr||"À renseigner")+'</div>'+
    [["RC",companyRC],["AI",companyAI],["NIF",companyNIF],["NIS",companyNIS]].map(([label,value])=>'<div><b style="color:#64748b">'+label+' :</b> '+escapeHTML(String(value||"À renseigner"))+'</div>').join("")+
    '</div></section></div></div>'+
    '<div><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:0"><div><div style="font-size:24px;font-weight:900;color:#043970;letter-spacing:2px">FACTURE</div><div style="display:inline-block;margin-top:6px;padding:4px 9px;border:1px solid '+statusColor+';color:'+statusColor+';border-radius:5px;font-size:9px;font-weight:800;letter-spacing:1px">'+statusLabel+'</div></div>'+
    '<div style="flex-shrink:0"><div id="fact-verification-qr" style="width:58px;height:58px;padding:3px;border:1px solid #dbe3ef;background:#fff"></div><div style="font-size:7px;color:#64748b;text-align:center;margin-top:2px">SCAN FACTURE</div></div></div>'+
    '</div></header>'+
    // Destinataire + info
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:14px;margin-bottom:10px;break-inside:avoid">'+
    '<div style="font-size:11px;color:#374151;line-height:1.45;border-left:3px solid #089eac;background:#f3f8fa;padding:8px 10px;border-radius:0 6px 6px 0">'+
    '<div style="font-size:9px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Facturé à</div>'+
    (clientNom?'<div style="font-weight:900;font-size:13px;color:#111827">'+escapeHTML(clientNom)+'</div>':"")+
    (adresse?'<div>'+escapeHTML(adresse)+'</div>':"")+
    '<div style="display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:3px">'+
    (rc?'<span>RC# '+escapeHTML(rc)+'</span>':"")+
    (nif?'<span>NIF# '+escapeHTML(nif)+'</span>':"")+'</div>'+
    '</div>'+
    '<table style="border-collapse:collapse;font-size:11px;align-self:start;border:1px solid #dbe3ef;border-radius:6px;overflow:hidden">'+
    (afficherDate?'<tr><td style="padding:5px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb;font:10px Arial,Helvetica,sans-serif">Date :</td><td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font:700 10px Arial,Helvetica,sans-serif">'+fmtD(date)+'</td></tr>':"")+
    '<tr><td style="padding:5px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb;font:10px Arial,Helvetica,sans-serif">Numéro :</td><td style="padding:5px 10px;font:700 10px Arial,Helvetica,sans-serif;border-bottom:1px solid #e5e7eb">'+escapeHTML(numero)+'</td></tr>'+
    (dateEcheance?'<tr><td style="padding:5px 10px;color:#6b7280;border-bottom:1px solid #e5e7eb;font:10px Arial,Helvetica,sans-serif">Échéance :</td><td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font:700 10px Arial,Helvetica,sans-serif">'+fmtD(dateEcheance)+'</td></tr>':"")+
    '</table></div>'+
    ((periodeDebut||periodeFin||publicSubject)?'<div class="fact-invoice-context" style="display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin-bottom:10px;padding:8px 10px;border-radius:4px;background:#eef7f8;font-size:10px;line-height:1.4;break-inside:avoid">'+
    ((periodeDebut||periodeFin)?'<div class="fact-billing-period" style="flex:1 1 260px"><b style="color:#425b78">Période de facturation :</b> du '+escapeHTML(fmtD(periodeDebut)||"—")+' au '+escapeHTML(fmtD(periodeFin)||"—")+'</div>':"")+
    (publicSubject?'<div class="fact-invoice-subject" style="flex:1 1 220px;overflow-wrap:anywhere"><b style="color:#425b78">Objet :</b> '+escapeHTML(publicSubject)+'</div>':"")+'</div>':"")+
    // Articles table
    '<table style="width:100%;border-collapse:collapse;margin-bottom:0;border:1px solid #dbe3ef">'+
    '<thead><tr>'+
    '<th style="'+thC+';min-width:200px">Désignation</th>'+
    '<th style="'+thC+';text-align:center;width:80px">Unité</th>'+
    '<th style="'+thC+';text-align:right;width:130px">P.U./HT</th>'+
    '<th style="'+thC+';text-align:center;width:70px">Quantité</th>'+
    '<th style="'+thC+';text-align:right;width:140px">Montant</th>'+
    '</tr></thead><tbody>'+lignesRows+'</tbody>'+
    '<tfoot>'+
    '<tr style="border-top:2px solid #e5e7eb"><td colspan="4" style="padding:7px 10px;text-align:right;font:700 10px Arial,Helvetica,sans-serif;color:#374151">Total HT</td><td style="padding:7px 10px;text-align:right;font:700 10px Arial,Helvetica,sans-serif">'+DZD(totalHT)+'</td></tr>'+
    '<tr><td colspan="4" style="padding:7px 10px;text-align:right;font:10px Arial,Helvetica,sans-serif;color:#374151">Total TVA</td><td style="padding:7px 10px;text-align:right;font:10px Arial,Helvetica,sans-serif">'+DZD(totalTVA)+'</td></tr>'+
    '<tr style="background:#e8f1fb;border-top:2px solid #043970;border-bottom:2px solid #043970"><td colspan="4" style="padding:10px;text-align:right;font:900 10px Arial,Helvetica,sans-serif;color:#043970!important">TOTAL TTC</td><td style="padding:10px;text-align:right;font:900 10px Arial,Helvetica,sans-serif;color:#043970!important;background:#e8f1fb;white-space:nowrap">'+DZD(totalTTC)+'</td></tr>'+
    '</tfoot></table>'+
    (montantEnLettres?
      '<div style="margin-top:14px;padding:10px 14px;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc">'+
      '<span style="font:900 10px Arial,Helvetica,sans-serif;color:#374151;letter-spacing:0.3px">ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE :</span><br>'+
      '<span style="font:italic 700 10px Arial,Helvetica,sans-serif;color:#111827;line-height:1.55">'+escapeHTML(montantEnLettres.toUpperCase()+' DINARS ALGÉRIENS')+'</span>'+
      '</div>':"")+
    (texteSupp?'<div style="margin-top:10px;padding:10px;border:1px solid #e5e7eb;border-radius:4px;font-size:11px;color:#6b7280">'+escapeHTML(texteSupp).replace(/\n/g,"<br>")+'</div>':"")+
    '<div style="display:grid;grid-template-columns:1fr 180px;gap:30px;margin-top:28px;align-items:end"><div style="font-size:9px;color:#64748b;line-height:1.55"><b style="color:#334155">Conditions de règlement</b><br>Mode : '+escapeHTML(f?.modeReglement||"À terme")+(dateEcheance?'<br>Échéance : '+fmtD(dateEcheance):"")+'</div><div style="height:80px;border-top:1px solid #94a3b8;text-align:center;padding-top:7px;font-size:11px;font-weight:800">La Direction Commerciale</div></div>'+
    '<footer style="position:absolute;left:36px;right:36px;bottom:20px;border-top:1px solid #dbe3ef;padding-top:7px;display:flex;justify-content:space-between;font-size:8.5px;color:#64748b"><span>'+escapeHTML(companyName)+'</span><span>Document généré par IRON GROUP · Page 1</span></footer>'+
    '</section></div></div>';
  openModal(html);
  Promise.resolve(typeof sgdiLoadQRLib==="function"?sgdiLoadQRLib():null).then(()=>{
    const target=document.getElementById("fact-verification-qr");if(!target||!window.QRCode)return;
    target.innerHTML="";new QRCode(target,{text:qrPayload,width:50,height:50,colorDark:"#043970",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  }).catch(e=>console.warn("QR facture indisponible",e));
}

function facturePrintApercu(){
  const source=document.getElementById("fact-print-area");if(!source){toast("Aperçu introuvable","error");return}
  const printable=source.cloneNode(true);
  const sourceCanvases=source.querySelectorAll("canvas"),printCanvases=printable.querySelectorAll("canvas");
  printCanvases.forEach((canvas,i)=>{try{const img=document.createElement("img");img.src=sourceCanvases[i].toDataURL("image/png");img.width=sourceCanvases[i].width;img.height=sourceCanvases[i].height;canvas.replaceWith(img)}catch(e){}});
  const popup=window.open("","_blank","width=980,height=900");if(!popup){toast("Autorisez les fenêtres contextuelles pour imprimer","error");return}
  popup.document.open();popup.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><base href="'+escapeHTML(location.origin)+'/"><title>Facture — IRON GROUP</title><style>@page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.fact-pdf-sheet{width:192mm!important;min-height:279mm!important;margin:0 auto!important;padding:6mm 8mm 7mm!important;box-shadow:none!important;border:0!important}img,canvas{max-width:100%}button{display:none!important}</style></head><body>'+printable.innerHTML+'</body></html>');popup.document.close();
  const printWhenReady=()=>{const images=Array.from(popup.document.images);Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve}))).then(()=>setTimeout(()=>{popup.focus();popup.print()},250))};
  if(popup.document.readyState==="complete")printWhenReady();else popup.onload=printWhenReady;
}

async function factureTelechargerPDF(){
  const source=document.getElementById("fact-print-area");if(!source){toast("Aperçu introuvable","error");return}
  const sheet=source.querySelector(".fact-pdf-sheet");if(!sheet){toast("Aperçu introuvable","error");return}
  try{
    if(typeof window.sgdiLoadPDFLibs!=="function")await sgdiLoadFeatureScript("/static/js/features/pdf.js?v=20260908-modular");
    await window.sgdiLoadPDFLibs();
  }catch(e){toast("Génération PDF indisponible : "+(e.message||e),"error");return}
  if(typeof html2canvas==="undefined"||!window.jspdf?.jsPDF){toast("Génération PDF indisponible : librairie non chargée","error");return}
  const clone=sheet.cloneNode(true);
  const sourceCanvases=sheet.querySelectorAll("canvas"),cloneCanvases=clone.querySelectorAll("canvas");
  cloneCanvases.forEach((canvas,i)=>{try{const img=document.createElement("img");img.src=sourceCanvases[i].toDataURL("image/png");img.width=sourceCanvases[i].width;img.height=sourceCanvases[i].height;canvas.replaceWith(img)}catch(e){}});
  clone.style.boxShadow="none";clone.style.margin="0";
  const holder=document.createElement("div");
  holder.style.cssText="position:fixed;left:-9999px;top:0;background:#fff";
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try{
    const canvasEl=await html2canvas(clone,{scale:2,useCORS:true,backgroundColor:"#ffffff"});
    const imgData=canvasEl.toDataURL("image/png");
    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({unit:"mm",format:"a4",orientation:"portrait"});
    const pageWidth=210,pageHeight=297;
    const imgWidth=pageWidth,imgHeight=canvasEl.height*imgWidth/canvasEl.width;
    let heightLeft=imgHeight,position=0;
    pdf.addImage(imgData,"PNG",0,position,imgWidth,imgHeight);
    heightLeft-=pageHeight;
    while(heightLeft>0){
      position=heightLeft-imgHeight;
      pdf.addPage();
      pdf.addImage(imgData,"PNG",0,position,imgWidth,imgHeight);
      heightLeft-=pageHeight;
    }
    const numero=(document.getElementById("fact-numero")?.value||"facture").trim().replace(/[^\w\-]+/g,"_")||"facture";
    pdf.save("Facture_"+numero+".pdf");
  }catch(e){
    console.error("Erreur génération PDF facture",e);
    toast("Erreur lors de la génération du PDF : "+(e.message||e),"error");
  }finally{
    holder.remove();
  }
}

function renderFactureEditor(view){
  facturationLeaveEditor();
  // Ne jamais hériter du verrou global ATLAS dans fac.irongs.com. Le statut de la
  // facture est le seul arbitre de l'édition dans ce module autonome.
  if(window.__FAC_AUTONOMOUS_APP__){sgdiViewModeActive=false;document.body.classList.remove("sgdi-view-mode");}
  const id=window.__factureEditId;const isNew=!id||id==="new";
  let f=isNew?null:(db.factures||[]).find(x=>x.id===id);
  if(!f){const nid=uid("fc");f={id:nid,numero:"BROUILLON",date:today(),societe:mySoc()||"",dateEcheance:"",statut:"brouillon",clientId:"",clientNom:"",client:"",adresseClient:"",nif:"",rc:"",email:"",remarque:"",objet:"",lignes:[],montantHT:0,tvaAmt:0,montantTTC:0,ttc:0,modeReglement:"A terme",afficherDate:true,texteSupp:"",createdAt:new Date().toISOString()};if(isNew)window.__factureEditId=f.id;}
  let lignes=f.lignes&&f.lignes.length?f.lignes:[];
  if(!lignes.length&&(f.designation||f.prixUnitaire)){const pu=f.prixUnitaire||0,q=f.quantite||1;lignes=[{id:uid("fl"),designation:f.designation||f.objet||"",qte:q,prixUnitHT:pu,prixUnitaire:pu,quantite:q,tva:f.tva||19,totalHT:q*pu}];}
  const sp=isNew?{paye:0,avoir:0,reste:0,statut:"emise"}:factureStatutPaye(f);
  const paiements=(db.paiements||[]).filter(p=>p.factureId===f.id);
  const avoirs=(db.avoirs||[]).filter(a=>a.factureId===f.id);
  const clients=(db.clients||[]).filter(c=>!mySoc()||c.societe===mySoc());
  const selClient=clients.find(c=>c.id===f.clientId||c.nom===f.client||c.nom===f.clientNom);
  const modes=["A terme","Virement bancaire","Chèque","Espèces","Carte bancaire","Traite","Prélèvement automatique","Mixte"];
  const modeOpts=modes.map(m=>'<option '+(f.modeReglement===m?"selected":"")+'>'+escapeHTML(m)+'</option>').join("");
  const lignesHTML=lignes.map(l=>factureEditorLigneHTML(l)).join("");
  const lignesEmpty=lignes.length===0;
  const thL="padding:10px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:2px solid #e5e7eb;background:#f9fafb;text-align:left";
  const LB="display:block;font-size:11px;color:#6b7280;margin-bottom:4px";
  const INP="border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px;font-size:13px;width:100%;box-sizing:border-box;outline:none;background:#fff";
  const sd=factStatutDisplay(f);
  const isDraft=!f.statut||String(f.statut).toLowerCase()==="brouillon";
  const FL='display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px;align-items:center;margin-bottom:7px';
  const FS='font-size:11px;color:#334155;font-weight:900;line-height:1.15';
  const FI='height:25px;min-height:25px;padding:2px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;outline:none;background:#fff;box-shadow:inset 0 1px 2px rgba(15,23,42,.06)';
  const fl=(lbl,inp)=>'<div style="'+FL+'"><span style="'+FS+'">'+lbl+'</span>'+inp+'</div>';
  view.innerHTML=
    // BREADCRUMB + TABS (sticky)
    '<div style="position:sticky;top:0;z-index:50;background:#f1f5f9;padding-bottom:2px;margin-bottom:10px">'+
    '<div class="fact-editor-summary"><div class="fact-editor-breadcrumb">'+
    '<a onclick="factureEditorClose()" style="color:#f59e0b;font-weight:700;cursor:pointer;text-decoration:none">Factures</a>'+
    '<span>/</span><span style="color:#111827;font-weight:700">'+(isDraft?"Brouillon":escapeHTML(f.numero||"Facture"))+'</span>'+
    (!isDraft?' <span style="margin-left:6px;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:'+sd.bg+';color:'+sd.color+'">'+escapeHTML(sd.label)+'</span>':"")+
    '</div><div class="fact-editor-live-total"><span>Total TTC</span><output id="fact-header-ttc" aria-live="polite" aria-atomic="true">'+formatDZD(0)+'</output></div>'+
    '<button type="button" onclick="factureEditorOpen()" style="margin-left:auto;background:#043970;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 2px 6px rgba(4,57,112,.2)">+ Nouvelle facture</button>'+
    '</div>'+
    factTabs("factures")+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">'+
    ['1 · Client','2 · Articles et calculs','3 · Aperçu et validation'].map((x,i)=>'<div id="'+['fact-step-client','fact-step-lines','fact-step-validation'][i]+'" style="padding:7px 10px;border-radius:6px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800;text-align:center;border:1px solid #bfdbfe">'+x+'</div>').join('')+
    '</div><div id="fact-draft-state" style="font-size:10px;color:#64748b;text-align:right;padding-top:4px">'+(isDraft?'Brouillon sauvegardé automatiquement':'Facture validée')+'</div>'+
    '</div>'+
    // MAIN LAYOUT
    '<div class="rh-op-layout" style="align-items:start">'+
    // LEFT COLUMN
    '<div>'+
    // Client fieldset
    '<fieldset class="rh-op-box" style="margin-bottom:10px">'+
    '<legend>Client</legend>'+
    '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">'+
    '<div style="position:relative;flex:1"><input type="hidden" id="fact-clientId" value="'+escapeHTML(f.clientId||selClient?.id||"")+'"><input id="fact-client-search" class="input" autocomplete="off" value="'+escapeHTML(selClient?.nom||f.client||f.clientNom||"")+'" placeholder="Rechercher par nom, RC ou NIF…" onfocus="factureEditorClientSearch(this)" oninput="factureEditorClientSearch(this)" onblur="factureEditorClientSearchClose()" style="width:100%;height:34px!important;font-size:12px!important;padding-right:34px"><span style="position:absolute;right:11px;top:8px;color:#64748b;pointer-events:none">⌕</span><div id="fact-client-results" style="display:none;position:absolute;top:38px;left:0;right:0;z-index:80;max-height:280px;overflow:auto;background:#fff;border:1px solid #cbd5e1;border-radius:7px;box-shadow:0 12px 30px rgba(15,23,42,.16)"></div></div>'+
    '<a onclick="factureEditorNewClient()" style="color:#f59e0b;font-weight:700;cursor:pointer;font-size:12px;white-space:nowrap">+ NOUVEAU CLIENT</a>'+
    '</div>'+
    '<input type="hidden" id="fact-clientNom" value="'+escapeHTML(f.client||f.clientNom||"")+'">'+
    '<input type="hidden" id="fact-adresse" value="'+escapeHTML(f.adresseClient||"")+'">'+
    '<input type="hidden" id="fact-nif" value="'+escapeHTML(f.nif||"")+'">'+
    '<input type="hidden" id="fact-rc" value="'+escapeHTML(f.rc||f.clientRc||"")+'">'+
    '<input type="hidden" id="fact-email" value="'+escapeHTML(f.email||"")+'">'+
    '<input type="hidden" id="fact-siteNom" value="'+escapeHTML(f.siteNom||"")+'">'+
    '<div id="fact-site-selector"></div>'+
    '<div id="fact-client-info"></div>'+
    '</fieldset>'+
    // Objet fieldset
    '<fieldset class="rh-op-box" style="margin-bottom:10px">'+
    '<legend>Objet de la facture</legend>'+
    '<input id="fact-objet" class="input" style="width:100%" value="'+escapeHTML(f.objet||f.remarque||"")+'" placeholder="Ex: Prestation de gardiennage — Période : Mars 2026">'+
    '</fieldset>'+
    '<section id="fact-commercial-catalog" class="fact-commercial-catalog"'+(isDraft?'':' hidden')+'></section>'+
    // Articles fieldset
    '<fieldset class="rh-op-box" style="margin-bottom:10px;padding:0;overflow:hidden">'+
    '<legend style="margin-left:12px;padding-top:2px">Articles</legend>'+
    '<div style="overflow-x:auto"><table class="fact-editor-lines '+(isDraft?'':'fact-lines-readonly')+'" style="width:100%;border-collapse:collapse;min-width:900px">'+
    '<thead><tr>'+
    '<th style="'+thL+';min-width:180px">Désignation</th>'+
    '<th style="'+thL+';width:90px">Unité</th>'+
    '<th style="'+thL+';text-align:right;width:140px">Prix unitaire</th>'+
    '<th style="'+thL+';text-align:center;width:90px">Quantité</th>'+
    '<th style="'+thL+';text-align:right;width:140px">Total</th>'+
    '<th style="'+thL+';width:140px;text-align:center">Actions</th>'+
    '</tr></thead>'+
    '<tbody id="fact-lignes-body">'+
    (lignesEmpty?'<tr id="fact-lignes-empty"><td colspan="6" style="padding:20px;text-align:center;color:#9ca3af;font-size:12px;font-style:italic">Choisissez les prestations à facturer dans le catalogue ci-dessus</td></tr>':lignesHTML)+
    '</tbody>'+
    '</table></div>'+
    '<div style="padding:10px 14px;border-top:1px solid #e5e7eb;background:#f9fafb">'+
    '<a onclick="factureEditorLigneAdd()" style="color:#f59e0b;font-weight:700;cursor:pointer;font-size:12px">+ Ajouter / créer un article</a>'+
    '</div>'+
    '<div style="border-top:1px solid #e5e7eb">'+
    '<div style="display:flex;justify-content:space-between;padding:7px 14px;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;font-weight:700;color:#334155">Total HT</span><span id="fact-r-ht" style="font-size:12px;font-weight:700;font-family:monospace">'+formatDZD(f.montantHT||f.totalHT||0)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;border-bottom:1px solid #f3f4f6">'+
    '<span style="font-size:12px;font-weight:700;color:#334155;display:flex;align-items:center;gap:6px">Total TVA'+
    '<span style="display:inline-flex;align-items:center;gap:2px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;color:#0f2d5a">'+
    '<input id="fact-tva-global" type="number" min="0" max="100" step="0.01" value="'+(f.tva||19)+'" oninput="factureEditorCalcTotals()" style="width:34px;border:none;background:transparent;font-size:11px;font-weight:700;color:#0f2d5a;text-align:right;outline:none;padding:0">'+
    '<span>%</span></span></span>'+
    '<span id="fact-r-tva" style="font-size:12px;font-family:monospace;font-weight:600">'+formatDZD(f.tvaAmt||0)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:9px 14px;background:#eff6ff"><span style="font-size:13px;font-weight:800;color:#043970">Total TTC</span><span id="fact-r-ttc" style="font-size:14px;font-weight:900;font-family:monospace;color:#043970">'+formatDZD(f.ttc||f.montantTTC||0)+'</span></div>'+
    '</div>'+
    '<div style="padding:9px 14px;border-top:1px solid #e5e7eb;text-align:right">'+
    '<a onclick="factureToggleAddMenu(this)" style="color:#f59e0b;font-weight:700;cursor:pointer;font-size:11px;text-decoration:underline">AJOUTER ▾</a>'+
    '</div>'+
    '</fieldset>'+
    // Texte supplémentaire
    '<fieldset class="rh-op-box" style="margin-bottom:10px">'+
    '<legend>Observations</legend>'+
    '<textarea id="fact-texteSupp" class="input" style="width:100%;resize:vertical;min-height:60px;font-size:12px;line-height:1.6;height:auto!important" placeholder="Texte libre (apparaîtra sur la facture)...">'+escapeHTML(f.texteSupp||"")+'</textarea>'+
    '</fieldset>'+
    // Paiements history
    (paiements.length>0?
    '<fieldset class="rh-op-box" style="margin-bottom:10px">'+
    '<legend style="color:#059669">Historique des paiements</legend>'+
    '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="background:#f0fdf4"><th style="padding:5px 8px;text-align:left;color:#059669;font-size:11px">Date</th><th style="padding:5px 8px;text-align:left;color:#059669;font-size:11px">Mode</th><th style="padding:5px 8px;text-align:left;color:#059669;font-size:11px">Référence</th><th style="padding:5px 8px;text-align:right;color:#059669;font-size:11px">Montant</th></tr></thead>'+
    '<tbody>'+paiements.map(p=>'<tr style="border-bottom:1px solid #f0fdf4"><td style="padding:5px 8px">'+formatDate(p.date)+'</td><td style="padding:5px 8px">'+escapeHTML(p.mode||"")+'</td><td style="padding:5px 8px;font-size:11px;color:#6b7280">'+escapeHTML(p.reference||"—")+'</td><td style="padding:5px 8px;text-align:right;font-weight:700;color:#059669;font-family:monospace">'+money(p.montant)+'</td></tr>').join("")+
    '</tbody></table></fieldset>':"" )+
    (avoirs.length>0?
    '<fieldset class="rh-op-box" style="margin-bottom:10px">'+
    '<legend style="color:#7c3aed">Avoirs</legend>'+
    '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="background:#fdf4ff"><th style="padding:5px 8px;text-align:left;color:#7c3aed;font-size:11px">Date</th><th style="padding:5px 8px;text-align:left;color:#7c3aed;font-size:11px">N° Avoir</th><th style="padding:5px 8px;text-align:left;color:#7c3aed;font-size:11px">Motif</th><th style="padding:5px 8px;text-align:right;color:#7c3aed;font-size:11px">Montant</th></tr></thead>'+
    '<tbody>'+avoirs.map(a=>'<tr style="border-bottom:1px solid #fdf4ff"><td style="padding:5px 8px">'+formatDate(a.date)+'</td><td style="padding:5px 8px;font-family:monospace">'+escapeHTML(a.numero||"")+'</td><td style="padding:5px 8px;font-size:11px">'+escapeHTML(a.motif||"")+'</td><td style="padding:5px 8px;text-align:right;font-weight:700;color:#7c3aed;font-family:monospace">'+money(a.montant)+'</td></tr>').join("")+
    '</tbody></table></fieldset>':"" )+
    '</div>'+
    // RIGHT SIDEBAR
    '<div>'+
    '<fieldset class="rh-op-box" style="position:sticky;top:10px">'+
    '<legend>Informations</legend>'+
    fl('Référence','<input id="fact-numero" readonly style="'+FI+';font-family:monospace;font-weight:700;background:#f8fafc" value="'+escapeHTML(f.numero||"BROUILLON")+'">') +
    fl('Date facture','<input id="fact-date" type="date" style="'+FI+'" value="'+escapeHTML(f.date||today())+'" onchange="factureCalcEcheance()">') +
    '<fieldset style="margin:10px 0;padding:9px;border:1px solid #cbd5e1;border-radius:6px"><legend style="padding:0 4px;font-size:11px;font-weight:800;color:#334155">Période de facturation</legend>'+
    fl('Du','<input id="fact-periode-debut" aria-label="Début de période de facturation" type="date" style="'+FI+'" value="'+escapeHTML(f.periodeDebut||"")+'">')+
    fl('Au','<input id="fact-periode-fin" aria-label="Fin de période de facturation" type="date" style="'+FI+'" value="'+escapeHTML(f.periodeFin||"")+'">')+'</fieldset>'+
    fl('Délai paiement',
      '<select id="fact-echeance" style="'+FI+'" onchange="factureCalcEcheance()">'+
      ['','0 jours','15 jours','30 jours','45 jours','60 jours','90 jours'].map(v=>'<option value="'+v+'" '+(f.echeance===v?'selected':'')+'>'+(v==='0 jours'?'Paiement immédiat':(v||'— Sans —'))+'</option>').join("")+
      '</select>') +
    fl('Mode paiement','<select id="fact-mode" style="'+FI+'">'+modeOpts+'</select>') +
    fl('Dépôt client','<input id="fact-dateDepot" type="date" style="'+FI+'" value="'+escapeHTML(f.dateDepot||"")+'">') +
    fl('Date échéance','<input id="fact-echDate" type="date" style="'+FI+';background:#f9fafb;color:#6b7280" value="'+escapeHTML(f.dateEcheance||"")+'" readonly>') +
    '<div style="margin-top:6px"><span style="'+FS+'">Remarque</span><textarea id="fact-remarque" class="input" style="width:100%;resize:vertical;min-height:60px;font-size:11px;line-height:1.5;height:auto!important;margin-top:4px" placeholder="SERVICE DE GARDIENNAGE - Période: Mars 2026">'+escapeHTML(f.remarque||f.objet||"")+'</textarea></div>'+
    (!isDraft?
    '<div style="border-top:1px solid #bfdbfe;margin-top:10px;padding-top:8px">'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px"><span style="color:#6b7280;font-weight:700">Montant TTC</span><span style="font-weight:700;font-family:monospace">'+money(f.ttc||f.montantTTC||0)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px"><span style="color:#059669;font-weight:700">Encaissé</span><span style="font-weight:700;color:#059669;font-family:monospace">'+money(sp.paye)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-top:1px solid #e2e8f0;margin-top:4px"><span style="font-weight:800;color:#0f172a">Reste dû</span><span style="font-weight:900;color:'+(sp.reste>0?"#f97316":"#059669")+'">'+money(sp.reste)+'</span></div>'+
    '</div>':"" )+
    '<div style="display:grid;gap:6px;margin-top:12px">'+
    '<button onclick="factureVoirApercu()" style="background:#f8fafc;border:1.5px solid #bfdbfe;border-radius:5px;padding:8px;font-size:12px;font-weight:700;cursor:pointer;color:#1d4ed8;width:100%">Aperçu et imprimer PDF</button>'+
    (isDraft?'<button onclick="factureEditorSave({draft:true})" style="background:#fff;color:#043970;border:1.5px solid #043970;border-radius:5px;padding:9px;font-size:12px;font-weight:700;cursor:pointer;width:100%">Enregistrer le brouillon</button><button id="fact-validate-btn" onclick="factureEditorSave({validate:true})" style="background:#047857;color:#fff;border:none;border-radius:5px;padding:10px;font-size:12px;font-weight:800;cursor:pointer;width:100%">Valider et numéroter</button>':'<div style="padding:8px;border-radius:6px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;text-align:center">Facture validée — lecture seule</div><button onclick="factureDuplicateDraft(\''+f.id+'\')" style="background:#fff;border:1px solid #cbd5e1;border-radius:5px;padding:8px;font-size:12px;font-weight:700;cursor:pointer">Dupliquer en brouillon</button>')+
    (!isDraft&&sp.reste>0?'<button onclick="openPaiementModal(\''+f.id+'\')" style="background:#22c55e;color:#fff;border:none;border-radius:5px;padding:8px;font-size:12px;font-weight:700;cursor:pointer;width:100%">Encaisser</button>':"")+
    (!isDraft?'<button onclick="openAvoirModal(\''+f.id+'\')" style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:5px;padding:8px;font-size:12px;font-weight:600;cursor:pointer;color:#7c3aed;width:100%">Émettre un avoir</button>':"")+
    '</div>'+
    '</fieldset>'+
    '</div>'+
    '</div>';
  factureEditorCalcTotals();
  if(isDraft){
    facturationBindEditor(view);
  }else{
    view.querySelectorAll("input:not([type=hidden]),select,textarea").forEach(el=>{el.disabled=true;el.setAttribute("aria-disabled","true")});
  }
  facturationModuleTimeout(()=>{
    factureEditorCalcTotals();
    factureEditorUpdateWorkflow();
    renderFacStandaloneNav();
    document.querySelectorAll(".fact-ligne-desig").forEach(devisEditorAutoResize);
    if(selClient)factureEditorRenderClientInfo(selClient);
    else if(f.client||f.clientNom){factureEditorRenderClientInfo({nom:f.client||f.clientNom,rc:f.rc||f.clientRc||"",nif:f.nif||""});}
    if(isDraft)factureEditorCatalogRender();
  },0);
}

function renderFactBalance(view){
  const list=bySoc(db.factures||[]).filter(f=>f.statut!=="brouillon");
  const byClient={};
  list.forEach(f=>{
    const client=f.client||f.clientNom||"—";
    if(!byClient[client])byClient[client]={client,total:0,encaisse:0,j0_30:0,j31_60:0,j61_90:0,j90plus:0,nb:0};
    const sp=factureStatutPaye(f);const ttc=f.ttc||f.montantTTC||0;
    byClient[client].total+=ttc;byClient[client].encaisse+=sp.paye;byClient[client].nb++;
    if(sp.reste<=0.01)return;
    const echD=f.date&&f.echeance?addDays(f.date,parseInt(f.echeance)||30):"";
    const age=echD?Math.max(0,daysBetween(echD,today())):0;
    if(age<=30)byClient[client].j0_30+=sp.reste;
    else if(age<=60)byClient[client].j31_60+=sp.reste;
    else if(age<=90)byClient[client].j61_90+=sp.reste;
    else byClient[client].j90plus+=sp.reste;
  });
  const rows=Object.values(byClient).sort((a,b)=>(b.j90plus+b.j61_90+b.j31_60+b.j0_30)-(a.j90plus+a.j61_90+a.j31_60+a.j0_30));
  const totRow={client:"TOTAL",total:0,encaisse:0,j0_30:0,j31_60:0,j61_90:0,j90plus:0,nb:list.length};
  rows.forEach(r=>{totRow.total+=r.total;totRow.encaisse+=r.encaisse;totRow.j0_30+=r.j0_30;totRow.j31_60+=r.j31_60;totRow.j61_90+=r.j61_90;totRow.j90plus+=r.j90plus;});
  const thS="padding:9px 10px;font-size:10px;font-weight:800;color:#fff;text-transform:uppercase;white-space:nowrap;border-bottom:2px solid #1e3a5f;text-align:right";
  const td=(v,c)=>'<td style="padding:7px 10px;text-align:right;font-size:11px;font-family:monospace;font-weight:700;color:'+(c||"#1e293b")+'">'+(v>0.01?money(v):"—")+'</td>';
  const renderRow=(r,isTot)=>'<tr style="border-bottom:1px solid #f1f5f9;'+(isTot?"background:#f8fafc;font-weight:800;":"")+'">'+
    '<td style="padding:7px 10px;font-size:12px;font-weight:700;color:#0f2d5a">'+escapeHTML(r.client)+'</td>'+
    '<td style="padding:7px 10px;text-align:center;font-size:11px;color:#64748b">'+r.nb+'</td>'+
    td(r.total,"#0f2d5a")+td(r.encaisse,"#059669")+
    td(r.j0_30,r.j0_30>0?"#1d4ed8":"#94a3b8")+
    td(r.j31_60,r.j31_60>0?"#d97706":"#94a3b8")+
    td(r.j61_90,r.j61_90>0?"#ea580c":"#94a3b8")+
    td(r.j90plus,r.j90plus>0?"#dc2626":"#94a3b8")+
    '</tr>';
  view.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
    '<div><h1 style="font-size:22px;font-weight:900;color:#0f2d5a">Balance agée des créances</h1>'+
    '<p style="font-size:12px;color:#64748b;margin-top:2px">Ancienneté des factures impayées par client</p></div></div>'+
    factTabs("balance")+
    '<div class="card" style="overflow:auto">'+
    '<table style="width:100%;border-collapse:collapse">'+
    '<thead><tr style="background:#0f2d5a">'+
    '<th style="padding:9px 10px;font-size:10px;font-weight:800;color:#fff;text-transform:uppercase;border-bottom:2px solid #1e3a5f;text-align:left">Client</th>'+
    '<th style="'+thS+';text-align:center">Factures</th>'+
    '<th style="'+thS+'">Total facturé</th>'+
    '<th style="'+thS+'">Encaissé</th>'+
    '<th style="'+thS+';background:#1e40af">0–30 jours</th>'+
    '<th style="'+thS+';background:#92400e">31–60 jours</th>'+
    '<th style="'+thS+';background:#9a3412">61–90 jours</th>'+
    '<th style="'+thS+';background:#7f1d1d">> 90 jours</th>'+
    '</tr></thead>'+
    '<tbody>'+rows.map(r=>renderRow(r,false)).join("")+renderRow(totRow,true)+'</tbody>'+
    '</table></div>';
}

function renderFactCompteClient(view,clientEnc){
  const clientNom=decodeURIComponent(clientEnc||"");
  const factures=(db.factures||[]).filter(f=>f.statut!=="brouillon"&&(f.client||f.clientNom||"")===(clientNom)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const paiements=(db.paiements||[]).filter(p=>factures.some(f=>f.id===p.factureId)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  let totFact=0,totEnc=0;
  factures.forEach(f=>{totFact+=(f.ttc||f.montantTTC||0);const sp=factureStatutPaye(f);totEnc+=sp.paye;});
  const solde=totFact-totEnc;
  const thS="padding:8px 10px;font-size:10px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;text-transform:uppercase;white-space:nowrap";
  view.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
    '<div><h1 style="font-size:22px;font-weight:900;color:#0f2d5a">Compte client</h1>'+
    '<p style="font-size:14px;font-weight:700;color:#1d4ed8;margin-top:4px">'+escapeHTML(clientNom)+'</p></div>'+
    '<a href="#/facturation/factures" class="btn btn-ghost" style="font-size:12px">← Retour</a></div>'+
    factTabs("factures")+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">'+
    '<div class="card" style="padding:12px"><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Total facturé</div><div style="font-size:20px;font-weight:900;color:#0f2d5a;margin-top:4px">'+money(totFact)+'</div></div>'+
    '<div class="card" style="padding:12px"><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Encaissé</div><div style="font-size:20px;font-weight:900;color:#059669;margin-top:4px">'+money(totEnc)+'</div></div>'+
    '<div class="card" style="padding:12px"><div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Solde dû</div><div style="font-size:20px;font-weight:900;color:'+(solde>0?"#d97706":"#059669")+';margin-top:4px">'+money(solde)+'</div></div>'+
    '</div>'+
    '<div class="card" style="overflow:auto;margin-bottom:12px">'+
    '<div style="padding:10px 14px;font-size:12px;font-weight:800;color:#0f2d5a;border-bottom:1px solid #e2e8f0;background:#f8fafc">FACTURES</div>'+
    (factures.length===0?'<div style="padding:24px;text-align:center;color:#94a3b8">Aucune facture.</div>':
    '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc">'+
    '<th style="'+thS+';text-align:left">N°</th><th style="'+thS+'">Date</th><th style="'+thS+'">Objet</th>'+
    '<th style="'+thS+';text-align:right">TTC</th><th style="'+thS+';text-align:right">Encaissé</th><th style="'+thS+';text-align:right">Reste</th><th style="'+thS+';text-align:center">Statut</th>'+
    '</tr></thead><tbody>'+
    factures.map(f=>{const sp=factureStatutPaye(f);return'<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onclick="factureEditorOpen(\''+f.id+'\')" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'">'+
      '<td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#1d4ed8;font-weight:700">'+safe(f.numero||"")+'</td>'+
      '<td style="padding:7px 10px;font-size:11px">'+formatDate(f.date)+'</td>'+
      '<td style="padding:7px 10px;font-size:11px;color:#64748b">'+escapeHTML((f.objet||"").slice(0,40))+'</td>'+
      '<td style="padding:7px 10px;text-align:right;font-weight:700;font-family:monospace">'+money(f.ttc||f.montantTTC||0)+'</td>'+
      '<td style="padding:7px 10px;text-align:right;color:#059669;font-family:monospace">'+money(sp.paye)+'</td>'+
      '<td style="padding:7px 10px;text-align:right;color:'+(sp.reste>0?"#d97706":"#94a3b8")+';font-family:monospace">'+money(sp.reste)+'</td>'+
      '<td style="padding:7px 10px;text-align:center"><span class="pill '+statutFactPill(sp.statut)+'" style="font-size:10px">'+sp.statut+'</span></td>'+
      '</tr>';}).join("")+
    '</tbody></table>')+
    '</div>'+
    '<div class="card" style="overflow:auto">'+
    '<div style="padding:10px 14px;font-size:12px;font-weight:800;color:#059669;border-bottom:1px solid #e2e8f0;background:#f0fdf4">HISTORIQUE DES PAIEMENTS</div>'+
    (paiements.length===0?'<div style="padding:24px;text-align:center;color:#94a3b8">Aucun paiement enregistré.</div>':
    '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0fdf4">'+
    '<th style="'+thS+'">Date</th><th style="'+thS+'">Facture</th><th style="'+thS+'">Mode</th><th style="'+thS+'">Référence</th><th style="'+thS+';text-align:right">Montant</th>'+
    '</tr></thead><tbody>'+
    paiements.map(p=>{const f=factures.find(x=>x.id===p.factureId);return'<tr style="border-bottom:1px solid #f0fdf4">'+
      '<td style="padding:7px 10px;font-size:11px">'+formatDate(p.date)+'</td>'+
      '<td style="padding:7px 10px;font-size:11px;font-family:monospace;color:#1d4ed8">'+safe(f?.numero||"")+'</td>'+
      '<td style="padding:7px 10px;font-size:11px">'+escapeHTML(p.mode||"")+'</td>'+
      '<td style="padding:7px 10px;font-size:11px;color:#64748b">'+escapeHTML(p.reference||"—")+'</td>'+
      '<td style="padding:7px 10px;text-align:right;font-weight:700;color:#059669;font-family:monospace">'+money(p.montant)+'</td>'+
      '</tr>';}).join("")+
    '</tbody></table>')+
    '</div>';
}

SGDIModules.registerModule({key: "facturation", routes: ["facturation"], dependencies: ["facturation-1"], init: function(){}, destroy: facturationModuleDestroy});

const facturationModuleTimeouts=new Set();
let facturationEditorHost=null,facturationEditorId=null;
function facturationModuleTimeout(callback,delay){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const id=setTimeout(()=>{facturationModuleTimeouts.delete(id);if(hash===location.hash&&generation===sgdiViewRenderGeneration&&SGDIModules.isModuleInitialized("facturation"))callback()},delay);
  facturationModuleTimeouts.add(id);return id;
}
function facturationEditorInput(event){
  if(facturationEditorHost?.querySelector("#fact-lignes-body")&&event.target.matches("input,select,textarea")){factureEditorUpdateWorkflow();factureEditorScheduleDraft()}
}
function facturationBindEditor(view){
  facturationEditorHost=view;facturationEditorId=window.__factureEditId;
  view.addEventListener("input",facturationEditorInput);view.addEventListener("change",facturationEditorInput);
}
function facturationDismissMenu(event){
  const menu=document.getElementById("fact-add-menu");
  if(!event||!menu||!menu.contains(event.target)){menu?.remove();document.removeEventListener("click",facturationDismissMenu)}
}
function facturationLeaveEditor(){
  // Capturer le brouillon dans son DOM avant remplacement ; aucune formule modifiée.
  if(factureDraftTimer!==null){
    clearTimeout(factureDraftTimer);factureDraftTimer=null;
    if(facturationEditorHost?.isConnected&&facturationEditorHost.querySelector("#fact-lignes-body")){
      const selected=window.__factureEditId;window.__factureEditId=facturationEditorId;
      try{Promise.resolve(factureEditorSave({draft:true,silent:true})).catch(e=>console.warn("Brouillon Facturation",e))}finally{window.__factureEditId=selected}
    }
  }
  facturationEditorHost?.removeEventListener("input",facturationEditorInput);facturationEditorHost?.removeEventListener("change",facturationEditorInput);
  facturationEditorHost=null;facturationEditorId=null;
  facturationModuleTimeouts.forEach(clearTimeout);facturationModuleTimeouts.clear();
  clearTimeout(factureClientSearchTimer);factureClientSearchTimer=null;facturationDismissMenu();
}
function facturationModuleDestroy(){facturationLeaveEditor()}
