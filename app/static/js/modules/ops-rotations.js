/* OPS — Rotations centrales : configuration du régime d'un site et planning mensuel.
   Le serveur fait foi : cycle, effectifs, points critiques et contrôles viennent de
   /api/ops/central-rotations (moteur central). Cet écran édite des paramètres et affiche
   les résultats ; aucun calcul de cycle dans le navigateur, aucun identifiant technique affiché. */
const ROT_API="/api/ops/central-rotations";
const ROT_GROUPS=["A","B","C","D"];
const ROT_COLORS={A:"#2563eb",B:"#16a34a",C:"#ea580c",D:"#9333ea"};
const ROT_REGIMES=[["3X8","3×8"],["24H48","24h/48"],["1/2","1/2"],["1/3","1/3"],["NORMAL","Horaire normal"],["CUSTOM","Personnalisé"]];
const ROT_DAYS=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const ROT_SHORT_LABELS={"Après-midi":"A.-midi"};
const ROT_DAY_NAMES=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
// Jours dans l'ordre de la semaine du site (0 = lundi … 6 = dimanche, convention du serveur).
function rotWeekOrder(start){const s=Number.isInteger(start)?start:0;return [0,1,2,3,4,5,6].map(i=>(s+i)%7)}
function rotDaysLabel(days,start){const list=rotWeekOrder(start).filter(d=>days.map(Number).includes(d));return list.length?list.map(d=>ROT_DAYS[d].toLowerCase()).join(", "):"—"}
const ROT_MONTHS=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
let rotState=null;

function rotEsc(v){return escapeHTML(String(v??""))}
function rotApi(path,options={}){return sgdiApi(ROT_API+path,{...options,legacy:false})}
function rotMonthLabel(month){const [y,m]=String(month).split("-").map(Number);return `${ROT_MONTHS[m-1]} ${y}`}
function rotShiftMonth(month,delta){const [y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return d.toISOString().slice(0,7)}
function rotThisMonth(){return new Date().toISOString().slice(0,7)}
function rotChip(group,label){return group?`<span class="rot-chip rot-${group}" title="Groupe ${group}">${label?rotEsc(label)+" ":""}${group}</span>`:`<span class="rot-chip rot-off">OFF</span>`}
function rotIcon(name){const p={sites:'<path d="M3 21V7l7-4v18M10 21h11V9l-6-3"/><path d="M6 10h1M6 14h1M14 12h3M14 16h3"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>',alert:'<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h4"/>',people:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.8 3.2-6 6.5-6s5.8 2.2 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14c3 .2 4.8 2.2 5.4 5"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'}[name]||"";return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`}

function rotStyles(){
  if(document.getElementById("rot-styles"))return;
  const s=document.createElement("style");s.id="rot-styles";
  s.textContent=`.rot-page{display:grid;gap:16px;min-width:0}.rot-page *{box-sizing:border-box}
.rot-crumb{font-size:13px;color:#64748b}.rot-crumb b{color:#1d4ed8;font-weight:700}.rot-title{font-size:26px;font-weight:900;color:#0b1f44;margin:2px 0 0}
.rot-tabs{display:flex;gap:6px;flex-wrap:wrap}.rot-tab{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px;color:#334155;cursor:pointer}.rot-tab[aria-current="page"]{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.rot-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:14px}
.rot-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 1px 3px rgba(15,23,42,.05);min-width:0}
.rot-kpi-icon{width:52px;height:52px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto}.rot-kpi b{display:block;font-size:14px;color:#0f172a}.rot-kpi strong{display:block;font-size:28px;font-weight:900;color:#0b1f44;line-height:1.1}.rot-kpi small{color:#64748b;font-size:12px}
.rot-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(15,23,42,.05);min-width:0}.rot-card h2{font-size:18px;font-weight:900;color:#0b1f44;margin:0 0 12px}
.rot-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:12px 14px;align-items:end}
.rot-field{display:grid;gap:5px;font-size:13px;font-weight:600;color:#334155;min-width:0}.rot-field input,.rot-field select,.rot-field textarea{width:100%;min-width:0;height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font:inherit;font-weight:500;background:#fff;color:#0f172a}.rot-field textarea{height:auto;padding:8px 10px}
.rot-seg{display:flex;flex-wrap:wrap;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;min-width:0}.rot-seg button{flex:1 1 auto;min-width:64px;height:40px;border:0;border-right:1px solid #e2e8f0;background:#fff;font-weight:600;color:#1e293b;cursor:pointer;padding:0 10px}.rot-seg button:last-child{border-right:0}.rot-seg button[aria-pressed="true"]{background:#1d4ed8;color:#fff}.rot-seg button:disabled{color:#94a3b8;cursor:not-allowed;background:#f8fafc}
.rot-kpi-icon.t-blue{background:#dbeafe!important;color:#1d4ed8!important}.rot-kpi-icon.t-green{background:#dcfce7!important;color:#15803d!important}.rot-kpi-icon.t-red{background:#fee2e2!important;color:#dc2626!important}.rot-kpi-icon.t-orange{background:#ffedd5!important;color:#ea580c!important}.rot-kpi-icon.t-yellow{background:#fef3c7!important;color:#ca8a04!important}.rot-kpi-icon.t-violet{background:#ede9fe!important;color:#7c3aed!important}.rot-kpi-icon svg{width:26px;height:26px}
.rot-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,2.9fr);gap:12px 14px;align-items:end}.rot-row.has-month{grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,2fr) minmax(0,1fr)}
@media(max-width:1380px){.rot-row,.rot-row.has-month{grid-template-columns:repeat(3,minmax(0,1fr))}.rot-row>.rot-field:nth-child(4){grid-column:1/-1}}@media(max-width:700px){.rot-row,.rot-row.has-month{grid-template-columns:1fr}}
.rot-seg{flex-wrap:nowrap}.rot-seg button{min-width:0;flex:1 1 auto;white-space:nowrap;padding:0 8px;font-size:13.5px}@media(max-width:700px){.rot-seg{flex-wrap:wrap}.rot-seg button{flex:1 1 30%;border-bottom:1px solid #e2e8f0}}
.rot-seg button[aria-pressed="true"],.rot-seg button[aria-pressed="true"]:disabled{background:#1d4ed8!important;color:#fff!important}
.rot-day-off{font-size:11px;color:#64748b;font-weight:700;letter-spacing:.02em}
.rot-span2{grid-column:span 2}@media(max-width:700px){.rot-span2{grid-column:auto}}
.rot-groups-wrap{display:grid;grid-template-columns:minmax(0,3.2fr) minmax(min(100%,260px),1fr);gap:16px}@media(max-width:1100px){.rot-groups-wrap{grid-template-columns:1fr}}
.rot-groups{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media(max-width:1500px){.rot-groups{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.rot-groups{grid-template-columns:1fr}}
.rot-group{border:1.5px solid;border-radius:12px;padding:14px;min-width:0}.rot-group h3{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:17px;font-weight:800}.rot-group ul{list-style:none;margin:0;padding:0;display:grid;gap:7px;font-size:13.5px;color:#1e293b}.rot-group li{display:flex;gap:8px;align-items:flex-start}.rot-group li i{font-style:normal;width:18px;flex:0 0 auto;text-align:center;font-weight:900}
.rot-badge{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:900;flex:0 0 auto}
.rot-group label{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;font-weight:700;color:#475569}.rot-group label input{width:64px;height:30px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px}
.rot-rules{background:#eff6ff;border-radius:12px;padding:16px}.rot-rules h3{display:flex;gap:8px;align-items:center;margin:0 0 10px;font-size:17px;font-weight:800;color:#0b1f44}.rot-rules ul{list-style:none;margin:0;padding:0;display:grid;gap:9px;font-size:13.5px;color:#1e293b}.rot-rules li{display:flex;gap:8px}.rot-rules li::before{content:"✓";color:#fff;background:#1e3a8a;border-radius:50%;width:18px;height:18px;flex:0 0 auto;font-size:11px;display:grid;place-items:center;margin-top:1px}
.rot-A{--g:#2563eb;--gb:#dbeafe}.rot-B{--g:#16a34a;--gb:#dcfce7}.rot-C{--g:#ea580c;--gb:#ffedd5}.rot-D{--g:#9333ea;--gb:#f3e8ff}
.rot-group.rot-A,.rot-group.rot-B,.rot-group.rot-C,.rot-group.rot-D{border-color:var(--g);background:color-mix(in srgb,var(--gb) 45%,#fff)}.rot-group h3{color:var(--g)}.rot-badge{background:var(--g)}
.rot-chip{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:24px;padding:0 8px;border-radius:7px;font-weight:800;font-size:13px;background:var(--gb);color:var(--g);border:1px solid color-mix(in srgb,var(--g) 30%,#fff)}.rot-off{background:#f1f5f9;color:#475569;border-color:#e2e8f0;--g:#64748b}
.rot-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#475569}.rot-legend span{display:inline-flex;align-items:center;gap:5px}.rot-legend i{width:9px;height:9px;border-radius:50%;background:var(--g)}
.rot-cal-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}.rot-cal-head h2{margin:0}
.rot-nav{display:flex;gap:6px;align-items:center}.rot-nav button{height:36px;min-width:36px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;padding:0 10px}.rot-nav span{min-width:130px;text-align:center;font-weight:700;border:1px solid #cbd5e1;border-radius:8px;height:36px;display:grid;place-items:center;padding:0 10px}
.rot-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.rot-cal>div{border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;min-width:0}.rot-cal>div:nth-child(7n){border-right:0}
.rot-dow{background:#f8fafc;text-align:center;font-size:12px;font-weight:800;color:#475569;padding:8px 2px}
.rot-day{padding:7px;min-height:84px;display:grid;align-content:start;gap:5px;font-size:12px}.rot-day.is-empty{background:#fafafa}.rot-day.is-weekend{background:#fbfdff}.rot-day.is-today{box-shadow:inset 0 0 0 2px #1d4ed8}
.rot-day-num{display:flex;justify-content:space-between;align-items:center;font-weight:900;font-size:14px;color:#0f172a}.rot-day-num em{font-style:normal;font-size:10px;font-weight:800;color:#b45309}
.rot-day-row{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);gap:6px;align-items:center;color:#64748b}.rot-day-row .rot-chip{width:100%;min-width:0}.rot-day-row>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rot-crit{color:#dc2626;font-weight:800;font-size:11px}
.rot-plan{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(min(100%,300px),1fr);gap:16px}@media(max-width:1180px){.rot-plan{grid-template-columns:1fr}}
.rot-summary h3{font-size:14px;font-weight:800;margin:14px 0 8px;color:#0b1f44}.rot-summary ul{list-style:none;margin:0;padding:0;display:grid;gap:7px;font-size:13px}.rot-summary li{display:flex;justify-content:space-between;gap:10px;align-items:center}.rot-summary .ok::before{content:"✓";color:#fff;background:#16a34a;border-radius:50%;width:18px;height:18px;display:inline-grid;place-items:center;font-size:11px;margin-right:6px}.rot-summary .ko::before{content:"!";color:#fff;background:#dc2626;border-radius:50%;width:18px;height:18px;display:inline-grid;place-items:center;font-size:11px;margin-right:6px}
.rot-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}.rot-btn{height:42px;border-radius:9px;padding:0 18px;font-weight:800;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:8px}.rot-btn.is-ghost{background:#fff;color:#1d4ed8}.rot-btn.is-muted{background:#e2e8f0;border-color:#e2e8f0;color:#334155}.rot-btn:disabled{opacity:.5;cursor:not-allowed}
.rot-status{font-size:13px;font-weight:700}.rot-status.is-error{color:#b91c1c}.rot-status.is-ok{color:#15803d}
.rot-errors{margin:8px 0 0;padding-left:18px;font-size:13px;color:#b91c1c}
.rot-table{overflow:auto;border:1px solid #e2e8f0;border-radius:10px}.rot-table table{width:100%;min-width:640px;border-collapse:collapse;font-size:13px}.rot-table th,.rot-table td{padding:7px 9px;border-bottom:1px solid #e2e8f0;text-align:left}.rot-table th{background:#f8fafc}
@media(max-width:620px){.rot-day{min-height:64px;padding:4px;gap:3px}.rot-day-row{grid-template-columns:1fr}.rot-day-row>span:first-child{display:none}.rot-chip{min-width:0;height:20px;padding:0 4px;font-size:11px}.rot-title{font-size:21px}.rot-dow{font-size:10px}}`;
  document.head.appendChild(s);
}

// ── Entrée ─────────────────────────────────────────────────────────────────────────────────
async function renderCentralRotations(view,arg){
  rotStyles();
  const mode=arg==="planning"?"planning":"configuration";
  view.innerHTML=`<section class="rot-page" aria-busy="true"><div><div class="rot-crumb">OPS / Rotations / <b>${mode==="planning"?"Planning":"Configuration"}</b></div><h1 class="rot-title">${mode==="planning"?"Planning des rotations":"Configuration du régime du site"}</h1></div><p class="text-sm text-slate-500">Chargement…</p></section>`;
  try{
    const [sites,overview]=await Promise.all([rotApi("/sites"),rotApi("/overview")]);
    if(!view.isConnected)return;
    const previous=rotState||{};
    rotState={mode,view,sites:sites.items||[],overview,siteId:previous.siteId||null,structure:previous.structure||"",client:previous.client||"",
      month:previous.month||rotThisMonth(),form:previous.form||null,draft:null,receipt:null,preview:null,planning:null,busy:false,status:"",error:false,showTable:false};
    if(!rotState.siteId&&rotState.sites.length===1)rotState.siteId=rotState.sites[0].id;
    if(mode==="planning")return rotLoadPlanning();
    if(!rotState.form)rotState.form=rotDefaultForm(rotState.sites.find(s=>s.id===rotState.siteId)?.regime||"1/3");
    if(rotState.siteId&&!previous.form)return rotLoadSiteConfig();
    rotRenderConfig();rotRefreshPreview();
  }catch(e){view.innerHTML=`<section class="rot-page"><div class="rot-card" role="alert">${rotEsc(e.message||"Chargement impossible")}</div></section>`}
}

function rotHeader(title){
  const s=rotState,mode=s.mode;
  return `<div><div class="rot-crumb">OPS / Rotations / <b>${mode==="planning"?"Planning":"Configuration"}</b></div><h1 class="rot-title">${rotEsc(title)}</h1></div>
  <nav class="rot-tabs" aria-label="Rotations"><a class="rot-tab" href="#/ops/rotations" ${mode==="configuration"?'aria-current="page"':""}>Configuration du régime</a><a class="rot-tab" href="#/ops/rotations/planning" ${mode==="planning"?'aria-current="page"':""}>Planning des rotations</a></nav>`;
}
function rotKpi(icon,tone,label,value,hint){return `<div class="rot-kpi"><div class="rot-kpi-icon t-${tone}">${rotIcon(icon)}</div><div style="min-width:0"><b>${rotEsc(label)}</b><strong>${value===null||value===undefined?"—":rotEsc(value)}</strong>${hint?`<small>${rotEsc(hint)}</small>`:""}</div></div>`}
function rotSiteSelects(){
  const s=rotState,structures=[...new Set(s.sites.map(x=>x.structure).filter(Boolean))].sort(),
    clients=[...new Set(s.sites.filter(x=>!s.structure||x.structure===s.structure).map(x=>x.client).filter(Boolean))].sort(),
    sites=s.sites.filter(x=>(!s.structure||x.structure===s.structure)&&(!s.client||x.client===s.client));
  const opt=(v,l,sel)=>`<option value="${rotEsc(v)}" ${sel?"selected":""}>${rotEsc(l)}</option>`;
  return `<label class="rot-field">Structure<select data-rot="structure"><option value="">Toutes les structures</option>${structures.map(v=>opt(v,v,v===s.structure)).join("")}</select></label>
  <label class="rot-field">Client<select data-rot="client"><option value="">Tous les clients</option>${clients.map(v=>opt(v,v,v===s.client)).join("")}</select></label>
  <label class="rot-field">Site<select data-rot="site"><option value="">Choisir un site</option>${sites.map(x=>opt(x.id,x.name+(x.regime?` · ${({"3X8":"3×8","24H48":"24h/48"})[x.regime]||x.regime} v${x.version}`:""),x.id===s.siteId)).join("")}</select></label>`;
}
function rotBindSiteSelects(root,onSite){
  root.querySelector('[data-rot="structure"]').onchange=e=>{rotState.structure=e.target.value;rotState.client="";rotState.siteId=null;onSite()};
  root.querySelector('[data-rot="client"]').onchange=e=>{rotState.client=e.target.value;rotState.siteId=null;onSite()};
  root.querySelector('[data-rot="site"]').onchange=e=>{rotState.siteId=e.target.value?Number(e.target.value):null;onSite()};
}

// ── Configuration ──────────────────────────────────────────────────────────────────────────
function rotNextMonthFirst(){const d=new Date();return new Date(Date.UTC(d.getFullYear(),d.getMonth()+1,1)).toISOString().slice(0,10)}
// Nouvelle configuration : aucun horaire, aucun jour ouvré ni début de semaine pré-rempli. OPS les
// saisit explicitement ; une publication ne repose jamais sur une valeur cachée.
function rotDefaultForm(regime){
  const anchor=rotNextMonthFirst(),until=String(Number(anchor.slice(0,4))+1)+anchor.slice(4);
  return {regime,anchor,effective:anchor,reason:"",timezone:"Africa/Algiers",rest:480,early:45,late:30,nightStart:"",nightEnd:"",
    dayStart:"",dayEnd:"",nightShiftStart:"",nightShiftEnd:"",firstStart:"",daysPerPosition:2,
    shifts:[["",""],["",""],["",""]],staffDay:1,staffNight:1,staffMatin:1,staffAm:1,
    weekStart:"",workdays:[],holidays:"",calendarSource:"Calendrier OPS",calendarVersion:"1",calendarFrom:anchor,calendarUntil:until,
    phases:regime==="1/3"?{A:0,B:0,C:2,D:1}:{A:0,B:1,C:2,D:3}};
}
function rotMissing(){
  const f=rotState.form,r=f.regime,miss=[];
  const need=(v,label)=>{if(v===""||v==null)miss.push(label)};
  // 3×8 : date de début du cycle et six horaires suffisent ; le planning intelligent calcule le reste.
  if(r==="3X8"){need(f.anchor,"date de début du cycle");f.shifts.forEach((x,i)=>{need(x[0],["matin","après-midi","nuit"][i]+" — début");need(x[1],["matin","après-midi","nuit"][i]+" — fin")});return miss}
  need(f.weekStart,"début de semaine");if(!f.workdays.length)miss.push("jours ouvrés");
  need(f.nightStart,"début travail de nuit");need(f.nightEnd,"fin travail de nuit");
  if(r==="1/2")need(f.firstStart,"début de la première vacation");
  else{need(f.dayStart,"heure début service jour");need(f.dayEnd,"heure fin service jour");need(f.nightShiftStart,"heure début service nuit");need(f.nightShiftEnd,"heure fin service nuit")}
  return miss;
}
function rotConfig(){
  const f=rotState.form;
  if(f.regime==="3X8")return {...(f.base3x8||{}),regime:"3X8",timezone:f.timezone,anchor:f.anchor,shifts:f.shifts.map(([start,end])=>({start,end}))};
  const c={regime:f.regime,timezone:f.timezone,anchor:f.anchor,minimum_rest_minutes:Number(f.rest),early_minutes:Number(f.early),
    late_refusal_minutes:Number(f.late),week_start:f.weekStart===""?null:Number(f.weekStart),workdays:f.workdays.map(Number),weekend:[0,1,2,3,4,5,6].filter(i=>!f.workdays.map(Number).includes(i)),
    holidays:String(f.holidays).split(/[\s,;]+/).filter(Boolean),calendar_source:f.calendarSource,calendar_version:f.calendarVersion,
    calendar_valid_from:f.calendarFrom,calendar_valid_until:f.calendarUntil,night_start:f.nightStart,night_end:f.nightEnd,
    phases:Object.fromEntries(ROT_GROUPS.map(g=>[g,Number(f.phases[g])])),
    required_staff:f.regime==="3X8"?{MATIN:Number(f.staffMatin),APRES_MIDI:Number(f.staffAm),NUIT:Number(f.staffNight)}:{JOUR:Number(f.staffDay),NUIT:Number(f.staffNight)}};
  if(f.regime==="3X8"){c.days_per_position=Number(f.daysPerPosition);c.shifts=f.shifts.map(([start,end])=>({start,end}))}
  if(f.regime==="24H48"||f.regime==="1/3")Object.assign(c,{day_start:f.dayStart,day_end:f.dayEnd,night_shift_start:f.nightShiftStart,night_shift_end:f.nightShiftEnd});
  if(f.regime==="1/2")c.first_start=f.firstStart;
  return c;
}
function rotFormFromConfig(c,effective,reason){
  const f=rotDefaultForm(c.regime);
  Object.assign(f,{regime:c.regime,anchor:c.anchor,effective:effective||f.effective,reason:reason||"",timezone:c.timezone,rest:c.minimum_rest_minutes,early:c.early_minutes,late:c.late_refusal_minutes,
    nightStart:c.night_start,nightEnd:c.night_end,weekStart:c.week_start??"",workdays:[...c.workdays],holidays:(c.holidays||[]).join("\n"),calendarSource:c.calendar_source,calendarVersion:c.calendar_version,
    calendarFrom:c.calendar_valid_from,calendarUntil:c.calendar_valid_until,phases:{...c.phases}});
  if(c.regime==="3X8"){
    // Valeurs explicites d'une version 3×8 existante conservées ; celles calculées par ATLAS sont recalculées.
    const derived=new Set([...(c.derived||[]),"derived","shifts","anchor","regime","timezone"]);
    f.base3x8=Object.fromEntries(Object.entries(c).filter(([k])=>!derived.has(k)));
    f.daysPerPosition=c.days_per_position;f.shifts=c.shifts.map(s=>[s.start,s.end]);f.staffMatin=c.required_staff.MATIN;f.staffAm=c.required_staff.APRES_MIDI;f.staffNight=c.required_staff.NUIT}
  else{f.staffDay=c.required_staff.JOUR;f.staffNight=c.required_staff.NUIT}
  if(c.day_start)Object.assign(f,{dayStart:c.day_start,dayEnd:c.day_end,nightShiftStart:c.night_shift_start,nightShiftEnd:c.night_shift_end});
  if(c.first_start)f.firstStart=c.first_start;
  return f;
}
function rotTime(key,label){return `<label class="rot-field">${rotEsc(label)}<input type="time" data-f="${key}" value="${rotEsc(rotState.form[key])}" required></label>`}
function rotNum(key,label,min=0,max=10080){return `<label class="rot-field">${rotEsc(label)}<input type="number" min="${min}" max="${max}" data-f="${key}" value="${rotEsc(rotState.form[key])}" required></label>`}
function rotWeekStartField(){
  const f=rotState.form;
  return `<label class="rot-field">Début de semaine<select data-f="weekStart" required><option value="" ${f.weekStart===""?"selected":""}>À définir</option>${ROT_DAY_NAMES.map((d,i)=>`<option value="${i}" ${String(f.weekStart)===String(i)?"selected":""}>${d}</option>`).join("")}</select></label>`;
}
function rotRegimeFields(){
  const f=rotState.form,r=f.regime;
  const night=rotWeekStartField()+rotTime("nightStart","Début travail de nuit")+rotTime("nightEnd","Fin travail de nuit");
  if(r==="3X8")return `<label class="rot-field">Date de début du cycle<input type="date" data-f="anchor" value="${rotEsc(f.anchor)}" required></label>
    ${["Matin","Après-midi","Nuit"].map((n,i)=>`<label class="rot-field">${n} — début<input type="time" data-shift="${i}:0" value="${rotEsc(f.shifts[i][0])}" required></label><label class="rot-field">${n} — fin<input type="time" data-shift="${i}:1" value="${rotEsc(f.shifts[i][1])}" required></label>`).join("")}`;
  if(r==="1/2")return `<label class="rot-field">Date de début du cycle<input type="date" data-f="anchor" value="${rotEsc(f.anchor)}" required></label>${rotTime("firstStart","Début de la première vacation (12 h)")}${night}`;
  return `<label class="rot-field">Date de début du cycle<input type="date" data-f="anchor" value="${rotEsc(f.anchor)}" required></label>
    ${rotTime("dayStart","Heure début service jour")}${rotTime("dayEnd","Heure fin service jour")}${rotTime("nightShiftStart","Heure début service nuit")}${rotTime("nightShiftEnd","Heure fin service nuit")}${night}`;
}
function rotGroupCard(g){
  const f=rotState.form,r=f.regime,span=(a,b)=>a&&b?`${a} – ${b}`:"horaires à définir",day=span(f.dayStart,f.dayEnd),night=span(f.nightShiftStart,f.nightShiftEnd);
  const ws=f.weekStart===""?null:Number(f.weekStart),workdays=f.workdays.length?rotDaysLabel(f.workdays,ws):"à définir";
  let items;
  if(r==="1/3"&&g==="A")items=[["☀",`Jours ouvrés uniquement (${workdays})`],["✓",`Service de jour (${day})`],["✗","Aucun service de nuit"],["✗","Pas de week-end"],["✗","Pas de jours fériés"]];
  else if(r==="1/3")items=[["⟳","Rotation de nuit continue"],["☾",`Nuit (${night})`],["▦","Inclut week-ends (remplacement de jour)"],["▦","Inclut jours fériés"],["⏱","Couverture de remplacement selon repos"]];
  else if(r==="24H48")items=[["☀",`Jour (${day})`],["☾",`Nuit (${night})`],["○","OFF puis OFF"],["⟳","Cycle de 4 jours"]];
  else if(r==="1/2")items=[["⟳","Vacations de 12 h en alternance"],["☀",`Début de cycle à ${f.firstStart}`],["▦","Inclut week-ends et jours fériés"]];
  else{const pos=rotPositions(),at=pos&&pos.groups[g];
    items=[["⟳","Matin → Après-midi → Nuit → OFF"],["◉",!pos?"Position calculée dès la saisie des horaires":at?`Au ${pos.label} : ${at.label} (${at.start} – ${at.end})`:`Au ${pos.label} : OFF (repos)`],
      ["▦","7 j/7, jours fériés compris"],["○","Une position par jour ; le groupe OFF change chaque jour"]]}
  return `<div class="rot-group rot-${g}"><h3><span class="rot-badge">${g}</span>Groupe ${g}</h3><ul>${items.map(([i,t])=>`<li><i style="color:${i==="✗"?"#dc2626":i==="✓"?"#16a34a":"var(--g)"}">${i}</i><span>${rotEsc(t)}</span></li>`).join("")}</ul>
    ${r==="3X8"?"":`<label>Position dans le cycle<input type="number" data-phase="${g}" value="${rotEsc(f.phases[g])}" required></label>`}</div>`;
}
// Position de chaque groupe calculée par le serveur (aperçu) : aujourd'hui si le mois affiché le contient, sinon le 1er jour.
function rotPositions(){
  const p=rotState.preview;if(!p||p.pending||p.error||!p.days)return null;
  const today=new Date().toISOString().slice(0,10),days=p.days.filter(d=>d.configured);if(!days.length)return null;
  const day=days.find(d=>d.date===today)||days[0];
  return {label:day.date.split("-").reverse().slice(0,2).join("/"),groups:Object.fromEntries(day.slots.filter(x=>x.group).map(x=>[x.group,x]))};
}
function rot3x8Computed(){
  const c=rotState.preview?.config;
  if(!c||c.regime!=="3X8")return "Paramètres complétés par ATLAS à l'enregistrement";
  const staff=c.required_staff||{},n=Math.min(staff.MATIN,staff.APRES_MIDI,staff.NUIT);
  return `Calculé par ATLAS : repos minimal ${Math.round(c.minimum_rest_minutes/60*10)/10} h, avance ${c.early_minutes} min, refus du retard après ${c.late_refusal_minutes} min, ${n} agent(s) requis par vacation`;
}
function rotRules(){
  const r=rotState.form.regime;
  const common=["Retard calculé automatiquement","Pointage manuel conserve le retard","Maintenu = présent (Maintenu)","Sortie anticipée et abandon de poste traités séparément"];
  const specific={"1/3":["Groupe A : jour ouvré seulement, jamais nuit, week-end ni férié","B/C/D : nuit continue, sans remise à zéro mensuelle","Remplacement de A selon disponibilité et repos","Aucun groupe disponible : VACATION NON COUVERTE","Effectif insuffisant : SOUS-EFFECTIF"],
    "3X8":["4 groupes, 3 vacations, 1 groupe OFF","Trois vacations de 8 h contiguës, nuit à cheval sur minuit","Positions A/B/C/D calculées depuis la date de début du cycle",rot3x8Computed()],"24H48":["Jour puis Nuit, suivis de deux jours OFF","Jour et Nuit couvrent 24 h sans trou"],"1/2":["Vacations de 12 h en alternance des groupes"]}[r]||[];
  return `<aside class="rot-rules" aria-label="Règles"><h3><span style="color:#1d4ed8">${rotIcon("info")}</span>Règles</h3><ul>${[...common,...specific].map(t=>`<li>${rotEsc(t)}</li>`).join("")}</ul></aside>`;
}
function rotPreviewGrid(month,data){
  if(!data)return `<p class="text-sm text-slate-500">Choisissez un site et complétez les paramètres : l'aperçu du cycle est calculé par le serveur.</p>`;
  if(data.pending)return `<p class="text-sm text-slate-600" role="status">${rotEsc(data.pending)}</p>`;
  if(data.error)return `<p class="rot-status is-error" role="alert">${rotEsc(data.error)}</p>`;
  return rotCalendar(data,{compact:true});
}
function rotCalendar(data,{compact}={}){
  const days=data.days||[];if(!days.length)return "";
  const start=Number.isInteger(data.calendar?.week_start)?data.calendar.week_start:0,first=(days[0].weekday-start+7)%7,today=new Date().toISOString().slice(0,10);
  const cells=Array.from({length:first},()=>`<div class="rot-day is-empty"></div>`);
  for(const d of days){
    const crit=d.critical.length?`<span class="rot-crit" title="${rotEsc(d.critical.map(c=>c.label).join(", "))}">⚠ ${d.critical.length}</span>`:"";
    const tag=d.holiday?"<em>Férié</em>":d.weekend?"<em>WE</em>":"";
    // Libellé court dans la case (trois vacations en 3×8) ; libellé complet en info-bulle.
    const rows=d.configured?d.slots.map(s=>`<div class="rot-day-row" title="${rotEsc(s.label)} ${rotEsc(s.start||"")} – ${rotEsc(s.end||"")}"><span>${rotEsc(ROT_SHORT_LABELS[s.label]||s.label)} :</span>${s.group?rotChip(s.group):'<span class="rot-chip rot-off" style="color:#b91c1c">—</span>'}</div>`).join("")
      +(d.off_groups.length&&!compact?`<div class="rot-day-off" title="Groupes au repos">OFF ${d.off_groups.join(" · ")}</div>`:""):`<span class="text-xs text-slate-400">Non planifié</span>`;
    cells.push(`<div class="rot-day${d.weekend?" is-weekend":""}${d.date===today?" is-today":""}"><div class="rot-day-num">${Number(d.date.slice(8))} ${tag}${crit}</div>${rows}</div>`);
  }
  while(cells.length%7)cells.push(`<div class="rot-day is-empty"></div>`);
  return `<div class="rot-cal" role="grid" aria-label="Calendrier ${rotEsc(rotMonthLabel(data.month))}">${rotWeekOrder(start).map(d=>`<div class="rot-dow" role="columnheader">${ROT_DAYS[d]}</div>`).join("")}${cells.join("")}</div>`;
}
function rotLegend(){return `<div class="rot-legend">${ROT_GROUPS.map(g=>`<span class="rot-${g}"><i></i>Groupe ${g}</span>`).join("")}<span style="--g:#cbd5e1"><i></i>Repos / Non planifié</span></div>`}
function rotRenderConfig(){
  const s=rotState,f=s.form,o=s.overview||{},view=s.view;
  const site=s.sites.find(x=>x.id===s.siteId);
  const regimeButtons=ROT_REGIMES.map(([k,l])=>`<button type="button" data-regime="${k}" aria-pressed="${f.regime===k}" ${k==="NORMAL"||k==="CUSTOM"?'disabled title="Extension prévue : non publiable"':""}>${l}</button>`).join("");
  const staff=f.regime==="3X8"?rotNum("staffMatin","Effectif requis — matin",1,999)+rotNum("staffAm","Effectif requis — après-midi",1,999)+rotNum("staffNight","Effectif requis — nuit",1,999)
    :rotNum("staffDay","Effectif requis — jour",1,999)+rotNum("staffNight","Effectif requis — nuit",1,999);
  view.innerHTML=`<section class="rot-page" id="rotConfig">${rotHeader("Configuration du régime du site")}
  <div class="rot-kpis">${rotKpi("sites","blue","Sites actifs",o.active_sites,"dans votre périmètre")}${rotKpi("calendar","green","Régimes actifs",o.active_regimes,"publiés à ce jour")}${rotKpi("alert","red","Points critiques",o.critical_points,"ouverts")}${rotKpi("doc","orange","Rotations à valider",o.drafts_to_validate,"brouillons non publiés")}</div>
  <div class="rot-card"><h2>Paramètres du régime</h2>
    <div class="rot-row">${rotSiteSelects()}<div class="rot-field">Type de rotation<div class="rot-seg" role="group" aria-label="Type de rotation">${regimeButtons}</div></div></div>
    <div class="rot-fields" style="margin-top:14px">${rotRegimeFields()}</div>
  </div>
  <div class="rot-groups-wrap"><div class="rot-card"><h2>Groupes et logique de rotation</h2><div class="rot-groups">${ROT_GROUPS.map(rotGroupCard).join("")}</div></div>${rotRules()}</div>
  <details class="rot-card" ${s.advancedOpen?"open":""} data-advanced><summary style="cursor:pointer;font-weight:900;color:#0b1f44">${f.regime==="3X8"?"Date d'effet et motif":"Application, effectifs et calendrier officiel"}</summary>
    <div class="rot-fields" style="margin-top:14px"><label class="rot-field">Date d'effet de la publication<input type="date" data-f="effective" value="${rotEsc(f.effective)}" required></label>
    ${f.regime==="3X8"?"":`${rotNum("rest","Repos minimal (minutes)")}${rotNum("early","Avance autorisée (minutes)")}${rotNum("late","Refus du retard après (minutes)",1)}${staff}
    <fieldset class="rot-field rot-span2"><legend>Jours ouvrés</legend><div style="display:flex;flex-wrap:wrap;gap:10px">${rotWeekOrder(f.weekStart===""?0:Number(f.weekStart)).map(i=>`<label style="display:inline-flex;gap:4px;align-items:center;font-weight:600"><input type="checkbox" data-workday="${i}" ${f.workdays.map(Number).includes(i)?"checked":""}>${ROT_DAYS[i]}</label>`).join("")}</div></fieldset>
    <label class="rot-field rot-span2">Jours fériés validés (AAAA-MM-JJ, un par ligne)<textarea rows="2" data-f="holidays">${rotEsc(f.holidays)}</textarea></label>
    <label class="rot-field">Référence du calendrier<input data-f="calendarSource" value="${rotEsc(f.calendarSource)}" required></label><label class="rot-field">Version du calendrier<input data-f="calendarVersion" value="${rotEsc(f.calendarVersion)}" required></label>
    <label class="rot-field">Calendrier confirmé du<input type="date" data-f="calendarFrom" value="${rotEsc(f.calendarFrom)}" required></label><label class="rot-field">au<input type="date" data-f="calendarUntil" value="${rotEsc(f.calendarUntil)}" required></label>
    `}<label class="rot-field rot-span2">${f.regime==="3X8"?"Motif (facultatif)":"Motif de la configuration"}<input data-f="reason" value="${rotEsc(f.reason)}" minlength="3" placeholder="${f.regime==="3X8"?"Par défaut : configuration 3×8 — planning intelligent ATLAS":"Obligatoire pour enregistrer"}"></label></div></details>
  <div class="rot-card"><div class="rot-cal-head"><h2>Aperçu du cycle — ${rotEsc(rotMonthLabel(s.month))}</h2>${rotLegend()}<div class="rot-nav"><button type="button" data-month="-1" aria-label="Mois précédent">‹</button><span>${rotEsc(rotMonthLabel(s.month))}</span><button type="button" data-month="1" aria-label="Mois suivant">›</button></div></div>
    <div id="rotPreview">${rotPreviewGrid(s.month,s.preview)}</div></div>
  <div class="rot-card" style="display:grid;gap:10px"><p id="rotStatus" class="rot-status ${s.error?"is-error":"is-ok"}" role="status">${rotEsc(s.status|| (site?`Site : ${site.name}${site.regime?` — régime publié ${site.regime} v${site.version}`:" — aucun régime publié"}`:"Choisissez un site."))}</p>
    ${s.simulation?`<ul class="rot-errors">${(s.simulation.errors||[]).slice(0,12).map(e=>`<li>${rotEsc(e.label||e.code)}${e.employee?` — ${rotEsc(e.employee)}`:""} ${rotEsc(e.slot?.work_date||e.date||"")}</li>`).join("")}</ul>`:""}
    <div class="rot-actions"><button type="button" class="rot-btn" data-save ${s.busy||!s.siteId?"disabled":""}>Enregistrer</button><button type="button" class="rot-btn is-ghost" data-simulate ${s.busy||!s.draft?"disabled":""}>Simuler</button><button type="button" class="rot-btn" data-publish ${s.busy||!s.receipt?"disabled":""}>Publier</button><button type="button" class="rot-btn is-muted" data-cancel ${s.busy?"disabled":""}>Annuler</button></div></div>
  </section>`;
  rotBindConfig(view);
}
function rotBindConfig(view){
  const s=rotState,root=view.querySelector("#rotConfig");
  rotBindSiteSelects(root,()=>{rotResetDraft();rotLoadSiteConfig()});
  root.querySelectorAll("[data-regime]").forEach(b=>b.onclick=()=>{if(b.disabled)return;const keep=s.form;s.form={...rotDefaultForm(b.dataset.regime),effective:keep.effective,reason:keep.reason,anchor:keep.anchor,weekStart:keep.weekStart,workdays:keep.workdays,
    holidays:keep.holidays,calendarSource:keep.calendarSource,calendarVersion:keep.calendarVersion,calendarFrom:keep.calendarFrom,calendarUntil:keep.calendarUntil,nightStart:keep.nightStart,nightEnd:keep.nightEnd};if(b.dataset.regime==="3X8"&&s.form.anchor)s.month=s.form.anchor.slice(0,7);rotResetDraft();rotRenderConfig();rotRefreshPreview()});
  // Toute modification invalide le brouillon et le reçu : Simuler et Publier redeviennent indisponibles.
  const change=()=>{const had=s.draft||s.receipt;rotResetDraft();root.querySelector("[data-simulate]").disabled=true;root.querySelector("[data-publish]").disabled=true;
    root.querySelector(".rot-errors")?.remove();if(had){const st=root.querySelector("#rotStatus");st.className="rot-status is-error";st.textContent="Paramètres modifiés : enregistrez un nouveau brouillon puis simulez avant publication."}rotRefreshPreview(true)};
  root.querySelectorAll("[data-f]").forEach(i=>i.addEventListener("change",()=>{s.form[i.dataset.f]=i.value;
    // 3×8 : la date d'effet suit la date de début du cycle tant qu'OPS ne l'a pas changée.
    if(i.dataset.f==="effective")s.form.effectiveTouched=true;
    if(i.dataset.f==="anchor"&&s.form.regime==="3X8"&&!s.form.effectiveTouched){s.form.effective=i.value;const e=root.querySelector('[data-f="effective"]');if(e)e.value=i.value}
    // 3×8 : l'aperçu s'ouvre sur le mois de début du cycle.
    if(i.dataset.f==="anchor"&&s.form.regime==="3X8"&&i.value){s.month=i.value.slice(0,7);change();rotRenderConfig();return}
    change();if(["weekStart","dayStart","dayEnd","nightShiftStart","nightShiftEnd"].includes(i.dataset.f))rotRenderConfig()}));
  root.querySelectorAll("[data-shift]").forEach(i=>i.addEventListener("change",()=>{const [a,b]=i.dataset.shift.split(":").map(Number);s.form.shifts[a][b]=i.value;change()}));
  root.querySelectorAll("[data-phase]").forEach(i=>i.addEventListener("change",()=>{s.form.phases[i.dataset.phase]=Number(i.value);change()}));
  root.querySelectorAll("[data-workday]").forEach(i=>i.addEventListener("change",()=>{const n=Number(i.dataset.workday);s.form.workdays=i.checked?[...new Set([...s.form.workdays,n])]:s.form.workdays.filter(x=>Number(x)!==n);change();rotRenderConfig()}));
  root.querySelector("[data-advanced]").addEventListener("toggle",e=>{s.advancedOpen=e.target.open});
  root.querySelectorAll("[data-month]").forEach(b=>b.onclick=()=>{s.month=rotShiftMonth(s.month,Number(b.dataset.month));rotRenderConfig();rotRefreshPreview()});
  root.querySelector("[data-save]").onclick=()=>rotPerform(async()=>{
    const missing=rotMissing();if(missing.length){if(missing.includes("jours ouvrés"))s.advancedOpen=true;throw Error("À renseigner explicitement : "+missing.join(", ")+".")}
    if(s.form.regime==="3X8"&&!String(s.form.reason||"").trim())s.form.reason="Configuration 3×8 — planning intelligent ATLAS";
    if(String(s.form.reason||"").trim().length<3){s.advancedOpen=true;throw Error("Motif de la configuration obligatoire (section Application, effectifs et calendrier officiel).")}
    s.draft=await rotApi(`/sites/${encodeURIComponent(s.siteId)}/drafts`,{method:"POST",body:{config:rotConfig(),effective_from:s.form.effective,reason:s.form.reason}});
    s.status="Brouillon enregistré. Une simulation valide est obligatoire avant publication.";s.overview=await rotApi("/overview");
  });
  root.querySelector("[data-simulate]").onclick=()=>rotPerform(async()=>{
    const result=await rotApi(`/drafts/${s.draft.id}/simulate`,{method:"POST",body:{days:30}});
    s.simulation=result;s.receipt=result.valid?result.context_hash:null;
    s.status=result.valid?(s.form.regime==="3X8"?"Planning généré par ATLAS et simulé sur 30 jours : contrôlez le calendrier, puis publiez.":"Simulation valide sur 30 jours : publication autorisée selon vos habilitations."):`${result.errors.length} point(s) bloquant(s) : publication interdite.`;s.error=!result.valid;
  });
  root.querySelector("[data-publish]").onclick=()=>rotPerform(async()=>{
    if(!confirm(`Publier ce régime à compter du ${s.form.effective} ? Le planning officiel du site changera à cette date.`))return;
    const published=await rotApi(`/drafts/${s.draft.id}/publish`,{method:"POST",body:{context_hash:s.receipt}});
    rotResetDraft();s.status=`Planning officiel version ${published.version} publié à compter du ${published.effective_from}.`;
    const [sites,overview]=await Promise.all([rotApi("/sites"),rotApi("/overview")]);s.sites=sites.items||[];s.overview=overview;
  });
  root.querySelector("[data-cancel]").onclick=()=>{rotResetDraft();rotLoadSiteConfig()};
}
function rotResetDraft(){Object.assign(rotState,{draft:null,receipt:null,simulation:null,status:"",error:false})}
async function rotPerform(task){
  const s=rotState;if(s.busy)return;s.busy=true;s.error=false;rotRenderConfig();
  try{await task()}catch(e){s.error=true;s.status=e.message||"Opération refusée"}finally{s.busy=false;if(s.view.isConnected){rotRenderConfig();rotRefreshPreview()}}
}
async function rotLoadSiteConfig(){
  const s=rotState;
  if(s.siteId){
    try{const history=await rotApi(`/sites/${encodeURIComponent(s.siteId)}/history`);const last=(history.items||[]).slice(-1)[0];
      s.form=last?rotFormFromConfig(last.config,rotNextMonthFirst(),""):rotDefaultForm(s.form.regime);
      if(!last)s.advancedOpen=true;
      s.status=last?`Paramètres de la version ${last.version} publiée chargés : toute modification crée un nouveau brouillon.`:"Nouvelle configuration : horaires, début de semaine et jours ouvrés à définir explicitement.";}catch(e){s.status=e.message;s.error=true}
  }
  rotRenderConfig();rotRefreshPreview();
}
let rotPreviewTimer=0,rotPreviewTicket=0;
function rotRefreshPreview(debounce){
  clearTimeout(rotPreviewTimer);
  rotPreviewTimer=setTimeout(async()=>{
    const s=rotState,ticket=++rotPreviewTicket;if(!s||s.mode!=="configuration")return;
    const missing=rotMissing();
    if(missing.length)s.preview={pending:"Aperçu calculé par le serveur dès que ces paramètres sont renseignés : "+missing.join(", ")+"."};
    else try{s.preview=await rotApi("/preview",{method:"POST",body:{site_id:s.siteId,month:s.month,config:rotConfig()}})}
    catch(e){s.preview={error:e.message||"Aperçu indisponible"}}
    if(ticket!==rotPreviewTicket||!s.view.isConnected)return;
    const host=s.view.querySelector("#rotPreview");if(host)host.innerHTML=rotPreviewGrid(s.month,s.preview);
    if(s.form.regime==="3X8"){const groups=s.view.querySelector(".rot-groups"),rules=s.view.querySelector(".rot-rules");
      if(groups)groups.innerHTML=ROT_GROUPS.map(rotGroupCard).join("");if(rules)rules.outerHTML=rotRules()}
  },debounce?350:0);
}

// ── Planning mensuel publié ────────────────────────────────────────────────────────────────
async function rotLoadPlanning(){
  const s=rotState;
  s.planning=s.siteId?await rotApi(`/sites/${encodeURIComponent(s.siteId)}/month?month=${encodeURIComponent(s.month)}`).catch(e=>({error:e.message})):null;
  if(s.view.isConnected)rotRenderPlanning();
}
function rotRenderPlanning(){
  const s=rotState,p=s.planning,view=s.view,k=p&&!p.error?p.kpis:{};
  const site=s.sites.find(x=>x.id===s.siteId),regime=p&&p.regime;
  const seg=ROT_REGIMES.slice(0,4).map(([key,l])=>`<button type="button" aria-pressed="${regime===key}" disabled title="${regime===key?"Régime publié":"Régime non publié pour ce site"}">${l}</button>`).join("");
  const sum=p&&!p.error?p.summary:null;
  const summary=sum?`<aside class="rot-card rot-summary" aria-label="Résumé du cycle"><h2>Résumé du cycle</h2>
    <h3>Légende des groupes</h3><ul>${ROT_GROUPS.map(g=>`<li style="justify-content:flex-start">${rotChip(g)}<span>Groupe ${g} — ${rotEsc(sum.roles[g]||"")}</span></li>`).join("")}<li style="justify-content:flex-start"><span class="rot-chip rot-off">OFF</span><span>Repos / Non planifié</span></li></ul>
    <h3>Cycle</h3><ul><li><span>Régime</span><b>${rotEsc(p.regime_label||"—")}</b></li><li><span>Version publiée</span><b>${rotEsc(p.versions.map(v=>"v"+v).join(", ")||"—")}</b></li><li><span>Période</span><b>${rotEsc(p.period.start.split("-").reverse().join("/"))} – ${rotEsc(p.period.end.split("-").reverse().join("/"))}</b></li>${p.regime==="3X8"?`<li><span>Exploitation</span><b>7 j/7, jours fériés compris</b></li>`:p.calendar?`<li><span>Début de semaine</span><b>${rotEsc(ROT_DAY_NAMES[p.calendar.week_start])}</b></li><li><span>Jours ouvrés</span><b>${rotEsc(rotDaysLabel(p.calendar.workdays,p.calendar.week_start))}</b></li>`:""}${(sum.timings||[]).map(t=>`<li><span>${rotEsc(t.shift)}</span><b>${rotEsc(t.start)} – ${rotEsc(t.end)}</b></li>`).join("")}<li><span>Repos minimal</span><b>${sum.minimum_rest_minutes!=null?Math.round(sum.minimum_rest_minutes/60*10)/10+" h":"—"}</b></li><li><span>Conflits de repos</span><b>${rotEsc(sum.conflicts)}</b></li></ul>
    <h3>Couverture du mois</h3><ul><li><span>Vacations jour (total)</span><b>${rotEsc(sum.coverage.day_staff_total)}</b></li><li><span>Vacations nuit (total)</span><b>${rotEsc(sum.coverage.night_staff_total)}</b></li>${sum.coverage.a_days?`<li><span>Jours avec présence A (jours ouvrés)</span><b>${sum.coverage.a_days[0]} / ${sum.coverage.a_days[1]}</b></li>`:""}${p.regime==="3X8"?"":`<li><span>Jours de week-end couverts</span><b>${sum.coverage.weekends[0]} / ${sum.coverage.weekends[1]}</b></li><li><span>Jours fériés couverts</span><b>${sum.coverage.holidays[0]} / ${sum.coverage.holidays[1]}</b></li>`}</ul>
    <h3>Règles et contrôles</h3><ul>${sum.rules.map(r=>`<li style="justify-content:flex-start"><span class="${r.ok?"ok":"ko"}"></span>${rotEsc(r.label)}</li>`).join("")}</ul></aside>`:"";
  const body=!s.siteId?`<p class="text-sm text-slate-500">Choisissez un site pour afficher son planning officiel.</p>`:p?.error?`<p class="rot-status is-error" role="alert">${rotEsc(p.error)}</p>`:!p?.configured?`<p class="text-sm text-slate-600">Aucun régime publié pour ce site sur ce mois : le planning historique reste en vigueur. Configurez puis publiez un régime depuis « Configuration du régime ».</p>`:rotCalendar(p);
  const table=p&&p.configured&&s.showTable?`<div class="rot-table" style="margin-top:12px"><table><thead><tr><th>Date</th><th>Vacation</th><th>Groupe</th><th>Horaires</th><th>Effectif planifié / requis</th><th>Points critiques</th></tr></thead><tbody>${p.days.flatMap(d=>d.slots.map(x=>`<tr><td>${rotEsc(d.date.split("-").reverse().join("/"))}</td><td>${rotEsc(x.label)}</td><td>${x.group?rotChip(x.group):"NON COUVERTE"}</td><td>${rotEsc(x.start)} – ${rotEsc(x.end)}</td><td>${rotEsc(x.planned_staff)} / ${rotEsc(x.required_staff)}</td><td>${rotEsc(d.critical.filter(c=>!c.shift||c.shift===x.shift).map(c=>c.label).join(", "))}</td></tr>`)).join("")}</tbody></table></div>`:"";
  view.innerHTML=`<section class="rot-page" id="rotPlanning">${rotHeader(`Planning des rotations — ${rotMonthLabel(s.month)}`)}
  <div class="rot-kpis">${rotKpi("people","blue","Effectif planifié",k.planned_staff,"employés sur le mois")}${rotKpi("sun","yellow","Vacations jour",k.day_average,"agents par jour en moyenne")}${rotKpi("moon","violet","Vacations nuit",k.night_average,"agents par nuit en moyenne")}${rotKpi("alert","red","Points critiques",k.critical_points,"sur ce mois")}</div>
  <div class="rot-card"><div class="rot-row has-month">${rotSiteSelects()}<div class="rot-field">Type de rotation<div class="rot-seg" role="group" aria-label="Régime publié">${seg}</div></div><label class="rot-field">Mois<input type="month" data-rot="month" value="${rotEsc(s.month)}"></label></div></div>
  <div class="rot-plan"><div class="rot-card"><div class="rot-cal-head"><h2>Calendrier des rotations</h2><div class="rot-nav"><button type="button" data-month="-1" aria-label="Mois précédent">‹</button><span>${rotEsc(rotMonthLabel(s.month))}</span><button type="button" data-month="1" aria-label="Mois suivant">›</button><button type="button" data-today>Aujourd'hui</button></div></div>${rotLegend()}<div style="margin-top:10px">${body}</div>
    ${p&&p.configured?`<button type="button" class="rot-tab" style="margin-top:12px" data-table>${s.showTable?"Masquer":"Afficher"} la vue détaillée</button>${table}`:""}</div>${summary}</div>
  <div class="rot-actions"><button type="button" class="rot-btn is-ghost" data-go-config>Simuler</button><button type="button" class="rot-btn" data-go-config>Publier</button><button type="button" class="rot-btn is-ghost" data-history ${s.siteId?"":"disabled"}>Historique</button></div>
  <div id="rotHistory"></div></section>`;
  const root=view.querySelector("#rotPlanning");
  rotBindSiteSelects(root,rotLoadPlanning);
  root.querySelector('[data-rot="month"]').onchange=e=>{if(e.target.value){s.month=e.target.value;rotLoadPlanning()}};
  root.querySelectorAll("[data-month]").forEach(b=>b.onclick=()=>{s.month=rotShiftMonth(s.month,Number(b.dataset.month));rotLoadPlanning()});
  root.querySelector("[data-today]").onclick=()=>{s.month=rotThisMonth();rotLoadPlanning()};
  root.querySelector("[data-table]")?.addEventListener("click",()=>{s.showTable=!s.showTable;rotRenderPlanning()});
  root.querySelectorAll("[data-go-config]").forEach(b=>b.onclick=()=>{location.hash="#/ops/rotations"});
  root.querySelector("[data-history]").onclick=async()=>{
    try{const h=await rotApi(`/sites/${encodeURIComponent(s.siteId)}/history`);
      root.querySelector("#rotHistory").innerHTML=`<div class="rot-card"><h2>Historique des publications — ${rotEsc(site?.name||"")}</h2>${(h.items||[]).length?`<div class="rot-table"><table><thead><tr><th>Version</th><th>Régime</th><th>Semaine du site</th><th>Période</th><th>Publié par</th><th>Motif</th></tr></thead><tbody>${h.items.map(x=>`<tr><td>v${rotEsc(x.version)}</td><td>${rotEsc(x.config.regime)}</td><td>${Number.isInteger(x.config.week_start)?`Début ${rotEsc(ROT_DAY_NAMES[x.config.week_start].toLowerCase())} · ouvrés ${rotEsc(rotDaysLabel(x.config.workdays||[],x.config.week_start))}`:"—"}</td><td>${rotEsc(x.effective_from)} → ${rotEsc(x.effective_to||"sans fin")}</td><td>${rotEsc(x.published_by)}</td><td>${rotEsc(x.reason)}</td></tr>`).join("")}</tbody></table></div>`:"<p class='text-sm text-slate-500'>Aucune publication pour ce site.</p>"}</div>`;}
    catch(e){toast(e.message||String(e),"error")}
  };
}
SGDIModules.registerModule({key:"ops-rotations",routes:[]});
