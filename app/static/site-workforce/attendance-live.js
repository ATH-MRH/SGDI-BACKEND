/* BEO supervision: server-owned facts, no attendance writes or local persistence. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = value => value ? new Date(value).toLocaleTimeString('fr-FR', {timeZone:'Africa/Algiers'}) : '—';
  const labels = {ARRIVAL:'ENTRÉE', DEPARTURE:'SORTIE', recorded:'ENREGISTRÉ', anomaly:'ANOMALIE', FACIAL:'FACIAL', MANUAL:'MANUEL', QR:'QR', PORTAL_GPS:'PORTAIL GPS', POINTEUR:'POINTEUR', SITE_WORKFORCE:'BEO', IMPORT:'IMPORT', SYSTEM:'SYSTÈME'};
  window.BeoAttendanceLive = {mount(host, SW) {
    const epoch = SW.state.scopeEpoch;
    let alive=true, timer, clock, debounce, controller, busy=false, queued=false, generation=0, lastSync=0, latestEvent=0, failed=false, cursor=null, result=null;
    let filters={}, nodes=new Map(), initialized=false, stopPhotos, history=false;
    const root=document.createElement('section');root.className='beo-live';root.setAttribute('aria-label','Pointage en temps réel');
    root.innerHTML=`<div class="beo-live-kpis" aria-label="Filtres temps réel"></div><section class="aw-card"><header class="aw-toolbar"><div><h2>Pointage en temps réel</h2><p>Aujourd’hui · Africa/Algiers</p></div><div><b class="beo-live-state" role="status">Connexion…</b><p class="beo-live-sync">Dernière synchronisation : —</p></div></header>
      <div class="beo-live-filters"><select data-filter="society" aria-label="Structure"><option value="">Toutes les structures</option></select><select data-filter="site_id" aria-label="Site"><option value="">Tous les sites</option></select><select data-filter="group" aria-label="Groupe"><option value="">Tous les groupes</option></select><select data-filter="movement" aria-label="Type"><option value="">Tous les mouvements</option><option value="ARRIVAL">Entrée</option><option value="DEPARTURE">Sortie</option></select><select data-filter="event_status" aria-label="Validation"><option value="">Tous les états</option><option value="recorded">Enregistré sans anomalie ouverte</option><option value="anomaly">Anomalie ouverte</option></select><select data-filter="method" aria-label="Méthode"><option value="">Toutes les méthodes</option></select><input data-filter="q" type="search" aria-label="Recherche agent" placeholder="Nom, prénom, code, poste…"></div>
      <div class="beo-live-shortcuts" aria-label="Raccourcis groupe"></div><p class="beo-live-error" role="alert"></p><div class="beo-live-rows" aria-live="polite"></div><p class="beo-live-empty">Chargement du flux…</p><button class="beo-live-more" hidden>Afficher plus</button></section><dialog class="beo-live-detail"><button data-close>Détail · Fermer</button><div class="beo-live-detail-body"></div></dialog>`;
    host.appendChild(root);
    const $=s=>root.querySelector(s);
    const valid=()=>alive && root.isConnected && SW.state.scopeEpoch===epoch;
    function state() {
      if(!valid()) {destroy();return;}
      const age=lastSync ? Date.now()-lastSync : Infinity;
      const offline=navigator.onLine===false;
      const freshEvent=latestEvent && Date.now()-latestEvent < 60000;
      const text=offline?'Connexion interrompue':!lastSync&&!failed?'Synchronisation…':failed||age>30000?'Flux indisponible':age>15000?'Synchronisation en retard':freshEvent?'● EN DIRECT':'Synchronisé · aucun passage récent';
      $('.beo-live-state').textContent=text;
      $('.beo-live-state').dataset.state=!lastSync&&!failed&&!offline?'idle':offline||failed||age>30000?'error':age>15000?'warning':freshEvent?'live':'idle';
      $('.beo-live-sync').textContent=`Dernière synchronisation : ${time(lastSync)}`;
    }
    function avatar(e) {
      const initials=[e.nom,e.prenom].filter(Boolean).map(s=>s[0]).join('')||'•';
      // Display URLs only; never place data supplied by the server into executable attributes.
      const photo=String(e.photo_url||'');
      const safe=/^\/api\/site-workforce\/positions\/\d+\/photo(?:\?|$)/.test(photo);
      return `<span class="beo-live-avatar">${esc(initials)}${safe?`<img data-photo-src="${esc(photo)}" hidden alt="">`:''}</span>`;
    }
    function agentHTML(e) {return `${avatar(e)}<span><b>${esc(e.nom)} ${esc(e.prenom)}</b><small>${esc(e.matricule)} · ${esc(e.poste||'—')}</small></span>`;}
    function rowHTML(e) {
      return `<button class="beo-live-agent" data-agent="${e.employee.id}">${agentHTML(e.employee)}</button><span class="beo-live-at">${time(e.occurred_at)}</span><span class="beo-live-context">${esc(e.society)} · ${esc(e.site_name)} · Groupe ${esc(e.group||'—')}</span><span class="beo-live-badges"><b data-movement="${esc(e.movement)}">${esc(labels[e.movement]||e.movement)}</b><b>${esc(labels[e.method]||e.method)}</b><b>${esc(labels[e.status]||e.status)}</b></span>${e.anomalies.map(a=>`<small class="beo-live-anomaly" data-severity="${esc(a.severity)}">${esc(a.message)}</small>`).join('')}<button class="beo-live-open" data-event="${e.id}" aria-label="Détail du passage">Détail →</button>`;
    }
    function options(selector, values) {$(selector).insertAdjacentHTML('beforeend',values.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join(''));}
    function render(data, more) {
      result=data;if(more||!history||data.population)cursor=data.next_before_id;
      if(!initialized) {
        options('[data-filter="society"]',[...new Set(data.filters.sites.map(s=>s.society))].filter(Boolean).map(s=>[s,s]));
        options('[data-filter="site_id"]',data.filters.sites.map(s=>[s.site_id,s.site_name]));
        options('[data-filter="group"]',data.filters.groups.map(s=>[s,s]));
        options('[data-filter="method"]',data.filters.methods.map(s=>[s,labels[s]||s]));
        $('.beo-live-shortcuts').innerHTML=data.filters.groups.map(s=>`<button data-group="${esc(s)}">Groupe ${esc(s)}</button>`).join('');initialized=true;
      }
      const kpis=[['employees','Effectif du périmètre',''],['present_now','Présents actuellement','present_now'],['entries_today','Entrées aujourd’hui','ARRIVAL'],['exits_today','Sorties aujourd’hui','DEPARTURE'],['absent_today','Absents','absent_today'],['late','Retards','late'],['anomalies','Anomalies','anomaly'],['not_clocked','Non pointés','not_clocked']];
      kpis.forEach(([key,label,filter])=>{let b=root.querySelector(`[data-kpi="${key}"]`);if(!b){b=document.createElement('button');b.dataset.kpi=key;b.dataset.value=filter;b.innerHTML=`<b></b><span>${label}</span>`;$('.beo-live-kpis').appendChild(b);}const v=String(data.summary[key]??'—');if(b.firstChild.textContent!==v)b.firstChild.textContent=v;b.setAttribute('aria-pressed',String((filters.population||filters.movement||filters.event_status||'')===filter));});
      const rows=$('.beo-live-rows');
      if(data.population) {
        if(!more){nodes.clear();rows.replaceChildren();}
        data.agents.forEach(e=>{const key=`a${e.id}`;if(nodes.has(key))return;const el=document.createElement('article');el.className='beo-live-row';el.innerHTML=`<button class="beo-live-agent" data-agent="${e.id}">${agentHTML(e)}</button>`;rows.appendChild(el);nodes.set(key,{el,employee:e});});
      } else {
        const keep=new Set(data.events.map(e=>String(e.id)));
        if(!more&&!history)for(const [id,node] of nodes)if(!keep.has(id)){node.el.remove();nodes.delete(id);}

        data.events.forEach(e=>{const key=String(e.id), html=rowHTML(e);let node=nodes.get(key);if(!node){const el=document.createElement('article');el.className='beo-live-row beo-live-new';node={el};nodes.set(key,node);}if(node.html!==html){node.el.innerHTML=html;node.html=html;}node.event=e;node.el.dataset.event=key;});
        const ordered=[...nodes.values()].sort((a,b)=>Date.parse(b.event.occurred_at)-Date.parse(a.event.occurred_at)||b.event.id-a.event.id);
        ordered.slice(200).forEach(n=>{n.el.remove();nodes.delete(String(n.event.id));});
        ordered.slice(0,200).forEach((n,i)=>{if(rows.children[i]!==n.el)rows.insertBefore(n.el,rows.children[i]||null);});
      }
      $('.beo-live-empty').hidden=nodes.size>0;
      $('.beo-live-empty').textContent=data.summary.employees===0?'Aucun agent dans le périmètre sélectionné.':data.population?'Aucun agent pour ce filtre.':'Aucun pointage enregistré pour ce périmètre aujourd’hui.';
      if(nodes.size>=200)cursor=null;
      $('.beo-live-more').hidden=!cursor;
      // Bound local state: polls replace the latest page; history is loaded only on demand.
      latestEvent=data.events.reduce((n,e)=>Math.max(n,Date.parse(e.occurred_at)),0);
      stopPhotos?.();stopPhotos=SW.lazyPhotos?.(root);
    }
    async function load(more=false) {
      clearTimeout(timer);
      if(!valid()){destroy();return;}
      if(navigator.onLine===false||document.hidden){state();return;}
      if(busy){queued=true;return;}
      busy=true;const token=generation;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),15000);
      try {
        const data=await SW.api('/site-workforce/attendance/live',{params:{...filters,...(more&&cursor?{before_id:cursor}:{} )},signal:controller.signal});
        if(!valid()||token!==generation)return;
        failed=false;lastSync=Date.parse(data.generated_at)||Date.now();$('.beo-live-error').textContent='';render(data,more);
      } catch(e) {if(valid()&&token===generation){failed=true;$('.beo-live-error').textContent='Le flux temps réel est temporairement indisponible. La feuille quotidienne reste accessible.';}}
      finally {clearTimeout(timeout);busy=false;controller=null;if(valid()){state();if(queued){queued=false;load();}else timer=setTimeout(load,failed?10000:5000);}else destroy();}
    }
    function reset() {generation++;lastSync=0;latestEvent=0;failed=false;history=false;cursor=null;nodes.clear();$('.beo-live-rows').replaceChildren();$('.beo-live-detail').removeAttribute('open');controller?.abort();controllerDetail.abort();load();}
    function change(e) {if(!e.target.dataset.filter)return;filters[e.target.dataset.filter]=e.target.value;clearTimeout(debounce);if(e.type==='input'){generation++;controller?.abort();debounce=setTimeout(reset,220);}else reset();}
    async function detail(id, event) {
      const token=generation;
      const dialog=$('.beo-live-detail'), body=$('.beo-live-detail-body');body.textContent='Chargement de l’historique du jour…';if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
      try {const data=await SW.api('/site-workforce/attendance/live',{params:{employee_id:id},signal:controllerDetail.signal});if(!valid()||token!==generation)return;body.innerHTML=(data.employee?`<div class="beo-live-agent">${agentHTML(data.employee)}</div>`:'')+(event?`<h3>Passage · ${time(event.occurred_at)}</h3><p>${esc(event.site_name)} · ${esc(event.group)} · ${esc(labels[event.method]||event.method)}${event.terminal?' · '+esc(event.terminal):''}</p>`:'')+`<h3>Historique du jour</h3>`+data.events.map(e=>`<p>${time(e.occurred_at)} — ${esc(labels[e.movement])} — ${esc(labels[e.method]||e.method)} · ${esc(e.site_name)} · ${esc(labels[e.status])}</p>`).join('')+(data.next_before_id?'<p>Historique limité aux 50 derniers passages.</p>':'');stopPhotos?.();stopPhotos=SW.lazyPhotos?.(root);}catch(e){if(valid()&&e.name!=='AbortError')body.textContent='Historique temporairement indisponible.';}
    }
    let controllerDetail=new AbortController();
    function click(e) {const b=e.target.closest('button');if(!b){const event=nodes.get(e.target.closest('.beo-live-row')?.dataset.event)?.event;if(event){controllerDetail.abort();controllerDetail=new AbortController();detail(event.employee.id,event);}return;}
      if(b.dataset.kpi){delete filters.population;delete filters.movement;delete filters.event_status;const v=b.dataset.value;if(['ARRIVAL','DEPARTURE'].includes(v))filters.movement=v;else if(v==='anomaly')filters.event_status=v;else if(v)filters.population=v;root.querySelectorAll('[data-filter]').forEach(el=>el.value=filters[el.dataset.filter]||'');reset();}
      else if(b.dataset.group){filters.group=b.dataset.group;$('[data-filter="group"]').value=filters.group;reset();}
      else if(b.classList.contains('beo-live-more')){history=true;load(true);}
      else if(b.dataset.agent||b.dataset.event){const event=nodes.get(b.dataset.event)?.event;controllerDetail.abort();controllerDetail=new AbortController();detail(Number(b.dataset.agent||event.employee.id),event);}
      else if(b.hasAttribute('data-close')){controllerDetail.abort();const d=$('.beo-live-detail');if(d.close)d.close();else d.removeAttribute('open');}
    }
    function resume() {clearTimeout(timer);if(document.hidden||navigator.onLine===false){controller?.abort();state();}else load();}
    function destroy() {if(!alive)return;alive=false;stopPhotos?.();clearTimeout(timer);clearTimeout(clock);clearTimeout(debounce);controller?.abort();controllerDetail.abort();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',resume);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);nodes.clear();root.remove();}
    function input(e){if(e.target.dataset.filter==='q')change(e);}
    root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);window.addEventListener('offline',resume);
    function watch(){state();if(alive)clock=setTimeout(watch,1000);}watch();load();return destroy;
  }};
})();
