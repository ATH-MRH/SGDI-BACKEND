/**
 * Conversion des octets d'une image reçue du backend en URI `data:` affichable par <Image>.
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

/**
 * Type d'une image d'après ses premiers octets (JPEG, PNG ou WebP), sinon null.
 * La signature fait foi, pas l'en-tête Content-Type : une page d'erreur servie en 200 est
 * refusée, et une image reste acceptée si un intermédiaire a réécrit son type.
 */
export function imageTypeOfBytes(bytes: Uint8Array): string | null {
  const starts = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Taille maximale acceptée pour une image chargée en mémoire. */
export const MAX_IMAGE_BYTES = 2_000_000;
