// pointeur.irongs.com — TEMPS OPÉRATIONNEL : l'horloge, la date opérationnelle et les mouvements
// suivent le fuseau métier du site (Africa/Algiers) fourni par le serveur, jamais le fuseau du
// PC ni la date UTC. Le PC de test est volontairement réglé sur un autre fuseau.
process.env.TZ = 'America/Los_Angeles';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur } = require('./load-pointeur');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', username: 'PTG01', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const SUMMARY = { entries_today: 0, exits_today: 0, present_now: 0, absent_today: 0 };

function boot(clock) {
  const fetch = async (url) => {
    const u = new URL(url, 'https://pointeur.irongs.com');
    if (u.pathname === '/api/portal/attendance-live') return { ok: true, status: 200, json: async () => ({ latest_event_id: 1, events: [], latest_refusal_id: 1, refusals: [], alerts: [], summary: SUMMARY, ...clock }) };
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'HAMOUL 01 (40K)' }] };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url: 'https://pointeur.irongs.com/' });
  return { ...ctx, T: () => ctx.window.__pointeurTest };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.dom.window.close(); } catch (e) { /* déjà fermée */ } } });
const clockText = (t) => t.window.document.getElementById('headerClock').textContent.replace(/\s+/g, ' ');

test('le PC de test n\'est pas dans le fuseau métier', () => {
  assert.notEqual(new Date('2026-10-05T00:00:00+01:00').getHours(), 0);
});

for (const [serverNow, date, time] of [
  ['2026-10-04T23:59:00+01:00', '2026-10-04', '23:59:00'],
  ['2026-10-05T00:00:00+01:00', '2026-10-05', '00:00:00'],
  ['2026-10-05T05:59:00+01:00', '2026-10-05', '05:59:00'],
  ['2026-10-05T06:00:00+01:00', '2026-10-05', '06:00:00'],
]) {
  test(`heure serveur ${serverNow} : date opérationnelle ${date}, horloge ${time.slice(0, 5)}`, async () => {
    const t = boot({ timezone: 'Africa/Algiers', server_now: serverNow });
    opened.push(t);
    await tick(80);
    t.T().stopLivePolling();
    t.T().syncOpsClock({ timezone: 'Africa/Algiers', server_now: serverNow });
    assert.equal(t.T().opsDate(), date);
    assert.equal(t.T().localDate(), date);                          // plus jamais new Date().toISOString().slice(0,10)
    assert.equal(t.T().opsStamp().slice(0, 16), `${date}T${time.slice(0, 5)}`);
    t.T().updateHeaderClock();
    const clock = t.window.document.getElementById('headerClock');
    assert.equal(clock.dataset.time, time);
    assert.equal(clock.dataset.date, date);
    assert.ok(clockText(t).includes(`${date.slice(8)} oct. 2026`), clockText(t));
  });
}

test('la relève live recale l\'horloge sur le serveur et le fuseau du site', async () => {
  const t = boot({ timezone: 'Africa/Algiers', server_now: '2026-10-05T00:00:30+01:00' });
  opened.push(t);
  await tick(80);
  t.T().stopLivePolling();
  await t.T().pollLive();
  assert.equal(t.T().opsDate(), '2026-10-05');
  assert.equal(new Date('2026-10-05T00:00:30+01:00').toISOString().slice(0, 10), '2026-10-04');   // la date UTC était fausse
  assert.ok(Math.abs(t.T().opsNow().getTime() - Date.parse('2026-10-05T00:00:30+01:00')) < 5000);
});

test('décalage de dates sans dérive de fuseau', async () => {
  const t = boot({});
  opened.push(t);
  await tick(80);
  t.T().stopLivePolling();
  assert.equal(t.T().shiftDate('2026-10-05', -7), '2026-09-28');
  assert.equal(t.T().shiftDate('2026-12-31', 1), '2027-01-01');
  t.T().syncOpsClock({ timezone: 'Africa/Algiers', server_now: '2026-10-05T00:10:00+01:00' });
  assert.equal(t.T().localDate(-1), '2026-10-04');
});
