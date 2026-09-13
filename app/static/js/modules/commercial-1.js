/* Phase 2 — commercial-1. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function devisCalcCoutRowHTML(n){
  const NI="border:1px solid #e2e8f0;border-radius:4px;padding:3px 5px;font-size:11px;background:#fff;width:100%;box-sizing:border-box";
  const NR=NI+";text-align:right";
  const onU="oninput=\"devisCalcCoutUpdateRow(this.closest('tr'))\"";
  const onS="oninput=\"devisCalcCoutAutoIRG(this);devisCalcCoutUpdateRow(this.closest('tr'))\"";
  const bg=n%2===0?"#f8fafc":"#fff";
  return '<tr class="cc-row" style="border-bottom:1px solid #e2e8f0;background:'+bg+'">'+
    '<td style="padding:4px 6px;text-align:center;font-weight:700;color:#64748b">'+n+'</td>'+
    '<td style="padding:3px 4px"><input name="cc-fn" style="'+NI+'" placeholder="Fonction..." '+onU+'/></td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-sal" min="0" style="'+NR+'" value="30000" '+onS+'/></td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:700;color:#334155" class="cc-cnas">—</td>'+
    '<td style="padding:3px 4px;position:relative">'+
      '<input type="number" name="cc-irg" min="0" style="'+NR+'" value="0" '+onU+'/>'+
      '<span title="IRG calculé auto (Loi 2024)" style="position:absolute;top:1px;right:5px;font-size:8px;color:#059669;font-weight:700;pointer-events:none">auto</span>'+
    '</td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-fgp" min="0" max="100" style="'+NR+'" value="6" '+onU+'/></td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:700;color:#334155" class="cc-fgestion">—</td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-glt" min="0" style="'+NR+'" value="0" '+onU+'/></td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-prk" min="0" style="'+NR+'" value="0" '+onU+'/></td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-rng" min="0" style="'+NR+'" value="0" '+onU+'/></td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-tph" min="0" style="'+NR+'" value="0" '+onU+'/></td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:700;color:#334155" class="cc-conge">—</td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:800;color:#1e4d8c;background:#eff6ff" class="cc-ttg">—</td>'+
    '<td style="padding:3px 4px"><input type="number" name="cc-mrg" min="0" max="100" style="'+NR+'" value="20" '+onU+'/></td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:700;color:#334155" class="cc-marge">—</td>'+
    '<td style="padding:3px 6px;text-align:right;font-size:10px;color:#64748b" class="cc-ibs">—</td>'+
    '<td style="padding:3px 6px;text-align:right;font-size:10px;color:#64748b" class="cc-formation">—</td>'+
    '<td style="padding:3px 6px;text-align:right;font-weight:900;color:#dc2626;font-size:12px;background:#fff5f5" class="cc-ttgfinal">—</td>'+
    '<td style="padding:3px 4px;text-align:center"><button type="button" onclick="this.closest(\'tr\').remove();devisCalcCoutRenum()" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:13px;line-height:1">✕</button></td>'+
    '</tr>';
}

function devisCalcCoutAutoIRG(salInput){
  const tr=salInput.closest("tr");
  const irg=calcIRGAlgerie(parseFloat(salInput.value)||0);
  const irgInp=tr.querySelector("[name='cc-irg']");
  if(irgInp)irgInp.value=irg;
}

function devisCalcCoutAddRow(){
  const tbody=document.getElementById("cc-tbody");
  if(!tbody)return;
  const n=tbody.querySelectorAll("tr.cc-row").length+1;
  tbody.insertAdjacentHTML("beforeend",devisCalcCoutRowHTML(n));
  const newRow=tbody.lastElementChild;
  const salInp=newRow.querySelector("[name='cc-sal']");
  if(salInp)devisCalcCoutAutoIRG(salInp);
  devisCalcCoutUpdateRow(newRow);
  newRow.querySelector("[name='cc-fn']")?.focus();
}

function devisCalcCoutRenum(){
  document.querySelectorAll("#cc-tbody tr.cc-row").forEach((tr,i)=>{
    const c=tr.querySelector("td:first-child");
    if(c)c.textContent=i+1;
    tr.style.background=i%2===0?"#f8fafc":"#fff";
  });
}

function devisCalcCoutUpdateRow(tr){
  const gi=name=>parseFloat(tr.querySelector("[name='"+name+"']")?.value)||0;
  const salaire=gi("cc-sal"),irg=gi("cc-irg"),fgesPct=gi("cc-fgp");
  const gilet=gi("cc-glt"),parkas=gi("cc-prk"),rangers=gi("cc-rng"),tph=gi("cc-tph"),margePct=gi("cc-mrg");
  const cnas=salaire*0.35;
  const fgestion=salaire*fgesPct/100;
  const conge=salaire/11;
  const ttg=salaire+cnas+irg+fgestion+gilet+parkas+rangers+tph+conge;
  const marge=ttg*margePct/100;
  const ttgFinal=ttg+marge;
  const fmt=v=>v>0?v.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
  const s=(cls,v)=>{const el=tr.querySelector("."+cls);if(el)el.textContent=fmt(v);};
  s("cc-cnas",cnas);s("cc-fgestion",fgestion);s("cc-conge",conge);
  s("cc-ttg",ttg);s("cc-marge",marge);s("cc-ibs",marge*0.26);s("cc-formation",salaire*0.02);
  const f=tr.querySelector(".cc-ttgfinal");
  if(f)f.textContent=ttgFinal>0?ttgFinal.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
}

function devisCalcCoutUpdate(){
  const g=id=>parseFloat(document.getElementById(id)?.value)||0;
  const salaire=g("cc-salaire"),chargesPct=g("cc-charges"),transport=g("cc-transport"),panier=g("cc-panier");
  const nuitPct=g("cc-nuit"),wePct=g("cc-we"),autresPrimes=g("cc-autresPrimes");
  const fraisGenPct=g("cc-fraisGen"),margePct=g("cc-marge");
  const nbAgents=Math.max(1,parseInt(document.getElementById("cc-nbAgents")?.value)||1);
  const coutAgent=salaire+salaire*chargesPct/100+transport+panier+salaire*nuitPct/100+salaire*wePct/100+autresPrimes;
  const coutTotal=coutAgent*nbAgents;
  const frais=coutTotal*fraisGenPct/100;
  const prixHT=(coutTotal+frais)*(1+margePct/100);
  const tva=prixHT*0.19;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=formatDZD(v);};
  set("cc-r-cout-agent",coutAgent);set("cc-r-cout-total",coutTotal);set("cc-r-frais",frais);
  set("cc-r-ht",prixHT);set("cc-r-tva",tva);set("cc-r-ttc",prixHT+tva);
  set("cc-r-unit",nbAgents>0?prixHT/nbAgents:prixHT);
}

function devisCalcCoutInsererFormulaire(){
  const g=id=>parseFloat(document.getElementById(id)?.value)||0;
  const salaire=g("cc-salaire"),chargesPct=g("cc-charges"),transport=g("cc-transport"),panier=g("cc-panier");
  const nuitPct=g("cc-nuit"),wePct=g("cc-we"),autresPrimes=g("cc-autresPrimes");
  const fraisGenPct=g("cc-fraisGen"),margePct=g("cc-marge");
  const nbAgents=Math.max(1,parseInt(document.getElementById("cc-nbAgents")?.value)||1);
  const designation=(document.getElementById("cc-designation")?.value||"").trim()||"Prestation de gardiennage";
  const unite=document.getElementById("cc-unite")?.value||"Mois";
  const coutAgent=salaire+salaire*chargesPct/100+transport+panier+salaire*nuitPct/100+salaire*wePct/100+autresPrimes;
  const coutTotal=coutAgent*nbAgents;
  const frais=coutTotal*fraisGenPct/100;
  const prixHT=(coutTotal+frais)*(1+margePct/100);
  const prixUnitHT=Math.round(prixHT/nbAgents*100)/100;
  closeModal();
  devisEditorLigneAdd({designation,unite,qte:nbAgents,prixUnitHT,remise:0});
}

function devisCalcCoutInserer(){
  const rows=document.querySelectorAll("#cc-tbody tr.cc-row");
  if(!rows.length){closeModal();return;}
  const lignes=[];
  rows.forEach((tr,i)=>{
    const gi=name=>parseFloat(tr.querySelector("[name='"+name+"']")?.value)||0;
    const designation=(tr.querySelector("[name='cc-fn']")?.value||"").trim()||("Poste "+(i+1));
    const salaire=gi("cc-sal"),irg=gi("cc-irg"),fgesPct=gi("cc-fgp");
    const gilet=gi("cc-glt"),parkas=gi("cc-prk"),rangers=gi("cc-rng"),tph=gi("cc-tph"),margePct=gi("cc-mrg");
    const cnas=salaire*0.35,fgestion=salaire*fgesPct/100,conge=salaire/11;
    const ttg=salaire+cnas+irg+fgestion+gilet+parkas+rangers+tph+conge;
    const ttgFinal=ttg+ttg*margePct/100;
    if(salaire>0||designation)lignes.push({designation,unite:"Mois",qte:1,prixUnitHT:Math.round(ttgFinal*100)/100,remise:0});
  });
  closeModal();
  lignes.forEach(l=>devisEditorLigneAdd(l));
}

function igsPrestationPreset(select){
  const p=IGS_PRESTATIONS_OFFICIELLES[Number(select.value)];if(!p)return;
  const form=select.closest("form");if(!form)return;
  form.elements.designation.value=p.designation;
  form.elements.categorie.value=p.categorie;
  form.elements.unite.value=p.unite;
  if(!form.elements.description.value.trim())form.elements.description.value=p.designation;
}

function igsCatalogueToggleAll(checked){
  document.querySelectorAll(".igs-catalogue-check").forEach(el=>{el.checked=!!checked});
  igsCatalogueSelectionChanged();
}

function igsCatalogueSelectionChanged(){
  const form=document.querySelector(".modal-bg form");if(!form)return;
  const bulk=!!form.querySelector(".igs-catalogue-check:checked");
  ["designation","categorie","unite","prixHT","description"].forEach(name=>{
    const el=form.elements[name];if(!el)return;
    el.disabled=bulk;
    el.style.background=bulk?"#f1f5f9":"";
    el.style.color=bulk?"#94a3b8":"";
    el.style.cursor=bulk?"not-allowed":"";
  });
  const submit=form.querySelector(".igs-custom-submit");
  if(submit){submit.disabled=bulk;submit.title=bulk?"Utilisez le bouton Ajouter les prestations sélectionnées":""}
  const hint=form.querySelector(".igs-custom-disabled-hint");
  if(hint)hint.style.display=bulk?"block":"none";
}

async function igsCatalogueImportSelected(){
  const form=document.querySelector(".modal-bg form");if(!form)return;
  const indexes=[...form.querySelectorAll(".igs-catalogue-check:checked")].map(el=>Number(el.value)).filter(Number.isInteger);
  if(!indexes.length){toast("Sélectionnez au moins une prestation","error");return}
  const societe=form.elements.societe?.value||mySoc();
  db.catalogue=db.catalogue||[];
  const existing=new Set(db.catalogue.filter(x=>String(x.societe||"")===String(societe||"")).map(x=>String(x.designation||"").trim().toLowerCase()));
  let added=0,skipped=0;
  indexes.forEach(i=>{
    const preset=IGS_PRESTATIONS_OFFICIELLES[i];if(!preset)return;
    const key=preset.designation.trim().toLowerCase();
    if(existing.has(key)){skipped++;return}
    const now=new Date().toISOString();
    db.catalogue.push({id:uid("ct"),code:nextPrestCode(),societe,designation:preset.designation,categorie:preset.categorie,unite:preset.unite,prixHT:0,description:preset.designation,createdAt:now,updatedAt:now});
    existing.add(key);added++;
  });
  if(!added){toast("Toutes les prestations sélectionnées existent déjà","info");return}
  try{await sgdiApi("/api/irongs/collections/catalogue",{method:"PUT",body:{data:db.catalogue},legacy:false})}catch(e){toast("Erreur de sauvegarde : "+(e.message||e),"error");return}
  closeModal();toast(`${added} prestation(s) ajoutée(s)${skipped?` · ${skipped} doublon(s) ignoré(s)`:""}`,"success");renderView();
}

function renderCommCatalogue(view){
  const rawList=bySoc(db.catalogue||[]).slice();
  const seenPrestations=new Set();
  const list=rawList.filter(p=>{
    const key=[p.societe,p.code,p.designation].map(v=>String(v||"").trim().toLowerCase()).join("|");
    if(seenPrestations.has(key))return false;
    seenPrestations.add(key);
    return true;
  });
  const CATS_SEC=[...IGS_PRESTATION_CATEGORIES,"Autre"];
  const byCat={};CATS_SEC.forEach(k=>byCat[k]=[]);list.forEach(p=>{const k=p.categorie||"Autre";if(!byCat[k])byCat[k]=[];byCat[k].push(p);});
  const catBlocks=Object.entries(byCat).filter(([,ps])=>ps.length>0).map(([cat,ps])=>`
    <div class="card p-0 mb-4 overflow-hidden">
      <div style="background:#0f2d5a;padding:10px 16px;display:flex;align-items:center;justify-content:space-between">
        <span style="color:#fff;font-weight:800;font-size:14px">${escapeHTML(cat)}</span>
        <span style="background:rgba(255,255,255,0.15);color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px">${ps.length} prestation${ps.length>1?"s":""}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0">Code</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0">Désignation</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0">Description</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;width:120px">Unité</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;width:130px">Prix HT</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;width:190px">Actions</th>
        </tr></thead>
        <tbody>${ps.map(p=>`<tr style="border-bottom:1px solid #f1f5f9" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
          <td style="padding:8px 12px;font-family:monospace;font-size:11px;color:#64748b">${escapeHTML(p.code||"")}</td>
          <td style="padding:8px 12px;font-weight:700;color:#0f172a">${escapeHTML(p.designation||"")}</td>
          <td style="padding:8px 12px;font-size:12px;color:#475569;max-width:300px">${p.description?`${escapeHTML(p.description.slice(0,80))}${p.description.length>80?"…":""}`:`<span style="color:#94a3b8;font-style:italic">Non renseignée</span>`}</td>
          <td style="padding:8px 12px;text-align:center"><span class="pill pill-indigo" style="font-size:10px;white-space:nowrap">${escapeHTML(p.unite||"—")}</span></td>
          <td style="padding:8px 12px;text-align:right;font-weight:800;color:#043970;white-space:nowrap">${Number(p.prixHT)>0?money(p.prixHT):`<span style="color:#dc2626;font-size:11px">Non renseigné</span>`}</td>
          <td style="padding:8px 12px;text-align:right"><div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="btn btn-ghost text-xs" onclick="openCataloguePrestModal('${p.id}')">Modifier</button>
            <button class="btn btn-danger text-xs" onclick="deletePrest('${p.id}')">Supprimer</button>
          </div></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`).join("");
  view.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div><h1 style="font-size:20px;font-weight:800;color:#0f2d5a;margin:0">Catalogue de prestations</h1>
    <p style="font-size:13px;color:#64748b;margin:4px 0 0">${list.length} prestation${list.length>1?"s":""} · Catalogue multiservices IRON GLOBAL SOLUTION</p></div>
    <button class="btn btn-primary" onclick="openCataloguePrestModal()">+ Nouvelle prestation</button>
  </div>
  ${commTabs("catalogue")}
  ${list.length===0?`<div class="card p-10 text-center" style="color:#94a3b8">
    <div style="font-size:48px;margin-bottom:12px">🛡</div>
    <div style="font-weight:700;font-size:15px;margin-bottom:6px">Aucune prestation</div>
    <div style="font-size:13px;margin-bottom:16px">Créez une prestation à partir du catalogue officiel IRON GLOBAL SOLUTION</div>
    <button class="btn btn-primary" onclick="openCataloguePrestModal()">+ Créer une prestation</button>
  </div>`:catBlocks}`;
}

function nextPrestCode(){
  const nums=(db.catalogue||[]).map(p=>String(p.code||"").match(/^PREST-(\d+)$/i)).filter(Boolean).map(m=>parseInt(m[1],10)||0);
  const next=(nums.length?Math.max(...nums):0)+1;
  return `PREST-${String(next).padStart(4,"0")}`;
}

function openCataloguePrestModal(id){
  const p=(db.catalogue||[]).find(x=>x.id===id);
  const isEdit=!!p;
  const code=p?.code||nextPrestCode();
  const CATS_SEC=[...IGS_PRESTATION_CATEGORIES,"Autre"];
  const UNITES=[...IGS_PRESTATION_UNITES,"Vacation / jour","Vacation / nuit","Forfait journalier","Heure"];
  const officialByCategory=IGS_PRESTATION_CATEGORIES.map(cat=>`<section style="border:1px solid #dbe3ec;border-radius:8px;overflow:hidden"><div style="padding:7px 10px;background:#eef4fa;color:#0f2d5a;font-size:11px;font-weight:850;text-transform:uppercase">${escapeHTML(cat)}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px;padding:5px 10px">${IGS_PRESTATIONS_OFFICIELLES.map((x,i)=>({x,i})).filter(o=>o.x.categorie===cat).map(({x,i})=>`<label style="display:flex;align-items:flex-start;gap:8px;padding:7px 2px;margin:0;font-size:11px;line-height:1.35;color:#243b55;cursor:pointer"><input type="checkbox" class="igs-catalogue-check" value="${i}" onchange="igsCatalogueSelectionChanged()" style="width:15px;height:15px;margin-top:1px;flex:0 0 auto"/><span>${escapeHTML(x.designation)}</span></label>`).join("")}</div></section>`).join("");
  openModal(`<h3 style="font-weight:800;font-size:16px;color:#0f2d5a;margin:0 0 16px">${isEdit?"Modifier prestation":"Nouvelle prestation"}</h3>
    <form onsubmit="event.preventDefault();confirmPrest('${id||""}')">
      <div class="rh-op-grid" style="margin-bottom:12px">
        <label><span style="font-size:12px;font-weight:700;color:#334155">Code</span><input class="input" name="code" value="${escapeHTML(code)}" style="font-family:monospace;background:#f8fafc" readonly/></label>
        <label><span style="font-size:12px;font-weight:700;color:#334155">Société</span><select class="select" name="societe">${SOCIETES.map(s=>`<option ${((p?.societe)||mySoc())===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></label>
      </div>
      ${isEdit?"":`<fieldset style="margin:0 0 14px;border:1px solid #cbd8e6;border-radius:10px;padding:12px;background:#fbfdff"><legend style="padding:0 7px;color:#0f2d5a;font-size:12px;font-weight:850">Catalogue officiel IGS</legend><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><label style="display:flex;align-items:center;gap:7px;margin:0;font-size:12px;font-weight:800;color:#0f2d5a;cursor:pointer"><input type="checkbox" onchange="igsCatalogueToggleAll(this.checked)" style="width:16px;height:16px"/> Tout sélectionner</label><button type="button" class="btn btn-primary" onclick="igsCatalogueImportSelected()">Ajouter les prestations sélectionnées</button></div><div style="display:grid;gap:8px;max-height:310px;overflow:auto;padding-right:4px">${officialByCategory}</div></fieldset><div style="display:flex;align-items:center;gap:10px;margin:4px 0 12px;color:#64748b;font-size:11px"><span style="height:1px;background:#dbe3ec;flex:1"></span>OU AJOUTER UNE PRESTATION PERSONNALISÉE<span style="height:1px;background:#dbe3ec;flex:1"></span></div><div class="igs-custom-disabled-hint" style="display:none;margin:-4px 0 12px;padding:8px 11px;border-radius:7px;background:#eef4fa;color:#36536f;font-size:11px;font-weight:700">Mode sélection multiple actif : utilisez « Ajouter les prestations sélectionnées ».</div>`}
      <label style="display:block;margin-bottom:12px"><span style="font-size:12px;font-weight:700;color:#334155">Désignation *</span><input class="input" name="designation" value="${escapeHTML(p?.designation||"")}" required style="margin-top:4px;width:100%"/></label>
      <div class="rh-op-grid" style="margin-bottom:12px">
        <label><span style="font-size:12px;font-weight:700;color:#334155">Catégorie</span>
          <select class="select" name="categorie" style="margin-top:4px">${CATS_SEC.map(c=>`<option value="${escapeHTML(c)}" ${(p?.categorie||"Gardiennage")===c?"selected":""}>${escapeHTML(c)}</option>`).join("")}</select>
        </label>
        <label><span style="font-size:12px;font-weight:700;color:#334155">Unité</span>
          <select class="select" name="unite" style="margin-top:4px">${UNITES.map(u=>`<option value="${escapeHTML(u)}" ${(p?.unite||"Agent / mois")===u?"selected":""}>${escapeHTML(u)}</option>`).join("")}</select>
        </label>
      </div>
      <label style="display:block;margin-bottom:12px"><span style="font-size:12px;font-weight:700;color:#334155">Prix HT (DZD) <small style="font-weight:500;color:#94a3b8">— facultatif</small></span><input class="input" type="text" inputmode="decimal" name="prixHT" value="${p?.prixHT?escapeHTML(formatDZD(p.prixHT).replace(/ DZD$/,'')):""}" placeholder="00 000,00" onfocus="this.value=this.value?String(parseDZD(this.value)).replace('.',','):''" onblur="this.value=this.value.trim()?formatDZD(parseDZD(this.value)).replace(/ DZD$/,''):''" style="margin-top:4px;width:100%;font-variant-numeric:tabular-nums"/></label>
      <label style="display:block;margin-bottom:16px"><span style="font-size:12px;font-weight:700;color:#334155">Description *</span><textarea class="input" name="description" rows="3" required style="margin-top:4px;width:100%" placeholder="Détails de la prestation, conditions, périmètre d'intervention...">${escapeHTML(p?.description||"")}</textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button class="btn btn-primary igs-custom-submit">${isEdit?"Enregistrer les modifications":"Créer la prestation"}</button>
      </div>
    </form>`);
}

async function confirmPrest(id){
  const fd=new FormData(document.querySelector(".modal-bg form"));
  if(!fd.get("designation")){toast("Désignation requise","error");return;}
  if(!String(fd.get("description")||"").trim()){toast("Description requise","error");return;}
  db.catalogue=db.catalogue||[];
  let p=id?db.catalogue.find(x=>x.id===id):null;
  const isEdit=!!p;
  const societe=fd.get("societe")||mySoc();
  const designation=String(fd.get("designation")||"").trim();
  const duplicate=db.catalogue.find(x=>x.id!==id&&String(x.societe||"")===String(societe||"")&&String(x.designation||"").trim().toLowerCase()===designation.toLowerCase());
  if(duplicate){toast("Cette prestation existe déjà ("+(duplicate.code||"code inconnu")+")","error");return;}
  if(!p){p={id:uid("ct"),createdAt:new Date().toISOString()};db.catalogue.push(p)}
  p.code=isEdit?(p.code||fd.get("code")||nextPrestCode()):nextPrestCode();
  p.societe=societe;
  p.designation=designation;
  p.categorie=fd.get("categorie")||"Gardiennage";
  p.unite=fd.get("unite")||"Agent / mois";
  p.prixHT=parseDZD(fd.get("prixHT"));
  p.description=String(fd.get("description")||"").trim();
  p.updatedAt=new Date().toISOString();
  try{await sgdiApi("/api/irongs/collections/catalogue",{method:"PUT",body:{data:db.catalogue},legacy:false});}catch(e){toast("Erreur de sauvegarde : "+(e.message||e),"error");return;}
  closeModal();toast(isEdit?"Prestation modifiée":"Prestation créée","success");renderView();
}

async function deletePrest(id){
  if(!confirm("Supprimer cette prestation ?"))return;
  db.catalogue=(db.catalogue||[]).filter(p=>p.id!==id);
  try{await sgdiApi("/api/irongs/collections/catalogue",{method:"PUT",body:{data:db.catalogue},legacy:false});}catch(e){toast("Erreur : "+(e.message||e),"error");return;}
  toast("Prestation supprimée","success");renderView();
}

function renderCommTarifs(view){
  const cat=bySoc(db.catalogue||[]);
  const byCat={};cat.forEach(p=>{const k=p.categorie||"—";if(!byCat[k])byCat[k]=[];byCat[k].push(p)});
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">💲 Tarification</h1><p class="text-slate-500 text-sm mb-4">${cat.length} prestations · Vue par catégorie</p>
    ${commTabs("tarifs")}
    ${Object.keys(byCat).length===0?`<div class="card p-10 text-center text-slate-500">Aucun tarif. Créez d'abord des prestations dans le catalogue.</div>`:Object.entries(byCat).map(([c,ps])=>{const moy=ps.reduce((s,p)=>s+(p.prixHT||0),0)/ps.length;const min=Math.min(...ps.map(p=>p.prixHT||0));const max=Math.max(...ps.map(p=>p.prixHT||0));return`<div class="card p-4 mb-4"><div class="flex items-center justify-between mb-3"><h3 class="font-bold text-lg">${escapeHTML(c)}</h3><div class="text-xs text-slate-500">${ps.length} tarifs · Min ${money(min)} · Max ${money(max)} · Moy ${money(moy)}</div></div><div class="overflow-hidden"><table><thead><tr><th>Code</th><th>Désignation</th><th>Unité</th><th>Prix HT</th></tr></thead><tbody>${ps.sort((a,b)=>(a.prixHT||0)-(b.prixHT||0)).map(p=>`<tr><td class="font-mono text-xs">${safe(p.code)}</td><td>${escapeHTML(p.designation||"")}</td><td class="text-xs">${safe(p.unite)}</td><td class="font-bold">${money(p.prixHT)}</td></tr>`).join("")}</tbody></table></div></div>`}).join("")}`;
}

function renderCommStats(view){
  const prospects=bySoc(db.prospects||[]);const clients=bySoc(db.clients||[]);const opps=bySoc(db.opportunites||[]);const visites=bySoc(db.visites||[]);
  const sources={};prospects.forEach(p=>{const k=p.source||"—";sources[k]=(sources[k]||0)+1});
  const structures={};clients.forEach(c=>{const k=c.structure||"—";structures[k]=(structures[k]||0)+1});
  const oppByEtape={};ETAPES_OPP.forEach(e=>oppByEtape[e]=opps.filter(o=>o.etape===e));
  const totalProsp=prospects.length||1;
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">📈 Statistiques commerciales</h1>
    ${commTabs("stats")}
    <div class="grid grid-2 gap-4 mb-4">
      <div class="card p-5"><h3 class="font-bold mb-3">Sources de prospects</h3>${Object.entries(sources).sort((a,b)=>b[1]-a[1]).map(([k,n])=>{const pct=Math.round(n/totalProsp*100);return`<div class="text-sm mb-2"><div class="flex justify-between mb-1"><span>${escapeHTML(k)}</span><span class="text-slate-500">${n} (${pct}%)</span></div><div class="h-2 bg-slate-100 rounded-full"><div class="h-full bg-blue-500 rounded-full" style="width:${pct}%"></div></div></div>`}).join("")||`<div class="text-sm text-slate-400">Aucune donnée.</div>`}</div>
      <div class="card p-5"><h3 class="font-bold mb-3">Clients par structure</h3>${Object.entries(structures).sort((a,b)=>b[1]-a[1]).map(([k,n])=>{const total=clients.length||1;const pct=Math.round(n/total*100);return`<div class="text-sm mb-2"><div class="flex justify-between mb-1"><span>${escapeHTML(k)}</span><span class="text-slate-500">${n} (${pct}%)</span></div><div class="h-2 bg-slate-100 rounded-full"><div class="h-full bg-emerald-500 rounded-full" style="width:${pct}%"></div></div></div>`}).join("")||`<div class="text-sm text-slate-400">Aucune donnée.</div>`}</div>
    </div>
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Funnel de conversion</h3><div class="grid grid-cols-6 gap-2">${ETAPES_OPP.map(e=>{const ps=oppByEtape[e];const t=ps.reduce((s,o)=>s+(o.montant||0),0);const tot=opps.length||1;const pct=Math.round(ps.length/tot*100);return`<div class="card p-3 bg-slate-50 text-center"><div class="text-xs uppercase text-slate-500 mb-1">${e}</div><div class="text-2xl font-bold ${e==="gagnee"?"text-emerald-600":e==="perdue"?"text-red-600":"text-amber-600"}">${ps.length}</div><div class="text-xs text-slate-500">${pct}%</div><div class="text-xs text-slate-500 mt-1">${money(t)}</div></div>`}).join("")}</div></div>
    <div class="card p-5"><h3 class="font-bold mb-3">Activité (visites/contacts)</h3><div class="text-3xl font-bold">${visites.length}</div><div class="text-xs text-slate-500">${visites.filter(v=>v.date>=today()).length} à venir · ${visites.filter(v=>v.date<today()).length} passées</div></div>`;
}

SGDIModules.registerModule({key: "commercial-1", routes: [], dependencies: [], init: function(){}, destroy: function(){}});

/* Chiffrage libre : coûts internes et colonnes du devis, sans modifier le moteur Agent. */
function devisCostNumber(value){
  const n=Number(String(value??0).replace(/[\s\u00a0\u202f]/g,"").replace(",","."));
  if(!Number.isFinite(n)||n<0)throw new Error("Saisissez des nombres positifs ou nuls.");
  return n;
}
function devisCostCalculate(sheet){
  const n=devisCostNumber,quantity=n(sheet.quantity);
  if(!quantity)throw new Error("La quantité vendue doit être supérieure à zéro.");
  const columns=sheet.columns||[];
  const direct=(sheet.rows||[]).reduce((sum,row)=>sum+(n(row.unitCost)+columns.filter(c=>c.type==="cost").reduce((v,c)=>v+n(row.values?.[c.id]),0))*n(row.quantity)*n(row.factor),0);
  const overhead=sheet.overheadMode==="amount"?n(sheet.overhead):direct*n(sheet.overhead)/100;
  const contingency=(direct+overhead)*n(sheet.contingency)/100;
  const cost=direct+overhead+contingency,rate=n(sheet.rate);
  if(sheet.priceMode==="margin"&&rate>=100)throw new Error("La marge sur vente doit être inférieure à 100 %.");
  const proposed=sheet.priceMode==="manual"?n(sheet.unitPrice)*quantity:sheet.priceMode==="margin"?cost/(1-rate/100):cost*(1+rate/100);
  const unitPrice=Math.round(proposed/quantity*100)/100;
  // Le devis facture un prix unitaire à deux décimales : le résultat utilise ce même prix.
  const revenue=unitPrice*quantity,profit=revenue-cost;
  const result={direct,overhead,contingency,cost,unitCost:cost/quantity,unitPrice,revenue,profit,margin:revenue?profit/revenue*100:0};
  if(!Object.values(result).every(Number.isFinite))throw new Error("Ces valeurs dépassent la capacité du calculateur.");
  return result;
}
function devisJSON(value,fallback){try{return JSON.parse(value||"")}catch{return fallback}}
function devisColumns(){return devisJSON(document.getElementById("dev-lignes-body")?.dataset.columns,[])}
function devisColumnsHead(columns,client=false){return columns.filter(c=>!client||c.visible).map(c=>`<th class="dev-custom-head" style="padding:8px;min-width:130px;color:${client?'#fff':'#64748b'}">${escapeHTML(c.label)}</th>`).join("")}
function devisColumnsCells(line,columns,client=false){return columns.filter(c=>!client||c.visible).map(c=>client?`<td style="padding:8px">${escapeHTML(line.customValues?.[c.id]||"")}</td>`:`<td class="dev-custom-cell" style="padding:4px;vertical-align:top"><input class="input" data-column="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.label)}" value="${escapeHTML(line.customValues?.[c.id]||"")}" oninput="sgdiFormHasUnsavedChanges=true"></td>`).join("")}
function devisLineExtra(tr){return {costSheet:devisJSON(tr.dataset.costSheet,null),customValues:Object.fromEntries([...tr.querySelectorAll('[data-column]')].map(el=>[el.dataset.column,el.value]))}}
function devisColumnsOpen(){
  openModal(`<form onsubmit="event.preventDefault();devisColumnsApply(this)"><h2>Colonnes du devis</h2><p>Informations complémentaires, sans effet sur les calculs. Cochez les colonnes à communiquer au client.</p><div id="dev-columns-list">${devisColumns().map(c=>devisColumnConfigHTML(c)).join("")}</div><button type="button" class="btn" onclick="document.getElementById('dev-columns-list').insertAdjacentHTML('beforeend',devisColumnConfigHTML({id:uid('col'),label:'',visible:false}))">+ Ajouter une colonne</button><p><button type="submit" class="btn btn-primary">Appliquer</button> <button type="button" class="btn" onclick="closeModal()">Annuler</button></p></form>`);
}
function devisColumnConfigHTML(c){return `<div class="dev-column-config" data-id="${escapeHTML(c.id)}" style="display:flex;gap:8px;margin:8px 0"><input class="input" name="label" aria-label="Nom de colonne" required value="${escapeHTML(c.label)}"><label><input type="checkbox" name="visible" ${c.visible?"checked":""}> Visible client</label><button type="button" class="btn" title="Monter" onclick="const row=this.parentElement;if(row.previousElementSibling)row.previousElementSibling.before(row)">↑</button><button type="button" class="btn" title="Descendre" onclick="const row=this.parentElement;if(row.nextElementSibling)row.nextElementSibling.after(row)">↓</button><button type="button" class="btn" onclick="this.parentElement.remove()">Supprimer</button></div>`}
function devisColumnsApply(form){
 const body=document.getElementById('dev-lignes-body');if(!body)return;
 const columns=[...form.querySelectorAll('.dev-column-config')].map(el=>({id:el.dataset.id,label:el.querySelector('[name=label]').value.trim(),visible:el.querySelector('[name=visible]').checked}));
 if(columns.some(c=>!c.label)){toast('Nommez chaque colonne','error');return}
 const header=body.closest('table').querySelector('thead tr');header.querySelectorAll('.dev-custom-head').forEach(el=>el.remove());header.lastElementChild.insertAdjacentHTML('beforebegin',devisColumnsHead(columns));
 body.querySelectorAll('.dev-ligne-row').forEach(tr=>{const line=devisLineExtra(tr);tr.querySelectorAll('.dev-custom-cell').forEach(el=>el.remove());tr.lastElementChild.insertAdjacentHTML('beforebegin',devisColumnsCells(line,columns))});
 body.dataset.columns=JSON.stringify(columns);sgdiFormHasUnsavedChanges=true;closeModal();
}
function devisCostDefault(tr){return {activity:'Activité libre',quantity:tr?tr.querySelectorAll('input[type=number]')[1]?.value||1:1,rows:[{label:'',quantity:1,unitCost:0,factor:1,values:{}}],columns:[],overheadMode:'percent',overhead:0,contingency:0,priceMode:'markup',rate:20,unitPrice:0,scenarios:[]}}
function devisCostOpen(button){
 const tr=button?.closest('.dev-ligne-row');
 if(!tr){devisEditorLigneAdd();return devisCostOpen(document.querySelector('#dev-lignes-body .dev-ligne-row:last-child button[data-cost]'))}
 const state={...(devisLineExtra(tr).costSheet||devisCostDefault(tr)),designation:tr.querySelector('.dev-ligne-designation').value,unit:tr.querySelector('.dev-ligne-unite').value,quantity:tr.querySelectorAll('input[type=number]')[1].value};
 devisCostRender(state,tr);
}
function devisCostRender(s,tr){
 const expanded=document.getElementById('dev-cost-form')?.querySelector('details')?.open||false;
 const field=(name,label,value,type='text')=>`<label>${label}<input class="input" name="${name}" type="${type}" value="${escapeHTML(String(value??''))}" ${type==='number'?'min="0" step="any"':''}></label>`;
 const select=(name,label,opts,value)=>`<label>${label}<select class="select" name="${name}">${opts.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
 openModal(`<form id="dev-cost-form" onsubmit="event.preventDefault();devisCostApply()" oninput="devisCostUpdate()" onchange="devisCostUpdate()" style="min-width:0"><h2>Fiche de coût de la prestation</h2><p>Calcul interne pour la quantité vendue ci-dessous. Tous les montants de coût sont hors TVA récupérable.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${field('designation','Désignation',s.designation??tr.querySelector('.dev-ligne-designation').value)}${field('activity','Activité',s.activity)}${field('quantity','Quantité vendue',s.quantity,'number')}${select('unit','Unité vendue',DEVIS_UNITES.map(u=>[u,u]),s.unit??tr.querySelector('.dev-ligne-unite').value)}</div><p>Coût de chaque poste = (coût unitaire + colonnes de coût) × quantité × durée / coefficient.</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;min-width:760px"><thead><tr><th>Poste de coût</th><th>Quantité</th><th>Coût unitaire HT</th><th>Durée / coefficient</th>${s.columns.map(c=>`<th><input aria-label="Nom de colonne" value="${escapeHTML(c.label)}" onchange="devisCostRenameColumn('${escapeHTML(c.id)}',this.value)">${c.type==='cost'?'Coût unitaire':''}<button type="button" title="Supprimer la colonne" onclick="devisCostRemoveColumn('${escapeHTML(c.id)}')">×</button></th>`).join('')}<th>Total</th><th>Actions</th></tr></thead><tbody id="dev-cost-rows">${s.rows.map(row=>devisCostRowHTML(row,s.columns)).join('')}</tbody></table></div><p><button class="btn" type="button" onclick="devisCostAddRow()">+ Poste de coût</button> <span style="display:inline-flex;gap:6px;flex-wrap:wrap"><input class="input" id="dev-cost-column-label" placeholder="Nom de colonne" aria-label="Nouvelle colonne"><select class="select" id="dev-cost-column-type" aria-label="Type de colonne"><option value="cost">Coût unitaire supplémentaire</option><option value="text">Information interne</option></select><button class="btn" type="button" onclick="devisCostAddColumn()">+ Colonne</button></span></p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${select('overheadMode','Frais indirects : base', [['percent','% des coûts directs'],['amount','Montant fixe DZD']],s.overheadMode)}${field('overhead','Frais indirects',s.overhead,'number')}${field('contingency','Imprévus (% coûts directs + indirects)',s.contingency,'number')}${select('priceMode','Construction du prix',[['markup','Majoration du coût (%)'],['margin','Marge sur vente (%)'],['manual','Prix unitaire HT libre']],s.priceMode)}${field('rate','Objectif (%)',s.rate,'number')}${field('unitPrice','Prix unitaire HT libre',s.unitPrice,'number')}</div><div id="dev-cost-result" aria-live="polite" style="padding:16px;background:#eef7f8;margin-top:12px;border-radius:10px"></div><p><input class="input" id="dev-cost-save-name" placeholder="Nom du scénario ou du modèle" aria-label="Nom du scénario ou du modèle"><button type="button" class="btn" onclick="devisCostSnapshot()">Conserver ce scénario</button> <button type="button" class="btn" onclick="devisCostTemplateSave()">Enregistrer comme modèle</button> <select class="select" id="dev-cost-template" aria-label="Modèle enregistré"><option value="">Choisir un modèle de la société</option>${devisCostTemplates().map(t=>`<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join('')}</select><button type="button" class="btn" onclick="devisCostTemplateLoad()">Charger un modèle</button></p><div id="dev-cost-scenarios">${(s.scenarios||[]).map((v,i)=>`<p>${escapeHTML(v.name)} — Coût ${formatDZD(v.cost)} · Vente HT ${formatDZD(v.revenue)} · Bénéfice ${formatDZD(v.profit)} <button type="button" onclick="devisCostRestore(${i})">Reprendre</button></p>`).join('')}</div><p id="dev-cost-message" role="status"></p><div class="dev-cost-actions" style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" type="button" onclick="closeModal()">Annuler</button><button class="btn btn-primary" type="submit">Appliquer à la ligne du devis</button></div></form>`);
 const form=document.getElementById('dev-cost-form');form._row=tr;form._sheet=s;
 const box=form.closest('.modal');if(box)box.style.maxWidth='1200px';
 devisCostSimpleLayout(form,s);
 if(expanded){form.querySelector('details').open=true;form.classList.add('cost-expanded')}
 devisCostUpdate();
}
function devisCostRowHTML(row,columns){
 const input=(name,value,type='number')=>`<input class="input" name="cost-row-${name}" type="${type}" value="${escapeHTML(String(value??''))}" ${type==='number'?'min="0" step="any"':''} style="min-width:85px" aria-label="${name}">`;
 return `<tr class="dev-cost-row"><td>${input('label',row.label,'text')}</td><td>${input('quantity',String(row.quantity??1)+(Number(row.factor??1)!==1?' × '+String(row.factor):'')+(row.quantityUnit?' '+row.quantityUnit:''),'text')}</td><td>${input('unitCost',devisCostMoney(row.unitCost),'text')}</td><td>${input('factor',row.factor)}</td>${columns.map(c=>`<td>${input(c.id,row.values?.[c.id]??(c.type==='cost'?0:''),c.type==='cost'?'number':'text')}</td>`).join('')}<td class="dev-cost-row-total" style="white-space:nowrap"></td><td style="white-space:nowrap"><button type="button" title="Monter" onclick="devisCostMove(this,-1)">↑</button><button type="button" title="Descendre" onclick="devisCostMove(this,1)">↓</button><button type="button" title="Supprimer" onclick="this.closest('tr').remove();devisCostUpdate()">×</button></td></tr>`;
}
function devisCostRead(){
 const f=document.getElementById('dev-cost-form'),s={...f._sheet};
 for(const key of ['designation','unit','activity','quantity','overheadMode','overhead','contingency','priceMode','rate','unitPrice'])s[key]=f.elements[key].value;
 s.rows=[...f.querySelectorAll('.dev-cost-row')].map(tr=>{const val=k=>tr.querySelector(`[name="cost-row-${k}"]`).value;const q=devisCostQuantity(val('quantity'));return {label:val('label'),quantity:q.quantity,quantityUnit:q.unit,unitCost:val('unitCost').replace(/DZD|DA/gi,'').trim(),factor:q.factor??val('factor'),values:Object.fromEntries(s.columns.map(c=>[c.id,val(c.id)]))}});return s;
}
function devisCostUpdate(){
 const f=document.getElementById('dev-cost-form');if(!f)return;
 const sale=document.getElementById('dev-cost-sale');if(sale?.validationMessage){document.getElementById('dev-cost-message').textContent=sale.validationMessage;return}
 try{const s=devisCostRead(),r=devisCostCalculate(s);
 const lineDiscount=Number(f._row.querySelectorAll('input[type=number]')[2]?.value)||0,globalDiscount=Number(document.getElementById('dev-remise')?.value)||0;
 const netRevenue=r.revenue*(1-lineDiscount/100)*(1-globalDiscount/100),netProfit=netRevenue-r.cost;
 f.elements.rate.disabled=s.priceMode==='manual';f.elements.unitPrice.disabled=s.priceMode!=='manual';
 f.querySelectorAll('.dev-cost-row').forEach((tr,i)=>{const row=devisCostCalculate({...s,rows:[s.rows[i]],overhead:0,contingency:0});tr.querySelector('.dev-cost-row-total').textContent=devisCostMoney(row.direct)});
 document.getElementById('dev-cost-result').innerHTML=`<div style="display:grid;grid-template-columns:1fr auto;gap:8px">${[['Coûts directs',r.direct],['Frais indirects',r.overhead],['Imprévus',r.contingency],['Coût de revient total',r.cost],['Coût par unité vendue',r.unitCost],['Prix unitaire HT proposé',r.unitPrice],['Vente totale HT avant remises',r.revenue],['Bénéfice avant remises et impôts',r.profit],['Vente HT après remises du devis',netRevenue],['Bénéfice après remises, avant impôts',netProfit]].map(([l,v])=>`<span>${l}</span><strong>${formatDZD(v)}</strong>`).join('')}<span>Marge sur vente HT</span><strong>${r.margin.toFixed(2)} %</strong></div>${netProfit<0?'<p style="color:#b91c1c">Attention : prix de vente inférieur au coût de revient.</p>':''}<small>Remises actuelles prises en compte : ligne ${lineDiscount} %, globale ${globalDiscount} %. TVA et TTC sont calculés par le devis après insertion.</small>`;
 devisCostSimpleUpdate(r,netRevenue,netProfit);
 }catch(e){document.getElementById('dev-cost-result').textContent=e.message;const error=document.getElementById('dev-cost-message');if(error)error.textContent=e.message}
}
function devisCostAddRow(){const f=document.getElementById('dev-cost-form');document.getElementById('dev-cost-rows').insertAdjacentHTML('beforeend',devisCostRowHTML({label:'',quantity:1,unitCost:0,factor:1},f._sheet.columns));devisCostSimpleRows(f);devisCostUpdate()}
function devisCostMove(button,direction){const tr=button.closest('tr'),other=direction<0?tr.previousElementSibling:tr.nextElementSibling;if(other)direction<0?other.before(tr):other.after(tr);devisCostUpdate()}
function devisCostAddColumn(){const label=document.getElementById('dev-cost-column-label').value.trim();if(!label){toast('Nommez la colonne','error');return}const f=document.getElementById('dev-cost-form'),s=devisCostRead();s.columns.push({id:uid('costcol'),label,type:document.getElementById('dev-cost-column-type').value});devisCostRender(s,f._row)}
function devisCostRemoveColumn(id){if(!confirm('Supprimer cette colonne et ses valeurs ?'))return;const f=document.getElementById('dev-cost-form'),s=devisCostRead();s.columns=s.columns.filter(c=>c.id!==id);devisCostRender(s,f._row)}
function devisCostApply(){
 const f=document.getElementById('dev-cost-form'),tr=f._row;
 if(document.getElementById('dev-cost-sale')?.validationMessage)return;
 try{const s=devisCostRead(),r=devisCostCalculate(s);if(!s.rows.length||s.rows.some(v=>!v.label.trim()))throw new Error('Nommez chaque poste de coût et conservez au moins un poste.');if(!f.elements.designation.value.trim())throw new Error('Renseignez la désignation de la prestation.');if(!tr.isConnected)throw new Error('La ligne du devis n’est plus ouverte.');
 tr.dataset.costSheet=JSON.stringify(s);tr.querySelector('.dev-ligne-designation').value=f.elements.designation.value.trim();tr.querySelector('.dev-ligne-unite').value=f.elements.unit.value;
 const nums=tr.querySelectorAll('input[type=number]');nums[0].value=r.unitPrice;nums[1].value=s.quantity;devisEditorCalcRow(tr);devisEditorCalcTotals();devisEditorAutoResize(tr.querySelector('.dev-ligne-designation'));sgdiFormHasUnsavedChanges=true;closeModal();toast('Chiffrage appliqué — enregistrez le devis pour le conserver','success');
 }catch(e){document.getElementById('dev-cost-message').textContent=e.message}
}
function devisCostSnapshot(){try{const f=document.getElementById('dev-cost-form'),s=devisCostRead(),r=devisCostCalculate(s),name=document.getElementById('dev-cost-save-name').value;if(!name?.trim()){toast('Nommez le scénario','error');return}const snapshot={...s,scenarios:[]};s.scenarios=[...(s.scenarios||[]),{name:name.trim(),...r,sheet:snapshot}];devisCostRender(s,f._row)}catch(e){toast(e.message,'error')}}
function devisCostRestore(index){const f=document.getElementById('dev-cost-form'),s=devisCostRead(),saved=s.scenarios[index];if(saved&&confirm('Remplacer le calcul courant par ce scénario ?'))devisCostRender({...saved.sheet,scenarios:s.scenarios},f._row)}
function devisCostTemplates(){const body=document.getElementById('dev-lignes-body'),local=devisJSON(body?.dataset.costTemplates,[]);return [...(db.devis||[]).filter(d=>d.societe===mySoc()).flatMap(d=>d.costTemplates||[]),...local].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i)}
function devisCostTemplateSave(){const f=document.getElementById('dev-cost-form'),s=devisCostRead(),name=document.getElementById('dev-cost-save-name').value;if(!name?.trim()){toast('Nommez le modèle','error');return}const body=document.getElementById('dev-lignes-body'),templates=devisJSON(body.dataset.costTemplates,[]);templates.push({id:uid('ct'),name:name.trim(),sheet:{...s,scenarios:[]}});body.dataset.costTemplates=JSON.stringify(templates);document.getElementById('dev-cost-template').insertAdjacentHTML('beforeend',`<option value="${escapeHTML(templates.at(-1).id)}">${escapeHTML(name.trim())}</option>`);sgdiFormHasUnsavedChanges=true;document.getElementById('dev-cost-message').textContent='Modèle ajouté. Enregistrez le devis pour le conserver.'}
function devisCostTemplateLoad(){const id=document.getElementById('dev-cost-template').value,template=devisCostTemplates().find(t=>t.id===id);if(template){const f=document.getElementById('dev-cost-form');if(confirm('Remplacer les postes courants par ce modèle ?'))devisCostRender(JSON.parse(JSON.stringify(template.sheet)),f._row)}else toast('Sélectionnez un modèle','info')}

function devisClientPrint(){
 const documentEl=document.getElementById('devis-client-document');if(!documentEl)return;
 const popup=window.open('','_blank');if(!popup){toast('Autorisez la fenêtre d’impression dans le navigateur','info');return}
 popup.document.open();popup.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Devis</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#172b4d;font-size:12px}table{width:100%;border-collapse:collapse}th,td{min-width:0!important;white-space:normal!important;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{div{overflow:visible!important}}</style></head><body>'+documentEl.innerHTML+'</body></html>');popup.document.close();popup.focus();popup.print();
}

function devisCostRenameColumn(id,label){const f=document.getElementById('dev-cost-form'),col=f?._sheet.columns.find(c=>c.id===id);if(col&&label.trim())col.label=label.trim()}

function devisCostSimpleRows(form){
 const headers=form.querySelectorAll('#dev-cost-rows')[0]?.closest('table').querySelectorAll('th');
 if(headers){headers.forEach((th,i)=>th.classList.toggle('cost-extra',i>=3&&i<headers.length-2));headers[0].textContent='Désignation';headers[2].textContent='Coût unitaire';headers[headers.length-1].textContent='';}
 form.querySelectorAll('.dev-cost-row').forEach(tr=>{
  [...tr.cells].forEach((td,i)=>td.classList.toggle('cost-extra',i>=3&&i<tr.cells.length-2));
  const buttons=tr.lastElementChild.querySelectorAll('button');buttons.forEach((b,i)=>b.classList.toggle('cost-extra',i<2));
  const qty=tr.querySelector('[name=cost-row-quantity]'),factor=tr.querySelector('[name=cost-row-factor]');
  qty.oninput=()=>{const parsed=devisCostQuantity(qty.value);factor.value=parsed.factor??1};
  factor.oninput=()=>{const parsed=devisCostQuantity(qty.value);qty.value=parsed.quantity+(Number(factor.value)!==1?' × '+factor.value:'')+(parsed.unit?' '+parsed.unit:'')};
  const del=buttons[buttons.length-1];del.setAttribute('aria-label','Supprimer ce coût');del.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>';
 });
}
function devisCostSimpleLayout(form,s){
 const title=form.querySelector('h2');title.textContent='Calculer mon coût';
 const close=document.createElement('button');close.type='button';close.className='cost-close';close.setAttribute('aria-label','Fermer');close.textContent='×';close.onclick=closeModal;title.before(close);
 const subtitle=form.querySelector('p');subtitle.className='cost-subtitle';subtitle.innerHTML=`<input class="cost-subtitle-input" aria-label="Désignation de la prestation" placeholder="Nom de la prestation" value="${escapeHTML(s.designation||form._row.querySelector('.dev-ligne-designation').value||'')}" oninput="this.form.elements.designation.value=this.value">`;
 const grids=[...form.querySelectorAll(':scope > div')];
 const identity=grids[0],tableWrap=document.getElementById('dev-cost-rows').closest('table').parentElement;
 tableWrap.className='cost-table-wrap';tableWrap.querySelector('table').style.minWidth='';
 const explanation=identity.nextElementSibling;
 const addPanel=tableWrap.nextElementSibling;
 const addButton=addPanel.querySelector('button');addButton.className='cost-add';addButton.innerHTML='<span aria-hidden="true">＋</span> Ajouter un coût';tableWrap.after(addButton);
 const details=document.createElement('details');details.className='cost-options';details.innerHTML='<summary><span class="cost-chevron" aria-hidden="true">›</span><span>Options avancées<small>Frais, marge et colonnes supplémentaires</small></span></summary><div class="cost-options-content"></div>';
 const content=details.lastElementChild;
 const result=document.getElementById('dev-cost-result');
 const advancedNodes=[identity,explanation,addPanel,grids.find(el=>el.querySelector('[name=overheadMode]')),result,document.getElementById('dev-cost-save-name').closest('p'),document.getElementById('dev-cost-scenarios')];
 advancedNodes.filter(Boolean).forEach(el=>content.appendChild(el));addButton.after(details);
 details.ontoggle=()=>form.classList.toggle('cost-expanded',details.open);
 const summary=document.createElement('div');summary.className='cost-summary';summary.innerHTML='<div class="cost-metric"><span>COÛT TOTAL</span><strong id="dev-cost-total">—</strong></div><div class="cost-metric"><label for="dev-cost-sale">PRIX DE VENTE HT</label><div class="cost-sale-wrap"><input id="dev-cost-sale" aria-label="Prix de vente HT total" inputmode="decimal" autocomplete="off" oninput="devisCostSetSale(this)" onblur="devisCostUpdate()"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 16-1 5 5-1L20 8l-4-4L4 16zm10-10 4 4"/></svg></div></div><div class="cost-metric cost-profit"><span>BÉNÉFICE ESTIMÉ</span><strong id="dev-cost-profit">—</strong><small id="dev-cost-margin"></small></div>';
 details.after(summary);
 const actions=form.querySelector('.dev-cost-actions');actions.querySelector('[type=submit]').textContent='Appliquer au devis';
 const note=document.createElement('span');note.className='cost-private-note';note.textContent='Les détails du coût restent internes.';actions.prepend(note);
 devisCostSimpleRows(form);
}
function devisCostSimpleUpdate(result,netRevenue,netProfit){
 const money=v=>v.toLocaleString('fr-FR',{minimumFractionDigits:Number.isInteger(v)?0:2,maximumFractionDigits:2}).replace(/\u202f/g,' ')+' DA';
 const form=document.getElementById('dev-cost-form');
 form.querySelectorAll('.dev-cost-row-total').forEach(el=>el.textContent=el.textContent.replace('DZD','DA'));
 document.getElementById('dev-cost-total').textContent=money(result.cost);
 const sale=document.getElementById('dev-cost-sale');if(document.activeElement!==sale)sale.value=money(result.revenue);
 const profit=document.getElementById('dev-cost-profit');profit.textContent=money(netProfit);profit.classList.toggle('is-loss',netProfit<0);
 document.getElementById('dev-cost-margin').textContent='Marge sur vente : '+(netRevenue?netProfit/netRevenue*100:0).toLocaleString('fr-FR',{maximumFractionDigits:2})+' %';
 document.getElementById('dev-cost-message').textContent='';
 const subtitle=form.querySelector('.cost-subtitle-input');if(document.activeElement!==subtitle)subtitle.value=form.elements.designation.value;
}
function devisCostSetSale(input){
 const form=document.getElementById('dev-cost-form');
 input.setCustomValidity('');
 try{const amount=devisCostNumber(input.value.replace(/DA|DZD/gi,'').trim()),quantity=devisCostNumber(form.elements.quantity.value);if(!quantity)throw new Error('Renseignez une quantité vendue supérieure à zéro dans les options.');
 form.elements.priceMode.value='manual';form.elements.unitPrice.disabled=false;form.elements.unitPrice.value=amount/quantity;
 devisCostUpdate();
 }catch(e){input.setCustomValidity(e.message);document.getElementById('dev-cost-message').textContent=e.message}
}

function devisCostQuantity(value){
 const expression=String(value).trim().match(/^(.+?)\s*[×*]\s*([+-]?\d+(?:[.,]\d+)?)\s*(.*)$/);
 if(expression)return {quantity:expression[1].trim(),factor:expression[2],unit:expression[3].trim()};
 const match=String(value).trim().match(/^([+-]?\d[\d\s\u202f]*(?:[.,]\d+)?)\s*([^\d\s,.].*)?$/);
 return match?{quantity:match[1].trim(),unit:(match[2]||'').trim()}:{quantity:value,unit:''};
}

function devisCostMoney(value){try{return devisCostNumber(value).toLocaleString('fr-FR',{maximumFractionDigits:2})+' DA'}catch{return String(value??'')}}
