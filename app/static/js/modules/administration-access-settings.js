/* Administration access-settings : fonctions historiques, règles inchangées. */
function accessStructureModules(){return["drh","ops","superviseur","materiel","facturation","commercial","secretariat","agenda","pointage"]}

function renderAdminAccessSecurity(view,section){
  const security=accessSecuritySettings();
  const socAccess=societeAccessSettings();
  const socPasswords={...(socAccess.passwords||{})};
  const structPasswords={...(security.structures.passwords||{})};
  const show=section||"access";
  const codeCfg=validationCodeSettings();
  const habilites=(db.users||[]).filter(u=>u.validationCodeEnabled).length;
  const blockStyle="border:1px solid #dbeafe;background:#f8fafc;border-radius:8px";
  const sgdiBlock=`<section class="card p-5" style="${blockStyle}">
    <div class="flex items-start justify-between gap-3 mb-4"><div><h3 class="font-black text-lg">1. ACCES SGDI</h3><p class="text-sm text-slate-500">Accès interne libre après connexion utilisateur.</p></div><span class="pill pill-red">Système</span></div>
    <div class="p-3 rounded bg-emerald-50 text-emerald-800 text-sm font-bold">Aucun mot de passe interne demandé. Seule la connexion utilisateur reste obligatoire.</div>
  </section>`;
  const socBlock=`<section class="card p-5" style="${blockStyle}">
    <div class="flex items-start justify-between gap-3 mb-4"><div><h3 class="font-black text-lg">2. ACCES SOCIETE</h3><p class="text-sm text-slate-500">Accès libre après connexion utilisateur.</p></div><span class="pill pill-green">Libre</span></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${SOCIETES.map(s=>`<div class="p-3 rounded border border-emerald-100 bg-emerald-50 text-sm font-bold text-emerald-800">${escapeHTML(s)} · Accès libre</div>`).join("")}</div>
  </section>`;
  const structBlock=`<section class="card p-5" style="${blockStyle}">
    <div class="flex items-start justify-between gap-3 mb-4"><div><h3 class="font-black text-lg">3. ACCES STRUCTURE</h3><p class="text-sm text-slate-500">Accès libre après connexion utilisateur et droits habilitation.</p></div><span class="pill pill-green">Libre</span></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${accessStructureModules().map(m=>`<div class="p-3 rounded border border-emerald-100 bg-emerald-50 text-sm font-bold text-emerald-800">${escapeHTML(structureAccessLabel(m))} · Accès libre</div>`).join("")}</div>
  </section>`;
  const codeBlock=`<section class="card p-5" style="${blockStyle}">
    <div class="flex items-start justify-between gap-3 mb-4"><div><h3 class="font-black text-lg">4. CODE DE VALIDATION JOURNALIER</h3><p class="text-sm text-slate-500">Code de 04 chiffres demandé aux utilisateurs habilités pour créer, modifier, supprimer, valider, ajouter ou enregistrer.</p></div><span class="pill ${codeCfg.enabled?'pill-green':'pill-gray'}">${codeCfg.enabled?'Actif':'Désactivé'}</span></div>
    <label class="flex items-center gap-3 mb-3 p-3 rounded-lg" style="background:#fff;border:1px solid #e2e8f0"><input type="checkbox" name="validationCodeEnabled" ${codeCfg.enabled?'checked':''}/> <span><b>Activer la demande du code journalier</b><br/><small class="text-slate-500">Le code est affiché après connexion pour les utilisateurs habilités.</small></span></label>
    <label class="flex items-center gap-3 mb-3 p-3 rounded-lg" style="background:#fff;border:1px solid #e2e8f0"><input type="checkbox" name="validationCodeRequireForAdmin" ${codeCfg.requireForAdmin?'checked':''}/> <span><b>Appliquer aussi au compte Administration système</b><br/><small class="text-slate-500">Sinon l'administrateur système reste exempté.</small></span></label>
    <div class="p-3 rounded bg-blue-50 text-blue-800 text-sm font-bold">${habilites} utilisateur(s) habilité(s). L'habilitation se règle dans Administration système > Utilisateurs.</div>
  </section>`;
  const sections={access_sgdi:sgdiBlock,access_societes:socBlock,access_structures:structBlock,access_code:codeBlock};
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Sécurité des accès</h1><p class="text-sm text-slate-500 mt-1">Les mots de passe internes ont été supprimés. Les accès se gèrent par utilisateur, profil d'accès, société, site et structure autorisée.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <button class="card p-4 text-left" style="border-left:4px solid #16a34a" onclick="navigate('admin/access_sgdi')"><div class="text-xs text-slate-500">Accès</div><div class="font-black">SGDI libre</div></button>
      <button class="card p-4 text-left" style="border-left:4px solid #16a34a" onclick="navigate('admin/access_societes')"><div class="text-xs text-slate-500">Accès</div><div class="font-black">Sociétés libres</div></button>
      <button class="card p-4 text-left" style="border-left:4px solid #16a34a" onclick="navigate('admin/access_structures')"><div class="text-xs text-slate-500">Accès</div><div class="font-black">Structures libres</div></button>
      <button class="card p-4 text-left" style="border-left:4px solid ${codeCfg.enabled?'#16a34a':'#64748b'}" onclick="navigate('admin/access_code')"><div class="text-xs text-slate-500">Validation</div><div class="font-black">Code journalier</div></button>
    </div>
    <form onsubmit="event.preventDefault();saveAdminAccessSecurity(this)">
      <div class="grid grid-cols-1 gap-4">${sections[show]||sgdiBlock+socBlock+structBlock}</div>
      <div class="sticky bottom-0 mt-5 p-3 flex justify-end gap-2" style="background:#ffffffcc;backdrop-filter:blur(8px);border-top:1px solid #e2e8f0"><button type="button" class="btn btn-ghost" onclick="renderView()">Annuler</button><button class="btn btn-primary">Enregistrer la configuration</button></div>
    </form>`;
}

async function saveAdminAccessSecurity(form){
  if(!db.settings)db.settings={};
  const currentSecurity=accessSecuritySettings();
  const currentSociete=societeAccessSettings();
  const structPasswords={...(currentSecurity.structures.passwords||{})};
  accessStructureModules().forEach(m=>{if(form.elements["struct_"+m]){const v=(form.elements["struct_"+m].value||"").toString().trim();if(v)structPasswords[m]=v}});
  const sgdiPassword=form.sgdiPassword?(form.sgdiPassword.value||"").toString().trim():currentSecurity.sgdi.password;
  db.settings.accessSecurity={...(db.settings.accessSecurity||{}),sgdi:{password:""},structures:{requirePassword:false,passwords:{}}};
  const prevValidation=validationCodeSettings();
  db.settings.validationCode={enabled:form.validationCodeEnabled?!!form.validationCodeEnabled.checked:prevValidation.enabled,requireForAdmin:form.validationCodeRequireForAdmin?!!form.validationCodeRequireForAdmin.checked:prevValidation.requireForAdmin,updatedAt:new Date().toISOString(),updatedBy:session?.username||""};
  const socPasswords={...(currentSociete.passwords||{})};
  SOCIETES.forEach(s=>{const n=normalizeSocieteName(s);if(form.elements["soc_"+n]){const v=(form.elements["soc_"+n].value||"").toString().trim();if(v)socPasswords[n]=v}});
  saveSocieteConfig({access:{requirePassword:false,passwords:{}}});
  try{await persistSocieteConfig();saveDB();logActivity("Configuration sécurité accès","Accès internes libres");toast("Mots de passe internes supprimés","success");renderView()}catch(e){toast("Erreur sauvegarde sécurité : "+(e.message||e),"error")}
}
SGDIModules.registerModule({key:"administration-access-settings",routes:[]});
