const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function setup() {
  const app = loadSgdiApp(['employeeAvatarHTML', 'hydrateEmployeePhotos', 'pruneEmployeePhotos']);
  assert.equal(app.loadError, null);
  const { window: w } = app;
  w.sessionStorage.setItem('sgdi_api_token_v1', 'test-photo-token');
  let observer;
  w.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observer = this; }
    observe(img) { this.observed.add(img); }
    unobserve(img) { this.observed.delete(img); }
  };
  const blobs = [], revoked = [], calls = [];
  w.URL.createObjectURL = blob => { blobs.push(blob); return `blob:test-${blobs.length}`; };
  w.URL.revokeObjectURL = url => revoked.push(url);
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, blob: async () => new w.Blob([String(url)], { type: 'image/png' }) };
  };
  const view = w.document.getElementById('view');
  const show = employees => {
    view.innerHTML = employees.map(a => `<div class="avatar" data-id="${a.backendId}">${app.T().employeeAvatarHTML(a)}</div>`).join('');
    app.T().hydrateEmployeePhotos(view);
  };
  const intersect = imgs => observer.callback(Array.from(imgs ? Array.from(imgs, img => img.parentElement) : observer.observed, target => {
    assert.equal(target.className, 'avatar', 'observer la boîte visible, jamais l’image masquée');
    return { target, isIntersecting: true };
  }));
  const close = () => { view.innerHTML = ''; app.T().pruneEmployeePhotos(); w.close(); };
  return { ...app, w, view, calls, blobs, revoked, show, intersect, close };
}
const employee = (id, hasPhoto = true, version = 'v1') => ({
  id: `legacy-${id}`, backendId: id, nom: `Nom${id}`, prenom: `Prenom${id}`,
  hasPhoto, photoUrl: hasPhoto ? `/api/ops/employees/${id}/photo?v=${version}` : '',
});
const flush = () => new Promise(resolve => setImmediate(resolve));

test('toute la population utilise son propre employee_id; seules les photos visibles sont chargées', async () => {
  const app = setup();
  try {
    const population = Array.from({ length: 2000 }, (_, i) => employee(i + 1, i % 3 !== 0));
    app.show(population);
    const images = [...app.view.querySelectorAll('img')];
    assert.equal(images.length, population.filter(a => a.hasPhoto).length);
    assert.equal(app.calls.length, 0, 'aucune requête pour les images hors viewport');
    for (const avatar of app.view.children) {
      const id = Number(avatar.dataset.id), image = avatar.querySelector('img');
      assert.equal(!!image, population[id - 1].hasPhoto);
      if (image) {
        assert.equal(image.dataset.photoEmployeeId, String(id));
        assert.equal(image.dataset.employeePhoto, `/api/ops/employees/${id}/photo?v=v1`);
        assert.equal(image.hasAttribute('src'), false, 'le token ne doit jamais apparaître dans src');
        assert.notEqual(image.getAttribute('loading'), 'lazy', 'le chargement différé observe l’avatar; le blob masqué doit pouvoir être décodé');
      }
    }
    app.intersect(images.slice(0, 12));
    await flush();
    assert.equal(app.calls.length, 12);
    for (let i = 0; i < 12; i++) {
      assert.equal(app.calls[i].url, images[i].dataset.employeePhoto);
      assert.equal(app.calls[i].options.headers.authorization, 'Bearer test-photo-token');
      assert.equal(app.calls[i].options.cache, 'no-cache');
      images[i].dispatchEvent(new app.w.Event('load'));
      assert.equal(images[i].previousElementSibling.hidden, true);
      assert.equal(images[i].style.display, 'block');
    }
  } finally { app.close(); }
});

test('absence, URL incohérente et contenu échappé gardent les bonnes initiales', () => {
  const app = setup();
  try {
    app.show([
      employee(1, false),
      { ...employee(2), photoUrl: '/api/ops/employees/99/photo?v=1' },
      { ...employee(3), photoUrl: 'https://evil.test/steal' },
      { ...employee(4, false), photo: '/uploads/photos/obsolete.jpg' },
      { ...employee(5), nom: '<script>', prenom: '" onclick="x' },
    ]);
    assert.equal(app.view.querySelectorAll('img').length, 1);
    assert.equal(app.view.querySelectorAll('script').length, 0);
    assert.equal(app.view.querySelectorAll('[onclick]').length, 0);
    assert.equal(app.calls.length, 0);
    assert.equal(app.view.firstElementChild.textContent, 'NP');
  } finally { app.close(); }
});

test('images absentes, interdites, corrompues ou réseau indisponible conservent les initiales', async () => {
  const app = setup();
  try {
    app.w.fetch = async url => {
      const id = Number(url.match(/employees\/(\d+)/)[1]);
      if (id === 1 || id === 2) return { ok: false, status: id === 1 ? 404 : 403 };
      if (id === 3) throw new Error('offline');
      return { ok: true, blob: async () => new app.w.Blob(['broken'], { type: id === 4 ? 'text/html' : 'image/png' }) };
    };
    app.show([1, 2, 3, 4, 5].map(id => employee(id)));
    app.intersect();
    await flush();
    const images = [...app.view.querySelectorAll('img')];
    images[4].dispatchEvent(new app.w.Event('error'));
    for (const img of images) {
      assert.equal(img.style.display, 'none');
      assert.equal(img.previousElementSibling.hidden, false);
    }
    assert.equal(app.blobs.length, 1, 'seul un MIME image passe jusqu’au décodeur navigateur');
  } finally { app.close(); }
});

test('les pages remplacées libèrent les blobs; une photo modifiée recharge sa nouvelle référence', async () => {
  const app = setup();
  try {
    app.show([employee(12)]); app.intersect(); await flush();
    const previousUrl = app.view.querySelector('img').src;
    app.show([employee(13), employee(14, false)]); app.intersect(); await flush();
    assert.ok(app.revoked.includes(previousUrl));
    app.show([employee(12, true, 'v2')]); app.intersect(); await flush();
    assert.equal(app.calls.at(-1).url, '/api/ops/employees/12/photo?v=v2');
    assert.notEqual(app.view.querySelector('img').src, previousUrl);
  } finally { app.close(); }
});

test('les réponses tardives ne contaminent ni une autre page ni une nouvelle session', async () => {
  const app = setup();
  try {
    const pending = [];
    app.w.fetch = (_url, options) => new Promise(resolve => pending.push({ resolve, options }));
    app.show([employee(1)]); app.intersect();
    const oldImage = app.view.querySelector('img');
    app.show([employee(2)]); app.intersect();
    assert.equal(pending[0].options.signal.aborted, true);
    app.w.sessionStorage.setItem('sgdi_api_token_v1', 'other-session');
    app.T().bumpSessionGeneration();
    for (const request of pending) request.resolve({ ok: true, blob: async () => new app.w.Blob(['png'], { type: 'image/png' }) });
    await flush();
    assert.equal(app.blobs.length, 0);
    assert.equal(oldImage.hasAttribute('src'), false);
    assert.equal(app.view.querySelector('img').hasAttribute('src'), false);
  } finally { app.close(); }
});

test('le chargement reste borné à six requêtes simultanées', async () => {
  const app = setup();
  try {
    let active = 0, maximum = 0;
    const pending = [];
    app.w.fetch = () => new Promise(resolve => {
      active++; maximum = Math.max(active, maximum);
      pending.push(() => { active--; resolve({ ok: false, status: 404 }); });
    });
    app.show(Array.from({ length: 100 }, (_, i) => employee(i + 1)));
    app.intersect();
    assert.equal(pending.length, 6);
    while (pending.length) { pending.shift()(); await flush(); }
    assert.equal(maximum, 6);
    assert.equal(active, 0);
  } finally { app.close(); }
});
