// CORRECTION UX — EFFECTIFS : séparer statut et actions RH.
// Le badge Statut (employeeStatusPillHTML) ne doit plus jamais être cliquable ;
// les actions RH restent accessibles via le bouton dédié de la colonne Action
// (employeeRowActionsButton, à côté de "Ouvrir →"), qui ouvre le même menu
// openEmployeeStatusActions qu'auparavant — aucune fonctionnalité perdue.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function agent(overrides) {
  return Object.assign({
    id: 'a1', nom: 'BENALI', prenom: 'KARIM', matricule: 'MAT001', societe: 'IRON GLOBAL SECURITE',
    statut: 'actif', dateRecrutement: '2024-01-01',
  }, overrides || {});
}

test('le badge Statut ACTIF est un <span> non cliquable, sans onclick, avec le composant erp-status-badge', () => {
  const app = loadSgdiApp(['employeeStatusPillHTML']);
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  const html = app.T().employeeStatusPillHTML(agent());
  assert.doesNotMatch(html, /<button/i, 'le badge ne doit plus jamais être un <button>');
  assert.doesNotMatch(html, /onclick/i, 'aucun onclick ne doit être porté par le badge de statut');
  assert.match(html, /<span/i);
  assert.match(html, /erp-status-badge/);
  assert.match(html, /success/, 'ACTIF doit utiliser la variante success');
  assert.match(html, />ACTIF</);
  app.window.close();
});

test('tous les statuts existants restent affichés en badge non cliquable (suspendu, sortant, blacklist)', () => {
  const app = loadSgdiApp(['employeeStatusPillHTML']);
  const t = app.T();
  for (const [statut, expectLabel, expectVariant] of [
    ['suspendu', 'SUSPENDU', 'warning'],
    ['sortant', 'SORTANT', 'neutral'],
  ]) {
    const html = t.employeeStatusPillHTML(agent({ statut }));
    assert.doesNotMatch(html, /<button|onclick/i);
    assert.match(html, new RegExp('>' + expectLabel + '<'));
    assert.match(html, new RegExp(expectVariant));
  }
  const blacklistHtml = t.employeeStatusPillHTML(agent({ blacklist: true }));
  assert.doesNotMatch(blacklistHtml, /<button|onclick/i);
  assert.match(blacklistHtml, />BLACKLIST</);
  assert.match(blacklistHtml, /danger/);
  app.window.close();
});

test('le composant .erp-status-badge est non interactif au niveau CSS (curseur normal, aucune ombre de bouton)', () => {
  const app = loadSgdiApp([]);
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  const rule = css.match(/\.erp-status-badge\{[^}]*\}/);
  assert.ok(rule, 'règle .erp-status-badge introuvable');
  assert.match(rule[0], /cursor:default/);
  assert.match(rule[0], /box-shadow:none/);
  assert.match(rule[0], /pointer-events:none/);
  for (const variant of ['success', 'warning', 'danger', 'info', 'neutral']) {
    assert.ok(css.includes(`.erp-status-badge.${variant}{`), `variante ${variant} manquante`);
  }
  app.window.close();
});

test('le bouton actions RH de la ligne (colonne Action) ouvre le menu complet, avec le bon employé sélectionné', () => {
  const app = loadSgdiApp(['employeeRowActionsButton']);
  app.T().setSession({ username: 'drh', transverse: 'drh' });
  const html = app.T().employeeRowActionsButton(agent({ id: 'emp-42' }));
  assert.match(html, /<button/);
  assert.match(html, /openEmployeeStatusActions\(event,'emp-42','[^']*'\)/, "l'action doit cibler l'ID réel de l'employé de LA ligne, jamais une sélection différente");
  app.window.close();
});

test('deux lignes différentes produisent deux boutons ciblant chacun leur propre employé (aucune sélection croisée)', () => {
  const app = loadSgdiApp(['employeeRowActionsButton']);
  const t = app.T();
  t.setSession({ username: 'drh', transverse: 'drh' });
  const htmlA = t.employeeRowActionsButton(agent({ id: 'emp-A' }));
  const htmlB = t.employeeRowActionsButton(agent({ id: 'emp-B' }));
  assert.match(htmlA, /'emp-A'/);
  assert.doesNotMatch(htmlA, /'emp-B'/);
  assert.match(htmlB, /'emp-B'/);
  assert.doesNotMatch(htmlB, /'emp-A'/);
  app.window.close();
});

test('le menu ouvert par le bouton actions contient toutes les ACTIONS À FAIRE attendues (aucune perdue, aucune dupliquée dans le badge)', () => {
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  t.setSession && t.setSession({ username: 'drh', role: 'drh' });
  const fakeAgent = agent({ id: 'emp-99' });
  w.findEmployeeByRef = () => fakeAgent;
  w.rhEffectifActionStyle = () => '';
  w.canUserReactiverSortant = () => false;
  const btn = w.document.createElement('button');
  w.document.body.appendChild(btn);
  const event = { preventDefault() {}, stopPropagation() {}, currentTarget: btn };
  t.openEmployeeStatusActions(event, 'emp-99', '');
  const menu = w.document.getElementById('employee-row-actions-menu');
  assert.ok(menu, 'le menu doit être créé');
  const text = menu.textContent;
  for (const label of ['CONGÉ', 'SUSPENDRE', 'CONVOQUER', 'BLACKLISTER', 'MISE EN DEMEURE', 'SANCTIONNER']) {
    assert.match(text, new RegExp(label), `action manquante dans le menu : ${label}`);
  }
  // AVENANT / NOUVEAU CONTRAT sont désormais regroupées sous "CONTRAT ▾" (Dossier
  // employé 360°, REFONTE ACTIONS RH) : même fonctionnalité, présentation groupée.
  assert.match(text, /CONTRAT ▾/, 'le regroupement contractuel doit être présent');
  assert.match(menu.innerHTML, /runRhEffectifAction\('avenant'/, 'l\'action avenant doit rester joignable depuis le sous-menu');
  assert.match(menu.innerHTML, /runRhEffectifAction\('nouveau_contrat'/, 'l\'action nouveau contrat doit rester joignable depuis le sous-menu');
  w.close();
});

test('écran Contrats : le badge reste non cliquable ET le bouton actions dédié (contexte "contracts") reste disponible', () => {
  const app = loadSgdiApp(['employeeStatusPillHTML', 'contractRowActionsButton']);
  const t = app.T();
  app.window.history.replaceState(null, '', '#/contrats/dashboard');
  const statusHtml = t.employeeStatusPillHTML(agent());
  assert.doesNotMatch(statusHtml, /<button|onclick/i, 'le badge Contrats ne doit plus déclencher les actions comme avant');
  const actionsHtml = t.contractRowActionsButton(agent({ id: 'emp-c1' }));
  assert.match(actionsHtml, /openEmployeeStatusActions\(event,'emp-c1','contracts'\)/, "l'action contrat doit rester accessible (déplacée, pas supprimée)");
  app.window.close();
});
