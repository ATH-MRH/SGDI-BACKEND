// Pointage : DRH consulte la même interface qu'OPS, en lecture seule.
// OPS est la référence. Pour une même société, une même date et les mêmes données, les deux
// modules doivent afficher les mêmes onglets, compteurs, tableaux, alertes et statistiques ;
// DRH n'a aucun contrôle d'écriture et aucune fonction d'écriture ne s'y exécute.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const SOURCES = {
  'pointage.js': fs.readFileSync(path.join(STATIC, 'js', 'modules', 'pointage.js'), 'utf8'),
  'pointage-1.js': fs.readFileSync(path.join(STATIC, 'js', 'modules', 'pointage-1.js'), 'utf8'),
  'sgdi-app.js': fs.readFileSync(path.join(STATIC, 'sgdi-app.js'), 'utf8'),
};
const GUARD = 'if(ptGuardReadOnly())return;';
const PERSISTENCE = /sgdiRunLegacyAction\(|saveDB\(|saveDBAndWait\(|method:\s*"(?:POST|PUT|PATCH|DELETE)"/;

// Fonctions de premier niveau d'un fichier : [nom, corps].
function topLevelFunctions(source) {
  const lines = source.split('\n');
  const starts = [];
  lines.forEach((line, i) => { if (/^(?:async )?function [\w$]+\(/.test(line)) starts.push(i); });
  return starts.map((start, n) => [
    lines[start].match(/function ([\w$]+)/)[1],
    lines.slice(start, n + 1 < starts.length ? starts[n + 1] : lines.length).join('\n'),
  ]);
}
// Registre des écritures : toute fonction qui commence par la garde de lecture seule.
const WRITE_FUNCTIONS = Object.values(SOURCES)
  .flatMap(topLevelFunctions).filter(([, body]) => body.includes(GUARD)).map(([name]) => name);
const WRITE_CALL = new RegExp(`\\b(?:${WRITE_FUNCTIONS.join('|')})\\(`);

const TABS = ['dashboard', 'feuille', 'saisie', 'auto', 'planning', 'recap', 'societe', 'stats', 'legende', 'archives'];

function boot() {
  const ctx = loadSgdiApp(['renderPointage', 'today', 'addDays', 'ptReadOnly', 'ptAutoArchiveOldDays', ...WRITE_FUNCTIONS]);
  assert.ifError(ctx.loadError);
  const { window } = ctx, T = ctx.T();
  const day = T.today(), month = day.slice(0, 7);
  const agent = (n, extra = {}) => ({
    id: `ag${n}`, backendId: 100 + n, matricule: `K${n}`, nom: `NOM${n}`, prenom: `Prenom${n}`, societe: 'IRON',
    statut: 'actif', fonction: 'APS', affectationCourante: { siteId: 's1', siteName: 'SITE A', statut: 'active' }, ...extra,
  });
  const presence = (id, date, agentId, extra = {}) => ({ id, date, agentId, societe: 'IRON', siteName: 'SITE A', ...extra });
  const fixture = {
    agents: [1, 2, 3, 4, 5].map(n => agent(n)).concat(agent(9, { societe: 'AUTRE' })),
    sites: [{ id: 's1', nom: 'SITE A', societe: 'IRON', actif: true }],
    feuillePresence: [
      presence('f1', day, 'ag1', { code: 'P', heureArrivee: '08:00', scanArrivee: '08:01', heureDepart: '16:00', scanDepart: '16:02', valide: true }),
      presence('f2', day, 'ag2', { code: 'A' }),
      presence('f3', day, 'ag3', { code: 'C' }),
      presence('f4', T.addDays(day, -1), 'ag4', { code: 'P', heureArrivee: '07:55' }),
      presence('f9', day, 'ag9', { societe: 'AUTRE', code: 'P', heureArrivee: '09:00' }),
    ],
    pointages: [
      { id: 'p1', agentId: 'ag1', periode: month, days: { '01': 'P', '02': 'A', '03': 'F1' }, valide: true, valideBy: 'OPS01', valideAt: `${day}T08:00:00Z` },
      { id: 'p2', agentId: 'ag2', periode: month, days: { '01': 'C', '02': 'M', '03': 'A2' } },
      { id: 'p3', agentId: 'ag3', periode: month, days: { '01': 'P', '02': 'P' } },
    ],
    feuillePresenceCloture: { [T.addDays(day, -1)]: { at: `${day}T00:00:00Z`, by: 'OPS01', count: 1 } },
    feuillePresenceArchive: {},
    settings: { effectifConfig: { operationalRequiresDotation: false, operationalRequiresPvInstallation: false } },
    users: [],
  };
  const calls = [];
  window.sgdiRunLegacyAction = async (action, payload) => { calls.push(['action', action, payload]); return { status: 'success', data: {} }; };
  window.saveDB = () => { calls.push(['saveDB']); };
  window.saveDBAndWait = async () => { calls.push(['saveDBAndWait']); };
  window.fetch = (url, options = {}) => {
    if (String(options.method || 'GET').toUpperCase() !== 'GET') calls.push(['fetch', String(url)]);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  };
  window.confirm = () => true;
  window.prompt = () => 'motif';
  const view = window.document.getElementById('view');
  const enter = (module) => {
    window.sessionStorage.clear();
    T.setDb(JSON.parse(JSON.stringify(fixture)));
    T.setSession({ username: module.toUpperCase(), nom: module.toUpperCase(), role: 'admin', niveau: 'H5', transverse: module, societe: 'IRON' });
    calls.length = 0;
  };
  const render = (module, tab) => {
    enter(module);
    view.innerHTML = '';
    T.renderPointage(view, tab, undefined, true);
    return view;
  };
  return { ctx, window, T, view, calls, enter, render, fixture, day, month };
}

const squash = text => text.replace(/\s+/g, ' ').trim();
const tabKeys = view => [...view.querySelectorAll('button[onclick^="navigate(\'pointage/"]')]
  .filter(button => /border-b-2/.test(button.className))
  .map(button => [button.getAttribute('onclick').match(/pointage\/(\w+)/)[1], squash(button.textContent)]);

// Projection « hors écriture » : retire d'un rendu ce qui n'existe que pour écrire, afin de
// comparer le reste — c'est-à-dire toute l'information — entre OPS et DRH.
function readProjection(view) {
  const clone = view.cloneNode(true);
  clone.querySelector('#pt-employee-qr-open')?.closest('.card')?.remove();
  clone.querySelectorAll('.pt-manuel-hint').forEach(node => node.remove());
  clone.querySelectorAll('button[onclick^="navigate(\'pointage/qr\'"]').forEach(node => node.remove());
  [...clone.querySelectorAll('button[onclick]')]
    .filter(node => /^pt(?:Valider|Devalider)Tous\(/.test(node.getAttribute('onclick'))).forEach(node => node.remove());
  // Statut de ligne : bouton d'action côté OPS, simple libellé côté DRH — même état.
  clone.querySelectorAll('.pt-lock-btn').forEach(node => { node.textContent = node.classList.contains('locked') ? '[VERROUILLÉ]' : '[OUVERT]'; });
  return squash(clone.textContent);
}

function inlineHandlers(view) {
  const handlers = [];
  view.querySelectorAll('*').forEach(node => {
    for (const attribute of node.attributes) if (/^on[a-z]+$/.test(attribute.name)) handlers.push(attribute.value);
  });
  return handlers;
}

test('le registre des écritures couvre toute fonction du Pointage qui persiste des données', () => {
  assert.ok(WRITE_FUNCTIONS.length >= 38, `registre incomplet : ${WRITE_FUNCTIONS.length}`);
  for (const file of ['pointage.js', 'pointage-1.js']) {
    for (const [name, body] of topLevelFunctions(SOURCES[file])) {
      if (PERSISTENCE.test(body)) assert.ok(body.includes(GUARD), `${file} : ${name} écrit sans garde de lecture seule`);
    }
    assert.doesNotMatch(SOURCES[file], /isDrh|transverse\s*===\s*["']drh["']/,
      `${file} : aucune branche propre à DRH, seulement le mode lecture seule partagé`);
  }
  const archive = topLevelFunctions(SOURCES['sgdi-app.js']).find(([name]) => name === 'ptAutoArchiveOldDays')[1];
  assert.match(archive, /ptReadOnly\(\)/, 'l’archivage automatique ne tourne pas dans une session DRH');
});

test('onglets : DRH a les mêmes onglets qu’OPS, hors « QR par site »', () => {
  const app = boot();
  try {
    const ops = tabKeys(app.render('ops', 'feuille'));
    const drh = tabKeys(app.render('drh', 'feuille'));
    assert.deepStrictEqual(ops.map(([key]) => key), ['feuille', 'saisie', 'auto', 'planning', 'recap', 'societe', 'stats', 'legende', 'qr']);
    assert.deepStrictEqual(drh, ops.filter(([key]) => key !== 'qr'));
    // Les anciennes redirections DRH (saisie et tableau de bord → saisie automatique) ont disparu.
    assert.match(app.render('drh', 'saisie').textContent, /Saisie manuelle —/);
    assert.match(app.render('drh', 'dashboard').textContent, /Tableau de bord pointage/);
    // « QR par site » sert à créer des pointages : DRH est ramené à la feuille quotidienne.
    assert.match(app.render('drh', 'qr').textContent, /Feuille de présence quotidienne/);
    assert.strictEqual(app.view.querySelector('canvas,img[src^="data:image"]'), null);
  } finally { app.window.close(); }
});

test('chaque écran : DRH affiche exactement les informations d’OPS', () => {
  const app = boot();
  try {
    for (const tab of TABS) {
      const ops = readProjection(app.render('ops', tab));
      const drh = readProjection(app.render('drh', tab));
      assert.ok(ops.length > 200, `${tab} : rendu OPS vide`);
      if (drh !== ops) {
        let at = 0;
        while (drh[at] === ops[at]) at++;
        assert.fail(`${tab} : DRH diffère d’OPS à « …${ops.slice(Math.max(0, at - 60), at + 60)}… » contre « …${drh.slice(Math.max(0, at - 60), at + 60)}… »`);
      }
    }
  } finally { app.window.close(); }
});

test('KPI du tableau de bord : mêmes six indicateurs, mêmes valeurs, mêmes compteurs par code', () => {
  const app = boot();
  try {
    const read = view => ({
      kpis: [...view.querySelectorAll('.pt-dash-kpi')].map(node => [
        squash(node.querySelector('.pt-dash-kpi-label').textContent), squash(node.querySelector('.pt-dash-kpi-val').textContent),
        squash(node.querySelector('.pt-dash-kpi-sub').textContent), node.getAttribute('onclick')]),
      codes: [...view.querySelectorAll('.pt-dash-chip')].map(node => [squash(node.querySelector('.code-tag').textContent), squash(node.querySelector('.code-val').textContent)]),
      statistiques: squash(view.querySelector('.pt-dash-body-grid').textContent),
      columns: view.querySelector('.pt-dash-kpis').getAttribute('style'),
    });
    const ops = read(app.render('ops', 'dashboard'));
    const drh = read(app.render('drh', 'dashboard'));
    assert.deepStrictEqual(drh, ops);
    assert.deepStrictEqual(drh.kpis.map(([label]) => label),
      ['Agents suivis', 'Présents aujourd\'hui', 'Couverture saisie', 'Pointages validés', 'Taux présence', 'Non clôturées']);
    assert.ok(drh.codes.some(([code, count]) => code === 'P' && Number(count) > 0), 'compteurs par code alimentés');
  } finally { app.window.close(); }
});

test('critère d’acceptation : mêmes totaux, codes, arrivées, départs, alertes et statistiques', () => {
  const app = boot();
  try {
    const measure = (module) => {
      const feuille = app.render(module, 'feuille');
      const cards = [...feuille.querySelectorAll('.grid.grid-cols-3 > *')].map(node => Number(squash(node.querySelector('.text-2xl').textContent)));
      const codes = Object.fromEntries([...feuille.querySelectorAll('.pointage-code-card')]
        .map(node => [squash(node.querySelector('.pointage-code-key').textContent), Number(node.querySelector('b').textContent)]));
      const rows = [...feuille.querySelectorAll('#fpq-live-tbody tr')].map(row => [...row.children].map(cell => squash(cell.textContent)));
      const result = {
        total_agents: cards[2], present: cards[0], non_pointes: cards[1], absent: codes.A, codes,
        arrivees: rows.map(row => [row[2], row[4]]), departs: rows.map(row => [row[2], row[5]]),
        etats: rows.map(row => [row[2], row[7]]),
        alertes: squash(feuille.querySelector('.card[style*="#fef2f2"]')?.textContent || ''),
      };
      result.statistiques = readProjection(app.render(module, 'stats'));
      result.planning = readProjection(app.render(module, 'planning'));
      result.recap_societe = readProjection(app.render(module, 'societe'));
      return result;
    };
    const ops = measure('ops'), drh = measure('drh');
    assert.deepStrictEqual(drh, ops);
    // Garde-fou : la comparaison porte sur des données réelles, pas sur deux écrans vides.
    assert.strictEqual(ops.total_agents, 5, 'cinq agents IRON, la société AUTRE reste hors périmètre');
    assert.strictEqual(ops.present, 1);
    assert.strictEqual(ops.absent, 1);
    assert.strictEqual(ops.codes.C, 1);
    assert.strictEqual(ops.non_pointes, 2);
    assert.ok(ops.arrivees.some(([, time]) => time === '08:01') && ops.departs.some(([, time]) => time === '16:02'));
    assert.match(ops.alertes, /abandon de poste/i);
    assert.ok(ops.statistiques.length > 200 && ops.planning.length > 200);
  } finally { app.window.close(); }
});

test('feuille mensuelle : DRH voit les mêmes codes, totaux et statuts, sans pouvoir les modifier', () => {
  const app = boot();
  try {
    const grid = view => [...view.querySelectorAll('table.pt-manuel tbody tr')].map(row => ({
      locked: row.classList.contains('locked'),
      cells: [...row.children].filter(cell => !cell.classList.contains('pt-col-action')).map(cell => squash(cell.textContent)),
      statut: row.querySelector('.pt-col-action .pt-lock-btn').classList.contains('locked'),
    }));
    const head = view => [...view.querySelectorAll('table.pt-manuel thead tr:first-child th')].map(cell => squash(cell.textContent));
    const ops = app.render('ops', 'saisie'), opsGrid = grid(ops), opsHead = head(ops);
    const drh = app.render('drh', 'saisie');
    assert.deepStrictEqual(grid(drh), opsGrid);
    assert.deepStrictEqual(head(drh), opsHead);
    assert.strictEqual(opsHead.at(-1), 'Statut', 'la colonne Statut reste visible');
    assert.ok(opsGrid.some(row => row.statut) && opsGrid.some(row => !row.statut), 'lignes validées et non validées');
    assert.strictEqual(drh.querySelector('table.pt-manuel').getAttribute('style'), null, 'plus de pointer-events:none');
    assert.strictEqual(drh.querySelectorAll('table.pt-manuel button').length, 0);
    assert.strictEqual(drh.querySelectorAll('table.pt-manuel .editable').length, 0);
    assert.match(drh.querySelector('.pt-manuel-hint').textContent, /Consultation seule/);
  } finally { app.window.close(); }
});

test('DRH : aucun contrôle d’écriture sur aucun écran', () => {
  const app = boot();
  try {
    for (const tab of [...TABS, 'qr']) {
      const view = app.render('drh', tab);
      const writers = inlineHandlers(view).filter(handler => WRITE_CALL.test(handler));
      assert.deepStrictEqual(writers, [], `${tab} : contrôle d’écriture présent`);
      assert.strictEqual(view.querySelector('#pt-employee-qr-open,#pt-employee-qr-reader'), null, `${tab} : scanner QR présent`);
      assert.strictEqual(view.querySelector('.editable'), null, `${tab} : cellule modifiable`);
      assert.doesNotMatch(view.textContent, /Valider tous les pointages|Tout déverrouiller|Ouvrir le scanner/);
      assert.strictEqual(view.querySelectorAll('select[onchange],input[onchange],input[oninput],textarea').length,
        [...view.querySelectorAll('select[onchange],input[onchange],input[oninput],textarea')]
          .filter(node => !WRITE_CALL.test(node.getAttribute('onchange') || node.getAttribute('oninput') || '')).length,
        `${tab} : champ lié à une écriture`);
    }
    // Les filtres, la navigation, l'actualisation et l'impression restent disponibles.
    const feuille = inlineHandlers(app.render('drh', 'feuille')).join(' ');
    for (const allowed of ['fpqSetDatePart(', 'setPtSearch(', 'fpqLiveRefresh(', 'window.print(', 'fpqOpenDailyCodeModal(', 'fpqSetSort('])
      assert.ok(feuille.includes(allowed), `feuille DRH : ${allowed} disponible`);
    const saisie = inlineHandlers(app.render('drh', 'saisie')).join(' ');
    for (const allowed of ['setPtMonth(', 'setPtManuelChip(', 'window.print('])
      assert.ok(saisie.includes(allowed), `saisie DRH : ${allowed} disponible`);
  } finally { app.window.close(); }
});

test('DRH : aucune fonction d’écriture ne s’exécute, même appelée directement', async () => {
  const app = boot();
  try {
    app.enter('drh');
    assert.strictEqual(app.T.ptReadOnly(), true);
    const before = JSON.stringify(app.T.getDb());
    const args = ['ag2', app.month, 4, 'P', 'x', 'y'];
    for (const name of WRITE_FUNCTIONS) {
      assert.strictEqual(typeof app.T[name], 'function', `${name} introuvable`);
      await app.T[name](...args);
      await app.T[name](app.day, 'ag2', 'code', 'P');
    }
    app.T.ptAutoArchiveOldDays();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(app.calls, [], 'aucun appel de persistance');
    assert.strictEqual(JSON.stringify(app.T.getDb()), before, 'aucune donnée locale modifiée');
    assert.strictEqual(app.window.document.querySelector('#modal-host .modal-bg,.modal-bg'), null, 'aucune fenêtre de saisie ouverte');
  } finally { app.window.close(); }
});

test('OPS conserve toutes ses capacités d’écriture', async () => {
  const app = boot();
  try {
    assert.strictEqual((app.enter('ops'), app.T.ptReadOnly()), false);
    const saisie = app.render('ops', 'saisie');
    const handlers = inlineHandlers(saisie).join(' ');
    for (const writer of ['ptOpenCodePicker(', 'ptValiderSheet(', 'ptDevaliderSheet(', 'ptValiderTous(', 'ptDevaliderTous(', 'ptEmployeeQrStart('])
      assert.ok(handlers.includes(writer), `OPS : ${writer} disponible`);
    assert.ok(saisie.querySelectorAll('table.pt-manuel button.editable').length > 0, 'cellules modifiables');
    assert.match(saisie.querySelector('.pt-manuel-hint').textContent, /cliquer sur une case/);
    assert.ok(app.render('ops', 'auto').querySelector('#pt-employee-qr-open'), 'scanner QR sur la saisie automatique');
    assert.ok(tabKeys(app.render('ops', 'feuille')).some(([key]) => key === 'qr'), 'onglet QR par site');

    app.enter('ops');
    app.T.ptSetCell('ag2', app.month, 4, 'P');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(app.calls.map(call => call[1]), ['save-pointage-cell']);
    assert.strictEqual(app.T.getDb().pointages.find(sheet => sheet.id === 'p2').days['04'], 'P');

    app.enter('ops');
    await app.T.ptValiderSheet('ag2', app.month);
    assert.ok(app.calls.some(call => call[1] === 'validate-pointage'), 'validation transmise au serveur');
    app.enter('ops');
    await app.T.ptDevaliderSheet('ag1', app.month);
    assert.ok(app.calls.some(call => call[1] === 'unlock-pointage'), 'déverrouillage transmis au serveur');
  } finally { app.window.close(); }
});
