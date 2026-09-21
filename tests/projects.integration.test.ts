import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ProjectsService } from '../apps/api/dist/modules/projects/projects.service.js';

const config = loadConfig(process.env);

test('projects enforce tenant scope, publication visibility and a fixed type on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const projects = new ProjectsService(db);
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const createdProjects: string[] = [];

  const createUser = async (suffix: string) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Proj ${suffix}`, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };
  /** Publishing is a reviewer's decision (PART-05); here it is applied directly to set up reads. */
  const publish = async (projectId: string) => {
    await db.project.update({ where: { id: projectId }, data: { state: 'published', publishedAt: new Date() } });
  };

  try {
    const ownerA = await createUser('owner-a');
    const ownerB = await createUser('owner-b');
    const viewer = await createUser('viewer');
    const outsider = await createUser('outsider');

    const orgA = await identity.createOrganization(ownerA.id, { legalName: `Legal Secret A ${prefix}`, displayName: `Org A ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    const orgB = await identity.createOrganization(ownerB.id, { legalName: `Legal Secret B ${prefix}`, displayName: `Org B ${prefix}`, type: 'NGO', country: 'PS', city: 'Jenin' });
    organizations.push(orgA.id, orgB.id);
    await db.membership.create({ data: { userId: viewer.id, organizationId: orgA.id, roles: ['Viewer'] } });
    // Only a verified organisation may submit a project for review.
    await db.organization.update({ where: { id: orgA.id }, data: { verification: 'verified' } });

    const nablus = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
    const jenin = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Jenin' } });

    const draftInput = {
      title: `Community training centre ${prefix.slice(0, 8)}`,
      summary: 'Fitting out two halls and a computer lab to run vocational training all year round.',
      story: 'The full project story.',
      cityId: nablus.id,
      managerId: ownerA.id,
      publicLocationPrecision: 'city' as const,
      latitude: null,
      longitude: null
    };

    // --- Permission scope ---------------------------------------------------------------------
    await assert.rejects(() => projects.create(viewer.id, orgA.id, { type: 'charity', ...draftInput }), /forbidden/, 'Viewer holds project.read but not project.create');
    await assert.rejects(() => projects.create(outsider.id, orgA.id, { type: 'charity', ...draftInput }), /forbidden/);
    await assert.rejects(() => projects.listForOrganization(outsider.id, orgA.id), /forbidden/);

    const project = await projects.create(ownerA.id, orgA.id, { type: 'charity', ...draftInput });
    createdProjects.push(project.id);
    assert.equal(project.state, 'draft');
    assert.equal(project.publishedAt, null, 'a new project is never born published');

    // --- A city-precision project may not carry a stored point ---------------------------------
    await assert.rejects(() => projects.create(ownerA.id, orgA.id, { type: 'charity', ...draftInput, latitude: 32.22, longitude: 35.25 }), /invalid_input/, 'city precision must not store coordinates');
    await assert.rejects(() => projects.create(ownerA.id, orgA.id, { type: 'charity', ...draftInput, publicLocationPrecision: 'approximate', latitude: null, longitude: null }), /invalid_input/, 'a pinned project needs a point');
    await assert.rejects(() => projects.create(ownerA.id, orgA.id, { type: 'charity', ...draftInput, publicLocationPrecision: 'exact', latitude: 999, longitude: 0 }), /invalid_input/);

    // --- The manager must be an active member --------------------------------------------------
    await assert.rejects(() => projects.create(ownerA.id, orgA.id, { type: 'charity', ...draftInput, managerId: outsider.id }), /invalid_input/);

    // --- A draft is invisible to the public ----------------------------------------------------
    await assert.rejects(() => projects.publicProject(project.slug), /not_found/, 'a draft must be absent, not forbidden');
    assert.equal((await projects.browse({})).items.some(item => item.slug === project.slug), false);

    // --- Tenant isolation on read ---------------------------------------------------------------
    await assert.rejects(() => projects.readForOrganization(ownerB.id, orgB.id, project.id), /not_found/, 'a project id from another tenant must not resolve');
    await assert.rejects(() => projects.readForOrganization(ownerB.id, orgA.id, project.id), /forbidden/);

    // --- Optimistic version ---------------------------------------------------------------------
    const fresh = await projects.readForOrganization(ownerA.id, orgA.id, project.id);
    await assert.rejects(() => projects.update(ownerA.id, orgA.id, project.id, { ...draftInput, version: fresh.version + 5 }), /conflict/);
    const updated = await projects.update(ownerA.id, orgA.id, project.id, { ...draftInput, title: `${draftInput.title} v2`, version: fresh.version });
    assert.equal(updated.version, fresh.version + 1);

    // --- Submission locks an immutable snapshot -------------------------------------------------
    await assert.rejects(() => projects.submit(ownerA.id, orgA.id, project.id, updated.version + 3), /conflict/);
    const submission = await projects.submit(ownerA.id, orgA.id, project.id, updated.version);
    assert.equal(submission.sequence, 1);
    // Under review the draft is frozen: the reviewer is reading the snapshot it submitted.
    const submitted = await projects.readForOrganization(ownerA.id, orgA.id, project.id);
    assert.equal(submitted.state, 'submitted');
    await assert.rejects(() => projects.update(ownerA.id, orgA.id, project.id, { ...draftInput, version: submitted.version }), /conflict/);
    // The snapshot is evidence of what the reviewer saw and is never rewritten.
    await assert.rejects(() => db.projectVersion.update({ where: { id: submission.id }, data: { sequence: 99 } }));
    await assert.rejects(() => db.projectVersion.deleteMany({ where: { id: submission.id } }));

    // --- An unverified organisation cannot submit ----------------------------------------------
    const unverified = await projects.create(ownerB.id, orgB.id, { type: 'charity', ...draftInput, cityId: jenin.id, managerId: ownerB.id });
    createdProjects.push(unverified.id);
    await assert.rejects(() => projects.submit(ownerB.id, orgB.id, unverified.id, unverified.version), /invalid_input/, 'an unverified organisation may not submit for review');

    // --- A short summary cannot reach review ----------------------------------------------------
    const thin = await projects.create(ownerA.id, orgA.id, { type: 'enablement', ...draftInput, summary: 'Too short.' });
    createdProjects.push(thin.id);
    await assert.rejects(() => projects.submit(ownerA.id, orgA.id, thin.id, thin.version), /invalid_input/);

    // --- Publication makes it public, with the legal name still withheld -------------------------
    await publish(project.id);
    const publicDetail = await projects.publicProject(project.slug);
    assert.equal(publicDetail.slug, project.slug);
    assert.equal(publicDetail.organization.displayName, orgA.displayName);
    const serialised = JSON.stringify(publicDetail);
    assert.equal(serialised.includes(orgA.legalName), false, 'the legal name must never reach a public projection');
    assert.equal(serialised.includes(ownerA.id), false, 'the manager identity must not be public');
    assert.equal(serialised.includes(project.id), false, 'the internal id must not be public');
    // A city-precision project publishes the city centre, never a stored point.
    assert.equal(publicDetail.location.precision, 'city');
    assert.equal(publicDetail.location.point?.latitude, Number(nablus.latitude.toFixed(4)));

    // --- The type is fixed once published --------------------------------------------------------
    await assert.rejects(() => db.project.update({ where: { id: project.id }, data: { type: 'venture' } }), /cannot change type/, 'SQL must refuse to re-type a published project');
    // A project can never be moved to another organisation either.
    await assert.rejects(() => db.project.update({ where: { id: project.id }, data: { organizationId: orgB.id } }), /cannot move between organizations/);

    // --- Filters ----------------------------------------------------------------------------------
    assert.equal((await projects.browse({ type: 'charity' })).items.some(item => item.slug === project.slug), true);
    assert.equal((await projects.browse({ type: 'venture' })).items.some(item => item.slug === project.slug), false);
    assert.equal((await projects.browse({ cityId: jenin.id })).items.some(item => item.slug === project.slug), false);
    assert.equal((await projects.browse({ organizationSlug: orgA.slug })).items.some(item => item.slug === project.slug), true);
    assert.equal((await projects.browse({ organizationSlug: orgB.slug })).items.some(item => item.slug === project.slug), false);
    assert.equal((await projects.browse({ verifiedOnly: true })).items.some(item => item.slug === project.slug), true);
    assert.equal((await projects.browse({ query: 'Community training' })).items.some(item => item.slug === project.slug), true);
    assert.equal((await projects.browse({ query: 'no-such-text-anywhere' })).items.length, 0);

    // --- Duplicating copies the description only ---------------------------------------------------
    const copy = await projects.duplicate(ownerA.id, orgA.id, project.id);
    createdProjects.push(copy.id);
    assert.equal(copy.state, 'draft', 'a copy is never born published');
    assert.equal(copy.publishedAt, null);
    assert.notEqual(copy.slug, project.slug, 'a copy gets its own public slug');

    // --- Preview shows the public shape without publishing -----------------------------------------
    const preview = await projects.publicPreview(ownerA.id, orgA.id, copy.id);
    assert.equal(preview.wouldBeVisible, false, 'a draft would not be visible');
    assert.equal(JSON.stringify(preview.preview).includes(orgA.legalName), false);
    await assert.rejects(() => projects.publicPreview(ownerB.id, orgB.id, copy.id), /not_found/);

    // --- Bookmarks are self-scoped ------------------------------------------------------------------
    // PART-10 gave a bookmark a second kind of target, so it now names which one it is about.
    const saved = await projects.addBookmark(outsider.id, { projectSlug: project.slug });
    assert.equal(saved.kind, 'project');
    assert.equal(saved.createsApplication, false, 'saving something is never applying to it');
    // Saving twice is the same outcome, not a duplicate row.
    assert.equal((await projects.addBookmark(outsider.id, { projectSlug: project.slug })).id, saved.id);
    const savedList = await projects.bookmarks(outsider.id);
    assert.equal(savedList.length, 1);
    assert.equal(savedList[0]!.kind, 'project', 'each row names its kind so a screen never guesses which field to read');
    await assert.rejects(() => projects.addBookmark(outsider.id, { projectSlug: copy.slug }), /not_found/, 'an invisible project cannot be saved');
    // Exactly one target: neither, or both, is a bookmark nobody could render.
    await assert.rejects(() => projects.addBookmark(outsider.id, {}), /invalid_input/);
    await assert.rejects(() => projects.addBookmark(outsider.id, { projectSlug: project.slug, programSlug: project.slug }), /invalid_input/);
    await assert.rejects(() => projects.removeBookmark(viewer.id, saved.id), /not_found/, 'another person’s bookmark is absent, not forbidden');
    assert.equal((await projects.removeBookmark(outsider.id, saved.id)).status, 'removed');

    // --- Impact declares what it cannot count --------------------------------------------------------
    const impact = await projects.impact();
    assert.equal(impact.counted.every(entry => typeof entry.definition === 'string' && entry.definition.length > 10), true, 'every counted figure needs its definition');
    assert.equal(impact.unavailable.some(entry => entry.key === 'verified_beneficiaries' && entry.reason === 'not_implemented'), true, 'an unbuilt figure is declared, not reported as zero');
    // PART-06 gave contributions a source, so they are counted rather than declared unavailable.
    assert.equal(impact.counted.some(entry => entry.key === 'contributions_confirmed'), true);
    assert.equal(impact.unavailable.some(entry => entry.key.includes('contribution') || entry.key.includes('funding')), false, 'a figure with a source must not still be listed as unavailable');
    // 05 forbids adding currencies together, so funding is reported per currency, never as one total.
    assert.equal(Array.isArray(impact.fundingByCurrency), true);
    assert.equal(impact.fundingByCurrency.every(entry => typeof entry.grossMinor === 'string' && typeof entry.netMinor === 'string'), true, 'money is a string of minor units');
  } finally {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE project_versions DISABLE TRIGGER USER');
      await tx.bookmark.deleteMany({ where: { projectId: { in: createdProjects } } });
      await tx.projectVersion.deleteMany({ where: { projectId: { in: createdProjects } } });
      await tx.$executeRawUnsafe('ALTER TABLE project_versions ENABLE TRIGGER USER');
      await tx.project.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
