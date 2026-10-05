// Géométrie des trois actions et de la modale dans le vrai moteur Chrome.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(fs.existsSync);
const context={employee_id:17,employee_name:'Agent Test',matricule:'E17',society:'IGS',site_id:12,site_name:'Site test',position:'Agent',shift_id:31,shift:'APRES_MIDI',scheduled_start_at:'2026-10-05T14:00:00+01:00',scheduled_end_at:'2026-10-05T22:00:00+01:00',actual_departure_at:'2026-10-05T20:35:00+01:00',remaining_minutes:85,threshold_minutes:60,applicable:true};
const setup=`
window.fetch=async url=>({ok:true,status:200,json:async()=>String(url).includes('/abandon/context')?${JSON.stringify(context)}:String(url).includes('attendance-sites')?[{id:12,name:'Site test'}]:{}});
localStorage.setItem('atlas_pointer_session',JSON.stringify({token:'fixture',username:'PTG',user:{username:'PTG'}}));
`;
const probe=`
setTimeout(async()=>{
  stopLivePolling();
  toggleManualPanel();manualResults=[{id:17,nom:'Agent',prenom:'Test',matricule:'E17',societe:'IGS',site:'Site test'}];selectManualResult(0);
  const buttons=[...document.querySelectorAll('.manual-actions button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,right:r.right}});
  await openAbandonModal();
  const modal=document.querySelector('.abandon-modal').getBoundingClientRect();
  const result={buttons,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,modal:{left:modal.left,right:modal.right,top:modal.top,bottom:modal.bottom},height:innerHeight,shown:!document.getElementById('abandonOverlay').classList.contains('hidden')};
  parent.postMessage(result,'*');
},1600);
`;
function dump(port,width){
 const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'abandon-chrome-'));
 return new Promise((resolve,reject)=>{
  const child=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--mute-audio','--no-first-run','--window-size=1720,1000',`--user-data-dir=${profile}`,'--virtual-time-budget=4000','--dump-dom',`http://127.0.0.1:${port}/frame?w=${width}`],{stdio:['ignore','pipe','ignore']});
  let out='',finished=false;
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);child.kill('SIGKILL');const match=/RESULT(\{.*\})ENDRESULT<\/pre>/.exec(out);if(!match)reject(new Error('Sonde Chrome absente'));else resolve(JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&')))};
  const timer=setTimeout(finish,30000);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('ENDRESULT</pre>'))finish()});child.on('close',()=>{finish();try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch{}});child.on('error',reject);
 });
}
test('Chrome : trois actions alignées et modale sans débordement à 390, 430, 768 et 1280 px',{skip:chrome?false:'Chrome indisponible',timeout:150000},async()=>{
 const raw=fs.readFileSync(path.join(__dirname,'../app/static/pointeur.html'),'utf8');
 const html=raw.replace('<script>','<script>'+setup+'<\/script><script>').replace('</body>','<script>'+probe+'<\/script></body>');
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url.startsWith('/frame')){const width=new URL(req.url,'http://localhost').searchParams.get('w');res.end(`<body style="margin:0"><iframe src="/page" style="border:0;width:${Number(width)}px;height:900px"></iframe><script>addEventListener('message',e=>{document.body.insertAdjacentHTML('beforeend','<pre>RESULT'+JSON.stringify(e.data)+'ENDRESULT</pre>')})</script>`)}
  else if(req.url==='/page')res.end(html);else{res.statusCode=404;res.end('')}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const width of [390,430,768,1280]){
  const result=await dump(server.address().port,width);
  assert.equal(result.shown,true);assert.equal(result.overflow,false,JSON.stringify(result));
  const [first,...others]=result.buttons;
  assert.equal(result.buttons.length,3);
  for(const button of others){assert.ok(Math.abs(button.top-first.top)<1);assert.ok(Math.abs(button.width-first.width)<2);assert.equal(button.height,first.height)}
  assert.ok(result.buttons.every(b=>b.left>=0&&b.right<=width));
  assert.ok(result.modal.left>=0&&result.modal.right<=width);assert.ok(result.modal.top>=0&&result.modal.bottom<=result.height);
 }}finally{server.close()}
});
