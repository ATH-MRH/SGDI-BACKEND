/* Public offers only; the existing candidate application handles accounts and applications. */
(() => {
  const form=document.getElementById('offer-search'),results=document.getElementById('offer-results'),status=document.getElementById('offer-status'),error=document.getElementById('offer-error');
  let page=1,pages=1,sequence=0,controller;
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
      for(const offer of data.items){
        const card=element('article',undefined,'offer-card');card.append(element('p',offer.company.name,'offer-company'),element('h3',offer.title));
        card.append(element('p',[offer.wilaya,offer.location].filter(Boolean).join(' · '),'offer-place'));
        const tags=element('div',undefined,'offer-tags');for(const text of [offer.contract_type,offer.positions?`${offer.positions} poste${offer.positions>1?'s':''}`:null].filter(Boolean))tags.append(element('span',text));card.append(tags);
        if(offer.salary){const salary=Number(offer.salary.amount).toLocaleString('fr-DZ',{maximumFractionDigits:2});card.append(element('p',`${salary} DA${offer.salary.period?' / '+offer.salary.period:''}`,'offer-salary'));}
        const link=element('a','Découvrir l’offre →','offer-link');link.href='/espace/offers/'+Number(offer.id);card.append(link);results.append(card);
      }
      options('wilaya',data.facets.wilayas,'Toutes les wilayas');options('company_id',data.facets.companies,'Toutes les sociétés');options('contract_type',data.facets.contract_types,'Tous les contrats');
      document.getElementById('offers-page').textContent=data.total?`Page ${page} sur ${pages}`:'';
      document.getElementById('offers-prev').disabled=page<=1;document.getElementById('offers-next').disabled=page>=pages;
    }catch(e){if(request!==sequence||e.name==='AbortError')return;status.textContent='';error.querySelector('p').textContent=e.message||'Connexion indisponible.';error.hidden=false;}
    finally{if(request===sequence)results.setAttribute('aria-busy','false');}
  }
  form.addEventListener('submit',event=>{event.preventDefault();page=1;load();});
  form.addEventListener('reset',()=>{page=1;setTimeout(load,0);});
  for(const direction of ['prev','next'])document.getElementById('offers-'+direction).addEventListener('click',()=>{page+=direction==='next'?1:-1;load();document.getElementById('offres').scrollIntoView({block:'start'});});
  document.getElementById('offers-retry').addEventListener('click',load);
  window.addEventListener('focus',()=>{if(!document.hidden)load();});
  setInterval(()=>{if(!document.hidden)load();},60000);
  fetch('/emploi/config').then(response=>response.ok?response.json():null).then(config=>{
    if(config?.android_available===false){const link=document.querySelector('a[href="/emploi/telecharger"]');link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.textContent='Application Android bientôt disponible';}
  }).catch(()=>{});
  load();
})();
