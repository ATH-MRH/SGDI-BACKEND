/* Pointeur terrain — adaptateur « Mode Test facial ».
 *
 * ZÉRO logique biométrique dans ce fichier : le moteur est le module partagé
 * app/static/pointage/test-mode.js, celui du centre de contrôle. Une seule implémentation,
 * deux branchements DOM. Cet adaptateur ne fait que décrire le terminal :
 *   - ids du terminal (ptm-*) ;
 *   - sites autorisés = sélecteur de site déjà présent (#siteSelector) — jamais de saisie libre ;
 *   - jeton = session pointeur (localStorage atlas_pointer_session) ;
 *   - 401 = déconnexion standard du terminal.
 * Le moteur partagé n'appelle que /api/biometrics/test-mode/status et
 * /api/biometrics/test-mode/recognize ; il n'écrit jamais de présence (garde P0 testée).
 * Le vrai pointage facial « Facial » (pointeur-facial.js) reste un circuit distinct.
 */
(function () {
  "use strict";
  const SESSION_KEY = "atlas_pointer_session";

  function readToken() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return (session && session.token) || "";
    } catch (e) { return ""; }
  }

  let instance = null;

  function build() {
    const core = window.ATLASTestMode;
    if (!core || typeof core.create !== "function") return null;
    instance = core.create({
      ids: {
        site: "ptm-site", camera: "ptm-camera", video: "ptm-video", videoPlaceholder: "ptm-video-placeholder",
        canvas: "ptm-canvas", state: "ptm-state", error: "ptm-error", result: "ptm-result",
        start: "ptm-start", stop: "ptm-stop", changeCamera: "ptm-change-camera", view: "testModeView",
      },
      navSelector: "#testModeNav",
      siteSourceSelector: "#siteSelector",
      appSelector: "#appView",
      followGlobalSite: true,
      getToken: readToken,
      onUnauthorized: () => { if (typeof window.logout === "function") window.logout(); },
    });
    instance.attach();
    return instance;
  }

  function engine() { return instance || build(); }

  window.PointerTestMode = {
    start: () => (engine() ? engine().start() : Promise.resolve()),
    stop: () => { if (instance) instance.stop(); },
    load: () => { if (engine()) engine().load(); },
    syncSites: () => { if (engine()) engine().syncSites(); },
    changeCamera: () => { if (engine()) engine().changeCamera(); },
    renderResult: (result) => { if (engine()) engine().renderResult(result); },
    isRunning: () => Boolean(instance && instance.state.running),
    state: () => (instance ? instance.state : null),
  };

  function init() { if (engine()) engine().load(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
