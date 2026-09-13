#!/usr/bin/env node
'use strict';
// Loopback-only development proxy: inject observations, never edit product files.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const base=option('--base','http://127.0.0.1:8766'),port=Number(option('--port','8770')),out=option('--out','/private/tmp/drh-browser-baseline');
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Loopback backend required');
const observer=fs.readFileSync(path.join(__dirname,'frontend-browser-observer.js'),'utf8');
const resetCaches=args.includes('--reset-caches');
const observerHash=crypto.createHash('sha256').update(observer).digest('hex');
let report=0;
function wrap(source,url){let code=String(source);const key=new URL(url,base).pathname;if(key.endsWith('/sgdi-app.js')){if(!code.includes('\nbootApp();'))throw Error('Bootstrap anchor missing');code=code.replace('\nbootApp();',`\nwindow.__drhPerf.installFunctions();\nwindow.__drhPerf.state=()=>({employeeCount:db.agents.length,candidateCount:db.candidats.length,fullDataReady:sgdiFullDataReady,hydrated:sgdiHydrated});\nbootApp();`)}return`window.__drhPerf.scriptStart(${JSON.stringify(key)});\n${code}\nwindow.__drhPerf.scriptEnd(${JSON.stringify(key)});\nwindow.__drhPerf.installFunctions();\n`;}
const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/__perf__/report'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks).toString());const output=out+'-'+(++report)+'.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');process.stdout.write(JSON.stringify({output,phases:data.phases,failure:data.failure})+'\n');res.writeHead(200,{'content-type':'application/json'});res.end('{"saved":true}');return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Local profile blocks business mutations');return;}
  const url=new URL(req.url,base);if(url.origin!==base){res.writeHead(403);res.end();return;}
  if(url.pathname==='/'&&resetCaches){const reset=await fetch(base+'/__perf__/reset-caches',{method:'POST'});if(!reset.ok)throw Error('Synthetic cache reset failed '+reset.status+' '+await reset.text());}
  const headers={};for(const key of ['authorization','accept','content-type'])if(req.headers[key])headers[key]=req.headers[key];
  const response=await fetch(url,{headers});let bytes=Buffer.from(await response.arrayBuffer());const originalBytes=bytes.length;const type=response.headers.get('content-type')||'application/octet-stream';
  if(type.includes('text/html')&&url.pathname==='/'){
    const authResponse=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'perfadmin',password:'Perf-local-2026!'})});const auth=await authResponse.json();const token=auth.access_token||auth.token;if(!token)throw Error('Synthetic authentication failed');
    const session={username:'perfadmin',nom:'Synthetic profile',role:'admin',niveau:'H5',transverse:'drh',societe:null};
    let html=bytes.toString('utf8').replace(/<link[^>]*href="https?:\/\/[^\"]*"[^>]*>/g,'');
    const setup=`localStorage.clear();sessionStorage.clear();sessionStorage.setItem('sgdi_api_token_v1',${JSON.stringify(token)});sessionStorage.setItem('irongs_session_v1',${JSON.stringify(JSON.stringify(session))});window.__SGDI_BACKEND_ENABLED__=true;window.__SGDI_API_ROOT__=location.origin+'/api';history.replaceState(null,'','#/drh/dashboard');`;
    html=html.replace('<head>','<head><script>'+setup+'\n'+observer+`\nwindow.__drhPerf.observerSha256=${JSON.stringify(observerHash)};window.__drhPerf.backendCachePolicy=${JSON.stringify(resetCaches?'reset memory caches before every cold navigation':'uncontrolled (exploratory only)')};`+'</script>');bytes=Buffer.from(html);
  }else if((type.includes('javascript')||url.pathname.endsWith('.js'))&&!url.pathname.includes('/qrcode'))bytes=Buffer.from(wrap(bytes.toString('utf8'),req.url));
  res.writeHead(response.status,{'content-type':type,'content-length':bytes.length,'cache-control':'no-store','x-perf-source-bytes':originalBytes,...(response.headers.get('server-timing')?{'server-timing':response.headers.get('server-timing')}:{})});res.end(bytes);
}catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.stack)}});
server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+port+'/',base,out})+'\n'));
