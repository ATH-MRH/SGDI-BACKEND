// Pointeur V5 — contrôle en Chrome RÉEL (sans puppeteer : Chrome headless en ligne de commande).
// Lancer : npm run test:pointeur-v5-chrome
// La vraie page (app/static/pointeur.html) est servie telle quelle dans un cadre de la largeur
// testée ; seules les réponses réseau sont des fixtures isolées dans ce fichier. Vérifie, à 1600 /
// 1440 / 1280 / 1024 / 768 / 430 / 390 : aucun débordement horizontal, disposition 65/35 puis une
// colonne, ordre mobile, et stabilité de la mise en page sur 30 s de rafraîchissements live avec
// changement d'état des données.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const SKIP = CHROME ? false : 'Chrome indisponible';
const WIDTHS = [1600, 1440, 1280, 1024, 768, 430, 390];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const iso = (hhmm, day = '2026-10-01') => `${day}T${hhmm}:00+01:00`;
const slot = (shift, label, group, start, end, endDay) => ({ shift, shift_label: label, group, work_date: '2026-10-01', start, end, scheduled_start: iso(start), scheduled_end: iso(end, endDay) });
const person = (i, group) => ({ id: 100 + i, matricule: `T${String(i).padStart(3, '0')}`, nom: i % 4 === 0 ? 'FIXTURE-NOM-PARTICULIEREMENT-LONG' : `FIXTURE${i}`, prenom: 'Test', fonction: i % 3 ? 'Agent de sécurité' : 'Chef de poste principal de nuit', poste: 'Agent', group, photo: '' });
function post(state) {
  const count = state === 'B' ? 14 : 9;
  const present = Array.from({ length: count }, (_, i) => ({ employee: person(i, i % 5 ? 'B' : 'A'), event_id: i, entry: '13:4' + (i % 10), entry_at: iso('13:40'), shift_start: '14:00', shift_end: '22:00',
    kind: i % 5 ? 'NORMAL' : 'EXTRA_SHIFT', badge: i % 5 ? 'EN_POSTE' : 'EN_MAINTIEN', badge_label: i % 5 ? 'EN POSTE' : 'EN MAINTIEN' }));
  const todo = Array.from({ length: state === 'B' ? 4 : 2 }, (_, i) => ({ key: 'a' + i, anomaly_id: i, code: i % 2 ? 'EXTRA_SHIFT' : 'VACATION_NON_CLOTUREE', label: i % 2 ? 'Maintien à qualifier' : 'Vacation non clôturée', severity: i % 2 ? 'info' : 'warning',
    message: 'Vacation 06:00 → 14:00 sans sortie enregistrée', employee: person(i, 'A'), scheduled_end: '14:00', overdue_since: '14:45', action: null }));
  const types = ['ENTREE', 'SORTIE', 'MAINTIEN', 'REFUS'];
  const movements = Array.from({ length: 24 }, (_, i) => ({ key: 'm' + i, type: types[i % 4], label: ['ENTRÉE', 'SORTIE', 'MAINTIEN', 'REFUSÉ'][i % 4], heure: `14:${String(59 - i).padStart(2, '0')}:12`, at: iso('14:30'), matricule: `T${String(i).padStart(3, '0')}`,
    name: i % 4 === 3 ? '' : `FIXTURE${i} Test`, detail: i % 4 === 3 ? 'Nouvelle entrée refusée : nouvelle entrée possible de 14:30 à 14:45.' : null }));
  return { site_id: 12, site: 'SITE DE RECETTE', status: 'OFFICIAL', reason: null, current: slot('APRES_MIDI', 'Après-midi', 'B', '14:00', '22:00'), next: slot('NUIT', 'Nuit', 'C', '22:00', '06:00', '2026-10-02'),
    maintien: { previous: slot('MATIN', 'Matin', 'A', '06:00', '14:00'), opens_at: iso('14:30'), closes_at: iso('14:45'), opens: '14:30', closes: '14:45', state: 'OPEN' },
    kpi: { expected: 18, present: count, absent: 18 - count, excused: 1, maintien: 2, anomalies: todo.length }, activity: { refused_today: 6 }, present, todo, movements, permissions: { manual_entry: true } };
}
const REFUSAL = { id: 77, heure: '14:40:10', label: 'x', code: 'EXTRA_BEFORE_WINDOW', message: 'Nouvelle entrée refusée', recorded: false, employee: person(3, 'A'),
  counted: { kind: 'EXTRA_SHIFT', scheduled_start: iso('14:00'), window_opens_at: iso('14:30'), window_closes_at: iso('14:45'), previous: { scheduled_start: iso('06:00'), scheduled_end: iso('14:00'), actual_exit: iso('14:04') } } };

// Sonde exécutée DANS la page : géométrie des blocs à 6 s, 12 s (état B), 24 s et 30 s.
// (.wedge-input est le champ technique de la douchette USB, volontairement placé hors écran.)
const PROBE = `
(function(){
  // L'état des données suit le temps de la page (déterministe) : A, puis B de 8 s à 16 s, puis A.
  const t0=performance.now(),nativeFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>{let u=String(url);if(u.includes('/attendance-live')){const t=performance.now()-t0;u+=(u.includes('?')?'&':'?')+'state='+(t>=8000&&t<16000?'B':'A')}return nativeFetch(u,options)};
  const ids=['shiftBanner','postKpis','scannerCard','todoCard','presentNowCard','movementsCard'];
  const box=id=>{const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect();return {top:Math.round(r.top+scrollY),left:Math.round(r.left),width:Math.round(r.width),height:Math.round(r.height)}};
  const sample=()=>{const kpis=[...document.querySelectorAll('#postKpis .v5-kpi')].map(k=>{const r=k.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top)]});
    const grid=document.querySelector('.work-grid').getBoundingClientRect();
    return {scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body.scrollWidth,
      boxes:Object.fromEntries(ids.map(id=>[id,box(id)])),kpis,grid:Math.round(grid.width),hasPost:document.body.classList.contains('has-post'),
      present:document.querySelectorAll('#presentNowList .v5-person').length,card:document.getElementById('lastScanCard').className,
      banner:document.getElementById('shiftBanner').innerText.replace(/\\s+/g,' ').replace(/Dans .*/,''),
      headerCollision:(()=>{const vis=el=>{const r=el.getBoundingClientRect(),st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'};
        const hit=sel=>{const b=[...document.querySelectorAll(sel)].filter(vis).map(el=>el.getBoundingClientRect());return b.some((x,i)=>b.slice(i+1).some(y=>x.left<y.right-1&&y.left<x.right-1&&x.top<y.bottom-1&&y.top<x.bottom-1))};
        return hit('.top-row>*')||hit('.top-actions>*')||hit('.brand,#headerClock,.site-control')})(),
      dateVisible:(()=>{const el=document.querySelector('#headerClock .seg-date');return !!el&&el.getBoundingClientRect().width>0})(),
      filterHeight:Math.round(document.querySelector('[data-move-filter]').getBoundingClientRect().height),
      outside:[...document.querySelectorAll('#appView *')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&!el.closest('.hidden')&&!el.closest('.v5-list,.v5-moves,.live-feed-list,.wedge-input')&&(r.right>document.documentElement.clientWidth+1||r.left<-1)}).map(el=>el.tagName+'.'+String(el.className).split(' ')[0]).slice(0,5)}};
  const out={};
  [[6000,'t6'],[12000,'t12'],[24000,'t24'],[30000,'t30']].forEach(([ms,key])=>setTimeout(()=>{out[key]=sample();if(key==='t30')parent.postMessage({probe:out},'*')},ms));
})();`;

function startServer() {
  let refused = false;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (url.pathname === '/frame') {
      const width = Number(url.searchParams.get('w'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(`<!doctype html><html><body style="margin:0"><iframe src="/app" style="border:0;width:${width}px;height:900px"></iframe><pre id="probe"></pre>
        <script>addEventListener('message',e=>{if(e.data&&e.data.probe)document.getElementById('probe').textContent='PROBE'+JSON.stringify(e.data.probe)+'ENDPROBE'})</script></body></html>`);
    }
    if (url.pathname === '/app') {
      const html = fs.readFileSync(path.join(STATIC, 'pointeur.html'), 'utf8');
      const session = JSON.stringify({ token: 'tok', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de recette' } });
      const boot = `<script>localStorage.setItem('atlas_pointer_session',${JSON.stringify(session)});localStorage.setItem('atlas_pointer_site','12');</script>`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(html.replace('<head>', '<head>' + boot).replace('</body>', `<script>${PROBE}</script></body>`));
    }
    if (url.pathname === '/api/portal/attendance-live') {
      const state = url.searchParams.get('state') === 'B' ? 'B' : 'A';            // changement d'état des données, puis retour
      const fresh = state === 'B' && url.searchParams.has('after_refusal_id') && Number(url.searchParams.get('after_refusal_id')) < 77;
      refused = refused || state === 'B';
      return json({ latest_event_id: 50, events: [], latest_refusal_id: refused ? 77 : 9, refusals: fresh ? [REFUSAL] : [], alerts: [],
        summary: { entries_today: 21, exits_today: 9, present_now: 9, absent_today: 0 }, timezone: 'Africa/Algiers', server_now: iso('14:40'), operational_date: '2026-10-01', server_time: '14:40:00', post: post(state) });
    }
    if (url.pathname === '/api/portal/attendance-sites') return json([{ id: 12, name: 'SITE DE RECETTE', indicatif: 'REC' }]);
    if (url.pathname.startsWith('/api/')) return json([]);
    const file = path.join(STATIC, decodeURIComponent(url.pathname.replace(/^\/static\//, '')));
    if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Chrome headless ne se termine pas toujours seul sur une page qui interroge le serveur en continu :
// la sortie est lue au fil de l'eau et le processus arrêté dès que la sonde est écrite.
function probe(port, width) {
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pointeur-v5-chrome-'));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--window-size=1720,1000',
    `--user-data-dir=${profile}`, '--virtual-time-budget=34000', '--dump-dom', `http://127.0.0.1:${port}/frame?w=${width}`];
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

for (const width of WIDTHS) {
  test(`Chrome réel ${width}px : aucun débordement, disposition attendue, mise en page stable sur 30 s`, { skip: SKIP, timeout: 150000 }, async () => {
    const server = await startServer();
    let out;
    try { out = await probe(server.address().port, width); } finally { server.close(); }
    for (const key of ['t6', 't12', 't24', 't30']) {
      const s = out[key];
      assert.ok(s.hasPost, `${key} : poste de contrôle affiché`);
      assert.equal(s.clientWidth, width, `${key} : largeur du cadre`);
      assert.ok(s.scrollWidth <= s.clientWidth, `${key} : débordement horizontal ${s.scrollWidth} > ${s.clientWidth}`);
      assert.ok(s.bodyScrollWidth <= s.clientWidth, `${key} : débordement du body`);
      assert.deepEqual(s.outside, [], `${key} : éléments hors écran`);
      assert.match(s.banner, /APRÈS-MIDI 14:00 → 22:00 GROUPE B/, `${key} : vacation inchangée`);
      assert.equal(s.headerCollision, false, `${key} : collision dans le header`);
      assert.equal(s.dateVisible, true, `${key} : date métier visible`);
    }
    // Changement d'état des données (12 s) : le haut de page et les largeurs ne bougent pas.
    assert.equal(out.t12.present, 14); assert.equal(out.t6.present, 9); assert.equal(out.t30.present, 9);
    assert.match(out.t12.card, /is-refused/, 'refus affiché pendant le changement d\'état');
    assert.match(out.t30.card, /is-idle/, 'retour à l\'attente');
    for (const key of ['t12', 't24', 't30']) {
      for (const id of ['shiftBanner', 'postKpis']) assert.deepEqual(out[key].boxes[id], out.t6.boxes[id], `${id} stable (${key})`);
      for (const id of Object.keys(out.t6.boxes)) assert.equal(out[key].boxes[id].width, out.t6.boxes[id].width, `${id} : largeur stable (${key})`);
      assert.deepEqual(out[key].kpis, out.t6.kpis, `KPI stables (${key})`);
    }
    // Rafraîchissements répétés à données identiques : strictement aucun changement de mise en page.
    assert.deepEqual(out.t30.boxes, out.t24.boxes, 'mise en page identique de 24 s à 30 s (3 rafraîchissements)');

    const b = out.t30.boxes, tops = out.t30.kpis.map((k) => k[1]);
    if (width >= 1024) {
      assert.equal(new Set(tops).size, 1, '5 KPI sur une ligne');
      assert.ok(b.presentNowCard.left > b.scannerCard.left + b.scannerCard.width - 2, 'deux colonnes');
      const ratio = b.scannerCard.width / out.t30.grid;
      assert.ok(ratio > 0.6 && ratio < 0.68, `colonne de pointage ≈ 65 % (${ratio.toFixed(3)})`);
      assert.ok(b.movementsCard.top >= b.scannerCard.top + b.scannerCard.height, 'derniers mouvements sous les deux colonnes');
    } else {
      // Une colonne, dans l'ordre : vacation, KPI, pointage, à traiter, présents, mouvements.
      const order = ['shiftBanner', 'postKpis', 'scannerCard', 'todoCard', 'presentNowCard', 'movementsCard'].map((id) => b[id].top);
      assert.deepEqual(order, [...order].sort((x, y) => x - y), `ordre des blocs ${order}`);
      assert.ok(Math.abs(b.todoCard.left - b.scannerCard.left) <= 2, 'une seule colonne');
    }
    if (width <= 430) {
      assert.equal(tops[0], tops[1], 'KPI en grille 2 colonnes'); assert.ok(tops[2] > tops[0]);
      assert.ok(out.t30.filterHeight >= 44, `cible tactile ${out.t30.filterHeight}px`);
    }
  });
}
