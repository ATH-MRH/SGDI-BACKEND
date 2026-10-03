// OPS → Éléments sortants : refonte UI. Vraies fonctions de sgdi-app.js dans jsdom,
// données de test synthétiques (aucun nom, poste ou compteur de la maquette).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const ACTIVE = 'IRON GLOBAL SOLUTION';
const OTHER = 'IRON GLOBAL SÉCURITÉ';
const NAMES = ['renderElementsSortants', 'renderOpsOutgoingEmployees', 'opsOutgoingSetFilter', 'opsOutgoingSetSort', 'opsOutgoingSetPage',
  'opsOutgoingStatus', 'opsOutgoingExitDate', 'opsOutgoingScope', 'opsOutgoingAvatarTone', 'normalizePageHeader', 'emptyDB', 'today'];

function employee(id, overrides = {}) {
  return { id: `emp-${id}`, nom: `TESTEUR ${id}`, prenom: `Prenom${id}`, matricule: `TS${id}`, societe: ACTIVE, statut: 'sortant', fonction: 'Contrôleur test', ...overrides };
}
function fixture(agents, session = { username: 'ops-test', transverse: 'ops', role: 'ops', societe: ACTIVE }, hash = '#/effectif/sortants') {
  const app = loadSgdiApp(NAMES);
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  const t = app.T(), w = app.window;
  const db = t.emptyDB(); db.agents = agents;
  t.setDb(db); t.setSession(session);
  w.location.hash = hash;
  w.hydrateEmployeePhotos = () => {};
  const view = w.document.getElementById('view');
  t.renderElementsSortants(view);
  return { app, t, w, view };
}
const rowNames = view => Array.from(view.querySelectorAll('[data-ops-outgoing-row] strong'), el => el.textContent);
const filter = (view, key) => view.querySelector(`[data-ops-outgoing-filter="${key}"]`);
const optionLabels = select => Array.from(select.options, o => o.textContent);

test('rendu : en-tête, description, compteur réel et société active, sans bandeau KPI supplémentaire', () => {
  const { view, w } = fixture([employee(1), employee(2), employee(3), employee(4, { statut: 'actif' })]);
  assert.ok(view.querySelector('.ops-outgoing-page .ops-outgoing-card'));
  assert.equal(view.querySelector('h1.ops-outgoing-title').textContent, 'Éléments sortants');
  assert.ok(view.querySelector('.ops-outgoing-mark svg'), 'pictogramme sortie');
  assert.equal(view.querySelector('.ops-outgoing-count').textContent.trim(), `3 dossier(s) · ${ACTIVE}`);
  assert.equal(view.querySelector('.ops-outgoing-description').textContent, "Liste des employés ayant quitté l'entreprise ou en cours de sortie.");
  assert.equal(view.querySelector('[data-ops-outgoing-kpi]').textContent, '3');
  assert.equal(view.querySelectorAll('.ops-outgoing-kpi').length, 1);
  assert.equal(view.querySelectorAll('.module-counters-ribbon,.atlas-kpi-bar').length, 0);
  assert.deepEqual(Array.from(view.querySelectorAll('thead th'), th => th.textContent.trim()), ['Employé', 'Société', 'Date sortie', 'Poste', 'Action']);
  assert.equal(view.querySelectorAll('[data-ops-outgoing-row]').length, 3);
  assert.equal(view.querySelector('.ops-outgoing-range').textContent, 'Affichage de 1 à 3 sur 3 éléments');
  w.close();
});

test('population inchangée : seul le statut « sortant » de la société active est listé', () => {
  const { view, w } = fixture([employee(1), employee(2, { statut: 'demissionne' }), employee(3, { statut: 'licencie' }),
    employee(4, { statut: 'actif' }), employee(5, { societe: OTHER }), employee(6, { societe: '' })]);
  assert.deepEqual(rowNames(view), ['TESTEUR 1 Prenom1', 'TESTEUR 6 Prenom6']);
  assert.doesNotMatch(view.textContent, /TESTEUR 5/, "aucune fuite d'une autre société");
  assert.equal(view.querySelector('[data-ops-outgoing-kpi]').textContent, '2');
  w.close();
});

test('compteur : libellé de périmètre conforme au périmètre réel', () => {
  const agents = [employee(1), employee(2, { societe: OTHER })];
  let f = fixture(agents);
  assert.equal(f.view.querySelector('[data-ops-outgoing-scope]').textContent, 'Sur la société active');
  f.w.close();
  f = fixture(agents, { username: 'g', transverse: 'ops', role: 'ops', permissionsFromServer: true, globalSocietyAccess: true });
  assert.equal(f.view.querySelector('[data-ops-outgoing-scope]').textContent, "Sur l'ensemble des sociétés");
  assert.equal(f.view.querySelector('[data-ops-outgoing-kpi]').textContent, '2');
  assert.equal(f.view.querySelector('.ops-outgoing-count').textContent.trim(), '2 dossier(s)');
  f.w.close();
  f = fixture(agents, { username: 'm', transverse: 'ops', role: 'ops', permissionsFromServer: true, globalSocietyAccess: false, societesAutorisees: [ACTIVE, OTHER] });
  assert.equal(f.view.querySelector('[data-ops-outgoing-scope]').textContent, 'Sur 2 sociétés autorisées');
  f.w.close();
  f = fixture(agents, { username: 's', transverse: 'ops', role: 'ops', permissionsFromServer: true, globalSocietyAccess: false, societesAutorisees: [ACTIVE] });
  assert.equal(f.view.querySelector('[data-ops-outgoing-scope]').textContent, 'Sur la société active');
  assert.doesNotMatch(f.view.querySelector('.ops-outgoing-kpi').textContent, /ensemble des sociétés/);
  f.w.close();
});

test('recherche : nom, prénom, matricule et poste réels, sans accents ni casse ; seule la zone de résultats est redessinée', () => {
  const { view, t, w } = fixture([employee(1, { nom: 'ZERROUKI', prenom: 'Élodie', fonction: 'Rondier' }), employee(2, { matricule: 'ZX-77', fonction: 'Opératrice vidéo' }), employee(3)]);
  const input = view.querySelector('#ops-outgoing-search');
  assert.equal(input.getAttribute('placeholder'), 'Rechercher un employé, un matricule, un poste...');
  assert.ok(input.hasAttribute('data-no-lock'), 'la recherche reste utilisable en mode lecture');
  t.opsOutgoingSetFilter('q', 'elodie');
  assert.deepEqual(rowNames(view), ['ZERROUKI Élodie']);
  assert.equal(view.querySelector('#ops-outgoing-search'), input, 'le champ de recherche est conservé (focus intact)');
  t.opsOutgoingSetFilter('q', 'zx-77');
  assert.deepEqual(rowNames(view), ['TESTEUR 2 Prenom2']);
  t.opsOutgoingSetFilter('q', 'OPERATRICE');
  assert.deepEqual(rowNames(view), ['TESTEUR 2 Prenom2']);
  assert.equal(view.querySelector('.ops-outgoing-range').textContent, 'Affichage de 1 à 1 sur 1 élément');
  assert.equal(view.querySelector('[data-ops-outgoing-kpi]').textContent, '3', 'le compteur reste le total réel');
  t.opsOutgoingSetFilter('q', '');
  assert.equal(rowNames(view).length, 3);
  w.close();
});

test('société : société active imposée (liste verrouillée) pour un périmètre mono-société', () => {
  const { view, w } = fixture([employee(1), employee(2, { societe: OTHER })]);
  const select = filter(view, 'societe');
  assert.equal(select.disabled, true);
  assert.deepEqual(optionLabels(select), [ACTIVE]);
  assert.doesNotMatch(view.querySelector('.ops-outgoing-filters').textContent, /Toutes les sociétés/);
  w.close();
});

test('société : « Toutes les sociétés » et filtrage pour un utilisateur multi-sociétés sans société active', () => {
  const { view, t, w } = fixture([employee(1), employee(2, { societe: OTHER }), employee(3, { societe: OTHER })],
    { username: 'g', transverse: 'ops', role: 'ops', permissionsFromServer: true, globalSocietyAccess: true });
  const select = filter(view, 'societe');
  assert.equal(select.disabled, false);
  assert.deepEqual(optionLabels(select), ['Toutes les sociétés', OTHER, ACTIVE]);
  assert.equal(rowNames(view).length, 3);
  t.opsOutgoingSetFilter('societe', OTHER);
  assert.deepEqual(rowNames(view), ['TESTEUR 2 Prenom2', 'TESTEUR 3 Prenom3']);
  t.opsOutgoingSetFilter('societe', 'SOCIÉTÉ INCONNUE');
  assert.equal(rowNames(view).length, 3, 'une valeur hors des sociétés réelles est ignorée');
  w.close();
});

test('date : sans date réelle, « — » et « Non renseignée », aucun filtre ni tri de date', () => {
  const { view, t, w } = fixture([employee(1), employee(2, { dateSortie: 'pas une date' }), employee(3, { dateSortie: '2024-02-31' })]);
  assert.equal(filter(view, 'date'), null);
  assert.equal(view.querySelector('[data-ops-outgoing-sort="date"]'), null);
  assert.equal(view.querySelector('[data-ops-outgoing-col="date"]').hasAttribute('aria-sort'), false);
  for (const cell of view.querySelectorAll('td[data-label="Date sortie"]')) {
    assert.equal(cell.querySelector('.ops-outgoing-date').textContent, '—');
    assert.equal(cell.querySelector('.ops-outgoing-tag.is-muted').textContent, 'Non renseignée');
    assert.doesNotMatch(cell.textContent, /\d{2}\/\d{2}\/\d{4}|Invalid/);
  }
  assert.equal(t.opsOutgoingExitDate({ finRelationAt: '2025-01-01', departAt: '2025-01-02' }), '', 'aucune date de remplacement');
  w.close();
});

test('date : format JJ/MM/AAAA, filtre de période et tri disponibles quand la date existe', () => {
  const now = new Date().toISOString().slice(0, 10);
  const { view, t, w } = fixture([employee(1, { dateSortie: '2020-03-07' }), employee(2, { dateSortie: now }), employee(3)]);
  assert.deepEqual(optionLabels(filter(view, 'date')), ['Toutes les dates', 'Ce mois-ci', '30 derniers jours', 'Cette année', 'Non renseignée']);
  const cells = Array.from(view.querySelectorAll('td[data-label="Date sortie"]'), td => td.textContent.trim());
  assert.equal(cells[0], '07/03/2020');
  assert.equal(cells[1], `${now.slice(8, 10)}/${now.slice(5, 7)}/${now.slice(0, 4)}`);
  assert.equal(cells[2], '—Non renseignée');
  for (const period of ['month', '30d', 'year']) {
    t.opsOutgoingSetFilter('date', period);
    assert.deepEqual(rowNames(view), ['TESTEUR 2 Prenom2'], period);
  }
  t.opsOutgoingSetFilter('date', 'none');
  assert.deepEqual(rowNames(view), ['TESTEUR 3 Prenom3']);
  t.opsOutgoingSetFilter('date', '');
  t.opsOutgoingSetSort('date');
  assert.deepEqual(rowNames(view), ['TESTEUR 1 Prenom1', 'TESTEUR 2 Prenom2', 'TESTEUR 3 Prenom3']);
  t.opsOutgoingSetSort('date');
  assert.deepEqual(rowNames(view), ['TESTEUR 2 Prenom2', 'TESTEUR 1 Prenom1', 'TESTEUR 3 Prenom3'], 'les dates absentes restent en fin de liste');
  assert.equal(view.querySelector('[data-ops-outgoing-col="date"]').getAttribute('aria-sort'), 'descending');
  w.close();
});

test('poste : uniquement les postes réellement présents', () => {
  const { view, t, w } = fixture([employee(1, { fonction: 'Rondier' }), employee(2, { fonction: '', poste: 'Chef de quart' }), employee(3, { fonction: 'Rondier' }), employee(4, { fonction: '' })]);
  assert.deepEqual(optionLabels(filter(view, 'poste')), ['Tous les postes', 'Chef de quart', 'Rondier']);
  t.opsOutgoingSetFilter('poste', 'Rondier');
  assert.deepEqual(rowNames(view), ['TESTEUR 1 Prenom1', 'TESTEUR 3 Prenom3']);
  assert.equal(view.querySelectorAll('.ops-outgoing-tag.is-role').length, 2);
  t.opsOutgoingSetFilter('poste', '');
  assert.equal(view.querySelector('[data-ops-outgoing-row="emp-4"] .ops-outgoing-tag.is-role'), null, 'aucun poste inventé');
  w.close();
});

test('tri : croissant, décroissant puis ordre initial, avec aria-sort', () => {
  const { view, t, w } = fixture([employee(1, { nom: 'MEKKI', fonction: 'B' }), employee(2, { nom: 'ABDI', fonction: 'C' }), employee(3, { nom: 'ZIANI', fonction: 'A' })]);
  const col = key => view.querySelector(`[data-ops-outgoing-col="${key}"]`);
  assert.deepEqual(Array.from(view.querySelectorAll('[data-ops-outgoing-sort]'), b => b.dataset.opsOutgoingSort), ['employe', 'societe', 'poste']);
  assert.equal(col('action').querySelector('button'), null);
  assert.equal(col('employe').getAttribute('aria-sort'), 'none');
  t.opsOutgoingSetSort('employe');
  assert.deepEqual(rowNames(view).map(n => n.split(' ')[0]), ['ABDI', 'MEKKI', 'ZIANI']);
  assert.equal(col('employe').getAttribute('aria-sort'), 'ascending');
  t.opsOutgoingSetSort('employe');
  assert.deepEqual(rowNames(view).map(n => n.split(' ')[0]), ['ZIANI', 'MEKKI', 'ABDI']);
  assert.equal(col('employe').getAttribute('aria-sort'), 'descending');
  t.opsOutgoingSetSort('employe');
  assert.deepEqual(rowNames(view).map(n => n.split(' ')[0]), ['MEKKI', 'ABDI', 'ZIANI']);
  t.opsOutgoingSetSort('poste');
  assert.deepEqual(rowNames(view).map(n => n.split(' ')[0]), ['ZIANI', 'MEKKI', 'ABDI']);
  t.opsOutgoingSetSort('inconnu');
  assert.equal(col('poste').getAttribute('aria-sort'), 'ascending');
  w.close();
});

test('pagination : 25 lignes par page, plage affichée et page courante', () => {
  const { view, t, w } = fixture(Array.from({ length: 53 }, (_, i) => employee(String(i + 1).padStart(2, '0'))));
  assert.equal(view.querySelectorAll('[data-ops-outgoing-row]').length, 25);
  assert.equal(view.querySelector('.ops-outgoing-range').textContent, 'Affichage de 1 à 25 sur 53 éléments');
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-current="page"]').textContent, '1');
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-label="Page précédente"]').disabled, true);
  t.opsOutgoingSetPage(3);
  assert.equal(view.querySelectorAll('[data-ops-outgoing-row]').length, 3);
  assert.equal(view.querySelector('.ops-outgoing-range').textContent, 'Affichage de 51 à 53 sur 53 éléments');
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-current="page"]').textContent, '3');
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-label="Page suivante"]').disabled, true);
  t.opsOutgoingSetPage(99);
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-current="page"]').textContent, '3', 'page bornée');
  t.opsOutgoingSetFilter('q', 'TS0');
  assert.equal(view.querySelector('.ops-outgoing-page-btn[aria-current="page"]').textContent, '1', 'un filtre revient en page 1');
  assert.equal(view.querySelector('.ops-outgoing-range').textContent, 'Affichage de 1 à 9 sur 9 éléments');
  w.close();
});

test('statut : « Sorti », « En cours de sortie » si la date réelle est à venir, aucun badge sinon', () => {
  const { view, t, w } = fixture([employee(1), employee(2, { dateSortie: '2999-12-31' }), employee(3, { dateSortie: '2020-01-15' })]);
  const badge = id => view.querySelector(`[data-ops-outgoing-row="emp-${id}"] [data-ops-outgoing-status]`);
  assert.equal(badge(1).textContent, 'Sorti'); assert.equal(badge(1).dataset.opsOutgoingStatus, 'left');
  assert.equal(badge(2).textContent, 'En cours de sortie'); assert.equal(badge(2).dataset.opsOutgoingStatus, 'pending');
  assert.equal(badge(3).textContent, 'Sorti');
  assert.equal(badge(1).closest('td').dataset.label, 'Poste', 'statut affiché à droite du poste');
  assert.equal(t.opsOutgoingStatus({ statut: 'actif' }), null);
  assert.equal(t.opsOutgoingStatus({ statut: 'demissionne' }), null, 'aucun statut « Sorti » par défaut');
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(css, /\.ops-outgoing-status\.is-left\{background:#fff0f1;color:#bb303e\}/);
  assert.match(css, /\.ops-outgoing-status\.is-pending\{background:#fff3df;color:#9f580a\}/);
  w.close();
});

test('action : « Ouvrir → » réutilise la route de fiche existante, sans menu ni action inventée', () => {
  const { view, w } = fixture([employee(1, { id: 'emp 1/é' })]);
  const link = view.querySelector('.ops-outgoing-open');
  assert.equal(link.getAttribute('href'), '#/agents/' + encodeURIComponent('emp 1/é'));
  assert.equal(link.getAttribute('onclick'), "setFicheContext('ops')");
  assert.match(link.textContent, /Ouvrir →/);
  const actions = view.querySelector('td[data-label="Action"]');
  assert.equal(actions.querySelectorAll('a,button').length, 1, 'une seule action réelle : pas de menu ⋮');
  assert.doesNotMatch(view.textContent, /Supprimer|Réintégrer|Archiver|Valider sortie|⋮/);
  w.close();
});

test('avatar : initiales sur pastel déterministe, photo protégée seulement si elle existe', () => {
  const { view, t, w } = fixture([employee(1, { nom: 'KACI', prenom: 'Lyes' }), employee(2, { backendId: 42, hasPhoto: true, photoUrl: '/api/ops/employees/42/photo?v=1' }), employee(3, { hasPhoto: false, photoUrl: '', photo: 'data:image/png;base64,AAAA' })]);
  const avatar = id => view.querySelector(`[data-ops-outgoing-row="emp-${id}"] .ops-outgoing-avatar`);
  assert.equal(avatar(1).querySelector('.employee-avatar-initials').textContent, 'KL');
  assert.equal(avatar(1).querySelector('img'), null);
  assert.equal(avatar(1).dataset.tone, t.opsOutgoingAvatarTone({ id: 'emp-1' }), 'couleur déterministe');
  const img = avatar(2).querySelector('img');
  assert.equal(img.dataset.employeePhoto, '/api/ops/employees/42/photo?v=1');
  assert.equal(img.hasAttribute('src'), false, 'aucune URL protégée chargée sans jeton');
  assert.equal(img.style.display, 'none', 'initiales visibles tant que la photo est absente');
  assert.ok(avatar(2).querySelector('.employee-avatar-initials'));
  assert.equal(avatar(3).querySelector('img'), null, 'absence explicite de photo respectée');
  w.close();
});

test('état vide : en-tête, filtres et cadre de table conservés', () => {
  let f = fixture([employee(1, { statut: 'actif' })]);
  assert.ok(f.view.querySelector('.ops-outgoing-header') && f.view.querySelector('#ops-outgoing-search') && f.view.querySelector('.ops-outgoing-table thead'));
  assert.equal(f.view.querySelector('[data-ops-outgoing-kpi]').textContent, '0');
  assert.equal(f.view.querySelector('.ops-outgoing-empty strong').textContent, 'Aucun élément sortant.');
  assert.match(f.view.querySelector('.ops-outgoing-empty').textContent, /Aucun dossier ne correspond aux critères sélectionnés\./);
  assert.equal(f.view.querySelector('.ops-outgoing-pager'), null);
  assert.equal(filter(f.view, 'poste'), null, 'pas de filtre poste sans poste réel');
  f.w.close();
  f = fixture([employee(1)]);
  f.t.opsOutgoingSetFilter('q', 'introuvable');
  assert.equal(f.view.querySelectorAll('[data-ops-outgoing-row]').length, 0);
  assert.equal(f.view.querySelector('.ops-outgoing-empty strong').textContent, 'Aucun élément sortant.');
  assert.ok(f.view.querySelector('.ops-outgoing-header'));
  f.w.close();
});

test("permissions : aucun bouton Exporter (aucun export n'existe pour cet écran), même avec la permission export", () => {
  for (const actions of [['read'], ['read', 'export']]) {
    const { view, w } = fixture([employee(1)], { username: 'p', transverse: 'ops', role: 'ops', societe: ACTIVE, permissionsFromServer: true, authorizedActions: actions, societesAutorisees: [ACTIVE] });
    assert.doesNotMatch(view.textContent, /Exporter/);
    assert.equal(view.querySelectorAll('.ops-outgoing-header button,.ops-outgoing-header a').length, 0, 'aucun bouton sans action');
    w.close();
  }
});

test("l'en-tête de la page n'est pas réécrit par le normaliseur générique", () => {
  const { view, t, w } = fixture([employee(1)]);
  t.normalizePageHeader(view);
  assert.equal(view.querySelector('.module-page-header,.module-page-header-actions,.module-page-header-copy'), null);
  w.close();
});

test('autres vues inchangées : DRH et archives gardent le rendu historique', () => {
  const month = new Date().toISOString().slice(0, 7);
  const drh = fixture([employee(1, { dateSortie: `${month}-01` })], { username: 'drh-test', transverse: 'drh', role: 'drh', societe: ACTIVE });
  assert.equal(drh.view.querySelector('.ops-outgoing-page'), null);
  assert.ok(drh.view.querySelector('.effectif-page .drh-effectif-list-header'));
  assert.deepEqual(Array.from(drh.view.querySelectorAll('thead th'), th => th.textContent), ['Employé', 'Date sortie', 'Dotation', 'STC congés', 'MED', 'Action']);
  assert.equal(drh.view.querySelector('h1').textContent, 'ÉLÉMENTS SORTANTS');
  drh.w.close();
  const archive = fixture([employee(1)]);
  archive.t.renderElementsSortants(archive.view, 'archives');
  assert.equal(archive.view.querySelector('.ops-outgoing-page'), null);
  assert.equal(archive.view.querySelector('h1').textContent, 'ARCHIVES DES ÉLÉMENTS SORTANTS');
  assert.deepEqual(Array.from(archive.view.querySelectorAll('thead th'), th => th.textContent), ['Employé', 'Société', 'Date sortie', 'Poste', 'Action']);
  archive.w.close();
});

test('données réelles uniquement : aucune valeur de maquette codée dans le rendu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');
  const block = source.slice(source.indexOf('// OPS → ÉLÉMENTS SORTANTS (refonte UI)'));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /IRON GLOBAL|SWORD|2 dossier/);
  const { view, w } = fixture([]);
  assert.equal(view.querySelectorAll('[data-ops-outgoing-row]').length, 0);
  assert.equal(view.querySelector('[data-ops-outgoing-kpi]').textContent, '0');
  w.close();
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
