import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API, ApiError, ORIGIN, request} from '../src/lib/api.ts';
import {activeFilterCount, fetchOffer, fetchOffers, formatDate, formToProfile, initials, lines, logoUri, newRequestId, offersPath, profileCompleteness, profileToForm, stateScope, stateTone, validateForm} from '../src/lib/emploi.ts';

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
  assert.equal(profileCompleteness({profile: {wilaya: 'Alger', email: 'a@b.dz'}, cv: {name: 'cv.pdf', mime_type: 'application/pdf', size: 10}}), 30);
  const full = {birth_date: '1990-01-01', sex: 'F', address: 'x', wilaya: 'Alger', commune: 'Hydra', email: 'a@b.dz', availability: 'Immédiate', emergency_phone: '0550', experience: [{}]};
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
  assert.deepEqual(['received', 'shortlisted', 'interview', 'accepted', 'declined'].map(stateTone), ['neutral', 'gold', 'gold', 'green', 'red']);
  // États du dossier (candidatures spontanées et historiques).
  assert.deepEqual(['review', 'invited', 'interviewed', 'reserve', 'transmitted_drh', 'recruited'].map(stateTone), ['neutral', 'gold', 'gold', 'neutral', 'green', 'green']);
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
  assert.deepEqual(list.items.map(item => [item.id, item.state.status, stateTone(item.state.status)]), [[2, 'declined', 'red'], [1, 'interview', 'gold']]);
  assert.equal(new Set(list.items.map(item => item.reference)).size, 1, 'un seul dossier');
  assert.equal(list.dossier.state.convocation.heure, '10:00');
});

test('identifiant d’envoi : accepté par le serveur et différent à chaque candidature', () => {
  const ids = new Set(Array.from({length: 200}, newRequestId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
});
