// CORRECTION GLOBALE — SUPPRIMER LES FAUX BLOCAGES "MODIFICATIONS NON ENREGISTRÉES".
//
// Cause exacte du faux dirty (voir sgdiNoteFormInput, app/static/sgdi-app.js) :
// tout <input>/<select>/<textarea> à l'intérieur de #view qui n'a ni [data-nav-filter]
// ni de <form> englobant faisait retomber le marquage "modifié" sur #view TOUT ENTIER
// (dirtyHost = t.closest("form") || document.getElementById("view")). Ce verrou ne
// s'efface qu'à l'enregistrement/annulation explicite d'un <form> — jamais par un
// simple changement d'écran — donc il restait collé même après avoir quitté l'écran
// où il avait été posé par erreur. Exactement le scénario rapporté : Tableau de bord
// RH -> clic sur la carte "Alertes contrat" (un <a href="#/contrats/situation">
// nu, sans navigate() -> passe par le hashchange non contrôlé, sgdiGuardUncontrolledUrlChange()).
//
// Le test « Fiche de position : changer un filtre... » (tests_frontend/drh.test.js)
// couvrait déjà #fp-site/#fp-sort spécifiquement (déjà exclus avant cette correction).
// Ici on reproduit le cas RÉELLEMENT rapporté (Tableau de bord RH) et on prouve que
// la correction (n'accepter le marquage "modifié" qu'à l'intérieur d'un vrai <form>)
// règle la classe de bug en général, pas seulement l'écran déjà patché.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['renderDRHDashboard', 'sgdiHasUnsavedUserWork', 'sgdiGuardUncontrolledUrlChange', 'renderAgentForm', 'bindAgentFormDirtyState'];

function bootDashboard(w, t) {
  t.setSession({ societe: 'IRON GLOBAL SOLUTION', username: 'TEST', transverse: 'drh' });
  t.setDb({ agents: [], sites: [], conges: [], incidents: [], demandesPersonnel: [], users: [], contrats: [], societes: [] });
  const view = w.document.getElementById('view');
  return view;
}

test('Tableau de bord RH : aucune saisie -> aucun blocage détecté', () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  const view = bootDashboard(w, t);
  t.renderDRHDashboard(view);
  assert.equal(t.sgdiHasUnsavedUserWork(), false, 'ouvrir le dashboard ne doit jamais, à lui seul, marquer un travail non enregistré');
  w.close();
});

test('Tableau de bord RH -> clic "Alertes contrat" (lien <a> nu, hashchange non contrôlé) : navigation jamais bloquée sans saisie réelle', () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  const view = bootDashboard(w, t);
  t.renderDRHDashboard(view);
  const link = view.querySelector('a[href="#/contrats/situation"]');
  assert.ok(link, 'la carte "Alertes contrat" doit être un lien direct vers #/contrats/situation');
  // C'est exactement le trajet emprunté par un clic sur ce lien : la modification de
  // location.hash déclenche hashchange -> sgdiGuardUncontrolledUrlChange(), qui est ce
  // que le test vérifie ici sans dépendre du comportement de navigation de jsdom.
  const blocked = t.sgdiGuardUncontrolledUrlChange();
  assert.equal(blocked, false, 'aucune saisie n\'a eu lieu : le clic ne doit jamais être intercepté ni annulé');
  w.close();
});

test('Un filtre/recherche quelconque (hors <form>, non explicitement listé) sur un ÉCRAN PRÉCÉDENT ne doit plus laisser un verrou collé sur le Tableau de bord RH ensuite', () => {
  // Reproduit la classe de bug en général plutôt qu'un seul écran déjà corrigé au coup
  // par coup : n'importe quel <select> de filtre vivant hors <form> et hors
  // [data-nav-filter], sur N'IMPORTE QUEL écran, ne doit jamais pouvoir laisser
  // sgdiFormHasUnsavedChanges collé à true pour le reste de la session.
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  const view = bootDashboard(w, t);
  // Écran fictif type "liste + filtre", volontairement SANS [data-nav-filter] et SANS
  // <form> — représente n'importe quel écran non (encore) audité individuellement.
  view.innerHTML = '<div><select id="some-untagged-filter"><option value="a">A</option><option value="b">B</option></select></div>';
  const sel = view.querySelector('#some-untagged-filter');
  sel.value = 'b';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(t.sgdiHasUnsavedUserWork(), false, 'un filtre hors <form> ne doit jamais marquer un travail non enregistré, même sans étiquette data-nav-filter dédiée');

  // On change ensuite d'écran (comme le ferait un vrai render()) vers le Tableau de bord RH.
  t.renderDRHDashboard(view);
  assert.equal(t.sgdiHasUnsavedUserWork(), false, 'le dashboard qui suit ne doit hériter d\'aucun verrou laissé par l\'écran précédent');
  const blocked = t.sgdiGuardUncontrolledUrlChange();
  assert.equal(blocked, false, 'la navigation depuis le dashboard doit rester possible');
  w.close();
});

test('Une vraie saisie dans un <form> (ex. fiche employé) doit toujours bloquer la navigation non contrôlée', () => {
  // La protection réelle contre la perte de données ne doit pas être affaiblie par cette
  // correction : un champ effectivement modifié dans un <form> doit toujours déclencher
  // le blocage.
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  t.setDb({
    agents: [{ id: 'e1', nom: 'Test', prenom: 'Agent', matricule: 'M1', societe: 'IRON', statut: 'actif' }],
    conges: [], pointages: [], feuillePresence: [], contratsPersonnel: [], avenants: [], contrats: [], stockMouvements: [], users: [], sites: [],
  });
  t.setSession({ transverse: 'drh', username: 'testdrh' });
  const view = w.document.getElementById('view');
  t.renderAgentForm(view, 'e1');
  const nomField = view.querySelector('#agent-form input[name="nom"]');
  assert.ok(nomField, 'le champ Nom du formulaire employé doit exister');
  assert.equal(t.sgdiHasUnsavedUserWork(), false, 'ouvrir la fiche sans rien modifier ne doit rien bloquer');
  nomField.value = 'Test modifié';
  nomField.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(t.sgdiHasUnsavedUserWork(), true, 'une vraie modification dans le formulaire employé doit être détectée');
  const blocked = t.sgdiGuardUncontrolledUrlChange();
  assert.equal(blocked, true, 'et doit bloquer une navigation non contrôlée, exactement comme avant cette correction');
  w.close();
});
