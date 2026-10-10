import { base64ByteLength, bytesToBase64, imageTypeOf } from '@/api/binary';

describe('images en mémoire', () => {
  it('encode en base64 standard, bourrage compris', () => {
    const encode = (text: string) => bytesToBase64(new Uint8Array([...text].map((char) => char.charCodeAt(0))));
    expect(encode('')).toBe('');
    expect(encode('f')).toBe('Zg==');
    expect(encode('fo')).toBe('Zm8=');
    expect(encode('foo')).toBe('Zm9v');
    expect(encode('foobar')).toBe('Zm9vYmFy');
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xfb, 0xfe]))).toBe(Buffer.from([0xff, 0xd8, 0xff, 0xfb, 0xfe]).toString('base64'));
  });

  it('retrouve la taille en octets depuis le base64', () => {
    for (const size of [0, 1, 2, 3, 4, 255, 1000]) {
      expect(base64ByteLength(bytesToBase64(new Uint8Array(size)))).toBe(size);
    }
  });

  it("ne reconnaît que les types d'image attendus", () => {
    expect(imageTypeOf('image/jpeg')).toBe('image/jpeg');
    expect(imageTypeOf('Image/PNG; charset=binary')).toBe('image/png');
    expect(imageTypeOf('image/webp')).toBe('image/webp');
    for (const other of ['image/svg+xml', 'text/html', 'application/json', 'application/octet-stream', '', null, undefined]) {
      expect(imageTypeOf(other)).toBeNull();
    }
  });
});
