const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'pointeur.html'), 'utf8');
const source = html.match(/function normalizeUsbQrToken\(value\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(source, 'normalizeUsbQrToken introuvable dans pointeur.html');
const context = {};
vm.runInNewContext(`${source};this.normalizeUsbQrToken=normalizeUsbQrToken`, context);

test('douchette HC-666: corrige ! en _ dans un JWT', () => {
  const corrupted = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.C1W8O6YOaDW!KBMb5q4bclzot3Zki!UaTK4vAAN0Quo';
  assert.strictEqual(
    context.normalizeUsbQrToken(corrupted),
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.C1W8O6YOaDW_KBMb5q4bclzot3Zki_UaTK4vAAN0Quo'
  );
});

test('normalisation QR: retire espaces et fins de ligne sans modifier un JWT valide', () => {
  assert.strictEqual(context.normalizeUsbQrToken('  aaa.bbb.ccc\r\n'), 'aaa.bbb.ccc');
});

test('normalisation QR: ne remplace pas ! dans un texte qui ne ressemble pas à un JWT', () => {
  assert.strictEqual(context.normalizeUsbQrToken('BONJOUR!'), 'BONJOUR!');
});
