const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');
const { loadSgdiApp } = require('./load-app');

const CSS = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.css'), 'utf8');
const SOCIETY = 'IRON GLOBAL SOLUTION';
const today = () => new Date().toISOString().slice(0, 10);
const dateOffset = (days) => { const value = new Date(); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); };

function dashboardApp() {
  const app = loadSgdiApp(['renderCommDashboard', 'setCommDashboardRange', 'refreshCommercialFinancePanel', 'commercialModuleDestroy', 'commDashboardDate', 'commDashboardTrendSvg', 'stripCryptogrammes', 'normalizePageHeader']);
  assert.equal(app.loadError, null);
  const { window: w, T } = app;
  T().setSession({ username: 'DC01', societe: SOCIETY });
  T().setDb({
    prospects: [
      { id: 'p1', societe: SOCIETY, statut: 'nouveau', createdAt: dateOffset(-8) },
      { id: 'p2', societe: SOCIETY, statut: 'converti', createdAt: dateOffset(-25) },
      { id: 'p3', societe: 'AUTRE SOCIETE', statut: 'nouveau', createdAt: dateOffset(-3) },
    ],
    clients: [
      { id: 'c1', societe: SOCIETY, nom: 'Client Alpha', statut: 'actif', createdAt: dateOffset(-18), dateDebutContrat: dateOffset(-17), dateFinContrat: dateOffset(12) },
      { id: 'c2', societe: SOCIETY, nom: 'Client Beta', statut: 'actif', createdAt: dateOffset(-5), dateDebutContrat: dateOffset(-4), dateFinContrat: dateOffset(80) },
      { id: 'c3', societe: 'AUTRE SOCIETE', nom: 'Client hors périmètre', statut: 'actif', createdAt: dateOffset(-1) },
    ],
    opportunites: [
      { id: 'o1', societe: SOCIETY, nom: 'Opportunité ouverte', etape: 'proposition', montant: 100000, probabilite: 50, createdAt: dateOffset(-7) },
      { id: 'o2', societe: SOCIETY, nom: 'Affaire gagnée', etape: 'gagnee', montant: 200000, probabilite: 100, createdAt: today(), updatedAt: today() },
    ],
    visites: [],
    devis: [],
    settings: {},
  });
  w.SGDI_SIDEBAR_STATS = {
    scope: { active_society: SOCIETY }, generated_at: new Date().toISOString(),
    commercial: { prospects: 2, clients_active: 2, clients_total: 2, sites_total: 4, employees_total: 175,
      opportunities_open: 1, contracts_30d: 1, contracts_active: 2, tarifs_total: 28 },
    facturation: { invoices_issued: 2, invoiced_ttc: 15600539.72, payments_total: 0, payments_amount: 0 },
  };
  const view = w.document.getElementById('view');
  return { ...app, view };
}

test('dashboard Commercial : affiche le bandeau KPI screenshot depuis les statistiques ATLAS scopées', () => {
  const app = dashboardApp();
  app.T().renderCommDashboard(app.view);
  const text = app.view.textContent;
  for (const label of ['Prospects', 'Clients actifs', 'Sites', 'Total employés', 'Opportunités', 'Contrats 30J', 'Tarifs actifs']) assert.match(text, new RegExp(label));
  for (const value of ['175', '28', 'Pipeline pondéré', 'Chiffre d’affaires gagné']) assert.match(text, new RegExp(value));
  assert.doesNotMatch(text, /Client hors périmètre/);
  assert.match(app.view.querySelector('.comm-dashboard-kpis').innerHTML, /commercial\/prospects/);
  assert.equal(app.view.querySelectorAll('.comm-dashboard-kpi').length, 7);
  app.window.close();
});

test('dashboard Commercial : graphiques alimentés uniquement par des événements datés et donut depuis les compteurs backend', () => {
  const app = dashboardApp();
  app.T().renderCommDashboard(app.view);
  const chart = app.view.querySelector('.comm-chart-frame');
  assert.equal(chart.classList.contains('is-empty'), false, 'les événements datés créent des séries observables');
  assert.equal(chart.querySelectorAll('polyline').length, 3);
  assert.match(app.view.querySelector('.comm-status-donut').getAttribute('aria-label'), /7 éléments/);
  assert.equal(app.view.querySelectorAll('.comm-status-legend-row').length, 4);
  assert.match(app.view.querySelector('.comm-chart-legend-row').textContent, /Contrats démarrés/);
  app.window.close();
});

test('dashboard Commercial : filtre 12 mois, objectif non configuré et aucun pourcentage inventé', () => {
  const app = dashboardApp();
  app.T().renderCommDashboard(app.view);
  app.view.querySelector('.comm-dashboard-period select').focus();
  app.T().setCommDashboardRange(365);
  assert.equal(app.view.querySelector('.comm-dashboard-period select').value, '365');
  assert.equal(app.window.document.activeElement, app.view.querySelector('.comm-dashboard-period select'));
  assert.equal(app.view.querySelector('.comm-modern-head').classList.contains('module-page-header'), true);
  assert.equal(app.view.querySelector('.comm-dashboard-kpis').classList.contains('module-page-header-actions'), false);
  assert.match(app.view.querySelector('.comm-dashboard-objective').textContent, /Objectif mensuel non configuré/);
  assert.doesNotMatch(app.view.querySelector('.comm-dashboard-objective').textContent, /% de l’objectif/);
  assert.match(app.view.querySelector('.comm-dashboard-objective button').getAttribute('onclick'), /commercial\/stats/);
  app.window.close();
});

test('dashboard Commercial : événements sans dates = état vide, statistiques absentes restent indisponibles', () => {
  const app = dashboardApp();
  app.T().setDb({ prospects: [], clients: [], opportunites: [], visites: [], devis: [], settings: {} });
  app.window.SGDI_SIDEBAR_STATS = { scope: { active_society: SOCIETY }, generated_at: new Date().toISOString(), commercial: {}, facturation: {} };
  app.T().renderCommDashboard(app.view);
  assert.equal(app.view.querySelector('.comm-chart-frame').classList.contains('is-empty'), true);
  assert.match(app.view.querySelector('.comm-chart-empty').textContent, /Aucune activité datée/);
  assert.match(app.view.querySelector('.comm-dashboard-kpi.tone-cyan').textContent, /—/);
  assert.doesNotMatch(app.view.querySelector('.comm-status-legend').textContent, /Contrats actifs\s+0/);
  app.window.close();
});

test('dashboard Commercial : contrat à échéance vient de la fiche client et la finance garde son panneau réel', () => {
  const app = dashboardApp();
  app.T().renderCommDashboard(app.view);
  const contracts = app.view.querySelector('.comm-dashboard-contract-list');
  assert.match(contracts.textContent, /Client Alpha/);
  assert.match(contracts.textContent, /Prioritaire/);
  assert.doesNotMatch(contracts.textContent, /Client hors périmètre/);
  assert.match(app.view.querySelector('.comm-contract-finance').textContent, /15\u00a0600\u00a0539,72|15\s?600\s?539,72/);
  assert.match(app.view.querySelector('.comm-contract-finance').textContent, /0,00/);
  app.window.close();
});

test('dashboard Commercial : layout responsive prévoit les seuils bureau, tablette et téléphone', () => {
  const errors = [];
  csstree.parse(CSS, { onParseError: (error) => errors.push(error.message) });
  assert.deepEqual(errors, []);
  assert.match(CSS, /@media\s*\(max-width:\s*1250px\)/);
  assert.match(CSS, /@media\s*\(max-width:\s*900px\)/);
  assert.match(CSS, /@media\s*\(max-width:\s*620px\)/);
  assert.match(CSS, /\.comm-dashboard-kpis\{display:grid;grid-template-columns:repeat\(7/);
  assert.match(CSS, /\.comm-dashboard-summary\{display:grid;grid-template-columns:repeat\(4/);
});

test('dashboard Commercial : statistiques différées actualisent les compteurs sans recréer la période, le graphique ou la sidebar', () => {
  const app = dashboardApp(), { window: w, view } = app, t = app.T();
  const stats = w.SGDI_SIDEBAR_STATS;
  w.SGDI_SIDEBAR_STATS = null;
  w.history.replaceState(null, '', '#/commercial/dashboard');
  t.setCommDashboardRange(90);
  w.addEventListener('sgdi:sidebar-stats', t.refreshCommercialFinancePanel);
  const period = view.querySelector('.comm-dashboard-period select');
  const chart = view.querySelector('.comm-chart-frame');
  const dashboard = view.querySelector('.comm-modern-dashboard');
  const sidebar = w.document.getElementById('sidebar-nav');
  const sidebarBefore = sidebar.innerHTML;
  const sites = () => view.querySelector('.comm-dashboard-kpi.tone-cyan strong').textContent;
  assert.equal(sites(), '—');
  period.focus();
  view.scrollTop = 180;
  w.SGDI_SIDEBAR_STATS = stats;
  // Invoke the module listener directly to isolate its sidebar-preservation contract.
  t.refreshCommercialFinancePanel();
  assert.equal(sites(), '4');
  assert.match(view.querySelector('.comm-status-donut').getAttribute('aria-label'), /7 éléments/);
  assert.equal(view.querySelector('.comm-dashboard-period select'), period);
  assert.equal(period.value, '90');
  assert.equal(w.document.activeElement, period);
  assert.equal(view.querySelector('.comm-chart-frame'), chart);
  assert.equal(view.querySelector('.comm-modern-dashboard'), dashboard);
  assert.equal(view.scrollTop, 180);
  assert.equal(sidebar.innerHTML, sidebarBefore);

  const focused = view.querySelector('.comm-dashboard-kpi.tone-cyan');
  focused.focus();
  stats.commercial.sites_total = 7;
  stats.commercial.prospects = 5;
  stats.facturation.invoiced_ttc = 987;
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.equal(sites(), '7');
  assert.equal(w.document.activeElement, view.querySelector('.comm-dashboard-kpi.tone-cyan'));
  assert.equal(view.querySelector('.comm-dashboard-summary strong').textContent, '5');
  assert.match(view.querySelector('.comm-contract-finance').textContent, /987,00/);
  const unchanged = [...view.querySelectorAll('.comm-dashboard-kpis,.comm-status-content,.comm-dashboard-summary,.comm-contract-finance')];
  t.refreshCommercialFinancePanel();
  assert.deepEqual([...view.querySelectorAll('.comm-dashboard-kpis,.comm-status-content,.comm-dashboard-summary,.comm-contract-finance')], unchanged);
  assert.equal(view.scrollTop, 180);

  stats.commercial.sites_total = 500;
  w.history.replaceState(null, '', '#/commercial/clients');
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.equal(sites(), '7', 'une autre route ne reçoit pas le rafraîchissement du dashboard');
  w.history.replaceState(null, '', '#/commercial/dashboard');
  t.commercialModuleDestroy();
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.equal(sites(), '7', 'le handler est détaché lors de la destruction du module');
  w.close();
});

test('dashboard Commercial : une réponse de statistiques d’une autre société ne renseigne pas les KPI', () => {
  const app = dashboardApp(), { window: w, view } = app, t = app.T();
  w.history.replaceState(null, '', '#/commercial/dashboard');
  t.renderCommDashboard(view);
  w.SGDI_SIDEBAR_STATS = { scope: { active_society: 'AUTRE SOCIETE' }, commercial: { sites_total: 999, clients_active: 999, contracts_active: 999 }, facturation: { invoiced_ttc: 999 } };
  t.refreshCommercialFinancePanel();
  assert.equal(view.querySelector('.comm-dashboard-kpi.tone-cyan strong').textContent, '—');
  assert.equal(view.querySelector('.comm-dashboard-kpi.tone-green strong').textContent, '2');
  assert.doesNotMatch(view.textContent, /999/);
  w.close();
});

test('dashboard Commercial : les nouveaux prospects anciens ne sont pas présentés comme créés ce mois-ci', () => {
  const app = dashboardApp();
  app.T().getDb().prospects[0].createdAt = '2020-01-01';
  app.T().renderCommDashboard(app.view);
  const summary = app.view.querySelector('.comm-dashboard-summary button');
  assert.match(summary.textContent, /1 nouveau\(x\)/);
  assert.doesNotMatch(summary.textContent, /ce mois/);
  app.window.close();
});

test('dashboard Commercial : une cible réelle ne fabrique pas une progression à partir de la date de modification', () => {
  const app = dashboardApp();
  app.T().getDb().settings.commercialMonthlyTarget = 100000;
  app.T().renderCommDashboard(app.view);
  const objective = app.view.querySelector('.comm-dashboard-objective');
  assert.match(objective.textContent, /Cible mensuelle enregistrée/);
  assert.match(objective.textContent, /100\s?000,00/);
  assert.match(objective.textContent, /Progression indisponible/);
  assert.doesNotMatch(objective.textContent, /gagnés|%|200\s?000/);
  assert.equal(objective.querySelector('.comm-dashboard-progress'), null);
  app.window.close();
});

test('dashboard Commercial : dates impossibles exclues, intervalles réels et graduations entières distinctes', () => {
  const app = dashboardApp(), t = app.T();
  for (const invalid of ['2026-02-30', '2025-02-29', '2026-13-01', 'pas une date', '']) assert.equal(t.commDashboardDate(invalid), null);
  assert.equal(t.commDashboardDate('2024-02-29').toISOString().slice(0, 10), '2024-02-29');
  const dates = [dateOffset(-29), dateOffset(-25), dateOffset(-24), dateOffset(-1), today(), dateOffset(1), dateOffset(-30), '2026-02-30'];
  app.view.innerHTML = t.commDashboardTrendSvg([{ key: 'clients', label: 'Clients créés', rows: dates.map(date => ({ date })), getDate: row => row.date }], 30);
  const points = [...app.view.querySelectorAll('circle title')];
  assert.deepEqual(points.map(node => Number(node.textContent.split(' · ').at(-1))), [2, 1, 0, 0, 0, 2]);
  const ticks = [...app.view.querySelectorAll('svg > g > text')].map(node => Number(node.textContent));
  assert.deepEqual(ticks, [3, 2, 1, 0]);
  const lastInterval = app.view.querySelector('svg > text:last-of-type title').textContent;
  const format = value => new Date(value + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  assert.equal(lastInterval, `${format(dateOffset(-4))} – ${format(today())}`);
  t.renderCommDashboard(app.view);
  assert.equal(app.view.querySelectorAll('.comm-chart-legend-row').length, 1);
  assert.equal(app.view.querySelector('.comm-dashboard-legend'), null);
  app.window.close();
});

test('dashboard Commercial : les icônes SVG et les KPI survivent à la normalisation réelle du shell', () => {
  const app = dashboardApp(), t = app.T();
  t.renderCommDashboard(app.view);
  for (const range of [null, 365]) {
    if (range) t.setCommDashboardRange(range);
    t.normalizePageHeader(app.view);
    t.stripCryptogrammes(app.view);
    assert.equal(app.view.querySelector('.comm-modern-head').parentElement, app.view);
    assert.equal(app.view.querySelector('.comm-modern-head').classList.contains('module-page-header'), true);
    assert.equal(app.view.querySelector('.comm-modern-dashboard').classList.contains('module-page-header'), false);
    assert.equal(app.view.querySelector('.comm-dashboard-kpis').classList.contains('module-page-header-actions'), false);
    const icons = [...app.view.querySelectorAll('.comm-dashboard-kpi-icon,.comm-dashboard-summary-icon')];
    assert.equal(icons.length, 11);
    for (const icon of icons) {
      const svg = icon.querySelector('svg.comm-dashboard-icon');
      assert.ok(svg, 'chaque indicateur conserve son icône après le nettoyage des glyphes');
      assert.equal(svg.getAttribute('aria-hidden'), 'true');
      assert.equal(svg.getAttribute('focusable'), 'false');
      assert.ok(svg.querySelector('path,circle,rect'));
      assert.equal(icon.textContent, '');
    }
  }
  app.window.close();
});
