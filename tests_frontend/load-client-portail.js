// Chargeur dédié pour app/static/client-portail.html. Charge la VRAIE page dans
// jsdom et expose les fonctions/état internes nécessaires aux tests via
// window.__portalTest (mêmes précautions que load-pointeur.js : fonction de
// remplacement, jamais une chaîne, pour éviter la corruption `$&`/`$1`).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'app', 'static', 'client-portail.html');
const RAW_HTML = fs.readFileSync(HTML_PATH, 'utf8');

function buildHtml() {
  const suffix = `
;window.__portalTest = {
  enterApp, switchTab, loadAttendance, setAttendancePeriod, attendancePeriodBounds,
  getSession: () => session,
  setSession: (s) => { session = s; },
};
`;
  return RAW_HTML.replace(/(<script>)([\s\S]*?)(<\/script>)/, (match, open, body, close) => open + body + suffix + close);
}

function loadClientPortail(options = {}) {
  const html = buildHtml();
  const dom = new JSDOM(html, {
    url: options.url || 'https://client.irongs.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = options.fetch || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
  return { dom, window, T: () => window.__portalTest || {} };
}

module.exports = { loadClientPortail };
