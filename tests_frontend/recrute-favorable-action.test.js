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

function setup({ opinion = 'Favorable', tab = 'new', actions = ['read', 'create', 'update'], access = true } = {}) {
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
  context.options = { opinion, tab, actions, access };
  vm.runInContext(`
    recruteSession={user:{recruitment_access:options.access,authorized_actions:options.actions,authorized_societies:['IRON GLOBAL SÉCURITÉ']}};
    activeTab=options.tab;
    activeSociety='IRON GLOBAL SÉCURITÉ';
    tabState[activeTab].items=[{id:42,last_name:'Fixture',first_name:'Test',desired_position:'Agent',society:null,data:{avisDecision:options.opinion,notes:'Dossier conservé'}}];
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
    assert.match(modal.innerHTML, /name="society" required/);
    assert.match(modal.innerHTML, /transmitCandidateToDrh\(this\)/);
    assert.match(modal.innerHTML, /Aucun employé ni contrat ne sera créé avant validation par la DRH/);
  }
  assert.match(html, /\.row-recruit\s*\{[^}]*background\s*:\s*#15803d\b/);
});

test('Non-favorable and closed candidate groups expose no direct or menu recruitment action', () => {
  for (const options of [
    { opinion: '' }, { opinion: 'Défavorable' }, { opinion: 'Instance' },
    { tab: 'archive' }, { tab: 'recruited' },
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

test('Rendered favorable action transmits society and existing dossier to DRH through unchanged APIs', async () => {
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
  await context.transmitCandidateToDrh({
    society: { value: 'IRON GLOBAL SÉCURITÉ' },
    querySelector: () => button,
  });
  assert.deepEqual(calls, [
    {
      url: '/api/drh/candidates/42', method: 'PUT',
      body: { society: 'IRON GLOBAL SÉCURITÉ', data: { avisDecision: 'Favorable', notes: 'Dossier conservé', societeRecrutement: 'IRON GLOBAL SÉCURITÉ' } },
    },
    { url: '/api/drh/candidates/42/marquer-contractualisation', method: 'POST', body: null },
  ]);
  assert.equal(elements.has('recruitmentModal'), false, 'Successful transmission closes the modal');
  assert.deepEqual(reloaded, ['new']);
  assert.equal(banners[0][1], 'success');
  assert.match(banners[0][0], /Contrats à établir/);
  assert.equal(item.data.avisDecision, 'Favorable');
  assert.ok(calls.every(call => !call.url.endsWith('/recruit')), 'No employee or contract is created by this action');
});
