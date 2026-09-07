const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');

test('le client expose uniquement les API administratives du lot 0.5-B', () => {
  assert.match(src, /granularPermissionCatalog:\(\)=>sgdiApi\("\/auth\/granular-permissions\/catalog"/);
  assert.match(src, /userModulePermissions:\(userId\)=>sgdiApi\("\/auth\/users\/"\+encodeURIComponent\(userId\)\+"\/module-permissions"/);
  assert.match(src, /replaceUserModulePermissions:\(userId,permissions\)=>sgdiApi/);
});

test('la matrice est explicitement préparée et non active', () => {
  assert.match(src, /Permissions préparées — non actives/);
  assert.match(src, /Les autorisations legacy restent applicables/);
  assert.match(src, /data-granular-permission/);
  assert.match(src, /Remplacer les permissions granulaires préparées/);
});

test('les douze actions sont présentées et envoyées comme couples explicites', () => {
  for (const action of ['read','create','update','validate','delete','export','unlock','admin','sign','pay','recruit','execute']) {
    assert.ok(src.includes(`${action}:`), `libellé absent pour ${action}`);
  }
  assert.match(src, /module_key:input\.dataset\.module,action_key:input\.dataset\.action/);
});

test('la gestion granulaire reste séparée de la sauvegarde legacy', () => {
  assert.match(src, /openGranularPermissionsByKey/);
  assert.match(src, /saveGranularPermissions/);
  assert.doesNotMatch(src, /authorized_modules:data\.permissions/);
  assert.doesNotMatch(src, /authorized_actions:data\.permissions/);
});
