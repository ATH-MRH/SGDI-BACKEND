/* Pointeur terrain — pointage facial AUTOMATIQUE (zéro clic dans le parcours normal).
 *
 * READY → (rafale d'images) → reconnaissance serveur (qualité, liveness, 1:N du site,
 * contrôles employé/affectation, règles Attendance Core) → résultat affiché → cooldown → READY.
 * Aucune sélection d'employé, aucun bouton Capturer/Valider. Le navigateur ne voit jamais la
 * caméra : aperçu et images sont lus par le SERVEUR sur la caméra (identifiants jamais
 * exposés). Le terminal n'envoie JAMAIS d'image pour pointer : une image fournie par un
 * navigateur pourrait être une photo injectée, que le liveness passif ne couvre pas
 * (docs/biometrics.md). Les caméras « terminal » servent uniquement à l'enrôlement supervisé.
 *
 * Le module est intégré à la zone de pointage du poste (pointeur.html) : il n'identifie que la
 * personne. ENTRÉE / SORTIE, vacation, fenêtres et refus sont décidés par Attendance Core ; leur
 * affichage est celui du poste (fiche du dernier pointage), commun au QR et à la saisie manuelle.
 */
(function () {
  "use strict";
  const TICK_MS = 900;          // cadence d'essai en état READY
  const RESULT_MS = 3500;       // affichage du résultat avant retour à READY
  const ERROR_RETRY_MS = 5000;  // reprise après erreur réseau/caméra

  const F = {
    running: false, busy: false, camera: null, cameras: [], timer: null,
    previewTimer: null, previewUrl: null, cooldownUntil: 0, lastState: "",
    // État réellement connu, affiché dans « État du système » : jamais supposé.
    cameraState: "OFF", engineState: "OFF", siteId: "", generation: 0,
  };
  window.PointeurFacial = F;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = () => (window.pointerSession && window.pointerSession.token) || (typeof pointerSession !== "undefined" && pointerSession && pointerSession.token) || "";
  const site = () => (typeof selectedSiteId !== "undefined" ? selectedSiteId : "");
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  async function api(path, options) {
    const opts = options || {};
    const res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + token() }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && typeof logout === "function") { logout(); throw new Error("Session expirée"); }
    if (opts.raw) { if (!res.ok) throw new Error("Aperçu indisponible"); return res; }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const d = data && data.detail;
      throw Object.assign(new Error(typeof d === "string" ? d : (d && d.reasons && d.reasons[0]) || "Erreur " + res.status), { status: res.status });
    }
    return data;
  }

  function setStatus(state, html) {
    F.lastState = state;
    const box = $("faceStatus");
    if (!box) return;
    box.className = "face-status face-" + state.toLowerCase();
    box.innerHTML = html;
  }

  // Caméra : SEARCHING | ACTIVE | UNAVAILABLE | NONE | OFF — moteur : INIT | ACTIVE | ERROR | DISABLED | OFF.
  function setSystem(camera, engine) {
    if (camera) F.cameraState = camera;
    if (engine) F.engineState = engine;
    const view = $("faceView");
    // Sans source vidéo réelle, aucun grand cadre noir : état compact.
    if (view) view.classList.toggle("no-video", F.cameraState !== "ACTIVE" && F.cameraState !== "SEARCHING" && F.cameraState !== "UNAVAILABLE");
    if (typeof renderSystemState === "function") renderSystemState();
  }
  const refreshPost = () => { if (typeof pollLive === "function") pollLive(); };

  const MESSAGES = {
    NO_FACE: "PRÊT — placez-vous face à la caméra",
    MULTIPLE_FACES: "PLUSIEURS VISAGES DÉTECTÉS<br><small>Présentez-vous individuellement.</small>",
    QUALITY_FAILED: "IMAGE INSUFFISANTE",
    LIVENESS_FAILED: "POINTAGE REFUSÉ<br><small>Présence réelle non confirmée.</small>",
    REVIEW_REQUIRED: "RECONNAISSANCE INCERTAINE<br><small>Nouvel essai en cours…</small>",
    AMBIGUOUS: "RECONNAISSANCE AMBIGUË<br><small>Utilisez le pointage de secours.</small>",
  };

  function render(result) {
    const s = result.state;
    if (s === "ATTENDANCE_RECORDED" || s === "ALREADY_RECORDED") {
      // Une reconnaissance aboutie = une personne physiquement passée : même statut qu'une
      // lecture QR réelle pour la règle d'inactivité (jamais la caméra qui tourne à vide).
      if (typeof noteUserActivity === "function") noteUserActivity();
      const e = result.employee || {};
      const already = s === "ALREADY_RECORDED";
      setStatus(already ? "ALREADY" : "SUCCESS", `<div class="face-check">${already ? "✓ DÉJÀ ENREGISTRÉ" : "✓ POINTAGE ENREGISTRÉ"}</div>
        <div class="face-name">${esc(e.nom)} ${esc(e.prenom)}</div>
        <div class="face-meta">Matricule ${esc(e.matricule)}${e.poste ? " · " + esc(e.poste) : ""} · <b>${esc(result.action || "")}</b> · ${esc(result.heure || "")}${result.site ? " · " + esc(result.site) : ""}</div>`);
      F.cooldownUntil = Date.now() + RESULT_MS;
      refreshPost();                                                  // fiche du poste : réel / planifié / comptabilisé
      return;
    }
    if (s === "UNKNOWN_FACE") {
      setStatus("UNKNOWN", `<div class="face-check">VISAGE INCONNU</div><small>Aucun pointage n'a été enregistré.</small>
        <button type="button" class="secondary face-fallback" id="faceFallbackBtn">Rechercher l'employé (pointage de secours)</button>`);
      const btn = $("faceFallbackBtn");
      if (btn) btn.addEventListener("click", F.fallback);
      F.cooldownUntil = Date.now() + RESULT_MS;
      return;
    }
    if (s === "REFUSED") {
      const e = result.employee || {};
      const who = e.nom ? `<div class="face-name">${esc(e.nom)} ${esc(e.prenom)}</div><div class="face-meta">Matricule ${esc(e.matricule)}${e.poste ? " · " + esc(e.poste) : ""}</div>` : "";
      setStatus("REFUSED", `<div class="face-check">POINTAGE REFUSÉ</div>${who}<small>${esc(result.message)}</small><small>Aucun mouvement enregistré.</small>`);
      // Refus d'Attendance Core : même fiche détaillée que pour le QR et la saisie manuelle.
      if (result.code && result.refusal && typeof showLastRefusal === "function") {
        showLastRefusal({ id: "f" + Date.now(), heure: new Date().toTimeString().slice(0, 8), code: result.code, message: result.message,
          employee: Object.assign({}, e, { fonction: e.poste }), counted: result.refusal, terminal: F.camera ? F.camera.name : null });
      }
      F.cooldownUntil = Date.now() + RESULT_MS;
      refreshPost();
      return;
    }
    const reasons = (result.reasons || []).filter(Boolean);
    setStatus(s === "NO_FACE" ? "READY" : s, (MESSAGES[s] || esc(result.message || s)) + (s === "QUALITY_FAILED" && reasons.length ? `<br><small>${esc(reasons[0])}</small>` : ""));
    if (s !== "NO_FACE" && s !== "REVIEW_REQUIRED") F.cooldownUntil = Date.now() + 1500;
  }

  // Pointage de secours : ouvre la saisie manuelle existante (tracée, source MANUAL).
  F.fallback = function () {
    F.stop();
    if (typeof showPointerSection === "function") showPointerSection("scan");
    if (typeof toggleManualPanel === "function" && $("manualPanel") && $("manualPanel").classList.contains("hidden")) toggleManualPanel();
  };

  async function tick() {
    F.timer = null;
    if (!F.running) return;
    // Verrou : une seule reconnaissance à la fois, et aucune pendant l'affichage d'un résultat.
    if (F.busy || Date.now() < F.cooldownUntil) { schedule(250); return; }
    F.busy = true;
    const generation = F.generation;                                  // contexte (site, caméra) de CETTE tentative
    const current = () => F.running && generation === F.generation;
    try {
      const body = { burst_id: uuid() };
      const result = await api(`/biometrics/cameras/${F.camera.id}/recognize`, { method: "POST", body });
      if (current()) { setSystem("ACTIVE", "ACTIVE"); render(result); }
    } catch (error) {
      if (current()) {
        const disabled = error.status === 409 && /non activé/i.test(error.message || "");
        if (disabled) {
          F.stop();
          setStatus("DISABLED", `<div class="face-check">RECONNAISSANCE FACIALE DÉSACTIVÉE</div><small>pour ce site. Utilisez le QR ou la saisie manuelle.</small>`);
          setSystem("NONE", "DISABLED");
        } else {
          setStatus("ERROR", `<div class="face-check">CONNEXION INDISPONIBLE</div><small>${esc(error.message)}</small>`);
          setSystem(error.status === 502 ? "UNAVAILABLE" : null, "ERROR");
          F.cooldownUntil = Date.now() + ERROR_RETRY_MS;
        }
      }
    } finally {
      F.busy = false;
      if (current()) schedule(TICK_MS);
    }
  }

  function schedule(ms) {
    if (F.running && !F.timer) F.timer = setTimeout(tick, ms);
  }

  async function refreshPreview() {
    if (!F.running || !F.camera) return;
    try {
      const res = await api(`/biometrics/cameras/${F.camera.id}/preview.jpg`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const img = $("facePreview");
      if (img) img.src = url;
      if (F.previewUrl) URL.revokeObjectURL(F.previewUrl);
      F.previewUrl = url;
    } catch (e) { /* l'état de reconnaissance affiche déjà l'erreur */ }
  }

  async function openCamera() {
    $("facePreview").classList.remove("hidden");
    await refreshPreview();
    F.previewTimer = setInterval(refreshPreview, 1000);
  }

  F.selectCamera = async function (id) {
    F.stopMedia();
    F.camera = F.cameras.find((c) => String(c.id) === String(id)) || null;
    if (!F.camera) return;
    try { localStorage.setItem("atlas_pointer_face_camera", String(F.camera.id)); } catch (e) { /* stockage indisponible */ }
    $("faceCameraLabel").textContent = `${F.camera.name}${F.camera.location ? " · " + F.camera.location : ""}`;
    try { await openCamera(); setSystem("ACTIVE"); } catch (e) { setSystem("UNAVAILABLE"); setStatus("ERROR", `<div class="face-check">CAMÉRA INDISPONIBLE</div><small>${esc(e.message || "Autorisez la caméra")}</small>`); }
  };

  F.start = async function () {
    if (F.running) return;
    const generation = ++F.generation;
    const stale = () => generation !== F.generation;
    F.siteId = String(site() || "");
    // Le facial automatique exige un site précis : jamais de caméra choisie arbitrairement.
    if (!F.siteId) {
      setStatus("SITE", `<div class="face-check">SÉLECTIONNEZ UN SITE</div><small>Le pointage facial automatique nécessite un site précis.</small>`);
      setSystem("NONE", "OFF");
      return;
    }
    F.running = true;
    setStatus("READY", "Initialisation…");
    setSystem("SEARCHING", "INIT");
    try {
      const status = await api("/biometrics/status");
      if (stale()) return;
      if (!status.enabled || !status.engine_available) {
        setStatus("DISABLED", `<div class="face-check">RECONNAISSANCE FACIALE DÉSACTIVÉE</div><small>Utilisez le QR ou la saisie manuelle.</small>`);
        setSystem("NONE", "DISABLED");
        F.running = false;
        return;
      }
      const all = await api("/biometrics/cameras?site_id=" + encodeURIComponent(F.siteId));
      if (stale()) return;
      // Caméras de POINTAGE du site, lues par le serveur — jamais la caméra locale du poste.
      const usable = all.filter((c) => c.active && c.adapter !== "TERMINAL" && String(c.site_id == null ? F.siteId : c.site_id) === F.siteId
        && (c.usage === "ATTENDANCE" || c.usage === "ATTENDANCE_AND_ENROLLMENT"));
      F.cameras = usable.filter((c) => c.facial_attendance_enabled !== false);
      if (!usable.length) {
        setStatus("DISABLED", `<div class="face-check">AUCUNE CAMÉRA DE POINTAGE</div><small>Aucune caméra active n'est déclarée pour ce site.</small>`);
        setSystem("NONE", "OFF");
        F.running = false;
        return;
      }
      if (!F.cameras.length) {
        setStatus("DISABLED", `<div class="face-check">RECONNAISSANCE FACIALE DÉSACTIVÉE</div><small>pour ce site. Utilisez le QR ou la saisie manuelle.</small>`);
        setSystem("NONE", "DISABLED");
        F.running = false;
        return;
      }
      let stored = "";
      try { stored = localStorage.getItem("atlas_pointer_face_camera") || ""; } catch (e) { stored = ""; }
      const preferred = F.cameras.find((c) => String(c.id) === stored) || F.cameras.find((c) => c.is_default && c.role === "ENTRY") || F.cameras[0];
      const select = $("faceCameraSelect");
      select.innerHTML = F.cameras.map((c) => `<option value="${c.id}">${esc(c.name)}${c.location ? " — " + esc(c.location) : ""}</option>`).join("");
      select.value = String(preferred.id);
      select.classList.toggle("hidden", F.cameras.length < 2);
      await F.selectCamera(preferred.id);
      if (stale()) return;
      setStatus("READY", MESSAGES.NO_FACE);
      setSystem(null, "ACTIVE");
      schedule(300);
    } catch (error) {
      if (stale()) return;
      setStatus("ERROR", `<div class="face-check">INDISPONIBLE</div><small>${esc(error.message)}</small>`);
      setSystem("UNAVAILABLE", "ERROR");
      F.running = false;
    }
  };

  F.stopMedia = function () {
    clearInterval(F.previewTimer); F.previewTimer = null;
    if (F.previewUrl) { URL.revokeObjectURL(F.previewUrl); F.previewUrl = null; }
  };

  // Arrêt complet : plus aucune détection, aucun aperçu, aucun minuteur ; une réponse encore en
  // vol est ignorée (génération périmée).
  F.stop = function () {
    F.running = false;
    F.generation++;
    clearTimeout(F.timer); F.timer = null;
    F.cooldownUntil = 0;
    F.stopMedia();
    F.camera = null; F.cameras = [];
    const img = $("facePreview");
    if (img) { img.classList.add("hidden"); img.removeAttribute("src"); }
    const label = $("faceCameraLabel");
    if (label) label.textContent = "—";
    setSystem("OFF", "OFF");
  };

  // Changement de site : le contexte précédent est arrêté avant de chercher la caméra du nouveau.
  F.restart = function () {
    F.stop();
    return F.start();
  };
})();
