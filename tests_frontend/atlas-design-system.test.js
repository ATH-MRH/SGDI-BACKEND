const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../app/static');
const ds = path.join(root, 'design-system');
const entries = {
  'index.html':'legacy', 'finance-platform/index.html':'finance', 'site-workforce/index.html':'beo',
  'pointage/index.html':'pointage', 'pointeur.html':'pointeur', 'drh-next/index.html':'drh-next',
  'client-portail.html':'client', 'portail-rh-bilingue.html':'employee', 'candidat.html':'candidate',
  'recrute.html':'recruitment', 'rh.html':'rh', 'commercial.html':'commercial', 'prets.html':'loans',
  'supervision.html':'supervision', 'cheque.html':'cheque', 'paie.html':'paie',
  'facturation.html':'facturation', 'conges.html':'conges', 'atlas-v3/index.html':'core-v3'
};

test('every independently served frontend loads one shared screen theme after its local styles', () => {
  for (const [file, surface] of Object.entries(entries)) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'));
    const d = dom.window.document;
    assert.ok(d.body.classList.contains('atlas-ui'), file);
    assert.equal(d.body.dataset.atlasSurface, surface, file);
    const styles = [...d.head.querySelectorAll('link[rel="stylesheet"],style')];
    const theme = styles.filter(el => el.getAttribute('href')?.includes('/design-system/atlas.css'));
    assert.equal(theme.length, 1, file);
    assert.equal(theme[0], styles.at(-1), file + ' theme must win local cascade');
    assert.equal(theme[0].media, 'screen', file + ' print must retain its own rules');
    dom.window.close();
  }
});

test('shared styles parse, reference real tokens and keep colors in the canonical palette', () => {
  const files = ['tokens.css','components.css','legacy.css','specialized.css','sidebar.css','shell.css'];
  const tokens = new Set([...fs.readFileSync(path.join(ds,'tokens.css'),'utf8').matchAll(/(--atlas-[\w-]+)\s*:/g)].map(m=>m[1]));
  for (const file of files) {
    const source = fs.readFileSync(path.join(ds,file),'utf8');
    const errors=[];
    const ast=csstree.parse(source,{onParseError:e=>errors.push(e.message)});
    assert.deepEqual(errors,[],file);
    for(const [,name] of source.matchAll(/var\((--atlas-[\w-]+)/g)) assert.ok(tokens.has(name),file+': '+name);
    if(file==='tokens.css') continue;
    csstree.walk(ast,node=>{
      if(node.type==='Declaration') {
        const value=csstree.generate(node.value);
        assert.doesNotMatch(value, /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i,file+' duplicates palette: '+value);
        assert.doesNotMatch(value, /\b(?:white|black|navy|blue|red|green)\b/i,file+' bypasses canonical palette');
      }
    });
    for(const node of ast.children) {
      assert.equal(node.type,'Atrule',file+' must stay scoped to screen');
      assert.equal(node.name,'media',file);
      assert.match(csstree.generate(node.prelude),/screen/,file);
    }
  }
});

test('shared imports are local and versioned together; no external font or image download added', () => {
  const source=fs.readFileSync(path.join(ds,'atlas.css'),'utf8');
  const imports=[...source.matchAll(/@import url\('\.\/([^']+)'\)/g)].map(m=>m[1]);
  assert.deepEqual(imports.map(s=>s.split('?')[0]),['tokens.css','components.css','legacy.css','specialized.css','sidebar.css','shell.css']);
  assert.equal(new Set(imports.map(s=>s.split('?')[1])).size,1);
  for(const file of fs.readdirSync(ds).filter(f=>f.endsWith('.css'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(ds,file),'utf8'),/https?:|data:|@font-face/);
  }
});

function luminance(hex) {
  return hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255)
    .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
}
test('canonical light theme text and semantic badges meet WCAG AA contrast', () => {
  const source=fs.readFileSync(path.join(ds,'tokens.css'),'utf8').split('/* These existing')[0];
  const palette=Object.fromEntries([...source.matchAll(/--atlas-([\w-]+):\s*(#[\da-f]{6});/g)].map(m=>[m[1],m[2]]));
  for(const [ink,paper] of [['text','surface'],['text-secondary','surface'],['text-muted','surface'],['sidebar-text','surface'],['primary','primary-soft'],['on-primary','primary'],['success','success-soft'],['warning','warning-soft'],['danger','danger-soft'],['info','info-soft']]) {
    const a=luminance(palette[ink]), b=luminance(palette[paper]);
    const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(ratio>=4.5,`${ink} / ${paper}: ${ratio.toFixed(2)}`);
  }
  // Sidebar V3 (bleu marine) : texte, titres de section, badges et entrée active lisibles
  // sur chaque point du dégradé.
  for (const [ink,paper] of [['sidebar-fg','sidebar-bg-start'],['sidebar-fg','sidebar-bg-end'],['sidebar-muted','sidebar-bg-start'],['sidebar-muted','sidebar-bg-end'],
    ['sidebar-subtle','sidebar-bg-start'],['sidebar-fg','sidebar-active'],['sidebar-fg','sidebar-active-end'],['sidebar-fg','sidebar-badge'],
    // Global Shell V4 : header blanc et bandeau KPI marine.
    ['header-text','header-bg'],['header-muted','header-bg'],
    ['kpi-text','kpi-bg-start'],['kpi-text','kpi-bg-mid'],['kpi-muted','kpi-bg-start'],['kpi-muted','kpi-bg-mid'],
    ['kpi-success','kpi-bg-mid'],['kpi-warning','kpi-bg-mid'],['kpi-danger','kpi-bg-mid'],['kpi-info','kpi-bg-mid'],['kpi-violet','kpi-bg-mid']]) {
    const a=luminance(palette[ink]), b=luminance(palette[paper]);
    const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(ratio>=4.5,`${ink} / ${paper}: ${ratio.toFixed(2)}`);
  }
});
