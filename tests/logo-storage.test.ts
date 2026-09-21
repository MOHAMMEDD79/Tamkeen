import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { LocalLogoStorage } from '../apps/api/src/modules/identity/logo-storage.ts';

test('public logo storage validates raster type and dimensions before publishing', async () => {
  const storage = new LocalLogoStorage();
  const organizationId = randomUUID();
  const validKey = `logos/${organizationId}/${randomUUID()}.bin`;
  const mismatchKey = `logos/${organizationId}/${randomUUID()}.bin`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const request = (bytes: Buffer) => Readable.from([bytes]) as unknown as IncomingMessage;
  try {
    await storage.receive(validKey, request(png), png.length);
    const published = await storage.inspectAndPublish(validKey, 'image/png');
    assert.equal(published.clean, true);
    const publicFile = await storage.readPublic(validKey);
    assert.deepEqual(publicFile.bytes, png);

    await storage.receive(mismatchKey, request(png), png.length);
    assert.deepEqual(await storage.inspectAndPublish(mismatchKey, 'image/jpeg'), { clean: false, reason: 'magic_mismatch', actualSize: png.length });
  } finally {
    const root = resolve(process.cwd(), '.local', 'organization-logos');
    await rm(resolve(root, 'quarantine', 'logos', organizationId), { recursive: true, force: true });
    await rm(resolve(root, 'public', 'logos', organizationId), { recursive: true, force: true });
  }
});
