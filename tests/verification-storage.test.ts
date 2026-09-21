import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { LocalDataRoomStorage, LocalVerificationStorage } from '../apps/api/src/modules/identity/verification-storage.ts';

test('verification storage enforces exact size, magic bytes and quarantine promotion', async () => {
  const storage = new LocalVerificationStorage();
  const caseId = randomUUID();
  const cleanId = randomUUID();
  const rejectedId = randomUUID();
  const cleanKey = `verification/${caseId}/${cleanId}.bin`;
  const rejectedKey = `verification/${caseId}/${rejectedId}.bin`;
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const request = (bytes: Buffer) => Readable.from([bytes]) as unknown as IncomingMessage;
  try {
    await storage.receive(cleanKey, request(pdf), pdf.length);
    const clean = await storage.inspectAndPromote(cleanKey, 'application/pdf');
    assert.equal(clean.clean, true);
    if (clean.clean) assert.match(clean.checksum, /^[0-9a-f]{64}$/);

    await storage.receive(rejectedKey, request(pdf), pdf.length);
    const rejected = await storage.inspectAndPromote(rejectedKey, 'image/png');
    assert.deepEqual(rejected, { clean: false, reason: 'magic_mismatch', actualSize: pdf.length });

    await assert.rejects(() => storage.receive(`verification/${caseId}/${randomUUID()}.bin`, request(pdf), pdf.length - 1));
  } finally {
    const root = resolve(process.cwd(), '.local', 'verification-files');
    await rm(resolve(root, 'quarantine', 'verification', caseId), { recursive: true, force: true });
    await rm(resolve(root, 'clean', 'verification', caseId), { recursive: true, force: true });
  }
});

test('data-room storage promotes clean files and serves the exact verified bytes', async () => {
  const storage = new LocalDataRoomStorage();
  const offeringId = randomUUID();
  const documentId = randomUUID();
  const key = `dataroom/${offeringId}/${documentId}.bin`;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('verified-image')]);
  const request = Readable.from([png]) as unknown as IncomingMessage;
  try {
    await storage.receive(key, request, png.length);
    const result = await storage.inspectAndPromote(key, 'image/png');
    assert.equal(result.clean, true);
    assert.deepEqual(await storage.read(key), png);
  } finally {
    const root = resolve(process.cwd(), '.local', 'dataroom-files');
    await rm(resolve(root, 'quarantine', 'dataroom', offeringId), { recursive: true, force: true });
    await rm(resolve(root, 'clean', 'dataroom', offeringId), { recursive: true, force: true });
  }
});
