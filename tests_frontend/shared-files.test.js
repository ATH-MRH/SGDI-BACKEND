const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

test('documents partagés : disponibles sans module, aperçu et impression conservés', async () => {
  const r = loadSgdiApp(['compressImage', 'viewDocA4', 'printArchiveA4Current', 'docUploadField'], { withoutModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  r.T().setFullDataReady(true);
  assert.equal(w.SGDIModules, undefined);
  assert.match(r.T().docUploadField('CV', 'CV', '', ''), /handleDocUpload/);
  w.Image = class { set src(_) { this.onerror(); } };
  assert.equal(await r.T().compressImage('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent('<html><body>Document test</body></html>');
  r.T().viewDocA4(url, 'Archive test');
  assert.match(w.document.getElementById('modal-host').textContent, /Archive test/);
  assert.ok(w.document.querySelector('[onclick="printArchiveA4Current()"]'));
  let written = '', prints = 0;
  w.open = () => ({ document: { open() {}, write(s) { written += s; }, close() {} }, focus() {}, print() { prints++; } });
  r.T().printArchiveA4Current();
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.match(written, /Document test/); assert.equal(prints, 1);
  r.dom.window.close();
});

test('bootstrap : fichiers partagés avant le monolithe, versions cohérentes', () => {
  const root = path.join(__dirname, '../app/static');
  for (const entry of ['index.html', 'facturation.html', 'paie.html', 'conges.html']) {
  const html = fs.readFileSync(path.join(root, entry), 'utf8');
  const asset = name => html.match(new RegExp('src="/static/' + name.replaceAll('.', '\\.') + '\\?v=([^" ]+)"'));
  const core = asset('js/core/files.js'), app = asset('sgdi-app.js'), registry = asset('js/core/module-registry.js');
  assert.ok(core && app && registry);
  assert.ok(core.index < app.index); assert.equal(core[1], app[1]); assert.equal(registry[1], app[1]);
  assert.doesNotMatch(html, /src="[^" ]*js\/modules\//);
  }
});
