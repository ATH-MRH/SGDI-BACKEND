// Pointeur V6 (jsdom) : compteurs cliquables, effectifs présents par fonction, fiche employé
// compacte, mise à jour en temps réel, changement de site, séparateur des panneaux de droite.
// Données fictives (pointeur-v6-fixture.js) ; aucune base, aucun serveur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');
const fx = require('./pointeur-v6-fixture');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const opened = [];
test.afterEach(() => { while (opened.length) opened.pop().dom.window.close(); });

async function boot({ site = '1', state = fx.createState(), split, live } = {}) {
  const requests = [];
  const t = loadPointeur({
    session: { token: 'test', username: 'PTG01', user: { username: 'PTG01' } },
    fetch: async (input, options = {}) => {
      const url = new URL(String(input), 'https://pointage.irongs.com');
      requests.push(url.pathname);
      let body = {}; try { body = JSON.parse(options.body || '{}'); } catch (_) { /* GET */ }
      let [status, data] = fx.respond(state, options.method || 'GET', url, body);
      if (live && url.pathname.endsWith('/attendance-live')) data = live(data, url);
      return { ok: status < 400, status, headers: { get: () => null }, json: async () => data };
    },
  });
  t.window.localStorage.setItem('atlas_pointer_scope', JSON.stringify({ society: '', site }));
  if (split !== undefined) t.window.localStorage.setItem('atlas_pointer_v6_split', String(split));
  opened.push(t);
  await tick(120);
  t.T().stopLivePolling();
  const d = t.window.document;
  return { ...t, w: t.window, d, state, requests,
    text: (id) => [...d.getElementById(id).querySelectorAll('*')].filter((el) => !el.children.length).map((el) => el.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ') || d.getElementById(id).textContent.replace(/\s+/g, ' ').trim(),
    kpi: (key) => d.querySelector(`#postKpis [data-kpi="${key}"]`),
    rows: () => [...d.querySelectorAll('#presentNowList .v5-person')],
    fns: () => [...d.querySelectorAll('#functionsList .v6-fn')].map((b) => [b.querySelector('.v6-fn-name').textContent, Number(b.querySelector('.v6-fn-count b').textContent), b.querySelector('.v6-fn-pct').textContent]) };
}

test('cinq compteurs cliquables, alimentés par le flux du site', async () => {
  const t = await boot();
  const kpis = [...t.d.querySelectorAll('#postKpis .v5-kpi')];
  assert.equal(kpis.length, 5);
  assert.ok(kpis.every((k) => k.tagName === 'BUTTON' && k.type === 'button' && k.getAttribute('aria-pressed') === 'false'));
  assert.deepEqual(kpis.map((k) => [k.dataset.kpi, k.querySelector('small').textContent, k.querySelector('b').textContent]), [
    ['expected', 'Attendus', '12'], ['present', 'Présents', '9'], ['absent', 'Absents / non pointés', '3'], ['maintien', 'En maintien', '1'], ['anomalies', 'Anomalies', '2']]);
});

test('chaque compteur ouvre sa liste détaillée ; retour rapide à la vue générale', async () => {
  const t = await boot();
  assert.equal(t.text('presentNowTitle'), 'Présents actuellement');
  assert.equal(t.d.getElementById('detailBack').hidden, true);
  const cases = [
    ['expected', 'Attendus', 12, /OUALI Amine/],
    ['absent', 'Absents / non pointés', 3, /TOUATI Walid.*ABSENT \/ NON POINTÉ/],
    ['present', 'Présents', 9, /AMRANI Sofiane/],
    ['maintien', 'En maintien', 1, /AMRANI Sofiane.*EN MAINTIEN/],
  ];
  for (const [key, title, count, sample] of cases) {
    t.kpi(key).click();
    assert.equal(t.kpi(key).getAttribute('aria-pressed'), 'true', key);
    assert.equal(t.text('presentNowTitle'), title);
    assert.equal(t.text('presentNowCount'), String(count), key);
    assert.equal(t.rows().length, count, key);
    assert.match(t.text('presentNowList'), sample);
    assert.equal(t.d.getElementById('detailBack').hidden, false);
  }
  t.kpi('absent').click();
  assert.ok(t.rows().every((r) => /ABSENT \/ NON POINTÉ/.test(r.textContent)), 'liste des absents : seulement des absents');
  assert.ok(!/CHERIF Imane/.test(t.text('presentNowList')), 'un congé n’est pas un absent');
  t.kpi('anomalies').click();
  assert.equal(t.d.querySelectorAll('#presentNowList .v5-todo').length, 2);
  assert.match(t.text('presentNowList'), /Maintien à qualifier.*Saisie manuelle requise/);
  t.d.getElementById('detailBack').click();
  assert.equal(t.text('presentNowTitle'), 'Présents actuellement');
  assert.equal(t.rows().length, 9);
  assert.ok([...t.d.querySelectorAll('#postKpis .v5-kpi')].every((k) => k.getAttribute('aria-pressed') === 'false'));
  t.kpi('absent').click(); t.kpi('absent').click();
  assert.equal(t.text('presentNowTitle'), 'Présents actuellement', 'second clic : retour à la vue générale');
});

test('donnée indisponible : « — », jamais zéro ni liste vide', async () => {
  const t = await boot({ live: (data) => ({ ...data, post: { ...data.post, current: null, status: 'ROTATION_NOT_CONFIGURED', expected: null, kpi: { ...data.post.kpi, expected: null, absent: null } } }) });
  assert.equal(t.kpi('expected').querySelector('b').textContent, '—');
  assert.equal(t.kpi('absent').querySelector('b').textContent, '—');
  assert.match(t.kpi('expected').getAttribute('aria-label'), /donnée indisponible/);
  t.kpi('expected').click();
  assert.equal(t.text('presentNowCount'), '—');
  assert.match(t.text('presentNowList'), /Donnée indisponible/);
  t.kpi('absent').click();
  assert.match(t.text('presentNowList'), /Donnée indisponible/);
  t.T().setPost(null);
  assert.deepEqual([...t.d.querySelectorAll('#postKpis .v5-kpi b')].map((b) => b.textContent), ['—', '—', '—', '—', '—']);
  assert.match(t.text('functionsList'), /indisponibles/);
  assert.equal(t.text('functionsTotal'), '');
});

test('effectifs présents par fonction : fonctions réelles, pourcentages, total = compteur Présents', async () => {
  const t = await boot();
  assert.deepEqual(t.fns(), [
    ['CARISTE', 3, '33,3 %'], ['AGENT DE SÉCURITÉ', 2, '22,2 %'], ['AGENT POLYVALENT', 2, '22,2 %'], ['CHEF DE POSTE', 1, '11,1 %'], ['FONCTION NON RENSEIGNÉE', 1, '11,1 %']]);
  assert.equal(t.fns().reduce((n, f) => n + f[1], 0), Number(t.kpi('present').querySelector('b').textContent));
  assert.equal(t.text('functionsTotal'), 'TOTAL EN POSTE 9 100 %');
  assert.ok(!/MAGASINIER|CONDUCTEUR|MANUTENTIONNAIRE/.test(t.text('functionsList')), 'aucune fonction sans présent, aucune catégorie inventée');
  const bars = [...t.d.querySelectorAll('#functionsList .v6-fn-bar i')].map((i) => i.style.width);
  assert.deepEqual(bars, ['33.33%', '22.22%', '22.22%', '11.11%', '11.11%']);
  // Exemple de la consigne : 2 caristes + 1 agent polyvalent.
  const small = fx.createState();
  small.people.forEach((p) => { p.present = [101, 102, 104].includes(p.row[0]); });
  const s = await boot({ state: small });
  assert.deepEqual(s.fns(), [['CARISTE', 2, '66,7 %'], ['AGENT POLYVALENT', 1, '33,3 %']]);
  assert.equal(s.text('functionsTotal'), 'TOTAL EN POSTE 3 100 %');
  assert.match(s.d.querySelector('#functionsList .v6-fn').textContent, /2 présents/);
  assert.match(s.d.querySelectorAll('#functionsList .v6-fn')[1].textContent, /1 présent(?!s)/);
});

test('clic sur une fonction : liste de ses présents, puis retour', async () => {
  const t = await boot();
  const cariste = t.d.querySelector('#functionsList .v6-fn');
  assert.match(cariste.getAttribute('aria-label'), /CARISTE : 3 présents, 33,3 % — voir les employés/);
  cariste.click();
  assert.equal(t.text('presentNowTitle'), 'Fonction · CARISTE');
  assert.equal(t.rows().length, 3);
  assert.deepEqual(t.rows().map((r) => r.querySelector('.v5-person-name').textContent).sort(), ['BENALI Karim', 'OUALI Amine', 'SAÏDI Nour']);
  assert.equal(t.d.querySelector('#functionsList .v6-fn').getAttribute('aria-pressed'), 'true');
  t.d.querySelectorAll('#functionsList .v6-fn')[4].click();
  assert.equal(t.rows().length, 1);
  assert.match(t.text('presentNowList'), /AMRANI Sofiane/);
  t.d.getElementById('detailBack').click();
  assert.equal(t.rows().length, 9);
});

test('clic sur un employé : fiche compacte avec photo, identité, fonction, société, site et statut', async () => {
  const t = await boot();
  const row = t.rows().find((r) => /OUALI Amine/.test(r.textContent));
  assert.equal(row.getAttribute('role'), 'button');
  row.click(); await tick();
  assert.equal(t.d.getElementById('manualCardStep').classList.contains('hidden'), false);
  const card = t.text('manualCard');
  assert.match(card, /OUALI Amine/);
  assert.match(card, /Matricule T101/); assert.match(card, /Fonction Cariste/);
  assert.match(card, /Société IRON GLOBAL SÉCURITÉ/); assert.match(card, /Site SITE TEST NORD/);
  assert.match(card, /Statut EN POSTE · entrée 05:48/);
  assert.ok(t.d.querySelector('#manualCard .employee-photo').src.startsWith('data:image/svg+xml'));
  assert.deepEqual([...t.d.querySelectorAll('.manual-actions button')].map((b) => b.textContent.replace(/[↪\s]+/g, ' ').trim()), ['PRÉSENT', 'ABSENT', 'ABANDON POSTE']);
  // Clavier : Entrée sur une ligne de la liste des absents.
  t.d.getElementById('manualCardStep').querySelector('.manual-back').click();
  t.kpi('absent').click();
  const absent = t.rows()[0];
  absent.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.match(t.text('manualCard'), /Statut ABSENT \/ NON POINTÉ/);
});

test('PRÉSENT puis ABANDON : compteurs, présents, fonctions, statut et tableau actualisés sans double comptage', async () => {
  const t = await boot();
  t.kpi('absent').click();
  const touati = t.rows().find((r) => /TOUATI Walid/.test(r.textContent));
  touati.click(); await tick();
  await t.w.confirmManualPointage('present'); await tick(80);
  await t.T().pollLive(); await tick();
  assert.equal(t.kpi('present').querySelector('b').textContent, '10');
  assert.equal(t.kpi('absent').querySelector('b').textContent, '2');
  assert.deepEqual(t.fns().find((f) => f[0] === 'MAGASINIER'), ['MAGASINIER', 1, '10,0 %']);
  assert.equal(t.text('functionsTotal'), 'TOTAL EN POSTE 10 100 %');
  // Abandon de OUALI (cariste) : retiré des présents et de sa fonction.
  t.T().setManualResults([{ id: 101, matricule: 'T101', nom: 'OUALI', prenom: 'Amine', poste: 'Cariste', societe: fx.SOCIETY, site: 'SITE TEST NORD' }]);
  t.T().selectManualResult(0); await tick();
  await t.w.recordAbandon(); await tick(80);
  await t.T().pollLive(); await tick();
  assert.match(t.text('manualFeedback'), /ABANDON DE POSTE ENREGISTRÉ/);
  assert.equal(t.kpi('present').querySelector('b').textContent, '9');
  assert.deepEqual(t.fns().find((f) => f[0] === 'CARISTE'), ['CARISTE', 2, '22,2 %']);
  assert.equal(t.fns().reduce((n, f) => n + f[1], 0), 9);
  assert.match(t.text('manualStatus'), /ABSENT \/ NON POINTÉ|AUCUNE PRÉSENCE EN COURS/);
  t.d.getElementById('detailBack').click();
  assert.ok(!t.rows().some((r) => /OUALI Amine/.test(r.textContent)));
  assert.equal(new Set(t.rows().map((r) => r.dataset.employee)).size, t.rows().length, 'une ligne par personne');
  await t.T().loadHistory(); await tick();
  const ouali = [...t.d.querySelectorAll('#trackingBody tr')].find((tr) => /OUALI Amine/.test(tr.textContent));
  assert.match(ouali.textContent, /05:48:00.*10:15:00.*Abandon poste/);
  assert.deepEqual(t.state.writes.map((w) => w.kind), ['scan', 'abandon']);
});

test('changement de site : vue réinitialisée, données du nouveau site uniquement', async () => {
  const t = await boot();
  t.kpi('absent').click();
  await t.w.changeAttendanceSite('2'); await tick(120);
  assert.equal(t.text('presentNowTitle'), 'Présents actuellement');
  assert.equal(t.kpi('present').querySelector('b').textContent, '2');
  assert.deepEqual(t.fns(), [['AGENT DE SÉCURITÉ', 1, '50,0 %'], ['CHEF DE POSTE', 1, '50,0 %']]);
  assert.ok(!/OUALI|AMRANI/.test(t.text('presentNowList')));
  t.kpi('absent').click();
  assert.deepEqual(t.rows().map((r) => r.querySelector('.v5-person-name').textContent), ['GUERFI Adel']);
});

test('tous les sites : fonctions fusionnées et site indiqué', async () => {
  const t = await boot({ site: '' });
  assert.equal(t.kpi('present').querySelector('b').textContent, '11');
  assert.equal(t.fns().reduce((n, f) => n + f[1], 0), 11);
  assert.deepEqual(t.fns().slice(0, 2), [['AGENT DE SÉCURITÉ', 3, '27,3 %'], ['CARISTE', 3, '27,3 %']]);
  assert.match(t.text('presentNowList'), /SITE TEST SUD/);
});

test('tableau des pointages : colonnes demandées dans l’onglet Aujourd’hui', async () => {
  const t = await boot();
  await t.T().loadHistory(); await tick();
  assert.deepEqual([...t.d.querySelectorAll('#trackingHead th')].map((th) => th.textContent), ['Nom et prénom', 'Matricule', 'Fonction', 'Heure arrivée', 'Heure départ', 'Statut']);
  assert.deepEqual([...t.d.querySelectorAll('[data-tracking-tab]')].map((b) => b.textContent), ['Aujourd’hui', 'Entrées', 'Sorties', 'Anomalies']);
  // Le tableau est dans la colonne gauche, sous la zone de pointage — plus sous les panneaux de droite.
  const left = t.d.querySelector('.v6-left');
  assert.deepEqual([...left.children].map((c) => c.id), ['scannerCard', 'movementsCard']);
  assert.deepEqual([...t.d.getElementById('sideCol').children].slice(0, 3).map((c) => c.id), ['presentNowCard', 'panelSplit', 'functionsCard']);
});

test('séparateur : clavier, boutons, bornes, mémorisation sur le poste et réinitialisation', async () => {
  const t = await boot();
  const sep = t.d.getElementById('panelSplitter'), col = t.d.getElementById('sideCol');
  assert.equal(sep.getAttribute('role'), 'separator'); assert.equal(sep.tabIndex, 0);
  assert.equal(sep.getAttribute('aria-valuenow'), '55');
  const key = (k) => sep.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('ArrowUp');
  assert.equal(sep.getAttribute('aria-valuenow'), '50');
  assert.equal(col.style.getPropertyValue('--v6-split'), '0.5000');
  assert.equal(t.w.localStorage.getItem('atlas_pointer_v6_split'), '0.5000');
  key('PageDown'); assert.equal(sep.getAttribute('aria-valuenow'), '65');
  key('End'); assert.equal(sep.getAttribute('aria-valuenow'), '90', 'borne haute');
  key('Home'); assert.equal(sep.getAttribute('aria-valuenow'), '10', 'borne basse');
  t.d.querySelector('[data-split="1"]').click(); assert.equal(sep.getAttribute('aria-valuenow'), '15');
  t.d.querySelector('[data-split="-1"]').click(); assert.equal(sep.getAttribute('aria-valuenow'), '10');
  t.d.querySelector('[data-split="reset"]').click();
  assert.equal(sep.getAttribute('aria-valuenow'), '55');
  assert.equal(t.w.localStorage.getItem('atlas_pointer_v6_split'), null);
  // Proportion mémorisée relue au chargement suivant ; valeur corrompue ignorée.
  const again = await boot({ split: '0.3' });
  assert.equal(again.d.getElementById('panelSplitter').getAttribute('aria-valuenow'), '30');
  const broken = await boot({ split: 'abc' });
  assert.equal(broken.d.getElementById('panelSplitter').getAttribute('aria-valuenow'), '55');
});

test('aucune requête supplémentaire : tout vient du flux live déjà relevé', async () => {
  const t = await boot();
  const before = t.requests.length;
  for (const key of ['expected', 'absent', 'maintien', 'anomalies', 'present']) t.kpi(key).click();
  t.d.querySelector('#functionsList .v6-fn').click();
  assert.equal(t.requests.length, before);
});

test('déconnexion : listes détaillées et fonctions vidées', async () => {
  const t = await boot();
  t.kpi('expected').click();
  await t.T().logout();
  assert.equal(t.d.querySelectorAll('#presentNowList .v5-person').length, 0);
  assert.ok(!/OUALI|CARISTE/.test(t.text('functionsList')));
  assert.equal(t.text('presentNowTitle'), 'Présents actuellement');
});
