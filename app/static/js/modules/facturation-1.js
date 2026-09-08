/* Phase 2 — facturation-1. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function renderFactDashboard(view){
  const factures=bySoc(db.factures||[]).filter(f=>f.statut!=="brouillon");
  const paiements=db.paiements||[];const avoirs=db.avoirs||[];
  const factIds=new Set(factures.map(f=>f.id));
  const myPaiements=paiements.filter(p=>factIds.has(p.factureId));
  const myAvoirs=avoirs.filter(a=>factIds.has(a.factureId));
  const curYear=new Date().getFullYear();
  const totalFact=factures.filter(f=>new Date(f.date||"").getFullYear()===curYear).reduce((s,f)=>s+(f.ttc||f.montantTTC||0),0);
  const totalEncaisse=myPaiements.reduce((s,p)=>s+(p.montant||0),0);
  const totalAvoirs=myAvoirs.reduce((s,a)=>s+(a.montant||0),0);
  const now=today();
  let curCr=0,lateCr=0;
  const unpaid=[];
  factures.forEach(f=>{
    const sp=factureStatutPaye(f);if(sp.reste<=0.01)return;
    unpaid.push({...f,_sp:sp});
    const echD=f.dateEcheance||(f.date&&f.echeance?addDays(f.date,parseInt(f.echeance)||30):"");
    if(echD&&echD<now)lateCr+=sp.reste;else curCr+=sp.reste;
  });
  const barTotal=totalEncaisse+curCr+lateCr||1;
  const pEnc=Math.round(totalEncaisse/barTotal*100),pCur=Math.round(curCr/barTotal*100),pLate=Math.round(lateCr/barTotal*100);
  const totalVentes=totalFact;
  const yearInvoices=factures.filter(f=>new Date(f.date||"").getFullYear()===curYear);
  const yearInvoiceIds=new Set(yearInvoices.map(f=>f.id));
  const yearCollected=myPaiements.filter(p=>yearInvoiceIds.has(p.factureId)&&new Date(p.date||"").getFullYear()===curYear).reduce((s,p)=>s+(Number(p.montant)||0),0);
  const yearCurrent=yearInvoices.reduce((s,f)=>{const sp=factureStatutPaye(f);const due=f.dateEcheance||(f.date&&f.echeance?addDays(f.date,parseInt(f.echeance)||30):"");return s+(sp.reste>0.01&&(!due||due>=now)?sp.reste:0)},0);
  const pct=v=>totalVentes>0?Math.round(v/totalVentes*1000)/10:0;
  const unpaidSorted=unpaid.sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,10);
  const nbTotal=unpaid.length,nbLate=unpaid.filter(f=>{const e=f.dateEcheance||(f.date&&f.echeance?addDays(f.date,parseInt(f.echeance)||30):"");return e&&e<now;}).length;
  view.innerHTML=
    factTabs("dashboard")+
    '<div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">'+
    // LEFT
    '<div>'+
    '<div class="card" style="padding:20px;margin-bottom:12px">'+
    '<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:12px">Vue d\'ensemble</div>'+
    '<div style="font-size:12px;color:#374151;margin-bottom:8px">Total facturé '+money(totalFact)+'. Dont '+money(totalEncaisse)+' encaissé, et '+money(curCr+lateCr)+' est en créance</div>'+
    '<div style="height:12px;border-radius:6px;overflow:hidden;background:#e5e7eb;display:flex;margin-bottom:16px">'+
    '<div style="background:#3b82f6;width:'+pEnc+'%;transition:.3s"></div>'+
    '<div style="background:#f97316;width:'+pCur+'%;transition:.3s"></div>'+
    '<div style="background:#ef4444;width:'+pLate+'%;transition:.3s"></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'+
    '<div><div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;margin-bottom:4px">Encaissé</div><div style="font-size:18px;font-weight:900;color:#111827">'+money(totalEncaisse)+'</div></div>'+
    '<div><div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:4px">Créances courantes</div><div style="font-size:18px;font-weight:900;color:#111827">'+money(curCr)+'</div></div>'+
    '<div><div style="font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:4px">Créances en retard</div><div style="font-size:18px;font-weight:900;color:#111827">'+money(lateCr)+'</div></div>'+
    '</div></div>'+
    '<div class="card" style="padding:20px">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
    '<div style="font-size:14px;font-weight:700;color:#111827">Ventes</div>'+
    '<div style="font-size:12px;color:#6b7280">Année fiscale <strong>'+curYear+'</strong></div>'+
    '</div>'+
    '<div style="display:flex;gap:24px;margin-bottom:12px">'+
    '<div><div style="font-size:11px;color:#3b82f6;font-weight:700">Total des ventes</div><div style="font-size:18px;font-weight:900;color:#111827">'+money(totalVentes)+'</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px;align-items:start">'+
    '<div>'+factChartSVG(factures,myPaiements,curYear)+'</div>'+
    '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-top:24px"><div style="padding:9px 11px;background:#f8fafc;font-size:11px;font-weight:800;color:#334155">Répartition annuelle</div><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th style="padding:7px;text-align:left;color:#64748b">Indicateur</th><th style="padding:7px;text-align:right;color:#64748b">Montant</th><th style="padding:7px;text-align:right;color:#64748b">%</th></tr></thead><tbody>'+
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px;color:#3b82f6;font-weight:700">Facturé</td><td style="padding:8px;text-align:right;font-family:monospace">'+money(totalVentes)+'</td><td style="padding:8px;text-align:right;font-weight:900">'+(totalVentes>0?'100':'0')+' %</td></tr>'+
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px;color:#059669;font-weight:700">Encaissé</td><td style="padding:8px;text-align:right;font-family:monospace">'+money(yearCollected)+'</td><td style="padding:8px;text-align:right;font-weight:900">'+pct(yearCollected)+' %</td></tr>'+
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px;color:#d97706;font-weight:700">Créances courantes</td><td style="padding:8px;text-align:right;font-family:monospace">'+money(yearCurrent)+'</td><td style="padding:8px;text-align:right;font-weight:900">'+pct(yearCurrent)+' %</td></tr>'+
    '</tbody></table></div></div>'+
    '</div>'+
    '</div>'+
    // RIGHT
    '<div>'+
    '<div class="card" style="padding:16px">'+
    '<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px">'+
    'Vous avez <strong style="color:#ef4444">'+nbTotal+'</strong> factures non payées dont <strong style="color:#ef4444">'+nbLate+'</strong> où le délais est dépassé'+
    '</div>'+
    (unpaidSorted.length===0?'<div style="padding:20px;text-align:center;color:#9ca3af;font-size:12px">Aucune facture impayée</div>':
    unpaidSorted.map(f=>{
      const echD=f.dateEcheance||(f.date&&f.echeance?addDays(f.date,parseInt(f.echeance)||30):"");
      const isLate=echD&&echD<now;
      const sd=factStatutDisplay(f);
      return '<div onclick="factureEditorOpen(\''+f.id+'\')" style="padding:12px;border-radius:6px;cursor:pointer;border:1px solid #f3f4f6;margin-bottom:8px;background:#fff" onmouseover="this.style.background=\'#f9fafb\'" onmouseout="this.style.background=\'#fff\'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
        '<div style="font-family:monospace;font-size:12px;font-weight:700;color:#111827">'+escapeHTML(f.numero||"")+'</div>'+
        '<div style="font-weight:700;font-size:12px;font-family:monospace">'+money(f._sp.reste)+'</div>'+
        '</div>'+
        '<div style="font-size:11px;color:#374151;margin-top:2px;font-weight:600">'+escapeHTML(f.client||f.clientNom||"")+'</div>'+
        '<div style="margin-top:4px"><span style="font-size:10px;font-weight:700;color:'+sd.bg+';text-transform:uppercase">'+escapeHTML(sd.label)+'</span></div>'+
        '</div>';
    }).join(""))+
    '</div></div>'+
    '</div>';
}

function renderFactDevis(view){
  const list=bySoc(db.devis||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">📝 Devis</h1><p class="text-slate-500 text-sm">${list.length} devis · ${mySoc()||"Toutes"}</p></div><button class="btn btn-primary" onclick="openDevisModal()">➕ Nouveau devis</button></div>
    ${factTabs("devis")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucun devis.</div>`:`<table><thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Objet</th><th>HT</th><th>TVA</th><th>TTC</th><th>Statut</th><th></th></tr></thead><tbody>${list.map(d=>`<tr data-searchable><td class="font-mono text-xs">${safe(d.numero)}</td><td class="text-xs">${formatDate(d.date)}</td><td>${escapeHTML(d.client||"")}</td><td class="text-xs">${escapeHTML((d.objet||"").slice(0,40))}</td><td class="text-xs">${money(d.totalHT)}</td><td class="text-xs">${money(d.tvaAmt)}</td><td class="font-bold">${money(d.ttc)}</td><td><select class="select text-xs" onchange="updateDevisStatut('${d.id}',this.value)">${STATUTS_DEVIS.map(s=>`<option ${d.statut===s?"selected":""}>${s}</option>`).join("")}</select></td><td class="flex gap-1"><button class="btn btn-ghost text-xs" onclick="convertDevisToFacture('${d.id}')">→ Facture</button><button class="btn btn-ghost text-xs text-red-600" onclick="deleteDevis('${d.id}')">✕</button></td></tr>`).join("")}</tbody></table>`}</div>`;
}

async function updateDevisStatut(id,s){const d=db.devis.find(x=>x.id===id);if(d){d.statut=s;if(!(await saveDBAndWaitToast("Statut devis non confirmé")))return;toast("Statut mis à jour","success")}}

async function convertDevisToFacture(id){
  const d=db.devis.find(x=>x.id===id);if(!d)return;
  // Le numéro définitif n'est plus calculé ici : la facture est d'abord créée en
  // brouillon, puis /factures/{id}/valider l'attribue de façon atomique côté serveur
  // (évite une collision si deux devis sont convertis au même moment).
  const fid=uid("fc");
  db.factures=db.factures||[];
  db.factures.push({id:fid,numero:"BROUILLON",date:today(),societe:d.societe,echeance:30,client:d.client,adresseClient:d.adresseClient||"",nif:"",email:d.email||"",objet:d.objet,designation:d.designation||"",quantite:d.quantite,prixUnitaire:d.prixUnitaire,tva:d.tva,remise:d.remise,totalHT:d.totalHT,tvaAmt:d.tvaAmt,ttc:d.ttc,modeReglement:"Virement bancaire",observations:"Issu du devis "+d.numero,statut:"brouillon",categorie:d.categorie||"",theme:d.theme||"",structure:d.structure||"",createdBy:session.username,createdAt:new Date().toISOString(),sourceDevisId:d.id});
  d.statut="accepte";
  if(!(await saveDBAndWaitToast("Conversion devis non confirmée")))return;
  try{
    const validated=await sgdiApi("/api/irongs/factures/"+encodeURIComponent(fid)+"/valider",{method:"POST",legacy:false});
    const f=db.factures.find(x=>x.id===fid);if(f)Object.assign(f,validated);
    toast("Facture "+validated.numero+" créée","success");
  }catch(e){
    toast("Devis converti, mais numérotation de la facture impossible : "+(e.message||e),"error");
  }
  navigate("facturation/factures");
}

function __renderFactFacturesOLD_REMOVED(view){
}

async function deleteFacture(id){
  const f=(db.factures||[]).find(x=>x.id===id);if(!f)return;
  if(f.statut!=="brouillon"){toast("Une facture validée ne peut pas être supprimée. Émettez un avoir.","error");return}
  if(!confirm("Supprimer définitivement ce brouillon ?"))return;
  try{await sgdiApi("/api/irongs/collections/factures/items/"+encodeURIComponent(id),{method:"DELETE",legacy:false});db.factures=db.factures.filter(x=>x.id!==id);renderView();toast("Brouillon supprimé","success")}catch(e){toast("Suppression impossible : "+(e.message||e),"error")}
}

async function factureDuplicateDraft(id){
  const source=(db.factures||[]).find(x=>x.id===id);if(!source)return;
  const copy={...source,id:uid("fc"),numero:"BROUILLON",statut:"brouillon",validatedAt:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lignes:(source.lignes||[]).map(l=>({...l,id:uid("fl")}))};
  try{const saved=await sgdiApi("/api/irongs/collections/factures/items",{method:"POST",body:{data:copy},legacy:false});Object.assign(copy,saved||{});db.factures.push(copy);window.__factureEditId=copy.id;navigate("facturation/factures/edit");toast("Copie créée en brouillon","success")}catch(e){toast("Duplication impossible : "+(e.message||e),"error")}
}

function openPaiementModal(factureId){
  const f=db.factures.find(x=>x.id===factureId);if(!f)return;const sp=factureStatutPaye(f);
  openModal(`<h3 class="font-bold text-lg mb-3">💳 Encaisser un paiement</h3>
    <p class="text-sm text-slate-600 mb-4">Facture <span class="font-mono text-blue-600">${safe(f.numero)}</span> · ${escapeHTML(f.client||"")} · TTC <b>${money(f.ttc)}</b> · Reste <b class="text-amber-600">${money(sp.reste)}</b></p>
    <form onsubmit="event.preventDefault();confirmPaiement('${factureId}')">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Montant (DA) *</label><input class="input" type="number" step="0.01" min="0.01" name="montant" value="${sp.reste.toFixed(2)}" max="${sp.reste.toFixed(2)}" /></div>
        <div><label class="label">Mode *</label><select class="select" name="mode" >${MODES_PAIEMENT.map(m=>`<option>${m}</option>`).join("")}</select></div>
        <div><label class="label">Référence</label><input class="input" name="reference" placeholder="N° chèque, virement..."/></div>
        <div class="col-span-2"><label class="label">Notes</label><textarea class="input" name="notes" rows="2"></textarea></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-success">💾 Encaisser</button></div>
    </form>`);
}

async function confirmPaiement(factureId){
  const fd=new FormData(document.querySelector(".modal-bg form"));const m=parseFloat(fd.get("montant"))||0;
  if(m<=0){toast("Montant invalide","error");return}
  const f=db.factures.find(x=>x.id===factureId);if(!f)return;
  db.paiements=db.paiements||[];
  db.paiements.push({id:uid("pa"),factureId,date:fd.get("date"),montant:m,mode:fd.get("mode"),reference:fd.get("reference")||"",notes:fd.get("notes")||"",createdBy:session.username,createdAt:new Date().toISOString()});
  db.caisse=db.caisse||[];db.caisse.push({id:uid("cs"),date:fd.get("date"),type:"entree",montant:m,categorie:"Encaissement facture",libelle:"Paiement facture "+(f.numero||""),mode:fd.get("mode"),reference:fd.get("reference")||"",societe:f.societe||"",factureId,createdAt:new Date().toISOString()});
  if(!(await saveDBAndWaitToast("Paiement non confirmé")))return;
  closeModal();toast("Paiement enregistré : "+money(m),"success");renderView();
}

function openAvoirModal(factureId){
  const f=db.factures.find(x=>x.id===factureId);if(!f)return;const sp=factureStatutPaye(f);
  openModal(`<h3 class="font-bold text-lg mb-3">↩️ Émettre un avoir</h3>
    <p class="text-sm text-slate-600 mb-4">Facture <span class="font-mono text-blue-600">${safe(f.numero)}</span> · TTC <b>${money(f.ttc)}</b></p>
    <form onsubmit="event.preventDefault();confirmAvoir('${factureId}')">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Montant *</label><input class="input" type="number" step="0.01" name="montant" max="${f.ttc}" /></div>
        <div class="col-span-2"><label class="label">Motif *</label><textarea class="input" name="motif" rows="3"  placeholder="Raison de l'avoir..."></textarea></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-warn">💾 Émettre l'avoir</button></div>
    </form>`);
}

async function confirmAvoir(factureId){
  const fd=new FormData(document.querySelector(".modal-bg form"));const m=parseFloat(fd.get("montant"))||0;
  if(m<=0){toast("Montant invalide","error");return}
  const f=db.factures.find(x=>x.id===factureId);
  db.avoirs=db.avoirs||[];const num="AV-"+new Date().getFullYear()+"-"+String((db.avoirs.length+1)).padStart(4,"0");
  db.avoirs.push({id:uid("av"),numero:num,factureId,date:fd.get("date"),montant:m,motif:fd.get("motif"),client:f?.client||"",societe:f?.societe||"",createdBy:session.username,createdAt:new Date().toISOString()});
  if(!(await saveDBAndWaitToast("Avoir non confirmé")))return;
  closeModal();toast("Avoir "+num+" émis ("+money(m)+")","success");renderView();
}

function renderFactPaiements(view){
  const factIds=new Set(bySoc(db.factures||[]).filter(f=>f.statut!=="brouillon").map(f=>f.id));
  const list=(db.paiements||[]).filter(p=>factIds.has(p.factureId)).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const total=list.reduce((s,p)=>s+(p.montant||0),0);
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">💳 Paiements reçus</h1><p class="text-slate-500 text-sm">${list.length} paiements · Total ${money(total)}</p></div></div>
    ${factTabs("paiements")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucun paiement.</div>`:`<table><thead><tr><th>Date</th><th>Facture</th><th>Client</th><th>Mode</th><th>Réf.</th><th>Montant</th><th>Notes</th><th></th></tr></thead><tbody>${list.map(p=>{const f=db.factures.find(x=>x.id===p.factureId);return`<tr data-searchable><td class="text-xs">${formatDate(p.date)}</td><td class="font-mono text-xs">${safe(f?.numero)}</td><td>${escapeHTML(f?.client||"")}</td><td><span class="pill pill-blue">${safe(p.mode)}</span></td><td class="text-xs font-mono">${safe(p.reference)}</td><td class="font-bold text-emerald-600">${money(p.montant)}</td><td class="text-xs">${escapeHTML((p.notes||"").slice(0,40))}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deletePaiement('${p.id}')">✕</button></td></tr>`}).join("")}</tbody></table>`}</div>`;
}

async function deletePaiement(id){if(!confirm("Supprimer ce paiement ?"))return;db.paiements=db.paiements.filter(p=>p.id!==id);db.caisse=(db.caisse||[]).filter(c=>!(c.factureId&&c.categorie==="Encaissement facture"&&c.id&&db.paiements.find(pp=>pp.id===id)));if(!(await saveDBAndWaitToast("Suppression paiement non confirmée")))return;renderView();toast("Supprimé","success")}

function renderFactAvances(view){
  const list=bySoc(db.avances||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const total=list.reduce((s,a)=>s+(a.montant||0),0);
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">💰 Avances clients</h1><p class="text-slate-500 text-sm">${list.length} avances · Total ${money(total)}</p></div><button class="btn btn-primary" onclick="openAvanceModal()">➕ Nouvelle avance</button></div>
    ${factTabs("avances")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucune avance.</div>`:`<table><thead><tr><th>Date</th><th>Client</th><th>Mode</th><th>Réf.</th><th>Montant</th><th>Statut</th><th>Notes</th><th></th></tr></thead><tbody>${list.map(a=>`<tr data-searchable><td class="text-xs">${formatDate(a.date)}</td><td>${escapeHTML(a.client||"")}</td><td><span class="pill pill-blue">${safe(a.mode)}</span></td><td class="text-xs font-mono">${safe(a.reference)}</td><td class="font-bold text-indigo-600">${money(a.montant)}</td><td><span class="pill ${a.statut==="utilisee"?"pill-green":"pill-amber"}">${safe(a.statut)}</span></td><td class="text-xs">${escapeHTML((a.notes||"").slice(0,40))}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteAvance('${a.id}')">✕</button></td></tr>`).join("")}</tbody></table>`}</div>`;
}

function openAvanceModal(){
  openModal(`<h3 class="font-bold text-lg mb-4">💰 Nouvelle avance client</h3>
    <form onsubmit="event.preventDefault();confirmAvance()">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Société émettrice *</label><select class="select" name="societe" >${SOCIETES.map(s=>`<option ${mySoc()===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Client *</label><input class="input" name="client" /></div>
        <div><label class="label">Montant (DA) *</label><input class="input" type="number" step="0.01" name="montant" /></div>
        <div><label class="label">Mode *</label><select class="select" name="mode" >${MODES_PAIEMENT.map(m=>`<option>${m}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Référence</label><input class="input" name="reference"/></div>
        <div class="col-span-2"><label class="label">Notes</label><textarea class="input" name="notes" rows="2"></textarea></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

async function confirmAvance(){
  const fd=new FormData(document.querySelector(".modal-bg form"));const m=parseFloat(fd.get("montant"))||0;
  db.avances=db.avances||[];
  db.avances.push({id:uid("av"),date:fd.get("date"),societe:fd.get("societe"),client:fd.get("client"),montant:m,mode:fd.get("mode"),reference:fd.get("reference")||"",notes:fd.get("notes")||"",statut:"disponible",createdBy:session.username,createdAt:new Date().toISOString()});
  db.caisse=db.caisse||[];db.caisse.push({id:uid("cs"),date:fd.get("date"),type:"entree",montant:m,categorie:"Avance client",libelle:"Avance "+fd.get("client"),mode:fd.get("mode"),reference:fd.get("reference")||"",societe:fd.get("societe"),createdAt:new Date().toISOString()});
  if(!(await saveDBAndWaitToast("Avance non confirmée")))return;
  closeModal();toast("Avance enregistrée : "+money(m),"success");renderView();
}

async function deleteAvance(id){if(!confirm("Supprimer ?"))return;db.avances=db.avances.filter(a=>a.id!==id);if(!(await saveDBAndWaitToast("Suppression avance non confirmée")))return;renderView()}

function renderFactAvoirs(view){
  const factIds=new Set(bySoc(db.factures||[]).filter(f=>f.statut!=="brouillon").map(f=>f.id));
  const list=(db.avoirs||[]).filter(a=>factIds.has(a.factureId)).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const total=list.reduce((s,a)=>s+(a.montant||0),0);
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">↩️ Avoirs</h1><p class="text-slate-500 text-sm">${list.length} avoirs · Total ${money(total)}</p></div></div>
    ${factTabs("avoirs")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucun avoir.</div>`:`<table><thead><tr><th>N°</th><th>Date</th><th>Facture</th><th>Client</th><th>Montant</th><th>Motif</th><th></th></tr></thead><tbody>${list.map(a=>{const f=db.factures.find(x=>x.id===a.factureId);return`<tr data-searchable><td class="font-mono text-xs">${safe(a.numero)}</td><td class="text-xs">${formatDate(a.date)}</td><td class="font-mono text-xs">${safe(f?.numero)}</td><td>${escapeHTML(a.client||f?.client||"")}</td><td class="font-bold text-purple-600">${money(a.montant)}</td><td class="text-xs">${escapeHTML((a.motif||"").slice(0,50))}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteAvoir('${a.id}')">✕</button></td></tr>`}).join("")}</tbody></table>`}</div>`;
}

async function deleteAvoir(id){if(!confirm("Supprimer ?"))return;db.avoirs=db.avoirs.filter(a=>a.id!==id);if(!(await saveDBAndWaitToast("Suppression avoir non confirmée")))return;renderView()}

function renderFactCaisse(view){
  const list=bySoc(db.caisse||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const entrees=list.filter(c=>c.type==="entree").reduce((s,c)=>s+(c.montant||0),0);
  const sorties=list.filter(c=>c.type==="sortie").reduce((s,c)=>s+(c.montant||0),0);
  const solde=entrees-sorties;
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">🏦 Caisse</h1><p class="text-slate-500 text-sm">${list.length} mouvements · ${mySoc()||"Toutes"}</p></div><div class="flex gap-2"><button class="btn btn-success" onclick="openCaisseModal('entree')">+ Entrée</button><button class="btn btn-warn" onclick="openCaisseModal('sortie')">- Sortie</button></div></div>
    ${factTabs("caisse")}
    <div class="grid grid-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Entrées</div><div class="text-2xl font-bold mt-1 text-emerald-600">${money(entrees)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Sorties</div><div class="text-2xl font-bold mt-1 text-red-600">${money(sorties)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Solde</div><div class="text-2xl font-bold mt-1 ${solde>=0?"text-emerald-600":"text-red-600"}">${money(solde)}</div></div>
    </div>
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucun mouvement.</div>`:`<table><thead><tr><th>Date</th><th>Type</th><th>Catégorie</th><th>Libellé</th><th>Mode</th><th>Réf.</th><th>Montant</th><th></th></tr></thead><tbody>${list.map(c=>`<tr data-searchable><td class="text-xs">${formatDate(c.date)}</td><td><span class="pill ${c.type==="entree"?"pill-green":"pill-red"}">${c.type==="entree"?"↗ Entrée":"↘ Sortie"}</span></td><td class="text-xs">${escapeHTML(c.categorie||"")}</td><td class="text-xs">${escapeHTML(c.libelle||"")}</td><td><span class="pill pill-gray">${safe(c.mode)}</span></td><td class="text-xs font-mono">${safe(c.reference)}</td><td class="font-bold ${c.type==="entree"?"text-emerald-600":"text-red-600"}">${c.type==="entree"?"+":"-"}${money(c.montant)}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteCaisse('${c.id}')">✕</button></td></tr>`).join("")}</tbody></table>`}</div>`;
}

function openCaisseModal(type){
  const cats=type==="entree"?["Encaissement facture","Avance client","Apport","Remboursement","Autre entrée"]:["Achat fourniture","Salaire/Avance personnel","Frais bancaires","Loyer","Carburant","Maintenance","Autre sortie"];
  openModal(`<h3 class="font-bold text-lg mb-4">${type==="entree"?"➕ Entrée":"➖ Sortie"} de caisse</h3>
    <form onsubmit="event.preventDefault();confirmCaisse('${type}')">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Société *</label><select class="select" name="societe" >${SOCIETES.map(s=>`<option ${mySoc()===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div><label class="label">Catégorie *</label><select class="select" name="categorie" >${cats.map(c=>`<option>${c}</option>`).join("")}</select></div>
        <div><label class="label">Mode *</label><select class="select" name="mode" >${MODES_PAIEMENT.map(m=>`<option>${m}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Libellé *</label><input class="input" name="libelle" /></div>
        <div><label class="label">Montant (DA) *</label><input class="input" type="number" step="0.01" name="montant" /></div>
        <div><label class="label">Référence</label><input class="input" name="reference"/></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn ${type==="entree"?"btn-success":"btn-warn"}">💾 Enregistrer</button></div>
    </form>`);
}

async function confirmCaisse(type){
  const fd=new FormData(document.querySelector(".modal-bg form"));const m=parseFloat(fd.get("montant"))||0;
  db.caisse=db.caisse||[];
  db.caisse.push({id:uid("cs"),date:fd.get("date"),type,montant:m,categorie:fd.get("categorie"),libelle:fd.get("libelle"),mode:fd.get("mode"),reference:fd.get("reference")||"",societe:fd.get("societe"),createdBy:session.username,createdAt:new Date().toISOString()});
  if(!(await saveDBAndWaitToast("Mouvement caisse non confirmé")))return;
  closeModal();toast("Mouvement enregistré","success");renderView();
}

async function deleteCaisse(id){if(!confirm("Supprimer ?"))return;db.caisse=db.caisse.filter(c=>c.id!==id);if(!(await saveDBAndWaitToast("Suppression caisse non confirmée")))return;renderView()}

function renderFactStock(view){
  // Filtrer par société courante (mySoc) ou la société sélectionnée dans le module stock (mtSociete) si module transverse
  const soc=mySoc()||sessionStorage.getItem("mtSociete")||"";
  let arts=(db.stockArticles||[]).slice();
  let mvts=(db.stockMouvements||[]).slice();
  if(soc){
    arts=arts.filter(a=>a.societe===soc);
    const ids=new Set(arts.map(a=>a.id));
    mvts=mvts.filter(m=>ids.has(m.articleId));
  }
  const periode=sessionStorage.getItem("factStkPeriode")||"month";
  const now=new Date();
  let cutoff="0000-00-00",periodLabel="Tout";
  if(periode==="month"){cutoff=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);periodLabel="Mois en cours"}
  else if(periode==="quarter"){const q=Math.floor(now.getMonth()/3);cutoff=new Date(now.getFullYear(),q*3,1).toISOString().slice(0,10);periodLabel="Trimestre en cours"}
  else if(periode==="year"){cutoff=new Date(now.getFullYear(),0,1).toISOString().slice(0,10);periodLabel="Année en cours"}
  else if(periode==="30"){cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);periodLabel="30 derniers jours"}
  else if(periode==="90"){cutoff=new Date(Date.now()-90*86400000).toISOString().slice(0,10);periodLabel="90 derniers jours"}
  const inPeriod=mvts.filter(m=>(m.date||"")>=cutoff);
  // Achats (entrées valorisées)
  const entrees=inPeriod.filter(m=>m.type==="entree");
  const totalAchats=entrees.reduce((s,m)=>s+((parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0)),0);
  const qtyAchats=entrees.reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  // Sorties valorisées
  const sortiesAll=inPeriod.filter(m=>stockMvtIsOut(m.type));
  const totalSorties=sortiesAll.reduce((s,m)=>s+((parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0)),0);
  const sortiesVente=sortiesAll.filter(m=>(m.motif||"").toLowerCase().includes("vente"));
  const totalVentes=sortiesVente.reduce((s,m)=>s+((parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0)),0);
  const sortiesAttribution=sortiesAll.filter(m=>(m.motif||"").toLowerCase().includes("attribution"));
  const totalAttributions=sortiesAttribution.reduce((s,m)=>s+((parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0)),0);
  const sortiesPertes=sortiesAll.filter(m=>m.type==="perte"||m.type==="casse"||m.type==="reforme"||(m.motif||"").toLowerCase().match(/perte|vol|casse|réforme|reforme/));
  const totalPertes=sortiesPertes.reduce((s,m)=>s+((parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0)),0);
  // Valeur stock actuelle
  const valeurStock=arts.reduce((s,a)=>s+stockGetActuel(a.id)*(parseFloat(a.prixUnitaire)||0),0);
  // Top fournisseurs
  const parFourn={};
  entrees.forEach(m=>{const k=(m.fournisseur||"— Non renseigné —").trim()||"— Non renseigné —";if(!parFourn[k])parFourn[k]={n:0,v:0,q:0};parFourn[k].n++;parFourn[k].v+=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);parFourn[k].q+=parseFloat(m.quantite)||0});
  const topFourn=Object.entries(parFourn).sort((a,b)=>b[1].v-a[1].v).slice(0,10);
  // Par catégorie (achats)
  const parCat={};
  entrees.forEach(m=>{const a=arts.find(x=>x.id===m.articleId);if(!a)return;const cat=stockGetCategorie(a.societe,a.categorie);const k=cat.label;if(!parCat[k])parCat[k]={cat,v:0,q:0,n:0};parCat[k].v+=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);parCat[k].q+=parseFloat(m.quantite)||0;parCat[k].n++});
  const catEntries=Object.values(parCat).sort((a,b)=>b.v-a.v);
  // Évolution mensuelle (12 mois) valorisée
  const months=[];
  for(let i=11;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push({k:d.toISOString().slice(0,7),label:d.toLocaleDateString("fr-FR",{month:"short",year:"2-digit"})})}
  const monthData=months.map(m=>{
    const list=mvts.filter(x=>(x.date||"").startsWith(m.k));
    const eVal=list.filter(x=>x.type==="entree").reduce((s,x)=>s+((parseFloat(x.quantite)||0)*(parseFloat(x.prixUnitaire)||0)),0);
    const sVal=list.filter(x=>stockMvtIsOut(x.type)).reduce((s,x)=>s+((parseFloat(x.quantite)||0)*(parseFloat(x.prixUnitaire)||0)),0);
    return{...m,eVal,sVal};
  });
  const maxMonth=Math.max(1,...monthData.map(m=>Math.max(m.eVal,m.sVal)));
  // Lignes des dernières entrées valorisées
  const recentEntrees=inPeriod.filter(m=>m.type==="entree").slice(0,15);
  const recentSorties=inPeriod.filter(m=>stockMvtIsOut(m.type)).slice(0,15);
  const periodes=[["month","Mois"],["quarter","Trim."],["year","Année"],["30","30 j"],["90","90 j"],["all","Tout"]];
  const periodBar=`<div class="flex gap-1 flex-wrap">${periodes.map(([k,l])=>`<button type="button" onclick="sessionStorage.setItem('factStkPeriode','${k}');renderView()" class="px-3 py-1 rounded-md text-xs font-bold transition" style="background:${periode===k?"#0f172a":"#fff"};color:${periode===k?"#fff":"#475569"};border:1px solid #cbd5e1">${l}</button>`).join("")}</div>`;
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">📦 Stock — Vue financière</h1>
    <p class="text-slate-500 text-sm mb-4">Reflet financier des entrées/sorties matériel · ${escapeHTML(periodLabel)} · ${soc?escapeHTML(soc):"Toutes sociétés"}</p>
    ${factTabs("stock")}
    <div class="card p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3"><span class="text-xs uppercase tracking-widest font-bold text-slate-500">Période :</span>${periodBar}</div>
      <a href="#/materiel/inventaire" class="btn btn-ghost text-xs">📦 Voir le module matériel →</a>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      <div class="card p-3" style="border-top:4px solid #16a34a"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Achats stock</div><div class="text-2xl font-black mt-1 text-emerald-700">${money(totalAchats)}</div><div class="text-[11px] text-slate-400">${entrees.length} entrée(s) · ${qty(qtyAchats)} u.</div></div>
      <div class="card p-3" style="border-top:4px solid #043970"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Valeur stock</div><div class="text-2xl font-black mt-1 text-amber-700">${money(valeurStock)}</div><div class="text-[11px] text-slate-400">DA · immobilisé</div></div>
      <div class="card p-3" style="border-top:4px solid #dc2626"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Sorties (coût)</div><div class="text-2xl font-black mt-1 text-red-700">${money(totalSorties)}</div><div class="text-[11px] text-slate-400">${sortiesAll.length} sortie(s)</div></div>
      <div class="card p-3" style="border-top:4px solid #043970"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Ventes stock</div><div class="text-2xl font-black mt-1 text-sky-700">${money(totalVentes)}</div><div class="text-[11px] text-slate-400">${sortiesVente.length} vente(s)</div></div>
      <div class="card p-3" style="border-top:4px solid #8b5cf6"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Attributions agents</div><div class="text-2xl font-black mt-1 text-purple-700">${money(totalAttributions)}</div><div class="text-[11px] text-slate-400">${sortiesAttribution.length} attribution(s)</div></div>
      <div class="card p-3" style="border-top:4px solid #043970"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Pertes / Casse</div><div class="text-2xl font-black mt-1" style="color:#043970">${money(totalPertes)}</div><div class="text-[11px] text-slate-400">${sortiesPertes.length} mouvement(s)</div></div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-3">📊 Évolution valorisée (12 mois)</h3>
      <div class="overflow-x-auto"><div style="display:flex;align-items:flex-end;gap:8px;min-height:200px;padding:10px;border-bottom:2px solid #e2e8f0">${monthData.map(m=>{
        const eh=Math.round(m.eVal/maxMonth*150);
        const sh=Math.round(m.sVal/maxMonth*150);
        return`<div style="flex:1;min-width:60px;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="display:flex;align-items:flex-end;gap:3px;height:160px;width:100%;justify-content:center">
            <div title="Achats : ${money(m.eVal)} DA" style="width:18px;height:${eh}px;background:linear-gradient(180deg,#16a34a,#15803d);border-radius:3px 3px 0 0;min-height:2px;cursor:pointer"></div>
            <div title="Sorties : ${money(m.sVal)} DA" style="width:18px;height:${sh}px;background:linear-gradient(180deg,#dc2626,#991b1b);border-radius:3px 3px 0 0;min-height:2px;cursor:pointer"></div>
          </div>
          <div class="text-[10px] font-bold text-slate-600">${escapeHTML(m.label)}</div>
          <div class="text-[9px] text-slate-400">${money(m.eVal/1000)}K / ${money(m.sVal/1000)}K</div>
        </div>`;
      }).join("")}</div></div>
      <div class="flex justify-center gap-4 text-xs text-slate-600 mt-2">
        <span class="flex items-center gap-1"><span style="width:12px;height:12px;background:#16a34a;border-radius:2px"></span> Achats valorisés (DA)</span>
        <span class="flex items-center gap-1"><span style="width:12px;height:12px;background:#dc2626;border-radius:2px"></span> Sorties valorisées (DA)</span>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-5">
        <h3 class="font-bold mb-3">🏪 Top fournisseurs (${escapeHTML(periodLabel)})</h3>
        ${topFourn.length===0?`<div class="text-sm text-slate-400 italic py-4 text-center">Aucun achat sur cette période.</div>`:`<table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="text-left p-2">Fournisseur</th><th class="text-center p-2">Entrées</th><th class="text-right p-2">Quantité</th><th class="text-right p-2">Montant DA</th></tr></thead><tbody>${topFourn.map(([f,d])=>`<tr class="border-t hover:bg-slate-50"><td class="p-2 font-semibold">🏪 ${escapeHTML(f)}</td><td class="p-2 text-center text-xs">${d.n}</td><td class="p-2 text-right text-xs">${money(d.q)}</td><td class="p-2 text-right font-bold text-emerald-700">${money(d.v)}</td></tr>`).join("")}<tr class="border-t bg-slate-50 font-bold"><td class="p-2">TOTAL</td><td class="p-2 text-center">${entrees.length}</td><td class="p-2 text-right">${money(qtyAchats)}</td><td class="p-2 text-right text-emerald-700">${money(totalAchats)}</td></tr></tbody></table>`}
      </div>
      <div class="card p-5">
        <h3 class="font-bold mb-3">🏷 Achats par catégorie</h3>
        ${catEntries.length===0?`<div class="text-sm text-slate-400 italic py-4 text-center">Aucun achat sur cette période.</div>`:catEntries.map(c=>{const pct=totalAchats>0?Math.round(c.v/totalAchats*100):0;return`<div class="text-sm mb-2">
          <div class="flex justify-between mb-1"><span class="font-medium">${c.cat.icon} ${escapeHTML(c.cat.label)}</span><span class="text-slate-700"><b>${money(c.v)}</b> DA <span class="text-slate-400">(${pct}%)</span></span></div>
          <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${c.cat.color};transition:width .3s"></div></div>
        </div>`}).join("")}
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-5">
        <h3 class="font-bold mb-3 text-emerald-700">📥 Dernières entrées valorisées</h3>
        ${recentEntrees.length===0?`<div class="text-sm text-slate-400 italic py-4 text-center">Aucune entrée.</div>`:`<table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="text-left p-2">Date</th><th class="text-left p-2">Article</th><th class="text-right p-2">Qté × P.U.</th><th class="text-right p-2">Montant</th><th class="text-left p-2">Fournisseur</th></tr></thead><tbody>${recentEntrees.map(m=>{const a=arts.find(x=>x.id===m.articleId);const v=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);return`<tr class="border-t"><td class="p-2 text-xs">${formatDate(m.date)}</td><td class="p-2 text-xs">${a?`<a class="hover:underline font-semibold" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a>`:"—"}</td><td class="p-2 text-right text-xs">${qty(m.quantite)} × ${money(m.prixUnitaire)}</td><td class="p-2 text-right font-bold text-emerald-700">${money(v)}</td><td class="p-2 text-xs text-slate-500">${escapeHTML(m.fournisseur||"—")}</td></tr>`}).join("")}</tbody></table>`}
      </div>
      <div class="card p-5">
        <h3 class="font-bold mb-3 text-red-700">📤 Dernières sorties valorisées</h3>
        ${recentSorties.length===0?`<div class="text-sm text-slate-400 italic py-4 text-center">Aucune sortie.</div>`:`<table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="text-left p-2">Date</th><th class="text-left p-2">Article</th><th class="text-right p-2">Qté × P.U.</th><th class="text-right p-2">Montant</th><th class="text-left p-2">Motif / Bénéficiaire</th></tr></thead><tbody>${recentSorties.map(m=>{const a=arts.find(x=>x.id===m.articleId);const v=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);return`<tr class="border-t"><td class="p-2 text-xs">${formatDate(m.date)}</td><td class="p-2 text-xs">${a?`<a class="hover:underline font-semibold" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a>`:"—"}</td><td class="p-2 text-right text-xs">${qty(m.quantite)} × ${money(m.prixUnitaire)}</td><td class="p-2 text-right font-bold text-red-700">${money(v)}</td><td class="p-2 text-xs text-slate-500">${escapeHTML(m.motif||"—")}${m.beneficiaireNom?` <span class="text-slate-400">→ ${escapeHTML(m.beneficiaireNom)}</span>`:""}</td></tr>`}).join("")}</tbody></table>`}
      </div>
    </div>
    <div class="card p-5 mb-4" style="background:linear-gradient(135deg,#0f172a08,#0f172a02);border-left:4px solid #0f172a">
      <h3 class="font-bold mb-3">🧮 Résultat net stock — ${escapeHTML(periodLabel)}</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
        <div><div class="text-xs uppercase font-bold text-slate-500">Achats (sorties caisse)</div><div class="text-xl font-black text-red-700">−${money(totalAchats)} DA</div></div>
        <div><div class="text-xs uppercase font-bold text-slate-500">Ventes (entrées caisse)</div><div class="text-xl font-black text-emerald-700">+${money(totalVentes)} DA</div></div>
        <div><div class="text-xs uppercase font-bold text-slate-500">Variation valeur stock</div><div class="text-xl font-black ${(totalAchats-totalSorties)>=0?"text-emerald-700":"text-red-700"}">${(totalAchats-totalSorties)>=0?"+":""}${money(totalAchats-totalSorties)} DA</div></div>
        <div><div class="text-xs uppercase font-bold text-slate-500">Pertes (charges)</div><div class="text-xl font-black" style="color:#043970">−${money(totalPertes)} DA</div></div>
      </div>
      <div class="text-xs text-slate-500 italic">💡 Les achats valorisés correspondent aux sorties de trésorerie pour réapprovisionnement. Les sorties motif « Vente » génèrent des entrées de caisse. La variation de stock (achats − sorties) reflète l'évolution de l'immobilisation. Les pertes/casse sont à passer en charge.</div>
    </div>`;
}

function renderFactSituation(view){
  const factures=bySoc(db.factures||[]).filter(f=>f.statut!=="brouillon");const factIds=new Set(factures.map(f=>f.id));const paiements=(db.paiements||[]).filter(p=>factIds.has(p.factureId));const avoirs=(db.avoirs||[]).filter(a=>factIds.has(a.factureId));
  const clients={};factures.forEach(f=>{const k=f.client||"—";if(!clients[k])clients[k]={ttc:0,paye:0,avoir:0,reste:0,nb:0};clients[k].nb++;clients[k].ttc+=(f.ttc||0)});
  paiements.forEach(p=>{const f=factures.find(x=>x.id===p.factureId);if(!f)return;const k=f.client||"—";if(clients[k])clients[k].paye+=(p.montant||0)});
  avoirs.forEach(a=>{const f=factures.find(x=>x.id===a.factureId);if(!f)return;const k=f.client||"—";if(clients[k])clients[k].avoir+=(a.montant||0)});
  Object.values(clients).forEach(c=>c.reste=Math.max(0,c.ttc-c.paye-c.avoir));
  const sorted=Object.entries(clients).sort((a,b)=>b[1].reste-a[1].reste);
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">📈 Situation des paiements par client</h1><p class="text-slate-500 text-sm mb-4">${sorted.length} clients · ${factures.length} factures</p>
    ${factTabs("situation")}
    <div class="card overflow-hidden">${sorted.length===0?`<div class="p-10 text-center text-slate-500">Aucun client.</div>`:`<table><thead><tr><th>Client</th><th>Factures</th><th>Total TTC</th><th>Encaissé</th><th>Avoirs</th><th>Reste à recouvrer</th><th>Taux</th></tr></thead><tbody>${sorted.map(([cl,c])=>{const taux=c.ttc>0?Math.round((c.paye/c.ttc)*100):0;return`<tr data-searchable><td class="font-semibold">${escapeHTML(cl)}</td><td class="text-xs">${c.nb}</td><td class="font-bold">${money(c.ttc)}</td><td class="text-emerald-600">${money(c.paye)}</td><td class="text-purple-600">${money(c.avoir)}</td><td class="font-bold ${c.reste>0?"text-amber-600":"text-emerald-600"}">${money(c.reste)}</td><td><div class="flex items-center gap-2"><div class="h-2 bg-slate-100 rounded-full flex-1" style="min-width:60px"><div class="h-full ${taux>=90?"bg-emerald-500":taux>=50?"bg-amber-500":"bg-red-500"} rounded-full" style="width:${taux}%"></div></div><span class="text-xs font-bold">${taux}%</span></div></td></tr>`}).join("")}</tbody></table>`}</div>`;
}

function renderFactCategories(view){
  const cats=db.categoriesPrest||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🏷 Catégories de prestation</h1><p class="text-slate-500 text-sm mb-4">${cats.length} catégories</p>
    ${factTabs("categories")}
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Ajouter une catégorie</h3><form onsubmit="event.preventDefault();addCategorie(this.nom.value);this.nom.value=''" class="flex gap-2"><input class="input flex-1" name="nom" placeholder="Nom de la catégorie" /><button class="btn btn-primary">➕ Ajouter</button></form></div>
    <div class="card overflow-hidden"><table><thead><tr><th>Catégorie</th><th>Factures</th><th>CA total</th><th></th></tr></thead><tbody>${cats.map(c=>{const fs=bySoc(db.factures||[]).filter(f=>f.categorie===c);const ttc=fs.reduce((s,f)=>s+(f.ttc||0),0);return`<tr><td class="font-semibold">${escapeHTML(c)}</td><td class="text-xs">${fs.length}</td><td class="font-bold">${money(ttc)}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteCategorie('${c.replace(/'/g,"\\'")}')">✕</button></td></tr>`}).join("")||`<tr><td colspan="4" class="text-center text-slate-500 p-6">Aucune.</td></tr>`}</tbody></table></div>`;
}

function addCategorie(nom){if(!nom)return;db.categoriesPrest=db.categoriesPrest||[];if(db.categoriesPrest.includes(nom)){toast("Existe déjà","error");return}db.categoriesPrest.push(nom);saveDB();renderView();toast("Catégorie ajoutée","success")}

function deleteCategorie(nom){if(!confirm("Supprimer "+nom+" ?"))return;db.categoriesPrest=(db.categoriesPrest||[]).filter(c=>c!==nom);saveDB();renderView()}

function renderFactThemes(view){
  const themes=db.themes||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🎯 Thèmes</h1><p class="text-slate-500 text-sm mb-4">${themes.length} thèmes</p>
    ${factTabs("themes")}
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Ajouter un thème</h3><form onsubmit="event.preventDefault();addTheme(this.nom.value);this.nom.value=''" class="flex gap-2"><input class="input flex-1" name="nom" placeholder="Nom du thème" /><button class="btn btn-primary">➕ Ajouter</button></form></div>
    <div class="card overflow-hidden"><table><thead><tr><th>Thème</th><th>Factures</th><th>CA total</th><th></th></tr></thead><tbody>${themes.map(t=>{const fs=bySoc(db.factures||[]).filter(f=>f.theme===t);const ttc=fs.reduce((s,f)=>s+(f.ttc||0),0);return`<tr><td class="font-semibold">${escapeHTML(t)}</td><td class="text-xs">${fs.length}</td><td class="font-bold">${money(ttc)}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteTheme('${t.replace(/'/g,"\\'")}')">✕</button></td></tr>`}).join("")||`<tr><td colspan="4" class="text-center text-slate-500 p-6">Aucun.</td></tr>`}</tbody></table></div>`;
}

function addTheme(nom){if(!nom)return;db.themes=db.themes||[];if(db.themes.includes(nom)){toast("Existe déjà","error");return}db.themes.push(nom);saveDB();renderView();toast("Thème ajouté","success")}

function deleteTheme(nom){if(!confirm("Supprimer ?"))return;db.themes=(db.themes||[]).filter(t=>t!==nom);saveDB();renderView()}

function renderFactStructures(view){
  const structures=db.structures||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🏛 Structures clients</h1><p class="text-slate-500 text-sm mb-4">${structures.length} structures</p>
    ${factTabs("structures")}
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Ajouter une structure</h3><form onsubmit="event.preventDefault();addStructure(this.nom.value);this.nom.value=''" class="flex gap-2"><input class="input flex-1" name="nom" placeholder="Public, Privé, Multinational..." /><button class="btn btn-primary">➕ Ajouter</button></form></div>
    <div class="card overflow-hidden"><table><thead><tr><th>Structure</th><th>Factures</th><th>CA total</th><th></th></tr></thead><tbody>${structures.map(t=>{const fs=bySoc(db.factures||[]).filter(f=>f.structure===t);const ttc=fs.reduce((s,f)=>s+(f.ttc||0),0);return`<tr><td class="font-semibold">${escapeHTML(t)}</td><td class="text-xs">${fs.length}</td><td class="font-bold">${money(ttc)}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteStructure('${t.replace(/'/g,"\\'")}')">✕</button></td></tr>`}).join("")||`<tr><td colspan="4" class="text-center text-slate-500 p-6">Aucune.</td></tr>`}</tbody></table></div>`;
}

function addStructure(nom){if(!nom)return;db.structures=db.structures||[];if(db.structures.includes(nom)){toast("Existe déjà","error");return}db.structures.push(nom);saveDB();renderView();toast("Structure ajoutée","success")}

function deleteStructure(nom){if(!confirm("Supprimer ?"))return;db.structures=(db.structures||[]).filter(s=>s!==nom);saveDB();renderView()}

SGDIModules.registerModule({key: "facturation-1", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
