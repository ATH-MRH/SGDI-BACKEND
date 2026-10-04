// Also executed by the backend/static pytest check. Only Node built-ins are
// required: that CI job does not install the frontend's jsdom dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app/static/recrute.html'), 'utf8');
const application = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('const SESSION_KEY='));
assert.ok(application, 'The standalone recruitment application must be available');

function setup({ opinion = 'Favorable', tab = 'new', actions = ['read', 'create', 'update'], access = true, society = 'IRON GLOBAL SÉCURITÉ', ventilation = false, data = {} } = {}) {
  const elements = new Map();
  const context = {
    sessionStorage: { getItem: () => null },
    document: {
      addEventListener() {},
      getElementById: id => elements.get(id) || null,
      createElement: () => ({
        innerHTML: '', addEventListener() {},
        remove() { elements.delete(this.id); },
      }),
      body: { appendChild: element => elements.set(element.id, element) },
    },
  };
  vm.createContext(context);
  vm.runInContext(application, context);
  // Replace only browser/network boundaries, retaining the real renderers,
  // permission function, modal handler and transmission handler.
  context.esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  context.options = { opinion, tab, actions, access, society, ventilation, data };
  vm.runInContext(`
    recruteSession={user:{recruitment_access:options.access,recruitment_ventilation:options.ventilation,authorized_actions:options.actions,authorized_societies:['IRON GLOBAL SÉCURITÉ']}};
    activeTab=options.tab;
    activeSociety='IRON GLOBAL SÉCURITÉ';
    tabState[activeTab].items=[{id:42,last_name:'Fixture',first_name:'Test',desired_position:'Agent',society:options.society,data:{avisDecision:options.opinion,notes:'Dossier conservé',...options.data}}];
  `, context);
  const item = vm.runInContext('tabState[activeTab].items[0]', context);
  return { context, item, elements };
}

function recruitButtons(markup) {
  return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, , text]) => text.replace(/<[^>]*>/g, '').trim() === 'Recruter')
    .map(([, attributes]) => ({
      classes: attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [],
      action: attributes.match(/\bonclick="([^"]*)"/)?.[1],
    }));
}

test('Favorable candidate: direct green recruitment action opens the existing transmission form', () => {
  for (const tab of ['new', 'reserve']) {
    const { context, item, elements } = setup({ tab });
    const buttons = recruitButtons(context.rowActions(item));
    assert.equal(buttons.length, 1, tab);
    assert.ok(buttons[0].classes.includes('row-recruit'), 'The direct action keeps its green button style');
    assert.equal(buttons[0].action, 'openCandidateRecruitment(42)');
    const menuAction = context.rowActionItems(item).find(action => action.label === 'Recruter');
    assert.equal(menuAction?.onclick, buttons[0].action, 'Direct action and menu use the same handler');
    vm.runInContext(buttons[0].action, context);
    const modal = elements.get('recruitmentModal');
    assert.ok(modal, 'Clicking the rendered action opens the actual modal');
    // V7 : la société destinataire vient de la ventilation, elle n'est plus choisie ici.
    assert.doesNotMatch(modal.innerHTML, /<select/);
    assert.match(modal.innerHTML, /Société destinataire : <b>IRON GLOBAL SÉCURITÉ<\/b>/);
    assert.match(modal.innerHTML, /Recruter et transférer à la DRH/);
    assert.match(modal.innerHTML, /transmitCandidateToDrh\(this\)/);
    assert.match(modal.innerHTML, /Aucun employé ni contrat ne sera créé avant validation par la DRH/);
  }
  assert.match(html, /\.row-recruit\s*\{[^}]*background\s*:\s*#15803d\b/);
});

test('Non-favorable and closed candidate groups expose no direct or menu recruitment action', () => {
  for (const options of [
    { opinion: '' }, { opinion: 'Défavorable' }, { opinion: 'Instance' },
    { tab: 'archive' },
  ]) {
    const { context, item } = setup(options);
    assert.equal(recruitButtons(context.rowActions(item)).length, 0, JSON.stringify(options));
    assert.equal(context.rowActionItems(item).some(action => action.label === 'Recruter'), false);
  }
});

test('Favorable action keeps V5 permission gates, including deny by default', () => {
  for (const options of [
    { actions: ['read'] }, { actions: ['read', 'update'] },
    { actions: ['read', 'create'] }, { actions: [] }, { access: false },
  ]) {
    const { context, item } = setup(options);
    assert.equal(recruitButtons(context.rowActions(item)).length, 0, JSON.stringify(options));
    assert.equal(context.rowActionItems(item).some(action => action.label === 'Recruter'), false);
  }
  const { context, item } = setup({ actions: ['admin'] });
  assert.equal(recruitButtons(context.rowActions(item)).length, 1);
});

test('Rendered favorable action transfers the ventilated dossier to DRH in one atomic call', async () => {
  const { context, item, elements } = setup();
  vm.runInContext(recruitButtons(context.rowActions(item))[0].action, context);
  assert.ok(elements.has('recruitmentModal'));
  const calls = [], reloaded = [], banners = [];
  context.apiFetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return {};
  };
  context.loadTab = async tab => { reloaded.push(tab); };
  context.showBanner = (...args) => { banners.push(args); };
  const button = { disabled: false, textContent: '' };
  await context.transmitCandidateToDrh({ querySelector: () => button });
  // Un seul appel, sans société ni données : le serveur transfère le dossier tel qu'il est ventilé.
  assert.deepEqual(calls, [{ url: '/api/drh/candidates/42/transfer-drh', method: 'POST', body: null }]);
  assert.equal(elements.has('recruitmentModal'), false, 'Successful transmission closes the modal');
  assert.deepEqual(reloaded, ['new']);
  assert.equal(banners[0][1], 'success');
  assert.match(banners[0][0], /transféré à la DRH de IRON GLOBAL SÉCURITÉ/);
  assert.match(banners[0][0], /Contrats à établir/);
  assert.match(banners[0][0], /n’apparaît plus dans Recrutement/);
  assert.equal(item.data.avisDecision, 'Favorable');
  assert.ok(calls.every(call => !call.url.endsWith('/recruit')), 'No employee or contract is created by this action');
});

test('V7: recruiting an unventilated candidate is impossible — the interface asks for a ventilation first', async () => {
  for (const ventilation of [false, true]) {
    const { context, item, elements } = setup({ society: null, ventilation });
    vm.runInContext(recruitButtons(context.rowActions(item))[0].action, context);
    const modal = elements.get('recruitmentModal').innerHTML;
    assert.match(modal, /Société destinataire requise/);
    assert.doesNotMatch(modal, /type="submit"/, 'no transfer can be submitted without a destination');
    assert.equal(/openCandidateVentilation\(42\)/.test(modal), ventilation, 'Ventiler is offered only with the permission');
    const calls = [];
    context.apiFetch = async url => { calls.push(url); return {}; };
    await context.transmitCandidateToDrh({ querySelector: () => ({}) });
    assert.deepEqual(calls, [], 'no request leaves the browser');
  }
});

test('V7: a failed transfer keeps the dossier, shows the business error and offers a retry', async () => {
  const { context, item, elements } = setup({ data: { drhTransfer: { status: 'failed' } } });
  assert.match(context.statusPill(item), /Transfert DRH à reprendre/);
  vm.runInContext(recruitButtons(context.rowActions(item))[0].action, context);
  assert.match(elements.get('recruitmentModal').innerHTML, /Réessayer le transfert/);
  const output = { textContent: '', classList: { add(value) { this.value = value; } } };
  elements.set('recruitmentError', output);
  const reloaded = [];
  context.loadTab = async tab => { reloaded.push(tab); };
  context.apiFetch = async () => { const error = new Error('Transfert DRH à reprendre : le dossier reste dans Recrutement'); error.code = 'TRANSFERT_DRH_A_REPRENDRE'; throw error; };
  const button = { disabled: false, textContent: '' };
  await context.transmitCandidateToDrh({ querySelector: () => button });
  assert.ok(elements.has('recruitmentModal'), 'the dossier stays on screen');
  assert.deepEqual(reloaded, []);
  assert.match(output.textContent, /Transfert DRH à reprendre/);
  assert.deepEqual([button.disabled, button.textContent], [false, 'Réessayer le transfert']);
});

test('V7: Ventiler is a permissioned action — deny by default, never on archived dossiers', () => {
  const has = options => { const { context, item } = setup(options); return context.rowActionItems(item).some(action => action.label === 'Ventiler'); };
  assert.equal(has({}), false, 'recruiter without the ventilation permission');
  assert.equal(has({ ventilation: true }), true);
  assert.equal(has({ ventilation: true, opinion: '' }), true, 'ventilation does not depend on the opinion');
  assert.equal(has({ ventilation: true, tab: 'reserve' }), true);
  assert.equal(has({ ventilation: true, tab: 'archive' }), false);
  assert.equal(has({ ventilation: true, access: false }), false);
  assert.equal(has({ ventilation: true, actions: ['read'] }), false);
});

test('V7: ventilation targets come from the server and the request carries society, pool return and reason', async () => {
  const { context, item, elements } = setup({ ventilation: true, data: { ventilations: [{ from: null, to: 'IRON GLOBAL SÉCURITÉ', at: '2026-10-06T09:00:00', by: 'REC01', reason: 'Besoin site A' }] } });
  const select = { innerHTML: '', disabled: true, form: { querySelector: () => submit } }, submit = { disabled: true };
  context.apiFetch = async url => { assert.equal(url, '/api/drh/candidates/ventilation-targets'); return { can_ventilate: true, societies: ['IRON GLOBAL SÉCURITÉ', 'IRON GLOBAL SOLUTION'] }; };
  const opening = context.openCandidateVentilation(42);
  elements.set('ventilationSociety', select);
  await opening;
  const modal = elements.get('ventilationModal').innerHTML;
  assert.match(modal, /Société destinataire actuelle : <b>IRON GLOBAL SÉCURITÉ<\/b>/);
  assert.match(modal, /Historique des ventilations/);
  assert.match(modal, /REC01 · Besoin site A/);
  // La société actuelle n'est pas proposée ; le retour au vivier Groupe l'est.
  assert.deepEqual([...select.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]), ['', 'IRON GLOBAL SOLUTION', '__pool__']);
  assert.deepEqual([select.disabled, submit.disabled], [false, false]);

  const calls = [], banners = [], refreshed = [];
  context.apiFetch = async (url, options) => { calls.push({ url, method: options.method, body: JSON.parse(options.body) }); return {}; };
  context.showBanner = (...args) => banners.push(args);
  context.refreshRecruitCurrentSection = () => refreshed.push(true);
  const form = value => ({ society: { value }, reason: { value: ' Poste pourvu ' }, querySelector: () => ({}) });
  await context.saveCandidateVentilation(form('IRON GLOBAL SOLUTION'));
  assert.equal(elements.has('ventilationModal'), false);
  context.ventilationCandidateForTest = item;
  vm.runInContext('ventilationCandidate=ventilationCandidateForTest', context);
  await context.saveCandidateVentilation(form('__pool__'));
  assert.deepEqual(calls, [
    { url: '/api/drh/candidates/42/ventilation', method: 'POST', body: { society: 'IRON GLOBAL SOLUTION', reason: 'Poste pourvu' } },
    { url: '/api/drh/candidates/42/ventilation', method: 'POST', body: { society: null, reason: 'Poste pourvu' } },
  ]);
  assert.match(banners[0][0], /ventilé vers IRON GLOBAL SOLUTION/);
  assert.match(banners[1][0], /remis au vivier Groupe/);
  assert.equal(refreshed.length, 2);
  // Sans permission, l'action ne s'ouvre pas, même appelée directement.
  const denied = setup({});
  await denied.context.openCandidateVentilation(42);
  assert.equal(denied.elements.has('ventilationModal'), false);
});

test('V7: a favorable interview assigns the destination society only with the ventilation permission', async () => {
  for (const ventilation of [false, true]) {
    const { context, item } = setup({ society: null, ventilation });
    const calls = [];
    context.apiFetch = async (url, options) => { calls.push(JSON.parse(options.body)); return {}; };
    context.refreshRecruitCurrentSection = () => {}; context.showBanner = () => {};
    context.interviewCandidateForTest = item;
    vm.runInContext('interviewCandidate=interviewCandidateForTest', context);
    const field = value => ({ value });
    const form = { date: field('2026-10-08'), recruteur: field('REC01'), presence: field('Présent'), dateSuivi: field(''), societeRecrutement: field('IRON GLOBAL SÉCURITÉ'),
      recommandation: field('Favorable'), prochaineEtape: field(''), salaireSouhaite: field(''), salairePropose: field(''), pointsForts: field(''), pointsVigilance: field(''), appreciation: field('Très bon profil'),
      elements: new Proxy({}, { get: () => field('8') }), querySelectorAll: () => [] };
    await context.saveCandidateInterview(form, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data.societeRecrutement, 'IRON GLOBAL SÉCURITÉ', 'the proposal is always recorded in the dossier');
    assert.equal(calls[0].society, ventilation ? 'IRON GLOBAL SÉCURITÉ' : undefined);
  }
});
