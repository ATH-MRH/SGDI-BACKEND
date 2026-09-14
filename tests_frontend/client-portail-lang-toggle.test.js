// CORRECTION UI — sélecteur de langue FR/EN (client-portail.html). L'état visuel
// doit être dérivé de la langue réellement active (portalLangMode()/localStorage),
// jamais d'un style statique attaché au bouton EN — voir applyPortalLanguage().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'app', 'static', 'client-portail.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function bootPortal(initialLang) {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'balise <script> introuvable dans client-portail.html');
  const suffix = `
;window.enterApp = async () => {};
;window.loadBranding = async () => {};
`;
  // Fonction de remplacement (pas une chaîne littérale) : le contenu du script
  // original peut contenir des séquences "$&"/"$1" (ex. callbacks de replace())
  // que String.replace() interpréterait sinon comme des motifs spéciaux.
  const patched = html.replace(scriptMatch[0], () => `<script>${scriptMatch[1]}${suffix}</script>`);
  const dom = new JSDOM(patched, { url: 'http://localhost/client-portail.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (initialLang) {
    try { w.localStorage.setItem('portalLangMode', initialLang); } catch (e) {}
  }
  w.applyPortalLanguage(w.document.body);
  return { dom, window: w };
}

function mainToggleButtons(w) {
  const scope = w.document.querySelector('.lang-toggle');
  return { fr: scope.querySelector('[data-lang="fr"]'), en: scope.querySelector('[data-lang="en"]') };
}

function assertActive(fr, en, activeLang) {
  const [activeBtn, inactiveBtn] = activeLang === 'fr' ? [fr, en] : [en, fr];
  assert.equal(activeBtn.getAttribute('aria-pressed'), 'true', `${activeBtn.dataset.lang} devrait être aria-pressed=true`);
  assert.equal(activeBtn.classList.contains('active'), true);
  assert.equal(inactiveBtn.getAttribute('aria-pressed'), 'false', `${inactiveBtn.dataset.lang} devrait être aria-pressed=false`);
  assert.equal(inactiveBtn.classList.contains('active'), false);
}

test('1. démarrage FR : FR visuellement actif (aria-pressed, classe active), EN inactif', () => {
  const { window: w } = bootPortal(null); // pas de préférence stockée -> défaut FR
  const { fr, en } = mainToggleButtons(w);
  assertActive(fr, en, 'fr');
  assert.equal(w.document.documentElement.lang, 'fr');
  w.close();
});

test('2. clic EN : EN devient actif, FR devient inactif', () => {
  const { window: w } = bootPortal('fr');
  w.portalSetLangMode('en');
  const { fr, en } = mainToggleButtons(w);
  assertActive(fr, en, 'en');
  assert.equal(w.localStorage.getItem('portalLangMode'), 'en');
  assert.equal(w.document.documentElement.lang, 'en');
  w.close();
});

test('3. clic FR après EN : FR redevient actif, EN redevient inactif', () => {
  const { window: w } = bootPortal('en');
  w.portalSetLangMode('en'); // état de départ explicite
  w.portalSetLangMode('fr');
  const { fr, en } = mainToggleButtons(w);
  assertActive(fr, en, 'fr');
  assert.equal(w.document.documentElement.lang, 'fr');
  w.close();
});

test('4. reload en FR : FR reste actif après un nouveau chargement de page', () => {
  const { window: w } = bootPortal('fr'); // simule localStorage déjà positionné à "fr" avant chargement
  const { fr, en } = mainToggleButtons(w);
  assertActive(fr, en, 'fr');
  w.close();
});

test('5. reload en EN : EN reste actif après un nouveau chargement de page', () => {
  const { window: w } = bootPortal('en'); // simule localStorage déjà positionné à "en" avant chargement
  const { fr, en } = mainToggleButtons(w);
  assertActive(fr, en, 'en');
  assert.equal(w.document.documentElement.lang, 'en');
  w.close();
});

test('6. aucune différence entre état réel (portalLangMode) et état visuel, y compris sur le toggle de connexion', () => {
  const { window: w } = bootPortal('en');
  // Le sélecteur de la page de connexion (.login-lang-toggle) doit refléter le
  // même état réel que celui de l'application (même mécanisme, même source de vérité).
  const loginToggles = [...w.document.querySelectorAll('.login-lang-toggle')];
  assert.ok(loginToggles.length >= 1);
  for (const toggle of loginToggles) {
    const fr = toggle.querySelector('[data-lang="fr"]');
    const en = toggle.querySelector('[data-lang="en"]');
    assertActive(fr, en, 'en');
  }
  assert.equal(w.portalLangMode(), 'en');
  w.close();
});

test('le bouton inactif n\'a jamais de fond ni de bordure donnant l\'impression d\'une sélection (fond transparent)', () => {
  const { window: w } = bootPortal('fr');
  const rule = html.match(/\.lang-toggle button\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /background:transparent/, "l'état inactif de base ne doit porter aucun fond opaque");
  assert.doesNotMatch(rule[0], /background:#ffcc00/, "l'ancien style actif jaune-sur-jaune (invisible sur le bandeau iron-portal) ne doit plus exister sur le style de base");
  w.close();
});

test('sur le bandeau jaune (iron-portal), le bouton actif reste visible : jamais un fond jaune sur fond jaune', () => {
  const activeOnYellow = html.match(/body\.iron-portal \.lang-toggle button\.active[^{]*\{[^}]*\}/);
  assert.ok(activeOnYellow, 'variante iron-portal du bouton actif introuvable');
  assert.doesNotMatch(activeOnYellow[0], /background:#ffcc00/, "un fond jaune sur le bandeau jaune camoufle le bouton actif — c'est exactement le bug signalé");
});
