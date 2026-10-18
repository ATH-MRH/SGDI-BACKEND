// Données FICTIVES du poste Pointeur V6 (aucune base, aucun serveur ATLAS) : deux sites, une vacation
// active, des présents de plusieurs fonctions (dont une non renseignée), des attendus absents ou
// excusés, un maintien et deux anomalies. Le serveur simulé applique les écritures (arrivée, sortie,
// abandon) à cet état en mémoire pour vérifier la mise à jour de tous les panneaux.
const SOCIETY = 'IRON GLOBAL SÉCURITÉ';
const SITES = [{ id: 1, name: 'SITE TEST NORD', society: SOCIETY }, { id: 2, name: 'SITE TEST SUD', society: SOCIETY }];
const SERVER_NOW = '2026-10-18T10:15:00+01:00';
const DAY = SERVER_NOW.slice(0, 10);
const PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbeafe"/><circle cx="40" cy="28" r="14" fill="#64748b"/><path d="M10 80V65a30 30 0 0 1 60 0v15" fill="#19375b"/></svg>');

// [id, nom, prénom, fonction, site, état attendu, heure d'arrivée, maintien]
const PEOPLE = [
  [101, 'OUALI', 'Amine', 'Cariste', 1, 'PRESENT', '05:48'],
  [102, 'BENALI', 'Karim', 'Cariste', 1, 'PRESENT', '05:52'],
  [103, 'SAÏDI', 'Nour', 'CARISTE', 1, 'PRESENT', '05:55'],
  [104, 'MEZIANE', 'Lyes', 'Agent polyvalent', 1, 'PRESENT', '05:41'],
  [105, 'KACI', 'Samir', 'Agent polyvalent', 1, 'PRESENT', '05:58'],
  [106, 'HADJ-MOHAMMED BENABDERRAHMANE', 'Abdelkader', 'Agent de sécurité', 1, 'PRESENT', '05:45'],
  [107, 'ZERROUKI', 'Yanis', 'Agent de sécurité', 1, 'PRESENT', '06:02'],
  [108, 'BOUZID', 'Rania', 'Chef de poste', 1, 'PRESENT', '05:39'],
  [109, 'AMRANI', 'Sofiane', '', 1, null, '06:40', true],
  [110, 'TOUATI', 'Walid', 'Magasinier', 1, 'ABSENT'],
  [111, 'LARBI', 'Hichem', 'Cariste', 1, 'ABSENT'],
  [112, 'BRAHIMI', 'Fethi', 'Conducteur', 1, 'ABSENT'],
  [113, 'CHERIF', 'Imane', 'Manutentionnaire', 1, 'EXCUSED'],
  [201, 'NAIT', 'Mourad', 'Agent de sécurité', 2, 'PRESENT', '05:50'],
  [202, 'FERHAT', 'Lina', 'Chef de poste', 2, 'PRESENT', '05:57'],
  [203, 'GUERFI', 'Adel', 'Agent de sécurité', 2, 'ABSENT'],
];

function card(row) {
  const [id, nom, prenom, fonction, site] = row;
  return { id, matricule: 'T' + id, nom, prenom, photo: PHOTO, societe: SOCIETY, poste: fonction, fonction, statut: 'actif',
    site: SITES[site - 1].name, has_photo: true, group: row[7] ? 'C' : 'A' };
}

function createState() {
  return { people: PEOPLE.map((row) => ({ row, present: !!row[6], departure: '', abandon: false, absentSaved: false })), events: [], nextEvent: 500, writes: [] };
}

function presentRow(person) {
  const [, , , , , , entry, maintained] = person.row;
  return { employee: card(person.row), event_id: person.row[0] * 10, entry, entry_at: `${DAY}T${entry}:00+01:00`,
    shift_start: maintained ? '06:00' : '06:00', shift_end: '14:00', shift_label: 'Matin', kind: maintained ? 'EXTRA_SHIFT' : 'IN_WINDOW',
    badge: maintained ? 'EN_MAINTIEN' : 'EN_POSTE', badge_label: maintained ? 'EN MAINTIEN' : 'EN POSTE' };
}

const EXPECTED_LABELS = { PRESENT: 'Présent', ABSENT: 'Absent / non pointé', EXCUSED: 'Congé' };

function sitePost(state, siteId) {
  const people = state.people.filter((p) => p.row[4] === siteId);
  const present = people.filter((p) => p.present).map(presentRow).sort((a, b) => b.entry_at.localeCompare(a.entry_at));
  const expected = people.filter((p) => p.row[5]).map((p) => {
    const st = p.row[5] === 'EXCUSED' ? 'EXCUSED' : (p.present ? 'PRESENT' : 'ABSENT');
    return { employee: card(p.row), state: st, state_label: EXPECTED_LABELS[st], entry: p.present ? p.row[6] : null, excused_status: st === 'EXCUSED' ? 'conge' : null };
  });
  const todo = siteId === 1 ? [
    { key: 'a1', anomaly_id: 1, code: 'EXTRA_SHIFT', label: 'Maintien à qualifier', severity: 'warning', message: 'Maintien après la vacation de nuit', employee: card(PEOPLE[8]), scheduled_end: '06:00', overdue_since: null, action: null },
    { key: 'r2', anomaly_id: null, code: 'MANUAL_ENTRY_REQUIRED', label: 'Saisie manuelle requise', severity: 'warning', message: 'Fenêtre de maintien terminée', employee: card(PEOPLE[9]), scheduled_end: '06:00', overdue_since: '06:45', action: 'MANUAL_ENTRY' },
  ] : [];
  const absent = expected.filter((r) => r.state === 'ABSENT').length;
  return {
    site_id: siteId, site: SITES[siteId - 1].name, status: 'OFFICIAL', reason: null,
    current: { shift: 'MATIN', shift_label: 'Matin', group: 'A', work_date: DAY, start: '06:00', end: '14:00', scheduled_start: `${DAY}T06:00:00+01:00`, scheduled_end: `${DAY}T14:00:00+01:00` },
    next: { shift: 'APRES_MIDI', shift_label: 'Après-midi', group: 'B', work_date: DAY, start: '14:00', end: '22:00', scheduled_start: `${DAY}T14:00:00+01:00`, scheduled_end: `${DAY}T22:00:00+01:00` },
    maintien: null,
    kpi: { expected: expected.length, present: present.length, absent, excused: expected.filter((r) => r.state === 'EXCUSED').length,
      maintien: present.filter((r) => r.badge === 'EN_MAINTIEN').length, anomalies: todo.length },
    activity: { refused_today: 1 }, present, expected, todo, movements: [], permissions: { manual_entry: true },
  };
}

function overviewPost(state) {
  const posts = SITES.map((s) => sitePost(state, s.id));
  const sum = (key) => posts.reduce((n, p) => n + p.kpi[key], 0);
  const present = posts.flatMap((p) => p.present.map((r) => ({ ...r, site: p.site })));
  return { site: 'Sites sélectionnés', status: 'OVERVIEW', current: null, next: null, maintien: null,
    kpi: { expected: sum('expected'), absent: sum('absent'), excused: sum('excused'), present: present.length, maintien: sum('maintien'), anomalies: sum('anomalies') },
    present, expected: posts.flatMap((p) => p.expected.map((r) => ({ ...r, site: p.site }))), todo: posts.flatMap((p) => p.todo.map((r) => ({ ...r, site: p.site }))),
    movements: [], activity: { refused_today: 1 }, permissions: { manual_entry: true } };
}

function feed(state, siteId) {
  const people = state.people.filter((p) => !siteId || p.row[4] === siteId);
  const base = (p) => ({ employee_id: p.row[0], matricule: 'T' + p.row[0], nom: `${p.row[1]} ${p.row[2]}`, photo: PHOTO, poste: p.row[3], societe: SOCIETY,
    site: SITES[p.row[4] - 1].name, site_id: p.row[4], cycle: 1, source: 'QR' });
  const events = [];
  for (const p of people) {
    if (p.row[6]) events.push({ ...base(p), action: 'arrivee', scanned_at: `${DAY}T${p.row[6]}:00+01:00` });
    if (p.departure) events.push({ ...base(p), action: 'depart', scanned_at: `${DAY}T${p.departure}:00+01:00`, duration_minutes: 200, exit_type: p.abandon ? 'Abandon poste' : 'Sortie' });
    if (p.absentSaved) events.push({ ...base(p), action: 'absent', scanned_at: `${DAY}T10:05:00+01:00`, observation: 'Absence constatée' });
  }
  const daily = people.filter((p) => p.row[6] || p.absentSaved).map((p) => ({ ...base(p), date: DAY, arrival: p.row[6] ? p.row[6] + ':00' : '', departure: p.departure ? p.departure + ':00' : '',
    status: p.absentSaved ? 'Absent' : p.abandon ? 'Abandon poste' : p.departure ? 'Sorti' : 'En poste' }));
  return { events, daily };
}

function abandonContext(person, siteId) {
  if (!person.present) return [409, { detail: 'Abandon de poste refusé : aucune prise de service ouverte' }];
  if (person.row[0] === 104) return [409, { detail: 'Abandon de poste refusé : aucune vacation valide enregistrée' }];
  const remaining = person.row[0] === 105 ? 42.5 : 225;
  return [200, { shift_id: person.row[0] * 10, scheduled_start_at: `${DAY}T06:00:00+01:00`, scheduled_end_at: `${DAY}T14:00:00+01:00`,
    actual_departure_at: SERVER_NOW, remaining_minutes: remaining, threshold_minutes: 60, applicable: remaining >= 60,
    employee_id: person.row[0], matricule: 'T' + person.row[0], employee_name: `${person.row[1]} ${person.row[2]}`, society: SOCIETY,
    site_id: siteId, site_name: SITES[person.row[4] - 1].name, position: person.row[3], shift: 'MATIN', group: 'A' }];
}

// Arrivée ou sortie selon l'état réel (comme Attendance Core), publiée dans le flux live.
function toggle(state, person) {
  const leaving = person.present;
  person.present = !leaving; if (leaving) person.departure = '10:15'; else person.row = [...person.row.slice(0, 6), '10:15'];
  const ev = { id: state.nextEvent++, type: leaving ? 'SORTIE' : 'ENTREE', employee: card(person.row), site: SITES[person.row[4] - 1].name, heure: '10:15:00', date: DAY, state: leaving ? 'SORTI' : 'PRESENT', source: 'QR' };
  state.events.push(ev);
  return { success: true, action: leaving ? 'depart' : 'arrivee', heure: '10:15:00', date: DAY, site: ev.site, event_id: ev.id, employee: card(person.row), message: leaving ? 'Départ enregistré' : 'Arrivée enregistrée' };
}

// Réponse simulée d'une requête /api/… : [statut, corps].
function respond(state, method, url, body) {
  const site = Number(url.searchParams.get('site_id')) || 0;
  const find = (id) => state.people.find((p) => p.row[0] === Number(id));
  const p = url.pathname;
  if (p.endsWith('/attendance-sites')) return [200, SITES];
  if (p.endsWith('/attendance-live')) {
    const after = Number(url.searchParams.get('after_id'));
    const events = url.searchParams.has('after_id') ? state.events.filter((e) => e.id > after) : [];
    return [200, { latest_event_id: state.nextEvent - 1, latest_refusal_id: 0, events, refusals: [], alerts: [], summary: { entries_today: 10, exits_today: 0, present_now: 9, absent_today: 0 },
      post: site ? sitePost(state, site) : overviewPost(state), timezone: 'Africa/Algiers', server_now: SERVER_NOW, operational_date: DAY }];
  }
  if (p.endsWith('/attendance-feed')) return [200, feed(state, site)];
  if (p.endsWith('/attendance-anomalies')) return [200, []];
  if (p.endsWith('/attendance-sheet')) return [200, { configured: false }];
  if (p.endsWith('/attendance-staffing')) return [200, { sites: [], contractual: { source: 'dc-unconfigured' } }];
  if (p.endsWith('/attendance-alerts')) return [200, { presence_alerts: [] }];
  if (p.endsWith('/attendance-manual/search')) {
    const q = String(url.searchParams.get('q') || '').toUpperCase();
    return [200, state.people.filter((x) => (!site || x.row[4] === site) && (`T${x.row[0]} ${x.row[1]} ${x.row[2]}`).toUpperCase().includes(q)).slice(0, 8).map((x) => card(x.row))];
  }
  if (p.endsWith('/attendance-manual/context')) return [200, { employee: card(find(url.searchParams.get('employee_id')).row), extra_shift: null, abandon_threshold_minutes: 60, manual_entry_allowed: true, intent: null, reentry: null, reason_required: false, audited: true }];
  if (p.endsWith('/attendance-manual/abandon/context')) return abandonContext(find(url.searchParams.get('employee_id')), site);
  if (p.endsWith('/attendance-manual/abandon') && method === 'POST') {
    state.writes.push({ kind: 'abandon', ...body });
    const person = find(body.employee_id);
    const [status, ctx] = abandonContext(person, site);
    if (status !== 200) return [status, ctx];
    if (!ctx.applicable) return [409, { detail: 'Abandon de poste non applicable : il reste 42 minutes avant la fin prévue du service. Le seuil requis est de 60 minutes.' }];
    person.present = false; person.departure = '10:15'; person.abandon = true;
    state.events.push({ id: state.nextEvent++, type: 'SORTIE', employee: card(person.row), site: SITES[person.row[4] - 1].name, heure: '10:15:00', state: 'SORTI' });
    return [201, { success: true, duplicate: false, event_id: 900, action: 'abandon_poste', message: 'ABANDON DE POSTE ENREGISTRÉ', observation: body.observation, ...ctx,
      notifications: { OPS: { status: 'CREATED', alert_id: 1 }, DRH: { status: 'CREATED', alert_id: 2 } } }];
  }
  if (p.endsWith('/attendance-manual/scan') && method === 'POST') {
    state.writes.push({ kind: 'scan', ...body });
    const person = find(body.employee_id);
    if (body.action === 'absent') { person.absentSaved = true; return [201, { success: true, action: 'absent', heure: '10:15:00', employee: card(person.row) }]; }
    return [201, toggle(state, person)];
  }
  // Badge QR (douchette) : le jeton est transmis tel quel ; le serveur simulé reconnaît « T<id> » dans le jeton.
  if (p.endsWith('/attendance-qr/scan') && method === 'POST') {
    state.writes.push({ kind: 'qr', ...body });
    const match = /T(\d{3})/.exec(String(body.token || ''));
    const person = match && find(match[1]);
    if (!person) return [400, { detail: 'QR non reconnu' }];
    return [201, toggle(state, person)];
  }
  return [200, {}];
}

module.exports = { SOCIETY, SITES, SERVER_NOW, DAY, PHOTO, PEOPLE, createState, respond, sitePost, overviewPost };
