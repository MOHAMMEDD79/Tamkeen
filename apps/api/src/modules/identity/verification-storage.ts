import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { IdentityError } from './policy.js';

const PDF = Buffer.from('%PDF-');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function samePrefix(buffer: Buffer, prefix: Buffer) { return buffer.subarray(0, prefix.length).equals(prefix); }

export class LocalVerificationStorage {
  private readonly root = resolve(process.cwd(), '.local', 'verification-files');

  private path(area: 'quarantine' | 'clean', storageKey: string) {
    if (!/^verification\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(storageKey)) throw new IdentityError('invalid_input', 422);
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
    return { received };
  }

  async inspectAndPromote(storageKey: string, declaredType: string) {
    const source = this.path('quarantine', storageKey);
    const bytes = await readFile(source).catch(() => { throw new IdentityError('upload_incomplete', 409); });
    const detectedType = samePrefix(bytes, PDF) ? 'application/pdf' : samePrefix(bytes, PNG) ? 'image/png' : samePrefix(bytes, JPEG) ? 'image/jpeg' : null;
    if (!detectedType || detectedType !== declaredType) return { clean: false as const, reason: 'magic_mismatch', actualSize: bytes.length };
    const text = bytes.toString('latin1');
    if (text.includes(EICAR)) return { clean: false as const, reason: 'malware_signature', actualSize: bytes.length };
    if (detectedType === 'application/pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/i.test(text)) return { clean: false as const, reason: 'active_pdf_content', actualSize: bytes.length };
    if (/^\s*(?:<!doctype\s+html|<html|<script)/i.test(text)) return { clean: false as const, reason: 'active_content', actualSize: bytes.length };
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const destination = this.path('clean', storageKey);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return { clean: true as const, checksum, actualSize: bytes.length };
  }
}

/** The same quarantine/promote pipeline for investment data-room files. */
export class LocalDataRoomStorage {
  private readonly root = resolve(process.cwd(), '.local', 'dataroom-files');

  private path(area: 'quarantine' | 'clean', storageKey: string) {
    if (!/^dataroom\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(storageKey)) throw new IdentityError('invalid_input', 422);
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
        await file.write(bytes);
      }
      if (received !== expectedSize) throw new IdentityError('invalid_input', 422);
    } catch (error) {
      await file.close();
      await rm(target, { force: true });
      throw error;
    }
    await file.close();
    return { received };
  }

  async inspectAndPromote(storageKey: string, declaredType: string) {
    const source = this.path('quarantine', storageKey);
    const bytes = await readFile(source).catch(() => { throw new IdentityError('upload_incomplete', 409); });
    const detectedType = samePrefix(bytes, PDF) ? 'application/pdf' : samePrefix(bytes, PNG) ? 'image/png' : samePrefix(bytes, JPEG) ? 'image/jpeg' : null;
    if (!detectedType || detectedType !== declaredType) return { clean: false as const, reason: 'magic_mismatch', actualSize: bytes.length };
    const body = bytes.toString('latin1');
    if (body.includes(EICAR)) return { clean: false as const, reason: 'malware_signature', actualSize: bytes.length };
    if (detectedType === 'application/pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/i.test(body)) return { clean: false as const, reason: 'active_pdf_content', actualSize: bytes.length };
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const destination = this.path('clean', storageKey);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return { clean: true as const, checksum, actualSize: bytes.length };
  }

  async read(storageKey: string) {
    return readFile(this.path('clean', storageKey)).catch(() => { throw new IdentityError('not_found', 404); });
  }
}
