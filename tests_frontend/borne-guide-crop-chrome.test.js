// Correctif C1 — « ce qui est dans le cercle à l'écran = la photo envoyée », vérifié AU PIXEL
// dans un vrai Chrome : vraie page /borne (CSS réel : object-fit cover, miroir), vraie balise
// <video> alimentée par une source synthétique dont chaque pixel encode sa position (rouge = x,
// vert = y). Tablette portrait/paysage, smartphone portrait, plusieurs formats de caméra, et
// rotation en cours de prise. `npm run test:borne-guide-crop` (skip explicite sans Chrome).
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '../app/static');
const JS = fs.readFileSync(path.join(ROOT, 'pointeur-borne.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'pointeur-borne.html'), 'utf8')
  .replace(/<script src="\/static\/pointeur-borne\.js[^"]*"><\/script>/, () => `<script>${JS}</script>`);
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = null; }
const SKIP = !CHROME ? 'Chrome absent' : !puppeteer ? 'puppeteer-core absent' : false;

const CASES = [
  { name: 'tablette portrait 800×1280, caméra 1280×720', viewport: { width: 800, height: 1280 }, source: [1280, 720] },
  { name: 'tablette portrait 800×1280, caméra 720×1280', viewport: { width: 800, height: 1280 }, source: [720, 1280] },
  { name: 'tablette paysage 1280×800, caméra 1280×720', viewport: { width: 1280, height: 800 }, source: [1280, 720] },
  { name: 'smartphone portrait 412×915, caméra 640×480', viewport: { width: 412, height: 915 }, source: [640, 480] },
  { name: 'smartphone portrait 412×915, caméra 720×1280', viewport: { width: 412, height: 915 }, source: [720, 1280] },
];

// Dans la page : source synthétique → <video>, puis mode prise de photo (cercle posé sur la géométrie).
async function mount(page, [W, H]) {
  await page.evaluate(async (W, H) => {
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const ctx = src.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = Math.round((x * 255) / (W - 1)); img.data[i + 1] = Math.round((y * 255) / (H - 1)); img.data[i + 2] = 40; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    window.__repaint = setInterval(() => ctx.putImageData(img, 0, 0), 60);
    const video = document.getElementById('kioskVideo');
    video.srcObject = src.captureStream(20);
    await video.play();
    for (let i = 0; i < 100 && video.videoWidth !== W; i++) await new Promise((r) => setTimeout(r, 50));
    document.getElementById('kioskPairing').remove();                    // borne sans identité (test) : pas d'écran d'association
    window.AtlasBorne.remote = { status: 'WAITING_FOR_FACE' };
    window.AtlasBorne.layoutGuide('adjust');
  }, W, H);
}

// Pixel → position source (rouge = x, vert = y), au milieu d'une petite zone (bruit d'encodage moyenné).
function decode(pixel, [W, H]) { return [(pixel[0] / 255) * (W - 1), (pixel[1] / 255) * (H - 1)]; }

async function measure(page, source) {
  return page.evaluate(async ([W, H]) => {
    const video = document.getElementById('kioskVideo');
    const frame = document.querySelector('.kiosk-frame');
    const v = video.getBoundingClientRect(), f = frame.getBoundingClientRect();
    const g = window.AtlasBorne.guideGeometry({ elW: v.width, elH: v.height, vw: video.videoWidth, vh: video.videoHeight });
    const dataUrl = window.AtlasBorne.captureGuide(640, 0.95);
    const im = new Image();
    await new Promise((r) => { im.onload = r; im.src = dataUrl; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
    const at = (u, v2) => {
      const d = ctx.getImageData(Math.round(u * (im.width - 7)), Math.round(v2 * (im.height - 7)), 7, 7).data;
      let r = 0, gr = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; } return [r / 49, gr / 49];
    };
    return { video: { left: v.left, top: v.top, width: v.width, height: v.height }, frame: { left: f.left, top: f.top, width: f.width, height: f.height },
      geo: g, crop: { width: im.width, height: im.height, samples: [[0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85], [0.5, 0.5]].map(([u, w]) => ({ u, v: w, rgb: at(u, w) })) },
      classes: frame.className, dataUrl: dataUrl.slice(0, 23) };
  }, source);
}

test('cercle de capture : écran = recadrage, au pixel, dans un vrai Chrome', { skip: SKIP, timeout: 240000 }, async (t) => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'atlas_guide_')), args: ['--no-first-run'] });
  t.after(() => browser.close().catch(() => {}));
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { window.__ATLAS_BORNE_NO_AUTOSTART__ = true; });
  for (const c of CASES) {
    await t.test(c.name, async () => {
      await page.setViewport(c.viewport);
      await page.setContent(HTML, { waitUntil: 'load' });
      await mount(page, c.source);
      const m = await measure(page, c.source);
      const [W, H] = c.source;
      // 1. Le cercle DESSINÉ est exactement celui de la géométrie canonique.
      assert.match(m.classes, /is-guide/);
      assert.ok(Math.abs(m.frame.width - m.geo.display.d) < 1 && Math.abs(m.frame.height - m.geo.display.d) < 1, JSON.stringify(m.frame));
      assert.ok(Math.abs(m.frame.left - (m.video.left + m.geo.display.cx - m.geo.display.d / 2)) < 1);
      assert.ok(Math.abs(m.frame.top - (m.video.top + m.geo.display.cy - m.geo.display.d / 2)) < 1);
      // 2. La photo est le CARRÉ du cercle, jamais agrandie, jamais l'image complète.
      assert.strictEqual(m.dataUrl, 'data:image/jpeg;base64,');
      assert.strictEqual(m.crop.width, m.crop.height);
      assert.strictEqual(m.crop.width, Math.round(Math.min(640, m.geo.video.side)));
      assert.ok(m.crop.width < Math.max(W, H));
      // 3. Chaque point de la photo vient de l'endroit attendu de la source (tolérance d'encodage).
      const tolX = 0.02 * W + 3, tolY = 0.02 * H + 3;
      for (const s of m.crop.samples) {
        const [x, y] = decode(s.rgb, c.source);
        const ex = m.geo.video.sx + s.u * m.geo.video.side, ey = m.geo.video.sy + s.v * m.geo.video.side;
        assert.ok(Math.abs(x - ex) <= tolX && Math.abs(y - ey) <= tolY, `${c.name} : (${s.u},${s.v}) → source (${x.toFixed(0)},${y.toFixed(0)}) attendu (${ex.toFixed(0)},${ey.toFixed(0)})`);
      }
      // 4. Ce que l'ÉCRAN montre dans le cercle = ce que contient la photo (miroir pris en compte une seule fois).
      const shot = await page.screenshot({ clip: { x: m.frame.left, y: m.frame.top, width: m.frame.width, height: m.frame.height }, encoding: 'base64' });
      const screen = await page.evaluate(async (b64) => {
        const im = new Image(); await new Promise((r) => { im.onload = r; im.src = 'data:image/png;base64,' + b64; });
        const c2 = document.createElement('canvas'); c2.width = im.width; c2.height = im.height;
        const ctx = c2.getContext('2d'); ctx.drawImage(im, 0, 0);
        const at = (u, v) => { const d = ctx.getImageData(Math.round(u * im.width) - 3, Math.round(v * im.height) - 3, 7, 7).data; let r = 0, g = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; } return [r / 49, g / 49]; };
        return [[0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8], [0.5, 0.5]].map(([u, v]) => ({ u, v, rgb: at(u, v) }));
      }, shot);
      for (const p of screen) {
        const [x, y] = decode(p.rgb, c.source);
        // Écran miroir : le point affiché à gauche du cercle est à droite dans la photo.
        const ex = m.geo.video.sx + (1 - p.u) * m.geo.video.side, ey = m.geo.video.sy + p.v * m.geo.video.side;
        assert.ok(Math.abs(x - ex) <= tolX && Math.abs(y - ey) <= tolY, `écran (${p.u},${p.v}) → source (${x.toFixed(0)},${y.toFixed(0)}) attendu (${ex.toFixed(0)},${ey.toFixed(0)})`);
      }
      await page.evaluate(() => clearInterval(window.__repaint));
    });
  }

  await t.test('rotation en cours de prise : le cercle et le recadrage suivent, sans décalage', async () => {
    await page.setViewport({ width: 800, height: 1280 });
    await page.setContent(HTML, { waitUntil: 'load' });
    await mount(page, [1280, 720]);
    const before = await measure(page, [1280, 720]);
    await page.setViewport({ width: 1280, height: 800 });                 // la tablette pivote
    await new Promise((r) => setTimeout(r, 300));
    const after = await measure(page, [1280, 720]);
    assert.notStrictEqual(Math.round(after.frame.width), Math.round(before.frame.width));
    assert.ok(Math.abs(after.frame.width - after.geo.display.d) < 1);
    assert.ok(Math.abs(after.frame.left - (after.video.left + after.geo.display.cx - after.geo.display.d / 2)) < 1);
    const [x, y] = decode(after.crop.samples[4].rgb, [1280, 720]);
    assert.ok(Math.abs(x - 640) <= 30 && Math.abs(y - 360) <= 20, 'centre de la photo = centre de la caméra');
    // Fin de prise : le cercle d'origine revient.
    await page.evaluate(() => { window.AtlasBorne.remote = null; window.AtlasBorne.layoutGuide(); });
    assert.strictEqual(await page.$eval('.kiosk-frame', (e) => e.className), 'kiosk-frame');
  });
});
