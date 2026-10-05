// Pointeur — pointage facial automatique en Chrome RÉEL (Chrome headless en ligne de commande).
// Lancer : npm run test:pointeur-v5-chrome
// Vraie page servie telle quelle dans un cadre de la largeur testée ; réseau simulé par des fixtures
// isolées ici. AUCUNE caméra physique : l'aperçu est une image de test relayée par le faux serveur,
// comme le ferait le backend (le navigateur n'accède jamais à une caméra).
// Vérifie, de 1600 à 390 px : un clic sur « Reconnaissance faciale » active le mode facial dans la
// zone centrale, le poste reste affiché, aucun débordement, cadre vidéo stable, état compact sans
// caméra, haut de page inchangé.
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

// Sonde dans la page : état avant le clic (6 s), clic sur la carte, état après (10 s et 14 s).
const PROBE = `
(function(){
  let recognize=0;const nativeFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>{if(String(url).includes('/recognize'))recognize++;return nativeFetch(url,options)};
  const box=id=>{const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect();return {top:Math.round(r.top+scrollY),left:Math.round(r.left),width:Math.round(r.width),height:Math.round(r.height)}};
  const shown=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const sample=()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body.scrollWidth,recognize,
    facial:document.getElementById('scannerCard').classList.contains('facial-mode'),faceView:shown(document.getElementById('faceView')),
    stage:(()=>{const el=document.querySelector('#faceView .face-stage');if(!shown(el))return null;const r=el.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}})(),
    preview:shown(document.getElementById('facePreview')),status:document.getElementById('faceStatus').innerText.replace(/\\s+/g,' ').trim(),
    banner:shown(document.getElementById('shiftBanner')),kpis:document.querySelectorAll('#postKpis .v5-kpi').length,
    qrBits:['usbReader','reader','cameraModeBtn'].filter(id=>shown(document.getElementById(id))),pressed:document.getElementById('faceModeBtn').getAttribute('aria-pressed'),
    host:location.pathname,boxes:Object.fromEntries(['shiftBanner','postKpis','scannerCard','faceView'].map(id=>[id,box(id)])),
    outside:[...document.querySelectorAll('#appView *')].filter(el=>{const r=el.getBoundingClientRect();return shown(el)&&!el.closest('.hidden')&&!el.closest('.v5-list,.v5-moves,.live-feed-list,.wedge-input')&&(r.right>document.documentElement.clientWidth+1||r.left<-1)}).map(el=>el.tagName+'.'+String(el.className).split(' ')[0]).slice(0,5)});
  const out={};
  setTimeout(()=>{out.before=sample();document.getElementById('faceModeBtn').click()},6000);
  setTimeout(()=>{out.after=sample()},10000);
  setTimeout(()=>{out.later=sample();parent.postMessage({probe:out},'*')},14000);
})();`;

function startServer(cameras) {
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
    if (url.pathname === '/api/biometrics/status') return json({ enabled: true, engine_available: true });
    if (url.pathname === '/api/biometrics/cameras') return json(url.searchParams.get('site_id') === '12' ? cameras : []);
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

const CAMERA = [{ id: 7, site_id: 12, name: 'CAM-ENTREE-01', location: 'Entrée principale', adapter: 'DAHUA', usage: 'ATTENDANCE', role: 'ENTRY', is_default: true, active: true, facial_attendance_enabled: true }];

for (const width of WIDTHS) {
  for (const [label, cameras] of [['caméra de pointage déclarée', CAMERA], ['aucune caméra', []]]) {
    test(`Chrome réel ${width}px — ${label} : un clic active le facial dans la zone centrale`, { skip: SKIP, timeout: 150000 }, async () => {
      const server = await startServer(cameras);
      let out;
      try { out = await probe(server.address().port, width); } finally { server.close(); }
      assert.equal(out.before.facial, false); assert.equal(out.before.recognize, 0);
      for (const key of ['after', 'later']) {
        const s = out[key];
        assert.equal(s.facial, true, `${key} : mode facial actif après UN clic`);
        assert.equal(s.faceView, true); assert.equal(s.pressed, 'true'); assert.equal(s.host, '/app', 'aucune redirection');
        assert.ok(s.banner && s.kpis === 5, `${key} : vacation et KPI toujours affichés`);
        assert.deepEqual(s.qrBits, [], `${key} : aucun élément du lecteur QR visible`);
        assert.equal(s.clientWidth, width); assert.ok(s.scrollWidth <= s.clientWidth && s.bodyScrollWidth <= s.clientWidth, `${key} : débordement horizontal`);
        assert.deepEqual(s.outside, [], `${key} : éléments hors écran`);
        // Le haut du poste ne bouge pas à l'activation.
        for (const id of ['shiftBanner', 'postKpis']) assert.deepEqual(s.boxes[id], out.before.boxes[id], `${id} inchangé (${key})`);
        assert.equal(s.boxes.scannerCard.top, out.before.boxes.scannerCard.top); assert.equal(s.boxes.scannerCard.width, out.before.boxes.scannerCard.width);
      }
      assert.deepEqual(out.later.boxes, out.after.boxes, 'mise en page stable une fois le mode actif');
      if (cameras.length) {
        assert.ok(out.after.recognize >= 1, 'détection automatique démarrée sans second clic');
        assert.ok(out.later.recognize > out.after.recognize, 'la détection continue seule');
        assert.equal(out.after.preview, true, 'aperçu relayé affiché');
        const { width: w, height: h } = out.after.stage;
        assert.ok(w <= Math.min(560, out.after.boxes.scannerCard.width) && Math.abs(w / h - 16 / 9) < 0.03, `cadre vidéo 16/9 stable (${w}×${h})`);
        assert.match(out.after.status, /PRÊT — placez-vous face à la caméra/);
      } else {
        assert.equal(out.after.recognize, 0); assert.equal(out.after.stage, null, 'aucun cadre noir sans source vidéo');
        assert.match(out.after.status, /AUCUNE CAMÉRA DE POINTAGE Aucune caméra active n'est déclarée pour ce site\./);
        assert.ok(out.after.boxes.faceView.height < 220, `état compact (${out.after.boxes.faceView.height}px)`);
      }
    });
  }
}
