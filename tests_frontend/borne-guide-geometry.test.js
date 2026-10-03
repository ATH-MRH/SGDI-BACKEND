// Correctif C1 — géométrie canonique du cercle de capture (pointeur-borne.js, fonction pure).
// Le cercle DESSINÉ (repère de l'élément vidéo affiché, miroir) et le CARRÉ RECADRÉ (pixels de
// la vidéo source, non miroir) doivent désigner exactement la même zone, quels que soient le
// format de l'écran, celui de la caméra, object-fit et l'orientation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const JS = fs.readFileSync(path.join(__dirname, '../app/static/pointeur-borne.js'), 'utf8');
function borne() {
  const dom = new JSDOM('<!doctype html><body><video id="kioskVideo"></video><div class="kiosk-frame"></div></body>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
    beforeParse(w) { w.__ATLAS_BORNE_NO_AUTOSTART__ = true; } });
  dom.window.__ATLAS_BORNE_NO_AUTOSTART__ = true;
  dom.window.eval(JS);
  return dom;
}
const dom = borne();
const geometry = dom.window.AtlasBorne.guideGeometry;

// Conversion indépendante (réécrite ici, pas copiée) : point AFFICHÉ → pixel de la vidéo source.
function displayToVideo({ elW, elH, vw, vh, fit = 'cover', mirrored = true }, x, y) {
  const s = fit === 'contain' ? Math.min(elW / vw, elH / vh) : Math.max(elW / vw, elH / vh);
  const ox = (elW - vw * s) / 2, oy = (elH - vh * s) / 2;
  const ex = mirrored ? elW - x : x;                 // l'élément est retourné (scaleX(-1)) autour de son centre
  return [(ex - ox) / s, (y - oy) / s];
}
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const VIEWS = {
  'tablette paysage 16:10, caméra 16:9': { elW: 1248, elH: 560, vw: 1280, vh: 720 },
  'tablette portrait, caméra paysage 16:9': { elW: 768, elH: 900, vw: 1280, vh: 720 },
  'tablette portrait, caméra portrait 9:16': { elW: 768, elH: 900, vw: 720, vh: 1280 },
  'smartphone portrait 9:16, caméra 4:3': { elW: 380, elH: 560, vw: 640, vh: 480 },
  'smartphone portrait, caméra portrait 9:16': { elW: 380, elH: 560, vw: 720, vh: 1280 },
  'écran 4:3, caméra 16:9': { elW: 800, elH: 600, vw: 1920, vh: 1080 },
  'object-fit contain (bandes noires)': { elW: 900, elH: 900, vw: 1280, vh: 720, fit: 'contain' },
  'aperçu non miroir': { elW: 1000, elH: 700, vw: 1280, vh: 720, mirrored: false },
};

for (const [name, view] of Object.entries(VIEWS)) {
  test(`géométrie : ${name}`, () => {
    const g = geometry(view);
    const s = view.fit === 'contain' ? Math.min(view.elW / view.vw, view.elH / view.vh) : Math.max(view.elW / view.vw, view.elH / view.vh);
    const visW = Math.min(view.elW, view.vw * s), visH = Math.min(view.elH, view.vh * s);
    // Cercle : 84 % du plus petit côté VISIBLE, centré dans la zone vidéo visible.
    assert.ok(close(g.display.d, 0.84 * Math.min(visW, visH)));
    assert.ok(close(g.display.cx, view.elW / 2) && close(g.display.cy, view.elH / 2));
    // CSS → vidéo : les 4 points extrêmes du cercle affiché tombent sur les bords du carré recadré
    // (gauche/droite échangés par le miroir), le centre sur son centre.
    const { sx, sy, side } = g.video;
    const [cxv, cyv] = displayToVideo(view, g.display.cx, g.display.cy);
    assert.ok(close(cxv, sx + side / 2, 1e-6) && close(cyv, sy + side / 2, 1e-6), 'centre');
    const [leftX] = displayToVideo(view, g.display.cx - g.display.d / 2, g.display.cy);
    const [rightX] = displayToVideo(view, g.display.cx + g.display.d / 2, g.display.cy);
    const [, topY] = displayToVideo(view, g.display.cx, g.display.cy - g.display.d / 2);
    const [, bottomY] = displayToVideo(view, g.display.cx, g.display.cy + g.display.d / 2);
    const mirrored = view.mirrored !== false;
    assert.ok(close(Math.min(leftX, rightX), sx) && close(Math.max(leftX, rightX), sx + side), 'bords gauche/droite');
    assert.ok(mirrored ? leftX > rightX : leftX < rightX, 'miroir appliqué une seule fois');
    assert.ok(close(topY, sy) && close(bottomY, sy + side), 'bords haut/bas');
    // Vidéo → recadrage : carré, entièrement dans la vidéo source, jamais plus grand qu'elle.
    assert.ok(close(side, g.display.d / s));
    assert.ok(sx >= 0 && sy >= 0 && sx + side <= view.vw + 1e-9 && sy + side <= view.vh + 1e-9);
    assert.ok(side <= Math.min(view.vw, view.vh));
  });
}

test('rotation de l\'appareil : la géométrie suit les nouvelles dimensions (aucun recadrage décalé)', () => {
  const landscape = geometry({ elW: 1248, elH: 560, vw: 1280, vh: 720 });
  const portrait = geometry({ elW: 768, elH: 1100, vw: 720, vh: 1280 });
  assert.ok(close(landscape.video.sx + landscape.video.side / 2, 640) && close(landscape.video.sy + landscape.video.side / 2, 360));
  assert.ok(close(portrait.video.sx + portrait.video.side / 2, 360) && close(portrait.video.sy + portrait.video.side / 2, 640));
  assert.equal(geometry({ elW: 0, elH: 560, vw: 1280, vh: 720 }), null, 'vidéo pas encore prête : aucune géométrie');
  assert.equal(geometry({ elW: 800, elH: 560, vw: 0, vh: 0 }), null);
});

test('exemple chiffré : tablette Samsung paysage, caméra 1280×720', () => {
  const g = geometry({ elW: 1248, elH: 560, vw: 1280, vh: 720 });
  // cover : échelle max(1248/1280, 560/720) = 0,975 ; zone visible 1248×560 ; cercle 470,4 px.
  assert.ok(close(g.scale, 0.975) && close(g.display.d, 470.4));
  assert.ok(close(g.video.side, 482.4615384615, 1e-6) && close(g.video.sx, 398.769230769, 1e-6) && close(g.video.sy, 118.769230769, 1e-6));
});
