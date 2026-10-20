const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp, LOGIN_BOOT_URL } = require('./load-app');

for (const trackTimers of [false, true]) {
  test(`jsdom : mutations actives puis fermeture propre (timers=${trackTimers})`, async () => {
    const env = loadSgdiApp([], { url: LOGIN_BOOT_URL, trackTimers });
    const errors = [];
    env.dom.virtualConsole.on('jsdomError', error => errors.push(error));
    assert.equal(env.loadError, null);
    let delivered = 0;
    const observer = new env.window.MutationObserver(() => { delivered++; });
    observer.observe(env.window.document.body, { childList: true });
    env.window.document.body.appendChild(env.window.document.createElement('span'));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(delivered > 0, 'les vrais observateurs restent actifs avant close');
    let frames = 0;
    await new Promise(resolve => env.window.requestAnimationFrame(() => { frames++; resolve(); }));
    const cancelled = env.window.requestAnimationFrame(() => { frames++; });
    env.window.cancelAnimationFrame(cancelled);
    env.window.requestAnimationFrame(() => { frames++; });
    const beforeClose = delivered;
    env.window.document.body.appendChild(env.window.document.createElement('span'));
    env.window.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delivered, beforeClose, 'aucun rappel sur un document détruit');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(frames, 1, 'les rappels rAF annulés ou fermés ne sont pas livrés');
    assert.deepEqual(errors, []);
  });
}
