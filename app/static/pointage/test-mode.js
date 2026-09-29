/* ATLAS Biometric Test Mode — browser-only camera, no attendance writes. */
(function () {
  "use strict";
  const STATUS_URL = "/api/biometrics/test-mode/status";
  const RECOGNIZE_URL = "/api/biometrics/test-mode/recognize";
  const MIN_INTERVAL_MS = 2500;
  const FRAME_COUNT = 3;
  const FRAME_SPACING_MS = 250;
  const DEFAULT_MAX_SIDE = 1280;
  const F = { running: false, busy: false, stream: null, timer: null, controller: null, devices: [], status: null, maxSide: DEFAULT_MAX_SIDE, lastRequestAt: 0, loaded: false };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const apiToken = () => sessionStorage.getItem("atlas_pointage_token") || "";

  function statusText(text, kind) {
    const node = $("tm-state");
    if (!node) return;
    node.className = "test-mode-state" + (kind ? " is-" + kind : "");
    node.textContent = text;
  }

  function showError(message) {
    const node = $("tm-error");
    if (!node) return;
    node.textContent = message;
    node.classList.remove("hidden");
  }

  function clearError() {
    const node = $("tm-error");
    if (node) { node.textContent = ""; node.classList.add("hidden"); }
  }

  async function request(url, options) {
    const opts = options || {};
    const response = await fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + apiToken() }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (response.status === 401) {
      const logout = $("logout-btn");
      if (logout) logout.click();
      throw Object.assign(new Error("Session expirée — reconnectez-vous."), { status: 401 });
    }
    if (!response.ok) {
      const detail = data && data.detail;
      const code = detail && typeof detail === "object" ? detail.code : null;
      const error = Object.assign(new Error(code || (typeof detail === "string" ? detail : "Erreur de communication")), {
        status: response.status, code,
        retryAfter: Number(response.headers && response.headers.get("Retry-After")) || 0,
      });
      throw error;
    }
    return data;
  }

  function authorizedSites() {
    const select = $("f-site");
    return select ? Array.from(select.options).filter((option) => option.value).map((option) => ({ id: option.value, label: option.textContent })) : [];
  }

  function syncSites() {
    const select = $("tm-site"), sites = authorizedSites();
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Sélectionner un site autorisé</option>' + sites.map((site) => `<option value="${esc(site.id)}">${esc(site.label)}</option>`).join("");
    const globalSite = $("f-site") && $("f-site").value;
    select.value = sites.some((site) => site.id === previous) ? previous : (sites.some((site) => site.id === globalSite) ? globalSite : (sites.length === 1 ? sites[0].id : ""));
    select.disabled = sites.length === 0 || F.running;
    $("tm-start").disabled = !select.value || F.running;
  }

  function updateNav(permitted) {
    const nav = document.querySelector('[data-view="test-mode"]');
    if (nav) nav.classList.toggle("hidden", !permitted);
  }

  function messageForError(error) {
    if (error.status === 403) return "ACCÈS NON AUTORISÉ";
    if (error.status === 404) return "Site indisponible ou hors de votre périmètre.";
    if (error.status === 413 || error.code === "IMAGE_TOO_LARGE") {
      F.maxSide = Math.max(640, Math.floor(F.maxSide * 0.75));
      return "Image trop volumineuse — résolution réduite pour le prochain essai.";
    }
    if (error.status === 422 || error.code === "INVALID_IMAGE") return "Image caméra invalide — nouvelle tentative.";
    if (error.status === 429 || error.code === "RATE_LIMITED") return "Limite d'essais atteinte — pause temporaire.";
    if (error.status === 503 && error.code === "TEST_MODE_DISABLED") return "MODE TEST DÉSACTIVÉ.";
    if (error.status === 503 && error.code === "ENGINE_UNAVAILABLE") return "MOTEUR BIOMÉTRIQUE INDISPONIBLE.";
    if (error.status === 401) return "Session expirée — reconnectez-vous.";
    return "Service de test momentanément indisponible.";
  }

  function updateControls() {
    const start = $("tm-start"), stop = $("tm-stop"), change = $("tm-change-camera"), site = $("tm-site");
    if (start) start.disabled = F.running || !site || !site.value;
    if (stop) stop.disabled = !F.running;
    if (change) change.disabled = !F.running || F.devices.length < 2;
    if (site) site.disabled = F.running;
  }

  async function refreshStatus() {
    const nav = document.querySelector('[data-view="test-mode"]');
    if (!apiToken()) { updateNav(false); return; }
    try {
      const status = await request(STATUS_URL);
      F.status = status;
      updateNav(Boolean(status.permitted));
      if (!status.permitted) {
        statusText("ACCÈS NON AUTORISÉ", "error");
        return;
      }
      if (!status.test_mode_enabled) { statusText("MODE TEST DÉSACTIVÉ.", "warning"); return; }
      if (!status.engine_available) { statusText("MOTEUR BIOMÉTRIQUE INDISPONIBLE.", "error"); return; }
      if (status.records_attendance !== false) { statusText("Mode Test indisponible : contrat de non-pointage non confirmé.", "error"); return; }
      statusText("PRÊT", "ready");
      syncSites();
    } catch (error) {
      updateNav(false);
      if (nav) nav.classList.add("hidden");
      if (error.status !== 401) statusText(messageForError(error), "error");
    }
  }

  function renderResult(result) {
    const box = $("tm-result");
    const title = {
      RECOGNIZED: "VISAGE RECONNU", UNKNOWN_FACE: "VISAGE INCONNU", NO_FACE: "AUCUN VISAGE DÉTECTÉ",
      MULTIPLE_FACES: "PLUSIEURS VISAGES DÉTECTÉS", QUALITY_FAILED: "QUALITÉ INSUFFISANTE",
      LIVENESS_FAILED: "LIVENESS REFUSÉ", AMBIGUOUS: "RÉSULTAT AMBIGU", REVIEW_REQUIRED: "VÉRIFICATION NÉCESSAIRE",
      REFUSED: result.reason_code === "CONSENT_REQUIRED" ? "CONSENTEMENT BIOMÉTRIQUE REQUIS" : result.reason_code === "EMPLOYEE_INACTIVE" ? "EMPLOYÉ NON ACTIF" : "TEST REFUSÉ",
    }[result.state] || "RÉSULTAT DU TEST";
    const employee = result.employee;
    const match = result.match || {};
    const liveness = result.liveness || {};
    const quality = result.quality || {};
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    const reasonText = reasons.join(" ").toLocaleLowerCase();
    const advice = [];
    if (/trop petit|approchez|taille/.test(reasonText)) advice.push("Rapprochez-vous de la caméra.");
    if (/cadrage|orientation|occlusion|mal détecté/.test(reasonText)) advice.push("Regardez la caméra et dégagez votre visage.");
    if (/flou|immobile/.test(reasonText)) advice.push("Restez immobile pour éviter le flou.");
    const guidance = result.state === "QUALITY_FAILED" && advice.length ? `<ul>${advice.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
    const identity = employee ? `<dl class="test-mode-identity">${[["Nom", employee.nom], ["Prénom", employee.prenom], ["Matricule", employee.matricule], ["Fonction", employee.fonction], ["Site", employee.site]].filter(([, value]) => value != null && value !== "").map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : "";
    const numeric = (value, digits) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
    const details = [
      ["Total", result.timings_ms && result.timings_ms.total], ["Upload", result.timings_ms && result.timings_ms.upload],
      ["Validation", result.timings_ms && result.timings_ms.validation], ["Analyse", result.timings_ms && result.timings_ms.analysis],
      ["Détection", result.timings_ms && result.timings_ms.detection],
      ["Qualité", result.timings_ms && result.timings_ms.quality], ["Embedding", result.timings_ms && result.timings_ms.embedding],
      ["Liveness", result.timings_ms && result.timings_ms.liveness], ["Matching", result.timings_ms && result.timings_ms.matching],
    ].filter(([, value]) => value != null).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(numeric(value, 1))} ms</dd></div>`).join("");
    box.innerHTML = `<div class="test-mode-result-head"><h3>${esc(title)}</h3><span class="pill ${result.state === "RECOGNIZED" ? "st-present" : result.state === "UNKNOWN_FACE" ? "st-absent" : "sev-warning"}">${esc(result.state)}</span></div>
      ${employee ? identity : ""}${result.message ? `<p>${esc(result.message)}</p>` : ""}${reasons.length ? `<ul>${reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul>` : ""}${guidance}
      ${result.state === "RECOGNIZED" ? '<p class="test-mode-no-write"><strong>TEST UNIQUEMENT — AUCUN POINTAGE ENREGISTRÉ.</strong></p>' : ""}
      <div class="test-mode-metrics">${match.confidence != null ? `<span>Score de correspondance : <strong>${esc(numeric(match.confidence, 4))}</strong></span>` : ""}${match.threshold != null ? `<span>Seuil : <strong>${esc(numeric(match.threshold, 3))}</strong></span>` : ""}${match.review_margin != null ? `<span>Marge de revue : <strong>${esc(numeric(match.review_margin, 3))}</strong></span>` : ""}${liveness.result ? `<span>Liveness : <strong>${esc({ PASS: "Réussi", FAIL: "Échec", INCONCLUSIVE: "Non concluant", NOT_EVALUATED: "Non évalué" }[liveness.result] || liveness.result)}</strong>${liveness.score != null ? ` · ${esc(numeric(liveness.score, 3))}` : ""}</span>` : ""}</div>
      <details class="test-mode-details"><summary>Détails techniques</summary><dl>${details}${Object.entries(quality).filter(([, value]) => value != null).map(([key, value]) => `<div><dt>${esc(key.replace(/_/g, " "))}</dt><dd>${esc(typeof value === "number" ? numeric(value, 2) : value)}</dd></div>`).join("")}</dl>${result.engine ? `<p>Moteur : ${esc(result.engine)} · trames : ${esc(result.frames)}</p>` : ""}</details>`;
    box.classList.remove("hidden");
  }

  function getVideoSize() {
    const video = $("tm-video");
    return video && video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null;
  }

  async function captureFrame() {
    const video = $("tm-video"), size = getVideoSize();
    if (!size) throw new Error("Le flux vidéo n'est pas encore prêt.");
    const scale = Math.min(1, F.maxSide / Math.max(size.width, size.height));
    const canvas = $("tm-canvas");
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Capture caméra indisponible.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  async function captureBurst() {
    const frames = [];
    for (let index = 0; index < Math.min(FRAME_COUNT, Number(F.status && F.status.max_frames) || FRAME_COUNT); index++) {
      if (!F.running) break;
      if (index) await sleep(FRAME_SPACING_MS);
      frames.push(await captureFrame());
    }
    if (!frames.length) throw new Error("Aucune image capturée.");
    return frames;
  }

  function setStream(stream) {
    const video = $("tm-video");
    F.stream = stream;
    const track = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (track && track.addEventListener) track.addEventListener("ended", () => {
      if (F.running) {
        stop();
        statusText("CAMÉRA INTERROMPUE — redémarrez le test.", "warning");
      }
    }, { once: true });
    video.srcObject = stream;
    video.classList.remove("hidden");
    const placeholder = $("tm-video-placeholder");
    if (placeholder) placeholder.classList.add("hidden");
    return Promise.resolve(video.play && video.play()).catch(() => undefined);
  }

  async function listDevices() {
    const media = navigator.mediaDevices;
    const selected = $("tm-camera").value;
    const devices = await media.enumerateDevices();
    F.devices = devices.filter((device) => device.kind === "videoinput");
    const select = $("tm-camera");
    select.innerHTML = F.devices.map((device, index) => `<option value="${esc(device.deviceId)}">${esc(device.label || `Caméra ${index + 1}`)}</option>`).join("");
    if (F.devices.some((device) => device.deviceId === selected)) select.value = selected;
    select.disabled = F.devices.length < 2;
    return F.devices;
  }

  async function openSelectedCamera(initial) {
    const media = navigator.mediaDevices;
    let constraints = { audio: false, video: { width: { ideal: DEFAULT_MAX_SIDE }, height: { ideal: 960 } } };
    const selected = $("tm-camera").value;
    if (!initial && selected) constraints.video.deviceId = { exact: selected };
    else constraints.video.facingMode = { ideal: "user" };
    const stream = await media.getUserMedia(constraints);
    if (!F.running) {
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) { /* track déjà arrêté */ } });
      return;
    }
    await setStream(stream);
    await listDevices();
    if (initial && F.devices.length) {
      const activeTrack = stream.getVideoTracks && stream.getVideoTracks()[0];
      const activeId = activeTrack && activeTrack.getSettings ? activeTrack.getSettings().deviceId : "";
      if (activeId && F.devices.some((device) => device.deviceId === activeId)) $("tm-camera").value = activeId;
    }
    await sleep(400);
    if (!getVideoSize()) throw new Error("Le navigateur n'a pas encore fourni d'image vidéo.");
  }

  function stopTracks() {
    if (F.stream) {
      F.stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) { /* track déjà arrêté */ } });
      F.stream = null;
    }
    const video = $("tm-video");
    if (video) { video.pause(); video.srcObject = null; video.classList.add("hidden"); }
    const placeholder = $("tm-video-placeholder");
    if (placeholder) placeholder.classList.remove("hidden");
    const canvas = $("tm-canvas");
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }

  function stop() {
    F.running = false;
    clearTimeout(F.timer); F.timer = null;
    if (F.controller) { F.controller.abort(); F.controller = null; }
    stopTracks();
    F.busy = false;
    updateControls();
    if ($("tm-state") && !$("view-test-mode").classList.contains("hidden")) statusText("PRÊT", "ready");
  }

  async function analyze() {
    if (!F.running || F.busy) return;
    F.busy = true;
    F.lastRequestAt = Date.now();
    clearError();
    statusText("ANALYSE…", "busy");
    let pause = MIN_INTERVAL_MS;
    try {
      const frames = await captureBurst();
      if (!F.running) return;
      F.controller = new AbortController();
      const result = await request(RECOGNIZE_URL, { method: "POST", body: { site_id: Number($("tm-site").value), frames }, signal: F.controller.signal });
      if (!F.running) return;
      if (result.recorded !== false || result.mode !== "TEST") {
        stop();
        statusText("Analyse interrompue : la réponse ne confirme pas le Mode Test sans pointage.", "error");
        return;
      }
      renderResult(result);
      statusText(result.state === "RECOGNIZED" ? "VISAGE RECONNU · TEST UNIQUEMENT" : result.state, result.state === "RECOGNIZED" ? "success" : "result");
    } catch (error) {
      if (!F.running || error.name === "AbortError") return;
      if (error.status === 403 || error.status === 404 || error.status === 503) {
        const message = messageForError(error);
        stop();
        statusText(message, "error");
        return;
      }
      statusText(messageForError(error), error.status === 429 ? "warning" : "error");
      if (error.status === 422) pause = MIN_INTERVAL_MS;
      if (error.status === 429 || error.code === "RATE_LIMITED") pause = Math.max(MIN_INTERVAL_MS, error.retryAfter * 1000 || 60000);
      if (error.status === 413 || error.code === "IMAGE_TOO_LARGE") pause = Math.max(MIN_INTERVAL_MS, 4000);
      if (!error.status && error.message) showError(error.message);
    } finally {
      F.busy = false;
      F.controller = null;
      if (F.running) {
        const elapsed = Date.now() - F.lastRequestAt;
        F.timer = setTimeout(analyze, Math.max(pause, MIN_INTERVAL_MS - elapsed));
      }
    }
  }

  async function start() {
    if (F.running) return;
    clearError();
    syncSites();
    const siteId = $("tm-site").value;
    if (!siteId) { statusText("Sélectionnez un site autorisé.", "warning"); return; }
    statusText("VÉRIFICATION DU MODE TEST…", "busy");
    try {
      const status = await request(STATUS_URL);
      F.status = status;
      updateNav(Boolean(status.permitted));
      if (!status.permitted) throw Object.assign(new Error("ACCÈS NON AUTORISÉ"), { status: 403 });
      if (!status.test_mode_enabled) throw Object.assign(new Error("TEST_MODE_DISABLED"), { status: 503, code: "TEST_MODE_DISABLED" });
      if (!status.engine_available) throw Object.assign(new Error("ENGINE_UNAVAILABLE"), { status: 503, code: "ENGINE_UNAVAILABLE" });
      if (status.records_attendance !== false) throw new Error("Le contrat ne confirme pas l'absence de pointage.");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error("Cette caméra nécessite un contexte sécurisé HTTPS et un navigateur compatible."), { camera: true });
      }
      F.running = true;
      updateControls();
      try {
        await openSelectedCamera(true);
      } catch (error) {
        F.running = false;
        stopTracks();
        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError" || error.name === "SecurityError") statusText("CAMÉRA NON AUTORISÉE — autorisez l'accès caméra dans le navigateur.", "error");
        else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") statusText("CAMÉRA INDISPONIBLE — aucun périphérique vidéo détecté.", "error");
        else if (error.name === "NotReadableError" || error.name === "TrackStartError") statusText("CAMÉRA OCCUPÉE — fermez les autres applications qui l'utilisent.", "error");
        else statusText("CAMÉRA INDISPONIBLE — vérifiez les permissions et réessayez.", "error");
        updateControls();
        return;
      }
      if (!F.running) return;
      statusText("EN ATTENTE D'UN VISAGE", "ready");
      F.timer = setTimeout(analyze, 500);
    } catch (error) {
      if (error.camera) statusText(error.message, "error");
      else statusText(messageForError(error), error.status === 403 || error.status === 503 ? "error" : "warning");
    }
  }

  async function changeCamera() {
    if (!F.running || F.busy) return;
    stopTracks();
    try {
      await openSelectedCamera(false);
      statusText("EN ATTENTE D'UN VISAGE", "ready");
    } catch (error) {
      stop();
      statusText("CAMÉRA INDISPONIBLE — sélectionnez une autre caméra et réessayez.", "error");
    }
  }

  function attach() {
    if (F.loaded) return;
    F.loaded = true;
    $("tm-start").addEventListener("click", start);
    $("tm-stop").addEventListener("click", stop);
    $("tm-change-camera").addEventListener("click", changeCamera);
    $("tm-site").addEventListener("change", updateControls);
    $("tm-camera").addEventListener("change", changeCamera);
    const nav = document.querySelector('[data-view="test-mode"]');
    if (nav) nav.addEventListener("click", () => { syncSites(); refreshStatus(); });
    const siteGlobal = $("f-site");
    if (siteGlobal) siteGlobal.addEventListener("change", syncSites);
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
    window.addEventListener("pagehide", stop);
    window.addEventListener("beforeunload", stop);
    const app = $("app");
    if (app && window.MutationObserver) new MutationObserver(() => { if (!app.classList.contains("hidden")) refreshStatus(); }).observe(app, { attributes: true, attributeFilter: ["class"] });
    if (app && !app.classList.contains("hidden")) refreshStatus();
  }

  window.ATLASTestMode = { start, stop, load: refreshStatus, renderResult, changeCamera, state: F };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();
})();
