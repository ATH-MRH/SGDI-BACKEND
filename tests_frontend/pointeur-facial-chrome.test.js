// Pointeur — pointage facial automatique en Chrome RÉEL (Chrome headless en ligne de commande).
// Lancer : npm run test:pointeur-v5-chrome
// Vraie page servie telle quelle dans un cadre de la largeur testée ; réseau simulé par des fixtures
// isolées ici. AUCUNE caméra physique : l'aperçu est une image de test relayée par le faux serveur,
// comme le ferait le backend (le navigateur n'accède jamais à une caméra).
// Vérifie, de 1600 à 390 px : un clic sur « Reconnaissance faciale » ouvre la liste des terminaux
// autorisés dans la zone centrale ; « tout sélectionner » puis « activer » lance PLUSIEURS équipements
// à la fois (deux caméras + une borne autonome surveillée) ; le poste reste affiché, aucun
// débordement, cadre vidéo stable, état compact sans terminal, haut de page inchangé.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const SKIP = CHROME ? false : 'Chrome indisponible';
const WIDTHS = [1600, 1440, 1280, 1024, 768, 430, 390];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAYAAAA7KqwyAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const iso = (hhmm) => `2026-10-01T${hhmm}:00+01:00`;
const POST = { site_id: 12, site: 'SITE DE RECETTE', status: 'OFFICIAL', reason: null,
  current: { shift: 'APRES_MIDI', shift_label: 'Après-midi', group: 'B', work_date: '2026-10-01', start: '14:00', end: '22:00', scheduled_start: iso('14:00'), scheduled_end: iso('22:00') },
  next: null, maintien: null, kpi: { expected: 18, present: 9, absent: 9, excused: 0, maintien: 0, anomalies: 0 }, activity: { refused_today: 0 }, present: [], todo: [], movements: [], permissions: { manual_entry: false } };

// Sonde dans la page : état avant le clic (6 s), clic sur la carte, liste (7 s), tout sélectionner +
// activer, état après (10 s et 14 s).
const PROBE = `
(function(){
  let recognize=0;const perCamera={};const nativeFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>{const m=/cameras\\/(\\d+)\\/recognize/.exec(String(url));if(m){recognize++;perCamera[m[1]]=(perCamera[m[1]]||0)+1}return nativeFetch(url,options)};
  const box=id=>{const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect();return {top:Math.round(r.top+scrollY),left:Math.round(r.left),width:Math.round(r.width),height:Math.round(r.height)}};
  const shown=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const sample=()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body.scrollWidth,recognize,
    facial:document.getElementById('scannerCard').classList.contains('facial-mode'),faceView:shown(document.getElementById('faceView')),
    stage:(()=>{const el=document.querySelector('#faceView .face-stage');if(!shown(el))return null;const r=el.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}})(),
    preview:shown(document.getElementById('facePreview')),
    rows:[...document.querySelectorAll('#ftRows tr')].map(tr=>[tr.dataset.key,tr.cells[3].innerText.replace(/\\s+/g,' ').trim(),tr.querySelector('input').checked]),
    counters:['ftCountSelected','ftCountActive','ftCountOffline'].map(id=>document.getElementById(id).textContent).join('/'),
    buttons:[...document.querySelectorAll('#faceView button')].filter(shown).map(b=>b.textContent.trim()),
    perCamera:Object.fromEntries(Object.entries(perCamera)),
    seen:(()=>{const card=document.getElementById('scannerCard').getBoundingClientRect();
      const inside=el=>{if(!shown(el))return false;const r=el.getBoundingClientRect();return r.top>=card.top-1&&r.bottom<=Math.min(card.bottom,innerHeight)+1&&r.left>=card.left-1&&r.right<=card.right+1};
      return {scroll:document.getElementById('scannerCard').scrollTop,toolbar:[...document.querySelectorAll('#faceTerminals .ft-btn')].every(inside),
        counters:inside(document.getElementById('ftCountOffline')),status:inside(document.getElementById('faceStatus')),
        rows:[...document.querySelectorAll('#ftRows tr')].filter(tr=>{const r=tr.getBoundingClientRect(),box=tr.closest('.ft-scroll').getBoundingClientRect();
          return r.top>=Math.max(card.top,box.top)-1&&r.bottom<=Math.min(card.bottom,box.bottom,innerHeight)+1}).length}})(),status:document.getElementById('faceStatus').innerText.replace(/\\s+/g,' ').trim(),
    banner:shown(document.getElementById('shiftBanner')),kpis:document.querySelectorAll('#postKpis .v5-kpi').length,
    qrBits:['usbReader','reader','cameraModeBtn'].filter(id=>shown(document.getElementById(id))),pressed:document.getElementById('faceModeBtn').getAttribute('aria-pressed'),
    host:location.pathname,boxes:Object.fromEntries(['shiftBanner','postKpis','scannerCard','faceView'].map(id=>[id,box(id)])),
    outside:[...document.querySelectorAll('#appView *')].filter(el=>{const r=el.getBoundingClientRect();return shown(el)&&!el.closest('.hidden')&&!el.closest('.v5-list,.v5-moves,.live-feed-list,.wedge-input,.tracking-scroll,.ft-scroll')&&(r.right>document.documentElement.clientWidth+1||r.left<-1)}).map(el=>el.tagName+'.'+String(el.className).split(' ')[0]).slice(0,5)});
  const out={};
  setTimeout(()=>{out.before=sample();document.getElementById('faceModeBtn').click()},6000);
  setTimeout(()=>{out.listed=sample();const all=document.querySelector('#faceTerminals [data-ft="all"]');if(shown(all)){all.click();document.querySelector('#faceTerminals [data-ft="activate"]').click()}},7000);
  setTimeout(()=>{out.after=sample()},10000);
  setTimeout(()=>{out.later=sample();parent.postMessage({probe:out},'*')},14000);
})();`;

function startServer(devices) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (url.pathname === '/frame') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(`<!doctype html><html><body style="margin:0"><iframe src="/app" style="border:0;width:${Number(url.searchParams.get('w'))}px;height:900px"></iframe><pre id="probe"></pre>
        <script>addEventListener('message',e=>{if(e.data&&e.data.probe)document.getElementById('probe').textContent='PROBE'+JSON.stringify(e.data.probe)+'ENDPROBE'})</script></body></html>`);
    }
    if (url.pathname === '/app') {
      const session = JSON.stringify({ token: 'tok', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de recette' } });
      const boot = `<script>localStorage.setItem('atlas_pointer_session',${JSON.stringify(session)});localStorage.setItem('atlas_pointer_site','12');</script>`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(fs.readFileSync(path.join(STATIC, 'pointeur.html'), 'utf8').replace('<head>', '<head>' + boot).replace('</body>', `<script>${PROBE}</script></body>`));
    }
    if (url.pathname === '/api/biometrics/pointer/terminals') return json({ server_time: iso('14:40'), engine: { ready: true, message: null },
      terminals: url.searchParams.get('site_id') === '12' ? devices : [], authorized_total: devices.length, last_event: null });
    if (url.pathname === '/api/biometrics/pointer/terminals/activate') return json({ results: devices.map((d) => (d.kind === 'CAMERA'
      ? { key: d.key, status: 'ACTIVATED', code: 'SERVER_CAMERA' } : { key: d.key, status: 'MONITORED', code: 'AUTONOMOUS', online: true, connection: 'ONLINE', last_communication: d.last_communication })) });
    if (url.pathname.endsWith('/preview.jpg')) { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return response.end(PIXEL); }
    if (url.pathname.endsWith('/recognize')) return json({ state: 'NO_FACE', recorded: false, reasons: [] });
    if (url.pathname === '/api/portal/attendance-live') return json({ latest_event_id: 50, events: [], latest_refusal_id: 9, refusals: [], alerts: [], summary: { entries_today: 21, exits_today: 9, present_now: 9, absent_today: 0 },
      timezone: 'Africa/Algiers', server_now: iso('14:40'), operational_date: '2026-10-01', server_time: '14:40:00', post: POST });
    if (url.pathname === '/api/portal/attendance-sites') return json([{ id: 12, name: 'SITE DE RECETTE', indicatif: 'REC' }]);
    if (url.pathname.startsWith('/api/')) return json([]);
    const file = path.join(STATIC, decodeURIComponent(url.pathname.replace(/^\/static\//, '')));
    if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function probe(port, width) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pointeur-facial-chrome-'));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--window-size=1720,1000',
    `--user-data-dir=${profile}`, '--virtual-time-budget=18000', '--dump-dom', `http://127.0.0.1:${port}/frame?w=${width}`];
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '', settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(guard); child.kill('SIGKILL');
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* profil temporaire */ }
      const match = /PROBE(\{.*\})ENDPROBE<\/pre>/s.exec(stdout);
      if (!match) return reject(new Error('sonde absente du DOM'));
      resolve(JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')));
    };
    const guard = setTimeout(() => { child.kill('SIGTERM'); setTimeout(finish, 1500); }, 100000);
    child.stdout.on('data', (chunk) => { stdout += chunk; if (/ENDPROBE<\/pre>/.test(stdout)) finish(); });
    child.on('close', finish);
  });
}

const DEVICE = (key, kind, name, extra = {}) => ({ key, kind, name, category: kind === 'CAMERA' ? 'IP_CAMERA' : 'MOBILE_KIOSK', hardware: kind === 'CAMERA' ? 'DAHUA IPC-HFW' : 'Tablette Android',
  location: 'Entrée principale', site_id: 12, site: 'SITE DE RECETTE', society: 'Iron Global Securite', activation: kind === 'CAMERA' ? 'SERVER_CAMERA' : 'AUTONOMOUS',
  remote_activation: kind === 'CAMERA', online: kind === 'CAMERA' ? null : true, connection: kind === 'CAMERA' ? undefined : 'ONLINE', activity: 'IDLE', state: kind === 'CAMERA' ? 'READY' : 'ONLINE', last_communication: kind === 'CAMERA' ? null : '2026-10-01T13:39:50Z', last_event: null, ...extra });
const DEVICES = [DEVICE('cam:7', 'CAMERA', 'CAM-ENTREE-01'), DEVICE('cam:8', 'CAMERA', 'CAM-SORTIE-02', { location: 'Sortie quai' }), DEVICE('trm:3', 'TERMINAL', 'TABLETTE POSTE DE GARDE')];

for (const width of WIDTHS) {
  for (const [label, cameras] of [['trois terminaux autorisés', DEVICES], ['aucun terminal autorisé', []]]) {
    test(`Chrome réel ${width}px — ${label} : le facial s'ouvre dans la zone centrale, plusieurs terminaux actifs ensemble`, { skip: SKIP, timeout: 150000 }, async () => {
      const server = await startServer(cameras);
      let out;
      try { out = await probe(server.address().port, width); } finally { server.close(); }
      assert.equal(out.before.facial, false); assert.equal(out.before.recognize, 0);
      for (const key of ['after', 'later']) {
        const s = out[key];
        assert.equal(s.facial, true, `${key} : mode facial actif après UN clic`);
        assert.equal(s.faceView, true); assert.equal(s.pressed, 'true'); assert.equal(s.host, '/app', 'aucune redirection');
        assert.ok(!s.banner && s.kpis === 5, `${key} : bandeau supprimé, KPI toujours affichés`);
        assert.deepEqual(s.qrBits, [], `${key} : aucun élément du lecteur QR visible`);
        assert.equal(s.clientWidth, width); assert.ok(s.scrollWidth <= s.clientWidth && s.bodyScrollWidth <= s.clientWidth, `${key} : débordement horizontal`);
        assert.deepEqual(s.outside, [], `${key} : éléments hors écran`);
        // Le haut du poste ne bouge pas à l'activation.
        for (const id of ['shiftBanner', 'postKpis']) assert.deepEqual(s.boxes[id], out.before.boxes[id], `${id} inchangé (${key})`);
        assert.equal(s.boxes.scannerCard.top, out.before.boxes.scannerCard.top); assert.equal(s.boxes.scannerCard.width, out.before.boxes.scannerCard.width);
      }
      assert.deepEqual(out.later.boxes, out.after.boxes, 'mise en page stable une fois le mode actif');
      assert.equal(out.listed.recognize, 0, 'aucune reconnaissance avant l\'activation');
      assert.ok(!out.later.buttons.some((b) => /appair|associer/i.test(b)), 'aucun bouton d\'appairage dans Pointeur');
      if (cameras.length) {
        assert.deepEqual(out.listed.rows.map((r) => [r[0], r[2]]), [['cam:7', false], ['cam:8', false], ['trm:3', false]], 'liste à cocher, rien de présélectionné');
        assert.deepEqual(out.later.buttons, ['Sélectionner tout', 'Désélectionner tout', 'Activer les terminaux sélectionnés', 'Arrêter la surveillance']);
        assert.deepEqual(out.later.rows.map((r) => r[2]), [true, true, true]);
        assert.match(out.later.rows[0][1], /^Actif/); assert.match(out.later.rows[1][1], /^Actif/); assert.match(out.later.rows[2][1], /^Actif · au repos/);
        assert.equal(out.later.counters, '3/3/0', 'sélectionnés / actifs / hors ligne');
        // Sélection et état visibles SANS défilement : barre d'actions, compteurs, résultat et lignes.
        const seen = out.later.seen;
        console.log(`# ${width}px — visibles sans défilement : ${JSON.stringify(seen)}`);
        assert.equal(seen.scroll, 0); assert.ok(seen.toolbar && seen.counters && seen.status, `${width}px : ${JSON.stringify(seen)}`);
        assert.ok(seen.rows >= (width >= 1024 ? 3 : 2), `${width}px : ${seen.rows} ligne(s) de terminal visible(s) sur 3`);
        assert.ok(out.after.perCamera['7'] >= 1 && out.after.perCamera['8'] >= 1, 'les deux caméras tournent en même temps');
        assert.ok(out.later.perCamera['7'] > out.after.perCamera['7'] && out.later.perCamera['8'] > out.after.perCamera['8'], 'chacune continue seule');
        assert.equal(out.after.preview, true, 'aperçu relayé affiché');
        const { width: w, height: h } = out.after.stage;
        assert.ok(w <= Math.min(560, out.after.boxes.scannerCard.width) && Math.abs(w / h - 16 / 9) < 0.03, `cadre vidéo 16/9 stable (${w}×${h})`);
        assert.match(out.after.status, /PRÊT — placez-vous face à la caméra/);
      } else {
        assert.equal(out.after.recognize, 0); assert.equal(out.after.stage, null, 'aucun cadre noir sans source vidéo');
        assert.match(out.after.status, /AUCUN TERMINAL AUTORISÉ Aucun terminal de reconnaissance faciale n'est autorisé pour ce compte/);
        assert.deepEqual(out.after.buttons, [], 'aucune action proposée');
        assert.ok(out.after.boxes.faceView.height < 220, `état compact (${out.after.boxes.faceView.height}px)`);
      }
    });
  }
}
