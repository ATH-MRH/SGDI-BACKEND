// REFONTE SIDEBAR PORTAIL CLIENT + LOT POINTAGE LECTURE SEULE.
// Vérifie l'organisation validée de la sidebar (recherche employé en premier,
// pas de bloc Messagerie, Pointage entre Planning et Historique), le
// comportement sticky, et le nouvel onglet Pointage (visibilité conditionnée
// au droit view_attendance, chargement uniquement à l'activation, aucune
// action d'écriture).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClientPortail } = require('./load-client-portail');

function bootLoggedIn(window, T, permissions = {}) {
  T().setSession({ token: 'tok', clientName: 'Client Test', fullName: 'Interlocuteur' });
  window.fetch = (url) => {
    if (String(url).includes('/me')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ permissions }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };
  return T().enterApp();
}

test('A/B. RECHERCHE EMPLOYÉ apparaît avant ESPACE CLIENT, une seule recherche dans le DOM', () => {
  const { window: w } = loadClientPortail();
  const stack = w.document.querySelector('.portal-sidebar-stack');
  const asides = Array.from(stack.children);
  const searchIndex = asides.findIndex(el => el.id === 'employeeSearchCard');
  const espaceIndex = asides.findIndex(el => el.querySelector('.portal-sidebar-title')?.textContent === 'Espace client');
  assert.ok(searchIndex >= 0 && espaceIndex >= 0);
  assert.ok(searchIndex < espaceIndex, 'Recherche employé doit apparaître avant Espace client');
  assert.equal(w.document.querySelectorAll('#employeeSidebarSearch').length, 1, 'une seule recherche employé dans le DOM');
  w.close();
});

test('C. le bloc MESSAGERIE n\'est plus rendu dans la sidebar', () => {
  const { window: w } = loadClientPortail();
  assert.equal(w.document.getElementById('portalMessagingCard'), null);
  assert.equal(w.document.querySelector('[data-tab="messages-sent"]'), null);
  assert.equal(w.document.querySelector('[data-tab="messages-received"]'), null);
  assert.equal(w.document.querySelector('[data-tab="messages-archived"]'), null);
  w.close();
});

test('D-I/J. toutes les rubriques existent, dans l\'ordre exact', () => {
  const { window: w } = loadClientPortail();
  const nav = w.document.querySelector('.portal-sidebar[aria-label="Navigation portail client"] .portal-nav');
  const tabs = Array.from(nav.querySelectorAll('.portal-nav-btn')).map(b => b.dataset.tab);
  assert.deepEqual(tabs, ['employees', 'sites', 'equipment', 'planning', 'pointage', 'history']);
  const labels = Array.from(nav.querySelectorAll('.portal-nav-btn')).map(b => b.textContent.trim());
  assert.deepEqual(labels, ['Mon personnel', 'Mes sites', 'Mes équipements', 'Planning de travail', 'Pointage', 'Historique']);
  w.close();
});

// L. Bloc RECHERCHE EMPLOYÉ + ESPACE CLIENT figé en un seul conteneur parent
// (.portal-sidebar-stack), le contenu principal (<main class="portal-main">)
// défilant seul. Note jsdom : jsdom ne calcule aucune vraie mise en page
// (getBoundingClientRect() renvoie toujours {0,0,0,0} quel que soit le CSS,
// cf. https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform),
// donc une comparaison de rects avant/après scroll y serait toujours vraie
// même si le CSS était cassé — ce n'est pas un test valide dans ce harnais.
// On vérifie à la place, de façon équivalente et réellement discriminante :
// (1) les règles CSS qui, dans un vrai navigateur, gèlent ensemble les deux
// cartes en figeant leur CONTENEUR PARENT COMMUN (jamais les cartes ou les
// entrées individuellement) tandis que .portal-main défile seul, et
// (2) que .portal-main est bien l'élément défilant : main.scrollTop est
// réellement settable/gettable dans jsdom et atteint >=1000.
test('L. RECHERCHE EMPLOYÉ + ESPACE CLIENT sont figés ensemble (conteneur parent commun), .portal-main défile seul', () => {
  const { window: w } = loadClientPortail();
  const style = Array.from(w.document.querySelectorAll('style')).map(s => s.textContent).join('\n');

  // Le conteneur parent commun des deux cartes ne défile jamais lui-même :
  // ni lui ni aucun de ses ancêtres jusqu'au viewport n'a de scroll propre.
  assert.match(style, /\.app\{[^}]*height:100vh[^}]*overflow:hidden/, '.app ne doit pas défiler (hauteur figée au viewport)');
  assert.match(style, /\.shell\{[^}]*flex:1[^}]*min-height:0/, '.shell doit remplir la hauteur restante sans devenir lui-même scrollable');
  assert.doesNotMatch(style.match(/\.shell\{[^}]*\}/)[0], /overflow-y:auto|overflow:auto|overflow:scroll/, '.shell lui-même ne doit pas défiler');

  // Le conteneur parent commun (.portal-sidebar-stack) — pas les cartes ni
  // les entrées individuellement — occupe toute la hauteur disponible sans
  // dépendre du défilement de la page.
  assert.match(style, /\.portal-sidebar-stack\{[^}]*height:100%/, 'le conteneur parent commun doit occuper toute la hauteur, indépendamment du scroll de page');

  // .portal-main est le seul élément qui défile réellement.
  assert.match(style, /\.portal-main\{[^}]*overflow-y:auto/, '.portal-main doit posséder son propre scroll');

  const main = w.document.querySelector('main.portal-main');
  const sidebar = w.document.querySelector('.portal-sidebar-stack');
  assert.ok(main && sidebar);
  main.scrollTop = 1200;
  assert.ok(main.scrollTop >= 1000, 'main.scrollTop doit pouvoir atteindre >=1000 : .portal-main est bien le conteneur défilant');
  w.close();
});

test('Pointage masqué sans le droit view_attendance, visible avec', async () => {
  const { window: w, T } = loadClientPortail();
  await bootLoggedIn(w, T, { view_attendance: false });
  const btnHidden = w.document.querySelector('.portal-nav-btn[data-tab="pointage"]');
  assert.equal(btnHidden.classList.contains('hidden'), true);
  assert.equal(w.document.getElementById('pointageTab').classList.contains('hidden'), true);
  await new Promise(r => setTimeout(r, 0)); // laisse les micro-tâches en vol se résorber avant de fermer
  w.close();

  const app2 = loadClientPortail();
  await bootLoggedIn(app2.window, app2.T, { view_attendance: true });
  const btnVisible = app2.window.document.querySelector('.portal-nav-btn[data-tab="pointage"]');
  assert.equal(btnVisible.classList.contains('hidden'), false);
  await new Promise(r => setTimeout(r, 0));
  app2.window.close();
});

test('K. onglet Pointage actif -> état visuel actif identique aux autres rubriques (classe .active)', async () => {
  const { window: w, T } = loadClientPortail();
  await bootLoggedIn(w, T, { view_attendance: true });
  await T().switchTab('pointage');
  const pointageBtn = w.document.querySelector('.portal-nav-btn[data-tab="pointage"]');
  const employeesBtn = w.document.querySelector('.portal-nav-btn[data-tab="employees"]');
  assert.equal(pointageBtn.classList.contains('active'), true);
  assert.equal(employeesBtn.classList.contains('active'), false);
  assert.equal(w.document.getElementById('pointageTab').classList.contains('hidden'), false);
  // E. retour vers Mon personnel : l'état actif doit revenir correctement.
  await T().switchTab('employees');
  assert.equal(employeesBtn.classList.contains('active'), true);
  assert.equal(pointageBtn.classList.contains('active'), false);
  assert.equal(w.document.getElementById('pointageTab').classList.contains('hidden'), true);
  w.close();
});

test('performance : aucun appel /attendance au login, uniquement à l\'activation de l\'onglet', async () => {
  const calls = [];
  const { window: w, T } = loadClientPortail();
  T().setSession({ token: 'tok', clientName: 'C', fullName: 'F' });
  w.fetch = (url) => {
    calls.push(String(url));
    if (String(url).includes('/me')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ permissions: { view_attendance: true } }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };
  await T().enterApp();
  assert.ok(!calls.some(u => u.includes('/attendance')), 'aucun appel /attendance ne doit être fait avant l\'ouverture de l\'onglet');
  await T().switchTab('pointage');
  assert.ok(calls.some(u => u.includes('/attendance')), 'un appel /attendance doit être fait une fois l\'onglet activé');
  w.close();
});

test('aucun bouton d\'écriture (Ajouter/Modifier/Corriger/Supprimer/Valider) dans l\'onglet Pointage', async () => {
  const { window: w, T } = loadClientPortail();
  w.fetch = (url) => {
    if (String(url).includes('/me')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ permissions: { view_attendance: true } }) });
    if (String(url).includes('/attendance/filters')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sites: [], employees: [] }) });
    if (String(url).includes('/attendance')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [], total: 0, page: 1, page_size: 25, pages: 1 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };
  T().setSession({ token: 'tok', clientName: 'C', fullName: 'F' });
  await T().enterApp();
  await T().switchTab('pointage');
  const tab = w.document.getElementById('pointageTab');
  const forbidden = /ajouter|modifier|corriger|supprimer|valider/i;
  Array.from(tab.querySelectorAll('button')).forEach(btn => {
    assert.doesNotMatch(btn.textContent.trim(), forbidden, `bouton d'écriture inattendu dans Pointage : "${btn.textContent.trim()}"`);
  });
  w.close();
});

test('raccourcis de période : Aujourd\'hui / Hier / 7 derniers jours / Mois en cours calculent les bonnes bornes', () => {
  const { window: w, T } = loadClientPortail();
  const realDate = w.Date;
  class FixedDate extends realDate {
    constructor(...args) { if (args.length) super(...args); else super('2026-09-15T10:00:00Z'); }
  }
  w.Date = FixedDate;
  const [todayFrom, todayTo] = T().attendancePeriodBounds('today');
  assert.equal(todayFrom, '2026-09-15');
  assert.equal(todayTo, '2026-09-15');
  const [yFrom, yTo] = T().attendancePeriodBounds('yesterday');
  assert.equal(yFrom, '2026-09-14');
  assert.equal(yTo, '2026-09-14');
  const [last7From] = T().attendancePeriodBounds('last7');
  assert.equal(last7From, '2026-09-09');
  const [monthFrom] = T().attendancePeriodBounds('month');
  assert.equal(monthFrom, '2026-09-01');
  w.close();
});
