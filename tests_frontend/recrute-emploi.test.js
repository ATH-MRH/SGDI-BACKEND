// Traitement des candidatures IRON Emploi dans recrute.irongs.com (recrute-emploi.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const page = fs.readFileSync(path.join(STATIC, 'recrute.html'), 'utf8');
const script = fs.readFileSync(path.join(STATIC, 'recrute-emploi.js'), 'utf8');
const convocations = fs.readFileSync(path.join(STATIC, 'recrute-convocations.js'), 'utf8');
const texts = nodes => [...nodes].map(node => node.textContent.replace(/\s+/g, ' ').trim());
const STAGES = [['received', 'Réception'], ['review', 'Examen du dossier'], ['shortlisted', 'Présélection'], ['convocation', 'Convocation'], ['interview', 'Entretien'],
  ['decision', 'Décision'], ['hiring_file', 'Dossier d’embauche'], ['contract', 'Préparation du contrat'], ['signature', 'Signature'], ['hired', 'Recrutement effectif']].map(([code, label]) => ({ code, label }));
const COUNTERS = [['new', 'Nouvelles candidatures', 2], ['review', 'Dossiers à examiner', 1], ['shortlisted', 'Présélections', 0], ['interviews', 'Entretiens à venir', 1],
  ['missing_documents', 'Pièces manquantes', 1], ['decisions', 'Décisions en attente', 1], ['contracts_prepare', 'Contrats à préparer', 0], ['contracts_sign', 'Contrats à signer', 0],
  ['hired', 'Recrutements finalisés', 0]].map(([key, label, count]) => ({ key, label, count }));

const item = (id, extra = {}) => ({ id, reference: `CAND-2026-00000${id}`, kind: 'offer', title: 'Agent de sécurité', offer: { id: 1, title: 'Agent de sécurité', wilaya: 'Alger' }, society: 'IRON GLOBAL SÉCURITÉ',
  received_at: '2026-10-09T08:30:00', candidate: { id: 40 + id, first_name: 'Nadia', last_name: `TEST${id}`, phone: '+213551122334', wilaya: 'Alger' }, stage: 'received', stage_label: 'Réception',
  outcome: 'pending', outcome_label: 'En attente', outcome_communicated: false, visible_state: { code: 'received', label: 'Reçue' }, assigned_to: null, next_action: null, next_action_due: null,
  contract_state: null, contract_label: null, unread_messages: 0, missing_documents: 0, documents: 2, next_interview: null, ...extra });
const dossier = (extra = {}) => ({ ...item(1), message: 'Disponible immédiatement.', source: 'mobile',
  profile: { first_name: 'Nadia', last_name: 'TEST1', phone: '+213551122334', email: null, desired_position: 'AGENT', society: null, status: 'nouvelle', data: { adresse: '1 rue du Test', wilaya: 'Alger' } },
  dossier_state: { code: 'review', label: 'En cours d’étude' },
  documents: [{ id: 5, kind: 'cv', label: 'CV', name: 'cv.pdf', mime_type: 'application/pdf', size: 20480, source: 'candidature', received_at: '2026-10-09T08:30:00' },
    { id: 6, kind: 'photo', label: 'Photo d’identité', name: 'photo.jpg', mime_type: 'image/jpeg', size: 4096, source: 'candidature', received_at: '2026-10-09T08:30:00' }],
  dossier_cv: null, document_requests: [], notes: [{ id: 1, author: 'REC01', body: 'Profil solide', created_at: '2026-10-09T09:00:00' }],
  history: [{ kind: 'reception', summary: 'Candidature reçue depuis IRON Emploi (2 pièce(s) jointe(s))', actor: 'candidat', at: '2026-10-09T08:30:00' }],
  interviews: [], dossier_convocation: null, contract: null, employee_id: null, drh_transfer: null, other_applications: [], ...extra });

function workspace({ actions = ['read', 'create', 'update'], responses = {}, extra = {} } = {}) {
  const dom = new JSDOM('<main><section id="processingSection"></section></main>', { url: 'http://localhost/' });
  const calls = [], banners = [];
  const ctx = { document: dom.window.document, URLSearchParams, FormData: dom.window.FormData, Date, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout, confirm: () => true,
    recruitSection: 'processing', recruteSession: { token: 'qa', user: { username: 'REC01', recruitment_access: true, authorized_actions: actions } },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), formatDateFr: value => String(value || '—').slice(0, 10),
    recruitmentCan: action => actions.includes(action), showBanner: (text, type) => banners.push([type, text]),
    recruitmentListSkeleton: () => '<div class="skeleton"></div>', recruitmentEmptyState: ({ title, text }) => `<div class="rec-empty-state"><strong>${title}</strong><p>${text}</p></div>`,
    recruitmentErrorState: message => `<div class="rec-error-state">${message}</div>`,
    apiFetch: async (url, options = {}) => { calls.push([options.method || 'GET', url, options.body ? JSON.parse(options.body) : null]);
      const key = Object.keys(responses).find(part => url.includes(part)); const value = key ? responses[key] : null;
      if (value instanceof Error) throw value; return typeof value === 'function' ? value(url, options) : value; }, ...extra };
  vm.createContext(ctx); vm.runInContext(script, ctx); vm.runInContext(convocations, ctx);
  return { ctx, doc: ctx.document, host: ctx.document.getElementById('processingSection'), calls, banners, run: code => vm.runInContext(code, ctx) };
}
const board = (items = [item(1), item(2, { stage: 'review', stage_label: 'Examen du dossier', assigned_to: 'REC01', missing_documents: 1, unread_messages: 2 }),
  item(3, { stage: 'decision', stage_label: 'Décision', outcome: 'unfavorable', outcome_label: 'Non retenue', kind: 'spontaneous', offer: null, title: 'AGENT POLYVALENT' })]) =>
  ({ counters: COUNTERS, items, total: items.length, stages: STAGES, outcomes: [], filters: { offers: [{ id: 1, title: 'Agent de sécurité' }], societies: ['IRON GLOBAL SÉCURITÉ'], wilayas: ['Alger'], recruiters: ['REC01'] } });

test('recrute.html loads the processing workspace and exposes it in the navigation', () => {
  assert.match(page, /<script src="\/static\/recrute-emploi\.js/); assert.match(page, /recrute-emploi\.css/);
  assert.match(page, /<section id="processingSection"/); assert.match(page, /"announcements","processing","retention"\]\.includes\(section\)/);
});

test('dashboard: clickable counters, filters sent to the server, table and pipeline views', async () => {
  const app = workspace({ responses: { '/workspace': board() } });
  await app.run('refreshEmploi()');
  app.run("emploiState.mode='table';renderEmploi()");
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-counter span')), COUNTERS.filter(c=>['new','review','interviews','hired'].includes(c.key)).concat(COUNTERS.filter(c=>!['new','review','interviews','hired'].includes(c.key))).map(c => c.label));
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-counter strong')), COUNTERS.filter(c=>['new','review','interviews','hired'].includes(c.key)).concat(COUNTERS.filter(c=>!['new','review','interviews','hired'].includes(c.key))).map(c => String(c.count)));
  assert.deepEqual(texts(app.host.querySelectorAll('thead th')), ['Candidat', 'Annonce', 'Reçue le', 'Étape · décision · contrat', 'Recruteur', 'Pièces et messages', 'Actions']);
  const rows = app.host.querySelectorAll('tbody tr');
  assert.equal(rows.length, 3);
  assert.match(rows[1].textContent, /1 attendue/); assert.match(rows[1].textContent, /2 messages non lus/);
  assert.match(rows[2].textContent, /Candidature spontanée/); assert.match(rows[2].textContent, /Non retenue · non communiquée/, 'an internal decision is flagged as not communicated');
  for (const label of ['Société', 'Annonce', 'Wilaya', 'Recruteur', 'Étape', 'Reçues à partir du', 'Reçues jusqu’au']) assert.ok(app.host.querySelector(`[aria-label="${label}"]`), label);
  assert.match([...app.host.querySelectorAll('.emploi-counter')].find(button=>button.textContent.includes('Décisions en attente')).getAttribute('onclick'), /emploiSetBucket\('decisions'\)/); await app.run("emploiSetBucket('decisions')");
  assert.equal(app.calls.at(-1)[1], '/api/drh/job-offers/workspace?bucket=decisions');
  await app.run("emploiSetFilter('stage','review')"); await new Promise(resolve => setTimeout(resolve));
  assert.equal(app.calls.at(-1)[1], '/api/drh/job-offers/workspace?stage=review&bucket=decisions');
  app.run("emploiState.mode='pipeline';renderEmploi()");
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-column header span')), ['Réception','Étude','Entretien','Décision','Contrat','Recrutement']);
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-column header b')), ['1', '1', '0', '1', '0', '0']);
  const failing = workspace({ responses: { '/workspace': new Error('Panne réseau') } }); await failing.run('refreshEmploi()');
  assert.match(failing.host.querySelector('.rec-error-state').textContent, /Panne réseau/); assert.equal(failing.host.querySelector('tbody'), null);
});

test('application file: profile, received documents with name, type, size, date and origin; internal notes and history', async () => {
  const app = workspace({ responses: { '/applications/1': dossier() } });
  await app.run('openEmploiDossier(1)');
  assert.equal(app.host.querySelector('h2').textContent, 'TEST1 Nadia');
  assert.deepEqual(texts(app.host.querySelectorAll('nav[aria-label="Rubriques du dossier"] .tab-btn')).map(t => t.replace(/ \d.*$/, '')),
    ['Synthèse', 'Pièces', 'Traitement', 'Convocations et entretiens', 'Échanges', 'Notes et historique', 'Contrat']);
  assert.match(app.host.textContent, /Disponible immédiatement\./); assert.match(app.host.textContent, /1 rue du Test/); assert.match(app.host.textContent, /CAND-2026-000001/);
  app.run("emploiSetTab('documents')");
  assert.deepEqual(texts(app.host.querySelectorAll('thead th')), ['Pièce', 'Fichier', 'Type', 'Taille', 'Reçue le', 'Provenance', 'Actions']);
  assert.deepEqual([...app.host.querySelectorAll('tbody tr')].map(row => texts(row.querySelectorAll('td')).slice(0, 6)),
    [['CV', 'cv.pdf', 'PDF', '20 Ko', '2026-10-09 à 08:30', 'Candidature'], ['Photo d’identité', 'photo.jpg', 'JPG', '4 Ko', '2026-10-09 à 08:30', 'Candidature']]);
  assert.deepEqual(texts(app.host.querySelectorAll('tbody tr:first-child button')), ['Visualiser', 'Télécharger']);
  app.run("emploiSetTab('notes')");
  assert.match(app.host.textContent, /Visibles des recruteurs uniquement, jamais du candidat/); assert.match(app.host.textContent, /Profil solide/);
  assert.match(app.host.querySelector('.emploi-history').textContent, /Candidature reçue depuis IRON Emploi/);
  const empty = workspace({ responses: { '/applications/1': dossier({ documents: [], dossier_cv: { name: 'ancien.pdf', candidate_id: 41 } }) } });
  await empty.run("openEmploiDossier(1,'documents')");
  assert.match(empty.host.textContent, /Aucune pièce/); assert.match(empty.host.textContent, /il n’est pas rattaché à cette candidature/);
});

test('viewer: documents are fetched with the recruiter session, PDF in a frame, images with zoom, errors reported', async () => {
  const app = workspace({ responses: { '/applications/1': dossier() } }); const fetched = [];
  app.ctx.fetch = async (url, options) => { fetched.push([url, options.headers.Authorization]); return { ok: true, blob: async () => ({}) }; };
  await app.run('openEmploiDossier(1,"documents")');
  await app.run('emploiViewDocument(5)');
  assert.deepEqual(fetched.at(-1), ['/api/drh/job-offers/applications/1/documents/5', 'Bearer qa']);
  const viewer = app.doc.getElementById('emploiViewer');
  assert.equal(viewer.getAttribute('role'), 'dialog'); assert.equal(viewer.querySelector('iframe').getAttribute('src'), 'blob:test', 'never a public or permanent address');
  assert.match(viewer.textContent, /cv\.pdf · 20 Ko/); assert.equal(viewer.querySelector('[aria-label="Agrandir"]'), null);
  await app.run('emploiViewDocument(6)');
  const image = app.doc.getElementById('emploiViewerImage'); assert.ok(image); assert.equal(app.doc.querySelectorAll('#emploiViewer').length, 1);
  assert.ok(app.doc.querySelector('[aria-label="Agrandir"]') && app.doc.querySelector('[aria-label="Réduire"]'));
  app.run('emploiZoom(0.25);emploiZoom(0.25)'); assert.equal(image.style.width, '150%');
  app.run('emploiZoom(-0.25)'); assert.equal(image.style.width, '125%');
  app.run('closeEmploiViewer()'); assert.equal(app.doc.getElementById('emploiViewer'), null);
  app.ctx.fetch = async () => ({ ok: false, json: async () => ({ detail: 'Le contenu de cette pièce est indisponible.' }) });
  await app.run('emploiViewDocument(6)');
  assert.deepEqual(app.banners.at(-1), ['error', 'Photo d’identité : Le contenu de cette pièce est indisponible.']); assert.equal(app.doc.getElementById('emploiViewer'), null);
});

test('processing: stage, internal decision and its communication are separate actions', async () => {
  const decided = dossier({ stage: 'decision', stage_label: 'Décision', outcome: 'favorable', outcome_label: 'Favorable', visible_state: { code: 'interview', label: 'Entretien' } });
  const app = workspace({ responses: { '/processing': () => ({ ...decided, outcome_communicated: true, visible_state: { code: 'accepted', label: 'Retenue' } }), '/applications/1': decided, '/workspace': board() } });
  await app.run('loadEmploiBoard()'); await app.run("openEmploiDossier(1,'processing')");
  assert.match(app.host.textContent, /Favorable · non communiquée/); assert.match(app.host.textContent, /Ce que voit le candidat : Entretien/);
  assert.deepEqual(texts(app.host.querySelectorAll('#emploiStage option')), STAGES.map(s => s.label));
  const buttons = texts(app.host.querySelectorAll('.emploi-actions button'));
  assert.deepEqual(buttons, ['Décision favorable', 'Non retenue', 'Communiquer au candidat', 'Revenir à « en attente »']);
  assert.match([...app.host.querySelectorAll('.emploi-actions button')].find(b => b.textContent === 'Communiquer au candidat').getAttribute('onclick'), /communicate:true/);
  await app.run("emploiAct(()=>emploiSend('/applications/1/processing','PUT',{communicate:true}),'ok')");
  assert.deepEqual(app.calls.at(-1), ['PUT', '/api/drh/job-offers/applications/1/processing', { communicate: true }]);
  assert.match(app.host.textContent, /Ce que voit le candidat : Retenue/); assert.doesNotMatch(app.host.textContent, /non communiquée/);
  const readOnly = workspace({ actions: ['read'], responses: { '/applications/1': decided } }); await readOnly.run("openEmploiDossier(1,'processing')");
  assert.equal(readOnly.host.querySelector('#emploiStage'), null); assert.deepEqual(texts(readOnly.host.querySelectorAll('.emploi-actions button')), []);
});

// ── Convocations et entretiens ──────────────────────────────────────────────
const DEFAULTS = { candidate: 'TEST1 NADIA', dossier_reference: 'CAND-2026-000001', application_reference: 'CDT-2026-000001', offer: { title: 'Agent de sécurité', reference: 'IGS-14' },
  position: 'Agent de sécurité', society: 'IRON GLOBAL SÉCURITÉ', society_name: 'IRON Global Sécurité', society_fixed: true, societies: [], logo_available: true, location: 'Alger',
  contact: 'Recruteur Un', contact_details: 'rec01@exemple.dz', purpose: 'Entretien — Agent de sécurité', has_account: true, has_email: false, timezone: 'Africa/Algiers' };
const convocation = (id, extra = {}) => ({ id, reference: `CONV-2026-00000${id}`, starts_at: '2026-10-20T10:00:00', timezone: 'Africa/Algiers', location: 'Siège, Hydra', contact: 'Mme Test',
  note: null, status: 'proposed', confirmed_at: null, cancelled_at: null, previous_starts_at: null, report: null, appreciation: null, created_by: 'REC01', past: false, society: null,
  address: '12 rue des Tests\nHydra', map_url: null, contact_details: null, purpose: 'Entretien', documents_to_bring: 'Pièce d’identité', version: 1, sent_at: '2026-10-17T08:00:00', sent_by: 'REC01',
  viewed_by_candidate: false, candidate_state: 'new', candidate_state_label: 'Nouvelle', arrived_at: null, arrived_by: null, assessment: null, can_confirm_arrival: false,
  versions: [{ version: 1, issued_at: '2026-10-17T08:00:00', issued_by: 'REC01', starts_at: '2026-10-20T10:00', state: 'active' }], ...extra });

test('convocations: draft, sent with its versions, cancelled; historical convocation kept apart', async () => {
  const d = dossier({ convocation_defaults: DEFAULTS, dossier_convocation: { date: '2026-09-01', heure: '09:00', lieu: 'Ancien site' }, interviews: [
    convocation(3, { status: 'draft', version: 0, versions: [], candidate_state: null, candidate_state_label: null }),
    convocation(2, { version: 2, previous_starts_at: '2026-10-18T10:00:00', candidate_state: 'rescheduled', candidate_state_label: 'Reportée', can_confirm_arrival: true,
      versions: [{ version: 2, issued_at: '2026-10-17T09:00:00', issued_by: 'REC01', starts_at: '2026-10-20T10:00', state: 'active' },
                 { version: 1, issued_at: '2026-10-16T09:00:00', issued_by: 'REC01', starts_at: '2026-10-18T10:00', state: 'superseded' }] }),
    convocation(1, { status: 'cancelled', candidate_state: 'cancelled', candidate_state_label: 'Annulée', versions: [{ version: 1, issued_at: '2026-10-15T09:00:00', issued_by: 'REC01', starts_at: '2026-10-19T10:00', state: 'cancelled' }] })] });
  const app = workspace({ responses: { '/applications/1': d } });
  await app.run("openEmploiDossier(1,'interviews')");
  assert.match(texts(app.host.querySelectorAll('nav[aria-label="Rubriques du dossier"] .tab-btn'))[3], /^Convocations et entretiens/);
  assert.deepEqual(texts(app.host.querySelectorAll('.conv-head button')), ['Convoquer le candidat', 'Scanner une convocation']);
  const [draft, sent, cancelled] = app.host.querySelectorAll('.conv-card');
  assert.match(draft.textContent, /Brouillon, non envoyée/); assert.doesNotMatch(draft.textContent, /Candidat :/, 'a draft has no candidate state');
  assert.deepEqual(texts(draft.querySelectorAll('.emploi-actions button')), ['Envoyer la convocation', 'Modifier le brouillon', 'Supprimer le brouillon', 'Aperçu PDF']);
  assert.match(sent.textContent, /CONV-2026-000002 · version 2/); assert.match(sent.textContent, /Candidat : Reportée/); assert.match(sent.textContent, /reportée, initialement/);
  assert.deepEqual(texts(sent.querySelectorAll('.conv-versions li .pill')), ['En vigueur', 'Remplacée'], 'old versions stay identifiable');
  assert.deepEqual(texts(sent.querySelectorAll('.emploi-actions button')), ['Reporter ou modifier', 'Annuler', 'Confirmer l’arrivée du candidat', 'Compte rendu de l’entretien']);
  assert.match(sent.querySelector('dl').textContent, /12 rue des Tests/); assert.match(sent.innerHTML, /12 rue des Tests<br>Hydra/);
  assert.match(cancelled.textContent, /Annulée/); assert.equal(cancelled.querySelectorAll('.emploi-actions button').length, 0);
  // Document devenu inexact (modifié hors versions) : réémission proposée, aucune arrivée possible.
  const stale = workspace({ responses: { '/applications/1': dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(4, { needs_reissue: true,
    versions: [{ version: 1, issued_at: '2026-10-17T08:00:00', issued_by: 'REC01', starts_at: '2026-10-18T10:00', state: 'outdated' }] })] }) } });
  await stale.run("openEmploiDossier(1,'interviews')");
  assert.match(stale.host.textContent, /ne correspond plus à cet entretien/); assert.match(stale.host.textContent, /À réémettre/);
  assert.ok(texts(stale.host.querySelectorAll('.conv-card .emploi-actions button')).includes('Réémettre la convocation'));
  assert.match(app.host.textContent, /Elle concerne le dossier, pas cette candidature en particulier/);
  // PDF lu avec la session du recruteur (ancienne version comprise).
  const fetched = []; app.ctx.emploiFetchBlob = async path => { fetched.push(path); return 'blob'; }; app.ctx.emploiSaveBlob = () => {};
  await app.run('convOpenPdf(2,1)'); assert.deepEqual(fetched, ['/interviews/2/convocation?version=1']);
});

test('convocation form: prefilled, preview before sending, draft or send, one request id for every retry', async () => {
  let attempts = 0;
  const d = dossier({ convocation_defaults: { ...DEFAULTS, has_email: true } });
  const app = workspace({ responses: { '/applications/1/interviews': () => { attempts += 1; if (attempts === 1) throw new Error('Réseau indisponible'); return { ...d, channels: ['Brouillon enregistré : le candidat n’a pas été prévenu.'] }; }, '/applications/1': d } });
  await app.run("openEmploiDossier(1,'interviews')"); app.run('convOpenForm(null)');
  const form = app.doc.getElementById('convForm');
  assert.match(form.textContent, /TEST1 NADIA · dossier CAND-2026-000001 · candidature CDT-2026-000001/); assert.match(form.textContent, /Annonce : Agent de sécurité \(réf. IGS-14\)/);
  assert.equal(form.elements.contact.value, 'Recruteur Un'); assert.equal(form.elements.contact_details.value, 'rec01@exemple.dz'); assert.equal(form.elements.location.value, 'Alger');
  assert.equal(form.elements.society, undefined, 'offer application: the society is the one of the offer'); assert.match(form.textContent, /Société qui convoque\s*IRON Global Sécurité/);
  form.elements.date.value = '2026-10-25'; form.elements.time.value = '14:30'; form.elements.documents_to_bring.value = 'CV\nDiplômes';
  app.ctx.form = form; app.run('convState.preview=true;convRenderPreview(form)');
  const preview = app.doc.getElementById('convPreview');
  assert.match(preview.textContent, /Convocation à un entretien/); assert.match(preview.textContent, /2026-10-25 à 14:30 \(heure d’Alger\)/); assert.match(preview.innerHTML, /CV<br>Diplômes/);
  assert.match(preview.textContent, /Présentez cette convocation à votre arrivée/);
  form.reportValidity = () => true;
  await app.run("convSubmit(form,'draft')");                                                            // échec réseau
  assert.match(app.banners.at(-1)[1], /Réseau indisponible/);
  const first = app.calls.filter(call => call[1].endsWith('/applications/1/interviews')).at(-1)[2];
  await app.run("convSubmit(form,'draft')");                                                            // relance
  const second = app.calls.filter(call => call[1].endsWith('/applications/1/interviews')).at(-1)[2];
  assert.equal(first.request_id, second.request_id); assert.match(first.request_id, /^conv-[0-9a-f]{24}$/);
  assert.deepEqual({ ...second, request_id: 'x' }, { starts_at: '2026-10-25T14:30:00', location: 'Alger', contact: 'Recruteur Un', contact_details: 'rec01@exemple.dz', address: null, map_url: null,
    purpose: 'Entretien — Agent de sécurité', documents_to_bring: 'CV\nDiplômes', note: null, send_email: false, mode: 'draft', request_id: 'x' });
  assert.equal(app.doc.getElementById('convForm'), null, 'form closed once saved');
  // Candidature spontanée : choix de la société dans le périmètre.
  const spontaneous = workspace({ responses: { '/applications/1': dossier({ kind: 'spontaneous', convocation_defaults: { ...DEFAULTS, society_fixed: false, society: null, society_name: null,
    societies: [{ society: 'IRON GLOBAL SÉCURITÉ', name: 'IRON Global Sécurité', logo: true }] } }) } });
  await spontaneous.run("openEmploiDossier(1,'interviews')"); spontaneous.run('convOpenForm(null)');
  assert.deepEqual(texts(spontaneous.doc.getElementById('convForm').elements.society.options), ['— Choisir —', 'IRON Global Sécurité']);
});

test('convocations: read-only recruiter can consult and scan, never send or record anything', async () => {
  const d = dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(2, { can_confirm_arrival: true, past: true })] });
  const app = workspace({ actions: ['read'], responses: { '/applications/1': d } });
  await app.run("openEmploiDossier(1,'interviews')");
  assert.deepEqual(texts(app.host.querySelectorAll('.conv-head button')), ['Scanner une convocation']);
  assert.equal(app.host.querySelectorAll('.conv-card .emploi-actions button').length, 0);
  // Dossier sans espace candidat : expliqué, sans création de compte.
  const legacy = workspace({ responses: { '/applications/1': dossier({ convocation_defaults: { ...DEFAULTS, has_account: false, has_email: true } }) } });
  await legacy.run("openEmploiDossier(1,'interviews')");
  assert.match(legacy.host.textContent, /n’a pas d’espace IRON Emploi.*Téléchargez son PDF.*Aucun compte n’est créé automatiquement/);
});

test('scanner: camera refused then manual reference; the right file opens with the reception summary and an explicit arrival', async () => {
  const resolved = { state: 'superseded', warning: 'Version 1 remplacée : la convocation en vigueur est la version 2. Ne validez pas l’ancienne date.', application_id: 1, interview_id: 2,
    reference: 'CONV-2026-000002', version: 1, current_version: 2, can_confirm_arrival: false,
    summary: { candidate: 'TEST1 NADIA', position: 'Agent de sécurité', society: 'IRON Global Sécurité', starts_at: '2026-10-18T10:00', current_starts_at: '2026-10-20T10:00:00',
      timezone: 'Africa/Algiers', status: 'proposed', candidate_state: 'rescheduled', candidate_state_label: 'Reportée', confirmed_by_candidate: false, arrived_at: null, arrived_by: null } };
  const d = dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(2, { version: 2, can_confirm_arrival: true })] });
  class Html5Qrcode { constructor() {} async start() { const error = new Error('Permission denied'); error.name = 'NotAllowedError'; throw error; } }
  const app = workspace({ extra: { Html5Qrcode }, responses: { '/convocations/resolve': (url, options) => {
    const code = JSON.parse(options.body).code; if (code === 'CONV-2026-999999') { const error = new Error('Accès refusé'); error.status = 403; throw error; } return resolved; },
    '/interviews/2/arrival': () => ({ ...d, interviews: [convocation(2, { version: 2, arrived_at: '2026-10-20T09:05:00', arrived_by: 'REC01' })] }), '/applications/1': d } });
  app.run('convOpenScanner()');
  const modal = app.doc.getElementById('convScanModal');
  assert.match(modal.textContent, /Rien n’est enregistré par le scan/); assert.ok(modal.querySelector('input[type=file][accept="image/*"]'), 'image import offered');
  await app.run('convStartCamera()');
  assert.match(app.doc.getElementById('convScanError').textContent, /Accès à la caméra refusé.*saisissez la référence/);
  await app.run("convResolve('CONV-2026-999999')");
  assert.match(app.doc.getElementById('convScanError').textContent, /Accès refusé : cette convocation ne relève pas de votre périmètre/);
  assert.doesNotMatch(app.doc.body.textContent, /TEST1/, 'nothing about the candidate is shown when access is refused');
  await app.run("convResolve('CONV-2026-000002-V1')");
  assert.equal(app.doc.getElementById('convScanModal'), null);
  assert.deepEqual(app.calls.find(call => call[1].endsWith('/convocations/resolve') && call[2].code === 'CONV-2026-000002-V1').slice(0, 2), ['POST', '/api/drh/job-offers/convocations/resolve']);
  const banner = app.host.querySelector('.conv-scan');
  assert.match(banner.textContent, /Ancienne version/); assert.match(banner.textContent, /Ne validez pas l’ancienne date/); assert.match(banner.textContent, /Horaire en vigueur/);
  assert.equal([...banner.querySelectorAll('button')].some(button => /Confirmer l’arrivée/.test(button.textContent)), false, 'never on an old version');
  // La version en vigueur : arrivée confirmée explicitement, après confirmation.
  app.ctx.next = { ...resolved, state: 'active', warning: null, version: 2, can_confirm_arrival: true }; app.run('convState.scan=next;renderEmploi()');
  let asked = ''; app.ctx.confirm = message => { asked = message; return true; };
  await app.run('convConfirmArrival(2,2)');
  assert.match(asked, /Confirmer l’arrivée de TEST1 NADIA.*Aucune décision n’est prise/);
  assert.deepEqual(app.calls.at(-1), ['POST', '/api/drh/job-offers/interviews/2/arrival', { version: 2 }]);
  assert.match(app.host.querySelector('.conv-card').textContent, /Arrivée confirmée le/);
});

test('report after arrival reuses the interview grid; absence impossible once arrived; no automatic decision', async () => {
  const criteria = [['profil', 'Profil et adéquation au poste'], ['motivation', 'Motivation et projet professionnel']];
  const options = value => ['<option value="">— /10</option>', ...Array.from({ length: 11 }, (_, n) => `<option value="${n}"${Number(value) === n ? ' selected' : ''}>${n} / 10</option>`)].join('');
  const d = dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(2, { past: true, arrived_at: '2026-10-20T09:05:00', arrived_by: 'REC01' })] });
  const app = workspace({ extra: { INTERVIEW_CRITERIA: criteria, interviewOptions: options }, responses: { '/outcome': d, '/applications/1': d } });
  await app.run("openEmploiDossier(1,'interviews')"); app.run('convOutcomeForm(2)');
  const form = app.doc.querySelector('#convOutcome2 form');
  assert.deepEqual(texts(form.elements.attendance.options), ['Présent']); assert.deepEqual(texts(form.querySelectorAll('.interview-grid label')), criteria.map(([, label]) => label));
  assert.match(form.textContent, /n’entraîne aucune décision/);
  form.elements.score_profil.value = '8'; form.elements.appreciation.value = 'Favorable'; form.elements.report.value = 'Bon échange';
  app.ctx.form = form; await app.run('convSaveOutcome(form,2)');
  assert.deepEqual(app.calls.at(-1), ['POST', '/api/drh/job-offers/interviews/2/outcome', { attendance: 'present', report: 'Bon échange', appreciation: 'Favorable', scores: { profil: 8 } }]);
  // Avant l'heure : le formulaire n'est pas proposé.
  const early = workspace({ responses: { '/applications/1': dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(2)] }) } });
  await early.run("openEmploiDossier(1,'interviews')"); early.run('convOutcomeForm(2)');
  assert.match(early.doc.getElementById('convOutcome2').textContent, /à l’heure de l’entretien ou après/);
});

test('link opened from a QR before signing in: kept for this tab only, removed from the address, resolved after login', async () => {
  const token = 'Abcdefghijklmnopqrstuvwxyz012345', stored = {}, replaced = [];
  const sessionStorage = { setItem: (key, value) => { stored[key] = value; }, getItem: key => stored[key] ?? null, removeItem: key => { delete stored[key]; } };
  const app = workspace({ extra: { sessionStorage, location: { hash: `#convocation=${token}`, pathname: '/', search: '' }, history: { replaceState: (...args) => replaced.push(args) } },
    responses: { '/convocations/resolve': { state: 'active', application_id: 1, interview_id: 2, version: 1, current_version: 1, reference: 'CONV-2026-000002', summary: {}, can_confirm_arrival: false },
      '/applications/1': dossier({ convocation_defaults: DEFAULTS, interviews: [convocation(2)] }) } });
  assert.equal(app.run('convCapturePendingScan()'), token);
  assert.deepEqual(Object.values(stored), [token]); assert.deepEqual(replaced, [[null, '', '/']], 'the token leaves the address bar');
  await app.run('convResumePendingScan()');
  assert.deepEqual(stored, {}, 'used once'); assert.deepEqual(app.calls.find(call => call[1].endsWith('/convocations/resolve'))[2], { code: token });
  // Toute autre forme est ignorée : jamais de redirection, jamais d'appel.
  for (const hash of ['#convocation=../../evil', '#convocation=https://evil.example', '#next=https://evil.example', '#convocation=short']) {
    app.ctx.location.hash = hash; assert.equal(app.run('convCapturePendingScan()'), null, hash);
  }
});

test('contract: prepared from a validated template, signature recorded with its date, then hand-over to DRH', async () => {
  const favorable = { stage: 'hiring_file', stage_label: 'Dossier d’embauche', outcome: 'favorable', outcome_label: 'Favorable', outcome_communicated: true };
  const pending = workspace({ responses: { '/applications/1': dossier() } }); await pending.run("openEmploiDossier(1,'contract')");
  assert.match(pending.host.textContent, /après une décision favorable communiquée/); assert.equal(pending.host.querySelector('form'), null);
  const contract = { template_id: 3, society: 'IRON GLOBAL SÉCURITÉ', position: 'Agent de sécurité', contract_type: 'CDI', start_date: '2026-11-01', end_date: null, work_place: 'Alger', salary_net: 45000,
    conditions: null, state: 'prepared', state_label: 'Préparé', signed_on: null, signed_recorded_by: null, shared_with_candidate: false };
  const app = workspace({ responses: { '/contract-templates': { items: [{ id: 3, title: 'CDI agent', contract_type: 'CDI' }] }, '/contract/state': () => dossier({ ...favorable, contract: { ...contract, state: 'signed', state_label: 'Signé', signed_on: '2026-10-10', signed_recorded_by: 'REC01' } }),
    '/applications/1': dossier({ ...favorable, contract, contract_state: 'prepared', contract_label: 'Préparé' }) } });
  await app.run("openEmploiDossier(1,'contract')"); await app.run('emploiLoadTemplates()');
  assert.deepEqual(texts(app.host.querySelectorAll('select[name="template_id"] option')), ['— Aucun —', 'CDI agent']);
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-steps li')), ['✓ Décision favorable communiquée', '✓ Contrat préparé', '○ Contrat remis au candidat', '○ Signature enregistrée', '○ Dossier transmis à la DRH', '○ Recrutement effectif (fiche employé)']);
  assert.match(app.host.textContent, /Aucun contrat n’est considéré signé automatiquement/);
  assert.equal([...app.host.querySelectorAll('button')].some(b => b.textContent === 'Transmettre à la DRH'), false, 'not before the signature is recorded');
  const sign = [...app.host.querySelectorAll('form')].find(f => f.elements.signed_on); sign.elements.signed_on.value = '2026-10-10';
  app.ctx.form = sign; await app.run('emploiSignContract(form)');
  assert.deepEqual(app.calls.at(-1), ['POST', '/api/drh/job-offers/applications/1/contract/state', { state: 'signed', signed_on: '2026-10-10' }]);
  assert.match(app.host.textContent, /Signature enregistrée le 2026-10-10 par REC01/);
  assert.ok([...app.host.querySelectorAll('button')].some(b => b.textContent === 'Transmettre à la DRH'));
  assert.ok(app.host.querySelector('input[name="position"]').disabled, 'a signed contract is no longer edited');
});

test('messages: thread, unread badge, and a retry never doubles a message', async () => {
  const thread = { application_id: 1, title: 'Agent de sécurité', candidate: 'TEST1 Nadia', can_reach_candidate: true, items: [{ id: 1, sender: 'candidate', body: 'Bonjour', client_id: 'c1', created_at: '2026-10-09T10:00:00', read: true }] };
  let fail = true;
  const app = workspace({ responses: { '/messages': (url, options) => { if (options.method === 'POST' && fail) throw new Error('Panne réseau');
    return options.method === 'POST' ? { ...thread, items: [...thread.items, { id: 2, sender: 'recruiter', author: 'REC01', body: 'Merci', client_id: 'x', created_at: '2026-10-09T10:05:00', read: false }] } : thread; }, '/applications/1': dossier({ unread_messages: 1 }) } });
  await app.run("openEmploiDossier(1,'messages')"); await new Promise(resolve => setTimeout(resolve));
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-bubble p')), ['Bonjour']);
  const form = app.host.querySelector('.emploi-compose'); form.elements.body.value = 'Merci'; const clientId = form.elements.client_id.value;
  app.ctx.form = form; await app.run('emploiSendMessage(form)');
  assert.match(app.banners.at(-1)[1], /le message ne sera pas doublé/); assert.equal(form.querySelector('button').disabled, false);
  fail = false; await app.run('emploiSendMessage(form)');
  const posts = app.calls.filter(call => call[0] === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[0][2].client_id, clientId); assert.equal(posts[1][2].client_id, clientId, 'same identifier on retry');
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-bubble p')), ['Bonjour', 'Merci']);
  const unreachable = workspace({ responses: { '/messages': { ...thread, can_reach_candidate: false, items: [] }, '/applications/1': dossier() } });
  await unreachable.run("openEmploiDossier(1,'messages')"); await new Promise(resolve => setTimeout(resolve));
  assert.match(unreachable.host.textContent, /n’a pas d’espace IRON Emploi/); assert.equal(unreachable.host.querySelector('.emploi-compose'), null);
});

test('tips and company pages are managed here; drafts are labelled, nothing is invented', async () => {
  const app = workspace({ responses: { '/tips': { items: [{ id: 1, title: 'Préparer son entretien', summary: 'La veille', body: 'Texte du conseil', category: 'entretien', minutes: 4, status: 'draft' }] },
    '/companies': { items: [{ id: 2, name: 'IRON Global Sécurité', society: 'IRON GLOBAL SÉCURITÉ', sector: '', city: '', description: '', activities: '', locations: '', headcount: '', logo_path: null, is_active: true }] }, '/meta': { logos: [] } } });
  await app.run("emploiSetView('tips')");
  assert.match(app.host.textContent, /Seuls les conseils publiés sont visibles/); assert.deepEqual(texts(app.host.querySelectorAll('.emploi-note .pill')), ['Brouillon']);
  await app.run("emploiPublishTip(1,'published')");
  assert.deepEqual(app.calls.find(call => call[0] === 'PUT').slice(1), ['/api/drh/job-offers/tips/1', { title: 'Préparer son entretien', summary: 'La veille', body: 'Texte du conseil', category: 'entretien', minutes: 4, status: 'published' }]);
  await app.run("emploiSetView('companies')");
  assert.match(app.host.textContent, /aucun chiffre n’est inventé/); assert.equal(app.host.querySelector('input[name="headcount"]').placeholder, 'Laisser vide si non vérifié');
});

// Une candidature reste visible exactement une fois, même pour les étapes détaillées.
test('pipeline: six groupes, états précis et décisions internes conservés, textes échappés', async()=>{
  const rows=STAGES.map((stage,i)=>item(i+1,{stage:stage.code,stage_label:stage.label,next_action:'<script>action</script>'}));
  rows.push(item(99,{stage:'future_step',stage_label:'Étape future',outcome:'unfavorable',outcome_label:'Non retenue'}));
  const data=board(rows);data.stages=[...STAGES,{code:'future_step',label:'Étape future'}];
  const app=workspace({responses:{'/workspace':data}});await app.run('refreshEmploi()');
  assert.equal(app.host.querySelectorAll('.emploi-card').length,11);
  assert.deepEqual(texts(app.host.querySelectorAll('.emploi-column header b')),['1','2','2','1','3','1','1']);
  assert.equal(app.host.querySelector('.emploi-card script'),null);
  assert.match(app.host.textContent,/Non retenue · non communiquée/);
  assert.match(app.host.textContent,/Présélection/);
  assert.equal(app.host.querySelector('.emploi-pipeline').getAttribute('tabindex'),'0');
});

test('portefeuille: changer de société ferme le dossier courant et recharge le bon périmètre',async()=>{
  const app=workspace({responses:{'/workspace':board()}});
  let society='IRON GLOBAL SÉCURITÉ';app.ctx.portfolioSociety=()=>society;
  await app.run('refreshEmploi()');
  assert.match(app.calls.at(-1)[1],/society=IRON/);
  app.run('emploiState.view="dossier";emploiState.dossier={id:1};');
  society='IRON GLOBAL SOLUTION';await app.run('refreshEmploi()');
  assert.equal(app.run('emploiState.view'),'board');
  assert.equal(app.run('emploiState.dossier'),null);
  assert.equal(new URL('https://test'+app.calls.at(-1)[1]).searchParams.get('society'),society);
});
