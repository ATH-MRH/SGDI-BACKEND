/* Utilitaires frontend purs partagés par le shell SGDI et les modules legacy. */
function uid(prefix="x"){
  return prefix+"_"+Math.random().toString(36).slice(2,10);
}

function money(value){
  if(value===null||value===undefined||value==="")return "—";
  const number=Number(value);
  if(Number.isNaN(number))return "—";
  return number.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" DA";
}

function formatDate(value){
  if(!value)return "—";
  try{return new Date(value).toLocaleDateString("fr-FR");}
  catch(error){return value;}
}

function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,character=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[character]);
}
