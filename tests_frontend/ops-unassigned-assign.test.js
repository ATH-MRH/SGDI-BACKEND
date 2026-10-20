// OPS → Effectif sans affectation : bouton « Affecter » → ordre de mouvement de l'employé →
// validation serveur (OM + affectation en une transaction). Vraies fonctions de sgdi-app.js et
// des modules dans jsdom ; seul l'appel réseau est remplacé. Données fictives uniquement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const SOC = 'IRON GLOBAL SOLUTION';
const NAMES = ['emptyDB', 'today', 'renderOperationalPreparation', 'applyAssignmentsToEmployees', 'agentHasLiveAffectation'];
const OPS = { username: 'ops-test', nom: 'Test', role: 'ops', transverse: 'ops', societe: SOC, actionsAutorisees: [] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function agent(id, overrides = {}) {
  return { id: `agt-${id}`, backendId: 100 + id, nom: `TESTEUR ${id}`, prenom: `Prenom${id}`, matricule: `TS${id}`,
    societe: SOC, statut: 'actif', fonction: 'AGENT TEST', contratPersonnelId: `ctr-${id}`, affectationCourante: {}, ...overrides };
}

function boot(t, { session = OPS, agents, assignments = [], hash = '#/effectif/preparation_affectation' } = {}) {
  const app = loadSgdiApp(NAMES, { url: 'https://ops.irongs.com/' });
  assert.ifError(app.loadError);
  // Les finitions d'écran (observateurs de l'habillage OPS, minuteurs de 30 à 150 ms) doivent
  // passer avant la fermeture de la fenêtre, sinon elles s'exécutent sur un document détruit.
  t.after(async () => { await new Promise(resolve => setTimeout(resolve, 300)); app.window.close(); });
  const T = app.T(), w = app.window;
  const db = T.emptyDB();
  db.agents = agents || [agent(1), agent(2, { affectationCourante: { siteId: 'st-a', siteName: 'SITE A' } }), agent(3, { statut: 'suspendu' })];
  db.sites = [
    { id: 'st-a', backendId: 11, nom: 'SITE A', actif: true, societe: SOC },
    { id: 'st-b', backendId: 12, nom: 'SITE B', actif: true, societe: SOC },
    { id: 'st-off', backendId: 13, nom: 'SITE FERME', actif: false, societe: SOC },
    { id: 'st-x', backendId: 14, nom: 'SITE AUTRE SOCIETE', actif: true, societe: 'AUTRE SOCIETE TEST' },
  ];
  db.assignments = assignments;
  T.setDb(db); T.setSession(session); T.setFullDataReady(true);
  w.history.replaceState(null, '', hash);
  const toasts = [], navigations = [], calls = [];
  w.toast = (message, kind) => toasts.push({ message, kind });
  w.navigate = route => navigations.push(route);
  w.hydrateEmployeePhotos = () => {};
  w.sgdiRefreshCountersNow = () => {};
  w.opsArchiveMovementDocument = () => Promise.resolve(true);
  w.open = () => null;
  w.sessionStorage.clear();
  return { app, T, w, db, toasts, navigations, calls, view: w.document.getElementById('view') };
}

function renderList(ctx) {
  ctx.T.renderOperationalPreparation(ctx.view, 'preparation_affectation');
  return ctx.view;
}

function openEditor(ctx, id = 'agt-1') {
  ctx.w.sessionStorage.setItem('opsMovementAgentId', id);
  ctx.w.sessionStorage.setItem('opsMovementSelectedAgent', id);
  ctx.w.sessionStorage.setItem('opsMovementInitialAgent', id);
  ctx.w.history.replaceState(null, '', '#/ops/mouvements');
  ctx.w._renderOpsMouvementsHTML(ctx.view);
  return ctx.view.querySelector('form[data-ops-movement-form]');
}

function stubServer(ctx, respond) {
  ctx.w.SGDI.movements.initialAssignment = async payload => {
    ctx.calls.push(payload);
    return respond(payload);
  };
}

function success(payload) {
  return {
    status: 'success', effective_today: payload.effective_date <= new Date().toISOString().slice(0, 10),
    line: { id: `fpq_${payload.effective_date}_${payload.agent_ref}`, date: payload.effective_date, agentId: payload.agent_ref },
    movement: { id: `fpq_${payload.effective_date}_${payload.agent_ref}`, backendId: 501, date: payload.effective_date,
      agentId: payload.agent_ref, agentBackendId: payload.employee_id, ordreMouvementNumero: 'OD/OPS/2026/0042',
      siteId: payload.site_ref, siteBackendId: payload.site_id, siteName: 'SITE B', mouvementMotif: payload.motif,
      mouvementDuree: payload.duree, groupe: payload.group_code, positionActuelle: 'Sans affectation', validatedBy: 'ops-test' },
    assignment: { id: 901, employee_id: payload.employee_id, site_id: payload.site_id, group_code: payload.group_code || 'A',
      position: 'AGENT TEST', start_date: payload.effective_date, end_date: null, active: 1, change_reason: 'Affectation · OM OD/OPS/2026/0042' },
  };
}

function fill(form, { site = 'st-b', group = 'B', date } = {}) {
  form.querySelector('[name="siteId"]').value = site;
  form.querySelector('[name="groupe"]').value = group;
  if (date) form.querySelector('[name="date"]').value = date;
}

test('liste : colonne Action et bouton « Affecter » sur chaque employé sans affectation', t => {
  const ctx = boot(t);
  const view = renderList(ctx);
  assert.deepEqual([...view.querySelectorAll('thead th')].map(th => th.textContent.trim()),
    ['Employé', 'Société', 'Poste', 'Site', 'Statut', 'Blocage', 'Action']);
  const button = view.querySelector('button[data-assign-employee="agt-1"]');
  assert.ok(button, 'bouton présent pour le non-affecté');
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('aria-label'), 'Affecter TESTEUR 1 Prenom1');
  assert.equal(button.disabled, false);
  assert.match(button.className, /ops-assign-btn/);
  assert.match(button.className, /primary/, 'bleu ATLAS (variante primaire), jamais vert');
  assert.equal(view.querySelector('button[data-assign-employee="agt-2"]'), null, 'employé affecté : ni ligne ni bouton');
  const suspended = view.querySelector('button[data-assign-employee="agt-3"]');
  assert.ok(suspended && suspended.disabled, 'statut bloquant : bouton désactivé');
  assert.match(suspended.title, /SUSPENDU/);
});

test('liste : employé avec affectation planifiée (date future) → « Planifiée », désactivé', t => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const ctx = boot(t, { assignments: [{ id: '77', backendId: 77, agentId: 'agt-1', agentBackendId: 101, siteId: 'st-b', active: true, dateDebut: future }] });
  ctx.T.applyAssignmentsToEmployees();
  assert.equal(ctx.T.agentHasLiveAffectation(ctx.db.agents[0]), false, 'pas affecté avant la date d\'effet');
  const button = renderList(ctx).querySelector('button[data-assign-employee="agt-1"]');
  assert.ok(button.disabled);
  assert.equal(button.textContent.trim(), 'Planifiée');
  assert.match(button.title, /planifiée/i);
});

test('liste : aucun bouton en lecture seule (superviseur, actions sans création, contexte DRH)', t => {
  for (const session of [
    { ...OPS, transverse: 'superviseur', role: 'dispatch' },
    { ...OPS, actionsAutorisees: ['read'] },
    { ...OPS, transverse: 'drh', role: 'rh' },
  ]) {
    const ctx = boot(t, { session });
    const view = renderList(ctx);
    assert.equal(view.querySelectorAll('[data-assign-employee]').length, 0, JSON.stringify(session));
    assert.ok(![...view.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Action'));
  }
});

test('clic : présélection de l\'employé et ouverture de l\'ordre de mouvement', t => {
  const ctx = boot(t);
  // jsdom (outside-only) n'exécute pas les gestionnaires en ligne : on vérifie l'attribut puis
  // on appelle la fonction qu'il désigne.
  const button = renderList(ctx).querySelector('button[data-assign-employee="agt-1"]');
  assert.equal(button.getAttribute('onclick'), "opsAssignUnassignedEmployee('agt-1')");
  ctx.w.opsAssignUnassignedEmployee('agt-1');
  assert.deepEqual(ctx.navigations, ['ops/mouvements']);
  assert.equal(ctx.w.sessionStorage.getItem('opsMovementAgentId'), 'agt-1');
  assert.equal(ctx.w.sessionStorage.getItem('opsMovementInitialAgent'), 'agt-1');
});

test('éditeur : même formulaire OM, limité à l\'employé, origine « Sans affectation »', t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  assert.equal(ctx.view.querySelectorAll('form[data-ops-movement-form]').length, 1, 'aucun doublon de formulaire');
  assert.equal(form.dataset.opsInitialAssignment, 'agt-1');
  const boxes = [...form.querySelectorAll('.ops-mvt-agent-cb')];
  assert.deepEqual(boxes.map(b => [b.value, b.checked]), [['agt-1', true]], 'seul cet employé est coché');
  const summary = form.querySelector('[data-ops-mvt-initial]').textContent;
  for (const text of ['TESTEUR 1 Prenom1', 'TS1', 'Sans affectation', SOC, 'AGENT TEST']) assert.ok(summary.includes(text), text);
  assert.equal(form.querySelector('[name="positionActuelle"]').value, 'Sans affectation');
  assert.match(form.querySelector('[name="ordreMouvementNumero"]').value, /^OD\/OPS\/\d{4}\/\d{4}$/);
  const sites = [...form.querySelectorAll('[name="siteId"] option')].map(o => o.value).filter(Boolean);
  assert.deepEqual(sites, ['st-a', 'st-b'], 'sites actifs de la société, sans « Autres »');
  const motifs = [...form.querySelectorAll('[name="mouvementMotif"] option')].map(o => o.value);
  assert.equal(form.querySelector('[name="mouvementMotif"]').value, 'Affectation', 'motif par défaut');
  assert.ok(!motifs.some(m => /Remplacement (Absence|Malade|Abandon)/.test(m)));
  const date = form.querySelector('[name="date"]');
  assert.equal(date.type, 'date');
  assert.equal(date.value, ctx.T.today());
  assert.equal(date.min, ctx.T.today());
  assert.deepEqual([...form.querySelectorAll('button')].map(b => b.textContent.trim()), ['Annuler', 'Valider OM', 'Valider & Imprimer']);
  // Saisie demandée explicitement : champs hors verrou de consultation.
  for (const name of ['siteId', 'date', 'mouvementMotif', 'mouvementDuree', 'groupe', 'mouvementObs']) assert.ok(form.querySelector(`[name="${name}"]`).hasAttribute('data-no-lock'), name);
});

test('éditeur : sans le raccourci, l\'éditeur habituel est inchangé (multi-sélection, Editer OM)', t => {
  const ctx = boot(t);
  ctx.w.sessionStorage.setItem('opsMovementAgentId', 'agt-1');
  ctx.w.history.replaceState(null, '', '#/ops/mouvements');
  ctx.w._renderOpsMouvementsHTML(ctx.view);
  const form = ctx.view.querySelector('form[data-ops-movement-form]');
  assert.equal(form.dataset.opsInitialAssignment, undefined);
  assert.ok(form.querySelectorAll('.ops-mvt-agent-cb').length >= 2);
  assert.deepEqual([...form.querySelectorAll('.flex.gap-2.justify-end button')].map(b => b.textContent.trim()), ['Editer OM', 'Valider OM', 'Imprimer OM']);
  assert.ok([...form.querySelectorAll('[name="siteId"] option')].some(o => o.value === 'autres'));
});

test('validation : OM + affectation créés par le serveur, liste et compteurs mis à jour', async t => {
  const ctx = boot(t);
  const before = renderList(ctx).textContent;
  assert.match(before, /TESTEUR 1/);
  const form = openEditor(ctx);
  fill(form);
  stubServer(ctx, success);
  const ok = await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false);
  assert.equal(ok, true);
  assert.equal(ctx.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls[0])), { employee_id: 101, site_id: 12, effective_date: ctx.T.today(), agent_ref: 'agt-1',
    movement_number: ctx.calls[0].movement_number, group_code: 'B', motif: 'Affectation', duree: 'Provisoire', observation: '', site_ref: 'st-b' });
  const done = ctx.view.querySelector('[data-ops-initial-done]');
  assert.ok(done, 'confirmation affichée');
  assert.match(done.textContent, /Ordre de mouvement validé/);
  assert.match(done.textContent, /OD\/OPS\/2026\/0042/);
  assert.deepEqual([...done.querySelectorAll('button')].map(b => b.textContent.trim()), ["Voir l'ordre", 'Imprimer', 'Retour à Sans affectation']);
  assert.equal(ctx.view.querySelectorAll('form[data-ops-movement-form]').length, 0);
  const a = ctx.db.agents[0];
  assert.equal(ctx.T.agentHasLiveAffectation(a), true);
  assert.equal(a.affectationCourante.siteBackendId, 12);
  assert.ok(ctx.db.opsMouvements.some(m => m.ordreMouvementNumero === 'OD/OPS/2026/0042'), 'OM dans l\'historique');
  assert.equal(ctx.w.sessionStorage.getItem('opsMovementInitialAgent'), null);
  ctx.w.history.replaceState(null, '', '#/effectif/preparation_affectation');
  const after = renderList(ctx);
  assert.doesNotMatch(after.textContent, /TESTEUR 1 /, 'retiré de Sans affectation');
  assert.equal(after.querySelector('[data-assign-employee="agt-1"]'), null);
  // Historique : l'ordre est consultable.
  let opened = null;
  ctx.w.open = () => (opened = { document: { write() {}, close() {} } });
  assert.equal(done.querySelector('button').getAttribute('onclick'), "opsOpenMovementDocumentByRow('501')");
  ctx.w.opsOpenMovementDocumentByRow('501');
  assert.ok(opened, 'Voir l\'ordre ouvre le document');
});

test('compteur « Sans affectation » décrémenté après validation', async t => {
  const ctx = boot(t, { agents: [agent(1), agent(4)] });
  const count = () => [...renderList(ctx).querySelectorAll('button.card')].find(b => /Sans Affectation/i.test(b.textContent)).textContent.replace(/\D+/g, '');
  assert.equal(count(), '2');
  const form = openEditor(ctx);
  fill(form);
  stubServer(ctx, success);
  await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false);
  ctx.w.history.replaceState(null, '', '#/effectif/preparation_affectation');
  assert.equal(count(), '1');
});

test('double clic : une seule demande au serveur', async t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  fill(form);
  let release;
  stubServer(ctx, payload => new Promise(resolve => { release = () => resolve(success(payload)); }));
  const button = form.querySelector('[data-om-submit]');
  const first = ctx.w.opsValiderAffectationInitiale(button, false);
  const second = await ctx.w.opsValiderAffectationInitiale(button, false);
  assert.equal(second, false);
  assert.ok([...form.querySelectorAll('button')].every(b => b.disabled), 'boutons désactivés pendant la validation');
  release();
  assert.equal(await first, true);
  assert.equal(ctx.calls.length, 1);
});

test('employé affecté entre-temps (409) : refus propre, rien n\'est affecté localement', async t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  fill(form);
  stubServer(ctx, () => { const e = new Error('Cet employé possède déjà une affectation active. Actualisez la liste.'); e.status = 409; throw e; });
  const ok = await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false);
  assert.equal(ok, false);
  assert.deepEqual(ctx.toasts.at(-1), { message: 'Cet employé possède déjà une affectation active. Actualisez la liste.', kind: 'error' });
  assert.equal(ctx.T.agentHasLiveAffectation(ctx.db.agents[0]), false);
  assert.ok(!(ctx.db.opsMouvements || []).length, 'aucun OM local fantôme');
  assert.ok(ctx.view.querySelector('form[data-ops-initial-assignment]'));
  assert.ok([...form.querySelectorAll('button')].every(b => !b.disabled), 'formulaire de nouveau utilisable');
});

test('date d\'effet future : OM validé, employé toujours sans affectation aujourd\'hui', async t => {
  const ctx = boot(t);
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const form = openEditor(ctx);
  fill(form, { date: future });
  stubServer(ctx, success);
  assert.equal(await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false), true);
  assert.equal(ctx.calls[0].effective_date, future);
  assert.match(ctx.view.querySelector('[data-ops-initial-done]').textContent, /planifiée/);
  assert.equal(ctx.T.agentHasLiveAffectation(ctx.db.agents[0]), false);
  ctx.w.history.replaceState(null, '', '#/effectif/preparation_affectation');
  const button = renderList(ctx).querySelector('[data-assign-employee="agt-1"]');
  assert.ok(button && button.disabled && button.textContent.trim() === 'Planifiée');
});

test('contrôles avant envoi : site obligatoire, date passée refusée', async t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  stubServer(ctx, success);
  assert.equal(await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false), false);
  fill(form, { date: '2000-01-01' });
  assert.equal(await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false), false);
  assert.equal(ctx.calls.length, 0);
});

test('annuler / Échap : rien n\'est créé, retour à la liste', t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  stubServer(ctx, success);
  assert.match(form.getAttribute('onkeydown'), /event\.key==='Escape'.*opsCancelInitialMovement\(\)/);
  assert.equal(form.querySelector('button').getAttribute('onclick'), 'opsCancelInitialMovement()');
  ctx.w.opsCancelInitialMovement();
  assert.deepEqual(ctx.navigations, ['effectif/preparation_affectation']);
  assert.equal(ctx.calls.length, 0);
  assert.equal(ctx.w.sessionStorage.getItem('opsMovementInitialAgent'), null);
});

test('superviseur lecture seule : aucune validation possible', async t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  fill(form);
  stubServer(ctx, success);
  ctx.T.setSession({ ...OPS, transverse: 'superviseur', role: 'dispatch' });
  assert.equal(await ctx.w.opsValiderAffectationInitiale(form.querySelector('[data-om-submit]'), false), false);
  assert.equal(ctx.calls.length, 0);
});

test('Valider & Imprimer : la fenêtre est ouverte au clic puis remplie avec l\'OM validé', async t => {
  const ctx = boot(t);
  const form = openEditor(ctx);
  fill(form);
  const written = [];
  const win = { document: { write: html => written.push(html), close() {} }, close() { written.push('closed'); } };
  ctx.w.open = () => win;
  stubServer(ctx, success);
  assert.equal(await ctx.w.opsValiderAffectationInitiale(form.querySelectorAll('[data-om-submit]')[1], true), true);
  assert.equal(written.length, 1);
  assert.match(written[0], /ORDRE DE MOUVEMENT/);
  assert.match(written[0], /Sans affectation/);
  assert.match(written[0], /OD\/OPS\/2026\/0042/);
  await tick();
});
