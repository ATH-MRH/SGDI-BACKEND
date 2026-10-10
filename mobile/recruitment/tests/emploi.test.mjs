import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API, ApiError, ORIGIN, request} from '../src/lib/api.ts';
import {activeFilterCount, alertLabel, applicationSteps, calendarMonth, fetchOffer, fetchOffers, fileSize, formatDate, formatDateTime, formToProfile, initials, interviewDays, isClosed, jobIcon, lines, logoUri, messageTime, newRequestId, notificationTarget, offersPath, parseTipBody, profileCompleteness, profileToForm, splitInterviews, stateScope, stateTone, validateForm} from '../src/lib/emploi.ts';

const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), {status});
const identity = {first_name: 'Nadia', last_name: 'Test', phone: '+213551122334'};

test('l’application parle au serveur de production en HTTPS par défaut', () => {
  assert.equal(API, 'https://recrute.irongs.com/api');
  assert.equal(ORIGIN, 'https://recrute.irongs.com');
});

test('recherche et filtres : seuls les critères renseignés sont envoyés, correctement encodés', () => {
  assert.equal(offersPath(), '/public/emploi/offers?page=1&page_size=20');
  assert.equal(offersPath({q: '  agent de sécurité ', wilaya: 'Alger', profession: '', contract_type: 'CDI', company_id: 7}, 2),
    '/public/emploi/offers?q=agent%20de%20s%C3%A9curit%C3%A9&wilaya=Alger&contract_type=CDI&company_id=7&page=2&page_size=20');
  assert.equal(activeFilterCount({q: 'agent'}), 0);
  assert.equal(activeFilterCount({wilaya: 'Oran', company_id: 3, profession: ''}), 2);
});

test('les offres se lisent sans jeton : aucune connexion n’est nécessaire', async () => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push([url, init]); return response({items: [], total: 0, page: 1, pages: 1, facets: {}}); };
  await fetchOffers({wilaya: 'Oran'}, 1);
  await fetchOffer(12);
  assert.deepEqual(calls.map(([url]) => url), [API + '/public/emploi/offers?wilaya=Oran&page=1&page_size=20', API + '/public/emploi/offers/12']);
  for (const [, init] of calls) { assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, undefined); }
});

test('une annonce devenue indisponible est identifiable (404), une annonce clôturée aussi (409)', async () => {
  global.fetch = async () => response({detail: 'Cette annonce n’est plus disponible.'}, 404);
  await assert.rejects(fetchOffer(3), e => e instanceof ApiError && e.status === 404);
  global.fetch = async () => response({detail: 'Cette annonce est clôturée et n’accepte plus de candidature.'}, 409);
  await assert.rejects(request('/public/emploi/applications', {token: 't', body: {}}), e => e.status === 409 && /clôturée/.test(e.message));
});

test('déconnexion et suppressions : DELETE avec le jeton, réponse vide acceptée', async () => {
  global.fetch = async (url, init) => { assert.equal(init.method, 'DELETE'); assert.equal(init.headers.Authorization, 'Bearer session-test'); assert.equal(init.body, undefined); return response(null, 204); };
  assert.equal(await request('/public/emploi/session', {token: 'session-test', method: 'DELETE'}), undefined);
});

test('une session expirée reste identifiable (401)', async () => {
  global.fetch = async () => response({detail: 'Votre session a expiré. Identifiez-vous à nouveau par SMS.'}, 401);
  await assert.rejects(request('/public/emploi/me', {token: 'old'}), e => e instanceof ApiError && e.status === 401 && /expiré/.test(e.message));
});

test('profil enregistré -> formulaire -> profil : aucune donnée perdue ni inventée', () => {
  const profile = {email: 'nadia@example.com', birth_date: '1990-05-04', wilaya: 'Alger', commune: 'Hydra', children_count: 2, expected_salary: 55000, height: 170.5,
    shoe_size: null, languages: ['Arabe', 'Français'], availability: 'Immédiate', nin: null,
    experience: [{society: 'ACME', position: 'Agent', start_date: '2020-01-01', end_date: '2022-01-01', departure_reason: null}]};
  const {values, experience} = profileToForm(profile, identity);
  assert.deepEqual({first_name: values.first_name, last_name: values.last_name, phone: values.phone}, identity);
  assert.equal(values.children_count, '2'); assert.equal(values.expected_salary, '55000'); assert.equal(values.height, '170.5');
  assert.equal(values.languages, 'Arabe, Français'); assert.equal(values.shoe_size, undefined); assert.equal(values.nin, undefined);
  assert.deepEqual(experience, [{society: 'ACME', position: 'Agent', start_date: '2020-01-01', end_date: '2022-01-01', departure_reason: ''}]);
  const back = formToProfile(values, experience);
  for (const key of Object.keys(profile)) assert.deepEqual(back[key], profile[key], key);
  // L'identité vérifiée par SMS n'est jamais renvoyée dans le profil.
  for (const key of ['first_name', 'last_name', 'phone']) assert.equal(key in back, false);
});

test('formulaire vide : profil vide, sans valeur fabriquée', () => {
  const {values, experience} = profileToForm({}, identity);
  assert.deepEqual(values, identity); assert.deepEqual(experience, []);
  const profile = formToProfile(values, [{society: '  ', position: '', start_date: '', end_date: '', departure_reason: ''}]);
  assert.equal(profile.children_count, 0); assert.equal(profile.expected_salary, null); assert.deepEqual(profile.languages, []); assert.deepEqual(profile.experience, []);
  assert.equal(profile.email, null);
});

test('saisie : montants avec espaces ou virgule, langues séparées par des virgules', () => {
  const profile = formToProfile({...identity, expected_salary: '55 000,50', languages: ' Arabe ,, Anglais '}, []);
  assert.equal(profile.expected_salary, 55000.5); assert.deepEqual(profile.languages, ['Arabe', 'Anglais']);
});

test('contrôles avant envoi', () => {
  const ok = {...identity, desired_position: 'Agent polyvalent'};
  assert.equal(validateForm(ok, [], {needPosition: true}), '');
  assert.match(validateForm(identity, [], {needPosition: true}), /poste souhaité/);
  assert.equal(validateForm(identity, [], {needPosition: false}), '', 'le poste vient de l’annonce');
  assert.match(validateForm({...ok, birth_date: '04/05/1990'}, [], {needPosition: true}), /AAAA-MM-JJ/);
  assert.match(validateForm({...ok, birth_date: '2023-02-30'}, [], {needPosition: true}), /AAAA-MM-JJ/);
  assert.match(validateForm(ok, [{society: 'A', position: 'B', start_date: '2020', end_date: '', departure_reason: ''}], {needPosition: true}), /AAAA-MM-JJ/);
  assert.match(validateForm({...ok, expected_salary: '-5'}, [], {needPosition: true}), /Salaire/);
  assert.match(validateForm({...ok, height: 'grand'}, [], {needPosition: true}), /Taille/);
  assert.match(validateForm({...ok, email: 'pas-un-email'}, [], {needPosition: true}), /e-mail/);
});

test('avancement du profil : calculé sur les champs réellement renseignés', () => {
  assert.equal(profileCompleteness({profile: {}, cv: null}), 0);
  assert.equal(profileCompleteness({profile: {wilaya: 'Alger', email: 'a@b.dz'}, cv: {name: 'cv.pdf', mime_type: 'application/pdf', size: 10}}), 27);
  const full = {birth_date: '1990-01-01', sex: 'F', address: 'x', wilaya: 'Alger', commune: 'Hydra', email: 'a@b.dz', availability: 'Immédiate', emergency_phone: '0550', experience: [{}], skills: ['Permis B']};
  assert.equal(profileCompleteness({profile: full, cv: {name: 'cv.pdf', mime_type: 'application/pdf', size: 10}}), 100);
});

test('affichage : texte du recruteur en lignes, dates, initiales, logos du serveur uniquement', () => {
  assert.deepEqual(lines('- Surveiller le site\n\n• Contrôler les accès\r\n  Signaler  '), ['Surveiller le site', 'Contrôler les accès', 'Signaler']);
  assert.deepEqual(lines(''), []);
  assert.equal(formatDate('2026-11-02'), '2 nov. 2026'); assert.equal(formatDate('2026-10-13T10:00:00'), '13 oct. 2026'); assert.equal(formatDate(null), '');
  assert.equal(initials('IRON Global Sécurité'), 'IS'); assert.equal(initials('Nadia'), 'NA');
  assert.equal(logoUri({logo_url: '/static/iron-securite-logo.png'}), 'https://recrute.irongs.com/static/iron-securite-logo.png');
  assert.equal(logoUri({logo_url: 'https://ailleurs.example/logo.png'}), null); assert.equal(logoUri({logo_url: null}), null);
});

test('suivi : chaque candidature à une annonce a son état, une candidature spontanée suit le dossier', () => {
  // États propres à une candidature à une annonce.
  assert.deepEqual(['received', 'shortlisted', 'interview', 'accepted', 'declined', 'withdrawn'].map(stateTone), ['neutral', 'gold', 'green', 'green', 'red', 'neutral']);
  // États du dossier (candidatures spontanées et historiques).
  assert.deepEqual(['review', 'invited', 'interviewed', 'reserve', 'transmitted_drh', 'recruited'].map(stateTone), ['blue', 'gold', 'gold', 'neutral', 'green', 'green']);
  assert.equal(stateTone('etat-ajoute-plus-tard'), 'neutral', 'un état inconnu reste affichable');
  assert.equal(stateScope({kind: 'offer'}).heading, 'État de votre candidature');
  assert.match(stateScope({kind: 'offer'}).note, /que cette annonce/);
  assert.equal(stateScope({kind: 'spontaneous'}).heading, 'État de votre dossier');
});

test('suivi : la liste donne une candidature par annonce et, à part, le dossier', async () => {
  const body = {dossier: {reference: 'CAND-2026-000007', state: {status: 'invited', label: 'Convocation programmée', message: 'm', convocation: {date: '2026-11-02', heure: '10:00', lieu: 'Siège'}}},
    items: [{id: 2, kind: 'offer', position: 'Cariste', reference: 'CAND-2026-000007', state: {status: 'declined', label: 'Non retenue', message: 'm'}, offer: {id: 3}},
            {id: 1, kind: 'offer', position: 'Agent', reference: 'CAND-2026-000007', state: {status: 'interview', label: 'Entretien', message: 'm'}, offer: {id: 1}}]};
  global.fetch = async (url, init) => { assert.equal(url, API + '/public/emploi/applications'); assert.equal(init.headers.Authorization, 'Bearer session-test'); return response(body); };
  const list = await request('/public/emploi/applications', {token: 'session-test'});
  assert.deepEqual(list.items.map(item => [item.id, item.state.status, stateTone(item.state.status)]), [[2, 'declined', 'red'], [1, 'interview', 'green']]);
  assert.equal(new Set(list.items.map(item => item.reference)).size, 1, 'un seul dossier');
  assert.equal(list.dossier.state.convocation.heure, '10:00');
});

test('identifiant d’envoi : accepté par le serveur et différent à chaque candidature', () => {
  const ids = new Set(Array.from({length: 200}, newRequestId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
});

test('profil : les rubriques gérées hors du formulaire (études, compétences) survivent à un enregistrement', () => {
  const base = {skills: ['Permis B'], education: [{degree: 'BTS'}], wilaya: 'Oran'};
  const saved = formToProfile({...identity, wilaya: 'Alger'}, [], base);
  assert.deepEqual(saved.skills, ['Permis B']); assert.deepEqual(saved.education, [{degree: 'BTS'}]); assert.equal(saved.wilaya, 'Alger');
});

test('progression d’une candidature : un refus ou un retrait n’est jamais une progression réussie', () => {
  const states = status => applicationSteps(status).map(step => step.state);
  assert.deepEqual(applicationSteps('received').map(step => step.label), ['Reçue', 'En examen', 'Entretien', 'Décision']);
  assert.deepEqual(states('received'), ['done', 'todo', 'todo', 'todo']);
  assert.deepEqual(states('review'), ['done', 'current', 'todo', 'todo']);
  assert.deepEqual(states('shortlisted'), ['done', 'done', 'todo', 'todo']); assert.equal(applicationSteps('shortlisted')[1].label, 'Présélection');
  assert.deepEqual(states('interview'), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(states('accepted'), ['done', 'done', 'done', 'done']); assert.equal(applicationSteps('accepted')[3].label, 'Retenue');
  for (const status of ['declined', 'withdrawn']) { assert.deepEqual(states(status), ['past', 'past', 'past', 'failed']); assert.equal(states(status).includes('done'), false); }
  assert.equal(applicationSteps('declined')[3].label, 'Non retenue'); assert.equal(applicationSteps('withdrawn')[3].label, 'Retirée');
  assert.deepEqual(states('etat-inconnu'), ['done', 'todo', 'todo', 'todo']);
  assert.deepEqual(['received', 'review', 'interview', 'accepted', 'declined', 'withdrawn', 'recruited'].map(status => isClosed({state: {status}})), [false, false, false, true, true, true, true]);
});

test('entretiens : calendrier du lundi au dimanche, jours réels, à venir et passés', () => {
  const october = calendarMonth(2026, 10);
  assert.deepEqual(october[0], [null, null, null, 1, 2, 3, 4]); assert.deepEqual(october[2], [12, 13, 14, 15, 16, 17, 18]); assert.equal(october.at(-1).filter(Boolean).at(-1), 31);
  assert.deepEqual(calendarMonth(2027, 2).flat().filter(Boolean).length, 28); assert.ok(calendarMonth(2026, 11).every(week => week.length === 7));
  const items = [{id: 1, starts_at: '2026-10-13T10:00:00', status: 'proposed', past: false}, {id: 2, starts_at: '2026-10-20T09:00:00', status: 'cancelled', past: false},
    {id: 3, starts_at: '2026-10-02T09:00:00', status: 'done', past: true}, {id: 4, starts_at: '2026-11-03T09:00:00', status: 'confirmed', past: false}];
  assert.deepEqual([...interviewDays(items, 2026, 10)].sort((a, b) => a - b), [2, 13]); assert.deepEqual([...interviewDays(items, 2026, 11)], [3]);
  const {upcoming, past} = splitInterviews(items);
  assert.deepEqual(upcoming.map(item => item.id), [1, 4]); assert.deepEqual(past.map(item => item.id), [3, 2], 'un entretien annulé n’est plus « à venir »');
  assert.equal(formatDateTime('2026-10-13T10:00:00'), 'Mardi 13 octobre 2026 · 10 h 00');
});

test('messages : horodatage serveur (UTC) affiché à l’heure d’Alger', () => {
  assert.equal(messageTime('2026-10-10T09:14:05', '2026-10-10'), '10:14');
  assert.equal(messageTime('2026-10-09T23:30:00', '2026-10-10'), '00:30', 'après minuit à Alger, c’est déjà aujourd’hui');
  assert.equal(messageTime('2026-10-08T09:14:05', '2026-10-10'), '8 oct. · 10:14'); assert.equal(messageTime(null), '');
});

test('notifications : chaque famille ouvre l’écran concerné', () => {
  assert.deepEqual(notificationTarget({kind: 'message', application_id: 3, offer_id: null}), {pathname: '/messages/[id]', params: {id: '3'}});
  assert.deepEqual(notificationTarget({kind: 'interview', application_id: 3, offer_id: null}), {pathname: '/applications/interviews'});
  assert.deepEqual(notificationTarget({kind: 'offer', application_id: null, offer_id: 9}), {pathname: '/offers/[id]', params: {id: '9'}});
  assert.deepEqual(notificationTarget({kind: 'application', application_id: 3, offer_id: null}), {pathname: '/applications/[id]', params: {id: '3'}});
  assert.deepEqual(notificationTarget({kind: 'application', application_id: null, offer_id: null}), {pathname: '/applications'});
});

test('présentation : icône de métier, libellé d’alerte, conseil rédigé par le recrutement, taille de fichier', () => {
  assert.deepEqual([{title: 'Agent de sécurité'}, {title: 'Cariste'}, {profession: 'Nettoyage', title: 'Agent'}, {title: 'Magasinier'}, {title: 'Comptable'}].map(jobIcon), ['shield', 'forklift', 'sparkles', 'box', 'briefcase']);
  assert.equal(alertLabel({profession: 'Sécurité', wilaya: 'Alger', contract_type: null, company: null}), 'Sécurité · Alger'); assert.equal(alertLabel({profession: null, wilaya: null, contract_type: null, company: null}), 'Toutes les offres');
  assert.deepEqual(parseTipBody('La veille\n- Relisez l’annonce\n• Préparez vos documents\n\nLe jour même\n- Arrivez en avance'),
    [{heading: 'La veille', points: ['Relisez l’annonce', 'Préparez vos documents']}, {heading: 'Le jour même', points: ['Arrivez en avance']}]);
  assert.deepEqual(parseTipBody('- Idée sans titre'), [{heading: '', points: ['Idée sans titre']}]);
  assert.equal(fileSize(245 * 1024), '245 Ko'); assert.equal(fileSize(5 * 1048576), '5,0 Mo'); assert.equal(fileSize(10), '1 Ko');
});
