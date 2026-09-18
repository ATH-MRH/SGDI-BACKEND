// CORRECTION UI — CLARIFIER LES COMPTEURS PAR POSTE (Espace Client → Mon personnel).
// Les cartes CARISTE/MAGASINIER/... comptent la population AFFECTÉE réellement
// chargée, jamais l'effectif CONTRACTUEL (qui appartient exclusivement à
// DC.IRONGS.COM). Ce fichier ne teste aucun changement de calcul : le calcul
// (regroupement par `position`, sur le pool employees/site déjà chargé) reste
// strictement identique à avant cette correction — seul l'habillage (titre,
// sous-titre, libellé singulier/pluriel) est nouveau.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClientPortail } = require('./load-client-portail');

// Cas de référence de la demande : 59 + 15 + 8 + 1 + 1 = 84.
function referenceEmployees() {
  const rows = [];
  let id = 1;
  const push = (position, count, siteId) => {
    for (let i = 0; i < count; i++) rows.push({ id: id++, position, site_id: siteId });
  };
  push('Cariste', 59, 10);
  push('Magasinier', 15, 10);
  push('Agent polyvalent', 8, 20);
  push('Coursier', 1, 10);
  push('Superviseur', 1, 20);
  return rows;
}

function cardsOf(w) {
  return Array.from(w.document.querySelectorAll('#portalPositionCounters .group-counter.headcount'));
}

test('titre et sous-titre : "Effectif affecté par poste" / "Répartition des employés actuellement affectés."', () => {
  const { window: w } = loadClientPortail();
  const title = w.document.querySelector('#employeesTab .site-employees-title');
  assert.ok(title, 'le titre doit exister au-dessus des cartes');
  assert.equal(title.textContent.trim(), 'Effectif affecté par poste');
  const subtitle = title.nextElementSibling;
  assert.equal(subtitle.tagName, 'P');
  assert.equal(subtitle.textContent.trim(), 'Répartition des employés actuellement affectés.');
  w.close();
});

test('TOUT (siteId=null) : le total des cartes correspond au cas de référence 59+15+8+1+1=84', () => {
  const { window: w, T } = loadClientPortail();
  T().setEmployees(referenceEmployees());
  T().renderPortalPositionCounters(null);
  const cards = cardsOf(w);
  assert.equal(cards.length, 5);
  const total = cards.reduce((sum, c) => sum + Number(c.querySelector('.gc-assigned').textContent), 0);
  assert.equal(total, 84);
  const cariste = cards.find(c => c.querySelector('.gc-code').textContent.trim() === 'Cariste');
  assert.equal(cariste.querySelector('.gc-assigned').textContent.trim(), '59');
  w.close();
});

test('pluriel : "59 employés affectés" (plusieurs), singulier : "1 employé affecté" (un seul)', () => {
  const { window: w, T } = loadClientPortail();
  T().setEmployees(referenceEmployees());
  T().renderPortalPositionCounters(null);
  const cards = cardsOf(w);
  const byLabel = (label) => cards.find(c => c.querySelector('.gc-code').textContent.trim() === label);
  assert.equal(byLabel('Cariste').querySelector('.gc-caption').textContent.trim(), '59 employés affectés');
  assert.equal(byLabel('Coursier').querySelector('.gc-caption').textContent.trim(), '1 employé affecté');
  assert.equal(byLabel('Superviseur').querySelector('.gc-caption').textContent.trim(), '1 employé affecté');
  w.close();
});

test('sélection d\'un site : les compteurs ne portent que sur ce site (comportement de filtre inchangé)', () => {
  const { window: w, T } = loadClientPortail();
  T().setEmployees(referenceEmployees()); // site 10 : 59 Cariste + 15 Magasinier + 1 Coursier = 75 ; site 20 : 8 + 1 = 9
  T().renderPortalPositionCounters(10);
  let cards = cardsOf(w);
  let total = cards.reduce((sum, c) => sum + Number(c.querySelector('.gc-assigned').textContent), 0);
  assert.equal(total, 75, 'le site 10 ne doit compter que ses propres employés');
  assert.ok(!cards.some(c => c.querySelector('.gc-code').textContent.trim() === 'Agent polyvalent'), 'Agent polyvalent (site 20) ne doit pas apparaître pour le site 10');

  T().renderPortalPositionCounters(20);
  cards = cardsOf(w);
  total = cards.reduce((sum, c) => sum + Number(c.querySelector('.gc-assigned').textContent), 0);
  assert.equal(total, 9, 'changer de filtre doit recalculer, pas cumuler avec le rendu précédent');
  w.close();
});

test('aucun employé : aucune carte, aucune erreur', () => {
  const { window: w, T } = loadClientPortail();
  T().setEmployees([]);
  T().renderPortalPositionCounters(null);
  assert.equal(cardsOf(w).length, 0);
  assert.equal(w.document.getElementById('portalPositionCounters').innerHTML, '');
  w.close();
});

test('les cartes ne présentent jamais ces compteurs comme contractuels/requis/quota (distinction AFFECTÉ vs CONTRACTUEL de DC.IRONGS.COM)', () => {
  const { window: w, T } = loadClientPortail();
  T().setEmployees(referenceEmployees());
  T().renderPortalPositionCounters(null);
  const host = w.document.getElementById('portalPositionCounters');
  const forbidden = /contractuel|besoin|requis|quota/i;
  assert.doesNotMatch(host.innerHTML, forbidden, 'les cartes AFFECTÉ ne doivent jamais employer un vocabulaire contractuel');
  w.close();
});
