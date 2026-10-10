// Audit pointeur.irongs.com — P0 : échappement des données serveur dans la page du poste.
// esc() passait par textContent → innerHTML, qui laisse les guillemets intacts : une valeur
// (nom, photo, libellé) placée dans un attribut pouvait en sortir. Les tests exercent les
// fonctions réelles de la page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');

const QUOTED = 'Karim" data-injected="1';

test('esc neutralise les guillemets et les chevrons', () => {
  const { window: w } = loadPointeur();
  assert.equal(w.esc(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
  assert.equal(w.esc(null), '');
  assert.equal(w.esc(0), '0');
  w.close();
});

test('une photo n’est affichée que depuis une source ATLAS, un blob ou une image en ligne', () => {
  const { window: w } = loadPointeur();
  for (const ok of ['/uploads/photos/K162-a.jpg', '/api/portal/attendance-employee/4/portrait', 'blob:https://pointeur.irongs.com/1-2',
    'data:image/jpeg;base64,AAAA', 'data:image/png;base64,AAAA', 'data:image/svg+xml,%3Csvg%3E']) assert.equal(w.safePhotoSrc(ok), ok, ok);
  for (const bad of ['javascript:alert(1)', 'https://exemple.test/a.jpg', '//exemple.test/a.jpg', 'data:text/html;base64,AAAA',
    'uploads/a.jpg', 'vbscript:x', '', null, undefined]) {
    assert.equal(w.safePhotoSrc(bad), '', String(bad));
  }
  w.close();
});

test('fiche de résultat : un nom ou une photo contenant un guillemet ne crée aucun attribut', () => {
  const { window: w } = loadPointeur();
  const hostile = '/uploads/photos/a.jpg" onerror="x';
  w.showResult({ action: 'arrivee', name: QUOTED, matricule: 'M"1', site: 'S"1', photo: hostile }, 'success');
  const el = w.document.getElementById('result');
  assert.equal(el.querySelector('[data-injected]'), null);
  assert.equal(el.querySelector('[onerror]'), null);
  assert.equal(el.querySelector('img').getAttribute('src'), hostile, 'la valeur reste dans l’attribut src');
  assert.equal(el.querySelector('img').attributes.length, 3);
  assert.equal(el.querySelector('.result-name').textContent, QUOTED);
  w.showResult({ action: 'arrivee', name: 'A', matricule: 'M2', photo: 'javascript:alert(1)' }, 'success');
  assert.equal(el.querySelector('img'), null, 'schéma hors liste blanche : initiales affichées');
  w.showResult({ action: 'arrivee', name: QUOTED, matricule: 'M1', photo: '/uploads/photos/K162-a.jpg' }, 'success');
  const img = el.querySelector('img.employee-photo');
  assert.equal(img.getAttribute('src'), '/uploads/photos/K162-a.jpg');
  assert.equal(img.getAttribute('alt'), 'Photo de ' + QUOTED);
  assert.equal(img.attributes.length, 3, 'class, src, alt uniquement');
  w.close();
});

test('la page ne contient plus l’ancien échappement par innerHTML', () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'pointeur.html'), 'utf8');
  assert.doesNotMatch(html, /function esc\(value\)\{const d=document\.createElement/);
  // Toute image construite dynamiquement passe par la liste blanche.
  const dynamic = html.match(/src="(?:'\+|\$\{)[^"]*/g) || [];
  assert.ok(dynamic.length >= 4);
  for (const fragment of dynamic) assert.match(fragment, /safePhotoSrc\(/, fragment);
});
