/* Public offers only; the existing candidate application handles accounts and applications. */
(() => {
  const form=document.getElementById('offer-search'),results=document.getElementById('offer-results'),status=document.getElementById('offer-status'),error=document.getElementById('offer-error');
  let page=1,pages=1,sequence=0,controller,detailSequence=0,detailController,selected=null,items=[],favoritesOnly=false;
  const detail=document.getElementById('offer-detail'),workspace=document.querySelector('.offer-workspace');
  let favorites=new Set();try{const values=JSON.parse(localStorage.getItem('iron-web-offer-favorites')||'[]');if(Array.isArray(values))favorites=new Set(values.filter(x=>Number.isSafeInteger(x)&&x>0));}catch{}
  function toggleFavorite(id){favorites.has(id)?favorites.delete(id):favorites.add(id);try{localStorage.setItem('iron-web-offer-favorites',JSON.stringify([...favorites].slice(-200)));}catch{}renderCards();}
  function renderCards(){
    results.replaceChildren();const visible=items.filter(x=>!favoritesOnly||favorites.has(x.id));
    for(const offer of visible){
      const card=element('article',undefined,'offer-card'+(selected===offer.id?' selected':''));
      const save=element('button',favorites.has(offer.id)?'♥':'♡','bookmark');save.type='button';save.setAttribute('aria-label',(favorites.has(offer.id)?'Retirer des':'Ajouter aux')+' favoris : '+offer.title);save.setAttribute('aria-pressed',String(favorites.has(offer.id)));save.addEventListener('click',()=>toggleFavorite(offer.id));card.append(save);
      card.append(element('h3',offer.title),element('p',offer.company.name,'offer-company'),element('p',[offer.wilaya,offer.location].filter(Boolean).join(' · '),'offer-place'));
      const tags=element('div',undefined,'offer-tags');for(const value of [offer.contract_type,offer.positions?`${offer.positions} poste${offer.positions>1?'s':''}`:null].filter(Boolean))tags.append(element('span',value));card.append(tags);
      if(offer.salary)card.append(element('p',salary(offer.salary),'offer-salary'));
      const foot=element('div',undefined,'offer-card-footer'),view=element('button','Voir le détail →','offer-select');view.type='button';view.setAttribute('aria-pressed',String(selected===offer.id));view.addEventListener('click',()=>selectOffer(offer.id,true));
      const link=element('a','Postuler ↗','offer-link');link.href='/espace/offers/'+Number(offer.id);foot.append(view,link);card.append(foot);results.append(card);
    }
    if(favoritesOnly&&!visible.length)results.append(element('p','Aucun favori sur cette page de résultats.','detail-placeholder'));
    document.getElementById('offers-favorites').textContent=(favoritesOnly?'♥':'♡')+' Favoris de cette page';
  }
  function salary(value){return Number(value.amount).toLocaleString('fr-DZ',{maximumFractionDigits:2})+' DA'+(value.period?' / '+value.period:'');}
  function backToList(){workspace.classList.remove('detail-open');document.querySelector('.offer-select[aria-pressed="true"]')?.focus();}
  async function selectOffer(id,open=false){
    const request=++detailSequence;detailController?.abort();detailController=new AbortController();selected=id;renderCards();
    if(open){workspace.classList.add('detail-open');if(window.matchMedia?.('(max-width:760px)').matches)workspace.scrollIntoView({block:'start'});}
    detail.replaceChildren(element('p','Chargement du détail…','detail-placeholder'));detail.setAttribute('aria-busy','true');
    try{
      const response=await fetch('/api/public/emploi/offers/'+Number(id),{signal:detailController.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(response.status===404?'Cette offre n’est plus disponible. Actualisez la recherche pour consulter les annonces en cours.':'Le détail de cette offre ne peut pas être chargé.');
      const offer=await response.json();if(request!==detailSequence)return;detail.replaceChildren();
      const head=element('div',undefined,'offer-detail-top'),back=element('button','← Retour aux offres','detail-back');back.type='button';back.addEventListener('click',backToList);head.append(back);
      head.append(element('div','IG','company-logo'),element('h2',offer.title),element('p',offer.company.name),element('p',[offer.location,offer.wilaya].filter(Boolean).join(' · ')));
      const actions=element('div',undefined,'offer-detail-actions'),apply=element('a','Postuler à cette offre →','button primary');apply.href='/espace/offers/'+Number(offer.id);actions.append(apply);head.append(actions);
      const body=element('div',undefined,'offer-detail-body'),info=element('div',undefined,'info-grid');
      for(const [label,value] of [['CONTRAT',offer.contract_type],['LIEU',offer.wilaya],['POSTES',offer.positions],['SALAIRE',offer.salary?salary(offer.salary):null],['RÉFÉRENCE',offer.reference],['CLÔTURE',offer.deadline?new Date(offer.deadline+'T12:00:00').toLocaleDateString('fr-DZ'):null]])if(value){const cell=element('div');cell.append(element('small',label),element('b',String(value)));info.append(cell);}body.append(info);
      for(const [title,value] of [['Présentation',offer.description],['Vos missions',offer.missions],['Profil recherché',offer.profile]])if(value){body.append(element('h3',title),element('p',value,'detail-copy'));}
      body.append(element('h3','Comment postuler ?'),element('p','Identifiez-vous par SMS, complétez votre profil et joignez votre CV. Votre candidature ne sera envoyée qu’après votre confirmation.'));detail.append(head,body);
      if(open)head.querySelector('h2').setAttribute('tabindex','-1');if(open)head.querySelector('h2').focus({preventScroll:true});
    }catch(e){if(request!==detailSequence||e.name==='AbortError')return;detail.replaceChildren();const box=element('div',undefined,'detail-error');box.setAttribute('role','alert');box.append(element('p',e.message||'Connexion indisponible.'));const back=element('button','Retour aux offres','button secondary');back.type='button';back.addEventListener('click',backToList);box.append(back);if(!String(e.message).includes('plus disponible')){const retry=element('button','Réessayer','button secondary');retry.type='button';retry.addEventListener('click',()=>selectOffer(id,open));box.append(retry);}detail.append(box);}
    finally{if(request===detailSequence)detail.setAttribute('aria-busy','false');}
  }
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  function options(name,items,label){const select=form.elements[name],chosen=select.value;select.replaceChildren(element('option',label));select.firstElementChild.value='';for(const item of items){const option=element('option',typeof item==='string'?item:item.name);option.value=typeof item==='string'?item:String(item.id);select.append(option);}select.value=chosen;}
  async function load(){
    const request=++sequence;controller?.abort();controller=new AbortController();error.hidden=true;results.setAttribute('aria-busy','true');status.textContent='Recherche des offres…';
    const params=new URLSearchParams();for(const [key,value] of new FormData(form))if(String(value).trim())params.set(key,String(value).trim());params.set('page',String(page));params.set('page_size','9');
    try{
      const response=await fetch('/api/public/emploi/offers?'+params,{signal:controller.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('Les offres ne peuvent pas être chargées pour le moment.');
      const data=await response.json();if(request!==sequence)return;
      pages=data.pages;page=data.page;results.replaceChildren();
      status.textContent=data.total?`${data.total} offre${data.total>1?'s':''} disponible${data.total>1?'s':''}`:'Aucune offre ne correspond à votre recherche. Vous pouvez modifier les filtres ou déposer une candidature spontanée.';
      items=data.items;renderCards();
      const next=items.some(x=>x.id===selected)?selected:items[0]?.id;
      if(next)selectOffer(next);else{detailSequence++;detailController?.abort();selected=null;workspace.classList.remove('detail-open');detail.setAttribute('aria-busy','false');detail.replaceChildren(element('p','Aucune offre à afficher. Modifiez les filtres ou déposez une candidature spontanée.','detail-placeholder'));}
      options('wilaya',data.facets.wilayas,'Toutes les wilayas');options('company_id',data.facets.companies,'Toutes les sociétés');options('contract_type',data.facets.contract_types,'Tous les contrats');
      document.getElementById('offers-page').textContent=data.total?`Page ${page} sur ${pages}`:'';
      document.getElementById('offers-prev').disabled=page<=1;document.getElementById('offers-next').disabled=page>=pages;
    }catch(e){if(request!==sequence||e.name==='AbortError')return;status.textContent='';error.querySelector('p').textContent=e.message||'Connexion indisponible.';error.hidden=false;detailSequence++;detailController?.abort();detail.setAttribute('aria-busy','false');detail.replaceChildren(element('p','Actualisez la recherche pour vérifier la disponibilité des offres.','detail-placeholder'));}
    finally{if(request===sequence)results.setAttribute('aria-busy','false');}
  }
  form.addEventListener('submit',event=>{event.preventDefault();page=1;workspace.classList.remove('detail-open');load();});
  document.getElementById('offers-favorites').addEventListener('click',()=>{favoritesOnly=!favoritesOnly;document.getElementById('offers-favorites').setAttribute('aria-pressed',String(favoritesOnly));renderCards();});
  form.addEventListener('reset',()=>{page=1;favoritesOnly=false;document.getElementById('offers-favorites').setAttribute('aria-pressed','false');workspace.classList.remove('detail-open');setTimeout(load,0);});
  for(const direction of ['prev','next'])document.getElementById('offers-'+direction).addEventListener('click',()=>{page+=direction==='next'?1:-1;load();document.getElementById('offres').scrollIntoView({block:'start'});});
  document.getElementById('offers-retry').addEventListener('click',load);
  window.addEventListener('focus',()=>{if(!document.hidden)load();});
  setInterval(()=>{if(!document.hidden)load();},60000);
  fetch('/emploi/config').then(response=>response.ok?response.json():null).then(config=>{
    if(config?.android_available===false){const link=document.querySelector('a[href="/emploi/telecharger"]');link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.textContent='Application Android bientôt disponible';}
  }).catch(()=>{});
  load();
})();
