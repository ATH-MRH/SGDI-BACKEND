const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
test('V7 test discovery preserves the common main command so #74 additions merge without conflict',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 // #74 prepends its own tests to test; V7 must be orthogonal in pretest.
 const command=pkg.scripts.test.replace('tests_frontend/beo-attendance-live.test.js ','');
 assert.equal(createHash('sha256').update(command).digest('hex'),'062624020caf82796858a623b534008b8e58f837b5f10d43e6f204785aeebced');
 for(const name of ['brq.test.js','pointeur-v7.test.js','pointeur-v7-chrome.test.js','pointeur-v7-integration.test.js'])
   assert.ok(pkg.scripts.pretest.includes('tests_frontend/'+name),name);
});
