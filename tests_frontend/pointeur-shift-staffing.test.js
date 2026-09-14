// LOT ERP — bascule contractuelle DC : widget "effectif contractuel / shift" du
// Pointeur (pointeur.html). Couvre :
// - régression CSS du chevauchement de libellés (flex-shrink:0) ;
// - "SOURCE OPS TRANSITOIRE" et "DC + DONNÉES TRANSITOIRES" doivent avoir disparu ;
// - "CONTRAT DC NON CONFIGURÉ" affiché explicitement quand aucun site n'est
//   configuré côté DC.IRONGS.COM (jamais de repli sur d'anciennes quotas OPS) ;
// - cas DHL (item 10 du lot) : dcContractSiteKey vide -> alerte, jamais de quota.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'app', 'static', 'pointeur.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

test('CSS : .shift-staffing-counter ne doit jamais rétrécir sous sa largeur de contenu (flex-shrink:0)', () => {
  const rule = html.match(/\.shift-staffing-counter\{[^}]*\}/);
  assert.ok(rule, 'règle .shift-staffing-counter introuvable');
  assert.match(rule[0], /flex-shrink:0/, 'sans flex-shrink:0, les libellés longs (postes, contexte de shift) se chevauchent au lieu de déclencher le défilement horizontal déjà prévu par overflow:auto sur .shift-staffing');
});

test('les états "SOURCE OPS TRANSITOIRE" et "DC + DONNÉES TRANSITOIRES" ont bien disparu du code', () => {
  assert.doesNotMatch(html, /SOURCE OPS TRANSITOIRE/, 'la notion de source OPS transitoire pour le contractuel doit être totalement supprimée (LOT ERP — bascule DC)');
  assert.doesNotMatch(html, /DC \+ DONNÉES TRANSITOIRES/);
  assert.doesNotMatch(html, /["']ops-transition["']/);
  assert.doesNotMatch(html, /["']mixed-transition["']/);
});

function bootPointeur() {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'balise <script> introuvable dans pointeur.html');
  const suffix = `
;window.__test = {
  setSession: (v) => { pointerSession = v; },
};
`;
  // Fonction de remplacement (pas une chaîne littérale) : le script original peut
  // contenir des séquences "$&"/"$1" que String.replace() interpréterait sinon.
  const patched = html.replace(scriptMatch[0], () => `<script>${scriptMatch[1]}${suffix}</script>`);
  const dom = new JSDOM(patched, { url: 'http://localhost/pointeur.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.__test.setSession({ token: 'test-token' });
  return { dom, window: w };
}

test('loadShiftStaffing : source dc, contexte de shift et compteurs par poste affichés', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      source: 'dc',
      sites: [{ site_id: 1, site: 'Site A', group: 'C', shift: '22:00–06:00', configured: true, source: 'dc', requirements: { 'Stock Controller': 19, 'Team Leader In & Out': 1, 'Warehouse Keeper': 2 } }],
      requirements: { 'Stock Controller': 19, 'Team Leader In & Out': 1, 'Warehouse Keeper': 2 },
      contractual: { source: 'dc', configured: true, requirements: { 'Stock Controller': 19, 'Team Leader In & Out': 1, 'Warehouse Keeper': 2 } },
    }),
  });
  await w.loadShiftStaffing();
  const host = w.document.getElementById('shiftStaffing');
  assert.match(host.innerHTML, /SOURCE DC/);
  assert.doesNotMatch(host.innerHTML, /SOURCE OPS TRANSITOIRE/);
  assert.match(host.textContent, /GROUPE C · 22:00–06:00/);
  assert.match(host.textContent, /STOCK CONTROLLER/);
  assert.equal(host.querySelectorAll('.shift-staffing-counter').length, 4); // contexte + 3 postes
  const values = [...host.querySelectorAll('.shift-staffing-counter:not(.context) b')].map(el => el.textContent);
  assert.deepEqual(values.sort(), ['1', '19', '2']);
});

test('loadShiftStaffing : DC non configuré -> alerte claire "non configuré dans DC.IRONGS.COM", aucun quota OPS affiché', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      source: 'dc-unconfigured',
      sites: [{ site_id: 27, site: 'DHL FORWARDING / HAMOUL 01 (40K)', group: '', shift: '', configured: false, source: 'unconfigured', requirements: {} }],
      requirements: {},
      contractual: { source: 'dc-unconfigured', configured: false, requirements: {} },
    }),
  });
  await w.loadShiftStaffing();
  const host = w.document.getElementById('shiftStaffing');
  assert.match(host.textContent, /non configuré dans DC\.IRONGS\.COM/i);
  assert.doesNotMatch(host.innerHTML, /SOURCE OPS TRANSITOIRE/);
  assert.doesNotMatch(host.innerHTML, /STOCK CONTROLLER/);
  assert.equal(host.querySelectorAll('.shift-staffing-counter').length, 0, 'aucun compteur ne doit être affiché quand rien n\'est configuré côté DC');
});

test('loadShiftStaffing : cas DHL site_id=27 (item 10 du lot) -> CONTRAT DC NON CONFIGURÉ, jamais SOURCE OPS TRANSITOIRE', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      source: 'dc-unconfigured',
      sites: [{
        site_id: 27, site: 'DHL FORWARDING / HAMOUL 01 (40K)', group: '', shift: '',
        configured: false, source: 'unconfigured', requirements: {},
      }],
      requirements: {},
      contractual: { source: 'dc-unconfigured', configured: false, requirements: {} },
    }),
  });
  await w.loadShiftStaffing();
  const text = w.document.getElementById('shiftStaffing').textContent;
  assert.match(text, /non configuré dans DC\.IRONGS\.COM/i);
  assert.doesNotMatch(text, /OPS TRANSITOIRE/);
  assert.doesNotMatch(text, /STOCK CONTROLLER|TEAM LEADER|WAREHOUSE KEEPER/);
});

test('loadShiftStaffing : source partielle (plusieurs sites, un seul configuré côté DC) -> DC pour le configuré, alerte pour le reste', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      source: 'partial',
      sites: [
        { site_id: 1, site: 'Site Configuré DC', group: 'A', shift: '06:00–14:00', configured: true, source: 'dc', requirements: { 'Cariste': 3 } },
        { site_id: 2, site: 'Site Non Configuré', group: '', shift: '', configured: false, source: 'unconfigured', requirements: {} },
      ],
      requirements: { 'Cariste': 3 },
      contractual: { source: 'partial', configured: false, requirements: { 'Cariste': 3 } },
    }),
  });
  await w.loadShiftStaffing();
  const host = w.document.getElementById('shiftStaffing');
  assert.match(host.innerHTML, /SOURCE DC/);
  assert.match(host.textContent, /CARISTE/);
  assert.match(host.textContent, /Site Non Configuré/, 'le site non configuré doit être nommé pour guider la configuration DC');
  assert.doesNotMatch(host.innerHTML, /OPS TRANSITOIRE/);
});

test('loadShiftStaffing : aucun site autorisé -> message explicite, pas de compteur vide', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ source: 'dc-unconfigured', sites: [], requirements: {}, contractual: { source: 'dc-unconfigured', configured: false, requirements: {} } }) });
  await w.loadShiftStaffing();
  const host = w.document.getElementById('shiftStaffing');
  assert.match(host.textContent, /non configuré/i);
  assert.equal(host.querySelectorAll('.shift-staffing-counter').length, 0);
});

test('loadShiftStaffing : erreur réseau contrôlée -> message clair, pas de crash', async () => {
  const { window: w } = bootPointeur();
  w.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await w.loadShiftStaffing();
  assert.match(w.document.getElementById('shiftStaffing').textContent, /Effectif contractuel indisponible/);
});

test('loadShiftStaffing : session expirée (401) déclenche la déconnexion, pas de rendu d\'erreur brut', async () => {
  const { window: w } = bootPointeur();
  let loggedOut = false;
  w.logout = () => { loggedOut = true; w.pointerSession = null; };
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await w.loadShiftStaffing();
  assert.equal(loggedOut, true);
});
