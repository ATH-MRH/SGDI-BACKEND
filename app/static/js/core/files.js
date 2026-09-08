/* Documents partagés : compression, téléversement, aperçu et impression.
 * Fonctions déplacées verbatim ; aucune exécution au chargement.
 * dotationDocumentInlineStyle reste dans le socle métier partagé. */
function compressImage(dataUrl,maxDim,quality){
  return new Promise((resolve)=>{
    if(typeof maxDim!=="number")maxDim=600;
    if(typeof quality!=="number")quality=0.7;
    try{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxDim||h>maxDim){const r=Math.min(maxDim/w,maxDim/h);w=Math.round(w*r);h=Math.round(h*r)}
        const c=document.createElement("canvas");c.width=w;c.height=h;
        const ctx=c.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
        try{resolve(c.toDataURL("image/jpeg",quality))}catch(e){resolve(dataUrl)}
      };
      img.onerror=()=>resolve(dataUrl);
      img.src=dataUrl;
    }catch(e){resolve(dataUrl)}
  });
}

function handleDocUpload(key,inputId,holderId){const inp=document.getElementById(inputId);if(!inp||!inp.files[0])return;const f=inp.files[0];if(f.size>5*1024*1024){toast("Fichier > 5 Mo","error");return}const r=new FileReader();r.onload=e=>{const urlI=document.querySelector(`[name="doc_${key}_url"]`);const nmI=document.querySelector(`[name="doc_${key}_name"]`);const vc=document.querySelector(`[name="verif${key}"]`);if(urlI)urlI.value=e.target.result;if(nmI)nmI.value=f.name;if(vc){vc.checked=true;vc.dispatchEvent(new Event("change",{bubbles:true}))}document.getElementById(holderId).innerHTML=`<div class="text-xs text-emerald-600">✅ ${escapeHTML(f.name)}</div><button type="button" class="btn btn-ghost text-xs mt-1" onclick="viewDoc('${e.target.result}','${escapeHTML(f.name)}')">👁 Voir</button><button type="button" class="btn btn-ghost text-xs mt-1 text-red-600" onclick="removeDoc('${key}','${holderId}')">✕ Retirer</button>`;toast(`Pièce "${key}" téléversée`,"success")};r.readAsDataURL(f)}

function removeDoc(key,holderId){const urlI=document.querySelector(`[name="doc_${key}_url"]`);const nmI=document.querySelector(`[name="doc_${key}_name"]`);if(urlI)urlI.value="";if(nmI)nmI.value="";const id=Math.random().toString(36).slice(2,8);document.getElementById(holderId).innerHTML=`<input id="docinp-${id}" type="file" accept="image/*,.pdf" class="hidden" onchange="handleDocUpload('${key}','docinp-${id}','${holderId}')"/><button type="button" class="btn btn-secondary text-xs" onclick="document.getElementById('docinp-${id}').click()">📤 Téléverser</button>`}

function sgdiHtmlDataUrlWithInlineStyles(url){
  const raw=String(url||"");
  if(!raw.startsWith("data:text/html"))return raw;
  const comma=raw.indexOf(",");
  if(comma<0)return raw;
  let html="";
  try{html=decodeURIComponent(raw.slice(comma+1))}catch(e){return raw}
  if(!html.includes("dotation-print")||html.includes("data-sgdi-dotation-style"))return raw;
  const style=dotationDocumentInlineStyle();
  html=html.includes("</head>")?html.replace("</head>",style+"</head>"):style+html;
  return "data:text/html;charset=utf-8,"+encodeURIComponent(html);
}

function viewDoc(url,name){
  const safeUrl=sgdiHtmlDataUrlWithInlineStyles(url);
  const allowed=safeUrl.startsWith("data:image/")||safeUrl.startsWith("data:application/pdf")||safeUrl.startsWith("data:text/html")||safeUrl.startsWith("blob:")||safeUrl.startsWith("https://")||safeUrl.startsWith("http://")||safeUrl.startsWith("/");
  if(!allowed){console.warn("viewDoc: URL non autorisée",safeUrl.slice(0,80));toast("Document impossible à ouvrir","error");return;}
  const isImage=safeUrl.startsWith("data:image");
  const preview=isImage?`<img src="${safeUrl}" class="w-full rounded-lg"/>`:`<iframe src="${safeUrl}" class="w-full rounded-lg" style="height:70vh" sandbox="allow-scripts allow-same-origin"></iframe>`;
  openModal(`<div class="p-2"><div class="flex justify-between items-center mb-3"><h3 class="font-bold">${escapeHTML(name)}</h3><button class="btn btn-ghost" onclick="closeModal()">✕</button></div>${preview}<a href="${safeUrl}" download="${escapeHTML(name)}" class="btn btn-primary mt-3">⬇ Télécharger</a></div>`);
}

function printArchiveA4Current(){
  const cur=window._archiveA4CurrentDoc||{};
  const url=String(cur.url||"");
  const name=String(cur.name||"Document");
  if(!url){toast("Aucun document à imprimer","error");return}
  const w=window.open("","_blank","width=1100,height=850");
  if(!w){toast("Popup bloquée par le navigateur — autorisez les fenêtres pour imprimer","error");return}
  if(url.startsWith("data:text/html")){
    const comma=url.indexOf(",");
    let html="";
    try{html=decodeURIComponent(url.slice(comma+1))}catch(e){html=""}
    w.document.open();
    w.document.write(html||`<!doctype html><html><body>Document indisponible</body></html>`);
    w.document.close();
    setTimeout(()=>{try{w.focus();w.print()}catch(e){}},500);
    return;
  }
  if(url.startsWith("data:image/")){
    w.document.open();
    w.document.write(`<!doctype html><html><head><title>${escapeHTML(name)}</title><style>@page{size:A4;margin:10mm}body{margin:0;background:#fff;display:flex;align-items:flex-start;justify-content:center}img{max-width:190mm;max-height:277mm;object-fit:contain}</style></head><body><img src="${escapeHTML(url)}" onload="setTimeout(()=>print(),300)"></body></html>`);
    w.document.close();
    return;
  }
  w.location.href=url;
  setTimeout(()=>{try{w.focus();w.print()}catch(e){}},900);
}

function viewDocA4(url,name){
  const safeUrl=sgdiHtmlDataUrlWithInlineStyles(url);
  const allowed=safeUrl.startsWith("data:image/")||safeUrl.startsWith("data:application/pdf")||safeUrl.startsWith("data:text/html")||safeUrl.startsWith("blob:")||safeUrl.startsWith("https://")||safeUrl.startsWith("http://")||safeUrl.startsWith("/");
  if(!allowed){console.warn("viewDocA4: URL non autorisée",safeUrl.slice(0,80));toast("Document impossible à ouvrir","error");return}
  window._archiveA4CurrentDoc={url:safeUrl,name:name||"Document"};
  const isImage=safeUrl.startsWith("data:image/");
  const preview=isImage
    ?`<div class="archive-a4-sheet"><img src="${escapeHTML(safeUrl)}" alt="${escapeHTML(name||"Document")}" /></div>`
    :`<iframe src="${escapeHTML(safeUrl)}" class="archive-a4-frame" sandbox="allow-scripts allow-same-origin"></iframe>`;
  openModal(`<div class="archive-a4-viewer">
    <div class="archive-a4-toolbar">
      <div><h3>${escapeHTML(name||"Document")}</h3><p>Affichage archive · format A4</p></div>
      <div class="archive-a4-actions">
        <a href="${escapeHTML(safeUrl)}" download="${escapeHTML(name||"document")}" class="btn btn-secondary">Télécharger</a>
        <button type="button" class="btn btn-primary" onclick="printArchiveA4Current()">Imprimer</button>
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>
      </div>
    </div>
    <div class="archive-a4-stage">${preview}</div>
  </div>`);
  document.querySelector("#modal-host .modal")?.classList.add("archive-a4-modal");
}

function docUploadField(key,label,eu,en){const id=Math.random().toString(36).slice(2,8);const h=`doch-${id}`;const inner=eu?`<div class="text-xs text-emerald-600">✅ ${escapeHTML(en||"fichier")}</div><button type="button" class="btn btn-ghost text-xs mt-1" onclick="viewDoc('${eu}','${escapeHTML(en||"fichier")}')">👁 Voir</button><button type="button" class="btn btn-ghost text-xs mt-1 text-red-600" onclick="removeDoc('${key}','${h}')">✕ Retirer</button>`:`<input id="docinp-${id}" type="file" accept="image/*,.pdf" class="hidden" onchange="handleDocUpload('${key}','docinp-${id}','${h}')"/><button type="button" class="btn btn-secondary text-xs" onclick="document.getElementById('docinp-${id}').click()">📤 Téléverser</button>`;return`<input type="hidden" name="doc_${key}_url" value="${eu||""}"/><input type="hidden" name="doc_${key}_name" value="${en||""}"/><div id="${h}">${inner}</div>`}
