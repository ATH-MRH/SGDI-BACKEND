/* Administration : dépendances de vues chargées à la demande, droits inchangés. */
SGDIModules.registerModule({key:"administration",routes:["admin","parametres"],destroy:function(){adminViewEpoch++;positionsStopInteractions()},dependencies:["positions","administration-users","administration-permissions","administration-pointage-settings","administration-access-settings","administration-user-forms","administration-settings","administration-rh-settings","administration-maintenance"]});

// La génération du routeur couvre les changements de route ; l'époque et le
// ticket couvrent les re-rendus de la même route et les requêtes concurrentes.
let adminViewEpoch=0;
const adminViewRequests=new WeakMap();
function adminCaptureView(view,slot=view){
  const generation=sgdiViewRenderGeneration,hash=location.hash,epoch=adminViewEpoch,ticket={};
  if(slot)adminViewRequests.set(slot,ticket);
  return ()=>!!view&&document.getElementById("view")===view&&view.isConnected&&
    generation===sgdiViewRenderGeneration&&hash===location.hash&&epoch===adminViewEpoch&&
    /^#\/(admin|parametres)(\/|$)/.test(hash)&&adminViewRequests.get(slot)===ticket&&
    window.SGDIModules?.activeModuleKey==="administration"&&SGDIModules.isModuleInitialized("administration");
}
