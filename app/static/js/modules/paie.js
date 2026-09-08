/* Phase 2 — paie. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function paieAgentFonction(a){return normalizePosteValue(a?.fonction||a?.poste||a?.affectationCourante?.poste||a?.posteContrat||"Non précisé")}

function paieGrilleForAgent(a,ym){
  paieEnsure();
  const fn=paieAgentFonction(a),period=String(ym||sessionStorage.getItem("paieMois")||today().slice(0,7));
  const rows=(db.paieGrilles||[]).filter(g=>String(g.fonction||"").toLowerCase()===String(fn||"").toLowerCase()&&(!g.societe||!a?.societe||g.societe===a.societe)&&(!g.categorie||String(g.categorie)===String(a?.categoriePaie||""))&&(!g.echelon||String(g.echelon)===String(a?.echelonPaie||""))&&(!g.dateDebut||String(g.dateDebut).slice(0,7)<=period)&&(!g.dateFin||String(g.dateFin).slice(0,7)>=period));
  return rows.sort((x,y)=>Number(!!y.societe)-Number(!!x.societe)||Number(!!y.echelon)-Number(!!x.echelon)||String(y.dateDebut||"").localeCompare(String(x.dateDebut||"")))[0]||null;
}

function paieGrilleBounds(a,ym){
  const cfg=paieConfig();
  const g=paieGrilleForAgent(a,ym);
  return{fonction:paieAgentFonction(a),grille:g,min:Math.max(Number(cfg.snmg||0),Number(g?.min||0)||0),max:Number(g?.max||0)||0,reference:Number(g?.reference||0)||0};
}

function paieClosedInfo(ym,societe){
  paieEnsure();
  return (db.paieClotures||[]).find(c=>c.ym===ym&&(!societe||c.societe===societe||c.societe===""))||null;
}

function paieElementsFor(agentId,ym){
  paieEnsure();
  return (db.paieElements||[]).filter(e=>e.agentId===agentId&&e.ym===ym);
}

function paieBulletinFor(agentId,ym){
  paieEnsure();
  return (db.paieBulletins||[]).find(b=>b.agentId===agentId&&b.ym===ym)||null;
}

function paieBulletinDrift(a,ym){
  // Un bulletin clôturé est fige (calcul snapshot) : si la fiche de pointage de l'agent
  // est modifiee APRES la clôture, le bulletin ne reflete plus le pointage reel. On le
  // detecte en comparant la date de creation du bulletin a la derniere modification de
  // la fiche de pointage correspondante.
  const bulletin=paieBulletinFor(a.id,ym);
  if(!bulletin)return false;
  const sheet=ptGetSheet(a.id,ym);
  if(!sheet||!sheet.updatedAt||!bulletin.createdAt)return false;
  return new Date(sheet.updatedAt).getTime()>new Date(bulletin.createdAt).getTime();
}

function paieCalcForAgent(a,ym){
  const b=paieBulletinFor(a.id,ym);
  if(b&&b.calcul)return b.calcul;
  return calcPaieAgent(a,ym);
}

function paiePeriodBounds(ym){
  const clean=/^\d{4}-\d{2}$/.test(String(ym||""))?String(ym):today().slice(0,7);
  const [y,m]=clean.split("-").map(Number);const last=new Date(y,m,0).getDate();
  return{start:`${clean}-01`,end:`${clean}-${String(last).padStart(2,"0")}`,days:last};
}

function paieEmploymentRatio(a,ym){
  const p=paiePeriodBounds(ym);let start=String(a?.dateRecrutement||a?.dateEntree||p.start).slice(0,10);let end=String(a?.dateSortie||a?.departAt||p.end).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||start<p.start)start=p.start;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||end>p.end)end=p.end;
  if(start>p.end||end<p.start||end<start)return 0;
  return Math.max(0,Math.min(1,((new Date(end+"T12:00:00")-new Date(start+"T12:00:00"))/86400000+1)/p.days));
}

function calcPaieAgent(a,ym){
  const cfg=paieConfig();
  paieEnsure();
  const period=ym||sessionStorage.getItem("paieMois")||today().slice(0,7);
  const salaireNetContractuel=Number(a.salaireNet||0)||0;
  const brutBase=paieBaseBruteForAgent(a,period);
  const absenceInfo=paiePointageAbsenceInfo(a,period);const joursAbsencePaie=absenceInfo.days;
  const employmentRatio=paieEmploymentRatio(a,period);
  const baseProratisee=Math.round(brutBase*employmentRatio);
  const joursReference=Math.max(1,Number(cfg.joursOuvrablesMois)||22);
  const paidRatio=Math.max(0,employmentRatio-(joursAbsencePaie/joursReference));
  const primeNuit=a.affectationCourante?.horaire==="Nuit"?Math.round(Number(cfg.primeNuit||0)*paidRatio):0;
  const retenueJour=Number(cfg.retenueAbsenceJour||0)>0?Number(cfg.retenueAbsenceJour):baseProratisee/joursReference;
  const retenueAbsencePointage=Math.max(0,Math.min(baseProratisee,Math.round(joursAbsencePaie*retenueJour)));
  const fixedElements=[
    {code:"BASE",libelle:"Salaire de base proratisé",type:"gain",imposable:true,cotisable:true,montant:baseProratisee},
    {code:"PN",libelle:"Prime de nuit",type:"gain",imposable:true,cotisable:true,montant:primeNuit},
    {code:"PANIER",libelle:"Remboursement panier",type:"gain",imposable:false,cotisable:false,montant:Math.round(Number(cfg.primePanier||0)*paidRatio)},
    {code:"TRANS",libelle:"Remboursement transport",type:"gain",imposable:false,cotisable:false,montant:Math.round(Number(cfg.primeTransport||0)*paidRatio)},
    {code:"ABS",libelle:`Retenue absence pointage (${joursAbsencePaie} j)`,type:"retenue",imposable:true,cotisable:true,montant:retenueAbsencePointage,auto:true}
  ].filter(x=>Number(x.montant||0)>0);
  const variableElements=paieElementsFor(a.id,period).map(e=>{
    const r=(db.paieRubriques||[]).find(x=>x.id===e.rubriqueId)||{};
    return{code:r.code||"",libelle:r.libelle||"Rubrique",type:r.type||"gain",imposable:r.imposable!==false,cotisable:r.cotisable!==false,taxMode:r.taxMode||"mensuel",montant:Number(e.montant||0),note:e.note||""};
  }).filter(x=>x.montant>0);
  const elements=[...fixedElements,...variableElements];
  const gains=elements.filter(e=>e.type!=="retenue").reduce((s,e)=>s+e.montant,0);
  const primes=Math.max(0,gains-baseProratisee);
  const retenuesRubriques=elements.filter(e=>e.type==="retenue").reduce((s,e)=>s+e.montant,0);
  const gainsCotisables=elements.filter(e=>e.type!=="retenue"&&e.cotisable!==false).reduce((s,e)=>s+e.montant,0);
  const retenuesCotisables=elements.filter(e=>e.type==="retenue"&&e.cotisable!==false).reduce((s,e)=>s+e.montant,0);
  const gainsNonCotisablesImposables=elements.filter(e=>e.type!=="retenue"&&e.cotisable===false&&e.imposable!==false).reduce((s,e)=>s+e.montant,0);
  const gainsNonCotisablesNonImposables=elements.filter(e=>e.type!=="retenue"&&e.cotisable===false&&e.imposable===false).reduce((s,e)=>s+e.montant,0);
  const brutCotisable=Math.max(0,gainsCotisables-retenuesCotisables);
  const assietteCnasMinimum=Math.round(Number(cfg.snmg||0)*Math.min(employmentRatio,paidRatio));
  const assietteCnas=brutCotisable>0?Math.max(brutCotisable,assietteCnasMinimum):0;
  const cnasSalarie=Math.round(assietteCnas*(Number(cfg.tauxCnasSalarie||0)/100));
  const gainsSepares=elements.filter(e=>e.type!=="retenue"&&e.imposable!==false&&e.taxMode==="separe10").reduce((s,e)=>s+e.montant,0);
  const partCnasSeparee=assietteCnas>0?cnasSalarie*Math.min(1,gainsSepares/assietteCnas):0;
  const baseIRGSeparable=Math.max(0,gainsSepares-partCnasSeparee);
  const irgNonMensuel=Math.round(baseIRGSeparable*(Number(cfg.tauxIRGNonMensuel||10)/100));
  const netSocial=Math.max(0,brutCotisable-cnasSalarie+gainsNonCotisablesImposables);
  const baseIRG=Math.max(0,netSocial-baseIRGSeparable);
  const irgCalc=irgSalaireAlgerie(baseIRG,cfg,a);
  const abat=irgCalc.abattement;
  const irg=irgCalc.irg+irgNonMensuel;
  const retenuesPostNet=elements.filter(e=>e.type==="retenue"&&e.cotisable===false&&e.imposable===false).reduce((s,e)=>s+e.montant,0);
  const netAPayer=Math.max(0,netSocial-irg+gainsNonCotisablesNonImposables-retenuesPostNet);
  const cnasPatronal=Math.round(assietteCnas*(Number(cfg.tauxCnasPatronal||0)/100));
  const oeuvresSociales=Math.round(assietteCnas*(Number(cfg.tauxOeuvresSociales||0)/100));
  const remunerationBruteDue=Math.max(0,gains-retenuesCotisables);
  const coutEmployeur=remunerationBruteDue+cnasPatronal+oeuvresSociales;
  return{salaireNetContractuel,brutBase,baseProratisee,employmentRatio,pointageDisponible:absenceInfo.available,primeNuit,primes,gains,remunerationBruteDue,joursAbsencePaie,retenueAbsencePointage,absences:retenuesRubriques,retenuesRubriques,retenuesPostNet,elements,brutCotisable,assietteCnasMinimum,assietteCnas,cnasSalarie,netSocial,abat,baseIRG,baseIRGSeparable,irgNonMensuel,irgBrut:irgCalc.irgBrut,irgFormule:irgCalc.formule,irg,netAPayer,cnasPatronal,oeuvresSociales,coutEmployeur};
}

function paiePointageAbsenceInfo(a,ym){
  try{
    const sh=ptGetSheet(a?.id,ym);
    return{available:!!sh,days:sh&&typeof ptAbsencePayrollDays==="function"?ptAbsencePayrollDays(sh):0};
  }catch(e){console.error("PAIE: pointage absence indisponible",e);return{available:false,days:0,error:String(e?.message||e)}}
}

function paiePointageAbsenceDays(a,ym){return paiePointageAbsenceInfo(a,ym).days}

function paieNetFromBase(base,cfg){
  const brut=Math.max(0,Number(base)||0);
  const cnas=Math.round(brut*(Number(cfg.tauxCnasSalarie||0)/100));
  const netSocial=Math.max(0,brut-cnas);
  const irgCalc=irgSalaireAlgerie(netSocial,cfg);
  const cnasPatronal=Math.round(brut*(Number(cfg.tauxCnasPatronal||0)/100));
  const oeuvresSociales=Math.round(brut*(Number(cfg.tauxOeuvresSociales||0)/100));
  return{brutCotisable:brut,cnasSalarie:cnas,baseIRG:netSocial,irg:irgCalc.irg,netAPayer:Math.max(0,netSocial-irgCalc.irg),cnasPatronal,oeuvresSociales,coutEmployeur:brut+cnasPatronal+oeuvresSociales};
}

function paieBaseBruteForAgent(a,ym){
  const explicit=Number(a?.salaireBase||a?.paieBaseBrute||0)||0;
  if(explicit>0)return explicit;
  const netContractuel=Number(a?.salaireNet||0)||0;
  if(netContractuel>0)return paieOptimizeFromNet(netContractuel,a).base||0;
  const grid=paieGrilleForAgent(a,ym);
  return Number(grid?.reference||grid?.min||0)||0;
}

function paieOptimizeFromNet(targetNet,agent){
  const cfg=paieConfig();
  const target=Math.max(0,parseMoneyInput(targetNet)||0);
  const bounds=paieGrilleBounds(agent);
  const minBase=Math.max(0,Number(bounds.min||0));
  const maxBase=Math.max(0,Number(bounds.max||0));
  const panierMax=Math.max(0,Number(cfg.optimisationPanierMax||0));
  const transportMax=Math.max(0,Number(cfg.optimisationTransportMax||0));
  const maxNonTax=panierMax+transportMax;
  const minCalc=paieNetFromBase(minBase,cfg);
  let warning="";
  if(target<=minCalc.netAPayer){
    warning="Net cible inférieur ou égal au net minimal de la grille fonction. La base reste au minimum autorisé.";
    return{target,base:minBase,panier:0,transport:0,nonTaxable:0,warning,bounds,...paieNetFromBase(minBase,cfg)};
  }
  const nonTaxable=Math.min(maxNonTax,Math.max(0,target-minCalc.netAPayer));
  const taxableTarget=Math.max(0,target-nonTaxable);
  let lo=minBase,hi=Math.max(minBase*2,taxableTarget*2,1);
  while(paieNetFromBase(hi,cfg).netAPayer<taxableTarget&&hi<10000000)hi*=1.5;
  for(let i=0;i<48;i++){
    const mid=(lo+hi)/2;
    if(paieNetFromBase(mid,cfg).netAPayer<taxableTarget)lo=mid;else hi=mid;
  }
  const base=Math.round(hi);
  if(maxBase&&base>maxBase){
    const calcMax=paieNetFromBase(maxBase,cfg);
    const remaining=Math.max(0,target-calcMax.netAPayer);
    const nt=Math.min(maxNonTax,remaining);
    warning="Net cible supérieur au maximum de la grille fonction. La base est plafonnée au maximum autorisé.";
    return{target,base:maxBase,panier:Math.min(nt,panierMax),transport:Math.max(0,nt-Math.min(nt,panierMax)),nonTaxable:nt,warning,bounds,...calcMax,netAPayer:calcMax.netAPayer+nt,coutEmployeur:calcMax.coutEmployeur+nt};
  }
  const calc=paieNetFromBase(base,cfg);
  const panier=Math.min(nonTaxable,panierMax);
  const transport=Math.max(0,nonTaxable-panier);
  return{target,base,panier,transport,nonTaxable,warning,bounds,...calc,netAPayer:calc.netAPayer+nonTaxable,coutEmployeur:calc.coutEmployeur+nonTaxable};
}

function paieActiveSocieteScope(){
  const direct=(typeof mySoc==="function"&&mySoc())||"";
  const structure=(typeof currentStructureSocieteFilter==="function"&&currentStructureSocieteFilter())||"";
  return String(direct||structure||"").trim();
}

function setPaieFilter(k,v){
  if(k==="Societe"&&paieActiveSocieteScope()){
    sessionStorage.removeItem("paieSociete");
    renderView();
    return;
  }
  sessionStorage.setItem("paie"+k,v||"");
  renderView();
}

async function savePaieConfig(){
  if(typeof isAdmin==="function"&&!isAdmin()){toast("Modification des paramètres réglementaires réservée à l'administration système","error");return}
  const f=document.getElementById("paie-config-form");if(!f)return;
  const fd=new FormData(f);const cfg=paieConfig();
  ["snmg","heuresMois","joursOuvrablesMois","tauxCnasSalarie","tauxCnasPatronal","tauxOeuvresSociales","tauxIRGNonMensuel","majorationHeuresSup","abattementIRG","abattementMinMensuel","abattementMaxMensuel","primeNuit","primePanier","primeTransport","optimisationPanierMax","optimisationTransportMax","retenueAbsenceJour"].forEach(k=>cfg[k]=parseMoneyInput(fd.get(k))||0);
  if(cfg.snmg<=0||cfg.heuresMois<=0||cfg.joursOuvrablesMois<=0||cfg.tauxCnasSalarie<0||cfg.tauxCnasPatronal<0||cfg.majorationHeuresSup<50){toast("Paramètres réglementaires invalides (majoration HS minimale : 50 %)","error");return}
  if(!confirm(`Enregistrer le référentiel ${cfg.regulatoryVersion} ?\n\nCette modification influencera tous les bulletins non clôturés. Les mois déjà clôturés resteront figés.`))return;
  db.paieConfig=cfg;
  if(typeof logActivity==="function")logActivity("Modification paramètres paie",cfg.regulatoryVersion||"Référentiel DZ");
  if(!(await saveDBAndWaitToast("Paramètres paie non confirmés")))return;
  toast("Paramètres paie enregistrés","success");renderView();
}

function paieExportCSV(){
  const rows=[["Code","Employé","Société","Contrat","Brut cotisable","Assiette CNAS","CNAS salarié","Base IRG","IRG","Net à payer","CNAS patronal","Œuvres sociales","Coût employeur"]];
  document.querySelectorAll("#paie-tbody tr[data-paierow]").forEach(r=>rows.push(JSON.parse(r.dataset.csv)));
  paieDownloadCSV(rows,"paie-"+(sessionStorage.getItem("paieMois")||today().slice(0,7))+".csv");
}

function paieExportCNAS(){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const rows=[["Période","Matricule","Nom","Société","Brut cotisable","Taux salarié","Cotisation salarié","Taux employeur","Cotisation employeur","Taux œuvres sociales","Cotisation œuvres sociales","Total patronal"]];
  document.querySelectorAll("#paie-tbody tr[data-paierow]").forEach(r=>{
    const csv=JSON.parse(r.dataset.csv);rows.push([ym,csv[0],csv[1],csv[2],csv[5],paieConfig().tauxCnasSalarie,csv[6],paieConfig().tauxCnasPatronal,csv[10],paieConfig().tauxOeuvresSociales,csv[11],Number(csv[10]||0)+Number(csv[11]||0)]);
  });
  paieDownloadCSV(rows,"cnas-"+ym+".csv");
}

function paieExportIRG(){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const rows=[["Période","Matricule","Nom","Société","Base IRG","IRG retenu","Net à payer"]];
  document.querySelectorAll("#paie-tbody tr[data-paierow]").forEach(r=>{const csv=JSON.parse(r.dataset.csv);rows.push([ym,csv[0],csv[1],csv[2],csv[7],csv[8],csv[9]])});
  paieDownloadCSV(rows,"irg-"+ym+".csv");
}

function paieBulletinSnapshot(a,c,ym){
  return{id:uid("bp"),ym,agentId:a.id,matricule:a.matricule||"",agentName:((a.nom||"")+" "+(a.prenom||"")).trim(),societe:a.societe||"",poste:a.fonction||a.affectationCourante?.poste||"",typeContrat:cleanContractType(a.typeContrat),regulatoryVersion:paieConfig().regulatoryVersion,config:{...paieConfig()},calcul:JSON.parse(JSON.stringify(c)),createdAt:new Date().toISOString(),createdBy:session?.username||""};
}

function paieEligibleAgents(ym,soc){
  return(db.agents||[]).filter(a=>a.statut!=="archive"&&paieEmploymentRatio(a,ym)>0&&(!soc||a.societe===soc));
}

function paieValidationForAgents(agents,ym){
  const errors=[],warnings=[];
  agents.forEach(a=>{
    const who=`${a.matricule||"Sans code"} · ${((a.nom||"")+" "+(a.prenom||"")).trim()||"Employé"}`;const c=calcPaieAgent(a,ym);
    if(!a.matricule)errors.push(`${who} : matricule manquant`);
    if(!a.societe)errors.push(`${who} : société manquante`);
    if(!(Number(c.brutBase)>0))errors.push(`${who} : base salariale nulle`);
    if(!c.pointageDisponible)errors.push(`${who} : feuille de pointage ${ym} absente`);
    if(!Number.isFinite(c.netAPayer)||!Number.isFinite(c.cnasSalarie)||!Number.isFinite(c.irg))errors.push(`${who} : calcul invalide`);
    if(!a.numeroCnas&&!a.cnas)warnings.push(`${who} : numéro CNAS manquant`);
    if(!a.typeContrat)warnings.push(`${who} : type de contrat manquant`);
    if(c.assietteCnas>c.brutCotisable)warnings.push(`${who} : assiette CNAS relevée au minimum légal proratisé`);
  });
  return{errors,warnings};
}

async function paieCloseMonth(){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const soc=paieActiveSocieteScope()||sessionStorage.getItem("paieSociete")||"";
  if(!soc&&!paieActiveSocieteScope()){toast("Sélectionnez une société avant de clôturer la paie","error");return}
  if(paieIsClosed(ym,soc)){toast("Ce mois de paie est déjà clôturé","error");return}
  const agents=paieEligibleAgents(ym,soc);
  if(!agents.length){toast("Aucun employé à clôturer","error");return}
  const validation=paieValidationForAgents(agents,ym);
  if(validation.errors.length){alert(`CLÔTURE BLOQUÉE — ${validation.errors.length} erreur(s)\n\n${validation.errors.slice(0,20).join("\n")}${validation.errors.length>20?`\n… et ${validation.errors.length-20} autre(s)`:""}`);return}
  const warningText=validation.warnings.length?`\n\nAVERTISSEMENTS (${validation.warnings.length})\n${validation.warnings.slice(0,12).join("\n")}`:"";
  if(!confirm(`Clôturer la paie ${paieMonthLabel(ym)}${soc?" · "+soc:""} ?\n\nContrôles bloquants réussis pour ${agents.length} salarié(s).${warningText}\n\nLes bulletins seront figés et les éléments du mois ne seront plus modifiables.`))return;
  paieEnsure();
  const previousBulletins=[...(db.paieBulletins||[])],previousClotures=[...(db.paieClotures||[])];
  db.paieBulletins=(db.paieBulletins||[]).filter(b=>!(b.ym===ym&&(!soc||b.societe===soc)));
  agents.forEach(a=>db.paieBulletins.push(paieBulletinSnapshot(a,calcPaieAgent(a,ym),ym)));
  db.paieClotures.push({id:uid("clp"),ym,societe:soc,closedAt:new Date().toISOString(),closedBy:session?.username||"",validatedBy:session?.username||"",regulatoryVersion:paieConfig().regulatoryVersion,bulletins:agents.length,warnings:validation.warnings});
  if(!(await saveDBAndWaitToast("Clôture paie non confirmée"))){db.paieBulletins=previousBulletins;db.paieClotures=previousClotures;return}
  toast("Paie clôturée et bulletins historisés","success");renderView();
}

function paieFicheHTML(agentId,ym){
  const a=db.agents.find(x=>x.id===agentId);if(!a)return"";
  const period=ym||sessionStorage.getItem("paieMois")||today().slice(0,7);
  const bulletin=paieBulletinFor(agentId,period);
  const cfg=bulletin?.config||paieConfig();const c=bulletin?.calcul||calcPaieAgent(a,period);const mois=paieMonthLabel(period);
  const totalRetenues=(Number(c.cnasSalarie)||0)+(Number(c.irg)||0)+(Number(c.retenuesRubriques)||0);
  const totalGains=Number(c.gains||0)||((c.elements||[]).filter(e=>e.type!=="retenue").reduce((s,e)=>s+(Number(e.montant)||0),0));
  const ligne=(lib,base,taux,gain,retenue)=>`<tr><td>${escapeHTML(lib)}</td><td class="r">${base}</td><td class="r">${taux}</td><td class="r">${gain}</td><td class="r">${retenue}</td></tr>`;
  return`<div class="bulletin-paie">

    <div class="bp-head">
      <div><div class="bp-title">Fiche de paie</div><div class="bp-sub">Période : ${escapeHTML(mois)} · SGDI${bulletin?" · Bulletin clôturé":""}</div></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:900">${escapeHTML(a.societe||"")}</div><div class="bp-sub">Établie le ${formatDate(today())}</div></div>
    </div>
    <div class="bp-grid">
      <div class="bp-box"><h3>Employeur</h3>
        <div class="bp-line"><span>Société</span><b>${escapeHTML(a.societe||"—")}</b></div>
        <div class="bp-line"><span>Site</span><b>${escapeHTML(a.affectationCourante?.siteName||"—")}</b></div>
        <div class="bp-line"><span>Poste</span><b>${escapeHTML(a.fonction||a.affectationCourante?.poste||"—")}</b></div>
      </div>
      <div class="bp-box"><h3>Salarié</h3>
        <div class="bp-line"><span>Nom et prénom</span><b>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</b></div>
        <div class="bp-line"><span>Matricule</span><b>${escapeHTML(a.matricule||"—")}</b></div>
        <div class="bp-line"><span>N° CNAS</span><b>${escapeHTML(a.numeroCnas||a.cnas||"—")}</b></div>
        <div class="bp-line"><span>Contrat</span><b>${escapeHTML(cleanContractType(a.typeContrat)||"—")}</b></div>
        <div class="bp-line"><span>Date recrutement</span><b>${formatDate(a.dateRecrutement)}</b></div>
        <div class="bp-line"><span>Catégorie / échelon</span><b>${escapeHTML([a.categoriePaie,a.echelonPaie].filter(Boolean).join(" / ")||"—")}</b></div>
      </div>
    </div>
    <table>
      <thead><tr><th>Rubrique</th><th class="r">Base</th><th class="r">Taux</th><th class="r">Gains</th><th class="r">Retenues</th></tr></thead>
      <tbody>
        ${(c.elements||[]).filter(e=>e.type!=="retenue").map(e=>ligne(e.libelle||e.code||"Gain",money(e.montant),e.cotisable===false?"Non cot.":"",money(e.montant),"")).join("")||ligne("Salaire de base",money(c.brutBase),"",money(c.brutBase),"")}
        ${(c.elements||[]).filter(e=>e.type==="retenue").map(e=>ligne(e.libelle||e.code||"Retenue",money(e.montant),e.cotisable?"Cot.":"", "",money(e.montant))).join("")}
        ${ligne("Brut cotisable",money(c.brutCotisable),"","<b>"+money(c.brutCotisable)+"</b>","")}
        ${ligne("Assiette CNAS",money(c.assietteCnas||c.brutCotisable),"","<b>"+money(c.assietteCnas||c.brutCotisable)+"</b>","")}
        ${ligne("CNAS salarié",money(c.assietteCnas||c.brutCotisable),qty(cfg.tauxCnasSalarie)+" %","",money(c.cnasSalarie))}
        ${ligne("Net social",money(c.netSocial),"","<b>"+money(c.netSocial)+"</b>","")}
        ${ligne("Base IRG / net imposable",money(c.baseIRG),"","<b>"+money(c.baseIRG)+"</b>","")}
        ${ligne("IRG brut",money(c.baseIRG),"Barème","","<span class=\"bp-muted\">"+money(c.irgBrut)+"</span>")}
        ${ligne("Abattement IRG",money(c.irgBrut),qty(cfg.abattementIRG)+" %","<span class=\"bp-muted\">"+money(c.abat)+"</span>","")}
        ${ligne("IRG retenu",money(c.baseIRG),escapeHTML(c.irgFormule||"Barème"),"",money(c.irg))}
        ${c.irgNonMensuel?ligne("Dont IRG primes/rappels",money(c.baseIRGSeparable),qty(cfg.tauxIRGNonMensuel||10)+" %","",money(c.irgNonMensuel)):""}
      </tbody>
      <tfoot>
        <tr><th colspan="3" class="r">Totaux</th><th class="r">${money(totalGains)}</th><th class="r">${money(totalRetenues)}</th></tr>
      </tfoot>
    </table>
    <div class="bp-grid" style="margin-top:12px">
      <div class="bp-box"><h3>Charges patronales</h3>
        <div class="bp-line"><span>Base proratisée</span><b>${money(c.baseProratisee||c.brutBase)}</b></div>
        <div class="bp-line"><span>Absences pointage</span><b>${qty(c.joursAbsencePaie||0)} jour(s)</b></div>
        <div class="bp-line"><span>CNAS patronal</span><b>${money(c.cnasPatronal)}</b></div>
        <div class="bp-line"><span>Œuvres sociales</span><b>${money(c.oeuvresSociales)}</b></div>
        <div class="bp-line"><span>Coût employeur</span><b>${money(c.coutEmployeur)}</b></div>
      </div>
      <div class="bp-net"><div class="label">Net à payer</div><div class="value">${money(c.netAPayer)}</div></div>
    </div>
    <div class="bp-sign"><div>Signature employeur<br><br>________________________</div><div>Signature salarié<br><br>________________________</div></div>
  </div>`;
}

function previewPaieFiche(agentId){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const html=paieFicheHTML(agentId,ym);
  openModal(`<div style="max-height:82vh;overflow:auto;background:#fff">${html}</div><div class="no-print flex justify-end gap-2 mt-3"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button><button class="btn btn-primary" onclick="printPaieFiche('${agentId}')">Imprimer</button></div>`);
}

function printPaieFiche(agentId){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const a=db.agents.find(x=>x.id===agentId);
  const w=window.open("","_blank","width=900,height=700");
  w.document.write(`<html><head><title>Fiche paie ${a?escapeHTML(a.matricule):""}</title></head><body>${paieFicheHTML(agentId,ym)}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

function paieFindAgent(ref){
  const key=String(ref||"");
  return (db.agents||[]).find(a=>String(a.id||"")===key||String(a.backendId||"")===key||String(a.matricule||"")===key)||null;
}

function paieAgentElementsTableHTML(agentId,ym){
  const rubs=new Map((db.paieRubriques||[]).map(r=>[r.id,r]));
  const rows=paieElementsFor(agentId,ym);
  if(!rows.length)return `<div class="p-6 text-center text-slate-500">Aucun élément variable enregistré pour ce mois.</div>`;
  return `<table><thead><tr><th>Rubrique</th><th>Type</th><th class="text-right">Montant</th><th>Note</th></tr></thead><tbody>${rows.map(e=>{const r=rubs.get(e.rubriqueId)||{};return`<tr><td><div class="font-bold">${escapeHTML(r.code||"—")}</div><div class="text-xs text-slate-500">${escapeHTML(r.libelle||"Rubrique supprimée")}</div></td><td><span class="pill ${r.type==="retenue"?"pill-red":"pill-green"}">${escapeHTML(r.type||"gain")}</span></td><td class="text-right font-black">${money(e.montant||0)}</td><td class="text-xs">${escapeHTML(e.note||"—")}</td></tr>`}).join("")}</tbody></table>`;
}

async function savePaieAgentSalary(agentId){
  const a=paieFindAgent(agentId);if(!a){toast("Employé introuvable","error");return}
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  if(paieIsClosed(ym,a.societe)){toast("Mois clôturé : dossier salaire non modifiable","error");return}
  const f=document.getElementById("paie-agent-salary-form");if(!f)return;
  const fd=new FormData(f);
  a.salaireNet=parseMoneyInput(fd.get("salaireNet"))||0;
  a.salaireBase=parseMoneyInput(fd.get("salaireBase"))||0;
  a.paieBaseBrute=a.salaireBase;
  a.typeContrat=cleanContractType(fd.get("typeContrat"))||a.typeContrat||"";
  a.categoriePaie=String(fd.get("categoriePaie")||"").trim();
  a.echelonPaie=String(fd.get("echelonPaie")||"").trim();
  a.paieMode=String(fd.get("paieMode")||"Mensuel").trim();
  a.paieObservation=String(fd.get("paieObservation")||"").trim();
  a.updatedAt=today();
  try{if(a.backendId)Object.assign(a,employeeFromApi(await SGDI.employees.update(a.backendId,employeeApiPayload(a))),a,{backendId:a.backendId})}
  catch(e){toast("Dossier salaire non enregistré : "+(e.message||e),"error");return}
  if(!(await saveDBAndWaitToast("Dossier salaire non confirmé")))return;
  toast("Dossier salaire enregistré","success");
  renderView();
}

function renderPaieAgent(view,agentId){
  paieEnsure();
  const a=paieFindAgent(agentId);
  if(!a){view.innerHTML=`<div class="card p-8 text-center text-red-700 font-bold">Employé introuvable.</div>`;return}
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const c=paieCalcForAgent(a,ym);
  const aff=agentLiveAffectation(a)||{};
  const bounds=paieGrilleBounds(a,ym);
  const closed=paieIsClosed(ym,a.societe);
  const agentLabel=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim()||"Employé");
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
    <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Paie / dossier salaire</div><h1 class="text-3xl font-black">${agentLabel}</h1><p class="text-sm text-slate-500">${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.societe||"—")} · ${escapeHTML(paieMonthLabel(ym))}${closed?` · <span class="pill pill-green">Mois clôturé</span>`:""}</p></div>
    <div class="flex gap-2 flex-wrap"><button class="btn btn-secondary" onclick="navigate('paie/dashboard')">Retour paie</button><button class="btn btn-secondary" onclick="openPaieElementsModal('${jsString(a.id)}')">Éléments du mois</button><button class="btn btn-secondary" onclick="previewPaieFiche('${jsString(a.id)}')">Voir fiche de paie</button><button class="btn btn-primary" onclick="printPaieFiche('${jsString(a.id)}')">Imprimer</button></div>
  </div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Base brute</div><div class="text-2xl font-black">${money(c.brutBase)}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Brut cotisable</div><div class="text-2xl font-black">${money(c.brutCotisable)}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">IRG + CNAS</div><div class="text-2xl font-black text-red-700">${money((c.irg||0)+(c.cnasSalarie||0))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Net à payer</div><div class="text-2xl font-black text-emerald-700">${money(c.netAPayer)}</div></div>
  </div>
  <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
    <form id="paie-agent-salary-form" class="card p-4 xl:col-span-2">
      <div class="flex items-center justify-between gap-2 mb-3"><h2 class="font-black text-lg">Paramètres fixes du dossier salaire</h2><span class="pill pill-blue">${escapeHTML(a.paieMode||"Mensuel")}</span></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="label">Salaire net contractuel</label><input class="input" name="salaireNet" value="${formatMoneyInputValue(a.salaireNet||0)}" onblur="formatMoneyField(this)" ${closed?"readonly":""}/></div>
        <div><label class="label">Base brute paie</label><input class="input" name="salaireBase" value="${formatMoneyInputValue(paieBaseBruteForAgent(a)||0)}" onblur="formatMoneyField(this)" ${closed?"readonly":""}/></div>
        <div><label class="label">Contrat</label><select class="select" name="typeContrat" ${closed?"disabled":""}>${TYPES_CONTRAT.map(t=>`<option ${cleanContractType(a.typeContrat)===t?"selected":""}>${escapeHTML(t)}</option>`).join("")}</select></div>
        <div><label class="label">Mode de paie</label><select class="select" name="paieMode" ${closed?"disabled":""}>${["Mensuel","Horaire","Journalier"].map(m=>`<option ${String(a.paieMode||"Mensuel")===m?"selected":""}>${m}</option>`).join("")}</select></div>
        <div><label class="label">Catégorie salariale</label><input class="input" name="categoriePaie" value="${escapeHTML(a.categoriePaie||"")}" ${closed?"readonly":""}/></div>
        <div><label class="label">Échelon</label><input class="input" name="echelonPaie" value="${escapeHTML(a.echelonPaie||"")}" ${closed?"readonly":""}/></div>
        <div><label class="label">Poste</label><div class="input bg-slate-50">${escapeHTML(paieAgentFonction(a)||"—")}</div></div>
        <div><label class="label">Site actuel</label><div class="input bg-slate-50">${escapeHTML(aff.siteName||"—")}</div></div>
        <div><label class="label">Grille fonction</label><div class="input bg-slate-50">${bounds?`${escapeHTML(bounds.fonction)} · ${money(bounds.min)}${bounds.max?" / "+money(bounds.max):""}`:"SNMG"}</div></div>
        <div><label class="label">SNMG</label><div class="input bg-slate-50">${money(paieConfig().snmg)}</div></div>
        <div class="md:col-span-2"><label class="label">Observation paie</label><textarea class="input" name="paieObservation" rows="3" ${closed?"readonly":""}>${escapeHTML(a.paieObservation||"")}</textarea></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="navigate('effectif/agent/${employeeRouteId(a)}')">Fiche de position</button><button type="button" class="btn btn-primary" onclick="savePaieAgentSalary('${jsString(a.id)}')" ${closed?"disabled":""}>Enregistrer dossier salaire</button></div>
    </form>
    <div class="card p-4">
      <h2 class="font-black text-lg mb-3">Résumé calcul</h2>
      ${[["Jours abs. pointage",qty(c.joursAbsencePaie||0)],["Retenue absence",money(c.retenueAbsencePointage||0)],["Primes",money(c.primes)],["CNAS salarié",money(c.cnasSalarie)],["Base IRG",money(c.baseIRG)],["IRG",money(c.irg)],["CNAS patronal",money(c.cnasPatronal)],["Coût employeur",money(c.coutEmployeur)]].map(([k,v])=>`<div class="flex justify-between py-2 border-b border-slate-100 text-sm"><span class="text-slate-500">${escapeHTML(k)}</span><b>${v}</b></div>`).join("")}
    </div>
  </div>
  <div class="card overflow-hidden mt-4"><div class="p-4 flex items-center justify-between gap-2"><div><h2 class="font-black">Éléments variables du mois</h2><div class="text-xs text-slate-500">Primes, retenues, rappels, panier, transport.</div></div><button class="btn btn-secondary text-xs" onclick="openPaieElementsModal('${jsString(a.id)}')" ${closed?"disabled":""}>Modifier éléments</button></div>${paieAgentElementsTableHTML(a.id,ym)}</div>`;
}

function paieRubriquesHTML(){
  paieEnsure();
  return `<div class="overflow-x-auto"><table><thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Cotisable</th><th>Imposable</th><th>Traitement IRG</th><th>Référence</th><th>Actif</th><th></th></tr></thead><tbody>${(db.paieRubriques||[]).map(r=>`<tr><td class="font-mono text-xs">${escapeHTML(r.code||"")}</td><td>${escapeHTML(r.libelle||"")}</td><td><span class="pill ${r.type==="retenue"?"pill-red":"pill-green"}">${escapeHTML(r.type||"gain")}</span></td><td>${r.cotisable!==false?"Oui":"Non"}</td><td>${r.imposable!==false?"Oui":"Non"}</td><td>${r.taxMode==="separe10"?"Retenue séparée 10 %":"Barème mensuel"}</td><td class="text-xs">${escapeHTML(r.referenceLegale||"—")}</td><td>${r.actif!==false?"Oui":"Non"}</td><td>${r.system?`<span class="text-xs text-slate-400">Système</span>`:`<button type="button" class="btn btn-ghost text-xs text-red-600" onclick="paieDeleteRubrique('${r.id}')">Supprimer</button>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function paieGrillesHTML(){
  paieEnsure();
  return `<div class="overflow-x-auto"><table><thead><tr><th>Fonction</th><th>Société</th><th>Catégorie</th><th>Échelon</th><th>Applicable</th><th>Min base</th><th>Référence</th><th>Max base</th><th></th></tr></thead><tbody>${(db.paieGrilles||[]).slice().sort((a,b)=>String(a.fonction||"").localeCompare(String(b.fonction||""),"fr")||String(a.categorie||"").localeCompare(String(b.categorie||""),"fr")||String(a.echelon||"").localeCompare(String(b.echelon||""),"fr")).map(g=>`<tr><td class="font-bold">${escapeHTML(g.fonction||"")}</td><td>${escapeHTML(g.societe||"Toutes")}</td><td>${escapeHTML(g.categorie||"Toutes")}</td><td>${escapeHTML(g.echelon||"Tous")}</td><td class="text-xs">${g.dateDebut?formatDate(g.dateDebut):"Sans début"} → ${g.dateFin?formatDate(g.dateFin):"Sans fin"}</td><td>${money(g.min||0)}</td><td class="font-bold">${money(g.reference||g.min||0)}</td><td>${g.max?money(g.max):"—"}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="paieDeleteGrille('${g.id}')">Supprimer</button></td></tr>`).join("")||`<tr><td colspan="9" class="text-center text-slate-500 p-4">Aucune grille. Le système utilise le SNMG comme minimum.</td></tr>`}</tbody></table></div>`;
}

function openPaieGrilleModal(){
  const fonctions=[...new Set([...POSTES,...(db.agents||[]).map(paieAgentFonction).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,"fr"));
  openModal(`<h3 class="font-bold text-lg mb-3">Nouvelle grille salariale par fonction</h3><form onsubmit="event.preventDefault();paieSaveGrille(this)">
    <div class="grid grid-2 gap-3">
      <div><label class="label">Fonction / poste</label><input class="input" name="fonction" list="paie-fonctions-list" required placeholder="Agent de sécurité"/><datalist id="paie-fonctions-list">${fonctions.map(f=>`<option value="${escapeHTML(f)}"></option>`).join("")}</datalist></div>
      <div><label class="label">Société</label><select class="select" name="societe"><option value="">Toutes sociétés</option>${SOCIETES.map(s=>`<option>${escapeHTML(s)}</option>`).join("")}</select></div>
      <div><label class="label">Catégorie</label><input class="input" name="categorie" placeholder="Ex : Exécution, Maîtrise, Cadre"/></div>
      <div><label class="label">Échelon</label><input class="input" name="echelon" placeholder="Ex : 01, 02, A, B"/></div>
      <div><label class="label">Applicable du</label><input class="input" type="date" name="dateDebut" required value="${today()}"/></div>
      <div><label class="label">Applicable au</label><input class="input" type="date" name="dateFin"/></div>
      <div><label class="label">Salaire base minimum</label><input class="input" name="min" required onblur="formatMoneyField(this)" placeholder="Ex : 35 000,00"/></div>
      <div><label class="label">Salaire base référence</label><input class="input" name="reference" onblur="formatMoneyField(this)" placeholder="Ex : 45 000,00"/></div>
      <div><label class="label">Salaire base maximum</label><input class="input" name="max" onblur="formatMoneyField(this)" placeholder="Ex : 70 000,00"/></div>
    </div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
  </form>`);
}

async function paieSaveGrille(form){
  paieEnsure();
  const fd=new FormData(form);const fonction=normalizePosteValue(String(fd.get("fonction")||"").trim());
  if(!fonction){toast("Fonction obligatoire","error");return}
  const societe=String(fd.get("societe")||"").trim(),categorie=String(fd.get("categorie")||"").trim(),echelon=String(fd.get("echelon")||"").trim();
  const dateDebut=String(fd.get("dateDebut")||""),dateFin=String(fd.get("dateFin")||"");const min=parseMoneyInput(fd.get("min"))||0,reference=parseMoneyInput(fd.get("reference"))||min,max=parseMoneyInput(fd.get("max"))||0;
  if(dateFin&&dateFin<dateDebut){toast("La date de fin précède la date de début","error");return}
  if(min<Number(paieConfig().snmg||0)||reference<min||(max>0&&(reference>max||min>max))){toast("Montants invalides : minimum ≥ SNMG et min ≤ référence ≤ max","error");return}
  const overlaps=(db.paieGrilles||[]).some(g=>String(g.fonction||"").toLowerCase()===fonction.toLowerCase()&&String(g.societe||"")===societe&&String(g.categorie||"")===categorie&&String(g.echelon||"")===echelon&&(!dateFin||!g.dateDebut||g.dateDebut<=dateFin)&&(!g.dateFin||g.dateFin>=dateDebut));
  if(overlaps){toast("Une ligne identique de la grille couvre déjà cette période","error");return}
  db.paieGrilles.push({id:uid("pg"),fonction,societe,categorie,echelon,dateDebut,dateFin,min,reference,max,createdAt:new Date().toISOString(),createdBy:session?.username||""});
  if(!(await saveDBAndWaitToast("Grille salariale non confirmée")))return;
  closeModal();toast("Grille salariale enregistrée","success");renderView();
}

async function paieDeleteGrille(id){
  if(!confirm("Supprimer cette grille salariale ?"))return;
  db.paieGrilles=(db.paieGrilles||[]).filter(g=>g.id!==id);
  if(!(await saveDBAndWaitToast("Suppression grille non confirmée")))return;
  renderView();
}

function openPaieRubriqueModal(){
  openModal(`<h3 class="font-bold text-lg mb-3">Nouvelle rubrique de paie</h3><form onsubmit="event.preventDefault();paieSaveRubrique(this)">
    <div class="grid grid-2 gap-3">
      <div><label class="label">Code</label><input class="input" name="code" required placeholder="EX : PRIME_SITE"/></div>
      <div><label class="label">Libellé</label><input class="input" name="libelle" required placeholder="Prime de site"/></div>
      <div><label class="label">Type</label><select class="select" name="type"><option value="gain">Gain</option><option value="retenue">Retenue</option></select></div>
      <div><label class="label">Traitement IRG</label><select class="select" name="taxMode"><option value="mensuel">Barème mensuel</option><option value="separe10">Retenue séparée 10 %</option></select></div>
      <div class="col-span-2"><label class="label">Référence légale / justification</label><input class="input" name="referenceLegale" placeholder="Obligatoire si exonérée de CNAS ou d'IRG"/></div>
      <label class="flex items-center gap-2 mt-6"><input type="checkbox" name="cotisable" checked/> Cotisable CNAS</label>
      <label class="flex items-center gap-2"><input type="checkbox" name="imposable" checked/> Imposable IRG</label>
      <label class="flex items-center gap-2"><input type="checkbox" name="actif" checked/> Active</label>
    </div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
  </form>`);
}

async function paieSaveRubrique(form){
  paieEnsure();
  const fd=new FormData(form);const code=String(fd.get("code")||"").trim().toUpperCase();const libelle=String(fd.get("libelle")||"").trim();
  if(!code||!libelle){toast("Code et libellé obligatoires","error");return}
  if((db.paieRubriques||[]).some(r=>String(r.code||"").toUpperCase()===code)){toast("Code rubrique déjà existant","error");return}
  const cotisable=fd.get("cotisable")==="on",imposable=fd.get("imposable")==="on",referenceLegale=String(fd.get("referenceLegale")||"").trim();
  if((!cotisable||!imposable)&&!referenceLegale){toast("Une exonération CNAS ou IRG exige une référence légale / justification","error");return}
  db.paieRubriques.push({id:uid("rub"),code,libelle,type:fd.get("type")||"gain",cotisable,imposable,taxMode:fd.get("taxMode")||"mensuel",referenceLegale,actif:fd.get("actif")==="on",system:false});
  if(!(await saveDBAndWaitToast("Rubrique paie non confirmée")))return;
  closeModal();toast("Rubrique ajoutée","success");renderView();
}

async function paieDeleteRubrique(id){
  if(!confirm("Supprimer cette rubrique ?"))return;
  db.paieRubriques=(db.paieRubriques||[]).filter(r=>r.id!==id);
  db.paieElements=(db.paieElements||[]).filter(e=>e.rubriqueId!==id);
  if(!(await saveDBAndWaitToast("Suppression rubrique non confirmée")))return;
  renderView();
}

function openPaieElementsModal(agentId){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  if(paieIsClosed(ym)){toast("Mois clôturé : éléments non modifiables","error");return}
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const rubs=(db.paieRubriques||[]).filter(r=>!r.system&&r.actif!==false);
  const existing=paieElementsFor(agentId,ym);
  openModal(`<h3 class="font-bold text-lg mb-3">Éléments de paie - ${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</h3>
    <div class="text-xs text-slate-500 mb-3">${paieMonthLabel(ym)} · primes, retenues, avances et rappels variables.</div>
    <form onsubmit="event.preventDefault();paieSaveElements('${agentId}',this)">
      <div id="paie-elements-body">${existing.map(paieElementRowHTML).join("")||paieElementRowHTML()}</div>
      <button type="button" class="btn btn-secondary text-xs mt-2" onclick="document.getElementById('paie-elements-body').insertAdjacentHTML('beforeend',paieElementRowHTML())">Ajouter ligne</button>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
    </form>`);
  window.paieElementRowHTML=()=>paieElementRowHTML();
  function paieElementRowHTML(e){
    return `<div class="grid grid-6 gap-2 mb-2 paie-el-row"><div class="col-span-2"><select class="select" name="rubriqueId"><option value="">— Rubrique —</option>${rubs.map(r=>`<option value="${r.id}" ${e?.rubriqueId===r.id?"selected":""}>${escapeHTML(r.code+" · "+r.libelle)}</option>`).join("")}</select></div><div><input class="input" name="montant" value="${formatMoneyInputValue(e?.montant||"")}" placeholder="Montant" onblur="formatMoneyField(this)"/></div><div class="col-span-2"><input class="input" name="note" value="${escapeHTML(e?.note||"")}" placeholder="Note"/></div><div><button type="button" class="btn btn-ghost text-red-600" onclick="this.closest('.paie-el-row').remove()">✕</button></div></div>`;
  }
}

async function paieSaveElements(agentId,form){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  if(paieIsClosed(ym)){toast("Mois clôturé : modification refusée","error");return}
  db.paieElements=(db.paieElements||[]).filter(e=>!(e.agentId===agentId&&e.ym===ym));
  [...form.querySelectorAll(".paie-el-row")].forEach(row=>{
    const rubriqueId=row.querySelector('[name="rubriqueId"]')?.value||"";const montant=parseMoneyInput(row.querySelector('[name="montant"]')?.value)||0;
    if(rubriqueId&&montant>0)db.paieElements.push({id:uid("pel"),ym,agentId,rubriqueId,montant,note:row.querySelector('[name="note"]')?.value||"",createdAt:new Date().toISOString(),createdBy:session?.username||""});
  });
  if(!(await saveDBAndWaitToast("Éléments paie non confirmés")))return;
  closeModal();toast("Éléments de paie enregistrés","success");renderView();
}

function paieOptimizerHTML(agents,ym){
  const selected=sessionStorage.getItem("paieOptimAgent")||agents[0]?.id||"";
  const target=sessionStorage.getItem("paieOptimNet")||"";
  const targetDisplay=formatMoneyInputValueDA(target);
  const agent=(db.agents||[]).find(a=>a.id===selected)||agents[0]||null;
  const bounds=agent?paieGrilleBounds(agent):null;
  const opt=target?paieOptimizeFromNet(target,agent):null;
  return `<div class="card p-4 mb-4">
    <div class="flex items-start justify-between gap-3 flex-wrap mb-3"><div><h3 class="font-black">Simulateur net cible → paie optimisée</h3><div class="text-xs text-slate-500">Optimisation encadrée par les plafonds panier/transport configurés. Le système respecte SNMG, CNAS et IRG.</div></div>${paieIsClosed(ym)?`<span class="pill pill-green">Mois clôturé</span>`:""}</div>
    <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div><label class="label">Employé</label><select class="select" onchange="sessionStorage.setItem('paieOptimAgent',this.value);renderView()">${agents.map(a=>`<option value="${a.id}" ${selected===a.id?"selected":""}>${escapeHTML((a.matricule? a.matricule+" · ":"")+(a.nom||"")+" "+(a.prenom||""))}</option>`).join("")}</select></div>
      <div><label class="label">Net à payer cible</label><input id="paie-optim-net-input" class="input" inputmode="decimal" value="${escapeHTML(targetDisplay)}" placeholder="Ex : 30 000,00 DA" onfocus="this.value=formatMoneyInputValue(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();paieSetOptimNet(this.value)}" onblur="paieSetOptimNet(this.value)"/></div>
      <div><label class="label">Grille fonction</label><div class="input bg-slate-50">${bounds?`${escapeHTML(bounds.fonction)} · ${money(bounds.min)}${bounds.max?" / "+money(bounds.max):""}`:"SNMG"}</div></div>
      <div><label class="label">Panier max optimisation</label><div class="input bg-slate-50">${money(paieConfig().optimisationPanierMax||0)}</div></div>
      <div><label class="label">Transport max optimisation</label><div class="input bg-slate-50">${money(paieConfig().optimisationTransportMax||0)}</div></div>
    </div>
    ${opt?`<div class="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3">
      <div class="p-3 rounded bg-slate-50"><div class="text-[10px] uppercase text-slate-500">Base brute</div><b>${money(opt.base)}</b></div>
      <div class="p-3 rounded bg-emerald-50"><div class="text-[10px] uppercase text-slate-500">Panier</div><b>${money(opt.panier)}</b></div>
      <div class="p-3 rounded bg-emerald-50"><div class="text-[10px] uppercase text-slate-500">Transport</div><b>${money(opt.transport)}</b></div>
      <div class="p-3 rounded bg-red-50"><div class="text-[10px] uppercase text-slate-500">CNAS salarié</div><b>${money(opt.cnasSalarie)}</b></div>
      <div class="p-3 rounded bg-purple-50"><div class="text-[10px] uppercase text-slate-500">IRG</div><b>${money(opt.irg)}</b></div>
      <div class="p-3 rounded bg-amber-50"><div class="text-[10px] uppercase text-slate-500">Coût employeur</div><b>${money(opt.coutEmployeur)}</b></div>
    </div>
    ${opt.warning?`<div class="text-xs text-red-700 mt-2">${escapeHTML(opt.warning)}</div>`:""}
    <div class="flex justify-end mt-3"><button class="btn btn-primary" onclick="paieApplyOptimization('${selected}')">Appliquer à l'employé</button></div>`:""}
  </div>`;
}

function paieSetOptimNet(value){
  const n=parseMoneyInput(value);
  sessionStorage.setItem("paieOptimNet",n===""?"":String(n));
  renderView();
}

async function paieApplyOptimization(agentId){
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  if(paieIsClosed(ym)){toast("Mois clôturé : application refusée","error");return}
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a){toast("Employé introuvable","error");return}
  const opt=paieOptimizeFromNet(sessionStorage.getItem("paieOptimNet")||"",a);
  if(!opt.target){toast("Saisissez un net cible","error");return}
  const panierRub=(db.paieRubriques||[]).find(r=>r.code==="PANIER_VAR");
  const transRub=(db.paieRubriques||[]).find(r=>r.code==="TRANS_VAR");
  a.salaireNet=opt.target;
  a.salaireBase=opt.base;
  a.paieBaseBrute=opt.base;
  a.updatedAt=today();
  db.paieElements=(db.paieElements||[]).filter(e=>!(e.agentId===agentId&&e.ym===ym&&[panierRub?.id,transRub?.id].includes(e.rubriqueId)));
  if(opt.panier>0&&panierRub)db.paieElements.push({id:uid("pel"),ym,agentId,rubriqueId:panierRub.id,montant:opt.panier,note:"Optimisation net cible",createdAt:new Date().toISOString(),createdBy:session?.username||""});
  if(opt.transport>0&&transRub)db.paieElements.push({id:uid("pel"),ym,agentId,rubriqueId:transRub.id,montant:opt.transport,note:"Optimisation net cible",createdAt:new Date().toISOString(),createdBy:session?.username||""});
  try{if(a.backendId)Object.assign(a,employeeFromApi(await SGDI.employees.update(a.backendId,employeeApiPayload(a))),a,{backendId:a.backendId})}
  catch(e){toast("Salaire non enregistré : "+(e.message||e),"error");return}
  if(!(await saveDBAndWaitToast("Optimisation paie non confirmée")))return;
  toast("Paie optimisée appliquée","success");renderView();
}

function renderPaie(view,sub,arg){
  if(sub==="agent"&&arg)return renderPaieAgent(view,arg);
  paieEnsure();
  const cfg=paieConfig();
  const ym=sessionStorage.getItem("paieMois")||today().slice(0,7);
  const lockedSoc=paieActiveSocieteScope();
  const soc=lockedSoc||(sessionStorage.getItem("paieSociete")||"");
  if(lockedSoc)sessionStorage.removeItem("paieSociete");
  const agents=paieEligibleAgents(ym,soc);
  const closed=paieClosedInfo(ym,soc);
  const lines=agents.map(a=>({a,c:paieCalcForAgent(a,ym)}));
  const sum=k=>lines.reduce((s,x)=>s+(Number(x.c[k])||0),0);
  const anomalies=lines.filter(x=>x.c.brutCotisable<x.c.assietteCnasMinimum||!x.c.pointageDisponible||!(x.c.brutBase>0));
  const salairesNets=lines.map(x=>Number(x.c.netAPayer)||0).filter(value=>value>0);
  const salaireMoyenNet=salairesNets.length?Math.round(salairesNets.reduce((total,value)=>total+value,0)/salairesNets.length):0;
  const tranchesSalairePaie=[
    ["< 30k",salairesNets.filter(value=>value<30000).length],
    ["30k-45k",salairesNets.filter(value=>value>=30000&&value<45000).length],
    ["45k-60k",salairesNets.filter(value=>value>=45000&&value<60000).length],
    ["60k-80k",salairesNets.filter(value=>value>=60000&&value<80000).length],
    ["80k+",salairesNets.filter(value=>value>=80000).length]
  ];
  const paieSocieteField=lockedSoc
    ? `<div><label class="label">Société</label><div class="input bg-slate-50 font-bold">${escapeHTML(lockedSoc)}</div></div>`
    : `<div><label class="label">Société</label><select class="select" onchange="setPaieFilter('Societe',this.value)"><option value="">Toutes</option>${SOCIETES.map(s=>`<option ${soc===s?"selected":""}>${s}</option>`).join("")}</select></div>`;
  view.innerHTML=`<div class="flex justify-between items-start gap-3 mb-4">
    <div><h1 class="text-2xl font-bold">Paie — ${paieMonthLabel(ym)} ${closed?`<span class="pill pill-green">Clôturée</span>`:""}</h1><p class="text-sm text-slate-500">Calcul paie Algérie : CNAS, IRG barème progressif, net à payer, coût employeur.</p>${closed?`<div class="text-xs text-emerald-700 mt-1">Clôturée le ${new Date(closed.closedAt).toLocaleString("fr-FR")} par ${escapeHTML(closed.closedBy||"")} · ${closed.bulletins||0} bulletin(s)</div>`:""}</div>
    <div class="flex gap-2 flex-wrap justify-end"><button class="btn paie-export-btn" onclick="paieExportCSV()">Exporter CSV</button><button class="btn paie-export-btn" onclick="paieExportCNAS()">Export CNAS</button><button class="btn paie-export-btn" onclick="paieExportIRG()">Export IRG</button><button class="paie-close-btn" onclick="paieCloseMonth()">Clôturer le mois</button><button class="btn paie-print-btn" onclick="window.print()">Imprimer</button></div>
  </div>
  <div class="card p-4 mb-4">
    <div class="grid grid-4">
      <div><label class="label">Mois de paie</label><input class="input" type="month" value="${ym}" onchange="setPaieFilter('Mois',this.value)"/></div>
      ${paieSocieteField}
      <div><label class="label">SNMG applicable</label><div class="input bg-slate-50">${money(cfg.snmg)}</div></div>
      <div><label class="label">Heures légales / mois</label><div class="input bg-slate-50">${qty(cfg.heuresMois)} h</div></div>
    </div>
  </div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Effectif paie</div><div class="text-3xl font-black text-sky-700">${agents.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Brut cotisable</div><div class="text-2xl font-black">${money(sum("brutCotisable"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Net à payer</div><div class="text-2xl font-black text-emerald-700">${money(sum("netAPayer"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Coût employeur</div><div class="text-2xl font-black text-amber-700">${money(sum("coutEmployeur"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">CNAS salarié ${qty(cfg.tauxCnasSalarie)}%</div><div class="text-2xl font-black text-red-700">${money(sum("cnasSalarie"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">CNAS patronal ${qty(cfg.tauxCnasPatronal)}%</div><div class="text-2xl font-black text-orange-700">${money(sum("cnasPatronal"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">IRG retenu</div><div class="text-2xl font-black text-purple-700">${money(sum("irg"))}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Jours abs. pointage</div><div class="text-2xl font-black text-red-700">${qty(sum("joursAbsencePaie"))}</div><div class="text-[10px] text-slate-500">A inclut AB</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Alertes SNMG</div><div class="text-2xl font-black ${anomalies.length?"text-red-700":"text-emerald-700"}">${anomalies.length}</div></div>
  </div>
  <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
    <div class="card p-5"><div class="text-xs text-slate-500 uppercase">Salaire moyen</div><div class="text-3xl font-black mt-2" style="color:#0f766e">${money(salaireMoyenNet)}</div><div class="text-xs text-slate-500 mt-2">Net à payer · ${salairesNets.length} salarié(s) · ${escapeHTML(paieMonthLabel(ym))}</div></div>
    <div class="xl:col-span-2">${drhChartCard("Distribution salaire","Tranches du net à payer · "+paieMonthLabel(ym),drhSvgStacked(tranchesSalairePaie))}</div>
  </div>
  ${anomalies.length?`<div class="card p-4 mb-4" style="background:#fef2f2;border:2px solid #dc2626"><div class="font-black text-red-700 mb-2">Alerte SNMG</div><div class="text-sm text-red-700">${anomalies.length} agent(s) ont un brut cotisable inférieur au SNMG ${money(cfg.snmg)}.</div></div>`:""}
  ${paieOptimizerHTML(agents,ym)}
  <details class="card p-4 mb-4"><summary class="font-bold cursor-pointer">Grilles salariales par fonction</summary>
    <div class="mt-3">${paieGrillesHTML()}</div>
    <button type="button" class="btn btn-primary mt-3" onclick="openPaieGrilleModal()">Ajouter grille fonction</button>
  </details>
  <details class="card p-4 mb-4"><summary class="font-bold cursor-pointer">Rubriques de paie paramétrables</summary>
    <div class="mt-3">${paieRubriquesHTML()}</div>
    <button type="button" class="btn btn-primary mt-3" onclick="openPaieRubriqueModal()">Ajouter rubrique</button>
  </details>
  <details class="card p-4 mb-4"><summary class="font-bold cursor-pointer">Paramètres réglementaires et primes</summary>
    <form id="paie-config-form" class="grid grid-6 mt-4">
      <div class="col-span-2"><label class="label">SNMG</label><input class="input" name="snmg" value="${formatMoneyInputValue(cfg.snmg)}" onblur="formatMoneyField(this)"/></div>
      <div class="col-span-2"><label class="label">Heures / mois</label><input class="input" name="heuresMois" value="${cfg.heuresMois}"/></div>
      <div><label class="label">Jours ouvrables / mois</label><input class="input" name="joursOuvrablesMois" value="${cfg.joursOuvrablesMois}"/></div>
      <div><label class="label">CNAS salarié %</label><input class="input" name="tauxCnasSalarie" value="${cfg.tauxCnasSalarie}"/></div>
      <div><label class="label">CNAS patronal %</label><input class="input" name="tauxCnasPatronal" value="${cfg.tauxCnasPatronal}"/></div>
      <div><label class="label">Œuvres sociales %</label><input class="input" name="tauxOeuvresSociales" value="${cfg.tauxOeuvresSociales}"/></div>
      <div><label class="label">IRG primes/rappels %</label><input class="input" name="tauxIRGNonMensuel" value="${cfg.tauxIRGNonMensuel}"/></div>
      <div><label class="label">Majoration HS min. %</label><input class="input" name="majorationHeuresSup" value="${cfg.majorationHeuresSup}"/></div>
      <div><label class="label">Abattement IRG %</label><input class="input" name="abattementIRG" value="${cfg.abattementIRG}"/></div>
      <div><label class="label">Abatt. min/mois</label><input class="input" name="abattementMinMensuel" value="${formatMoneyInputValue(cfg.abattementMinMensuel)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Abatt. max/mois</label><input class="input" name="abattementMaxMensuel" value="${formatMoneyInputValue(cfg.abattementMaxMensuel)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Prime nuit</label><input class="input" name="primeNuit" value="${formatMoneyInputValue(cfg.primeNuit)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Prime panier</label><input class="input" name="primePanier" value="${formatMoneyInputValue(cfg.primePanier)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Prime transport</label><input class="input" name="primeTransport" value="${formatMoneyInputValue(cfg.primeTransport)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Panier max optimisation</label><input class="input" name="optimisationPanierMax" value="${formatMoneyInputValue(cfg.optimisationPanierMax)}" onblur="formatMoneyField(this)"/></div>
      <div><label class="label">Transport max optimisation</label><input class="input" name="optimisationTransportMax" value="${formatMoneyInputValue(cfg.optimisationTransportMax)}" onblur="formatMoneyField(this)"/></div>
      <div class="col-span-6 text-xs text-slate-500"><b>Référentiel ${escapeHTML(cfg.regulatoryVersion||"DZ")}</b> · IRG mensuel 0 / 23 / 27 / 30 / 33 / 35%, exonération jusqu'à 30 000 DA, abattement ${qty(cfg.abattementIRG)}% plafonné entre ${money(cfg.abattementMinMensuel)} et ${money(cfg.abattementMaxMensuel)}, formules spéciales et retenue distincte des primes/rappels. Toute modification doit être validée par le responsable paie.</div>
      <div class="col-span-6"><button type="button" class="btn btn-primary" onclick="savePaieConfig()">Enregistrer paramètres</button></div>
    </form>
  </details>
  <div class="card overflow-hidden"><div class="overflow-x-auto"><table>
    <thead><tr><th>Code</th><th>Employé</th><th>Société</th><th>Contrat</th><th class="text-right">Base proratisée</th><th class="text-right">Primes</th><th class="text-right">Brut cotisable</th><th class="text-right">Assiette CNAS</th><th class="text-right">CNAS sal.</th><th class="text-right">Base IRG</th><th class="text-right">IRG</th><th class="text-right">Net à payer</th><th class="text-right">Coût employeur</th><th>Alerte</th><th></th></tr></thead>
    <tbody id="paie-tbody">${lines.length===0?`<tr><td colspan="15" class="text-center text-slate-500 p-6">Aucun salarié à payer sur cette période.</td></tr>`:lines.map(({a,c})=>{const typeContrat=cleanContractType(a.typeContrat);const csv=[a.matricule,(a.nom||"")+" "+(a.prenom||""),a.societe,typeContrat,c.brutCotisable,c.assietteCnas,c.cnasSalarie,c.baseIRG,c.irg,c.netAPayer,c.cnasPatronal,c.oeuvresSociales,c.coutEmployeur];const issues=[!c.pointageDisponible?"POINTAGE":null,!(c.brutBase>0)?"BASE":null,c.assietteCnas>c.brutCotisable?"CNAS MIN":null,paieIsClosed(ym,a.societe)&&paieBulletinDrift(a,ym)?"POINTAGE MODIFIÉ APRÈS CLÔTURE":null].filter(Boolean);return`<tr data-searchable data-paierow data-csv='${JSON.stringify(csv).replace(/'/g,"&#39;")}'><td class="font-mono font-bold">${safe(a.matricule)}</td><td><a href="#/paie/agent/${employeeRouteId(a)}" class="font-semibold hover:underline">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</a><div class="text-[10px] text-slate-500">${escapeHTML(a.fonction||a.affectationCourante?.poste||"")}</div></td><td class="text-xs">${safe(a.societe)}</td><td><span class="pill pill-gray">${safe(typeContrat)}</span></td><td class="text-right">${money(c.baseProratisee)}</td><td class="text-right">${money(c.primes)}</td><td class="text-right font-bold">${money(c.brutCotisable)}</td><td class="text-right font-bold">${money(c.assietteCnas)}</td><td class="text-right text-red-700">${money(c.cnasSalarie)}</td><td class="text-right">${money(c.baseIRG)}</td><td class="text-right text-purple-700">${money(c.irg)}</td><td class="text-right font-black text-emerald-700">${money(c.netAPayer)}</td><td class="text-right font-bold text-amber-700">${money(c.coutEmployeur)}</td><td>${issues.length?issues.map(i=>`<span class="pill pill-red">${i}</span>`).join(" "):`<span class="pill pill-green">OK</span>`}</td><td><div class="flex gap-1 flex-wrap"><button class="btn btn-secondary text-xs" onclick="openPaieElementsModal('${a.id}')">Éléments</button><button class="btn btn-primary text-xs" onclick="navigate('paie/agent/${employeeRouteId(a)}')">Dossier</button><button class="btn btn-secondary text-xs" onclick="previewPaieFiche('${a.id}')">Bulletin</button></div></td></tr>`}).join("")}</tbody>
  </table></div></div>
  <div class="text-xs text-slate-500 mt-3">Note : ce module automatise les calculs standards. Les cas particuliers (avantages en nature, indemnités imposables/non imposables, temps partiel, dispositifs aidés, rappels) doivent être validés par votre comptable ou gestionnaire paie.</div>`;
}

SGDIModules.registerModule({key: "paie", routes: ["paie"], dependencies: [], init: function(){}, destroy: function(){}});
