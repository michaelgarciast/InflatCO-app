import { detectImageType } from './image.js';

const withPadding = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)]);

describe('detectImageType', () => {
  it.each([
    ['image/jpeg', Buffer.from('ffd8ffe0', 'hex')],
    ['image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    [
      'image/webp',
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WEBP'),
      ]),
    ],
    ['image/heic', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic')])],
  ])('reconoce %s', (type, head) => {
    expect(detectImageType(withPadding(head))).toBe(type);
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.7')],
    [
      'MP4 (ftyp sin marca HEIC)',
      Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]),
    ],
    ['archivo vacío', Buffer.alloc(0)],
  ])('rechaza %s', (_, head) => {
    expect(detectImageType(withPadding(head))).toBeNull();
  });
});
