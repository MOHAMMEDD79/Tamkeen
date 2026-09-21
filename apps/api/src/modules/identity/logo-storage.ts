import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { IdentityError } from './policy.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

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

export class LocalLogoStorage {
  private readonly root = resolve(process.cwd(), '.local', 'organization-logos');

  private path(area: 'quarantine' | 'public', storageKey: string) {
    if (!/^logos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(storageKey)) throw new IdentityError('invalid_input', 422);
    const base = resolve(this.root, area);
    const target = resolve(base, ...storageKey.split('/'));
    if (!target.startsWith(`${base}${sep}`)) throw new IdentityError('invalid_input', 422);
    return target;
  }

  async receive(storageKey: string, request: IncomingMessage, expectedSize: number) {
    const target = this.path('quarantine', storageKey);
    await mkdir(dirname(target), { recursive: true });
    const file = await open(target, 'wx').catch(() => { throw new IdentityError('conflict', 409); });
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
      await rm(target, { force: true });
      throw error;
    }
    await file.close();
  }

  async inspectAndPublish(storageKey: string, declaredType: string) {
    const source = this.path('quarantine', storageKey);
    const bytes = await readFile(source).catch(() => { throw new IdentityError('upload_incomplete', 409); });
    const png = bytes.subarray(0, PNG.length).equals(PNG);
    const jpeg = bytes.subarray(0, JPEG.length).equals(JPEG);
    const detectedType = png ? 'image/png' : jpeg ? 'image/jpeg' : null;
    if (!detectedType || detectedType !== declaredType) return { clean: false as const, reason: 'magic_mismatch', actualSize: bytes.length };
    const text = bytes.toString('latin1');
    if (text.includes(EICAR) || /<\/?(?:html|script|svg)\b/i.test(text)) return { clean: false as const, reason: 'active_content', actualSize: bytes.length };
    const dimensions = png && bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : jpegDimensions(bytes);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 4096 || dimensions.height > 4096 || dimensions.width * dimensions.height > 16_000_000) return { clean: false as const, reason: 'invalid_dimensions', actualSize: bytes.length };
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const destination = this.path('public', storageKey);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return { clean: true as const, checksum, actualSize: bytes.length };
  }

  async readPublic(storageKey: string) {
    const target = this.path('public', storageKey);
    const [bytes, details] = await Promise.all([readFile(target), stat(target)]).catch(() => { throw new IdentityError('not_found', 404); });
    return { bytes, size: details.size };
  }
}
