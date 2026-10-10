/* Pointeur terrain — pointage facial AUTOMATIQUE sur PLUSIEURS équipements à la fois.
 *
 * Au clic sur « Reconnaissance faciale », le poste lit auprès du serveur les équipements déjà
 * enregistrés par l'Administration Système, actifs, du périmètre Société/Site sélectionné ET
 * autorisés pour ce compte. Le pointeur en coche un, plusieurs ou tous, puis les active.
 * AUCUN appairage ici : il est fait une seule fois dans l'Administration Système.
 *
 * Deux natures d'équipement, jamais confondues :
 *  - caméra IP lue par le SERVEUR : le poste déclenche les essais (une boucle indépendante par
 *    caméra) ; le navigateur ne voit jamais la caméra et n'envoie JAMAIS d'image pour pointer
 *    (une image fournie par un navigateur pourrait être une photo injectée — docs/biometrics.md) ;
 *  - terminal autonome (borne /borne) : il pointe seul avec sa clé d'appareil. Le poste ne
 *    l'« active » pas à distance : il le SURVEILLE et affiche son état réel.
 * La caméra locale du poste (USB ou intégrée) n'est jamais utilisée pour pointer.
 *
 * Le module n'identifie que la personne. ENTRÉE / SORTIE, vacation, fenêtres, anti-doublon et
 * refus sont décidés par Attendance Core ; leur affichage est celui du poste. La panne d'un
 * équipement n'arrête pas les autres. Après une coupure réseau le résultat d'un essai est
 * INCONNU : il est vérifié auprès du serveur, jamais annoncé comme refusé.
 */
(function () {
  "use strict";
  const TICK_MS = 900;          // cadence d'essai d'une caméra en attente
  const RESULT_MS = 3500;       // affichage du résultat avant retour à l'attente
  const ERROR_RETRY_MS = 5000;  // reprise après erreur réseau/caméra
  const STATUS_MS = 10000;      // relevé d'état de TOUS les équipements (un seul appel)
  const PREVIEW_MS = 1000;      // aperçu : UNE seule caméra à la fois
  const STORE_KEY = "atlas_pointer_face_terminals";

  const F = {
    running: false, devices: [], selected: new Set(), runners: new Map(), monitored: new Set(), notes: new Map(),
    focusKey: null, previewTimer: null, previewUrl: null, previewBusy: false, statusTimer: null, displayUntil: 0, lastState: "",
    lastEvent: null, authorizedTotal: 0, engineReady: false,
    // État réellement connu, affiché dans « État du système » : jamais supposé.
    cameraState: "OFF", engineState: "OFF", siteId: "", generation: 0,
  };
  window.PointeurFacial = F;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = () => (window.pointerSession && window.pointerSession.token) || (typeof pointerSession !== "undefined" && pointerSession && pointerSession.token) || "";
  const site = () => (typeof selectedSiteId !== "undefined" ? selectedSiteId : "");
  const society = () => (typeof selectedSociety !== "undefined" ? selectedSociety : "");
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const clock = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d) ? "—" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const device = (key) => F.devices.find((d) => d.key === key) || null;
  const cameraId = (key) => key.split(":")[1];

  async function api(path, options) {
    const opts = options || {};
    const res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + token() }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && typeof logout === "function") { logout(); throw Object.assign(new Error("Session expirée"), { status: 401 }); }
    if (opts.raw) { if (!res.ok) throw Object.assign(new Error("Aperçu indisponible"), { status: res.status }); return res; }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const d = data && data.detail;
      throw Object.assign(new Error(typeof d === "string" ? d : (d && d.reasons && d.reasons[0]) || "Erreur " + res.status), { status: res.status });
    }
    return data;
  }
  const scopeQuery = () => {
    const params = new URLSearchParams();
    if (F.siteId) params.set("site_id", F.siteId);
    if (society()) params.set("society", society());
    const text = params.toString();
    return text ? "?" + text : "";
  };
  const scopeBody = (keys) => Object.assign({ keys }, F.siteId ? { site_id: Number(F.siteId) } : {}, society() ? { society: society() } : {});

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
    if (view) view.classList.toggle("no-video", !F.focusKey || !F.runners.has(F.focusKey));
    if (typeof renderSystemState === "function") renderSystemState();
  }
  const refreshPost = () => { if (typeof pollLive === "function") pollLive(); };

  // État d'ensemble pour « État du système » : dérivé des boucles réellement en cours.
  function syncSystem() {
    if (!F.running) return;
    const runners = Array.from(F.runners.values());
    const camera = !F.devices.length ? "NONE" : !runners.length ? (F.monitored.size ? "ACTIVE" : "NONE")
      : runners.some((r) => r.state === "ACTIVE") ? "ACTIVE" : runners.some((r) => r.state === "STARTING") ? "SEARCHING" : "UNAVAILABLE";
    const engine = !F.engineReady ? "DISABLED" : runners.length || F.monitored.size ? (runners.length && runners.every((r) => r.state !== "ACTIVE" && r.state !== "STARTING") ? "ERROR" : "ACTIVE") : "INIT";
    setSystem(camera, engine);
  }

  const MESSAGES = {
    NO_FACE: "PRÊT — placez-vous face à la caméra",
    MULTIPLE_FACES: "PLUSIEURS VISAGES DÉTECTÉS<br><small>Présentez-vous individuellement.</small>",
    QUALITY_FAILED: "IMAGE INSUFFISANTE",
    LIVENESS_FAILED: "POINTAGE REFUSÉ<br><small>Présence réelle non confirmée.</small>",
    REVIEW_REQUIRED: "RECONNAISSANCE INCERTAINE<br><small>Nouvel essai en cours…</small>",
    AMBIGUOUS: "RECONNAISSANCE AMBIGUË<br><small>Utilisez le pointage de secours.</small>",
  };
  const origin = (runner) => (F.runners.size + F.monitored.size > 1 ? `<small class="face-origin">${esc(runner.device.name)}${runner.device.site ? " · " + esc(runner.device.site) : ""}</small>` : "");

  // Résultat d'UNE caméra dans la zone centrale. Un simple « prêt » d'une caméra n'efface jamais
  // le résultat encore affiché d'une autre.
  function render(result, runner) {
    const s = result.state;
    const now = Date.now();
    const quiet = s === "NO_FACE" || s === "REVIEW_REQUIRED";
    if (quiet && now < F.displayUntil) return;
    if (!quiet) { F.displayUntil = now + (s === "QUALITY_FAILED" || s === "MULTIPLE_FACES" ? 1500 : RESULT_MS); focus(runner.key); }
    if (s === "ATTENDANCE_RECORDED" || s === "ALREADY_RECORDED") {
      // Une reconnaissance aboutie = une personne physiquement passée : même statut qu'une
      // lecture QR réelle pour la règle d'inactivité (jamais la caméra qui tourne à vide).
      if (typeof noteUserActivity === "function") noteUserActivity();
      const e = result.employee || {};
      const already = s === "ALREADY_RECORDED";
      setStatus(already ? "ALREADY" : "SUCCESS", `<div class="face-check">${already ? "✓ DÉJÀ ENREGISTRÉ" : "✓ POINTAGE ENREGISTRÉ"}</div>
        <div class="face-name">${esc(e.nom)} ${esc(e.prenom)}</div>
        <div class="face-meta">Matricule ${esc(e.matricule)}${e.poste ? " · " + esc(e.poste) : ""} · <b>${esc(result.action || "")}</b> · ${esc(result.heure || "")}${result.site ? " · " + esc(result.site) : ""}</div>${origin(runner)}`);
      runner.cooldownUntil = now + RESULT_MS;
      if (!already) F.lastEvent = { heure: result.heure || clock(new Date()), type: result.action === "SORTIE" ? "SORTIE" : "ENTREE", name: `${e.nom || ""} ${e.prenom || ""}`.trim(), matricule: e.matricule, terminal: runner.device.name };
      refreshPost();                                                  // fiche du poste : réel / planifié / comptabilisé
      return;
    }
    if (s === "UNKNOWN_FACE") {
      setStatus("UNKNOWN", `<div class="face-check">VISAGE INCONNU</div><small>Aucun pointage n'a été enregistré.</small>${origin(runner)}
        <button type="button" class="secondary face-fallback" id="faceFallbackBtn">Rechercher l'employé (pointage de secours)</button>`);
      const btn = $("faceFallbackBtn");
      if (btn) btn.addEventListener("click", F.fallback);
      runner.cooldownUntil = now + RESULT_MS;
      return;
    }
    if (s === "REFUSED") {
      const e = result.employee || {};
      const who = e.nom ? `<div class="face-name">${esc(e.nom)} ${esc(e.prenom)}</div><div class="face-meta">Matricule ${esc(e.matricule)}${e.poste ? " · " + esc(e.poste) : ""}</div>` : "";
      setStatus("REFUSED", `<div class="face-check">POINTAGE REFUSÉ</div>${who}<small>${esc(result.message)}</small><small>Aucun mouvement enregistré.</small>${origin(runner)}`);
      // Refus d'Attendance Core : même fiche détaillée que pour le QR et la saisie manuelle.
      if (result.code && result.refusal && typeof showLastRefusal === "function") {
        showLastRefusal({ id: "f" + Date.now(), heure: new Date().toTimeString().slice(0, 8), code: result.code, message: result.message,
          employee: Object.assign({}, e, { fonction: e.poste }), counted: result.refusal, terminal: runner.device.name });
      }
      runner.cooldownUntil = now + RESULT_MS;
      refreshPost();
      return;
    }
    const reasons = (result.reasons || []).filter(Boolean);
    setStatus(s === "NO_FACE" ? "READY" : s, (MESSAGES[s] || esc(result.message || s)) + (s === "QUALITY_FAILED" && reasons.length ? `<br><small>${esc(reasons[0])}</small>` : "") + (quiet ? "" : origin(runner)));
    if (!quiet) runner.cooldownUntil = now + 1500;
  }

  // Pointage de secours : ouvre la saisie manuelle existante (tracée, source MANUAL).
  F.fallback = function () {
    F.stop();
    if (typeof showPointerSection === "function") showPointerSection("scan");
    if (typeof toggleManualPanel === "function" && $("manualPanel") && $("manualPanel").classList.contains("hidden")) toggleManualPanel();
  };

  // ── Une boucle INDÉPENDANTE par caméra ───────────────────────────────────────────────────
  function startRunner(dev) {
    if (F.runners.has(dev.key)) return;
    const runner = { key: dev.key, device: dev, state: "STARTING", message: "", busy: false, timer: null, cooldownUntil: 0,
      lastActivityAt: null, pending: null, generation: F.generation, stopped: false };
    F.runners.set(dev.key, runner);
    F.notes.delete(dev.key);
    schedule(runner, 300);
  }

  function stopRunner(key, note) {
    const runner = F.runners.get(key);
    if (runner) { runner.stopped = true; clearTimeout(runner.timer); runner.timer = null; F.runners.delete(key); }
    F.monitored.delete(key);
    if (note) F.notes.set(key, note); else F.notes.delete(key);
    if (F.focusKey === key) focus(null);
  }

  function schedule(runner, ms) {
    if (F.running && !runner.stopped && !runner.timer) runner.timer = setTimeout(() => tick(runner), ms);
  }

  // Un essai dont la réponse s'est perdue : on demande au serveur ce qu'il est devenu AVANT tout
  // nouvel essai. Tant que le serveur n'a pas répondu, l'état affiché reste « résultat inconnu ».
  async function verify(runner) {
    const out = await api(`/biometrics/pointer/terminals/attempt?key=${encodeURIComponent(runner.key)}&burst_id=${encodeURIComponent(runner.pending)}`);
    runner.pending = null;
    runner.state = "ACTIVE"; runner.message = "";
    runner.lastActivityAt = new Date();
    if (out.recorded) {
      const ev = out.event || {};
      if (typeof noteUserActivity === "function") noteUserActivity();
      F.displayUntil = Date.now() + RESULT_MS;
      setStatus("SUCCESS", `<div class="face-check">✓ POINTAGE ENREGISTRÉ</div><div class="face-name">${esc(ev.name || "")}</div>
        <div class="face-meta">Matricule ${esc(ev.matricule || "")} · <b>${ev.type === "SORTIE" ? "SORTIE" : "ENTRÉE"}</b> · ${esc((ev.heure || "").slice(0, 5))}</div>
        <small>Confirmé par le serveur après une coupure de connexion.</small>${origin(runner)}`);
      F.lastEvent = Object.assign({}, ev, { terminal: runner.device.name });
      runner.cooldownUntil = Date.now() + RESULT_MS;
      refreshPost();
    } else if (Date.now() >= F.displayUntil) {
      setStatus("READY", `CONNEXION RÉTABLIE<br><small>Vérification faite : l'essai interrompu n'a enregistré aucun pointage.</small>${origin(runner)}`);
      F.displayUntil = Date.now() + 1500;
    }
  }

  async function tick(runner) {
    runner.timer = null;
    if (!F.running || runner.stopped) return;
    // Verrou PAR caméra : une seule reconnaissance à la fois sur celle-ci, aucune pendant
    // l'affichage de son résultat. Les autres caméras continuent.
    if (runner.busy || Date.now() < runner.cooldownUntil) { schedule(runner, 250); return; }
    runner.busy = true;
    const current = () => F.running && !runner.stopped && runner.generation === F.generation;
    let delay = TICK_MS;
    const burst = runner.pending || uuid();
    try {
      if (runner.pending) await verify(runner);
      else {
        const result = await api(`/biometrics/cameras/${cameraId(runner.key)}/recognize`, { method: "POST", body: { burst_id: burst } });
        if (current()) {
          runner.state = "ACTIVE"; runner.message = "";
          runner.lastActivityAt = new Date();
          render(result, runner);
        }
      }
    } catch (error) {
      if (current()) delay = failed(runner, error, burst);
    } finally {
      runner.busy = false;
      if (current()) { renderTable(); syncSystem(); schedule(runner, delay); }
    }
  }

  // Erreur d'UNE caméra : elle seule change d'état. Renvoie le délai avant son prochain essai.
  function failed(runner, error, burst) {
    const status = error.status;
    if (!status) {
      // Aucune réponse : le serveur a peut-être enregistré le pointage. Jamais « refusé ».
      runner.pending = burst;
      runner.state = "UNKNOWN"; runner.message = "Connexion interrompue — résultat à vérifier";
      if (Date.now() >= F.displayUntil || F.lastState === "READY") {
        setStatus("ERROR", `<div class="face-check">CONNEXION INTERROMPUE</div><small>Résultat du dernier essai inconnu : vérification automatique auprès du serveur. Ne refaites pas le pointage.</small>
          <button type="button" class="secondary face-fallback" id="faceVerifyBtn">Vérifier le statut maintenant</button>${origin(runner)}`);
        const btn = $("faceVerifyBtn");
        if (btn) btn.addEventListener("click", () => F.verifyNow(runner.key));
      }
      return ERROR_RETRY_MS;
    }
    const gone = { 403: "Terminal révoqué ou non autorisé pour ce compte", 404: "Terminal retiré par l'administration" }[status]
      || (status === 409 ? "Pointage facial désactivé par l'administration" : status === 503 ? "Reconnaissance faciale désactivée" : "");
    if (gone) {
      stopRunner(runner.key, { state: "REFUSED", message: gone });
      if (status === 503) F.engineReady = false;
      if (!F.runners.size) setStatus("DISABLED", `<div class="face-check">${status === 403 || status === 404 ? "TERMINAL RÉVOQUÉ" : "RECONNAISSANCE FACIALE DÉSACTIVÉE"}</div><small>${esc(runner.device.name)} : ${esc(gone)}. Utilisez le QR ou la saisie manuelle.</small>`);
      return ERROR_RETRY_MS;
    }
    runner.state = status === 502 ? "UNREACHABLE" : "ERROR";
    runner.message = status === 502 ? "Caméra inaccessible" : (error.message || "Erreur " + status);
    if (Date.now() >= F.displayUntil || F.lastState === "READY") {
      setStatus("ERROR", `<div class="face-check">${status === 502 ? "CAMÉRA INACCESSIBLE" : "CONNEXION INDISPONIBLE"}</div><small>${esc(error.message)}</small>${origin(runner)}`);
    }
    return ERROR_RETRY_MS;
  }

  F.verifyNow = function (key) {
    const runner = F.runners.get(key);
    if (!runner || !runner.pending || runner.busy) return;
    clearTimeout(runner.timer); runner.timer = null;
    tick(runner);
  };

  // ── Aperçu : la caméra « au premier plan » seulement (jamais une requête par caméra) ─────
  function focus(key) {
    const next = key && F.runners.has(key) ? key : (Array.from(F.runners.keys())[0] || null);
    if (next === F.focusKey) return;
    F.focusKey = next;
    const img = $("facePreview"), label = $("faceCameraLabel");
    const dev = next && device(next);
    if (label) label.textContent = dev ? `${dev.name}${dev.location ? " · " + dev.location : ""}` : "—";
    if (!next) { F.stopMedia(); if (img) { img.classList.add("hidden"); img.removeAttribute("src"); } }
    else {
      if (img) img.classList.remove("hidden");
      if (!F.previewTimer) F.previewTimer = setInterval(refreshPreview, PREVIEW_MS);
      refreshPreview();
    }
    const view = $("faceView");
    if (view) view.classList.toggle("no-video", !next);
  }

  async function refreshPreview() {
    const key = F.focusKey;
    if (!F.running || !key || F.previewBusy) return;
    F.previewBusy = true;
    try {
      const res = await api(`/biometrics/cameras/${cameraId(key)}/preview.jpg`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      if (key !== F.focusKey || !F.running) { URL.revokeObjectURL(url); return; }
      const img = $("facePreview");
      if (img) img.src = url;
      if (F.previewUrl) URL.revokeObjectURL(F.previewUrl);
      F.previewUrl = url;
    } catch (e) { /* l'état de la caméra affiche déjà l'erreur */ } finally { F.previewBusy = false; }
  }

  F.stopMedia = function () {
    clearInterval(F.previewTimer); F.previewTimer = null;
    if (F.previewUrl) { URL.revokeObjectURL(F.previewUrl); F.previewUrl = null; }
  };

  // ── Liste, sélection, compteurs ──────────────────────────────────────────────────────────
  function rowState(dev) {
    const runner = F.runners.get(dev.key), note = F.notes.get(dev.key);
    if (runner) {
      const map = { STARTING: ["Activation…", "pending"], ACTIVE: ["Actif", "ok"], UNREACHABLE: ["Caméra inaccessible", "bad"],
        UNKNOWN: ["Connexion interrompue", "bad"], ERROR: ["Erreur", "bad"] };
      const [label, tone] = map[runner.state] || ["—", "pending"];
      return { label, tone, detail: runner.message, offline: tone === "bad", active: runner.state === "ACTIVE" };
    }
    if (note) return { label: note.state === "REFUSED" ? "Refusé" : "Arrêté", tone: "bad", detail: note.message, offline: false, active: false };
    if (dev.kind === "TERMINAL") {
      // Connexion (la borne bat-elle ?) et activité (y a-t-il des passages ?) sont deux choses :
      // une borne au repos reste « en ligne » ; seule une borne qui s'est tue est « perdue ».
      const watched = F.monitored.has(dev.key);
      const connection = dev.connection || (dev.online ? "ONLINE" : "LOST");
      const pace = dev.activity === "ACTIVE" ? "en service" : "au repos";
      const [label, tone] = { ONLINE: [(watched ? "Actif · " : "En ligne · ") + pace, "ok"], LOST: ["Connexion perdue", "bad"],
        SILENT: ["Sans signal", "pending"], NEVER: ["Jamais connecté", "bad"] }[connection] || ["—", "pending"];
      const detail = connection === "SILENT" ? "État de connexion inconnu : borne à recharger pour le suivi"
        : watched ? "Terminal autonome : il pointe seul (aucune activation distante)" : "Terminal autonome";
      return { label, tone, detail, offline: connection === "LOST" || connection === "NEVER", active: watched && connection === "ONLINE" };
    }
    return { label: "Disponible", tone: "pending", detail: "", offline: false, active: false };
  }

  function activity(dev) {
    const runner = F.runners.get(dev.key);
    if (runner && runner.lastActivityAt) return clock(runner.lastActivityAt);
    if (dev.kind === "TERMINAL") return dev.last_communication ? clock(dev.last_communication) : "Jamais";
    return dev.last_event ? dev.last_event.heure : "—";
  }

  function renderTable() {
    const body = $("ftRows");
    if (!body) return;
    body.innerHTML = F.devices.map((dev) => {
      const st = rowState(dev);
      return `<tr data-key="${esc(dev.key)}" class="${F.focusKey === dev.key ? "is-focus" : ""}">
        <td class="ft-check"><input type="checkbox" data-key="${esc(dev.key)}" aria-label="Sélectionner ${esc(dev.name)}"${F.selected.has(dev.key) ? " checked" : ""}></td>
        <td><b>${esc(dev.name)}</b><small>${esc(dev.hardware || "")}${dev.location ? " · " + esc(dev.location) : ""}</small></td>
        <td>${esc(dev.site || "")}</td>
        <td><span class="ft-state" data-tone="${st.tone}">${esc(st.label)}</span>${st.detail ? `<small>${esc(st.detail)}</small>` : ""}</td>
        <td class="ft-time">${esc(activity(dev))}</td></tr>`;
    }).join("");
    const states = F.devices.map((dev) => [dev, rowState(dev)]);
    const engaged = (dev) => F.runners.has(dev.key) || F.monitored.has(dev.key) || F.selected.has(dev.key);
    const set = (id, value) => { const el = $(id); if (el) el.textContent = String(value); };
    set("ftCountSelected", F.selected.size);
    set("ftCountActive", states.filter(([, st]) => st.active).length);
    set("ftCountOffline", states.filter(([dev, st]) => st.offline && engaged(dev)).length);
    const ev = F.lastEvent;
    set("ftLastEvent", ev ? `${(ev.heure || "").slice(0, 8)} · ${ev.type === "SORTIE" ? "SORTIE" : "ENTRÉE"} · ${ev.name || ev.matricule || ""}${ev.terminal ? " · " + ev.terminal : ""}` : "Aucun");
    const all = $("ftAll");
    if (all) { all.checked = !!F.devices.length && F.selected.size === F.devices.length; all.indeterminate = F.selected.size > 0 && F.selected.size < F.devices.length; }
    const none = !F.selected.size;
    const activate = $("ftActivate"), stop = $("ftStop");
    if (activate) activate.disabled = none || !F.engineReady;
    if (stop) stop.disabled = !Array.from(F.selected).some((k) => F.runners.has(k) || F.monitored.has(k));
    const box = $("faceTerminals");
    if (box) box.classList.toggle("hidden", !F.devices.length);
  }

  function saveSelection() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(F.selected))); } catch (e) { /* stockage indisponible */ }
  }
  function storedSelection() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch (e) { return []; }
  }

  F.toggle = function (key, on) {
    if (!device(key)) return;
    if (on) F.selected.add(key); else F.selected.delete(key);
    saveSelection(); renderTable();
  };
  F.selectAll = function () { F.devices.forEach((d) => F.selected.add(d.key)); saveSelection(); renderTable(); };
  F.selectNone = function () { F.selected.clear(); saveSelection(); renderTable(); };

  // Activation : le SERVEUR contrôle chaque équipement et renvoie un résultat par équipement.
  // Rien n'est démarré sur une simple case cochée, et un refus n'empêche pas les autres.
  F.activateSelected = async function () {
    const keys = Array.from(F.selected).filter((k) => device(k));
    if (!keys.length || !F.running) return;
    const generation = F.generation;
    let out;
    try { out = await api("/biometrics/pointer/terminals/activate", { method: "POST", body: scopeBody(keys) }); }
    catch (error) {
      if (generation !== F.generation) return;
      setStatus("ERROR", `<div class="face-check">${error.status ? "ACTIVATION REFUSÉE" : "CONNEXION INDISPONIBLE"}</div><small>${esc(error.message)} — aucun terminal n'a été activé.</small>`);
      return;
    }
    if (generation !== F.generation) return;
    const refused = [];
    (out.results || []).forEach((r) => {
      const dev = device(r.key);
      if (!dev) return;
      if (r.status === "ACTIVATED") startRunner(dev);
      else if (r.status === "MONITORED") {
        F.monitored.add(dev.key); F.notes.delete(dev.key);
        dev.online = r.online; dev.connection = r.connection || (r.online ? "ONLINE" : "LOST");
        if (r.last_communication) dev.last_communication = r.last_communication;
      }
      else { stopRunner(dev.key, { state: "REFUSED", message: r.message || "Refusé" }); refused.push(dev.name + " : " + (r.message || "refusé")); }
    });
    focus(F.focusKey);
    const offline = F.devices.filter((d) => F.monitored.has(d.key) && rowState(d).offline).map((d) => d.name);
    if (!F.runners.size && !F.monitored.size) setStatus("DISABLED", `<div class="face-check">AUCUN TERMINAL ACTIVÉ</div><small>${esc(refused.join(" — ") || "Aucun équipement utilisable.")}</small>`);
    else if (Date.now() < F.displayUntil) { /* un résultat est affiché : une ré-activation ne l'efface pas */ }
    else if (F.runners.size) setStatus("READY", MESSAGES.NO_FACE + (refused.length ? `<br><small>${esc(refused.join(" — "))}</small>` : ""));
    else setStatus("READY", `SURVEILLANCE ACTIVE<br><small>${offline.length ? esc(offline.join(", ")) + " : connexion perdue. " : ""}Les terminaux autonomes pointent seuls ; les passages apparaissent sur la fiche du poste.</small>`);
    renderTable(); syncSystem();
  };

  // Arrêt de la surveillance des équipements cochés : aucun réglage administratif n'est modifié.
  F.stopSelected = function () {
    const keys = Array.from(F.selected).filter((k) => F.runners.has(k) || F.monitored.has(k));
    if (!keys.length) return;
    keys.forEach((k) => stopRunner(k));
    api("/biometrics/pointer/terminals/stop", { method: "POST", body: scopeBody(keys) }).catch(() => { /* trace facultative */ });
    if (!F.runners.size && !F.monitored.size) { F.displayUntil = 0; setStatus("READY", "SURVEILLANCE ARRÊTÉE<br><small>Sélectionnez les terminaux à activer.</small>"); }
    focus(F.focusKey); renderTable(); syncSystem();
  };

  // Relevé d'état périodique : UN appel pour tous les équipements. Un équipement révoqué,
  // désactivé ou dont l'autorisation a été retirée disparaît de la liste : il est arrêté ici.
  function applyListing(listing) {
    const known = new Map((listing.terminals || []).map((d) => [d.key, d]));
    F.authorizedTotal = listing.authorized_total || 0;
    F.engineReady = !!(listing.engine && listing.engine.ready);
    Array.from(F.runners.keys()).concat(Array.from(F.monitored)).forEach((key) => {
      if (!known.has(key)) stopRunner(key);
    });
    F.devices = Array.from(known.values());
    F.runners.forEach((runner) => { runner.device = known.get(runner.key) || runner.device; });
    Array.from(F.selected).forEach((key) => { if (!known.has(key)) F.selected.delete(key); });
    Array.from(F.notes.keys()).forEach((key) => { if (!known.has(key)) F.notes.delete(key); });
    const ev = listing.last_event;
    if (ev && (!F.lastEvent || !F.lastEvent.id || ev.id >= F.lastEvent.id)) {
      const from = F.devices.find((d) => d.last_event && d.last_event.id === ev.id);
      F.lastEvent = Object.assign({}, ev, { terminal: from ? from.name : "" });
    }
  }

  async function pollStatus() {
    if (!F.running) return;
    const generation = F.generation;
    try {
      const listing = await api("/biometrics/pointer/terminals" + scopeQuery());
      if (generation !== F.generation) return;
      const before = F.runners.size + F.monitored.size;
      applyListing(listing);
      if (before && !F.runners.size && !F.monitored.size) setStatus("DISABLED", `<div class="face-check">TERMINAUX INDISPONIBLES</div><small>Les terminaux surveillés ont été désactivés ou révoqués par l'administration. Utilisez le QR ou la saisie manuelle.</small>`);
      focus(F.focusKey); renderTable(); syncSystem();
    } catch (e) { /* hors ligne : les états affichés restent ceux de chaque équipement */ }
  }

  F.refresh = pollStatus;

  function bind() {
    const box = $("faceTerminals");
    if (!box || box.__bound) return;
    box.__bound = true;
    box.addEventListener("change", (event) => {
      const input = event.target;
      if (input.id === "ftAll") { if (input.checked) F.selectAll(); else F.selectNone(); return; }
      if (input.matches && input.matches("input[type=checkbox][data-key]")) F.toggle(input.dataset.key, input.checked);
    });
    box.addEventListener("click", (event) => {
      const action = event.target.closest && event.target.closest("[data-ft]");
      if (action) { ({ all: F.selectAll, none: F.selectNone, activate: F.activateSelected, stop: F.stopSelected })[action.dataset.ft](); return; }
      const row = event.target.closest && event.target.closest("tr[data-key]");
      if (row && !event.target.matches("input") && F.runners.has(row.dataset.key)) { focus(row.dataset.key); renderTable(); }
    });
  }

  F.start = async function () {
    if (F.running) return;
    const generation = ++F.generation;
    const stale = () => generation !== F.generation;
    F.siteId = String(site() || "");
    F.running = true;
    bind();
    setStatus("READY", "Chargement des terminaux…");
    setSystem("SEARCHING", "INIT");
    try {
      const listing = await api("/biometrics/pointer/terminals" + scopeQuery());
      if (stale()) return;
      applyListing(listing);
      const wanted = storedSelection();
      F.selected = new Set(F.devices.filter((d) => wanted.includes(d.key)).map((d) => d.key));
      renderTable();
      if (!F.devices.length) {
        const none = !F.authorizedTotal;
        setStatus("DISABLED", `<div class="face-check">${none ? "AUCUN TERMINAL AUTORISÉ" : "AUCUN TERMINAL DISPONIBLE"}</div><small>${none
          ? "Aucun terminal de reconnaissance faciale n'est autorisé pour ce compte. Voir l'Administration Système."
          : "Les terminaux autorisés pour ce compte sont désactivés, non appairés ou révoqués."}</small>`);
        setSystem("NONE", F.engineReady ? "OFF" : "DISABLED");
        F.running = false;
        return;
      }
      if (!F.engineReady) {
        setStatus("DISABLED", `<div class="face-check">RECONNAISSANCE FACIALE DÉSACTIVÉE</div><small>Utilisez le QR ou la saisie manuelle.</small>`);
        setSystem("NONE", "DISABLED");
      } else {
        setStatus("READY", `SÉLECTIONNEZ LES TERMINAUX<br><small>Cochez un ou plusieurs terminaux puis « Activer les terminaux sélectionnés ».</small>`);
        setSystem("NONE", "INIT");
      }
      F.statusTimer = setInterval(pollStatus, STATUS_MS);
    } catch (error) {
      if (stale()) return;
      const scope = error.status === 403;
      setStatus(scope ? "DISABLED" : "ERROR", `<div class="face-check">${scope ? "PÉRIMÈTRE NON AUTORISÉ" : "INDISPONIBLE"}</div><small>${esc(error.message)}</small>`);
      setSystem(scope ? "NONE" : "UNAVAILABLE", scope ? "OFF" : "ERROR");
      F.running = false;
    }
  };

  // Arrêt complet : plus aucune détection, aucun aperçu, aucun minuteur ; une réponse encore en
  // vol est ignorée (génération périmée).
  F.stop = function () {
    F.running = false;
    F.generation++;
    F.runners.forEach((runner) => { runner.stopped = true; clearTimeout(runner.timer); runner.timer = null; });
    F.runners.clear(); F.monitored.clear(); F.notes.clear();
    clearInterval(F.statusTimer); F.statusTimer = null;
    F.displayUntil = 0;
    F.stopMedia();
    F.focusKey = null; F.devices = []; F.selected = new Set(); F.lastEvent = null;
    const img = $("facePreview");
    if (img) { img.classList.add("hidden"); img.removeAttribute("src"); }
    const label = $("faceCameraLabel");
    if (label) label.textContent = "—";
    renderTable();
    setSystem("OFF", "OFF");
  };

  // Changement de site ou de société : le contexte précédent est arrêté avant de relire les
  // équipements du nouveau périmètre.
  F.restart = function () {
    F.stop();
    return F.start();
  };
})();
