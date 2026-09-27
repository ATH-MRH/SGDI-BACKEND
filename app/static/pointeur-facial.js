/* Pointeur terrain — pointage facial AUTOMATIQUE (zéro clic dans le parcours normal).
 *
 * READY → (rafale d'images) → reconnaissance serveur (qualité, liveness, 1:N du site,
 * contrôles employé/affectation, règles Attendance Core) → résultat affiché → cooldown → READY.
 * Aucune sélection d'employé, aucun bouton Capturer/Valider. Le navigateur ne voit jamais la
 * caméra : aperçu et images sont lus par le SERVEUR sur la caméra (identifiants jamais
 * exposés). Le terminal n'envoie JAMAIS d'image pour pointer : une image fournie par un
 * navigateur pourrait être une photo injectée, que le liveness passif ne couvre pas
 * (docs/biometrics.md). Les caméras « terminal » servent uniquement à l'enrôlement supervisé.
 */
(function () {
  "use strict";
  const TICK_MS = 900;          // cadence d'essai en état READY
  const RESULT_MS = 3500;       // affichage du résultat avant retour à READY
  const ERROR_RETRY_MS = 5000;  // reprise après erreur réseau/caméra

  const F = {
    running: false, busy: false, camera: null, cameras: [], timer: null,
    previewTimer: null, previewUrl: null, cooldownUntil: 0, lastState: "",
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
        <div class="face-meta">Matricule ${esc(e.matricule)} · <b>${esc(result.action || "")}</b> · ${esc(result.heure || "")}${result.site ? " · " + esc(result.site) : ""}</div>`);
      F.cooldownUntil = Date.now() + RESULT_MS;
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
      setStatus("REFUSED", `<div class="face-check">POINTAGE REFUSÉ</div><small>${esc(result.message)}</small>`);
      F.cooldownUntil = Date.now() + RESULT_MS;
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
    if (F.busy || Date.now() < F.cooldownUntil) { schedule(250); return; }
    F.busy = true;
    try {
      const body = { burst_id: uuid() };
      const result = await api(`/biometrics/cameras/${F.camera.id}/recognize`, { method: "POST", body });
      if (F.running) render(result);
    } catch (error) {
      if (F.running) {
        setStatus("ERROR", `<div class="face-check">CONNEXION INDISPONIBLE</div><small>${esc(error.message)}</small>`);
        F.cooldownUntil = Date.now() + ERROR_RETRY_MS;
      }
    } finally {
      F.busy = false;
      schedule(TICK_MS);
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
    try { await openCamera(); } catch (e) { setStatus("ERROR", `<div class="face-check">CAMÉRA INDISPONIBLE</div><small>${esc(e.message || "Autorisez la caméra")}</small>`); }
  };

  F.start = async function () {
    if (F.running) return;
    F.running = true;
    setStatus("READY", "Initialisation…");
    try {
      const status = await api("/biometrics/status");
      if (!status.enabled || !status.engine_available) {
        setStatus("DISABLED", `<div class="face-check">POINTAGE FACIAL NON ACTIVÉ</div><small>Utilisez le QR ou la saisie manuelle.</small>`);
        F.running = false;
        return;
      }
      const all = await api("/biometrics/cameras" + (site() ? "?site_id=" + encodeURIComponent(site()) : ""));
      F.cameras = all.filter((c) => c.active && c.adapter !== "TERMINAL" && (c.usage === "ATTENDANCE" || c.usage === "ATTENDANCE_AND_ENROLLMENT"));
      if (!F.cameras.length) {
        setStatus("DISABLED", `<div class="face-check">AUCUNE CAMÉRA DE POINTAGE</div><small>Aucune caméra active n'est déclarée pour ce site.</small>`);
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
      setStatus("READY", MESSAGES.NO_FACE);
      schedule(300);
    } catch (error) {
      setStatus("ERROR", `<div class="face-check">INDISPONIBLE</div><small>${esc(error.message)}</small>`);
      F.running = false;
    }
  };

  F.stopMedia = function () {
    clearInterval(F.previewTimer); F.previewTimer = null;
    if (F.previewUrl) { URL.revokeObjectURL(F.previewUrl); F.previewUrl = null; }
  };

  F.stop = function () {
    F.running = false;
    clearTimeout(F.timer); F.timer = null;
    F.stopMedia();
  };
})();
