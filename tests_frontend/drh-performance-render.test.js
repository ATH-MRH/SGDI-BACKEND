const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const { dom, window, loadError, T } = loadSgdiApp([
  'SGDI_LANG_PAIRS', 'sgdiTranslateText', 'applyLanguagePreference', 'normalizeCentralPage',
]);
assert.equal(loadError, null, loadError && loadError.stack);
test.after(() => dom.window.close());

function fragment(html) {
  const root = window.document.createElement('section');
  root.innerHTML = html;
  return root;
}

function mode(value) {
  window.localStorage.setItem('sgdiLangMode', value);
}

test('la traduction autonome conserve FR, AR, texte bilingue et espaces', () => {
  const translate = T().sgdiTranslateText;
  mode('ar');
  assert.equal(translate(' Enregistrer / حفظ '), ' حفظ ');
  assert.equal(translate('Économiser'), 'حفظ');
  assert.equal(translate('Annuler'), 'إلغاء');
  assert.equal(translate('572 — AGENT-123'), '572 — AGENT-123');
  assert.equal(translate(' \n '), ' \n ');
  mode('fr');
  assert.equal(translate('حفظ'), 'Enregistrer');
  assert.equal(translate('إلغاء'), 'Annuler');
  assert.equal(translate('Économiser'), 'Enregistrer');
  assert.equal(translate(' Enregistrer / حفظ '), ' Enregistrer ');
});

test('le parcours traduit les libellés et attributs en conservant les exclusions et valeurs saisies', () => {
  const root = fragment(`<p id="label">Enregistrer</p>
    <div data-no-lang><span id="excluded">Enregistrer</span></div>
    <script type="text/plain">Enregistrer</script><style>/* Enregistrer */</style>
    <input placeholder="Enregistrer" value="Enregistrer">
    <textarea placeholder="Enregistrer">Enregistrer</textarea>
    <button title="Annuler">Annuler</button><select title="Annuler"><option>Annuler</option></select>
    <div data-no-lang><input id="excluded-attribute" placeholder="Enregistrer"></div>
    <a title="Annuler">Enregistrer</a>
    <div data-no-lang class="sgdi-lang-choice"><button>FR</button><button>AR</button></div>`);
  mode('ar');
  T().applyLanguagePreference(root);
  assert.equal(root.querySelector('#label').textContent, 'حفظ');
  assert.equal(root.querySelector('#excluded').textContent, 'Enregistrer');
  assert.equal(root.querySelector('script').textContent, 'Enregistrer');
  assert.equal(root.querySelector('style').textContent, '/* Enregistrer */');
  assert.equal(root.querySelector('textarea').value, 'Enregistrer');
  assert.equal(root.querySelector('input').value, 'Enregistrer');
  assert.equal(root.querySelector('input').placeholder, 'حفظ');
  assert.equal(root.querySelector('textarea').placeholder, 'حفظ');
  assert.equal(root.querySelector('button[title]').title, 'إلغاء');
  assert.equal(root.querySelector('select').title, 'إلغاء');
  assert.equal(root.querySelector('option').textContent, 'إلغاء');
  // Le parcours historique des attributs ne consulte pas data-no-lang.
  assert.equal(root.querySelector('#excluded-attribute').placeholder, 'حفظ');
  assert.equal(root.querySelector('a').title, 'Annuler');
  assert.equal(window.document.documentElement.lang, 'ar');
  assert.equal(window.document.documentElement.dir, 'rtl');
  assert.equal(root.querySelector('.sgdi-lang-choice .btn-primary').textContent, 'AR');
});

test('un nouveau parcours respecte le changement de langue et les libellés ajoutés', () => {
  const root = fragment('<p>Enregistrer</p><input placeholder="Annuler">');
  mode('ar');
  T().applyLanguagePreference(root);
  assert.equal(root.querySelector('p').textContent, 'حفظ');
  mode('fr');
  root.appendChild(fragment('<span>حفظ</span>'));
  T().applyLanguagePreference(root);
  assert.equal(root.querySelector('p').textContent, 'Enregistrer');
  assert.equal(root.querySelector('span').textContent, 'Enregistrer');
  assert.equal(root.querySelector('input').placeholder, 'Annuler');
  assert.equal(window.document.documentElement.lang, 'fr');
  assert.equal(window.document.documentElement.dir, 'ltr');
  mode('ar');
  T().applyLanguagePreference(root);
  assert.equal(root.querySelector('p').textContent, 'حفظ');
  assert.equal(root.querySelector('span').textContent, 'حفظ');
});

test('le dictionnaire est relu entre deux parcours, sans traduction périmée', () => {
  const pairs = T().SGDI_LANG_PAIRS;
  const root = fragment('<p>Libellé inédit ZYX</p>');
  mode('ar');
  T().applyLanguagePreference(root);
  assert.equal(root.textContent, 'Libellé inédit ZYX');
  pairs.push(['Libellé inédit ZYX', 'تجريبي زyx']);
  try {
    T().applyLanguagePreference(root);
    assert.equal(root.textContent, 'تجريبي زyx');
    mode('fr');
    T().applyLanguagePreference(root);
    assert.equal(root.textContent, 'Libellé inédit ZYX');
  } finally {
    pairs.pop();
  }
});

test('572 libellés identiques partagent le travail de traduction avec leurs attributs', () => {
  mode('ar');
  const single = fragment('<button title="Enregistrer">Enregistrer</button>');
  const table = fragment('<table><tbody>' + Array.from({ length: 572 }, () =>
    '<tr><td><button title="Enregistrer">Enregistrer</button></td></tr>').join('') + '</tbody></table>');
  const originalSplit = window.String.prototype.split;
  let splitCalls = 0;
  window.String.prototype.split = function (...args) {
    splitCalls++;
    return originalSplit.apply(this, args);
  };
  try {
    T().applyLanguagePreference(single);
    const singleWork = splitCalls;
    splitCalls = 0;
    T().applyLanguagePreference(table);
    assert.ok(singleWork > 0, 'le contrôle doit réellement exécuter une traduction');
    assert.equal(splitCalls, singleWork, 'les répétitions ne doivent pas refaire les substitutions du dictionnaire');
  } finally {
    window.String.prototype.split = originalSplit;
  }
  assert.equal(table.querySelectorAll('tr').length, 572);
  for (const button of table.querySelectorAll('button')) {
    assert.equal(button.textContent, 'حفظ');
    assert.equal(button.title, 'حفظ');
  }
});

test('normaliser un bouton déjà propre conserve ses enfants et leurs événements', () => {
  const root = fragment('<button class="btn"><span>Ouvrir</span></button>');
  const button = root.querySelector('button');
  const child = button.firstElementChild;
  let clicked = 0;
  child.addEventListener('click', () => clicked++);
  T().normalizeCentralPage(root);
  T().normalizeCentralPage(root);
  assert.equal(button.innerHTML, '<span>Ouvrir</span>');
  assert.equal(button.firstElementChild, child);
  child.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(clicked, 1);
});

test('normaliser nettoie toujours les emojis et espaces des boutons et garde les actions', () => {
  const root = fragment('<button class="btn" data-preserve-emoji onclick="ouvrirFiche()">  👋  <span>Ouvrir</span>  </button>');
  const button = root.querySelector('button');
  let clicked = 0;
  button.addEventListener('click', () => clicked++);
  T().normalizeCentralPage(root);
  assert.equal(button.innerHTML, '<span>Ouvrir</span>');
  assert.equal(button.getAttribute('onclick'), 'ouvrirFiche()');
  button.click();
  assert.equal(clicked, 1);
});
