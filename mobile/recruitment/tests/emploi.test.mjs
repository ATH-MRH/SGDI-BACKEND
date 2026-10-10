import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API, ApiError, ORIGIN, request} from '../src/lib/api.ts';
import {activeFilterCount, CHILDREN_OPTIONS, digitsOnly, displayDate, formatMoney, HEIGHT_OPTIONS, isoDate, LANGUAGE_OPTIONS, latestBirthDate, moneyInput, parseIsoDate, parseMoney, SHIRT_OPTIONS, SHOE_OPTIONS, withCurrent, alertLabel, applicationSteps, calendarMonth, fetchOffer, fetchOffers, fileSize, formatDate, formatDateTime, formToProfile, initials, interviewDays, isClosed, jobIcon, lines, notificationLabel, pushProblem, PUSH_TEXT, messageTime, newRequestId, notificationTarget, offersPath, parseTipBody, profileCompleteness, profileToForm, splitInterviews, stateScope, stateTone, validateForm} from '../src/lib/emploi.ts';

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
  assert.equal(profile.children_count, null, 'non renseigné, et non zéro'); assert.equal(profile.expected_salary, null); assert.deepEqual(profile.languages, []); assert.deepEqual(profile.experience, []);
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
  assert.match(validateForm({...ok, birth_date: '04/05/1990'}, [], {needPosition: true}), /invalide/);
  assert.match(validateForm({...ok, birth_date: '2023-02-30'}, [], {needPosition: true}), /invalide/);
  assert.match(validateForm(ok, [{society: 'A', position: 'B', start_date: '2020', end_date: '', departure_reason: ''}], {needPosition: true}), /date invalide/);
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

test('notifications push : ce qui bloque est identifié avant toute demande d’autorisation', () => {
  const phone = { os: 'ios', expoGo: false, physical: true, projectId: 'p' };
  assert.equal(pushProblem(phone), null);
  assert.equal(pushProblem({ ...phone, os: 'web' }), 'unsupported');
  assert.equal(pushProblem({ ...phone, expoGo: true }), 'expo-go');
  assert.equal(pushProblem({ ...phone, physical: false }), 'simulator');
  assert.equal(pushProblem({ ...phone, projectId: undefined }), 'unconfigured');
  for (const status of ['unsupported', 'expo-go', 'simulator', 'unconfigured', 'idle', 'denied', 'registered', 'error']) assert.ok(PUSH_TEXT[status]);
});

test('notification : le bouton du détail annonce l’écran ouvert', () => {
  assert.equal(notificationLabel({ kind: 'message', application_id: 4, offer_id: null }), 'Ouvrir la conversation');
  assert.equal(notificationLabel({ kind: 'interview', application_id: 4, offer_id: null }), 'Voir mes entretiens');
  assert.equal(notificationLabel({ kind: 'offer', application_id: null, offer_id: 9 }), 'Voir l’offre');
  assert.equal(notificationLabel({ kind: 'application', application_id: 4, offer_id: null }), 'Voir la candidature');
  assert.equal(notificationLabel({ kind: 'application', application_id: null, offer_id: null }), 'Voir mes candidatures');
});

test('montant : affichage « 50 000,00 DA », lecture d’une saisie ou d’un collage, deux décimales sans perte', () => {
  const plain = text => text.replace(/[  ]/g, ' ');
  assert.equal(plain(formatMoney(50000)), '50 000,00 DA'); assert.equal(plain(formatMoney(1234567.5)), '1 234 567,50 DA');
  assert.equal(plain(formatMoney(0.1 + 0.2)), '0,30 DA'); assert.equal(formatMoney(null), '');
  for (const [text, amount] of [['50 000,00 DA', 50000], ['50.000,50', 50000.5], ['50,000.50', 50000.5], ['50000.5', 50000.5], ['50000', 50000], ['1.234.567', 1234567], ['0,07', 0.07], ['85 000 DZD', 85000]])
    assert.equal(parseMoney(text), amount, text);
  assert.equal(parseMoney(''), null); assert.ok(Number.isNaN(parseMoney('abc'))); assert.ok(Number.isNaN(parseMoney('-5')));
  // Saisie caractère par caractère : rien n'est regroupé, une seule virgule, deux décimales au plus.
  let typed = ''; for (const key of '50000,507') typed = moneyInput(typed + key, typed);
  assert.equal(typed, '50000,50');
  assert.equal(moneyInput('1234.', '1234'), '1234,'); assert.equal(moneyInput('12a', '12'), '12');
  // Collage : le montant entier est compris, séparateurs de milliers inclus.
  assert.equal(moneyInput('50 000,00 DA', ''), '50000'); assert.equal(moneyInput('1.234.567,8', ''), '1234567,80');
  assert.equal(formToProfile({ expected_salary: '50000,50' }, []).expected_salary, 50000.5);
  assert.equal(formToProfile({ expected_salary: '' }, []).expected_salary, null);
});

test('dates : JJ/MM/AAAA à l’écran, AAAA-MM-JJ pour l’API, naissance ni future ni mineure', () => {
  assert.equal(displayDate('1994-03-12'), '12/03/1994'); assert.equal(displayDate(''), ''); assert.equal(displayDate('1994-02-30'), '');
  assert.equal(isoDate(new Date(2026, 9, 5)), '2026-10-05'); assert.equal(isoDate(parseIsoDate('2000-01-31')), '2000-01-31'); assert.equal(parseIsoDate('31/01/2000'), null);
  const today = new Date(2026, 9, 10);
  assert.equal(isoDate(latestBirthDate(today)), '2007-10-10');
  const check = (values, experience = []) => validateForm(values, experience, { needPosition: false, today });
  assert.equal(check({ birth_date: '2007-10-10' }), ''); assert.match(check({ birth_date: '2007-10-11' }), /au moins 19 ans/);
  assert.match(check({ birth_date: '2027-01-01' }), /futur/); assert.match(check({ birth_date: '12/03/1994' }), /invalide/);
  const row = { society: '', position: '', departure_reason: '' };
  assert.match(check({}, [{ ...row, start_date: '2022-01-01', end_date: '2021-01-01' }]), /précède/);
  assert.match(check({}, [{ ...row, start_date: '2027-01-01', end_date: '' }]), /futur/);
  assert.equal(check({}, [{ ...row, start_date: '2020-01-01', end_date: '2022-06-30' }]), '');
});

test('profil : NIN en chiffres avec zéros initiaux, enfants non renseignés ≠ 0, langues parlées et écrites, données historiques conservées', () => {
  assert.equal(digitsOnly('00 12-34a'), '001234'); assert.equal(digitsOnly('1'.repeat(30)).length, 18);
  assert.match(validateForm({ nin: '12A' }, [], { needPosition: false }), /que des chiffres/);
  assert.match(validateForm({ nin: '001234567' }, [], { needPosition: false }), /10 ou 18 chiffres/);
  assert.equal(validateForm({ nin: '0012345678' }, [], { needPosition: false }), ''); assert.equal(validateForm({ nin: '001234567890123456' }, [], { needPosition: false }), '');
  const base = { source: 'Salon de l’emploi', emergency_name: 'Ancien contact', skills: ['Permis B'], education: [{ degree: 'BAC' }] };
  const saved = formToProfile({ nin: '001234567890123456', children_count: '', languages: 'Arabe, Kabyle', written_languages: 'Français', emergency_relation: 'Frère' }, [], base);
  assert.equal(saved.nin, '001234567890123456'); assert.equal(saved.children_count, null);
  assert.deepEqual(saved.languages, ['Arabe', 'Kabyle']); assert.deepEqual(saved.written_languages, ['Français']);
  // Ce que le formulaire ne saisit plus n'est pas effacé.
  assert.equal(saved.source, 'Salon de l’emploi'); assert.equal(saved.emergency_name, 'Ancien contact'); assert.deepEqual(saved.skills, ['Permis B']);
  assert.equal(formToProfile({ children_count: '0' }, []).children_count, 0);
  const form = profileToForm({ children_count: 0, languages: ['Kabyle'], written_languages: ['Arabe', 'Français'], height: 178, source: 'x' }, { first_name: 'A', last_name: 'B', phone: '+213' }).values;
  assert.equal(form.children_count, '0'); assert.equal(form.written_languages, 'Arabe, Français'); assert.equal(form.height, '178'); assert.equal(form.source, undefined);
  assert.equal(profileToForm({ children_count: null }, { first_name: 'A', last_name: 'B', phone: '+213' }).values.children_count, undefined);
  assert.ok(LANGUAGE_OPTIONS.includes('Kabyle'));
  assert.equal(CHILDREN_OPTIONS.length, 17); assert.equal(CHILDREN_OPTIONS[0].value, ''); assert.equal(CHILDREN_OPTIONS.at(-1).value, '15');
  // Une valeur historique hors liste reste proposée.
  assert.equal(withCurrent(HEIGHT_OPTIONS, '215').at(-1).value, '215'); assert.equal(withCurrent(HEIGHT_OPTIONS, '180').length, HEIGHT_OPTIONS.length);
  assert.equal(HEIGHT_OPTIONS[1].label, '140 cm'); assert.equal(SHOE_OPTIONS[1].value, '35'); assert.equal(SHIRT_OPTIONS.at(-1).value, 'XXXL');
});
