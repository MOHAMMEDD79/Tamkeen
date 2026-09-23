/**
 * One cover photo per listing, so no two cards on the site carry the same picture.
 *
 * Without this the web app falls back to a small set of stock photos — two for charity projects,
 * two for jobs, three for offerings — so eight projects share two images and most of the Jerusalem
 * jobs land on the same one, because the topic-photo patterns were written for a different set of
 * titles. That reads as a template, which is the one thing a populated site should not look like.
 *
 * The art is generated (scripts/cover-art.mjs), not photographed: an invented project has no
 * business carrying a real picture of a real place. Each cover's hue is stepped by the golden
 * angle from its position in the list, so neighbouring cards are never close in colour, and the
 * shapes come from the listing's own slug, so a given listing always gets the same cover.
 *
 * The bytes go in through SiteMediaStorage, the same path an admin upload takes: written to
 * quarantine, identified by their magic number, checked, and only then published.
 *
 * Run after the data scripts. Idempotent: a listing that already has a cover is left alone.
 *
 *   pnpm demo:covers
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { makeCover } from './cover-art.mjs';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:covers refuses to run in ${config.environment}.`);
}

const db = createDatabase(config.databaseUrl);
// Captured before the chdir below, because the credits file stores repo-relative paths.
const ROOT = process.cwd();
const PHOTOS = resolve(ROOT, 'scripts/assets/photos/credits.json');

// The API serves site media from its own .local folder, so publish where it reads.
process.chdir(resolve('apps', 'api'));
const { SiteMediaStorage } = await import('../apps/api/dist/modules/site-content/site-media-storage.js');
const { SiteContentService } = await import('../apps/api/dist/modules/site-content/site-content.service.js');
const storage = new SiteMediaStorage();
const site = new SiteContentService(db);

/**
 * A photograph where scripts/fetch-photos.mjs found one, and generated art only as a fallback.
 * Either way the bytes go through the real upload path: quarantine, magic-number check, publish.
 */
const photos: Record<string, { file: string }> = existsSync(PHOTOS)
  ? JSON.parse(await readFile(PHOTOS, 'utf8'))
  : {};

async function publish(key: string, index: number, tone: 'charity' | 'work' | 'invest') {
  const photo = photos[key];
  const photoPath = photo ? resolve(ROOT, photo.file) : '';
  if (photoPath && existsSync(photoPath)) {
    const bytes = await readFile(photoPath);
    const stored = await storage.store(Readable.from([bytes]) as unknown as IncomingMessage, 'image/jpeg', bytes.length);
    return { image: { imageKey: stored.imageKey, contentType: stored.contentType, checksum: stored.checksum }, kind: 'photo' as const };
  }
  const bytes = makeCover({ key, index, tone });
  const stored = await storage.store(Readable.from([bytes]) as unknown as IncomingMessage, 'image/png', bytes.length);
  return { image: { imageKey: stored.imageKey, contentType: stored.contentType, checksum: stored.checksum }, kind: 'art' as const };
}

const counts = { projects: 0, offerings: 0, programs: 0, jobs: 0, skipped: 0, photos: 0, art: 0 };

try {
  const admin = await db.platformGrant.findFirst({ where: { role: 'PlatformAdmin', revokedAt: null }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No platform admin. Run pnpm demo:accounts first.');

  // A single running index across every kind, so a project and a job never share a hue either.
  let index = 0;

  const projects = await db.project.findMany({
    where: { adminVisibility: 'visible' },
    select: { id: true, slug: true, type: true, cover: { select: { imageKey: true } } },
    orderBy: { createdAt: 'asc' }
  });
  for (const project of projects) {
    index += 1;
    if (project.cover && !process.argv.includes('--replace')) { counts.skipped += 1; continue; }
    const tone = project.type === 'venture' ? 'invest' : project.type === 'enablement' ? 'work' : 'charity';
    const result = await publish(project.slug, index, tone);
    await site.setProjectCover(admin.userId, project.id, result.image);
    counts.projects += 1; counts[result.kind === 'photo' ? 'photos' : 'art'] += 1;
  }

  const offerings = await db.offering.findMany({ select: { id: true, slug: true }, orderBy: { createdAt: 'asc' } });
  const programs = await db.program.findMany({ select: { id: true, slug: true }, orderBy: { createdAt: 'asc' } });
  const jobs = await db.job.findMany({ select: { id: true, slug: true }, orderBy: { createdAt: 'asc' } });
  const existing = new Set((await db.listingCover.findMany({ select: { kind: true, subjectId: true } })).map(row => `${row.kind}:${row.subjectId}`));

  for (const [kind, rows, tone] of [
    ['offering', offerings, 'invest'],
    ['program', programs, 'work'],
    ['job', jobs, 'work']
  ] as const) {
    for (const row of rows) {
      index += 1;
      if (existing.has(`${kind}:${row.id}`) && !process.argv.includes('--replace')) { counts.skipped += 1; continue; }
      const result = await publish(row.slug, index, tone);
      await site.setListingCover(admin.userId, kind, row.id, result.image);
      counts[kind === 'offering' ? 'offerings' : kind === 'program' ? 'programs' : 'jobs'] += 1;
      counts[result.kind === 'photo' ? 'photos' : 'art'] += 1;
    }
  }

  console.log('');
  console.log(`Project covers:   ${counts.projects}`);
  console.log(`Offering covers:  ${counts.offerings}`);
  console.log(`Programme covers: ${counts.programs}`);
  console.log(`Job covers:       ${counts.jobs}`);
  console.log(`Already had one:  ${counts.skipped}`);
  console.log('');
  console.log(`Photographs: ${counts.photos}, generated art: ${counts.art}.`);
  console.log('Photo credits are in scripts/assets/photos/CREDITS.md; most require attribution.');
} finally {
  await db.$disconnect();
}
