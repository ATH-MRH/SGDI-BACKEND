/* Charge les dépendances PDF uniquement lorsqu'un export le demande. */
window.sgdiLoadPDFLibs=function(){
  if(window.html2canvas&&window.jspdf?.jsPDF)return Promise.resolve();
  if(window._pdfLibsPromise)return window._pdfLibsPromise;
  const load=(src,ready)=>ready()?Promise.resolve():new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=src;
    script.onload=()=>ready()?resolve():reject(new Error("Bibliothèque PDF indisponible"));
    script.onerror=reject;
    document.head.appendChild(script);
  });
  window._pdfLibsPromise=load("/static/html2canvas.min.js?v=1.4.1",()=>typeof window.html2canvas==="function")
    .then(()=>load("/static/jspdf.umd.min.js?v=2.5.2",()=>!!window.jspdf?.jsPDF))
    .catch(error=>{window._pdfLibsPromise=null;throw error;});
  return window._pdfLibsPromise;
};
