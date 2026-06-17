(function(){
  const API="/api";
  const tokenKey="sgdi_api_token_v1";
  const fmt=new Intl.NumberFormat("fr-DZ",{style:"currency",currency:"DZD",maximumFractionDigits:0});
  const money=v=>fmt.format(Number(v||0));
  const pct=v=>Number(v||0).toFixed(1)+"%";
  const h=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const today=()=>new Date().toISOString().slice(0,10);
  const soc=()=>window.session?.societe||sessionStorage.getItem("dashSociete")||"";
  const items=r=>Array.isArray(r)?r:(Array.isArray(r?.items)?r.items:[]);
  const nav=r=>typeof navigate==="function"?navigate(r):(location.hash="#/"+r);

  async function api(path,opts){
    const headers={"Content-Type":"application/json"};
    const token=sessionStorage.getItem(tokenKey);
    if(token)headers.Authorization="Bearer "+token;
    const res=await fetch(API+path,{...opts,headers:{...headers,...(opts?.headers||{})}});
    if(!res.ok)throw new Error((await res.text())||("Erreur "+res.status));
    return res.status===204?null:res.json();
  }
  function qs(p){const q=new URLSearchParams();Object.entries(p||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")q.set(k,v)});return q.toString()?"?"+q.toString():""}

  // ── UI helpers ─────────────────────────────────────────────────────────────
  const STATUS_COLORS={
    brouillon:"erp-pill-gray",envoyé:"erp-pill-blue",accepté:"erp-pill-green",
    refusé:"erp-pill-red",expiré:"erp-pill-red",confirmée:"erp-pill-blue",
    en_cours:"erp-pill-orange",validé:"erp-pill-green",validée:"erp-pill-green",
    annulé:"erp-pill-red",annulée:"erp-pill-red",livrée:"erp-pill-green",
    payée:"erp-pill-green",partiellement_payée:"erp-pill-orange",
    en_attente:"erp-pill-gray",actif:"erp-pill-green",inactif:"erp-pill-gray",
  };
  const pill=(s)=>`<span class="erp-pill ${STATUS_COLORS[s]||"erp-pill-gray"}">${h(s||"—")}</span>`;

  function pageTitle(title,sub,actions){
    return `<div class="erp-head"><div><div class="erp-kicker">ATLAS ERP</div><h1>${h(title)}</h1><p class="erp-sub">${h(sub||"")}</p></div><div class="erp-actions">${actions||""}</div></div>`;
  }
  function tabs(base,active,list){
    return `<div class="erp-tabs">${list.map(t=>`<button class="erp-tab${active===t[0]?" active":""}" onclick="nav('${base}/${t[0]}')">${h(t[1])}</button>`).join("")}</div>`;
  }
  function kpi(label,value,sub,color){
    return `<div class="erp-kpi" style="${color?"--kpi-accent:"+color:""}"><span class="erp-kpi-label">${h(label)}</span><strong class="erp-kpi-value">${h(String(value??0))}</strong><em class="erp-kpi-sub">${h(sub||"")}</em></div>`;
  }
  function table(headers,rows,empty){
    return `<div class="erp-table-wrap"><table class="erp-table"><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.join(""):`<tr><td colspan="${headers.length}" class="erp-empty">${h(empty||"Aucune donnée.")}</td></tr>`}</tbody></table></div>`;
  }
  function card(title,body){
    return `<div class="erp-card"><h3 class="erp-card-title">${h(title)}</h3>${body}</div>`;
  }
  function shell(view,title,sub,tabBase,active,tabList,body,actions){
    view.innerHTML=`<div class="erp-page">${pageTitle(title,sub,actions)}${tabs(tabBase,active,tabList)}<div class="erp-body">${body}</div></div>`;
  }
  function renderError(view,title,e){
    view.innerHTML=`<div class="erp-page">${pageTitle(title,"Erreur de chargement")}<div class="erp-error">⚠ ${h(e?.message||String(e))}</div></div>`;
  }

  // ── Export helpers ──────────────────────────────────────────────────────────
  function exportBtn(label,url){
    return `<button class="btn btn-secondary erp-export-btn" onclick="erpDownload('${h(url)}','${h(label)}')">${label}</button>`;
  }
  window.erpDownload=async function(path,label){
    try{
      const token=sessionStorage.getItem(tokenKey);
      const res=await fetch(API+path,{headers:{Authorization:"Bearer "+token}});
      if(!res.ok)throw new Error("Erreur "+res.status);
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      const cd=res.headers.get("content-disposition")||"";
      const match=cd.match(/filename="([^"]+)"/);
      a.download=match?match[1]:(label.replace(/\s+/g,"_")+".xlsx");
      a.click();
      URL.revokeObjectURL(url);
    }catch(e){if(typeof toast==="function")toast("Export échoué : "+e.message,"error");}
  };

  // ── Form helpers ────────────────────────────────────────────────────────────
  function field(label,name,type="text",value="",required=false,extra=""){
    return `<label class="erp-field"><span>${h(label)}${required?"<em>*</em>":""}</span><input name="${h(name)}" type="${h(type)}" value="${h(value||"")}" ${required?"required":""} ${extra}/></label>`;
  }
  function textarea(label,name,value=""){
    return `<label class="erp-field erp-field-full"><span>${h(label)}</span><textarea name="${h(name)}" rows="2">${h(value||"")}</textarea></label>`;
  }
  function select(label,name,options,value=""){
    return `<label class="erp-field"><span>${h(label)}</span><select name="${h(name)}">${options.map(([v,l])=>`<option value="${h(v)}"${v===value?" selected":""}>${h(l)}</option>`).join("")}</select></label>`;
  }
  function formRow(...fields){return`<div class="erp-form-row">${fields.join("")}</div>`}
  function formData(form){const fd=new FormData(form);const o={};for(const[k,v]of fd.entries())o[k]=v||null;return o}

  async function submitForm(form,method,endpoint,onOk){
    const btn=form.querySelector("[type=submit]");
    if(btn)btn.disabled=true;
    try{
      const data=formData(form);
      await api(endpoint,{method,body:JSON.stringify(data)});
      closeModal();
      if(onOk)onOk();
    }catch(e){
      const err=form.querySelector(".erp-form-error");
      if(err)err.textContent=e.message||"Erreur serveur";
    }finally{if(btn)btn.disabled=false}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPTABILITÉ
  // ══════════════════════════════════════════════════════════════════════════
  const COMPTA_TABS=[["dashboard","Tableau de bord"],["comptes","Plan comptable"],["ecritures","Écritures"],["balance","Balance"]];

  window.renderAccounting=async function(view,sub){
    sub=sub||"dashboard";
    try{
      if(sub==="comptes"){
        const data=await api("/accounting/comptes/page"+qs({society:soc(),page_size:100}));
        const rows=items(data);
        shell(view,"Comptabilité","Plan comptable","accounting",sub,COMPTA_TABS,
          table(["N° compte","Libellé","Type","Société"],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero)}</td>
            <td>${h(r.libelle)}</td>
            <td>${h(r.type_compte||"—")}</td>
            <td>${h(r.society||"—")}</td>
            <td><button class="erp-btn-link" onclick="erpEditCompte(${r.id})">Modifier</button></td>
          </tr>`),"Aucun compte."),
          `<button class="btn btn-primary" onclick="erpNewCompte()">+ Nouveau compte</button>`);
        return;
      }
      if(sub==="ecritures"){
        const data=await api("/accounting/ecritures/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Comptabilité","Journal des écritures","accounting",sub,COMPTA_TABS,
          table(["Pièce","Date","Journal","Libellé","Débit","Crédit","Statut"],rows.map(r=>`<tr>
            <td class="font-mono text-sm">${h(r.numero_piece||"")}</td>
            <td>${h(r.date_ecriture||"")}</td>
            <td><span class="erp-tag">${h(r.journal||"")}</span></td>
            <td>${h(r.libelle||"")}</td>
            <td class="text-right">${money(r.total_debit)}</td>
            <td class="text-right">${money(r.total_credit)}</td>
            <td>${pill(r.status||"brouillon")}</td>
          </tr>`),"Aucune écriture."),
          `<button class="btn btn-primary" onclick="erpNewEcriture()">+ Nouvelle écriture</button>`);
        return;
      }
      if(sub==="balance"){
        const rows=await api("/accounting/balance"+qs({society:soc()})).catch(()=>[]);
        const totalD=rows.reduce((s,r)=>s+(r.total_debit||0),0);
        const totalC=rows.reduce((s,r)=>s+(r.total_credit||0),0);
        shell(view,"Comptabilité","Balance comptable","accounting",sub,COMPTA_TABS,
          `<div class="erp-kpi-grid">${kpi("Total débit",money(totalD),"","")}${kpi("Total crédit",money(totalC),"","")}</div>`+
          table(["N° compte","Libellé","Total débit","Total crédit","Solde"],rows.map(r=>`<tr>
            <td class="font-mono">${h(r.compte_numero||"")}</td>
            <td>${h(r.libelle||"")}</td>
            <td class="text-right">${money(r.total_debit)}</td>
            <td class="text-right">${money(r.total_credit)}</td>
            <td class="text-right font-bold ${(r.solde||0)>=0?"text-emerald-700":"text-red-600"}">${money(r.solde)}</td>
          </tr>`),"Balance vide."));
        return;
      }
      const [c,e]=await Promise.all([
        api("/accounting/comptes/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
        api("/accounting/ecritures/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
      ]);
      shell(view,"Comptabilité","Pilotage comptable","accounting",sub,COMPTA_TABS,
        `<div class="erp-kpi-grid">
          ${kpi("Comptes",c.total||0,"Plan comptable")}
          ${kpi("Écritures",e.total||0,"Journal")}
        </div>`+
        card("Actions rapides",`<div class="erp-action-grid">
          <button onclick="nav('accounting/comptes')">📋 Plan comptable</button>
          <button onclick="nav('accounting/ecritures')">📝 Écritures</button>
          <button onclick="nav('accounting/balance')">⚖ Balance</button>
          <button onclick="erpNewEcriture()">+ Nouvelle écriture</button>
        </div>`));
    }catch(e){renderError(view,"Comptabilité",e)}
  };

  window.erpNewCompte=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouveau compte comptable</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveCompte(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("N° compte","numero","text","",true),field("Libellé","libelle","text","",true))}
        ${formRow(select("Type","type_compte",[["","— Sélectionner —"],["actif","Actif"],["passif","Passif"],["charge","Charge"],["produit","Produit"]]),field("Société","society","text",soc()))}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveCompte=async function(form){
    await submitForm(form,"POST","/accounting/comptes",()=>nav("accounting/comptes"));
  };
  window.erpEditCompte=async function(id){
    const r=await api("/accounting/comptes").then(rows=>rows.find(x=>x.id===id)).catch(()=>null);
    if(!r)return;
    openModal(`<h3 class="font-bold text-lg mb-4">Modifier compte ${h(r.numero)}</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpUpdateCompte(this,${id})">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("N° compte","numero","text",r.numero,true),field("Libellé","libelle","text",r.libelle,true))}
        ${formRow(select("Type","type_compte",[["","— Sélectionner —"],["actif","Actif"],["passif","Passif"],["charge","Charge"],["produit","Produit"]],r.type_compte||""),field("Société","society","text",r.society||""))}
        ${textarea("Notes","notes",r.notes||"")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>
      </form>`);
  };
  window.erpUpdateCompte=async function(form,id){
    await submitForm(form,"PUT","/accounting/comptes/"+id,()=>nav("accounting/comptes"));
  };
  window.erpNewEcriture=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouvelle écriture comptable</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveEcriture(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Date","date_ecriture","date",today(),true),select("Journal","journal",[["ACH","ACH — Achats"],["VTE","VTE — Ventes"],["BQ","BQ — Banque"],["OD","OD — Opérations diverses"],["CAI","CAI — Caisse"]]))}
        ${formRow(field("Libellé","libelle","text","",true,"style='min-width:280px'"),field("Réf. externe","ref_externe"))}
        ${field("Société","society","text",soc())}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveEcriture=async function(form){
    await submitForm(form,"POST","/accounting/ecritures",()=>nav("accounting/ecritures"));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ACHATS & FOURNISSEURS
  // ══════════════════════════════════════════════════════════════════════════
  const ACHATS_TABS=[["dashboard","Tableau de bord"],["fournisseurs","Fournisseurs"],["commandes","Commandes"],["receptions","Réceptions"],["factures","Factures"]];

  window.renderAchats=async function(view,sub){
    sub=sub||"dashboard";
    try{
      if(sub==="fournisseurs"){
        const data=await api("/achats/fournisseurs/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Achats","Référentiel fournisseurs","achats",sub,ACHATS_TABS,
          table(["Nom","Contact","Téléphone","Email","Statut",""],rows.map(r=>`<tr>
            <td><strong>${h(r.name)}</strong><br><small class="text-slate-500">${h(r.legal_name||"")}</small></td>
            <td>${h(r.contact_name||"—")}</td>
            <td>${h(r.phone||"—")}</td>
            <td>${h(r.email||"—")}</td>
            <td>${pill(r.status||"actif")}</td>
            <td><button class="erp-btn-link" onclick="erpEditFournisseur(${r.id})">Modifier</button></td>
          </tr>`),"Aucun fournisseur."),
          `<button class="btn btn-primary" onclick="erpNewFournisseur()">+ Nouveau fournisseur</button>${exportBtn("⬇ Excel","/achats/fournisseurs/export/xlsx"+qs({society:soc()}))}`);
        return;
      }
      if(sub==="commandes"){
        const data=await api("/achats/commandes/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Achats","Bons de commande","achats",sub,ACHATS_TABS,
          table(["N° BDC","Fournisseur","Date","Livraison prévue","HT","TTC","Statut",""],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero||"")}</td>
            <td>${h(r.fournisseur_name||"—")}</td>
            <td>${h(r.date_commande||"")}</td>
            <td>${h(r.date_livraison_prevue||"—")}</td>
            <td class="text-right">${money(r.total_ht)}</td>
            <td class="text-right font-bold">${money(r.total_ttc)}</td>
            <td>${pill(r.status||"brouillon")}</td>
            <td><button class="erp-btn-link text-slate-400" onclick="erpDownload('/achats/commandes/${r.id}/pdf','bdc-${h(r.numero||"")}')">PDF</button></td>
          </tr>`),"Aucune commande."),
          `<button class="btn btn-primary" onclick="erpNewCommande()">+ Nouveau BDC</button>${exportBtn("⬇ Excel","/achats/commandes/export/xlsx"+qs({society:soc()}))}`);
        return;
      }
      if(sub==="receptions"){
        const data=await api("/achats/receptions/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Achats","Réceptions marchandise","achats",sub,ACHATS_TABS,
          table(["N° réception","Fournisseur","Date","Statut",""],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero||"")}</td>
            <td>${h(r.fournisseur_name||"—")}</td>
            <td>${h(r.date_reception||"")}</td>
            <td>${pill(r.status||"en_cours")}</td>
            <td>${r.status==="en_cours"?`<button class="erp-btn-link text-emerald-600" onclick="erpValiderReception(${r.id})">✓ Valider</button>`:`<span class="text-slate-400 text-xs">—</span>`}</td>
          </tr>`),"Aucune réception."),
          `<button class="btn btn-primary" onclick="erpNewReception()">+ Nouvelle réception</button>`);
        return;
      }
      if(sub==="factures"){
        const data=await api("/achats/factures/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Achats","Factures fournisseur","achats",sub,ACHATS_TABS,
          table(["N°","Fournisseur","Date","Échéance","TTC","Payé","Restant","Statut"],rows.map(r=>{
            const restant=(r.total_ttc||0)-(r.montant_paye||0);
            return`<tr>
              <td class="font-mono font-bold">${h(r.numero||"")}</td>
              <td>${h(r.fournisseur_name||"—")}</td>
              <td>${h(r.date_facture||"")}</td>
              <td>${h(r.date_echeance||"—")}</td>
              <td class="text-right font-bold">${money(r.total_ttc)}</td>
              <td class="text-right text-emerald-700">${money(r.montant_paye)}</td>
              <td class="text-right ${restant>0?"text-red-600":""}">${money(restant)}</td>
              <td>${pill(r.status||"en_attente")}</td>
            </tr>`;}),
          "Aucune facture."),
          `<button class="btn btn-primary" onclick="erpNewFactureFournisseur()">+ Nouvelle facture</button>${exportBtn("⬇ Excel","/achats/factures/export/xlsx"+qs({society:soc()}))}`);
        return;
      }
      const [f,c,r,fa]=await Promise.all([
        api("/achats/fournisseurs/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
        api("/achats/commandes/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
        api("/achats/receptions/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
        api("/achats/factures/page"+qs({society:soc(),page_size:1})).catch(()=>({total:0})),
      ]);
      const stats=await api("/reporting/achats"+qs({society:soc()})).catch(()=>({}));
      shell(view,"Achats","Pilotage achats et fournisseurs","achats",sub,ACHATS_TABS,
        `<div class="erp-kpi-grid">
          ${kpi("Fournisseurs",f.total||0,"Référentiel")}
          ${kpi("Commandes",c.total||0,"Bons d'achat")}
          ${kpi("Réceptions",r.total||0,"Marchandises")}
          ${kpi("Factures",fa.total||0,"À payer")}
          ${stats.factures_fournisseur?kpi("Achats TTC",money(stats.factures_fournisseur.montant_ttc||0),"Total"):``}
          ${stats.factures_fournisseur?kpi("Restant à payer",money(stats.factures_fournisseur.restant_a_payer||0),"Dû"):``}
        </div>`+
        card("Actions rapides",`<div class="erp-action-grid">
          <button onclick="nav('achats/fournisseurs')">🏭 Fournisseurs</button>
          <button onclick="nav('achats/commandes')">📦 Commandes</button>
          <button onclick="nav('achats/receptions')">📬 Réceptions</button>
          <button onclick="nav('achats/factures')">🧾 Factures</button>
          <button onclick="erpNewFournisseur()">+ Fournisseur</button>
          <button onclick="erpNewCommande()">+ Commande</button>
        </div>`));
    }catch(e){renderError(view,"Achats",e)}
  };

  window.erpNewFournisseur=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouveau fournisseur</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveFournisseur(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Raison sociale","name","text","",true),field("Nom légal","legal_name"))}
        ${formRow(field("Contact","contact_name"),field("Poste","contact_position"))}
        ${formRow(field("Téléphone","phone","tel"),field("Email","email","email"))}
        ${formRow(field("NIF","nif"),field("RC","rc"))}
        ${formRow(field("Société","society","text",soc()),select("Statut","status",[["actif","Actif"],["inactif","Inactif"]]))}
        ${textarea("Adresse","address")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveFournisseur=async function(form){
    await submitForm(form,"POST","/achats/fournisseurs",()=>nav("achats/fournisseurs"));
  };
  window.erpEditFournisseur=async function(id){
    const r=await api("/achats/fournisseurs/"+id).catch(()=>null);
    if(!r)return;
    openModal(`<h3 class="font-bold text-lg mb-4">Modifier ${h(r.name)}</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpUpdateFournisseur(this,${id})">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Raison sociale","name","text",r.name,true),field("Nom légal","legal_name","text",r.legal_name||""))}
        ${formRow(field("Contact","contact_name","text",r.contact_name||""),field("Poste","contact_position","text",r.contact_position||""))}
        ${formRow(field("Téléphone","phone","tel",r.phone||""),field("Email","email","email",r.email||""))}
        ${formRow(field("NIF","nif","text",r.nif||""),field("RC","rc","text",r.rc||""))}
        ${formRow(field("Société","society","text",r.society||soc()),select("Statut","status",[["actif","Actif"],["inactif","Inactif"]],r.status||"actif"))}
        ${textarea("Adresse","address",r.address||"")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Enregistrer</button></div>
      </form>`);
  };
  window.erpUpdateFournisseur=async function(form,id){
    await submitForm(form,"PUT","/achats/fournisseurs/"+id,()=>nav("achats/fournisseurs"));
  };
  window.erpNewCommande=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouveau bon de commande</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveCommande(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Fournisseur","fournisseur_name","text","",true),field("Date commande","date_commande","date",today()))}
        ${formRow(field("Livraison prévue","date_livraison_prevue","date"),field("Société","society","text",soc()))}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveCommande=async function(form){
    await submitForm(form,"POST","/achats/commandes",()=>nav("achats/commandes"));
  };
  window.erpNewReception=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouvelle réception marchandise</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveReception(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Fournisseur","fournisseur_name","text","",true),field("Date réception","date_reception","date",today()))}
        ${field("Société","society","text",soc())}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveReception=async function(form){
    await submitForm(form,"POST","/achats/receptions",()=>nav("achats/receptions"));
  };
  window.erpValiderReception=async function(id){
    if(!confirm("Valider cette réception ? Les mouvements de stock seront créés automatiquement."))return;
    try{
      const r=await api("/achats/receptions/"+id+"/valider",{method:"POST"});
      const msg=r.mouvements_crees>0?`Réception validée — ${r.mouvements_crees} mouvement(s) de stock créé(s).`:"Réception validée (aucun article en stock correspondant trouvé).";
      if(typeof toast==="function")toast(msg,"success");
      nav("achats/receptions");
    }catch(e){if(typeof toast==="function")toast(e.message||"Erreur","error");else alert(e.message)}
  };
  window.erpCalcTTC=function(input){
    const f=input.closest("form");
    const ht=parseFloat(f.querySelector("[name=total_ht]")?.value)||0;
    const tva=parseFloat(f.querySelector("[name=tva]")?.value)||0;
    const ttc=f.querySelector("[name=total_ttc]");
    if(ttc)ttc.value=(ht+tva).toFixed(2);
  };
  window.erpNewFactureFournisseur=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouvelle facture fournisseur</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveFactureFournisseur(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Fournisseur","fournisseur_name","text","",true),field("N° facture fournisseur","numero_fournisseur"))}
        ${formRow(field("Date facture","date_facture","date",today()),field("Échéance","date_echeance","date"))}
        ${formRow(field("Montant HT","total_ht","number","0",false,"oninput='erpCalcTTC(this)'"),field("TVA (montant)","tva","number","0",false,"oninput='erpCalcTTC(this)'"),field("Montant TTC","total_ttc","number","0",false,"readonly style='background:var(--erp-muted,#f1f5f9)'"))}
        ${formRow(field("Société","society","text",soc()))}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveFactureFournisseur=async function(form){
    await submitForm(form,"POST","/achats/factures",()=>nav("achats/factures"));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // VENTES & CLIENTS
  // ══════════════════════════════════════════════════════════════════════════
  const VENTES_TABS=[["dashboard","Tableau de bord"],["devis","Devis"],["commandes","Commandes"],["livraisons","Livraisons"]];

  window.renderVentes=async function(view,sub){
    sub=sub||"dashboard";
    try{
      if(sub==="devis"){
        const data=await api("/ventes/devis/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Ventes","Devis clients","ventes",sub,VENTES_TABS,
          table(["N°","Client","Date","Validité","Objet","TTC","Statut",""],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero||"")}</td>
            <td><strong>${h(r.client_name||"—")}</strong></td>
            <td>${h(r.date_devis||"")}</td>
            <td>${h(r.date_validite||"—")}</td>
            <td>${h(r.objet||"—")}</td>
            <td class="text-right font-bold">${money(r.total_ttc)}</td>
            <td>${pill(r.status||"brouillon")}</td>
            <td class="erp-actions-cell">
              ${r.status==="brouillon"?`<button class="erp-btn-link" onclick="erpEnvoyerDevis(${r.id})">Envoyer</button>`:""}
              ${r.status==="envoyé"?`<button class="erp-btn-link text-emerald-600" onclick="erpConvertirDevis(${r.id})">→ Commande</button>`:""}
              <button class="erp-btn-link text-slate-400" onclick="erpDownload('/ventes/devis/${r.id}/pdf','devis-${h(r.numero||String(r.id))}')">PDF</button>
            </td>
          </tr>`),"Aucun devis."),
          `<button class="btn btn-primary" onclick="erpNewDevis()">+ Nouveau devis</button>${exportBtn("⬇ Excel","/ventes/devis/export/xlsx"+qs({society:soc()}))}`);
        return;
      }
      if(sub==="commandes"){
        const data=await api("/ventes/commandes/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Ventes","Commandes client","ventes",sub,VENTES_TABS,
          table(["N°","Client","Date","Livraison prévue","Objet","TTC","Statut"],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero||"")}</td>
            <td><strong>${h(r.client_name||"—")}</strong></td>
            <td>${h(r.date_commande||"")}</td>
            <td>${h(r.date_livraison_prevue||"—")}</td>
            <td>${h(r.objet||"—")}</td>
            <td class="text-right font-bold">${money(r.total_ttc)}</td>
            <td>${pill(r.status||"brouillon")}</td>
          </tr>`),"Aucune commande."),
          `<button class="btn btn-primary" onclick="erpNewCommandeClient()">+ Nouvelle commande</button>${exportBtn("⬇ Excel","/ventes/commandes/export/xlsx"+qs({society:soc()}))}`);
        return;
      }
      if(sub==="livraisons"){
        const data=await api("/ventes/livraisons/page"+qs({society:soc(),page_size:50}));
        const rows=items(data);
        shell(view,"Ventes","Bons de livraison","ventes",sub,VENTES_TABS,
          table(["N°","Client","Date livraison","Statut"],rows.map(r=>`<tr>
            <td class="font-mono font-bold">${h(r.numero||"")}</td>
            <td><strong>${h(r.client_name||"—")}</strong></td>
            <td>${h(r.date_livraison||"")}</td>
            <td>${pill(r.status||"brouillon")}</td>
          </tr>`),"Aucun bon de livraison."),
          `<button class="btn btn-primary" onclick="erpNewBL()">+ Nouveau BL</button>`);
        return;
      }
      const stats=await api("/reporting/ventes"+qs({society:soc()})).catch(()=>({}));
      const devis=stats.devis||{};
      const cmds=stats.commandes||{};
      shell(view,"Ventes","Pilotage commercial et clients","ventes",sub,VENTES_TABS,
        `<div class="erp-kpi-grid">
          ${kpi("Devis",devis.total||0,"Émis")}
          ${kpi("Montant devis",money(devis.montant_ttc||0),"TTC total")}
          ${kpi("Commandes",cmds.total||0,"Confirmées")}
          ${kpi("CA commandes",money(cmds.montant_ttc||0),"TTC total")}
        </div>`+
        card("Parcours commercial",`<div class="erp-action-grid">
          <button onclick="nav('ventes/devis')">📋 Devis</button>
          <button onclick="nav('ventes/commandes')">📦 Commandes</button>
          <button onclick="nav('ventes/livraisons')">🚚 Livraisons</button>
          <button onclick="erpNewDevis()">+ Nouveau devis</button>
        </div>`));
    }catch(e){renderError(view,"Ventes",e)}
  };

  window.erpNewDevis=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouveau devis</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveDevis(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Client","client_name","text","",true),field("Date","date_devis","date",today()))}
        ${formRow(field("Validité jusqu'au","date_validite","date"),field("Société","society","text",soc()))}
        ${field("Objet / Titre","objet","text","",true,"style='width:100%'")}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveDevis=async function(form){
    await submitForm(form,"POST","/ventes/devis",()=>nav("ventes/devis"));
  };
  window.erpEnvoyerDevis=async function(id){
    if(!confirm("Marquer ce devis comme envoyé au client ?"))return;
    try{await api("/ventes/devis/"+id+"/valider",{method:"POST"});nav("ventes/devis");}
    catch(e){if(typeof toast==="function")toast(e.message||"Erreur","error");else alert(e.message)}
  };
  window.erpConvertirDevis=async function(id){
    if(!confirm("Convertir ce devis en commande client ?"))return;
    try{await api("/ventes/devis/"+id+"/convertir",{method:"POST"});nav("ventes/commandes");}
    catch(e){if(typeof toast==="function")toast(e.message||"Erreur","error");else alert(e.message)}
  };
  window.erpNewCommandeClient=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouvelle commande client</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveCommandeClient(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Client","client_name","text","",true),field("Date","date_commande","date",today()))}
        ${formRow(field("Livraison prévue","date_livraison_prevue","date"),field("Société","society","text",soc()))}
        ${field("Objet","objet","text","",true,"style='width:100%'")}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveCommandeClient=async function(form){
    await submitForm(form,"POST","/ventes/commandes",()=>nav("ventes/commandes"));
  };
  window.erpNewBL=function(){
    openModal(`<h3 class="font-bold text-lg mb-4">Nouveau bon de livraison</h3>
      <form class="erp-form" onsubmit="event.preventDefault();erpSaveBL(this)">
        <div class="erp-form-error text-red-500 text-sm mb-2"></div>
        ${formRow(field("Client","client_name","text","",true),field("Date livraison","date_livraison","date",today()))}
        ${field("Société","society","text",soc())}
        ${textarea("Notes","notes")}
        <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="submit" class="btn btn-primary">Créer</button></div>
      </form>`);
  };
  window.erpSaveBL=async function(form){
    await submitForm(form,"POST","/ventes/livraisons",()=>nav("ventes/livraisons"));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTING & DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════
  const REPORTING_TABS=[["dashboard","Dashboard"],["ventes","Ventes"],["achats","Achats"],["tresorerie","Trésorerie"],["top-clients","Top clients"],["top-fournisseurs","Top fournisseurs"]];

  window.renderReporting=async function(view,sub){
    sub=sub||"dashboard";
    const endpoint=sub==="top-clients"?"top-clients":sub==="top-fournisseurs"?"top-fournisseurs":sub;
    try{
      if(sub==="top-clients"){
        const rows=await api("/reporting/top-clients"+qs({society:soc(),limit:20})).catch(()=>[]);
        shell(view,"Reporting","Top 20 clients par CA","reporting",sub,REPORTING_TABS,
          table(["#","Client","CA TTC"],rows.map((r,i)=>`<tr>
            <td class="text-slate-400 text-sm">${i+1}</td>
            <td><strong>${h(r.client_name||"—")}</strong></td>
            <td class="text-right font-bold text-emerald-700">${money(r.total_ttc)}</td>
          </tr>`),`Aucune donnée.`));
        return;
      }
      if(sub==="top-fournisseurs"){
        const rows=await api("/reporting/top-fournisseurs"+qs({society:soc(),limit:20})).catch(()=>[]);
        shell(view,"Reporting","Top 20 fournisseurs par achats","reporting",sub,REPORTING_TABS,
          table(["#","Fournisseur","Total TTC"],rows.map((r,i)=>`<tr>
            <td class="text-slate-400 text-sm">${i+1}</td>
            <td><strong>${h(r.fournisseur_name||"—")}</strong></td>
            <td class="text-right font-bold text-orange-600">${money(r.total_ttc)}</td>
          </tr>`),`Aucune donnée.`));
        return;
      }
      if(sub==="ventes"){
        const d=await api("/reporting/ventes"+qs({society:soc()})).catch(()=>({}));
        const dv=d.devis||{};const dc=d.commandes||{};const df=d.factures||{};
        shell(view,"Reporting","Statistiques ventes","reporting",sub,REPORTING_TABS,
          `<div class="erp-kpi-grid">
            ${kpi("Devis",dv.total||0,"Émis")}
            ${kpi("Montant devis",money(dv.montant_ttc||0),"TTC")}
            ${kpi("Commandes",dc.total||0,"Clients")}
            ${kpi("CA commandes",money(dc.montant_ttc||0),"TTC")}
            ${kpi("Factures",df.total||0,"Émises")}
            ${kpi("CA facturé",money(df.montant_ttc||0),"TTC")}
          </div>`+
          erpStatusGrid("Statuts devis",dv.par_status||{})+
          erpStatusGrid("Statuts commandes",dc.par_status||{}));
        return;
      }
      if(sub==="achats"){
        const d=await api("/reporting/achats"+qs({society:soc()})).catch(()=>({}));
        const db2=d.bons_commande||{};const df=d.factures_fournisseur||{};
        shell(view,"Reporting","Statistiques achats","reporting",sub,REPORTING_TABS,
          `<div class="erp-kpi-grid">
            ${kpi("Bons de commande",db2.total||0,"BDC")}
            ${kpi("Montant BDC",money(db2.montant_ttc||0),"TTC")}
            ${kpi("Factures fournisseur",df.total||0,"Reçues")}
            ${kpi("Total achats",money(df.montant_ttc||0),"TTC")}
            ${kpi("Payé",money(df.montant_paye||0),"Décaissé")}
            ${kpi("Restant à payer",money(df.restant_a_payer||0),"Dû","#dc2626")}
          </div>`);
        return;
      }
      if(sub==="tresorerie"){
        const d=await api("/reporting/tresorerie"+qs({society:soc()})).catch(()=>({}));
        shell(view,"Reporting","Trésorerie","reporting",sub,REPORTING_TABS,
          `<div class="erp-kpi-grid">
            ${kpi("Encaissements clients",money(d.encaissements_clients||0),"Paiements reçus","#059669")}
            ${kpi("Entrées caisse",money(d.entrees_caisse||0),"Espèces entrées","#059669")}
            ${kpi("Sorties caisse",money(d.sorties_caisse||0),"Espèces sorties","#dc2626")}
            ${kpi("Décaissements fournisseurs",money(d.decaissements_fournisseurs||0),"Payé aux fournisseurs","#dc2626")}
            ${kpi("Solde net estimé",money(d.solde_net||0),"Balance",(d.solde_net||0)>=0?"#059669":"#dc2626")}
          </div>`);
        return;
      }
      const d=await api("/reporting/dashboard"+qs({society:soc()})).catch(()=>({}));
      shell(view,"Reporting","Indicateurs consolidés ERP","reporting",sub,REPORTING_TABS,
        `<div class="erp-kpi-grid">
          ${kpi("CA HT",money(d.chiffre_affaires_ht||0),"Chiffre d'affaires","#059669")}
          ${kpi("CA TTC",money(d.chiffre_affaires_ttc||0),"Facturé TTC","")}
          ${kpi("Encaissements",money(d.paiements_encaisses||0),"Reçus","#059669")}
          ${kpi("Achats TTC",money(d.achats_ttc||0),"Décaissé","#dc2626")}
          ${kpi("Marge brute estimée",money(d.marge_brute_estimee||0),"CA HT − Achats HT",(d.marge_brute_estimee||0)>=0?"#059669":"#dc2626")}
          ${kpi("Clients",d.nb_clients||0,"Référentiel")}
          ${kpi("Fournisseurs",d.nb_fournisseurs||0,"Référentiel")}
          ${kpi("Devis",d.nb_devis||0,"Émis")}
          ${kpi("Commandes",d.nb_commandes||0,"Clients")}
          ${kpi("Factures",d.nb_factures||0,"Émises")}
        </div>`+
        card("Navigation rapide",`<div class="erp-action-grid">
          <button onclick="nav('reporting/ventes')">📈 Ventes</button>
          <button onclick="nav('reporting/achats')">📉 Achats</button>
          <button onclick="nav('reporting/tresorerie')">💰 Trésorerie</button>
          <button onclick="nav('reporting/top-clients')">🏆 Top clients</button>
          <button onclick="nav('reporting/top-fournisseurs')">🏭 Top fournisseurs</button>
        </div>`));
    }catch(e){renderError(view,"Reporting",e)}
  };

  function erpStatusGrid(title,statuses){
    const entries=Object.entries(statuses);
    if(!entries.length)return"";
    return card(title,`<div class="erp-status-grid">${entries.map(([s,n])=>`<div class="erp-status-item">${pill(s)}<strong>${n}</strong></div>`).join("")}</div>`);
  }
})();
