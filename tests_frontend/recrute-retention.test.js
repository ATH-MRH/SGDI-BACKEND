// Écran « Conservation des données » de recrute.irongs.com (recrute-retention.js) : consultation seule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const page = fs.readFileSync(path.join(STATIC, 'recrute.html'), 'utf8');
const script = fs.readFileSync(path.join(STATIC, 'recrute-retention.js'), 'utf8');
const texts = nodes => [...nodes].map(node => node.textContent.replace(/\s+/g, ' ').trim());
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const application = (id, extra = {}) => ({ application_id: id, candidate_id: 100 + id, position: 'Agent', offer_id: 3, name: `BENALI Amine${id}`, reference: `CAND-2026-00010${id}`, society: 'IRON GLOBAL SÉCURITÉ',
  reference_on: '2024-09-01', due_on: '2026-09-01', refused_on: '2024-09-01', basis: 'refus communiqué',
  would_delete: { application: 1, profile_snapshot: 1, documents: 2, messages: 3, interviews: 1, notes: 0, events: 4, document_requests: 0, contracts: 0 }, ...extra });
const report = (extra = {}) => ({ generated_on: '2026-10-11', simulated: false, retention_months: 24, due_before: '2024-10-11', dry_run: true, limit: 500,
  counts: { declined_applications: 1, declined_dossiers: 1, inactive_accounts: 1, departed_recruits: 1, undated: 2 },
  declined_applications: [application(1)],
  declined_dossiers: [{ candidate_id: 7, name: 'KACI Lina', reference: 'CAND-2023-000007', society: 'IRON GLOBAL SOLUTION', reference_on: '2023-05-02', due_on: '2025-05-02', refused_on: '2023-05-02',
    basis: 'date de l’avis défavorable', would_delete: { candidate_dossier: 1 } }],
  inactive_accounts: [{ account_id: 4, name: 'HADDAD Sara', reference: null, society: null, reference_on: '2024-01-15', due_on: '2026-01-15', last_activity_on: '2024-01-15', basis: 'dernière activité',
    would_delete: { account: 1, cv: 1, photo: 0, alerts: 2, notifications: 5, push_deliveries: 3, push_devices: 0, sessions: 0, futur_element: 3 },
    would_keep: { applications_detached: 2, profile_snapshots: 2 }, would_keep_reason: 'Les candidatures déjà transmises restent au service recrutement.' }],
  departed_recruits: [{ candidate_id: 9, name: 'MEZIANE Karim', reference: 'CAND-2021-000009', society: 'IRON GLOBAL SÉCURITÉ', employee_id: 55, employee_code: 'IGS-0055', employee_status: 'demissionne',
    reference_on: '2022-03-10', due_on: '2024-03-10', left_on: '2022-03-10', basis: 'date de sortie de la fiche employé', would_delete: { candidate_dossier: 1 } }],
  undated: [{ candidate_id: 11, name: 'SAADI Nour', reference: 'CAND-2022-000011', society: 'IRON GLOBAL SOLUTION', reason: 'date de l’avis défavorable non enregistrée' },
    { candidate_id: 12, name: 'TOUATI Yanis', reference: 'CAND-2020-000012', society: 'IRON GLOBAL SÉCURITÉ', employee_code: 'IGS-0012', reason: 'date de départ non enregistrée' }], ...extra });

function screen(response = report()) {
  const dom = new JSDOM('<main><section id="retentionSection"></section></main>', { url: 'http://localhost/' });
  const calls = [];
  const ctx = { document: dom.window.document, encodeURIComponent, recruitSection: 'retention', recruteSession: { token: 'qa', user: { username: 'REC01', recruitment_access: true } },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatDateFr: value => { const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; },
    recruitmentListSkeleton: () => '<div class="skeleton" role="status">Chargement</div>',
    recruitmentEmptyState: ({ title, text, action = '' }) => `<div class="rec-empty-state"><strong>${title}</strong><p>${text}</p>${action}</div>`,
    recruitmentErrorState: (message, retry = '') => `<div class="rec-error-state" role="alert">${message}${retry ? `<button onclick="${retry}">Réessayer</button>` : ''}</div>`,
    apiFetch: async (url, options = {}) => { calls.push([options.method || 'GET', url, options.body || null]);
      const value = typeof response === 'function' ? response(url) : response; if (value instanceof Error) throw value; return value; } };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  const host = ctx.document.getElementById('retentionSection');
  return { ctx, host, calls, run: code => vm.runInContext(code, ctx), q: selector => host.querySelector(selector), all: selector => host.querySelectorAll(selector) };
}

test('recrute.html : entrée de barre latérale, section et script de l’écran', () => {
  assert.match(page, /data-section="retention" onclick="showRecruitSection\('retention'\)"[^]*?Conservation des données<\/span><\/button>/);
  assert.match(page, /<section id="retentionSection" class="hidden rec-page"><\/section>/);
  assert.match(page, /<script src="\/static\/recrute-retention\.js/);
  assert.match(page, /"processing","retention"\]\.includes\(section\)/);
  assert.match(page, /recruitSection==="retention"\)\{if\(typeof refreshRetention==="function"\)refreshRetention\(\)\}/);
  for (const section of ['dashboard', 'candidates', 'interviews', 'announcements', 'processing', 'reserve', 'archive']) assert.match(page, new RegExp(`data-section="${section}"`), 'barre latérale conservée');
  assert.doesNotMatch(script, /method\s*:|DELETE|POST|PUT|PATCH|localStorage|sessionStorage/, 'le module ne fait que lire');
});

test('chargement, puis compteurs, tableau trié par échéance et rubrique « À vérifier »', async () => {
  const s = screen();
  const pending = s.run('refreshRetention()');
  assert.equal(s.host.getAttribute('aria-busy'), 'true'); assert.ok(s.q('.skeleton'));
  await pending;
  assert.equal(s.host.hasAttribute('aria-busy'), false);
  assert.deepEqual(s.calls, [['GET', '/api/drh/recruitment-retention', null]], 'date du jour par défaut : aucun paramètre');
  assert.deepEqual(texts(s.all('.emploi-counter')), ['1Candidatures refusées', '1Dossiers du vivier refusés', '1Espaces candidats inactifs', '1Personnes recrutées puis parties']);
  assert.match(s.q('.retention-mode').textContent, /Échéances au 11\/10\/2026/); assert.equal(s.q('.retention-mode.simulated'), null);
  assert.deepEqual(texts(s.all('#retentionResults thead th')).slice(0, 5), ['Candidat', 'Catégorie', 'Date de référence', 'Échéance', 'Données concernées']);
  const rows = [...s.all('.retention-row')];
  assert.deepEqual(rows.map(row => row.querySelector('td strong').textContent), ['MEZIANE Karim', 'KACI Lina', 'HADDAD Sara', 'BENALI Amine1'], 'échéance la plus ancienne en premier');
  assert.match(rows[3].textContent, /Candidature refusée/); assert.match(rows[3].textContent, /01\/09\/2024/); assert.match(rows[3].textContent, /refus communiqué/); assert.match(rows[3].textContent, /01\/09\/2026/);
  assert.match(rows[3].textContent, /Candidature · Copie du profil envoyée · Pièces × 2 · Messages × 3 · Entretiens · Lignes d’historique × 4/); assert.doesNotMatch(rows[3].textContent, /Notes/, 'décompte nul non listé dans le résumé');
  assert.match(s.q('.retention-review h3').textContent, /À vérifier\s*2/);
  assert.deepEqual(texts(s.all('.retention-review tbody tr')).map(text => /non enregistrée/.test(text)), [true, true]);
  assert.match(s.q('.retention-review').textContent, /Matricule IGS-0012/);
  assert.match(s.host.textContent, /ne supprime et ne modifie rien/);
  assert.equal(s.all('button').length > 0 && [...s.all('button')].some(button => /supprim|valider|archiver/i.test(button.textContent)), false, 'aucune action de suppression');
});

test('détail d’un dossier : tous les décomptes renvoyés par l’API, éléments conservés, clé inconnue affichée', async () => {
  const s = screen(); await s.run('refreshRetention()');
  s.run("retentionToggle('inactive_accounts-0')");
  const detail = s.q('.retention-detail-row');
  assert.ok(detail); assert.equal(s.q('.retention-row.open button').getAttribute('aria-expanded'), 'true');
  const lines = texts(detail.querySelectorAll('.retention-list li'));
  for (const expected of ['Espace candidat1', 'CV1', 'Photo0', 'Alertes d’offres2', 'Notifications5', 'futur_element3', 'Candidatures conservées, détachées de l’espace2', 'Base de la datedernière activité',
    'Envois push en file3', 'Copies du profil jointes aux candidatures conservées2'])
    assert.ok(lines.includes(expected), expected);
  assert.match(detail.textContent, /Les candidatures déjà transmises restent au service recrutement\./, 'conservation expliquée');
  s.run("retentionToggle('inactive_accounts-0')"); assert.equal(s.q('.retention-detail-row'), null);
});

test('compteurs cliquables, recherche, filtre société et effacement des filtres', async () => {
  const s = screen(); await s.run('refreshRetention()');
  // jsdom n'exécute pas les gestionnaires en ligne : le clic est rejoué par l'appel que porte le bouton.
  assert.equal(s.all('.emploi-counter')[2].getAttribute('onclick'), "retentionSetCategory('inactive_accounts')");
  s.run("retentionSetCategory('inactive_accounts')");
  assert.equal(s.all('.emploi-counter')[2].getAttribute('aria-pressed'), 'true'); assert.deepEqual(texts(s.all('.retention-row td strong:first-child')).slice(0, 1), ['HADDAD Sara']); assert.equal(s.all('.retention-row').length, 1);
  s.run("retentionSetCategory('inactive_accounts')"); assert.equal(s.all('.retention-row').length, 4, 'second clic : filtre retiré');
  s.run("retentionSearch('cand-2023')"); assert.deepEqual([...s.all('.retention-row')].map(row => row.querySelector('td strong').textContent), ['KACI Lina']);
  assert.equal(s.q('#retentionSearch') !== null, true, 'le champ de recherche n’est pas reconstruit pendant la saisie');
  s.run("retentionSearch('introuvable')"); assert.match(s.q('#retentionResults').textContent, /Aucun dossier ne correspond/);
  s.run('retentionResetFilters()'); assert.equal(s.all('.retention-row').length, 4);
  s.run("retentionSetSociety('IRON GLOBAL SOLUTION')"); assert.deepEqual([...s.all('.retention-row')].map(row => row.querySelector('td strong').textContent), ['KACI Lina']);
  assert.equal(s.calls.length, 1, 'filtrer ne rappelle pas le serveur');
});

test('pagination par 20 dossiers', async () => {
  const many = Array.from({ length: 45 }, (_, index) => application(index + 1, { due_on: `2026-01-${String((index % 28) + 1).padStart(2, '0')}` }));
  const s = screen(report({ declined_applications: many, declined_dossiers: [], inactive_accounts: [], departed_recruits: [], counts: { declined_applications: 45, declined_dossiers: 0, inactive_accounts: 0, departed_recruits: 0, undated: 0 }, undated: [] }));
  await s.run('refreshRetention()');
  assert.equal(s.all('.retention-row').length, 20); assert.match(s.q('.pagination').textContent, /1–20 sur 45 dossiers/);
  const [previous, next] = s.all('.pagination button'); assert.equal(previous.disabled, true); assert.equal(next.getAttribute('onclick'), 'retentionPage(2)'); s.run('retentionPage(2)');
  assert.match(s.q('.pagination').textContent, /21–40 sur 45/); s.run('retentionPage(3)');
  assert.equal(s.all('.retention-row').length, 5); assert.equal(s.all('.pagination button')[1].disabled, true);
  assert.match(s.q('.retention-review').textContent, /Aucun dossier à vérifier/);
});

test('simulation de date : paramètre as_of, bandeau distinct, retour à la date du jour', async () => {
  const s = screen(url => report(url.includes('as_of') ? { simulated: true, generated_on: '2028-12-01', due_before: '2026-12-01' } : {}));
  await s.run('refreshRetention()');
  s.q('#retentionAsOf').value = '2028-12-01'; await s.run('retentionSimulate()');
  assert.deepEqual(s.calls[1], ['GET', '/api/drh/recruitment-retention?as_of=2028-12-01', null]);
  assert.match(s.q('.retention-mode.simulated').textContent, /Simulation au 01\/12\/2028 — ces résultats ne sont pas les échéances actuelles/);
  assert.ok([...s.all('button')].some(button => button.textContent === 'Revenir à aujourd’hui'));
  await s.run('retentionToday()');
  assert.equal(s.calls[2][1], '/api/drh/recruitment-retention'); assert.equal(s.q('.retention-mode.simulated'), null);
  s.q('#retentionAsOf').value = ''; await s.run('retentionSimulate()'); assert.equal(s.calls.length, 3, 'date vide : aucune requête');
});

test('aucun résultat, erreur avec nouvelle tentative, et refus 403 affiché sans contournement', async () => {
  const empty = screen(report({ declined_applications: [], declined_dossiers: [], inactive_accounts: [], departed_recruits: [], undated: [], counts: { declined_applications: 0, declined_dossiers: 0, inactive_accounts: 0, departed_recruits: 0, undated: 0 } }));
  await empty.run('refreshRetention()');
  assert.match(empty.q('#retentionResults').textContent, /Aucun dossier arrivé à échéance/);

  const failing = screen(new Error('Service indisponible'));
  await failing.run('refreshRetention()');
  assert.match(failing.q('[role="alert"]').textContent, /Service indisponible/); assert.ok([...failing.all('button')].some(button => button.textContent === 'Réessayer'));
  assert.equal(failing.all('.retention-row').length, 0);

  const refusal = Object.assign(new Error('Aperçu réservé à un administrateur ou à un recruteur à périmètre global'), { status: 403 });
  const denied = screen(refusal);
  await denied.run('refreshRetention()'); await tick();
  assert.match(denied.q('[role="alert"]').textContent, /Accès non autorisé/); assert.match(denied.q('[role="alert"]').textContent, /périmètre global/);
  assert.equal([...denied.all('button')].some(button => button.textContent === 'Réessayer'), false, 'pas de nouvelle tentative proposée sur un refus');
  assert.equal(denied.calls.length, 1, 'une seule requête, aucune autre route essayée'); assert.equal(denied.all('.retention-row, .emploi-counter').length, 0);
});

test('les contenus venus du serveur sont échappés', async () => {
  const s = screen(report({ declined_applications: [application(1, { name: '<img src=x onerror=alert(1)>', basis: '<b>x</b>' })], undated: [{ name: '<script>1</script>', reason: '<i>r</i>' }] }));
  await s.run('refreshRetention()'); s.run("retentionToggle('declined_applications-0')");
  assert.equal(s.all('img, script, b, i').length, 0); assert.match(s.host.textContent, /<img src=x onerror=alert\(1\)>/);
});
