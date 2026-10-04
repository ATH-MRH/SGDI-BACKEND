// OPS → Sites : Command Center sombre (présentation). Vrai sgdi-app.js + modules dans jsdom.
// Contrat : données réelles uniquement, indicateurs manque/surplus compacts, détail conservé,
// filtres réels, état vide, aucun bouton mort, autres contextes (Matériel, Superviseur…) inchangés.
// Le rendu visuel, la carte MapLibre/OSM et le responsive sont contrôlés en Chrome réel par
// tests_frontend/ops-sites-command-center-chrome.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const STATIC = path.join(__dirname, '../app/static');
const SOC = 'IRON GLOBAL SOLUTION';
const site = (id, nom, extra = {}) => ({ id: 's' + id, backendId: id, nom, indicatif: 'IND-' + id, societe: SOC, actif: true, dateOuverture: '2020-01-01',
  adresse: 'Adresse ' + id, commune: 'Commune ' + id, wilaya: 'Alger', client: 'CLIENT A', effectifs: { totalContractuel: 0, jour: 0, nuit: 0 }, ...extra });
const SITES = [
  site(1, 'SITE UN', { latitude: 36.75, longitude: 3.05, contact: { nom: 'Mme Test', telephone: '0550000001' }, effectifs: { totalContractuel: 4, jour: 3, nuit: 1 } }),
  site(2, 'SITE DEUX', { wilaya: 'Oran', client: 'CLIENT B', latitude: 35.69, longitude: -0.63, effectifs: { totalContractuel: 3, jour: 2, nuit: 1 } }),
  site(3, 'SITE TROIS', { effectifs: { totalContractuel: 2, jour: 1, nuit: 1 } }),
  site(4, 'SITE QUATRE', { wilaya: 'Oran', client: 'CLIENT B', actif: false, effectifs: { totalContractuel: 5, jour: 3, nuit: 2 } }),
];
// Situation serveur (même forme que /ops/sites/situation-generale).
const situation = () => new Map([[1, 4, 3, 1, 0], [2, 3, 10, 0, 7], [3, 2, 2, 0, 0], [4, 5, 0, 5, 0]].map(([id, contractual, realized, missing, surplus]) =>
  [String(id), { site_id: id, contractual_staff: contractual, realized_staff: realized, missing_staff: missing, surplus_staff: surplus, operational_site: id !== 4 }]));

function boot(t, { transverse = 'ops', session = {}, db = {} } = {}) {
  const r = loadSgdiApp(['emptyDB', 'renderOpsSitesCommandCenter', 'opsSitesCcEnabled', 'opsSitesCcFilter', 'opsSitesCcReset', 'opsSitesCcQuick', 'opsSitesCcSetView',
    'opsSitesCcSetLayout', 'opsSitesCcToggleDetail', 'opsSitesCcLoadingHTML', 'opsSitesCcMapStyle', 'renderSites', 'sgdiMapLibreStyle', 'normalizeCentralPage']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  w.setTimeout = () => 0;
  r.dom.reconfigure({ url: 'http://localhost/#/sites' });
  r.T().setDb({ ...r.T().emptyDB(), sites: SITES.map(s => ({ ...s })), ...db });
  r.T().setSession({ username: 'OPS-01', nom: 'Karim Test', role: 'ops', transverse, societe: SOC, actionsAutorisees: ['read', 'create', 'update'], ...session });
  w.sgdiBackendShouldUse = () => false;
  const view = w.document.getElementById('view');
  return { ...r, w, view };
}
const render = (ctx, sites = SITES, options = { situationBySite: situation() }) => { ctx.T().renderOpsSitesCommandCenter(ctx.view, sites, options); return ctx.view.querySelector('.ops-sites-cc'); };
const texts = (root, selector) => [...root.querySelectorAll(selector)].map(el => el.textContent.replace(/\s+/g, ' ').trim());
const kpis = root => Object.fromEntries([...root.querySelectorAll('.ops-sites-cc-kpi')].map(el => [el.dataset.ccKpi, el.querySelector('strong').textContent]));

test('Sites Command Center — en-tête, onglets réels, aucun bouton mort ni « Nouveau site »', t => {
  const ctx = boot(t);
  const root = render(ctx);
  assert.ok(root, 'command center rendu dans le contenu');
  assert.equal(root.dataset.testid, 'ops-sites-command-center');
  assert.equal(root.querySelector('h1').textContent, 'Sites - Tableau de bord');
  assert.equal(root.querySelector('.ops-sites-cc-head p').textContent, "Vue d'ensemble de tous vos sites en temps réel");
  assert.deepEqual(texts(root, '.ops-sites-cc-crumb > *'), ['OPS', '›', 'Sites']);
  assert.deepEqual(texts(root, '[data-cc-view-btn]'), ['Carte', 'Liste', 'Analytique'], '« Planning » absent : aucune fonction réelle');
  // Création de site réservée au Commercial (API 403, formulaire redirigé) : jamais de bouton, même avec l'action create.
  assert.doesNotMatch(root.textContent, /Nouveau site/i);
  assert.match(fs.readFileSync(path.join(STATIC, 'js/modules/sites-1.js'), 'utf8'), /Création des sites réservée au Commercial/);
  for (const button of root.querySelectorAll('button')) assert.ok(button.getAttribute('onclick'), 'bouton sans action: ' + button.textContent);
  for (const link of root.querySelectorAll('a')) assert.ok((link.getAttribute('href') || '').length > 1, 'lien mort: ' + link.textContent);
  assert.equal(ctx.view.querySelectorAll('.sidebar,.sgdi-topbar,.module-counters-ribbon').length, 0, 'ni seconde sidebar, ni second header, ni second bandeau');
});

test('Sites Command Center — KPI calculés sur les données réelles, aucune valeur de maquette', t => {
  const ctx = boot(t, { db: { incidents: [{ id: 'i1', statut: 'ouvert', societe: SOC, siteId: 's1' }, { id: 'i2', statut: 'clos', societe: SOC, siteId: 's1' }] } });
  const root = render(ctx);
  assert.deepEqual(kpis(root), { 'Sites total': '4', 'Sites actifs': '3', 'Sites en alerte': '1', 'Agents affectés': '15', 'Incidents ouverts': '1', 'Couverture': '89%' },
    'couverture = (3+3+2)/(4+3+2) ; missions masquées faute de compteur serveur');
  assert.equal(root.querySelector('#ops-sites-cc-count').textContent, 'Liste des sites (4)');
  assert.match(root.textContent, /Suivi en temps réel de l'état de vos sites/);
  assert.deepEqual(texts(root, '.ops-sites-cc-coverage dl div'), ['Sites4', 'Wilayas2', 'Agents affectés15', 'Positionnés GPS2/4']);
  assert.deepEqual(texts(root, '.ops-sites-cc-legend li'), ['Opérationnel 2', 'Alerte effectif 1', 'Inactif 1'], 'légende limitée aux statuts réellement présents');
  assert.doesNotMatch(root.textContent, /Maintenance|Planning|Lorem|Sonatrach|Hassi/i);
  assert.equal(root.querySelectorAll('img').length, 0, 'aucune photo inventée : placeholder graphique uniquement');
  assert.equal(root.querySelectorAll('.ops-sites-cc-card .ops-sites-cc-thumb svg').length, 4);
  assert.deepEqual(texts(root, '.ops-sites-cc-synth-tile'), ["En instance d'affectation0", 'Sites opérationnels3', 'Effectif contrat9', 'Effectif réalisé15', "Manque d'effectif1", 'Effectif surplus7']);
  assert.deepEqual(texts(root, '[data-cc-panel="repartition"] .ops-sites-cc-donut li'), ['Opérationnel250%', 'Alerte effectif125%', 'Inactif125%']);
  assert.equal(root.querySelector('[data-cc-panel="echeances"]'), null, 'pas de panneau « Prochaines échéances » sans échéance réelle');
  assert.match(root.querySelector('[data-cc-panel="activite"]').textContent, /Aucun mouvement enregistré/, 'aucune activité fictive');
});

test('Sites Command Center — cartes compactes : manque et surplus en indicateurs, détail complet conservé', t => {
  const ctx = boot(t);
  const root = render(ctx);
  const cards = [...root.querySelectorAll('.ops-sites-cc-card')];
  assert.deepEqual(cards.map(card => card.querySelector('h3').textContent), ['SITE UN', 'SITE DEUX', 'SITE TROIS', 'SITE QUATRE']);
  assert.deepEqual(cards.map(card => card.querySelector('.ops-sites-cc-status').textContent), ['Alerte effectif', 'Opérationnel', 'Opérationnel', 'Inactif']);
  assert.deepEqual(cards.map(card => card.querySelector('.ops-sites-cc-chip').textContent), ['⚠ 1 manquant', '+7 surplus', 'Conforme', 'Site inactif']);
  assert.doesNotMatch(root.textContent, /ALERTE MANQUE D'EFFECTIF/, 'plus de gros bloc d\'alerte');
  assert.match(cards[0].querySelector('.ops-sites-cc-card-info').textContent.replace(/\s+/g, ' '), /Adresse\s*Adresse 1 · Commune 1, Alger\s*Client\s*CLIENT A\s*Contact\s*Mme Test · 0550000001/);
  assert.deepEqual(texts(cards[0], '.ops-sites-cc-metric > span:first-child'), ['Agents', 'Contractuel', 'Alerte']);
  assert.equal(cards[0].querySelector('.ops-sites-cc-more').getAttribute('href'), '#/sites/1');
  assert.equal(cards[0].querySelector('.ops-sites-cc-more').textContent, 'Voir le détail →');
  // Détail : mêmes données que l'ancienne carte (contractuel, jour, nuit, affecté, surplus, manque, historique).
  const detail = cards[0].querySelector('.ops-sites-cc-card-detail');
  assert.equal(detail.hidden, true);
  ctx.T().opsSitesCcToggleDetail(cards[0].querySelector('[aria-controls]'));
  assert.equal(detail.hidden, false);
  assert.deepEqual(texts(detail, '.ops-sites-cc-detail-grid > div'), ['Contractuel4', 'Jour3', 'Nuit1', 'Affecté3', 'Surplus0', 'Manque−1']);
  assert.deepEqual(texts(cards[1], '.ops-sites-cc-detail-grid > div'), ['Contractuel3', 'Jour2', 'Nuit1', 'Affecté10', 'Surplus+7', 'Manque0']);
  assert.match(detail.textContent, /Historique des mouvements/);
  assert.match(detail.querySelector('button').getAttribute('onclick'), /openSiteMovementHistoryModal\('s1'\)/);
  assert.match(cards[0].querySelector('button.ops-sites-cc-metric').getAttribute('onclick'), /openSiteAffectesModal\('1'\)/, 'agents affectés toujours consultables');
  // Compatibilité avec les fonctions existantes (clic sur la carte, filtres de synthèse).
  assert.equal(cards[0].classList.contains('site-card'), true);
  assert.deepEqual([cards[0].dataset.siteManque, cards[1].dataset.siteSurplus, cards[0].dataset.siteContractuel, cards[0].dataset.siteRealise], ['1', '7', '4', '3']);
  // Tableau analytique : toutes les colonnes d'effectif par site.
  assert.match(texts(root, '.ops-sites-cc-table tbody tr')[1].replace(/\s/g, ''), /SITEDEUXOpérationnel3211007100%/);
  assert.match(texts(root, '.ops-sites-cc-table tbody tr')[0].replace(/\s/g, ''), /SITEUNAlerteeffectif43131075%/);
});

test('Sites Command Center — filtres recherche / statut / wilaya / client sur données réelles, vues et disposition', t => {
  const ctx = boot(t);
  const root = render(ctx);
  const shown = () => [...root.querySelectorAll('.ops-sites-cc-card')].filter(card => !card.hidden).map(card => card.querySelector('h3').textContent);
  const set = (id, value) => { root.querySelector('#' + id).value = value; ctx.T().opsSitesCcFilter(); };
  assert.deepEqual(texts(root, '#ops-sites-cc-status option'), ['Tous les statuts', 'Opérationnel', 'Alerte effectif', 'Inactif']);
  assert.deepEqual(texts(root, '#ops-sites-cc-wilaya option'), ['Toutes les wilayas', 'Alger', 'Oran']);
  assert.deepEqual(texts(root, '#ops-sites-cc-client option'), ['Tous les clients', 'CLIENT A', 'CLIENT B']);
  set('ops-sites-cc-search', 'deux');
  assert.deepEqual(shown(), ['SITE DEUX']);
  assert.match(root.querySelector('#sites-filter-info').textContent, /1 site\(s\) affiché\(s\) sur 4/);
  ctx.T().opsSitesCcReset();
  set('ops-sites-cc-status', 'alerte');
  assert.deepEqual(shown(), ['SITE UN']);
  ctx.T().opsSitesCcReset();
  set('ops-sites-cc-wilaya', 'Oran');
  assert.deepEqual(shown(), ['SITE DEUX', 'SITE QUATRE']);
  set('ops-sites-cc-client', 'CLIENT A');
  assert.deepEqual(shown(), []);
  assert.equal(root.querySelector('#ops-sites-cc-no-match').hidden, false);
  ctx.T().opsSitesCcReset();
  assert.equal(shown().length, 4);
  assert.equal(root.querySelector('#sites-filter-info').hidden, true);
  ctx.T().opsSitesCcQuick('surplus');
  assert.deepEqual(shown(), ['SITE DEUX']);
  ctx.T().opsSitesCcReset();
  ctx.T().opsSitesCcSetView('liste');
  assert.deepEqual([root.dataset.ccView, root.dataset.ccLayout], ['liste', 'liste']);
  ctx.T().opsSitesCcSetView('analytique');
  assert.equal(root.querySelector('[data-cc-view-btn="analytique"]').getAttribute('aria-pressed'), 'true');
  ctx.T().opsSitesCcSetView('carte');
  ctx.T().opsSitesCcSetLayout('grille');
  assert.deepEqual([root.dataset.ccView, root.dataset.ccLayout], ['carte', 'grille']);
});

test('Sites Command Center — état vide propre et chargement sombre', t => {
  const ctx = boot(t, { db: { sites: [] } });
  const root = render(ctx, []);
  assert.equal(root.querySelectorAll('.ops-sites-cc-card').length, 0);
  assert.match(root.querySelector('[data-cc-empty]').textContent, /Aucun site dans ce périmètre/);
  assert.equal(root.querySelector('#sites-map-frame'), null, 'pas de carte sans site positionné');
  assert.equal(root.querySelector('.ops-sites-cc-filters'), null, 'pas de filtre sans donnée');
  assert.deepEqual(kpis(root), { 'Sites total': '0', 'Sites actifs': '0', 'Sites en alerte': '0', 'Agents affectés': '0', 'Incidents ouverts': '0' }, 'couverture masquée sans effectif contractuel');
  assert.match(ctx.T().opsSitesCcLoadingHTML(), /class="ops-sites-cc is-loading"[\s\S]*Chargement des chiffres depuis le serveur/);
});

test('Sites Command Center — échéances et activité uniquement à partir de données existantes', t => {
  const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const ctx = boot(t, { db: { opsMouvements: [{ id: 'm1', agentId: 'a1', date: '2026-09-01', siteId: 's1', mouvementMotif: 'Mutation', ordreMouvementNumero: 'OM-7' }], agents: [{ id: 'a1', nom: 'AGENT', prenom: 'Test', matricule: 'M1', societe: SOC, statut: 'actif' }] } });
  const root = render(ctx, [...SITES, site(5, 'SITE CINQ', { dateOuverture: future })]);
  assert.match(root.querySelector('[data-cc-panel="echeances"]').textContent, /Ouverture du site\s*SITE CINQ/);
  const activity = root.querySelector('[data-cc-panel="activite"]').textContent;
  assert.match(activity, /Mutation/);
  assert.match(activity, /SITE UN/);
  assert.match(root.querySelector('[data-cc-site="s5"] .ops-sites-cc-status').textContent, /Non opérationnel/);
});

test('Sites Command Center — réservé au contexte OPS ; Matériel et Superviseur gardent leur rendu', t => {
  for (const transverse of ['materiel', 'superviseur', 'admin', 'global']) {
    const ctx = boot(t, { transverse });
    assert.equal(ctx.T().opsSitesCcEnabled(), false, transverse);
    ctx.T().renderSites(ctx.view);
    assert.equal(ctx.view.querySelector('.ops-sites-cc'), null, transverse + ' : ancien rendu conservé');
    assert.match(ctx.view.textContent, /SITES - TABLEAU DE BORD/i, transverse);
  }
  const ops = boot(t);
  assert.equal(ops.T().opsSitesCcEnabled(), true);
  ops.T().renderSites(ops.view);
  assert.ok(ops.view.querySelector('.ops-sites-cc[data-cc-ready]'), 'OPS : command center (repli local)');
  assert.equal(ops.view.querySelector('.sites-synth-panel'), null);
  assert.doesNotMatch(ops.view.textContent, /ALERTE MANQUE D'EFFECTIF|Synthèse situation générale/);
});

test('Sites Command Center — vraie carte conservée : MapLibre + tuiles et attribution OpenStreetMap, rendu sombre', t => {
  const ctx = boot(t);
  const base = ctx.T().sgdiMapLibreStyle(), dark = ctx.T().opsSitesCcMapStyle();
  assert.equal(JSON.stringify(dark.sources), JSON.stringify(base.sources), 'mêmes sources de tuiles');
  assert.match(dark.sources.osm.tiles[0], /tile\.openstreetmap\.org/);
  assert.match(dark.sources.osm.attribution, /OpenStreetMap/);
  assert.equal(dark.layers.map(layer => layer.id).join(), 'osm,satellite');
  assert.equal(dark.layers[0].paint['raster-brightness-max'], 0);
  assert.equal(dark.layers[1].paint, undefined, 'vue satellite inchangée');
  const source = fs.readFileSync(path.join(STATIC, 'js/modules/sites-command-center.js'), 'utf8');
  assert.match(source, /new maplibregl\.Map\(/);
  assert.match(source, /new maplibregl\.AttributionControl\(\{compact:false\}\)/, 'attribution toujours affichée');
  assert.match(source, /new maplibregl\.NavigationControl\(/, 'zoom conservé');
  assert.doesNotMatch(source, /<img|\.png|\.jpg|data:image/, 'jamais une image à la place de la carte');
  const root = render(ctx);
  assert.equal(root.querySelector('#sites-map-frame').classList.contains('sgdi-maplibre-map'), true);
  assert.deepEqual(texts(root, '#sites-map-select option').slice(0, 2), ['Tous les sites positionnés', 'SITE UN · Commune 1, Alger']);
});

test('Sites Command Center — métier Sites intact (fonctions existantes non modifiées)', () => {
  const sites = fs.readFileSync(path.join(STATIC, 'js/modules/sites.js'), 'utf8');
  for (const name of ['siteEffectifAlertHTML', 'siteCoverageBarHTML', 'siteSyntheseServerHTML', 'siteSyntheseGeneraleHTML', 'filterSitesSituation', 'openSiteMovementHistoryModal',
    'openSiteAffectesModal', 'openSiteAjouterEffectifModal', 'siteMapDashboardHTML', 'updateSitesMap', 'saveSitePositionOnly']) assert.match(sites, new RegExp('function ' + name + '\\('), name);
  assert.match(sites, /dependencies: \["sites-1","sites-command-center"\]/);
  const css = fs.readFileSync(path.join(STATIC, 'sgdi-app.css'), 'utf8');
  const block = css.slice(css.indexOf('/* ── OPS → Sites : Command Center sombre'));
  for (const line of block.split('\n')) {
    if (/^\s*(#view|body\.atlas-ui)/.test(line)) assert.match(line, /\.ops-sites-cc/, 'style confiné au command center: ' + line.slice(0, 80));
  }
});

// Régression production : la page était correcte au chargement puis sa grille cassait (fond blanc,
// titre et onglets déplacés, 7 KPI en colonne) dès qu'un rafraîchissement relançait renderView.
// renderView passe normalizeCentralPage sur la vue ; le normalisateur d'en-tête prenait la racine
// du command center (elle contient le h1) pour un bandeau de page.
test('OPS Sites V3 reste stable après chargement asynchrone', t => {
  const ctx = boot(t);
  // 1. Premier rendu : celui du chargement asynchrone (écrit dans la vue sans normalisation).
  const root = render(ctx);
  const structure = () => ({
    rootClass: ctx.view.querySelector('.ops-sites-cc').className,
    html: ctx.view.innerHTML,
    kpiParents: new Set([...ctx.view.querySelectorAll('.ops-sites-cc-kpi')].map(el => el.parentElement.className)),
    kpis: ctx.view.querySelectorAll('.ops-sites-cc-kpis > .ops-sites-cc-kpi').length,
    generic: ctx.view.querySelectorAll('.module-page-header,.module-page-header-actions,.module-page-header-copy,.module-title-clean').length,
  });
  const expected = structure();
  assert.equal(expected.rootClass, 'ops-sites-cc');
  assert.ok(expected.kpis >= 6, 'tous les KPI Sites sont dans la rangée (missions masqué sans compteur serveur)');
  assert.equal(expected.generic, 0);
  // 2. Les requêtes se résolvent, les callbacks relancent renderView : la vue est renormalisée
  //    (plusieurs fois : compteurs, situation des sites, rafraîchissement périodique).
  for (let pass = 0; pass < 3; pass++) {
    ctx.T().normalizeCentralPage(ctx.view);
    const now = structure();
    assert.equal(now.rootClass, 'ops-sites-cc', 'la racine ne devient jamais un bandeau de page générique');
    assert.equal(now.generic, 0, 'aucune classe du layout générique réappliquée');
    assert.deepEqual([...now.kpiParents], ['ops-sites-cc-kpis'], 'les KPI restent dans leur rangée, jamais déplacés en « actions »');
    assert.equal(now.kpis, expected.kpis);
    assert.equal(now.html, expected.html, 'DOM strictement identique au premier rendu');
  }
  // 3. Un nouveau rendu complet (retour sur la route, nouvelles données) puis normalisation : même structure.
  render(ctx);
  ctx.T().normalizeCentralPage(ctx.view);
  assert.equal(structure().html, expected.html);
  assert.equal(root.ownerDocument.querySelectorAll('#view .ops-sites-cc').length, 1, 'un seul command center');
  assert.ok(ctx.view.classList.contains('module-view'), 'la vue garde sa classe de module');
  // 4. Les changements de vue (Carte → Liste → Analytique → Carte) ne réintroduisent rien.
  for (const mode of ['liste', 'analytique', 'carte']) {
    ctx.T().opsSitesCcSetView(mode);
    ctx.T().normalizeCentralPage(ctx.view);
    assert.equal(ctx.view.querySelector('.ops-sites-cc').className, 'ops-sites-cc');
    assert.equal(ctx.view.querySelectorAll('.module-page-header,.module-page-header-actions').length, 0);
  }
});

test('le normalisateur générique continue de s\'appliquer aux autres pages', t => {
  const ctx = boot(t);
  ctx.view.innerHTML = '<div><h1>titre de page</h1><button class="btn">Action</button></div><table></table>';
  ctx.T().normalizeCentralPage(ctx.view);
  assert.ok(ctx.view.firstElementChild.classList.contains('module-page-header'), 'en-tête générique toujours normalisé');
  assert.ok(ctx.view.querySelector('.module-page-header-actions .btn'));
  assert.ok(ctx.view.querySelector('table').classList.contains('module-table-clean'));
});
