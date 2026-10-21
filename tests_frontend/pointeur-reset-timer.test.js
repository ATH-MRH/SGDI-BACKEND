// Retour automatique à la recherche après PRÉSENT / ABSENT (1,8 s) : une ancienne opération ne doit
// jamais réinitialiser une nouvelle sélection ni fermer une fenêtre d'abandon ouverte entre-temps.
// Minuteries réelles ; données fictives (pointeur-v6-fixture.js), aucune base ni serveur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');
const fx = require('./pointeur-v6-fixture');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RESET_MS = 1800, AFTER = RESET_MS + 400;
const opened = [];
test.afterEach(() => { while (opened.length) opened.pop().dom.window.close(); });

const person = (id) => { const row = fx.PEOPLE.find((p) => p[0] === id); return { id, matricule: 'T' + id, nom: row[1], prenom: row[2], poste: row[3], societe: fx.SOCIETY, site: 'SITE TEST NORD' }; };

async function boot({ url } = {}) {
  const state = fx.createState();
  const t = loadPointeur({
    url,
    session: { token: 'test', username: 'PTG01', user: { username: 'PTG01' } },
    fetch: async (input, options = {}) => {
      const u = new URL(String(input), 'https://pointage.irongs.com');
      let body = {}; try { body = JSON.parse(options.body || '{}'); } catch (_) { /* GET */ }
      const [status, data] = fx.respond(state, options.method || 'GET', u, body);
      return { ok: status < 400, status, headers: { get: () => null }, json: async () => data };
    },
  });
  t.window.localStorage.setItem('atlas_pointer_scope', JSON.stringify({ society: '', site: '1' }));
  opened.push(t);
  await wait(120);
  t.T().stopLivePolling();
  const d = t.window.document, w = t.window;
  const select = async (id) => { if (!w.isManualPanelOpen()) t.T().toggleManualPanel(); t.T().setManualResults([person(id)]); t.T().selectManualResult(0); await wait(30); };
  return { ...t, d, w, state, select,
    writes: () => state.writes.filter((x) => x.kind !== 'qr'),
    card: () => d.getElementById('manualCardStep').classList.contains('hidden') ? null : d.querySelector('#manualCard .result-name').textContent,
    feedback: () => d.getElementById('manualFeedback').textContent,
    modalOpen: () => !d.getElementById('abandonOverlay').classList.contains('hidden') };
}

test('sans autre action : retour à la recherche après 1,8 s (comportement conservé)', async () => {
  const t = await boot();
  await t.select(110);
  await t.w.confirmManualPointage('present');
  assert.match(t.feedback(), /TOUATI Walid — PRÉSENCE ENREGISTRÉE À 10:15:00/);
  assert.equal(t.card(), 'TOUATI Walid');
  await wait(AFTER);
  assert.equal(t.card(), null, 'panneau revenu à la recherche');
  assert.equal(t.writes().length, 1);
});

test('enregistrement puis changement rapide d’employé : la nouvelle fiche reste, le message reste nommé', async () => {
  const t = await boot();
  await t.select(110);
  await t.w.confirmManualPointage('present');
  await wait(300);
  await t.select(111);
  assert.equal(t.card(), 'LARBI Hichem');
  await wait(AFTER);
  assert.equal(t.card(), 'LARBI Hichem', 'l’ancienne opération ne réinitialise pas la nouvelle sélection');
  assert.match(t.feedback(), /TOUATI Walid — PRÉSENCE ENREGISTRÉE/, 'confirmation conservée et attribuée au bon employé');
  assert.deepEqual(t.writes().map((x) => [x.kind, x.employee_id, x.action]), [['scan', 110, 'present']], 'aucune écriture pour la nouvelle fiche');
});

test('fenêtre d’abandon ouverte avant l’échéance (même employé) : jamais fermée, aucune écriture', async () => {
  const t = await boot();
  await t.select(101);
  await t.w.confirmManualPointage('absent');
  assert.match(t.feedback(), /OUALI Amine — ABSENCE ENREGISTRÉE/);
  await wait(200);
  await t.w.openAbandonModal();
  assert.equal(t.modalOpen(), true);
  t.d.getElementById('abandonObservation').value = 'Motif en cours de saisie';
  await wait(AFTER);
  assert.equal(t.modalOpen(), true, 'la fenêtre d’abandon reste ouverte');
  assert.equal(t.d.getElementById('abandonObservation').value, 'Motif en cours de saisie', 'saisie conservée');
  assert.equal(t.card(), 'OUALI Amine');
  assert.equal(t.writes().filter((x) => x.kind === 'abandon').length, 0);
});

test('fenêtre d’abandon ouverte sur un autre employé avant l’échéance : jamais fermée', async () => {
  const t = await boot();
  await t.select(110);
  await t.w.confirmManualPointage('present');
  await wait(200);
  await t.select(102);
  await t.w.openAbandonModal();
  await wait(AFTER);
  assert.equal(t.modalOpen(), true);
  assert.equal(t.card(), 'BENALI Karim');
  t.d.getElementById('abandonObservation').value = 'Quitte le site'; t.w.updateAbandonConfirmation();
  await t.w.confirmAbandon(); await wait(150);           // rechargements qui suivent l'enregistrement
  assert.deepEqual(t.writes().map((x) => [x.kind, x.employee_id]), [['scan', 110], ['abandon', 102]], 'une seule écriture par action');
});

test('plusieurs pointages successifs : chaque fiche reste jusqu’à sa propre échéance, une écriture par action', async () => {
  const t = await boot();
  await t.select(110); await t.w.confirmManualPointage('present');
  await wait(400);
  await t.select(111); await t.w.confirmManualPointage('present');
  await wait(400);
  await t.select(112); await t.w.confirmManualPointage('absent');
  assert.match(t.feedback(), /BRAHIMI Fethi — ABSENCE ENREGISTRÉE/);
  await wait(1000);
  assert.equal(t.card(), 'BRAHIMI Fethi', 'les échéances des pointages précédents sont sans effet');
  await wait(AFTER);
  assert.equal(t.card(), null, 'retour à la recherche après la dernière opération');
  assert.deepEqual(t.writes().map((x) => [x.employee_id, x.action]), [[110, 'present'], [111, 'present'], [112, 'absent']]);
});

test('aucune double écriture : double clic et échéance ne renvoient rien', async () => {
  const t = await boot();
  await t.select(110);
  const first = t.w.confirmManualPointage('present');
  await t.w.confirmManualPointage('present');
  await first;
  await wait(AFTER);
  await t.w.confirmManualPointage('present');          // panneau revenu à la recherche : aucun employé sélectionné
  assert.equal(t.writes().length, 1);
});

test('saisie dans le panneau ou nouvelle recherche : le nettoyage différé est annulé', async () => {
  const t = await boot();
  await t.select(110);
  await t.w.confirmManualPointage('present');
  t.d.getElementById('manualObservation').dispatchEvent(new t.w.Event('input', { bubbles: true }));
  await wait(AFTER);
  assert.equal(t.card(), 'TOUATI Walid', 'saisie en cours : rien n’est effacé');
  await t.select(111); await t.w.confirmManualPointage('present');
  t.d.getElementById('manualQuery').value = 'BOU'; t.w.onManualQueryInput();
  await wait(AFTER);
  assert.equal(t.d.getElementById('manualQuery').value, 'BOU', 'recherche en cours conservée');
});

test('deux écrans : le suivi détaché ne porte aucune minuterie, et un changement de site venu de l’autre fenêtre annule le nettoyage', async () => {
  const suivi = await boot({ url: 'https://pointage.irongs.com/pointeur/suivi' });
  assert.ok(suivi.d.body.classList.contains('tracking-detached'));
  assert.equal(typeof suivi.w.cancelManualReset, 'function');
  suivi.w.cancelManualReset();                           // sans effet, sans erreur
  const t = await boot();
  await t.select(110);
  await t.w.confirmManualPointage('present');
  // L'autre écran change le site du poste (événement storage) avant l'échéance.
  const value = JSON.stringify({ society: '', site: '2' });
  t.w.localStorage.setItem('atlas_pointer_scope', value);
  t.w.dispatchEvent(new t.w.StorageEvent('storage', { key: 'atlas_pointer_scope', newValue: value }));
  await wait(150);
  assert.equal(t.card(), null, 'changement de site : retour à la recherche (règle existante)');
  await t.select(201);
  await wait(AFTER);
  assert.equal(t.card(), 'NAIT Mourad', 'l’échéance de l’ancien site ne touche pas la nouvelle fiche');
  assert.equal(t.writes().length, 1);
});
