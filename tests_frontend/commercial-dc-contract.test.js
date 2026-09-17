// LOT ERP — bascule contractuelle DC (finalisation) : écran de saisie du contrat DC
// (dc.irongs.com / commercial.html). Le poste/fonction doit être sélectionné depuis
// le référentiel canonique Administration → Postes/Fonctions (/api/irongs/positions),
// jamais saisi en texte libre — voir item 3 du lot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'app', 'static', 'commercial.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function bootCommercial() {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'balise <script> introuvable dans commercial.html');
  const suffix = `
;window.enterApp = async () => {}; // neutralise l'auto-init DOMContentLoaded (dashboard complet hors périmètre de ce test)
;window.__test = {
  setSession: (v) => { session = v; },
  getDraft: () => dcContractSitesDraft,
  getPositionsCatalog: () => positionsCatalog,
};
`;
  // Fonction de remplacement (pas une chaîne littérale) : le script original peut
  // contenir des séquences "$&"/"$1" que String.replace() interpréterait sinon.
  const patched = html.replace(scriptMatch[0], () => `<script>${scriptMatch[1]}${suffix}</script>`);
  const dom = new JSDOM(patched, { url: 'http://localhost/commercial.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const testSession = { token: 'test-token', username: 'dc-user' };
  // Le DOMContentLoaded interne réassigne inconditionnellement `session` depuis
  // localStorage[SESSION_KEY] dès qu'il se déclenche (même juste pour lire "null"
  // si vide) — persister la même session ici évite qu'il l'efface pendant un await.
  try { w.localStorage.setItem('atlas_commercial_session', JSON.stringify(testSession)); } catch (e) {}
  w.__test.setSession(testSession);
  return { dom, window: w };
}

const SAMPLE_POSITIONS = [
  { id: 11, name: 'Cariste', society: 'IRON GLOBAL SECURITE' },
  { id: 12, name: 'Agent Polyvalent', society: 'IRON GLOBAL SECURITE' },
];

test('ouverture du modal client charge le référentiel canonique de postes', async () => {
  const { window: w } = bootCommercial();
  const calls = [];
  w.fetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => (String(url).includes('/positions') ? SAMPLE_POSITIONS : {}) }; };
  await w.openClientModal(null);
  assert.ok(calls.some(u => String(u).includes('/api/irongs/positions')), 'le référentiel Postes/Fonctions doit être chargé à l\'ouverture');
  assert.deepEqual(w.__test.getPositionsCatalog(), SAMPLE_POSITIONS);
  w.close();
});

test('ajouter un site puis un poste : le sélecteur propose le référentiel canonique, jamais un champ texte libre', async () => {
  const { window: w } = bootCommercial();
  w.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/positions') ? SAMPLE_POSITIONS : {}) });
  await w.openClientModal(null);
  w.addDcContractSite();
  w.addDcRequirementRow(0);
  const host = w.document.getElementById('dcContractSites');
  const select = host.querySelector('select');
  assert.ok(select, 'un <select> doit remplacer le champ texte libre historique');
  const optionLabels = [...select.querySelectorAll('option')].map(o => o.textContent);
  assert.ok(optionLabels.includes('Cariste'));
  assert.ok(optionLabels.includes('Agent Polyvalent'));
  assert.equal(host.querySelector('input[placeholder="CARISTE: 2, AGENT POLYVALENT: 4"]'), null, 'le champ texte libre historique ne doit plus exister');
  assert.equal(w.__test.getDraft()[0].requirements.length, 1);
  assert.equal(w.__test.getDraft()[0].requirements[0].position_id, 11); // premier poste disponible sélectionné par défaut
});

test('sélectionner un poste et une quantité met à jour le brouillon avec position_id (pas un libellé)', async () => {
  const { window: w } = bootCommercial();
  w.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/positions') ? SAMPLE_POSITIONS : {}) });
  await w.openClientModal(null);
  w.addDcContractSite();
  w.addDcRequirementRow(0);
  w.updateDcRequirementRow(0, 0, 'position_id', '12');
  w.updateDcRequirementRow(0, 0, 'quantity', '4');
  const requirement = w.__test.getDraft()[0].requirements[0];
  // Comparaison champ à champ : l'objet vient de la réalité JS de la fenêtre jsdom
  // (constructeur Object distinct de celui du process de test), assert.deepEqual le
  // signalerait à tort comme non identique malgré une structure strictement égale.
  assert.equal(requirement.position_id, 12);
  assert.equal(requirement.quantity, 4);
});

test('supprimer une ligne de poste retire bien l\'entrée du brouillon', async () => {
  const { window: w } = bootCommercial();
  w.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/positions') ? SAMPLE_POSITIONS : {}) });
  await w.openClientModal(null);
  w.addDcContractSite();
  w.addDcRequirementRow(0);
  w.addDcRequirementRow(0);
  assert.equal(w.__test.getDraft()[0].requirements.length, 2);
  w.removeDcRequirementRow(0, 0);
  assert.equal(w.__test.getDraft()[0].requirements.length, 1);
});

test('submitClient : refuse un site sans aucun poste, avant tout appel réseau de publication', async () => {
  const { window: w } = bootCommercial();
  const calls = [];
  w.fetch = async (url, opts) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => (String(url).includes('/positions') ? SAMPLE_POSITIONS : { id: 1 }) }; };
  await w.openClientModal(null);
  w.document.getElementById('cName').value = 'Client Test';
  w.addDcContractSite();
  w.updateDcContractSite(0, 'name', 'Site sans poste');
  await w.submitClient();
  assert.doesNotMatch(w.document.getElementById('clientError').textContent, /^$/);
  assert.match(w.document.getElementById('clientError').textContent, /poste/i);
  assert.ok(!calls.some(u => u.includes('/contract')), 'aucune publication de contrat ne doit partir avec un site invalide');
});

test('submitClient : refuse une ligne sans poste sélectionné (position_id manquant)', async () => {
  const { window: w } = bootCommercial();
  w.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/positions') ? [] : {}) }); // catalogue vide -> aucun poste par défaut
  await w.openClientModal(null);
  w.document.getElementById('cName').value = 'Client Test';
  w.addDcContractSite();
  w.updateDcContractSite(0, 'name', 'Site catalogue vide');
  w.addDcRequirementRow(0); // aucun poste disponible -> position_id reste null
  await w.submitClient();
  assert.match(w.document.getElementById('clientError').textContent, /poste sélectionné|effectif/i);
});

test('submitClient : envoie les requirements sous forme canonique {position_id, quantity} au contrat DC', async () => {
  const { window: w } = bootCommercial();
  let contractPayload = null;
  w.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/positions')) return { ok: true, status: 200, json: async () => SAMPLE_POSITIONS };
    if (u.endsWith('/contract')) {
      contractPayload = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ client_id: 42, sites_count: 1, published_site_ids: [7] }) };
    }
    if (u.includes('/api/commercial/clients')) return { ok: true, status: 200, json: async () => ({ id: 42 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await w.openClientModal(null);
  w.document.getElementById('cName').value = 'Client Canonique';
  w.addDcContractSite();
  w.updateDcContractSite(0, 'name', 'Site Canonique');
  w.addDcRequirementRow(0);
  w.updateDcRequirementRow(0, 0, 'position_id', '12');
  w.updateDcRequirementRow(0, 0, 'quantity', '3');
  await w.submitClient();
  assert.ok(contractPayload, 'le contrat DC aurait dû être publié');
  assert.deepEqual(contractPayload.sites[0].requirements, [{ position_id: 12, quantity: 3 }]);
});
