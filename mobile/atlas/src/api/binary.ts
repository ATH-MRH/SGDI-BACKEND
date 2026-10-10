/**
 * Conversion d'une image reçue du backend en URI `data:` affichable par <Image>.
 *
 * L'image n'est jamais écrite sur le disque : elle vit en mémoire, dans le cache de
 * données de la session, et disparaît avec lui.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 standard, sans dépendre de `btoa` ni de `Buffer` (absents selon le moteur). */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    output += ALPHABET[a >> 2];
    output += ALPHABET[((a & 3) << 4) | (b >> 4)];
    output += index + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    output += index + 2 < bytes.length ? ALPHABET[c & 63] : '=';
  }
  return output;
}

type Reader = { result: unknown; onload: (() => void) | null; onerror: (() => void) | null; readAsDataURL(blob: Blob): void };

function readerClass(): (new () => Reader) | null {
  const candidate = (globalThis as { FileReader?: new () => Reader }).FileReader;
  return typeof candidate === 'function' ? candidate : null;
}

/** Contenu d'un blob en base64. React Native lit un blob par FileReader ; ailleurs, par ses octets. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const FileReaderClass = readerClass();
  if (FileReaderClass) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReaderClass();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('lecture')));
      reader.onerror = () => reject(new Error('lecture'));
      reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : '';
  }
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Types d'image acceptés : ceux que le backend produit et que les deux plateformes affichent. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Type d'image reconnu d'un en-tête Content-Type ("image/jpeg; charset=…" → "image/jpeg"), sinon null. */
export function imageTypeOf(contentType: string | null | undefined): string | null {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (IMAGE_TYPES as readonly string[]).includes(type) ? type : null;
}

/** Taille maximale acceptée pour une image chargée en mémoire. */
export const MAX_IMAGE_BYTES = 2_000_000;

/** Taille en octets d'un contenu encodé en base64. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
