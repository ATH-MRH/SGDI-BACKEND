// Pointeur V5.1 — KPI compacts et résultat de pointage en carte flottante, en Chrome RÉEL
// (Chrome headless en ligne de commande). Lancer : npm run test:pointeur-v5-chrome
// La vraie page (app/static/pointeur.html) est servie telle quelle dans un cadre de la largeur
// testée ; le réseau est simulé par des fixtures isolées ici et les résultats de pointage sont
// présentés par les fonctions réelles de la page (showLastScan, showLastRefusal, showResult).
// Vérifie, à 1600 / 1440 / 1280 / 1024 / 768 / 430 / 390 :
//  - barre KPI et activité du jour compactes, avec des valeurs 0 / 9 / 99 / 999 ;
//  - carte flottante : entrée et sortie QR, entrée et sortie faciales, saisie manuelle, maintien,
//    refus — bonnes données, une seule carte, fermeture ×, Échap et automatique ;
//  - AUCUN déplacement de la mise en page quand la carte apparaît (QR, saisie manuelle, facial) ;
//  - le mode facial (aperçu, détection) n'est pas interrompu par la carte ;
//  - aucun débordement horizontal, QR → Manuel → Facial → QR sans saut de page, stable à 31 s.
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
const FRAME_HEIGHT = 900;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAYAAAA7KqwyAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const CAMERA = [{ id: 7, site_id: 12, name: 'CAM-ENTREE-01', location: 'Entrée principale', adapter: 'DAHUA', usage: 'ATTENDANCE', role: 'ENTRY', is_default: true, active: true, facial_attendance_enabled: true }];

const iso = (hhmm, day = '2026-10-01') => `${day}T${hhmm}:00+01:00`;
const slot = (shift, label, group, start, end, endDay) => ({ shift, shift_label: label, group, work_date: '2026-10-01', start, end, scheduled_start: iso(start), scheduled_end: iso(end, endDay) });
const person = (i) => ({ id: 100 + i, matricule: `T${String(i).padStart(3, '0')}`, nom: `FIXTURE${i}`, prenom: 'Test', fonction: 'Agent de sécurité', poste: 'Agent', group: 'B', photo: '' });
function post(kpi) {
  const present = Array.from({ length: 6 }, (_, i) => ({ employee: person(i), event_id: i, entry: '13:4' + i, entry_at: iso('13:40'), shift_start: '14:00', shift_end: '22:00', kind: 'NORMAL', badge: 'EN_POSTE', badge_label: 'EN POSTE' }));
  const todo = [{ key: 'a0', anomaly_id: 1, code: 'VACATION_NON_CLOTUREE', label: 'Vacation non clôturée', severity: 'warning', message: 'Vacation 06:00 → 14:00 sans sortie enregistrée', employee: person(7), scheduled_end: '14:00', overdue_since: '14:45', action: null }];
  const movements = Array.from({ length: 8 }, (_, i) => ({ key: 'm' + i, type: i % 2 ? 'SORTIE' : 'ENTREE', label: i % 2 ? 'SORTIE' : 'ENTRÉE', heure: `14:${String(59 - i).padStart(2, '0')}:12`, at: iso('14:30'), matricule: `T00${i}`, name: `FIXTURE${i} Test`, detail: null }));
  return { site_id: 12, site: 'SITE DE RECETTE', status: 'OFFICIAL', reason: null, current: slot('APRES_MIDI', 'Après-midi', 'B', '14:00', '22:00'), next: slot('NUIT', 'Nuit', 'C', '22:00', '06:00', '2026-10-02'), maintien: null,
    kpi: { expected: kpi, present: kpi, absent: kpi, excused: kpi ? 1 : 0, maintien: kpi, anomalies: kpi }, activity: { refused_today: kpi }, present, todo, movements, permissions: { manual_entry: true } };
}

// Sonde exécutée DANS la page. (.wedge-input : champ technique de la douchette, hors écran exprès.)
const PROBE = `
(function(){
  let recognize=0;const nativeFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>{if(String(url).includes('/recognize'))recognize++;return nativeFetch(url,options)};
  const iso=hhmm=>'2026-10-01T'+hhmm+':00+01:00';
  const SITE='DHL FORWARDING / HAMOUL 01 (40K)';
  const E=i=>({id:200+i,matricule:'K'+(38+i),nom:i===1?'BOUHELEL':'FIXTURE-NOM-PARTICULIEREMENT-LONG',prenom:i===1?'ABDELILLAH':'Prénom-Composé',fonction:i===1?'CARISTE':'Chef de poste principal de nuit',poste:'CARISTE',societe:'IRON GLOBAL SOLUTION',site:SITE,photo:''});
  const counted={kind:'NORMAL',group:'B',scheduled_start:iso('14:00'),scheduled_end:iso('22:00'),actual_entry:'2026-10-01T13:37:24+01:00',counted_start:iso('14:00')};
  const EV=(id,type,source,extra)=>Object.assign({id,type,heure:type==='ENTREE'?'14:21:41':'22:18:13',date:'2026-10-01',source,source_label:source,site:SITE,site_id:12,state:type==='ENTREE'?'PRESENT':'SORTI',employee:E(1),
    counted:type==='ENTREE'?counted:Object.assign({},counted,{actual_exit:'2026-10-01T22:18:13+01:00',counted_end:iso('22:00'),counted_minutes:480})},extra||{});
  const CASES={
    qrIn:()=>showLastScan(EV(901,'ENTREE','QR')),
    qrOut:()=>showLastScan(EV(902,'SORTIE','QR')),
    faceIn:()=>showLastScan(EV(903,'ENTREE','FACIAL',{terminal:'CAM-ENTREE-01'})),
    faceOut:()=>showLastScan(EV(904,'SORTIE','FACIAL',{terminal:'CAM-ENTREE-01'})),
    manual:()=>showLastScan(EV(905,'ENTREE','MANUAL')),
    maintien:()=>showLastScan(EV(906,'ENTREE','QR',{employee:E(2),counted:{kind:'EXTRA_SHIFT',group:'A',scheduled_start:iso('14:00'),scheduled_end:iso('22:00'),actual_entry:'2026-10-01T14:34:00+01:00',counted_start:iso('14:34')}})),
    refusal:()=>showLastRefusal({id:907,heure:'14:40:10',label:'x',code:'EXTRA_BEFORE_WINDOW',message:'Nouvelle entrée refusée',employee:E(1),
      counted:{kind:'EXTRA_SHIFT',scheduled_start:iso('14:00'),window_opens_at:iso('14:30'),window_closes_at:iso('14:45'),previous:{scheduled_start:iso('06:00'),scheduled_end:iso('14:00'),actual_exit:iso('14:04')}}}),
    immediate:()=>showResult({name:'BOUHELEL ABDELILLAH',matricule:'K39',action:'arrivee',heure:'14:21:41',site:SITE,societe:'IRON GLOBAL SOLUTION',poste:'CARISTE'},'success'),
    error:()=>showResult({message:'QR invalide'},'error'),
  };
  const $=s=>document.querySelector(s);
  const rect=el=>{const r=el.getBoundingClientRect();return {left:Math.round(r.left),top:Math.round(r.top),right:Math.round(r.right),bottom:Math.round(r.bottom),width:Math.round(r.width),height:Math.round(r.height)}};
  const TRACKED=['#shiftBanner','#postKpis','.status-row','#scannerCard','.mode-grid','#qrModeBtn','#faceModeBtn','#manualModeBtn','#manualPanel','#manualQuery','#faceView','#presentNowCard','#todoCard','#systemCard','#movementsCard'];
  const layout=()=>Object.fromEntries(TRACKED.map(s=>{const el=$(s),r=el.getBoundingClientRect();return [s,[Math.round(r.left),Math.round(r.top+scrollY),Math.round(r.width),Math.round(r.height)]]}));
  const overflow=()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyScrollWidth:document.body.scrollWidth,
    outside:[...document.querySelectorAll('#appView *')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&!el.closest('.hidden')&&!el.closest('.v5-list,.v5-moves,.live-feed-list,.wedge-input')&&(r.right>document.documentElement.clientWidth+1||r.left<-1)}).map(el=>el.tagName+'.'+String(el.className).split(' ')[0]).slice(0,5)});
  const card=()=>{const el=$('#scanResultCard'),open=document.querySelectorAll('.scan-result.is-open').length,photo=$('#lastScanPhoto'),close=el.querySelector('.sr-close'),st=getComputedStyle(el);
    return {open,cls:el.className,role:el.getAttribute('role'),text:el.innerText.replace(/\\s+/g,' ').trim(),rect:rect(el),position:st.position,zIndex:st.zIndex,
      scrolls:el.scrollHeight>el.clientHeight+1,photo:photo?Object.assign(rect(photo),{img:!!photo.querySelector('img')}):null,
      close:close?Object.assign(rect(close),{label:close.getAttribute('aria-label'),tag:close.tagName,tabIndex:close.tabIndex}):null,focusIn:el.contains(document.activeElement)}};
  const shot=()=>({card:card(),layout:layout(),overflow:overflow()});
  const out={cases:{}};
  setTimeout(()=>{
    // Mode QR posé explicitement : au chargement il l'est par requestAnimationFrame, que le temps virtuel ne garantit pas.
    $('#qrModeBtn').click();
    const kpis=[...document.querySelectorAll('#postKpis .v5-kpi')];
    out.viewport={width:document.documentElement.clientWidth,height:innerHeight};
    out.header=(()=>{const el=$('#appView>.top');return {bottom:Math.round(el.getBoundingClientRect().bottom),sticky:getComputedStyle(el).position==='sticky',zIndex:getComputedStyle(el).zIndex}})();
    out.metrics={kpis:rect($('#postKpis')).height,activity:rect($('.status-row')).height,
      cells:kpis.map(k=>{const r=k.getBoundingClientRect(),b=k.querySelector('b'),s=k.querySelector('small'),br=b.getBoundingClientRect(),sr=s.getBoundingClientRect();
        return {left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height),label:s.innerText,value:b.innerText,tone:k.dataset.tone,
          inside:br.left>=r.left-1&&br.right<=r.right+1&&br.top>=r.top-1&&br.bottom<=r.bottom+1&&sr.left>=r.left-1&&sr.bottom<=r.bottom+1,overlap:sr.right>br.left+1&&sr.left<br.right-1&&sr.bottom>br.top+1&&sr.top<br.bottom-1,
          valueSize:parseFloat(getComputedStyle(b).fontSize)}}),
      activityText:$('.status-row').innerText.replace(/\\s+/g,' ').trim(),
      activityItems:[...document.querySelectorAll('.status-row .v5-activity-label,.status-row .presence-summary button,.status-row .v5-activity-chip')].filter(el=>el.getBoundingClientRect().width>0).map(el=>rect(el))};
    out.base={layout:layout(),overflow:overflow(),card:card()};
    for(const key of Object.keys(CASES)){CASES[key]();out.cases[key]=shot()}
    // Deux pointages coup sur coup : une seule carte, le second remplace le premier.
    CASES.qrIn();CASES.maintien();out.rapid=card();
    $('#scanResultCard .sr-close').click();out.closedByButton=card();
    CASES.qrIn();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));out.closedByEscape=card();
    // Saisie manuelle : le formulaire reste exactement à sa place quand la carte apparaît.
    $('#manualModeBtn').click();out.manualBase=layout();CASES.manual();out.manualShown=shot();$('#scanResultCard .sr-close').click();
    $('#faceModeBtn').click();
  },5000);
  setTimeout(()=>{out.faceBase={layout:layout(),recognize,facial:$('#scannerCard').classList.contains('facial-mode')};window.__preview=$('#facePreview');CASES.faceIn();out.faceShown=shot()},9000);
  setTimeout(()=>{out.faceDuring={card:card(),recognize,layout:layout()}},12000);
  setTimeout(()=>{out.faceAfter={card:card(),recognize,layout:layout(),facial:$('#scannerCard').classList.contains('facial-mode'),samePreview:window.__preview===$('#facePreview'),
    previewShown:$('#facePreview').getBoundingClientRect().width>0,status:$('#faceStatus').innerText.replace(/\\s+/g,' ').trim()};$('#qrModeBtn').click()},16000);
  setTimeout(()=>{out.qrBack={layout:layout(),overflow:overflow(),recognize}},19000);
  setTimeout(()=>{out.t31={layout:layout(),overflow:overflow(),card:card(),recognize};parent.postMessage({probe:out},'*')},31000);
})();`;

function startServer(kpi) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const json = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (url.pathname === '/frame') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(`<!doctype html><html><body style="margin:0"><iframe src="/app" style="border:0;width:${Number(url.searchParams.get('w'))}px;height:${FRAME_HEIGHT}px"></iframe><pre id="probe"></pre>
        <script>addEventListener('message',e=>{if(e.data&&e.data.probe)document.getElementById('probe').textContent='PROBE'+JSON.stringify(e.data.probe)+'ENDPROBE'})</script></body></html>`);
    }
    if (url.pathname === '/app') {
      const session = JSON.stringify({ token: 'tok', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste de recette' } });
      const boot = `<script>localStorage.setItem('atlas_pointer_session',${JSON.stringify(session)});localStorage.setItem('atlas_pointer_site','12');</script>`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(fs.readFileSync(path.join(STATIC, 'pointeur.html'), 'utf8').replace('<head>', '<head>' + boot).replace('</body>', `<script>${PROBE}</script></body>`));
    }
    if (url.pathname === '/api/biometrics/status') return json({ enabled: true, engine_available: true });
    if (url.pathname === '/api/biometrics/cameras') return json(url.searchParams.get('site_id') === '12' ? CAMERA : []);
    if (url.pathname.endsWith('/preview.jpg') || url.pathname.endsWith('/portrait')) { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return response.end(PIXEL); }
    if (url.pathname.endsWith('/recognize')) return json({ state: 'NO_FACE', recorded: false, reasons: [] });
    if (url.pathname === '/api/portal/attendance-live') return json({ latest_event_id: 50, events: [], latest_refusal_id: 9, refusals: [], alerts: [], summary: { entries_today: kpi, exits_today: kpi, present_now: kpi, absent_today: 0 },
      timezone: 'Africa/Algiers', server_now: iso('14:40'), operational_date: '2026-10-01', server_time: '14:40:00', post: post(kpi) });
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pointeur-compact-chrome-'));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--window-size=1720,1000',
    `--user-data-dir=${profile}`, '--virtual-time-budget=35000', '--dump-dom', `http://127.0.0.1:${port}/frame?w=${width}`];
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
async function run(width, kpi) {
  const server = await startServer(kpi);
  try { return await probe(server.address().port, width); } finally { server.close(); }
}

function assertNoOverflow(o, width, label) {
  assert.equal(o.clientWidth, width, `${label} : largeur du cadre`);
  assert.ok(o.scrollWidth <= o.clientWidth && o.bodyScrollWidth <= o.clientWidth, `${label} : débordement horizontal (${o.scrollWidth} > ${o.clientWidth})`);
  assert.deepEqual(o.outside, [], `${label} : éléments hors écran`);
}
function assertKpis(out, width, kpi, t) {
  const m = out.metrics, tops = m.cells.map((c) => c.top), value = String(kpi);
  t.diagnostic(`${width}px · KPI ${m.kpis}px · activité ${m.activity}px (valeurs ${value})`);
  assert.deepEqual(m.cells.map((c) => c.label.replace(/\s+/g, ' ')), ['ATTENDUS', 'PRÉSENTS', 'ABSENTS / NON POINTÉS', 'EN MAINTIEN', 'ANOMALIES']);
  assert.deepEqual(m.cells.map((c) => c.value), Array(5).fill(value));
  // Couleurs sémantiques inchangées : rouge / orange uniquement quand la valeur est non nulle.
  assert.deepEqual(m.cells.map((c) => c.tone), ['blue', 'green', kpi ? 'red' : 'muted', kpi ? 'orange' : 'muted', kpi ? 'red' : 'muted']);
  for (const c of m.cells) {
    assert.ok(c.inside && !c.overlap, `KPI « ${c.label} » : libellé et valeur dans leur case, sans chevauchement`);
    assert.ok(c.valueSize >= 22, `valeur lisible (${c.valueSize}px)`);
  }
  if (width >= 1024) {
    assert.equal(new Set(tops).size, 1, '5 KPI sur une ligne');
    assert.ok(m.kpis >= 48 && m.kpis <= 64, `barre KPI compacte (${m.kpis}px)`);
    assert.ok(m.activity >= 28 && m.activity <= 38, `activité du jour sur une ligne (${m.activity}px)`);
  } else if (width >= 760) {
    assert.deepEqual([tops[0] === tops[2], tops[3] === tops[4], tops[3] > tops[0]], [true, true, true], '3 KPI puis 2');
    assert.ok(m.kpis <= 110, `grille KPI compacte (${m.kpis}px)`);
    assert.ok(m.activity <= 38, `activité du jour sur une ligne (${m.activity}px)`);
  } else {
    assert.equal(tops[0], tops[1], 'KPI en grille 2 colonnes'); assert.ok(tops[2] > tops[0]);
    assert.ok(m.kpis <= 150, `grille KPI compacte (${m.kpis}px)`);
    assert.ok(m.activity <= 72, `activité du jour compacte (${m.activity}px)`);
  }
  assert.match(m.activityText, new RegExp(`^ACTIVITÉ DU JOUR Entrées ${String(kpi).padStart(2, '0')} Sorties ${String(kpi).padStart(2, '0')} Refus ${kpi}$`));
  const items = m.activityItems;
  assert.ok(items.every((a, i) => items.slice(i + 1).every((b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)), 'activité : aucune collision');
}

for (const width of WIDTHS) {
  test(`Chrome réel ${width}px : KPI compacts, carte flottante de résultat, aucun déplacement de la mise en page`, { skip: SKIP, timeout: 150000 }, async (t) => {
    const out = await run(width, 999);
    assertKpis(out, width, 999, t);
    assertNoOverflow(out.base.overflow, width, 'au repos');
    assert.equal(out.base.card.open, 0, 'aucune carte au repos');

    const expected = {
      qrIn: ['is-entry', 'status', /^ENTRÉE ENREGISTRÉE QR VALIDÉ.*BOUHELEL ABDELILLAH K39 · CARISTE DHL FORWARDING \/ HAMOUL 01 \(40K\).*14:21:41.*Début planifié 14:00 Temps comptabilisé à partir de 14:00 ÉTAT ACTUEL : PRÉSENT$/],
      qrOut: ['is-exit', 'status', /^SORTIE ENREGISTRÉE QR VALIDÉ.*BOUHELEL ABDELILLAH K39 · CARISTE.*22:18:13.*Fin planifiée 22:00 Temps comptabilisé jusqu’à 22:00 Durée comptabilisée 8 h 00 ÉTAT ACTUEL : VACATION TERMINÉE$/],
      faceIn: ['is-entry', 'status', /^ENTRÉE ENREGISTRÉE IDENTIFIÉ.*BOUHELEL ABDELILLAH.*CAM-ENTREE-01.*14:21:41.*ÉTAT ACTUEL : PRÉSENT$/],
      faceOut: ['is-exit', 'status', /^SORTIE ENREGISTRÉE IDENTIFIÉ.*BOUHELEL ABDELILLAH.*22:18:13.*ÉTAT ACTUEL : VACATION TERMINÉE$/],
      manual: ['is-entry', 'status', /^ENTRÉE ENREGISTRÉE SAISIE MANUELLE.*BOUHELEL ABDELILLAH K39 · CARISTE.*14:21:41.*ÉTAT ACTUEL : PRÉSENT$/],
      maintien: ['is-maintien', 'status', /^MAINTIEN ENREGISTRÉ QR VALIDÉ.*FIXTURE-NOM-PARTICULIEREMENT-LONG Prénom-Composé K40 · Chef de poste principal de nuit.*14:21:41.*Deuxième vacation 14:00 → 22:00 Début réel 14:34:00 Temps comptabilisé à partir de 14:34 ÉTAT ACTUEL : EN MAINTIEN$/],
      refusal: ['is-refused', 'alert', /^POINTAGE REFUSÉ.*BOUHELEL ABDELILLAH K39 · CARISTE NOUVELLE ENTRÉE NON AUTORISÉE 14:40:10 Vacation précédente 06:00 → 14:00 Sortie enregistrée 14:04 Nouvelle entrée possible 14:30 → 14:45 AUCUN MOUVEMENT ENREGISTRÉ$/],
      immediate: ['is-entry', 'status', /^ENTRÉE ENREGISTRÉE.*BOUHELEL ABDELILLAH K39 · CARISTE.*14:21:41$/],
      error: ['is-refused', 'alert', /^POINTAGE REFUSÉ.*QR invalide AUCUN MOUVEMENT ENREGISTRÉ$/],
    };
    const column = out.base.layout['#scannerCard'];
    for (const [key, [tone, role, text]] of Object.entries(expected)) {
      const { card, layout, overflow } = out.cases[key], r = card.rect, label = `${key} @${width}`;
      assert.equal(card.open, 1, `${label} : une seule carte visible`);
      assert.ok(card.cls.split(' ').includes(tone), `${label} : ${card.cls}`); assert.equal(card.role, role);
      assert.match(card.text, text, label);
      // Hors flux : strictement aucun bloc ne bouge quand la carte apparaît.
      assert.deepEqual(layout, out.base.layout, `${label} : mise en page inchangée`);
      assertNoOverflow(overflow, width, label);
      assert.equal(card.position, 'fixed'); assert.equal(card.zIndex, '900');
      assert.ok(r.left >= 11 && r.right <= width - 11, `${label} : marges latérales (${r.left} → ${r.right})`);
      assert.ok(r.top >= (out.header.sticky ? out.header.bottom : 0) && r.bottom <= out.viewport.height, `${label} : dans l'écran, sous le header (${r.top} → ${r.bottom})`);
      assert.equal(card.scrolls, false, `${label} : contenu entièrement visible`);
      assert.equal(card.focusIn, false, `${label} : le focus n'est pas déplacé`);
      if (width >= 1024) {
        assert.ok(r.width >= 520 && r.width <= 600, `${label} : largeur ${r.width}px`);
        assert.ok(Math.abs((r.left + r.right) / 2 - (column[0] + column[2] / 2)) <= 2, `${label} : centrée sur la colonne Pointage`);
        assert.ok(r.width < column[2], `${label} : plus étroite que la colonne`);
      } else if (width >= 760) assert.ok(r.width <= 520, `${label} : largeur tablette ${r.width}px`);
      else assert.deepEqual([r.left, width - r.right], [12, 12], `${label} : 12 px de chaque côté`);
      assert.ok(r.height <= (width < 760 ? 310 : 280), `${label} : carte compacte (${r.height}px)`);
      if (key !== 'error') {
        assert.ok(card.photo.width >= (width >= 760 ? 90 : 56) && card.photo.width <= 120, `${label} : photo ${card.photo.width}px`);
        assert.ok(card.photo.left - r.left < 30, `${label} : photo à gauche`);
      } else assert.equal(card.photo, null, 'refus sans employé identifié : pas d\'avatar inventé');
      assert.equal(card.close.tag, 'BUTTON'); assert.equal(card.close.label, 'Fermer le résultat'); assert.equal(card.close.tabIndex, 0);
      assert.ok(card.close.width >= 32 && r.right - card.close.right < 24 && card.close.top - r.top < 24, `${label} : × en haut à droite`);
    }
    t.diagnostic(`${width}px · carte ${out.cases.qrIn.card.rect.width}×${out.cases.qrIn.card.rect.height}px · photo ${out.cases.qrIn.card.photo.width}×${out.cases.qrIn.card.photo.height}px · refus ${out.cases.refusal.card.rect.height}px`);

    // Pointages successifs : une seule carte, contenu du dernier.
    assert.equal(out.rapid.open, 1); assert.match(out.rapid.text, /MAINTIEN ENREGISTRÉ.*FIXTURE-NOM-PARTICULIEREMENT-LONG/); assert.doesNotMatch(out.rapid.text, /BOUHELEL/);
    assert.equal(out.closedByButton.open, 0, 'fermeture par ×'); assert.equal(out.closedByButton.text, '');
    assert.equal(out.closedByEscape.open, 0, 'fermeture par Échap');

    // Saisie manuelle : le formulaire ne descend plus.
    assert.ok(out.manualBase['#manualQuery'][2] > 0, 'formulaire de saisie manuelle affiché');
    assert.equal(out.manualShown.card.open, 1);
    assert.deepEqual(out.manualShown.layout, out.manualBase, 'saisie manuelle : formulaire et panneaux immobiles');
    assertNoOverflow(out.manualShown.overflow, width, 'saisie manuelle');

    // Facial : la carte n'interrompt ni l'aperçu ni la détection, puis se referme seule (6 s).
    assert.equal(out.faceBase.facial, true); assert.ok(out.faceBase.recognize >= 1, 'détection démarrée');
    assert.equal(out.faceShown.card.open, 1);
    assert.deepEqual(out.faceShown.layout, out.faceBase.layout, 'facial : mise en page inchangée à l\'apparition');
    assertNoOverflow(out.faceShown.overflow, width, 'facial');
    assert.equal(out.faceDuring.card.open, 1, 'encore affichée à +3 s');
    assert.equal(out.faceDuring.card.photo.img, true, 'vraie photo de l\'employé chargée');
    assert.ok(out.faceDuring.recognize > out.faceBase.recognize, 'la détection continue sous la carte');
    assert.equal(out.faceAfter.card.open, 0, 'refermée seule à +7 s');
    assert.ok(out.faceAfter.recognize > out.faceDuring.recognize && out.faceAfter.facial && out.faceAfter.samePreview && out.faceAfter.previewShown, 'mode facial intact après la carte');
    assert.match(out.faceAfter.status, /PRÊT — placez-vous face à la caméra/);
    assert.deepEqual(out.faceAfter.layout, out.faceBase.layout, 'facial : mise en page inchangée après la carte');

    // QR → Manuel → Facial → QR : retour exact à la disposition de départ, stable ensuite.
    assert.deepEqual(out.qrBack.layout, out.base.layout, 'retour au QR : même mise en page qu\'au départ');
    for (const sel of ['#shiftBanner', '#postKpis', '.status-row']) for (const state of [out.manualBase, out.faceBase.layout]) assert.deepEqual(state[sel], out.base.layout[sel], `${sel} immobile d'un mode à l'autre`);
    for (const state of [out.manualBase, out.faceBase.layout]) assert.deepEqual(state['#scannerCard'].slice(0, 3), column.slice(0, 3), 'zone de pointage : même position et largeur d\'un mode à l\'autre');
    assert.equal(out.qrBack.recognize, out.t31.recognize, 'facial réellement arrêté en revenant au QR');
    assert.deepEqual(out.t31.layout, out.base.layout, 'mise en page stable à 31 s');
    assertNoOverflow(out.t31.overflow, width, '31 s');
    assert.equal(out.t31.card.open, 0);
  });
}

// Valeurs 0 / 9 / 99 : même barre, à la largeur de bureau la plus étroite, sur tablette et sur mobile.
for (const width of [1024, 768, 390]) {
  for (const kpi of [0, 9, 99]) {
    test(`Chrome réel ${width}px : barre KPI avec la valeur ${kpi}`, { skip: SKIP, timeout: 150000 }, async (t) => {
      const out = await run(width, kpi);
      assertKpis(out, width, kpi, t);
      assertNoOverflow(out.base.overflow, width, `KPI ${kpi}`);
    });
  }
}
