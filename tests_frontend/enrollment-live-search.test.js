// Gestion du pointage → Biométrie → Enrôlement : recherche DYNAMIQUE des employés.
// Tests jsdom sur le VRAI app/static/pointage/index.html ; seul le réseau est simulé, avec des
// réponses différées pilotées par le test et une annulation réelle (AbortSignal).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 280;

// Périmètre SERVEUR simulé : le site 3 du compte. EXT001 (autre site) n'est jamais renvoyé.
const PEOPLE = [
  { employee_id: 1, matricule: 'ABD001', nom: 'ABDELLI', prenom: 'Karim', fonction: 'AGENT', site_id: 3, site: 'HAMOUL 01', statut: 'actif', consent_admissible: true, enrollment: 'NONE', photo_available: true },
  { employee_id: 2, matricule: 'BEN002', nom: 'BENALI', prenom: 'Abdel', fonction: 'CHEF DE POSTE', site_id: 3, site: 'HAMOUL 01', statut: 'actif', consent_admissible: false, enrollment: 'ACTIVE', photo_available: false },
  { employee_id: 3, matricule: 'OUA003', nom: 'OUALI', prenom: 'Amine', fonction: 'AGENT', site_id: 3, site: 'HAMOUL 01', statut: 'actif', consent_admissible: true, enrollment: 'PENDING_REVIEW', photo_available: true },
];
const OUTSIDE = { employee_id: 9, matricule: 'EXT001', nom: 'ABDOU', prenom: 'Hors', site_id: 8, site: 'AUTRE SITE' };
const serverSearch = (q) => {
  const t = (q || '').trim().toLowerCase();
  return PEOPLE.filter((p) => !t || [p.matricule, p.nom, p.prenom].some((v) => v.toLowerCase().includes(t)));
};

function boot({ delays = {}, fail = null, ignoreAbort = false } = {}) {
  const searches = [];        // requêtes de recherche réellement envoyées
  const aborted = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/#/enrollment', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.fetch = (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        const ok = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
        if (u.pathname === '/api/auth/me') return Promise.resolve(ok({ username: 'PTG01', full_name: 'POINTEUR 01' }));
        if (u.pathname === '/api/attendance/sites') return Promise.resolve(ok([{ id: 3, name: 'HAMOUL 01', society: 'IRON GLOBAL SOLUTION' }]));
        if (u.pathname !== '/api/biometrics/employees') return Promise.resolve(ok({}));
        const q = u.searchParams.get('q') || '';
        const call = { q, params: Object.fromEntries(u.searchParams), signal: opts.signal };
        searches.push(call);
        return new Promise((resolve, reject) => {
          const abort = () => { aborted.push(q); reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })); };
          if (opts.signal && !ignoreAbort) {
            if (opts.signal.aborted) return abort();
            opts.signal.addEventListener('abort', abort);
          }
          setTimeout(() => {
            if (opts.signal && opts.signal.aborted && !ignoreAbort) return;
            if (fail && fail(q)) return resolve({ ok: false, status: 500, text: async () => JSON.stringify({ detail: 'Erreur serveur' }) });
            resolve(ok(serverSearch(q)));
          }, delays[q] != null ? delays[q] : 5);
        });
      };
    },
  });
  const w = dom.window, d = w.document;
  const input = () => d.getElementById('en-q');
  const type = (value) => { input().value = value; input().dispatchEvent(new w.Event('input', { bubbles: true })); };
  const key = (k) => input().dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const rows = () => Array.from(d.querySelectorAll('#en-rows tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
  const ready = async () => { for (let i = 0; i < 50 && !searches.length; i++) await sleep(10); await sleep(30); };
  return { dom, w, d, searches, aborted, errors, input, type, key, rows, ready };
}

test('barre de recherche : pleine largeur, icône, × accessible, plus aucun bouton « Rechercher »', async () => {
  const t = boot();
  await t.ready();
  const bar = t.d.querySelector('#view-enrollment .en-searchbar');
  assert.ok(bar, 'barre de recherche absente');
  assert.equal(Array.from(t.d.querySelectorAll('#view-enrollment button')).filter((b) => /Rechercher/.test(b.textContent)).length, 0);
  assert.equal(t.d.getElementById('en-search'), null);
  assert.equal(t.input().placeholder, 'Rechercher un employé par matricule, nom ou prénom…');
  assert.match(t.d.querySelector('label[for="en-q"]').textContent, /Rechercher un employé à enrôler/);
  const clear = t.d.getElementById('en-clear');
  assert.equal(clear.getAttribute('aria-label'), 'Effacer la recherche');
  assert.equal(clear.tagName, 'BUTTON');
  assert.ok(clear.classList.contains('hidden'), '× masqué tant que le champ est vide');
  assert.equal(t.d.getElementById('en-status').getAttribute('aria-live'), 'polite');
  // État initial (champ vide) : premiers employés du périmètre, renvoyés par le serveur.
  assert.equal(t.searches[0].q, '');
  assert.equal(t.rows().length, 3);
  t.dom.window.close();
});

test('saisie : recherche automatique après le debounce, sans clic ; frappe rapide = une seule requête', async () => {
  const t = boot();
  await t.ready();
  const before = t.searches.length;
  for (const v of ['A', 'AB', 'ABD', 'ABDE', 'ABDEL']) { t.type(v); await sleep(40); }
  assert.equal(t.searches.length, before, 'aucune requête pendant la frappe rapide');
  assert.equal(t.d.getElementById('en-clear').classList.contains('hidden'), false);
  await sleep(DEBOUNCE + 60);
  assert.deepEqual(t.searches.slice(before).map((s) => s.q), ['ABDEL']);
  assert.deepEqual(t.rows().map((r) => r.split(' ')[0]), ['ABDELLI', 'BENALI']);   // ABDELLI (nom) + Abdel (prénom)
  t.dom.window.close();
});

test('recherche par matricule, nom et prénom (insensible à la casse, espaces ignorés), dès 1 caractère', async () => {
  const t = boot();
  await t.ready();
  const run = async (v) => { t.type(v); await sleep(DEBOUNCE + 60); return t.rows().map((r) => r.split(' ')[0]); };
  assert.deepEqual(await run('oua003'), ['OUALI']);                 // matricule
  assert.deepEqual(await run('  benali '), ['BENALI']);             // nom, espaces de bord
  assert.equal(t.searches.at(-1).q, 'benali');                      // envoyé nettoyé
  assert.deepEqual(await run('AMINE'), ['OUALI']);                  // prénom, casse
  assert.deepEqual(await run('k'), ['ABDELLI']);                    // 1 caractère
  t.dom.window.close();
});

test('la dernière recherche gagne : une réponse plus ancienne et plus lente est ignorée, la précédente est annulée', async () => {
  const t = boot({ delays: { A: 400, OUALI: 10 } });
  await t.ready();
  t.type('A'); t.key('Enter');                         // « A » part tout de suite (lente, 3 résultats)
  await sleep(20);
  t.type('OUALI'); t.key('Enter');                     // « OUALI » part (rapide, 1 résultat)
  await sleep(500);                                    // la réponse « A » serait arrivée après
  assert.deepEqual(t.rows().map((r) => r.split(' ')[0]), ['OUALI']);
  assert.ok(t.aborted.includes('A'), 'la requête « A » doit être annulée (AbortController)');
  assert.equal(t.d.getElementById('en-state').textContent, '', 'une annulation n\'affiche jamais d\'erreur');
  assert.ok(t.d.getElementById('en-spinner').classList.contains('hidden'));
  t.dom.window.close();
});

test('réponse obsolète ignorée même sans annulation réseau (numéro de séquence)', async () => {
  // Réseau qui ignore l'annulation : la vieille réponse « OUA » arrive APRÈS celle de « BEN ».
  const t = boot({ delays: { OUA: 300, BEN: 10 }, ignoreAbort: true });
  await t.ready();
  t.type('OUA'); t.key('Enter');
  await sleep(10);
  t.type('BEN'); t.key('Enter');
  await sleep(400);
  assert.deepEqual(t.rows().map((r) => r.split(' ')[0]), ['BENALI']);
  t.dom.window.close();
});

test('Entrée lance immédiatement la recherche en attente (sans attendre le debounce)', async () => {
  const t = boot();
  await t.ready();
  const before = t.searches.length;
  t.type('OUALI');
  t.key('Enter');
  await sleep(30);
  assert.deepEqual(t.searches.slice(before).map((s) => s.q), ['OUALI']);
  await sleep(DEBOUNCE + 40);
  assert.equal(t.searches.length, before + 1, 'le debounce en attente est annulé par Entrée');
  t.dom.window.close();
});

test('état « Recherche… » discret pendant l\'appel, sans effacer les résultats affichés', async () => {
  const t = boot({ delays: { BEN: 200 } });
  await t.ready();
  t.type('BEN'); t.key('Enter');
  await sleep(30);
  assert.equal(t.d.getElementById('en-spinner').classList.contains('hidden'), false);
  assert.equal(t.d.getElementById('en-status').textContent, 'Recherche…');
  assert.equal(t.rows().length, 3, 'résultats précédents conservés pendant la recherche (aucun gros chargeur)');
  await sleep(250);
  assert.ok(t.d.getElementById('en-spinner').classList.contains('hidden'));
  assert.match(t.d.getElementById('en-status').textContent, /1 employé/);
  t.dom.window.close();
});

test('aucun résultat, puis × : champ vidé, recherche annulée, état initial restauré', async () => {
  const t = boot({ delays: { 'ZZZ-LENT': 300 } });
  await t.ready();
  t.type('XYZ'); await sleep(DEBOUNCE + 60);
  assert.deepEqual(t.rows(), ['Aucun employé correspondant dans votre périmètre.']);
  t.type('ZZZ-LENT'); t.key('Enter');
  await sleep(20);
  t.d.getElementById('en-clear').click();
  assert.equal(t.input().value, '');
  assert.ok(t.d.getElementById('en-clear').classList.contains('hidden'));
  assert.ok(t.aborted.includes('ZZZ-LENT'));
  await sleep(60);
  assert.equal(t.searches.at(-1).q, '');
  assert.equal(t.rows().length, 3);
  assert.equal(t.d.getElementById('en-state').textContent, '');
  t.dom.window.close();
});

test('champ vidé au clavier (ou Échap) : état initial restauré', async () => {
  const t = boot();
  await t.ready();
  t.type('OUA'); await sleep(DEBOUNCE + 60);
  assert.equal(t.rows().length, 1);
  t.type(''); await sleep(DEBOUNCE + 60);
  assert.equal(t.rows().length, 3);
  t.type('BEN'); await sleep(DEBOUNCE + 60);
  t.key('Escape'); await sleep(40);
  assert.equal(t.input().value, '');
  assert.equal(t.rows().length, 3);
  t.dom.window.close();
});

test('erreur serveur réelle : message clair et « Réessayer »', async () => {
  let broken = true;
  const t = boot({ fail: (q) => q === 'PANNE' && broken });
  await t.ready();
  t.type('PANNE'); await sleep(DEBOUNCE + 60);
  assert.match(t.d.getElementById('en-state').textContent, /Erreur serveur/);
  assert.equal(t.d.querySelector('#en-state [role="alert"]') !== null, true);
  broken = false;
  t.d.getElementById('en-retry').click();
  await sleep(40);
  assert.equal(t.d.getElementById('en-state').textContent, '');
  assert.deepEqual(t.rows(), ['Aucun employé correspondant dans votre périmètre.']);
  t.dom.window.close();
});

test('périmètre : seul le serveur filtre — la page n\'affiche que ses résultats, jamais un employé hors périmètre', async () => {
  const t = boot();
  await t.ready();
  t.type('ABD'); await sleep(DEBOUNCE + 60);
  const shown = t.d.getElementById('en-rows').textContent;
  assert.match(shown, /ABDELLI/);
  assert.doesNotMatch(shown, new RegExp(OUTSIDE.matricule));
  // Une seule source : l'endpoint borné par le serveur, avec le texte saisi (et le site filtré).
  assert.ok(t.searches.every((s) => Object.keys(s.params).every((k) => ['q', 'site_id'].includes(k))));
  t.d.getElementById('f-site').value = '3';
  t.d.getElementById('f-site').dispatchEvent(new t.w.Event('change'));
  await sleep(60);
  assert.equal(t.searches.at(-1).params.site_id, '3');
  // Ouvrir conserve son comportement (fiche biométrique de l'employé choisi).
  assert.ok(t.d.querySelector('[data-en="1"]'));
  t.dom.window.close();
});
