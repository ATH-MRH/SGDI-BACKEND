/* Borne de pointage ATLAS — tablette Samsung / smartphone (circuit B de production).
 *
 * Distinct du Mode Test (aucune image de test n'enregistre jamais de présence) et des caméras
 * Dahua lues par le serveur. Le navigateur ne devient une borne qu'après ASSOCIATION par un
 * administrateur (code à usage unique) : la page génère alors une clé ECDSA P-256 NON
 * EXTRACTIBLE (WebCrypto), conservée dans IndexedDB, et signe chaque requête. Aucune session
 * humaine, aucun mot de passe, aucune administration, aucun lien de navigation.
 *
 * Parcours normal, zéro clic : PRÊT → mouvement devant la caméra → défi serveur (usage
 * unique, quelques secondes) → rafale live → reconnaissance serveur (liveness, 1:N du site,
 * Attendance Core) → ENTRÉE / SORTIE affichée SEULEMENT après confirmation serveur → pause →
 * réarmement quand la scène change (la personne s'en va). Hors ligne : FAIL CLOSED — rien
 * n'est enregistré ni mis en file d'attente localement.
 */
(function () {
  "use strict";

  const TIMING = {
    SAMPLE_MS: 300,          // échantillon de mouvement 32×24 (quasi gratuit)
    QR_EVERY: 2,             // lecture QR (BarcodeDetector) un échantillon sur deux
    MOTION: 7,               // écart moyen de luminance (0–255) : quelqu'un bouge
    LEAVE: 12,               // écart vs la scène du pointage : la personne est partie / a changé
    RESULT_MS: 3000,         // confirmation affichée
    HOLD_MAX_MS: 20000,      // réarmement forcé (le serveur refuse de toute façon un doublon)
    RETRY_MS: 1500,          // après NO_FACE / qualité : attendre un nouveau mouvement
    MESSAGE_MS: 3500,        // refus affichés
    UNAVAILABLE_MS: 5000,    // réseau / serveur indisponible : nouvel essai
    STATUS_POLL_MS: 30000,   // terminal désactivé / facial coupé : relecture de l'état
    HEARTBEAT_MS: 30000,     // battement de cœur au repos (cadence réelle donnée par le serveur)
    COMMAND_POLL_MS: 2000,   // « ai-je une commande ? » (prise de photo distante) — au repos
    CAPTURE_POLL_MS: 1000,   // pendant une prise de photo
    CAPTURE_RETRY_MS: 1500,  // délai minimal entre deux photos candidates
    CHECK_MS: 400,           // contrôle de cadrage (image réduite du cercle) — par défaut
    STABLE_MS: 800,          // cadrage correct et immobile pendant 0,8 s avant la photo candidate
  };
  // Cercle de capture : diamètre = 84 % du plus petit côté de la zone vidéo VISIBLE, centré.
  const GUIDE_RATIO = 0.84;
  const DOMAIN = "ATLAS-TERMINAL-1";
  const UNAVAILABLE = "SERVICE TEMPORAIREMENT INDISPONIBLE";
  const FALLBACK = "UTILISEZ LE QR OU LA MÉTHODE DE SECOURS";

  // ── Dépendances (remplaçables par les tests) ────────────────────────────────────────────
  const idbStore = {
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("atlas-borne", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    },
    get(key) { return this.run("readonly", (s) => s.get(key)); },
    set(key, value) { return this.run("readwrite", (s) => s.put(value, key)); },
    clear() { return this.run("readwrite", (s) => s.clear()); },
  };

  const B = {
    identity: null,          // { terminal_id, privateKey (CryptoKey non extractible), camera }
    session: null,
    clockOffset: 0,
    state: "BOOT",
    busy: false,
    holdScene: null, holdUntil: 0, pauseUntil: 0,
    lastSample: null, lastAnalyzed: null, tickCount: 0, timer: null, stream: null,
    remote: null,            // prise de photo distante en cours { session_id, status, nonce, … } — sinon null
    commandAt: 0,
    deps: {
      fetch: (...a) => window.fetch(...a),
      subtle: () => window.crypto.subtle,
      store: idbStore,
      now: () => Date.now(),
      media: () => navigator.mediaDevices,
      barcode: () => ("BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null),
      faceDetector: () => ("FaceDetector" in window ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 }) : null),
    },
  };
  window.AtlasBorne = B;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // ── Affichage ─────────────────────────────────────────────────────────────────────────────
  function show(state, title, detail, tone) {
    B.state = state;
    const box = $("kioskStatus");
    if (!box) return;
    box.dataset.state = state;
    box.className = "kiosk-status tone-" + (tone || "idle");
    box.innerHTML = `<div class="kiosk-title">${title}</div>${detail ? `<div class="kiosk-detail">${detail}</div>` : ""}`;
  }

  const SCREENS = {
    READY: () => show("READY", "PRÉSENTEZ VOTRE VISAGE", "", "idle"),
    DETECTED: () => show("DETECTED", "VISAGE DÉTECTÉ", "Restez immobile…", "work"),
    ANALYZING: () => show("ANALYZING", "ANALYSE EN COURS…", "", "work"),
    NO_FACE: () => show("NO_FACE", "PRÉSENTEZ VOTRE VISAGE", "Placez-vous face à la tablette", "idle"),
    MULTIPLE_FACES: () => show("MULTIPLE_FACES", "PLUSIEURS VISAGES", "Présentez-vous un par un", "warn"),
    QUALITY_FAILED: () => show("QUALITY_FAILED", "QUALITÉ INSUFFISANTE", "Approchez-vous, restez immobile, face à la lumière", "warn"),
    REVIEW_REQUIRED: () => show("REVIEW_REQUIRED", "QUALITÉ INSUFFISANTE", "Reconnaissance incertaine — restez face à la tablette", "warn"),
    LIVENESS_FAILED: () => show("LIVENESS_FAILED", "LIVENESS REFUSÉ", "Présence réelle non confirmée — aucun pointage", "error"),
    UNKNOWN_FACE: () => show("UNKNOWN_FACE", "EMPLOYÉ NON IDENTIFIÉ", "Présentez-vous au bureau pour actualiser votre photo.", "error"),
    AMBIGUOUS: () => show("AMBIGUOUS", "RÉSULTAT AMBIGU", "Aucun pointage — " + FALLBACK.toLowerCase(), "error"),
    UNAVAILABLE: () => show("UNAVAILABLE", UNAVAILABLE, FALLBACK, "error"),
    FACIAL_OFF: (msg) => show("FACIAL_OFF", "POINTAGE FACIAL INDISPONIBLE", esc(msg || "") + (msg ? "<br>" : "") + FALLBACK, "warn"),
    DISABLED: () => show("DISABLED", "TERMINAL DÉSACTIVÉ", "Contactez un responsable — " + FALLBACK.toLowerCase(), "error"),
    UNAUTHORIZED: () => show("UNAUTHORIZED", "TERMINAL NON AUTORISÉ", "Association requise par un administrateur", "error"),
    CAMERA_DENIED: () => show("CAMERA_DENIED", "CAMÉRA REFUSÉE", "Autorisez la caméra pour ce site dans les réglages de la tablette", "error"),
    CAMERA_LOST: () => show("CAMERA_LOST", "CAMÉRA INTERROMPUE", "Reconnexion…", "error"),
  };

  // ── Prise de photo distante supervisée (commandée depuis DRH → Fiche de position) ────────
  // Le terminal reste un terminal de POINTAGE : il interroge le serveur (requête signée) et,
  // sur commande, sert quelques instants de caméra. Pendant ce temps il ne reconnaît personne,
  // ne lit aucun QR et n'enregistre aucun pointage. La vidéo ne quitte jamais l'appareil :
  // seules des photos fixes sont proposées au serveur. Fin, annulation, expiration ou
  // serveur muet : retour automatique au pointage.
  // ── Géométrie canonique du cercle de capture ─────────────────────────────────────────────
  // UNE seule fonction pure donne, pour un élément vidéo affiché (taille CSS, object-fit,
  // miroir) et une vidéo source (taille intrinsèque) : le cercle à DESSINER (repère de
  // l'élément, tel qu'affiché) et le CARRÉ à recadrer dans la vidéo source (pixels réels,
  // non miroir). Dessin, contrôle et recadrage en dérivent tous : ce qui est dans le cercle à
  // l'écran est exactement ce qui est envoyé. Les coordonnées CSS ne sont jamais prises pour
  // des pixels vidéo.
  function guideGeometry(view) {
    const { elW, elH, vw, vh } = view;
    const fit = view.fit || "cover", mirrored = view.mirrored !== false, ratio = view.ratio || GUIDE_RATIO;
    if (!(elW > 0 && elH > 0 && vw > 0 && vh > 0)) return null;
    const scale = fit === "contain" ? Math.min(elW / vw, elH / vh) : Math.max(elW / vw, elH / vh);
    const dispW = vw * scale, dispH = vh * scale;
    const ox = (elW - dispW) / 2, oy = (elH - dispH) / 2;                 // < 0 : vidéo rognée (cover)
    const visL = Math.max(0, ox), visT = Math.max(0, oy), visW = Math.min(elW, dispW), visH = Math.min(elH, dispH);
    const d = ratio * Math.min(visW, visH);
    const cx = visL + visW / 2, cy = visT + visH / 2;                     // centre affiché
    const ux = mirrored ? elW - cx : cx;                                  // même point, élément non miroir
    let side = Math.min(d / scale, vw, vh);
    let sx = (ux - ox) / scale - side / 2, sy = (cy - oy) / scale - side / 2;
    sx = Math.min(Math.max(0, sx), vw - side); sy = Math.min(Math.max(0, sy), vh - side);
    return { display: { cx, cy, d }, video: { sx, sy, side }, scale, mirrored, fit };
  }

  function liveGuide() {
    const video = $("kioskVideo");
    if (!video || !video.videoWidth) return null;
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle ? window.getComputedStyle(video) : {};
    return guideGeometry({ elW: rect.width, elH: rect.height, vw: video.videoWidth, vh: video.videoHeight,
      fit: style.objectFit === "contain" ? "contain" : "cover", mirrored: /matrix\(-1|scaleX\(-1/.test(String(style.transform || "")) || style.transform === undefined });
  }

  // Le cercle affiché pendant une prise est posé EXACTEMENT sur la géométrie canonique.
  function layoutGuide(state) {
    const frame = document.querySelector(".kiosk-frame");
    const video = $("kioskVideo");
    if (!frame) return;
    if (!B.remote) { frame.removeAttribute("style"); frame.classList.remove("is-guide", "guide-ok", "guide-error"); return; }
    const geo = liveGuide();
    if (geo && video && frame.parentElement) {
      const v = video.getBoundingClientRect(), p = frame.parentElement.getBoundingClientRect();
      Object.assign(frame.style, { left: `${v.left - p.left + geo.display.cx - geo.display.d / 2}px`, top: `${v.top - p.top + geo.display.cy - geo.display.d / 2}px`,
        width: `${geo.display.d}px`, height: `${geo.display.d}px` });
    }
    frame.classList.add("is-guide");
    frame.classList.toggle("guide-ok", state === "ok");
    frame.classList.toggle("guide-error", state === "error");
  }

  // Recadrage : le carré du cercle, dans la vidéo source, en `maxSide` px au plus (jamais agrandi).
  B.cropGuide = function (source, geo, maxSide, quality) {
    const out = Math.max(1, Math.round(Math.min(maxSide, geo.video.side)));
    const c = document.createElement("canvas");
    c.width = c.height = out;
    c.getContext("2d").drawImage(source, geo.video.sx, geo.video.sy, geo.video.side, geo.video.side, 0, 0, out, out);
    return c.toDataURL("image/jpeg", quality);
  };
  B.captureGuide = function (maxSide, quality) {
    const geo = liveGuide();
    return geo ? B.cropGuide($("kioskVideo"), geo, maxSide, quality) : null;
  };
  B.guideGeometry = guideGeometry;
  B.layoutGuide = layoutGuide;

  function captureBanner(on) {
    const el = $("kioskMode");
    if (el) { el.hidden = !on; el.textContent = on ? "PRISE DE PHOTO EN COURS" : ""; }
    document.body.classList.toggle("kiosk-capturing", Boolean(on));
  }

  function showCapture(detail, tone) {
    const who = B.remote && B.remote.employee ? `${esc(B.remote.employee.nom)} ${esc(B.remote.employee.prenom)}` : "";
    show("CAPTURE", "PRISE DE PHOTO", (who ? who + "<br>" : "") + esc(detail), tone || "work");
  }

  function leaveCapture() {
    if (!B.remote) return;
    B.remote = null;
    captureBanner(false);
    layoutGuide();
    // La personne photographiée est encore devant la borne : aucun pointage tant que la scène
    // n'a pas changé (même réarmement qu'après un pointage).
    B.holdScene = B.lastAnalyzed = B.lastSample;
    B.holdUntil = B.deps.now() + TIMING.HOLD_MAX_MS;
    B._lastQr = null;
    if (facialOn()) SCREENS.READY(); else SCREENS.FACIAL_OFF(B.session && B.session.facial && B.session.facial.message);
  }

  async function enterCapture(command) {
    B.remote = { session_id: command.session_id, status: command.status, employee: command.employee, capture: command.capture || {},
      nonce: null, okSince: 0, lastCheck: 0, lastTry: 0, attempt: command.attempt };
    captureBanner(true);
    layoutGuide("adjust");
    showCapture("Placez votre visage dans le cercle");
    await acknowledgeCapture();
  }

  async function acknowledgeCapture() {
    try {
      const out = await call("POST", "/terminal/capture/ack", { session_id: B.remote.session_id });
      if (!B.remote) return;
      B.remote.status = out.status; B.remote.nonce = out.nonce; B.remote.attempt = out.attempt; B.remote.okSince = 0;
      if (out.capture) B.remote.capture = out.capture;
      layoutGuide("adjust");                          // reprise : géométrie et feu remis à zéro
      showCapture("Placez votre visage dans le cercle");
    } catch (e) {
      if (e.status === 409 || e.status === 503) leaveCapture(); else handleError(e);
    }
  }

  // Relève des commandes : au repos toutes les 2 s, pendant une prise chaque seconde.
  async function pollCommand() {
    B.commandAt = B.deps.now();
    let out;
    try { out = await call("GET", "/terminal/command"); } catch (e) {
      if (B.remote && (e.status === 401 || e.status === 403)) leaveCapture();
      if (e.status === 401 || e.status === 403) handleError(e);
      return;                                         // réseau : la session expire seule côté serveur
    }
    if (!out || out.command !== "CAPTURE_PHOTO") { leaveCapture(); return; }
    if (!B.remote || B.remote.session_id !== out.session_id) { await enterCapture(out); return; }
    B.remote.employee = out.employee;
    if (out.status === "RETAKE_REQUESTED" || (out.status === "REQUESTED")) { B.remote.status = out.status; await acknowledgeCapture(); return; }
    if (out.status === "PREVIEW_READY" && B.remote.status !== "PREVIEW_READY") { B.remote.status = out.status; layoutGuide("ok"); showCapture("Photo prise — vérification en cours…", "ok"); }
  }

  // Battement de cœur : même sans aucun passage, la borne relit son état à intervalle fixe. Le
  // serveur distingue ainsi une borne au repos (elle bat) d'une borne déconnectée (elle se tait).
  function heartbeatDue() {
    const now = B.deps.now();
    if (B.heartbeatAt == null) { B.heartbeatAt = now; return false; }
    return now - B.heartbeatAt >= ((B.session && B.session.heartbeat_ms) || TIMING.HEARTBEAT_MS);
  }
  async function heartbeat() {
    B.heartbeatAt = B.deps.now();
    try { B.session = await call("GET", "/terminal/session?hb=1"); }
    catch (e) { if (e.status === 401 || e.status === 403) handleError(e); return; }   // réseau : nouvel essai au prochain battement
    if (B.remote) return;
    if (facialOn()) { if (B.state === "FACIAL_OFF" || B.state === "UNAVAILABLE") SCREENS.READY(); }
    else if (B.state === "READY") SCREENS.FACIAL_OFF(B.session.facial.message);
  }

  function commandDue() {
    if (!B.session || !B.session.remote_capture || !B.session.remote_capture.enabled) return Boolean(B.remote);
    return B.deps.now() - B.commandAt >= (B.remote ? TIMING.CAPTURE_POLL_MS : TIMING.COMMAND_POLL_MS);
  }

  // Une itération en mode prise de photo. Le cadrage est contrôlé par le SERVEUR sur le seul
  // carré du cercle (image réduite, jamais conservée) ; le cercle passe au vert quand la tête
  // entière est dans la zone sûre. La photo candidate n'est envoyée qu'après un cadrage resté
  // correct et immobile pendant STABLE_MS ; tout écart remet le compteur à zéro.
  function guideFeedback(out) {
    const error = out.state === "MULTIPLE_FACES";
    B._guideState = out.ok ? "ok" : error ? "error" : "adjust";
    layoutGuide(out.ok ? "ok" : error ? "error" : "adjust");
    showCapture(out.instruction || "Placez votre visage dans le cercle", out.ok ? "ok" : error ? "error" : "warn");
  }

  async function captureTick(current, previous) {
    const r = B.remote;
    if (!r || r.status !== "WAITING_FOR_FACE" || !r.nonce || !current) return;
    const now = B.deps.now(), spec = r.capture || {};
    if (previous && diff(current, previous) >= TIMING.MOTION) r.okSince = 0;     // mouvement : on recommence
    layoutGuide(r.okSince ? "ok" : B._guideState);                               // cercle dessiné = zone recadrée, à chaque instant
    try {
      if (r.okSince && now - r.okSince >= (spec.stable_ms || TIMING.STABLE_MS) && now - r.lastTry >= (spec.min_interval_ms || TIMING.CAPTURE_RETRY_MS)) {
        const photo = B.captureGuide(spec.max_side || 640, spec.jpeg_quality || 0.9);
        if (!photo) return;
        r.lastTry = now;
        const nonce = r.nonce; r.nonce = null;          // jeton à usage unique
        const out = await call("POST", "/terminal/capture/photo", { session_id: r.session_id, nonce, photo });
        if (B.remote !== r) return;
        if (out.accepted) { r.status = "PREVIEW_READY"; layoutGuide("ok"); showCapture("Photo prise — vérification en cours…", "ok"); return; }
        r.nonce = out.nonce; r.okSince = 0;
        guideFeedback({ ok: false, state: out.state, instruction: out.instruction });
        return;
      }
      if (now - r.lastCheck < (spec.check_interval_ms || TIMING.CHECK_MS)) return;
      const photo = B.captureGuide(spec.check_side || 480, 0.8);
      if (!photo) return;
      r.lastCheck = now;
      const out = await call("POST", "/terminal/capture/check", { session_id: r.session_id, photo });
      if (B.remote !== r) return;
      r.okSince = out.ok ? (r.okSince || now) : 0;
      guideFeedback(out);
    } catch (e) {
      r.okSince = 0;
      if (e.status === 409 || e.status === 503) { B.commandAt = 0; return; }   // session close ou reprise : la relève tranchera
      if (e.status === 401 || e.status === 403) { leaveCapture(); handleError(e); return; }
      if (B.remote === r) showCapture("Connexion interrompue — nouvel essai…", "warn");
      B.commandAt = 0;
    }
  }

  window.addEventListener("resize", () => { if (B.remote) layoutGuide(B.remote.okSince ? "ok" : "adjust"); });

  function showRecorded(result) {
    const e = result.employee || {};
    const already = result.state === "ALREADY_RECORDED";
    const verb = result.action === "SORTIE" ? "SORTIE ENREGISTRÉE" : "ENTRÉE ENREGISTRÉE";
    show(already ? "ALREADY_RECORDED" : "RECORDED", already ? "POINTAGE DÉJÀ ENREGISTRÉ" : "✓ " + esc(e.nom) + " " + esc(e.prenom),
      (already ? esc(e.nom) + " " + esc(e.prenom) + "<br>" : "") + `Matricule ${esc(e.matricule)}` +
      `<div class="kiosk-verb">${already ? esc(result.action || "") : verb} · ${esc(result.heure || "")}</div>`, "ok");
  }

  // ── Signature des requêtes ────────────────────────────────────────────────────────────────
  async function sha256hex(bytes) {
    const digest = await B.deps.subtle().digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function signedHeaders(method, path, bodyBytes) {
    const ts = String(Math.round(B.deps.now() + B.clockOffset));
    const message = [DOMAIN, B.identity.terminal_id, method, path, ts, await sha256hex(bodyBytes)].join("\n");
    const sig = await B.deps.subtle().sign({ name: "ECDSA", hash: "SHA-256" }, B.identity.privateKey, new TextEncoder().encode(message));
    return { "X-Atlas-Terminal": B.identity.terminal_id, "X-Atlas-Timestamp": ts, "X-Atlas-Signature": b64url(sig) };
  }

  class ApiError extends Error {
    constructor(status, detail) {
      super((detail && detail.message) || (typeof detail === "string" ? detail : "Erreur " + status));
      this.status = status; this.code = detail && detail.code; this.detail = detail;
    }
  }

  const REQUEST_TIMEOUT_MS = 30000;

  async function call(method, path, body) {
    const full = "/api/biometrics" + path;
    const raw = body === undefined ? "" : JSON.stringify(body);
    const bytes = new TextEncoder().encode(raw);
    const headers = Object.assign({ "Content-Type": "application/json" }, B.identity ? await signedHeaders(method, full, bytes) : {});
    let res;
    try {
      // Délai d'expiration : sans lui, une requête sans réponse laissait la borne figée sur
      // « ANALYSE EN COURS… » (B.busy jamais relâché), jusqu'au rechargement de la page.
      const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
      res = await B.deps.fetch(full, { method, headers, body: raw || undefined, cache: "no-store", signal });
    } catch (e) {
      throw new ApiError(0, { code: "NETWORK", message: UNAVAILABLE });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new ApiError(res.status, data && data.detail);
    return data;
  }

  // ── Association (première installation, par un administrateur) ─────────────────────────
  async function pair(code, cameraId) {
    const keys = await B.deps.subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const jwk = await B.deps.subtle().exportKey("jwk", keys.publicKey);   // la clé PUBLIQUE seulement
    B.identity = null;
    const out = await call("POST", "/terminal/pair", { code, public_key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      device_label: (navigator.userAgent || "").slice(0, 120) });
    B.identity = { terminal_id: out.terminal_id, privateKey: keys.privateKey, camera: cameraId || null };
    await B.deps.store.set("identity", B.identity);
    return out;
  }

  function showPairing(message) {
    B.state = "PAIRING";
    const panel = $("kioskPairing");
    if (panel) panel.hidden = false;
    if ($("pairMessage")) $("pairMessage").textContent = message || "";
    const code = (location.hash.match(/pair=([A-Za-z0-9-]+)/) || [])[1];
    if (code && $("pairCode")) {
      $("pairCode").value = code;
      history.replaceState(null, "", location.pathname);    // le code ne reste pas dans l'URL
    }
    listCameras();
  }

  async function listCameras() {
    const select = $("pairCamera");
    const media = B.deps.media();
    if (!select || !media || !media.enumerateDevices) return;
    try {
      const devices = (await media.enumerateDevices()).filter((d) => d.kind === "videoinput");
      select.innerHTML = `<option value="">Caméra frontale (par défaut)</option>` +
        devices.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || "Caméra " + (i + 1))}</option>`).join("");
    } catch (e) { /* liste facultative */ }
  }

  async function submitPairing(event) {
    if (event) event.preventDefault();
    const code = ($("pairCode").value || "").trim();
    if (!code) return;
    $("pairSubmit").disabled = true;
    try {
      await pair(code, ($("pairCamera") && $("pairCamera").value) || null);
      $("kioskPairing").hidden = true;
      await boot();
    } catch (e) {
      $("pairMessage").textContent = e.status === 0 ? UNAVAILABLE : (e.message || "Association impossible");
    } finally {
      $("pairSubmit").disabled = false;
    }
  }

  // ── Caméra ────────────────────────────────────────────────────────────────────────────────
  async function startCamera() {
    const video = $("kioskVideo");
    const constraints = { audio: false, video: B.identity.camera
      ? { deviceId: { exact: B.identity.camera }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } };
    try {
      B.stream = await B.deps.media().getUserMedia(constraints);
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) { SCREENS.CAMERA_DENIED(); return false; }
      SCREENS.CAMERA_LOST(); return false;
    }
    B.stream.getVideoTracks().forEach((t) => t.addEventListener("ended", () => { stop(); SCREENS.CAMERA_LOST(); schedule(TIMING.UNAVAILABLE_MS, restartCamera); }));
    if (video) {
      video.srcObject = B.stream;
      try { await video.play(); } catch (e) { /* autoplay muet autorisé */ }
    }
    return true;
  }

  async function restartCamera() {
    if (B.stream) B.stream.getTracks().forEach((t) => t.stop());
    B.stream = null;
    if (await startCamera()) { start(); if (facialOn()) SCREENS.READY(); else SCREENS.FACIAL_OFF(B.session.facial.message); }
    else schedule(TIMING.UNAVAILABLE_MS, restartCamera);
  }

  // Échantillon de luminance 32×24 : détection de mouvement sans moteur ML dans le navigateur.
  B.sample = function () {
    const video = $("kioskVideo");
    if (!video || !video.videoWidth) return null;
    const c = B._small || (B._small = Object.assign(document.createElement("canvas"), { width: 32, height: 24 }));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 24);
    const px = ctx.getImageData(0, 0, 32, 24).data;
    const out = new Uint8Array(32 * 24);
    for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
    return out;
  };

  const diff = (a, b) => {
    if (!a || !b) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  };

  B.capture = function (maxSide, quality) {
    const video = $("kioskVideo");
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const c = B._big || (B._big = document.createElement("canvas"));
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Attend une NOUVELLE image du capteur (caméra lente, faible lumière) : deux trames d'une
  // rafale ne sont jamais la même image affichée.
  function nextVideoFrame() {
    const video = $("kioskVideo");
    if (!video || typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
    return new Promise((resolve) => { const t = setTimeout(resolve, 500); video.requestVideoFrameCallback(() => { clearTimeout(t); resolve(); }); });
  }

  async function burst(spec) {
    const frames = [];
    for (let i = 0; i < spec.frames; i++) {
      if (i) { await wait(spec.interval_ms); await nextVideoFrame(); }
      frames.push(B.capture(spec.max_side, spec.jpeg_quality));
    }
    return frames;
  }

  // ── Boucle ───────────────────────────────────────────────────────────────────────────────
  function schedule(ms, fn) {
    clearTimeout(B.timer);
    B.timer = setTimeout(fn, ms);
  }

  function poll(ms) {
    clearTimeout(B.pollTimer);
    B.pollTimer = setTimeout(refresh, ms);
  }

  // Relecture de l'état du terminal (facial réactivé/coupé, terminal réactivé) sans clic.
  async function refresh() {
    try {
      B.session = await call("GET", "/terminal/session");
    } catch (e) {
      handleError(e);
      return;
    }
    if (!B.running) { boot(); return; }
    if (B.remote) { if (!facialOn()) poll(TIMING.STATUS_POLL_MS); return; }   // prise de photo : l'écran lui est réservé
    if (facialOn()) { if (B.state === "FACIAL_OFF" || B.state === "UNAVAILABLE") SCREENS.READY(); }
    else { SCREENS.FACIAL_OFF(B.session.facial.message); poll(TIMING.STATUS_POLL_MS); }
  }

  function facialOn() { return Boolean(B.session && B.session.facial && B.session.facial.available); }

  // Une itération : échantillon → QR éventuel → mouvement → reconnaissance. Exposée aux tests.
  B.tick = async function () {
    if (B.busy) return;                              // un pointage engagé se termine toujours d'abord
    const now = B.deps.now();
    const current = B.sample();
    const previous = B.lastSample;
    B.lastSample = current;
    B.tickCount++;
    if (commandDue()) {
      B.busy = true;
      try { await pollCommand(); } finally { B.busy = false; }
    }
    if (heartbeatDue()) {
      B.busy = true;
      try { await heartbeat(); } finally { B.busy = false; }
    }
    if (B.remote) {                                  // terminal réservé : ni QR, ni reconnaissance, ni pointage
      B.busy = true;
      try { await captureTick(current, previous); } finally { B.busy = false; }
      return;
    }
    if (now < B.pauseUntil) return;
    if (B.holdScene) {
      // Réarmement : la scène doit avoir changé depuis le pointage (personne partie), ou délai max.
      if (diff(current, B.holdScene) < TIMING.LEAVE && now < B.holdUntil) return;
      B.holdScene = null;
      SCREENS.READY();
    }
    if (B.tickCount % TIMING.QR_EVERY === 0 && await tryQr()) return;
    if (!facialOn()) return;
    // Analyse si la scène bouge OU diffère de la dernière scène analysée : une personne arrivée
    // pendant une pause puis immobile est analysée ; une scène inchangée ne l'est qu'une fois.
    const changed = B.lastAnalyzed === null || diff(current, previous) >= TIMING.MOTION || diff(current, B.lastAnalyzed) >= TIMING.MOTION;
    if (!changed) return;
    await recognizeOnce();
  };

  // Boucle unique (tant que la caméra tourne) ; le QR reste actif même si le facial est coupé.
  async function loop() {
    try { await B.tick(); } catch (e) { /* une itération ratée ne bloque pas la borne */ }
    if (B.running) schedule(TIMING.SAMPLE_MS, loop);
  }

  async function tryQr() {
    const detector = B._barcode === undefined ? (B._barcode = B.deps.barcode()) : B._barcode;
    const video = $("kioskVideo");
    if (!detector || !video) return false;
    let codes = [];
    try { codes = await detector.detect(video); } catch (e) { return false; }
    const token = codes[0] && codes[0].rawValue;
    if (!token || token === B._lastQr) return false;
    B._lastQr = token;
    B.busy = true;
    SCREENS.ANALYZING();
    try {
      handleResult(await call("POST", "/terminal/qr", { token }));
    } catch (e) {
      // Panne de transport ou erreur serveur : le QR n'a pas été traité. Il doit pouvoir être
      // présenté de nouveau (il restait ignoré sans message jusqu'au rechargement de la page).
      if (!e || !e.status || e.status >= 500) B._lastQr = null;
      if (!handleError(e)) { show("QR_REFUSED", "QR REFUSÉ", esc(e.message), "error"); pause(TIMING.MESSAGE_MS); }
    } finally { B.busy = false; }
    return true;
  }

  function pause(ms) { B.pauseUntil = B.deps.now() + ms; }

  function hold() {
    // Même visage resté devant la tablette : aucune nouvelle tentative avant que la scène change.
    B.holdScene = B.lastSample;
    B.pauseUntil = B.deps.now() + TIMING.RESULT_MS;
    B.holdUntil = B.deps.now() + TIMING.HOLD_MAX_MS;
  }

  async function recognizeOnce() {
    B.busy = true;
    B.lastAnalyzed = B.lastSample;
    try {
      const detector = B._faces === undefined ? (B._faces = B.deps.faceDetector()) : B._faces;
      if (detector) {
        // Pré-filtre local facultatif (API du navigateur) : aucun envoi sans visage apparent.
        try { if (!(await detector.detect($("kioskVideo"))).length) return; } catch (e) { /* pas de pré-filtre */ }
        SCREENS.DETECTED();
      }
      const challenge = await call("POST", "/terminal/challenge", {});
      SCREENS.ANALYZING();
      const frames = await burst(challenge.burst || B.session.burst);
      handleResult(await call("POST", "/terminal/recognize", { challenge_id: challenge.challenge_id, nonce: challenge.nonce, frames }));
    } catch (e) {
      handleError(e);
    } finally {
      B.busy = false;
    }
  }

  function handleResult(result) {
    const s = result.state;
    if (s === "ATTENDANCE_RECORDED" || s === "ALREADY_RECORDED") { showRecorded(result); hold(); return; }
    (SCREENS[s] || SCREENS.UNAVAILABLE)();
    if (s === "NO_FACE") { pause(TIMING.RETRY_MS); return; }
    if (s === "UNKNOWN_FACE" || s === "AMBIGUOUS" || s === "LIVENESS_FAILED") { hold(); B.pauseUntil = B.deps.now() + TIMING.MESSAGE_MS; return; }
    if (s === "REFUSED") show("REFUSED", "POINTAGE REFUSÉ", esc(result.message) + "<br>" + FALLBACK, "error");
    pause(TIMING.MESSAGE_MS);
  }

  // Renvoie true si l'erreur a été affichée. Aucune reconnaissance n'est conservée pour être
  // rejouée : hors ligne, la borne refuse (fail closed) et oriente vers le QR / la saisie.
  function handleError(e) {
    const code = e && e.code;
    if (e.status === 401) {
      stop();
      SCREENS.UNAUTHORIZED();
      if (code === "TERMINAL_REVOKED" || code === "TERMINAL_UNKNOWN") {
        B.identity = null;
        B.deps.store.clear().catch(() => {});
        showPairing("Terminal non autorisé : une nouvelle association par un administrateur est nécessaire.");
      } else poll(TIMING.STATUS_POLL_MS);          // signature refusée (horloge ?) : nouvel essai plus tard
      return true;
    }
    if (e.status === 403 && code === "TERMINAL_DISABLED") { stop(); SCREENS.DISABLED(); poll(TIMING.STATUS_POLL_MS); return true; }
    if (["BIOMETRIC_DISABLED", "ENGINE_UNAVAILABLE", "TERMINAL_FACIAL_DISABLED"].includes(code)) {
      if (B.session) B.session.facial = { available: false, code, message: e.message };
      SCREENS.FACIAL_OFF(e.message);
      poll(TIMING.STATUS_POLL_MS);
      return true;
    }
    if (e.status === 0 || e.status >= 500) { SCREENS.UNAVAILABLE(); pause(TIMING.UNAVAILABLE_MS); poll(TIMING.UNAVAILABLE_MS); return true; }
    if (e.status === 429) { SCREENS.UNAVAILABLE(); pause(10000); return true; }
    // Défi expiré / réutilisé / rejeu / rafale invalide : nouvel essai propre, sans bruit.
    SCREENS.READY();
    pause(TIMING.RETRY_MS);
    return ["CHALLENGE_EXPIRED", "CHALLENGE_REUSED", "CHALLENGE_STALE", "CHALLENGE_INVALID", "REPLAY_DETECTED"].includes(code);
  }

  function stop() { B.running = false; clearTimeout(B.timer); B.timer = null; }
  function start() { B.running = true; schedule(TIMING.SAMPLE_MS, loop); }

  // ── Démarrage ─────────────────────────────────────────────────────────────────────────────
  async function boot() {
    stop();
    clearTimeout(B.pollTimer);
    if (!B.identity) {
      try { B.identity = await B.deps.store.get("identity"); } catch (e) { B.identity = null; }
    }
    if (!B.identity || !B.identity.privateKey) { showPairing(); return; }
    try {
      B.session = await call("GET", "/terminal/session");
      B.clockOffset = B.session.server_time ? B.session.server_time - B.deps.now() : 0;
    } catch (e) {
      handleError(e);
      return;
    }
    const t = B.session.terminal;
    if ($("kioskSite")) $("kioskSite").textContent = `${t.name} · ${t.site || ""}`;
    if (!B.stream && !(await startCamera())) { schedule(TIMING.UNAVAILABLE_MS, boot); return; }
    if (facialOn()) SCREENS.READY();
    else { SCREENS.FACIAL_OFF(B.session.facial.message); poll(TIMING.STATUS_POLL_MS); }
    start();
    const keepAwake = async () => { try { if (navigator.wakeLock && document.visibilityState === "visible") await navigator.wakeLock.request("screen"); } catch (e) { /* facultatif */ } };
    await keepAwake();
    // Le navigateur relâche le verrou d'écran quand la page passe en arrière-plan : il est
    // redemandé au retour, sinon la borne se met en veille après une première interruption.
    document.addEventListener("visibilitychange", keepAwake);
  }

  B.boot = boot;
  B.pair = pair;
  B.handleResult = handleResult;
  B.handleError = handleError;
  B.pollCommand = pollCommand;
  B.TIMING = TIMING;

  document.addEventListener("DOMContentLoaded", () => {
    const form = $("pairForm");
    if (form) form.addEventListener("submit", submitPairing);
    if (window.__ATLAS_BORNE_NO_AUTOSTART__) return;
    boot();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/pointeur-sw.js", { scope: "/" }).catch(() => {});
  });
})();
