// OPS → Fiche technique site : refonte de présentation. Vrai sgdi-app.js + modules dans jsdom.
// Contrat : mêmes champs et mêmes actions qu'avant, compteurs issus des sources existantes
// (« — » plutôt qu'un zéro inventé), rotation non modifiée par l'affichage, contrôles de
// cohérence des postes avant enregistrement, une seule sauvegarde à la fois, droits inchangés.
// Mise en page, onglets et barre d'actions en Chrome réel : ops-site-fiche-technique-chrome.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const SOC = 'IRON GLOBAL SOLUTION';
const AGENT = (n, extra = {}) => ({ id: 'a' + n, backendId: n, matricule: 'KT0' + n, nom: 'AGENT', prenom: 'N' + n, statut: 'actif', societe: SOC, fonction: 'Agent',
  affectationCourante: { siteId: 's1', poste: 'Agent', dateDebut: '2026-09-18', groupe: 'A' }, ...extra });
const SITE = (extra = {}) => ({ id: 's1', backendId: 1, nom: 'SITE ALPHA', indicatif: 'ALPHA-1', codeOfficiel: 'ETP/DF/H01', societe: SOC, client: 'CLIENT NORD', actif: true,
  adresse: '12 rue des Essais', commune: 'Hydra', wilaya: 'Alger', dateOuverture: '2020-01-01', rotationSystem: '1/3', latitude: '36.75', longitude: '3.05',
  contact: { nom: 'Contact', fonction: 'Chef', telephone: '0550', email: 'c@example.com' },
  postes: { Superviseur: { jour: 1, nuit: 0, total: 2, rotationSystem: '' } }, effectifs: { totalContractuel: 2, groupes: 4, jour: 1, nuit: 0, weekend: 0, feries: 0 }, ...extra });

function boot(t, { session = {}, site = SITE(), agents = [] } = {}) {
  const r = loadSgdiApp(['emptyDB']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  r.dom.reconfigure({ url: 'http://localhost/#/sites/s1' });
  r.T().setDb({ ...r.T().emptyDB(), sites: [site], agents });
  r.T().setSession({ username: 'OPS-01', nom: 'Karim Test', role: 'ops', transverse: 'ops', societe: SOC, actionsAutorisees: ['read', 'create', 'update'], ...session });
  w.sgdiAuthToken = () => '';
  w.sgdiBackendShouldUse = () => false;
  const toasts = [];
  w.toast = (message, type) => toasts.push({ message, type });
  const view = w.document.getElementById('view');
  const render = async () => {
    await w.renderSiteForm(view, 's1');
    // Post-rendu normalement différé par sitesModuleTimeout (module initialisé par le routeur).
    w.updateSiteEffectifTotalContractuel(); w.applySiteFormLock(); w.siteTechInitNav();
    return view;
  };
  return { ...r, w, view, toasts, render };
}
const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const kpis = view => Object.fromEntries([...view.querySelectorAll('[data-stf-kpi]')].map(el => [el.dataset.stfKpi, text(el.querySelector('.stf-kpi-value'))]));

test('structure : en-tête, identité, 7 compteurs, 9 onglets, rubriques dans un seul formulaire', async t => {
  const ctx = boot(t, { agents: [AGENT(1)] });
  const view = await ctx.render();
  assert.equal(text(view.querySelector('.stf-title h1')), 'FICHE TECHNIQUE SITE');
  assert.equal([...view.querySelector('.stf-crumb').children].map(text).join(' '), 'OPS › Sites › SITE ALPHA › Fiche technique');
  assert.equal(text(view.querySelector('.stf-status')), 'Site actif');
  assert.deepEqual([...view.querySelectorAll('.stf-id-field dt')].map(text), ['Client', 'Dénomination', 'Société', 'Adresse', 'Commune', 'Wilaya', 'Type']);
  assert.equal(view.querySelector('.stf-identity img'), null, 'aucune photographie inventée');
  assert.deepEqual(kpis(view), { ouverture: '01/01/2020', indicatif: 'ALPHA-1', telephone: '—', contrat: '2', realise: '1', manque: '1', surplus: '0' });
  assert.deepEqual([...view.querySelectorAll('.stf-tab')].map(el => el.dataset.stfTab),
    ['identification', 'contact', 'effectifs', 'rotation', 'affectation', 'materiel', 'documents', 'consignes', 'procedures']);
  for (const tab of view.querySelectorAll('.stf-tab')) {
    const section = view.querySelector('#' + tab.getAttribute('aria-controls'));
    assert.ok(section && view.querySelector('#site-form').contains(section), 'rubrique dans le formulaire: ' + tab.dataset.stfTab);
  }
  // Tous les champs historiques sont conservés, avec leur nom.
  for (const name of ['nom', 'indicatif', 'codeOfficiel', 'adresse', 'commune', 'wilaya', 'type', 'dateOuverture', 'siteOuvertPar', 'telephone', 'latitude', 'longitude',
    'contact_nom', 'contact_fonction', 'contact_tel', 'contact_email', 'client', 'clientId', 'eff_totalContractuel', 'eff_groupes', 'eff_jour', 'eff_nuit', 'eff_weekend', 'eff_feries',
    'heureReleveJour', 'heureReleveNuit', 'rotationSystem', 'rotationPlanningFrom', 'rotationPlanningTo', 'rotationPlanningJson']) {
    assert.ok(view.querySelector(`#site-form [name="${name}"]`), 'champ ' + name);
  }
  // Chaque champ visible a un libellé associé.
  for (const el of view.querySelectorAll('#site-form :is(input,select,textarea):not([type=hidden]):not([type=radio])')) {
    const labelled = el.getAttribute('aria-label') || (el.id && view.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
    assert.ok(labelled, 'libellé manquant: ' + (el.name || el.outerHTML.slice(0, 80)));
  }
  assert.equal(view.querySelector('[name="codeOfficiel"]').value, 'ETP/DF/H01');
  assert.match(text(view.querySelector('#stf-f-code-hint')), /Distinct de l’indicatif radio/);
});

test('compteurs : « — » quand l\'effectif contractuel n\'est pas défini, jamais un zéro inventé', async t => {
  const ctx = boot(t, { site: SITE({ postes: {}, effectifs: {} }), agents: [AGENT(1)] });
  const view = await ctx.render();
  const k = kpis(view);
  assert.equal(k.contrat, '—');
  assert.equal(k.manque, '—');
  assert.equal(k.surplus, '—');
  assert.equal(k.realise, '1', 'les affectations réelles restent affichées');
  assert.ok(view.querySelector('.stf-empty--postes'), 'état vide de la liste des postes');
});

test('onglets : changer de rubrique ne re-rend rien et conserve les saisies', async t => {
  const ctx = boot(t);
  const view = await ctx.render();
  const form = view.querySelector('#site-form');
  view.querySelector('[name="siteOuvertPar"]').value = 'Brouillon';
  view.querySelector('[name="eff_weekend"]').value = '3';
  for (const key of ['effectifs', 'materiel', 'procedures', 'identification']) {
    ctx.w.siteTechGoTo(key);
    assert.equal(view.querySelector('.stf-tab[aria-current="true"]').dataset.stfTab, key);
    assert.equal(view.querySelector('#site-form'), form, 'même formulaire');
  }
  assert.equal(view.querySelector('[name="siteOuvertPar"]').value, 'Brouillon');
  assert.equal(view.querySelector('[name="eff_weekend"]').value, '3');
  assert.equal(ctx.w.location.hash, '#/sites/s1');
});

test('rotation : système enregistré affiché tel quel, règles mises à jour à la sélection, rien n\'est enregistré', async t => {
  const ctx = boot(t, { site: SITE({ rotationSystem: '1/3' }) });
  let persisted = 0;
  ctx.w.persistSiteToPostgres = async () => { persisted++; };
  const view = await ctx.render();
  assert.equal(view.querySelector('[name="rotationSystem"]:checked').value, '1/3');
  assert.ok(view.querySelector('[data-rotation-card="1/3"]').classList.contains('is-active'));
  assert.match(text(view.querySelector('#rotation-preview')), /Groupe B\s*Nuit 1 nuit sur 3/);
  const radio = view.querySelector('[name="rotationSystem"][value="1/2"]');
  // jsdom (outside-only) n'exécute pas les gestionnaires en ligne : on appelle celui du bouton radio.
  assert.match(radio.getAttribute('onchange'), /updateSiteRotationPreview\(this\.value\)/);
  radio.checked = true; ctx.w.updateSiteRotationPreview(radio.value);
  assert.ok(view.querySelector('[data-rotation-card="1/2"]').classList.contains('is-active'));
  assert.ok(!view.querySelector('[data-rotation-card="1/3"]').classList.contains('is-active'));
  assert.match(text(view.querySelector('#rotation-preview')), /un jour sur deux/);
  assert.equal(text(view.querySelector('[data-stf-planning-system]')), '1/2');
  assert.equal(persisted, 0, 'sélectionner une rotation ne sauvegarde rien');
  assert.equal(ctx.T().getDb().sites[0].rotationSystem, '1/3', 'site inchangé tant que non enregistré');
});

test('postes : ajout, calcul existant, retrait, et erreurs explicites avant enregistrement', async t => {
  const ctx = boot(t);
  let persisted = 0;
  ctx.w.persistSiteToPostgres = async () => { persisted++; };
  const view = await ctx.render();
  const body = view.querySelector('#site-postes-body');
  assert.equal(body.querySelectorAll('tr').length, 1);
  ctx.w.addSitePosteRow();
  const row = body.querySelectorAll('tr')[1];
  row.querySelector('[name="poste_nom"]').value = 'Superviseur';
  row.querySelector('[name="poste_jour"]').value = '2';
  ctx.w.updateSitePosteTotal(row);
  assert.equal(row.querySelector('[name="poste_total"]').value, '4', 'calcul existant (jour + nuit) × 2');
  assert.equal(view.querySelector('[name="eff_totalContractuel"]').value, '6');
  const errors = view.querySelector('#site-postes-errors');
  assert.equal(errors.hidden, false);
  assert.match(text(errors), /« Superviseur » apparaît deux fois/);
  await ctx.w.saveSite('s1');
  assert.equal(persisted, 0, 'aucun enregistrement avec un poste en double');
  assert.match(ctx.toasts.at(-1).message, /apparaît deux fois/);
  row.querySelector('[name="poste_nom"]').value = '';
  ctx.w.updateSitePosteTotal(row);
  assert.match(text(errors), /choisissez un poste/);
  const remove = row.querySelector('button');
  assert.match(remove.getAttribute('onclick'), /this\.closest\('tr'\)\.remove\(\);updateSiteEffectifTotalContractuel\(\)/);
  row.remove(); ctx.w.updateSiteEffectifTotalContractuel();
  assert.equal(body.querySelectorAll('tr').length, 1, 'retrait de ligne');
  assert.equal(errors.hidden, true);
  assert.equal(view.querySelector('[name="eff_totalContractuel"]').value, '2');
});

test('sauvegarde : un seul enregistrement à la fois (pas de dotation en double sur double clic)', async t => {
  const ctx = boot(t);
  let release, persisted = 0, dotations = 0;
  ctx.w.persistSiteToPostgres = () => { persisted++; return new Promise(resolve => { release = resolve; }); };
  ctx.w.persistSiteEquipmentDotations = async () => { dotations++; };
  ctx.w.sgdiFireAndForgetSave = () => {};
  ctx.w.sgdiServerSetPage = () => {};
  const view = await ctx.render();
  const buttons = [...view.querySelectorAll('[data-site-save-action]')];
  assert.deepEqual(buttons.map(text), ['Enregistrer modification', 'Enregistrer']);
  const first = ctx.w.saveSite('s1');
  const second = ctx.w.saveSite('s1');
  await second;
  assert.equal(persisted, 1);
  assert.match(ctx.toasts.at(-1).message, /déjà en cours/);
  assert.ok(buttons.every(b => b.disabled && b.getAttribute('aria-busy') === 'true'), 'boutons désactivés pendant l\'enregistrement');
  release();
  await first;
  assert.equal(dotations, 1);
  assert.ok(buttons.every(b => !b.disabled && !b.hasAttribute('aria-busy')));
  assert.ok(ctx.toasts.some(x => /Site enregistré et fiche verrouillée/.test(x.message)));
});

test('droits : barre d\'actions et rubriques selon le profil, comme avant la refonte', async t => {
  await t.test('OPS : PV, Enregistrer modification, Enregistrer', async t2 => {
    const view = await boot(t2).render();
    assert.deepEqual([...view.querySelectorAll('.stf-actionbar .ops-btn')].map(text), ['Établir un PV', 'Enregistrer modification', 'Enregistrer']);
    assert.equal(view.querySelector('.stf-actionbar [type="submit"]').textContent.trim(), 'Enregistrer');
    assert.deepEqual([...view.querySelectorAll('.stf-toolbar .ops-btn .ops-btn__label')].map(text), ['Ajouter effectif', 'Demandes', 'Événements', 'Retour']);
  });
  await t.test('superviseur en lecture seule : aucune action de modification, pas de Documents', async t2 => {
    const view = await boot(t2, { session: { role: 'SUPERVISEUR' } }).render();
    assert.deepEqual([...view.querySelectorAll('.stf-actionbar .ops-btn')].map(text), []);
    assert.equal(view.querySelector('.stf-tab[data-stf-tab="documents"]'), null);
    assert.equal(view.querySelector('#stf-sec-documents'), null);
    assert.equal(view.querySelector('#site-form').dataset.locked, '1');
    assert.ok(view.querySelector('[name="nom"]').disabled, 'champs verrouillés');
    assert.deepEqual([...view.querySelectorAll('.stf-toolbar .ops-btn__label')].map(text), ['Retour']);
  });
  await t.test('Matériel : pas de PV, enregistrement des équipements seul', async t2 => {
    const view = await boot(t2, { session: { role: 'materiel', transverse: 'materiel' } }).render();
    assert.deepEqual([...view.querySelectorAll('.stf-actionbar .ops-btn')].map(text), ['Enregistrer modification']);
    assert.match(view.querySelector('#stf-sec-materiel .stf-card-foot button').getAttribute('onclick'), /saveSiteEquipementOnly/);
  });
});

test('affectation : lecture seule, effectifs affectés et surplus selon la règle existante', async t => {
  const agents = [1, 2, 3].map(n => AGENT(n));
  const ctx = boot(t, { agents });
  ctx.w.opsLatestMovementForEmployee = a => (a.id === 'a3' ? { mouvementMotif: 'Renfort temporaire' } : null);
  const view = await ctx.render();
  const sec = view.querySelector('#stf-sec-affectation');
  assert.match(text(sec.querySelector('.stf-notice')), /Lecture seule — Les employés affichés ici viennent uniquement des ordres de mouvement validés/);
  const [main, surplus] = sec.querySelectorAll('.stf-subcard');
  assert.equal(main.querySelectorAll('tbody tr').length, 2, 'contrat 2 : deux lignes principales');
  assert.deepEqual([...main.querySelectorAll('thead th')].map(text), ['Employé', 'Matricule', 'Poste / fonction', "Date d'affectation", 'Groupe', 'Situation']);
  assert.equal(surplus.querySelectorAll('tbody tr').length, 1);
  assert.match(text(surplus), /AGENT N3 KT03 Agent 18\/09\/2026 Renfort temporaire Au-delà du contrat \(2\)/);
  assert.equal(sec.querySelector('input:not([type=search]),select'), null, 'aucune saisie d\'affectation');
  assert.match(sec.querySelector('.stf-notice button').getAttribute('onclick'), /navigate\('ops\/mouvements'\)/);
});

test('affectation : affichage progressif et recherche locale sur les longues listes', async t => {
  const agents = Array.from({ length: 40 }, (_, i) => AGENT(i + 1, { matricule: 'M' + String(i + 1).padStart(3, '0') }));
  const ctx = boot(t, { site: SITE({ effectifs: { totalContractuel: 40 } }), agents });
  const view = await ctx.render();
  const rows = () => [...view.querySelectorAll('#site-affectation-body tr')].filter(r => !r.hidden).length;
  assert.equal(rows(), 25);
  ctx.w.siteTechAffectShowMore();
  assert.equal(rows(), 40);
  ctx.w.siteTechAffectFilter('M007');
  assert.equal(rows(), 1);
  ctx.w.siteTechAffectFilter('');
  assert.equal(rows(), 40);
});

test('composant ops-button : badge seulement pour un compteur réel', t => {
  const r = loadSgdiApp(['opsButtonHTML']);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const html = (label, opts) => { const d = r.window.document.createElement('div'); d.innerHTML = r.window.opsButtonHTML(label, opts); return d.firstElementChild; };
  for (const badge of [0, -1, null, undefined, 'abc']) assert.equal(html('Pointage quotidien', { icon: 'calendar', badge }).querySelector('.ops-btn__badge'), null, String(badge));
  const withBadge = html('Pointage quotidien', { icon: 'calendar', badge: 3, badgeLabel: 'alertes' });
  assert.equal(withBadge.querySelector('.ops-btn__badge').textContent, '3');
  assert.match(withBadge.textContent, /\(3 alertes\)/, 'compteur annoncé aux lecteurs d\'écran');
  assert.equal(html('X', { badge: 250 }).querySelector('.ops-btn__badge').textContent, '99+');
  const danger = html('Supprimer', { variant: 'danger', size: 'sm', type: 'submit', attrs: 'data-x="1"' });
  assert.equal(danger.className, 'ops-btn ops-btn--danger ops-btn--sm');
  assert.equal(danger.type, 'submit');
  assert.equal(danger.dataset.x, '1');
  assert.equal(html('<b>', {}).querySelector('b'), null, 'libellé échappé');
});

test('boutons OPS : adaptateur de style confiné au portail OPS', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.css'), 'utf8');
  const lines = css.split('\n').filter(l => /\.btn:not\(\.ops-btn\)/.test(l));
  assert.ok(lines.length > 5);
  for (const line of lines) assert.match(line, /:has\(\.sgdi-ops-shell\)/, 'adaptateur limité à OPS: ' + line.slice(0, 90));
  const app = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8');
  assert.match(app, /const opsShell=\["ops","superviseur"\]\.includes\(session\.transverse\);/);
});
