import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ACTION_MANIFEST, documentedOperations, implementedActions, unavailableActions } from '@tamkeen/contracts';

const repoFile = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

test('action identifiers are unique and correctly shaped', () => {
  const ids = ACTION_MANIFEST.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate action IDs');
  for (const entry of ACTION_MANIFEST) {
    // `PAGE-ID.ANN` is the catalogue's format (20-UI-CONTRACT).
    assert.match(entry.id, /^[A-Z]{3,4}-\d{2}\.A\d{2}$/, `${entry.id} is not a valid action ID`);
    assert.equal(entry.id.startsWith(`${entry.page}.`), true, `${entry.id} does not belong to page ${entry.page}`);
  }
});

test('an implemented action names a test file that exists', () => {
  // 15-QUALITY-ACCEPTANCE: a planned test is not a passing test, and an untested claim is not a claim.
  const missing = implementedActions()
    .filter(entry => !entry.testRef || !existsSync(repoFile(entry.testRef)))
    .map(entry => `${entry.id} -> ${entry.testRef ?? 'no testRef'}`);
  assert.deepEqual(missing, [], 'implemented actions must cite an existing test file');
});

test('an unavailable action states a reason and the part that owns it', () => {
  // 00-MASTER-PROMPT: a control may be declared unavailable, but never silently absent or inert.
  for (const entry of unavailableActions()) {
    assert.equal(typeof entry.reason === 'string' && entry.reason.length > 30, true, `${entry.id} needs a substantive reason`);
    assert.match(entry.part, /^PART-\d{2}$/, `${entry.id} must name the part that will implement it`);
    assert.equal(entry.testRef, undefined, `${entry.id} is unavailable, so it must not claim test coverage`);
  }
});

test('every server-backed implemented action points at a documented endpoint', () => {
  const documented = new Set(documentedOperations().map(entry => entry.path));
  const orphans = implementedActions()
    .filter(entry => !['NAV', 'LOCAL'].includes(entry.method))
    .filter(entry => !documented.has(entry.endpoint))
    .map(entry => `${entry.id} -> ${entry.method} ${entry.endpoint}`);
  assert.deepEqual(orphans, [], 'an implemented action must call a route the OpenAPI document declares');
});

test('a navigation action points at a route the web app can render', () => {
  // Locale-free routes, matching the catch-all allowlist in apps/web.
  const knownRoutes = new Set([
    '/', '/login', '/register', '/recover', '/reset', '/verify', '/mfa/login', '/mfa/challenge',
    '/onboarding', '/app', '/app/security', '/app/settings', '/app/organizations/new',
    '/admin/verifications', '/admin/team', '/admin/bank-change-requests', '/policies/terms',
    '/design', '/explore', '/map', '/organizations', '/impact', '/about', '/contact', '/invest', '/opportunities', '/volunteer',
    '/admin/reviews/project', '/app/contributions', '/admin/finance',
    '/app/investor/eligibility', '/admin/investment-reviews', '/app/investments',
    '/app/career/profile', '/app/applications', '/app/applications/new', '/admin/program-reviews'
  ]);
  const templated = /\{[a-zA-Z]+\}/;
  const unreachable = implementedActions()
    .filter(entry => entry.method === 'NAV')
    .filter(entry => !templated.test(entry.endpoint) && !knownRoutes.has(entry.endpoint))
    .map(entry => `${entry.id} -> ${entry.endpoint}`);
  assert.deepEqual(unreachable, [], 'a NAV action must target a route that exists');
});

test('the gap list is explicit rather than empty by omission', () => {
  const gaps = unavailableActions();
  // If this ever reaches zero before PART-14, it means gaps stopped being recorded, not that they closed.
  assert.equal(gaps.length > 0, true, 'unimplemented screen actions must be declared, not dropped');
  for (const entry of gaps) assert.notEqual(entry.part, 'PART-02', 'a PART-02 action cannot still be unavailable after PART-02 closed its slice');
});

test('no action claims a permission the policy layer would not recognise', () => {
  const allowed = new Set([
    'public', 'self', 'token owner', 'profile.manage', 'organization.read', 'organization.manage',
    'bank.manage', 'member.read', 'member.invite', 'member.role.update', 'ownership.transfer',
    'verification.review', 'audit.read', 'PlatformAdmin',
    'project.read', 'project.create', 'project.update', 'project.submit', 'project.archive',
    'contribution.create', 'project.pause', 'project.close',
    'report.read', 'report.create', 'report.submit', 'report.publish', 'content.review',
    // PART-06. finance.read is deliberately not held by Owner or OrgAdmin: seeing the ledger is a
    // separate grant from running the organisation (05-CHARITY-LIFECYCLE, 08-FINANCIAL-SYSTEM).
    'finance.read', 'finance.export', 'contribution.identity.read', 'refund.request', 'payout.request',
    // PART-07. Executing, inquiring and reconciling are a platform FinanceOperator grant with MFA,
    // never an organisation role: the organisation asks and approves, the platform moves the money.
    'payout.approve', 'payout.execute', 'refund.approve', 'refund.execute',
    'payment.inquire', 'webhook.replay', 'reconciliation.manage',
    // PART-08. offering.review and eligibility.review are platform RiskReviewer grants with MFA:
    // an offering is judged by someone outside the company raising the money.
    'offering.manage', 'dataroom.manage', 'dataroom.read', 'investment.read',
    'offering.review', 'eligibility.review', 'allocation.finalize',
    // PART-09. `investment.export` is declared by 05-BUSINESS for the allocation register export,
    // which is not built; it is listed so the gap can name the permission it will need.
    'investment.export',
    // PART-10. `program.publish` is separate from `program.manage` so that approving and opening
    // applications stay two decisions. `candidate.export` names a gap, as `investment.export` does.
    'program.manage', 'program.read', 'program.publish', 'application.review',
    'attendance.record', 'attendance.correct', 'attendance.review',
    'assessment.record', 'candidate.export',
    // PART-11. Advertising a job and opening it to the public are two decisions, as they are for a
    // programme. Verifying a start and settling a disagreement about one are deliberately separate
    // too: the side that records the figure does not also get to certify it.
    'job.manage', 'job.publish', 'placement.verify', 'placement.review',
    // PART-12. `agreement.accept` is separate from `agreement.manage` because proposing terms and
    // binding the organisation to them are two acts; `stipend.request` is not `payout.execute`;
    // and `assistance.manage` opens nothing but assistance.
    'agreement.manage', 'agreement.accept', 'agreement.review', 'sponsorship.fund',
    'stipend.request', 'certificate.issue', 'certificate.revoke', 'proposal.review',
    'assistance.manage', 'volunteer.manage',
    // PART-13. Support cannot freeze a subject; risk can freeze and an independent reviewer clears it.
    'support.manage', 'risk.freeze', 'risk.unfreeze', 'audit.export',
    'ops.jobs.manage', 'ops.read', 'ops.manage', 'platform.release.manage', 'review.assign'
  ]);
  const unknown = ACTION_MANIFEST.filter(entry => !allowed.has(entry.permission)).map(entry => `${entry.id} -> ${entry.permission}`);
  assert.deepEqual(unknown, [], 'an action must assert a permission defined in 02-IDENTITY or 08-PERMISSION-EXTENSIONS');
});
