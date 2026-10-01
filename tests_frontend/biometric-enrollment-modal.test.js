// Gestion du pointage → Biométrie → Enrôlement → Ouvrir : nouvelle grande fenêtre
// « Enrôlement biométrique ». jsdom sur le VRAI app/static/pointage/index.html ; réseau simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../app/static/pointage/index.html'), 'utf8');
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const ROW = { employee_id: 5, matricule: 'K01', nom: 'ABDELALI HABIB CHAWKI', prenom: 'ABDELMAJID', fonction: 'CARISTE', site_id: 3,
  site: 'DHL FORWARDING / HAMOUL 01 (40K)', statut: 'actif', consent_admissible: false, enrollment: 'NONE', photo_available: true };
const CONSENT = { status: 'contract_confirmed', source: 'EMPLOYMENT_CONTRACT', proof_reference: 'Contrat CDD 2026-041 art. 12',
  consent_date: '2026-09-15T00:00:00', notice_version: '2026-09-v1', recorded_by: 'PTG01', admissible: true };
const status = (over = {}) => ({ employee_id: 5, enabled: false, enrollment_enabled: true,
  identity: { matricule: 'K01', nom: 'ABDELALI HABIB CHAWKI', prenom: 'ABDELMAJID', fonction: 'CARISTE', societe: 'IRON GLOBAL SOLUTION', statut: 'actif' },
  photo_url: '/uploads/photos/k01.jpg', consent: null, consent_history: [], photo_available: true, enrollment: 'NONE', active_template: null, templates: [], ...over });

async function open({ st = status(), cams = [{ id: 9, name: 'CAM-ENROL', active: true, usage: 'ENROLLMENT' }], routes = {} } = {}) {
  const calls = [];
  let current = st;
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML, {
    url: 'https://pointage.irongs.com/#/enrollment', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.sessionStorage.setItem('atlas_pointage_token', 'tok');
      w.prompt = () => 'Changement de visage';
      w.fetch = async (url, opts = {}) => {
        const u = new URL(url, 'https://pointage.irongs.com');
        const call = { path: u.pathname, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
        calls.push(call);
        const key = `${call.method} ${u.pathname}`;
        let res = routes[key];
        if (typeof res === 'function') res = res(call, (v) => { current = v; });
        res = await res;
        if (!res) {
          if (u.pathname === '/api/auth/me') res = [200, { username: 'PTG01', full_name: 'POINTEUR 01' }];
          else if (u.pathname === '/api/attendance/sites') res = [200, [{ id: 3, name: ROW.site, society: 'IRON GLOBAL SOLUTION' }]];
          else if (u.pathname === '/api/biometrics/employees') res = [200, [ROW]];
          else if (u.pathname === '/api/biometrics/employees/5') res = [200, current];
          else if (u.pathname === '/api/biometrics/notice') res = [200, { version: '2026-09-v1', text: 'Finalité : contrôler le pointage.' }];
          else if (u.pathname === '/api/biometrics/cameras') res = [200, cams];
          else res = [200, {}];
        }
        return { ok: res[0] < 400, status: res[0], text: async () => JSON.stringify(res[1]) };
      };
    },
  });
  const w = dom.window, d = w.document;
  for (let i = 0; i < 40 && !d.querySelector('[data-en="5"]'); i++) await tick(20);
  const opener = d.querySelector('[data-en="5"]');
  opener.focus();
  opener.click();
  for (let i = 0; i < 40 && !d.getElementById('bio-title'); i++) await tick(20);
  const text = (sel) => (d.querySelector(sel) ? d.querySelector(sel).textContent.replace(/\s+/g, ' ').trim() : null);
  return { dom, w, d, calls, opener, text, setStatus: (v) => { current = v; } };
}

test('grande fenêtre : en-tête Enrôlement biométrique, dialogue accessible, ancienne petite modale supprimée', async () => {
  const t = await open();
  const dlg = t.d.querySelector('#modal-host [role="dialog"]');
  assert.equal(dlg.getAttribute('aria-modal'), 'true');
  assert.equal(dlg.getAttribute('aria-labelledby'), 'bio-title');
  assert.ok(t.d.querySelector('.modal.modal-xl'), 'grande fenêtre');
  assert.equal(t.text('#bio-title'), 'Enrôlement biométrique');
  assert.match(t.text('.bio-head'), /Gestion du consentement et création du gabarit facial/);
  assert.doesNotMatch(t.d.getElementById('modal-host').textContent, /Biométrie — /);              // plus de titre « Biométrie — NOM »
  assert.equal(t.d.getElementById('bio-x').getAttribute('aria-label'), 'Fermer la fenêtre');
  assert.ok(t.d.body.classList.contains('modal-open'), 'la page derrière ne défile pas');
  t.dom.window.close();
});

test('informations employé dynamiques : nom, matricule, fonction, site, statut Actif, mode Facial désactivé', async () => {
  const t = await open();
  const info = t.text('.bio-info');
  for (const v of ['ABDELALI HABIB CHAWKI ABDELMAJID', 'K01', 'CARISTE', 'DHL FORWARDING / HAMOUL 01 (40K)', 'Actif', 'Facial désactivé']) assert.ok(info.includes(v), v);
  assert.ok(t.d.querySelector('#bio-rh-status .bio-badge.ok'));
  t.dom.window.close();
  const s = await open({ st: status({ enabled: true, identity: { ...status().identity, nom: 'SUSP', prenom: 'Test', statut: 'suspendu' } }) });
  assert.equal(s.text('#bio-rh-status'), 'Suspendu');
  assert.ok(s.d.querySelector('#bio-rh-status .bio-badge.warn'));
  assert.equal(s.text('#bio-mode'), 'Facial activé');
  assert.equal(s.text('#bio-name'), 'SUSP Test');
  s.dom.window.close();
});

test('photo DRH : disponible (grande image + aperçu pleine taille, sans téléchargement) ; absente (aucune image cassée)', async () => {
  const t = await open();
  assert.equal(t.d.getElementById('bio-photo-img').getAttribute('src'), '/uploads/photos/k01.jpg');
  assert.match(t.text('.bio-photo-meta'), /✓ Photo disponible Photo issue de la fiche employé/);
  assert.equal(Array.from(t.d.querySelectorAll('#modal-host button')).some((b) => /Télécharger/.test(b.textContent)), false);
  t.d.getElementById('bio-photo-zoom').click();
  assert.ok(t.d.querySelector('.bio-lightbox img'));
  t.d.querySelector('.bio-lightbox button').click();
  assert.equal(t.d.querySelector('.bio-lightbox'), null);
  t.dom.window.close();
  const a = await open({ st: status({ photo_url: null, photo_available: false }) });
  assert.equal(a.d.getElementById('bio-photo-img'), null);
  assert.equal(a.text('#bio-photo-missing'), 'Photo absente');
  assert.equal(a.d.getElementById('bio-photo-zoom'), null);
  a.dom.window.close();
});

test('consentement non enregistré : badge, bannière, texte d\'information versionné, formulaire et enregistrement qui actualise tout', async () => {
  const t = await open({ routes: { 'POST /api/biometrics/employees/5/consent': (call, set) => { set(status({ consent: { ...CONSENT, ...call.body, admissible: true } })); return [200, {}]; } } });
  assert.equal(t.text('#bio-consent-badge'), 'Non enregistré');
  assert.match(t.text('#bio-consent'), /Le consentement de l'employé est obligatoire avant tout enrôlement biométrique/);
  assert.match(t.text('#bio-consent summary'), /Voir le texte d'information employé \(2026-09-v1\)/);
  assert.deepEqual(Array.from(t.d.querySelectorAll('#cs-status option')).map((o) => o.value), ['contract_confirmed', 'explicit_confirmed', 'pending', 'refused', 'withdrawn']);
  assert.deepEqual(Array.from(t.d.querySelectorAll('#cs-source option')).map((o) => o.value), ['EMPLOYMENT_CONTRACT', 'HR_DOCUMENT', 'DIGITAL_ENROLLMENT', 'OTHER_AUTHORIZED_PROCESS']);
  assert.equal(t.d.getElementById('cs-ref').placeholder, 'Ex. Contrat CDD 2026-041 art. 12');
  assert.equal(t.d.getElementById('cs-ref').value, '');
  assert.equal(t.d.getElementById('cs-date').type, 'date');
  assert.equal(Array.from(t.d.querySelectorAll('#modal-host input[type="file"]')).length, 0, 'aucune pièce jointe (non supportée)');
  // Enrôlement bloqué tant que le consentement manque.
  assert.match(t.text('#bio-need-consent'), /Enregistrez d'abord le consentement/);
  assert.equal(t.d.getElementById('en-photo').disabled, true);
  assert.equal(t.d.getElementById('en-cam-btn').disabled, true);
  t.d.getElementById('cs-ref').value = 'Contrat CDD 2026-041 art. 12';
  t.d.getElementById('cs-date').value = '2026-09-15';
  t.d.getElementById('consent-form').dispatchEvent(new t.w.Event('submit', { cancelable: true }));
  await tick(120);
  assert.deepEqual(t.calls.find((c) => c.method === 'POST' && c.path.endsWith('/consent')).body,
    { status: 'contract_confirmed', source: 'EMPLOYMENT_CONTRACT', proof_reference: 'Contrat CDD 2026-041 art. 12', consent_date: '2026-09-15T00:00:00', notice_version: '2026-09-v1' });
  assert.equal(t.text('#bio-consent-badge'), 'Enregistré');                                    // actualisé sans recharger
  assert.equal(t.d.getElementById('bio-need-consent'), null);
  assert.equal(t.d.getElementById('en-photo').disabled, false);
  assert.equal(t.d.getElementById('en-cam-btn').disabled, false);
  t.dom.window.close();
});

test('consentement déjà enregistré : métadonnées affichées, aucune ressaisie imposée', async () => {
  const t = await open({ st: status({ consent: CONSENT }) });
  assert.equal(t.text('#bio-consent-badge'), 'Enregistré');
  const meta = t.text('#bio-consent-meta');
  for (const v of ['Accord du contrat confirmé', 'Contrat de travail', 'Contrat CDD 2026-041 art. 12', '15/09/2026', '2026-09-v1', 'PTG01']) assert.ok(meta.includes(v), v);
  assert.equal(t.d.getElementById('bio-consent-update').open, false, 'formulaire replié');
  t.dom.window.close();
  const r = await open({ st: status({ consent: { ...CONSENT, status: 'refused', admissible: false } }) });
  assert.equal(r.text('#bio-consent-badge'), 'Refusé');
  r.dom.window.close();
});

test('enrôlement facial : badge Aucun gabarit / gabarit actif / revue ; conditions ; aucune caméra ⇒ démarrage impossible', async () => {
  const t = await open({ st: status({ consent: CONSENT }) });
  assert.equal(t.text('#bio-enroll-badge'), 'Aucun gabarit');
  assert.match(t.text('.bio-checks'), /Consentement admissible.*Photo DRH — disponible.*Enrôlement autorisé sur ce serveur.*Caméra d'enrôlement du site/);
  t.dom.window.close();
  const g = await open({ st: status({ consent: CONSENT, enrollment: 'ACTIVE', templates: [{ status: 'ACTIVE', source: 'CAMERA', created_at: '2026-09-20T10:00:00' }] }) });
  assert.equal(g.text('#bio-enroll-badge'), 'Gabarit actif');
  assert.ok(g.d.getElementById('en-off'), 'désactivation conservée');
  assert.match(g.text('.bio-templates'), /Actif · caméra · 2026-09-20 10:00/);
  g.dom.window.close();
  const rv = await open({ st: status({ consent: CONSENT, enrollment: 'PENDING_REVIEW' }) });
  assert.equal(rv.text('#bio-enroll-badge'), 'Revue requise (doublon possible)');
  rv.dom.window.close();
  const nc = await open({ st: status({ consent: CONSENT }), cams: [] });
  assert.equal(nc.d.getElementById('en-cam-btn').disabled, true);
  assert.equal(nc.d.getElementById('en-photo').disabled, false);
  assert.match(nc.text('.bio-checks'), /Caméra d'enrôlement du site — aucune déclarée/);
  nc.dom.window.close();
  const off = await open({ st: status({ consent: CONSENT, enrollment_enabled: false }) });
  assert.equal(off.d.getElementById('en-photo').disabled, true);
  assert.match(off.text('#bio-enroll'), /Enrôlement désactivé sur ce serveur/);
  off.dom.window.close();
});

test('analyse photo DRH : protégée contre le double clic, résultat dans la section, rien créé avant confirmation', async () => {
  let release;
  const preview = { source: 'EMPLOYEE_PHOTO', photo: { state: 'OK', reasons: [], quality: { detection_score: 0.97, face_px: 151, sharpness: 640 } },
    capture: null, comparison: { score: null, result: 'NOT_APPLICABLE', threshold: 0.363, review_margin: 0.07 }, duplicate: { suspected: false },
    can_confirm: true, requires_justification: false, token: 'tok-photo-1234567890123456' };
  const t = await open({ st: status({ consent: CONSENT }), routes: {
    'POST /api/biometrics/employees/5/enrollment/preview': () => new Promise((r) => { release = () => r([200, preview]); }).then((x) => x),
    'POST /api/biometrics/employees/5/enrollment/confirm': [200, { status: 'ACTIVE' }] } });
  t.d.getElementById('en-photo').click();
  t.d.getElementById('en-photo').click();                                                       // double clic
  await tick(30);
  assert.equal(t.calls.filter((c) => c.path.endsWith('/preview')).length, 1);
  assert.equal(t.d.getElementById('en-photo').disabled, true);
  release();
  await tick(80);
  const res = t.text('#bio-result');
  assert.match(res, /Résultat de l'analyse Prêt à confirmer/);
  assert.match(res, /Photo DRH : Visage exploitable · qualité : détection 0\.97, visage 151 px, netteté 640/);
  assert.equal(t.calls.some((c) => c.path.endsWith('/confirm')), false);
  t.d.getElementById('en-confirm').click();
  await tick(80);
  assert.deepEqual(t.calls.find((c) => c.path.endsWith('/confirm')).body, { token: 'tok-photo-1234567890123456', confirm: true, justification: null });
  t.dom.window.close();
});

test('démarrer l\'enrôlement : capture supervisée sur la caméra choisie, refus affiché sans confirmation possible', async () => {
  const preview = { source: 'CAMERA', photo: { state: 'OK' }, capture: { state: 'LIVENESS_FAILED', reasons: ['Présence réelle non confirmée'], liveness: 0.2 },
    comparison: null, duplicate: null, can_confirm: false, requires_justification: false, token: null };
  const t = await open({ st: status({ consent: CONSENT }), routes: { 'POST /api/biometrics/employees/5/enrollment/preview': [200, preview] } });
  assert.match(t.text('#en-cam-btn'), /Démarrer l'enrôlement/);
  t.d.getElementById('en-cam-btn').click();
  await tick(80);
  assert.deepEqual(t.calls.find((c) => c.path.endsWith('/preview')).body, { camera_id: 9 });
  assert.match(t.text('#bio-result'), /Enrôlement impossible.*Capture : Présence réelle non confirmée — Présence réelle non confirmée · liveness 0\.2/);
  assert.equal(t.d.getElementById('en-confirm').disabled, true);
  t.dom.window.close();
});

test('fermeture : ×, Fermer, Échap — focus rendu au bouton « Ouvrir », défilement de la page rétabli', async () => {
  for (const how of ['x', 'close', 'escape']) {
    const t = await open();
    if (how === 'x') t.d.getElementById('bio-x').click();
    if (how === 'close') t.d.getElementById('bio-close').click();
    if (how === 'escape') t.d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(t.d.getElementById('modal-host').innerHTML, '', how);
    assert.equal(t.d.body.classList.contains('modal-open'), false, how);
    assert.equal(t.d.activeElement, t.d.querySelector('[data-en="5"]'), how);
    t.dom.window.close();
  }
});

test('structure responsive et aucune donnée biométrique sensible affichée', async () => {
  const t = await open({ st: status({ consent: CONSENT }) });
  const css = Array.from(t.d.querySelectorAll('style')).map((s) => s.textContent).join('');
  assert.match(css, /\.modal\.modal-xl\{max-width:min\(1120px,calc\(100vw - 40px\)\);max-height:92vh/);
  assert.match(css, /\.bio-top\{display:grid;grid-template-columns:minmax\(0,55fr\) minmax\(0,45fr\)/);
  assert.match(css, /@media \(max-width:900px\)\{\.bio-top\{grid-template-columns:1fr\}/);
  assert.ok(css.includes('@media (max-width:560px){') && css.includes('.bio-info,.bio-form{grid-template-columns:1fr}'));
  const order = Array.from(t.d.querySelectorAll('.bio-body h4')).map((h) => h.id);
  assert.deepEqual(order, ['bio-info-title', 'bio-photo-title', 'bio-consent-title', 'bio-enroll-title']);
  assert.deepEqual(Array.from(t.d.querySelectorAll('.bio-foot button')).map((b) => b.id), ['bio-close', 'en-photo', 'en-cam-btn']);
  assert.doesNotMatch(t.d.getElementById('modal-host').innerHTML, /embedding|gabarit chiffré|template_key/i);
  t.dom.window.close();
});
