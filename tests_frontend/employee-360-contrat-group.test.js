// DOSSIER EMPLOYÉ 360° — REPRISE : regroupement des 3 actions contractuelles
// (NOUVEAU CONTRAT / AVENANT / FIN DE CONTRAT) sous une seule entrée "CONTRAT ▾"
// dans le menu flottant existant (openEmployeeStatusActions). Aucune action
// n'est supprimée ni dupliquée : les mêmes clés et le même handler
// (runRhEffectifAction) restent utilisés, seule la présentation change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function fakeMenuEvent(w) {
  const btn = w.document.createElement('button');
  w.document.body.appendChild(btn);
  btn.getBoundingClientRect = () => ({ top: 10, bottom: 20, left: 10, right: 20, width: 10, height: 10 });
  return { preventDefault() {}, stopPropagation() {}, currentTarget: btn };
}

test('menu Actions RH : les 3 actions contractuelles sont regroupées sous "CONTRAT ▾", repliées par défaut', async () => {
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  t.setDb({ agents: [{ id: 'e1', statut: 'actif' }] });
  t.setSession({ transverse: 'drh' });
  t.openEmployeeStatusActions(fakeMenuEvent(w), 'e1', '');
  const menu = w.document.getElementById('employee-row-actions-menu');
  assert.ok(menu, 'le menu doit être ouvert');
  const text = menu.textContent;
  assert.match(text, /CONTRAT ▾/);
  // Les 3 anciens intitulés indépendants ne doivent plus apparaître comme
  // boutons de premier niveau du menu (mais restent dans le sous-menu replié).
  const topLevelButtons = Array.from(menu.querySelectorAll(':scope > button')).map(b => b.textContent.trim());
  assert.ok(!topLevelButtons.includes('AVENANT'), 'AVENANT ne doit plus être un bouton de premier niveau');
  assert.ok(!topLevelButtons.includes('NOUVEAU CONTRAT'), 'NOUVEAU CONTRAT ne doit plus être un bouton de premier niveau');
  assert.ok(!topLevelButtons.includes('FIN DE RELATION DE TRAVAIL'), 'FIN DE RELATION DE TRAVAIL ne doit plus être un bouton de premier niveau');
  // Le sous-menu existe mais est replié par défaut (pas de classe is-open).
  const group = menu.querySelector('.rh-contrat-group');
  assert.ok(group, 'le groupe CONTRAT doit exister');
  assert.equal(group.classList.contains('is-open'), false, 'replié par défaut');
  w.close();
});

test('menu Actions RH : le bouton "CONTRAT ▾" déplie son propre sous-menu (mêmes 3 actions, handlers intacts)', async () => {
  // jsdom ('outside-only') n'exécute pas les attributs onclick inline : on
  // vérifie donc le comportement de bascule au niveau du code source du
  // handler (le même mécanisme que <details>/toggle déjà utilisé ailleurs
  // dans ce fichier, cf. .rh-change-history), puis on simule son effet pour
  // valider le contenu du sous-menu une fois déplié.
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  t.setDb({ agents: [{ id: 'e1', statut: 'actif' }] });
  t.setSession({ transverse: 'drh' });
  t.openEmployeeStatusActions(fakeMenuEvent(w), 'e1', '');
  const menu = w.document.getElementById('employee-row-actions-menu');
  const toggle = menu.querySelector('.rh-contrat-group > button');
  assert.match(toggle.getAttribute('onclick'), /this\.closest\('\.rh-contrat-group'\)\.classList\.toggle\('is-open'\)/, 'le clic sur "CONTRAT ▾" doit basculer la classe is-open de son groupe, sans naviguer ni fermer le menu parent');
  const group = menu.querySelector('.rh-contrat-group');
  group.classList.add('is-open'); // simule l'effet du clic (onclick inline non exécuté en mode outside-only)
  const subButtons = Array.from(menu.querySelectorAll('.rh-contrat-submenu button'));
  const subLabels = subButtons.map(b => b.textContent.trim());
  assert.deepEqual(subLabels, ['+ Nouveau contrat', 'Avenant', 'Fin de contrat']);
  // Les handlers réels (mêmes clés, même fonction) sont préservés.
  assert.match(subButtons[0].getAttribute('onclick'), /runRhEffectifAction\('nouveau_contrat','e1'\)/);
  assert.match(subButtons[1].getAttribute('onclick'), /runRhEffectifAction\('avenant','e1'\)/);
  assert.match(subButtons[2].getAttribute('onclick'), /runRhEffectifAction\('fin_contrat','e1'\)/);
  w.close();
});

test('menu Actions RH : toutes les autres actions individuelles restent présentes, sans doublon', async () => {
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  t.setDb({ agents: [{ id: 'e1', statut: 'actif' }] });
  t.setSession({ transverse: 'drh' });
  t.openEmployeeStatusActions(fakeMenuEvent(w), 'e1', '');
  const menu = w.document.getElementById('employee-row-actions-menu');
  const allButtonTexts = Array.from(menu.querySelectorAll('button')).map(b => b.textContent.trim());
  for (const expected of ['DETAIL', 'CONGÉ', "REC/PERIODE D'ESSAI", 'SUSPENDRE', 'CONVOQUER', 'MISE EN DEMEURE', 'SANCTIONNER', 'BLACKLISTER', 'REINTEGRER']) {
    assert.equal(allButtonTexts.filter(x => x === expected).length, 1, `"${expected}" doit apparaître exactement une fois (trouvé ${allButtonTexts.filter(x => x === expected).length})`);
  }
  w.close();
});

test('contexte contrats (actionContext=contracts) : menu réduit inchangé, pas de regroupement appliqué', async () => {
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  t.setDb({ agents: [{ id: 'e1', statut: 'actif' }] });
  t.openEmployeeStatusActions(fakeMenuEvent(w), 'e1', 'contracts');
  const menu = w.document.getElementById('employee-row-actions-menu');
  const text = menu.textContent;
  assert.match(text, /NOUVEAU CONTRAT/);
  assert.match(text, /NOUVEAU AVENANT/);
  assert.doesNotMatch(text, /CONTRAT ▾/, 'le contexte contrats garde son propre menu, sans regroupement supplémentaire');
  w.close();
});

test('employé blacklisté : pas de groupe CONTRAT (cohérent avec le blocage contractuel existant)', async () => {
  const app = loadSgdiApp(['openEmployeeStatusActions']);
  const w = app.window, t = app.T();
  t.setDb({ agents: [{ id: 'e1', statut: 'actif', blacklist: true }] });
  t.setSession({ transverse: 'drh' });
  t.openEmployeeStatusActions(fakeMenuEvent(w), 'e1', '');
  const menu = w.document.getElementById('employee-row-actions-menu');
  assert.equal(menu.querySelector('.rh-contrat-group'), null);
  assert.doesNotMatch(menu.textContent, /CONTRAT ▾/);
  w.close();
});
