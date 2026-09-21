import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { IdentityError } from '../identity/policy.js';

/**
 * Photos for the public site: hero slides, track cards, about/contact and project covers.
 *
 * The same two-area discipline as organisation logos: bytes land in quarantine, are identified by
 * their magic number rather than by what the client declared, checked for active content and sane
 * dimensions, and only then moved to the public area. Nothing in quarantine is ever served.
 */

export const SITE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const SITE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SiteMediaType = typeof SITE_MEDIA_TYPES[number];
const KEY = /^site\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.bin$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const isSiteMediaKey = (value: string) => KEY.test(value);
export const isSiteMediaId = (value: string) => ID.test(value);
export const siteMediaIdOf = (imageKey: string) => KEY.exec(imageKey)?.[1] ?? '';
/** The public URL carries the random image id only, never the project or item it belongs to. */
export const siteMediaUrl = (imageKey: string) => `/api/v1/site-media/${siteMediaIdOf(imageKey)}`;
export const siteMediaKey = (id: string) => `site/${id}.bin`;

function jpegDimensions(bytes: Buffer) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1] ?? 0;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += length + 2;
  }
  return null;
}

// The three WebP bitstreams each store their canvas size differently (lossy, lossless, extended).
function webpDimensions(bytes: Buffer) {
  if (bytes.length < 30) return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes.subarray(21, 25);
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  return null;
}

export function detectImage(bytes: Buffer): { contentType: SiteMediaType; width: number; height: number } | null {
  if (bytes.subarray(0, PNG.length).equals(PNG)) {
    if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { contentType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.subarray(0, JPEG.length).equals(JPEG)) {
    const dimensions = jpegDimensions(bytes);
    return dimensions ? { contentType: 'image/jpeg', ...dimensions } : null;
  }
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const dimensions = webpDimensions(bytes);
    return dimensions ? { contentType: 'image/webp', ...dimensions } : null;
  }
  return null;
}

export class SiteMediaStorage {
  private readonly root = resolve(process.cwd(), '.local', 'site-media');

  private path(area: 'quarantine' | 'public', imageKey: string) {
    if (!KEY.test(imageKey)) throw new IdentityError('invalid_input', 422);
    const base = resolve(this.root, area);
    const target = resolve(base, ...imageKey.split('/'));
    if (!target.startsWith(`${base}${sep}`)) throw new IdentityError('invalid_input', 422);
    return target;
  }

  /**
   * Streams one upload into quarantine, inspects it, and publishes it only if it is the image it
   * claims to be. A rejected file is deleted, not kept: there is no review queue for site media.
   */
  async store(request: IncomingMessage, declaredType: string, expectedSize: number) {
    if (!(SITE_MEDIA_TYPES as readonly string[]).includes(declaredType) || !Number.isSafeInteger(expectedSize) || expectedSize < 24 || expectedSize > SITE_MEDIA_MAX_BYTES) throw new IdentityError('invalid_input', 422);
    const imageKey = siteMediaKey(randomUUID());
    const source = this.path('quarantine', imageKey);
    await mkdir(dirname(source), { recursive: true });
    const file = await open(source, 'wx');
    let received = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += bytes.length;
        if (received > expectedSize) throw new IdentityError('invalid_input', 422);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await file.write(bytes, offset, bytes.length - offset);
          offset += result.bytesWritten;
        }
      }
      if (received !== expectedSize) throw new IdentityError('invalid_input', 422);
    } catch (error) {
      await file.close();
      await rm(source, { force: true });
      throw error;
    }
    await file.close();
    try {
      const bytes = await readFile(source);
      const image = detectImage(bytes);
      if (!image || image.contentType !== declaredType) throw new IdentityError('invalid_input', 422);
      const text = bytes.toString('latin1');
      if (text.includes(EICAR) || /<\/?(?:html|script|svg)\b/i.test(text)) throw new IdentityError('invalid_input', 422);
      if (image.width < 1 || image.height < 1 || image.width > 6000 || image.height > 6000 || image.width * image.height > 40_000_000) throw new IdentityError('invalid_input', 422);
      const destination = this.path('public', imageKey);
      await mkdir(dirname(destination), { recursive: true });
      await rename(source, destination);
      return { imageKey, contentType: image.contentType, checksum: createHash('sha256').update(bytes).digest('hex'), width: image.width, height: image.height };
    } catch (error) {
      await rm(source, { force: true });
      throw error;
    }
  }

  // A published key is never rewritten (every upload gets a fresh random key), so what the bytes
  // say about themselves can be remembered, and a conditional GET needs no disk read at all.
  private readonly described = new Map<string, { contentType: SiteMediaType; checksum: string; width: number; height: number }>();

  /** Type, checksum and size of a published image, re-derived from the bytes rather than trusted. */
  async describe(imageKey: string) {
    const known = this.described.get(imageKey);
    if (known) return known;
    const { contentType, checksum, width, height } = await this.read(imageKey);
    return { contentType, checksum, width, height };
  }

  async read(imageKey: string) {
    const bytes = await readFile(this.path('public', imageKey)).catch(() => { throw new IdentityError('not_found', 404); });
    const image = detectImage(bytes);
    if (!image) throw new IdentityError('not_found', 404);
    const details = { contentType: image.contentType, checksum: createHash('sha256').update(bytes).digest('hex'), width: image.width, height: image.height };
    if (this.described.size >= 2000) this.described.clear();
    this.described.set(imageKey, details);
    return { bytes, ...details };
  }
}
