// Faux serveur des équipements faciaux du Pointeur (liste, activation, essais, vérification de
// statut) pour les tests jsdom : la logique de app/static/pointeur-facial.js s'exécute telle quelle.
const CAM = (id, site = 12, extra = {}) => ({ key: `cam:${id}`, kind: 'CAMERA', category: 'IP_CAMERA', hardware: 'DAHUA IPC', name: `CAM-${id}`,
  location: 'Entrée', site_id: site, site: `SITE ${site}`, society: 'Iron Global Securite', activation: 'SERVER_CAMERA', remote_activation: true,
  online: null, state: 'READY', last_communication: null, last_event: null, ...extra });
const KIOSK = (id, site = 12, extra = {}) => ({ key: `trm:${id}`, kind: 'TERMINAL', category: 'MOBILE_KIOSK', hardware: 'Tablette Android', name: `TAB-${id}`,
  location: 'Poste de garde', site_id: site, site: `SITE ${site}`, society: 'Iron Global Securite', activation: 'AUTONOMOUS', remote_activation: false,
  online: true, state: 'ONLINE', last_communication: '2026-10-09T13:00:00Z', last_event: null, ...extra });

/** `state` est modifiable en cours de test (révocation, panne réseau, moteur coupé…). */
function facialServer(state) {
  state.devices = state.devices || [CAM(7)];
  state.engine = state.engine || { ready: true, message: null };
  state.offline = state.offline || (() => false);      // (call) => true : la requête n'aboutit pas
  let n = 0;
  return async function handle(u, call, json) {
    if (!u.pathname.startsWith('/api/biometrics/')) return undefined;
    if (state.offline(call)) throw new TypeError('Failed to fetch');
    if (u.pathname === '/api/biometrics/pointer/terminals') {
      if (state.listStatus) return json({ detail: state.listDetail || 'Site non autorisé pour ce compte Pointeur' }, state.listStatus);
      const site = u.searchParams.get('site_id');
      const rows = state.devices.filter((d) => !site || String(d.site_id) === site);
      return json({ server_time: '2026-10-09T14:00:00+01:00', engine: state.engine, terminals: rows,
        authorized_total: state.authorizedTotal == null ? rows.length : state.authorizedTotal, last_event: state.lastEvent || null });
    }
    if (u.pathname === '/api/biometrics/pointer/terminals/activate') {
      if (state.activate) return json(state.activate(call));
      return json({ results: call.body.keys.map((key) => {
        const dev = state.devices.find((d) => d.key === key);
        if (!dev) return { key, status: 'REFUSED', code: 'NOT_AUTHORIZED', message: 'Terminal non autorisé pour ce compte ou hors du périmètre sélectionné' };
        if (dev.kind === 'TERMINAL') return { key, status: 'MONITORED', code: dev.online ? 'AUTONOMOUS' : 'AUTONOMOUS_OFFLINE', online: dev.online, last_communication: dev.last_communication, message: 'Terminal autonome' };
        return { key, status: 'ACTIVATED', code: 'SERVER_CAMERA', message: 'Caméra activée' };
      }) });
    }
    if (u.pathname === '/api/biometrics/pointer/terminals/stop') return json({ stopped: call.body.keys });
    if (u.pathname === '/api/biometrics/pointer/terminals/attempt') {
      return json(state.attempt ? state.attempt(u.searchParams.get('key'), u.searchParams.get('burst_id')) : { recorded: false, event: null });
    }
    if (u.pathname.endsWith('/preview.jpg')) return json({});
    if (u.pathname.endsWith('/recognize')) {
      if (state.recognizeDelay) await new Promise((r) => setTimeout(r, state.recognizeDelay));
      const out = state.recognize ? state.recognize(n++, call) : { state: 'NO_FACE', recorded: false, reasons: [] };
      return out && out.__status ? json({ detail: out.detail }, out.__status) : json(out);
    }
    return json({});
  };
}

module.exports = { CAM, KIOSK, facialServer };
