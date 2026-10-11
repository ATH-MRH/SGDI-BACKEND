import { bytesToBase64, imageTypeOfBytes } from '@/api/binary';

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

  it("ne reconnaît que les images attendues, à leur signature", () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    expect(imageTypeOfBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(imageTypeOfBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(imageTypeOfBytes(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    const text = (value: string) => new Uint8Array([...value].map((char) => char.charCodeAt(0)));
    for (const other of [bytes(), bytes(0xff, 0xd8), text('<svg/>'), text('<html>'), text('{"ok":true}'), text('RIFF....WAVE'), text('GIF89a')]) {
      expect(imageTypeOfBytes(other)).toBeNull();
    }
  });
});
