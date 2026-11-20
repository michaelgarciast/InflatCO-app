import { createHash } from 'node:crypto';

export type ImageType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
]);

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, i) => buffer[offset + i] === byte);

// Por magic bytes: el Content-Type y el nombre los controla el cliente.
export function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    HEIC_BRANDS.has(buffer.toString('ascii', 8, 12))
  ) {
    return 'image/heic';
  }
  return null;
}

export const hashImage = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');
