import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPubliclyVisible, publicLocation, publicOrganizationSummary, publicProjectCard, publicProjectDetail, publicFunding, PUBLICLY_VISIBLE_STATES } from '../apps/api/src/modules/projects/projections.js';

/**
 * The public projection is the boundary between an organisation's record and what a visitor sees.
 * 09-DATA-MODEL requires allowlisted DTOs, 12-SECURITY forbids publishing a beneficiary's location,
 * and 04-INFORMATION-ARCHITECTURE keeps exact coordinates out of the public index. These are pure
 * functions precisely so those rules can be asserted without a database.
 */

const city = { nameAr: 'نابلس', nameEn: 'Nablus', country: 'PS', latitude: 32.2211, longitude: 35.2544 };

const organization = {
  slug: 'ufuq-demo',
  displayName: 'جمعية الأفق التجريبية',
  legalName: 'Ufuq Charitable Society for Development — Registered 1998',
  type: 'NGO',
  city: 'Nablus',
  country: 'PS',
  verification: 'verified',
  currentLogoId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  contactAddress: '12 Internal Street, Nablus',
  bankAccountLast4: '6702'
};

const project = {
  slug: 'training-centre-ab12cd34',
  title: 'تجهيز مركز تدريب مجتمعي',
  summary: 'تجهيز قاعتين ومختبر حاسوب لتشغيل برامج تدريب مهني على مدار السنة.',
  story: 'قصة المشروع الكاملة.',
  type: 'charity',
  state: 'published' as const,
  publishedAt: new Date('2026-09-01T10:00:00.000Z'),
  latitude: 32.224466,
  longitude: 35.258899,
  publicLocationPrecision: 'city' as const,
  city,
  organization,
  // Fields that exist on the record and must never reach the projection.
  managerId: '11111111-2222-3333-4444-555555555555',
  createdBy: '99999999-8888-7777-6666-555555555555',
  id: 'deadbeef-0000-1111-2222-333333333333',
  version: 7
};

test('only published-and-later states are publicly visible; a draft is absent rather than hidden', () => {
  for (const state of ['published', 'funding_closed', 'executing', 'impact_review', 'completed', 'paused'] as const) {
    assert.equal(isPubliclyVisible(state), true, `${state} should be visible`);
  }
  // A draft, a submission under review, a rejection and an archived project are all not public.
  for (const state of ['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'cancelled', 'archived'] as const) {
    assert.equal(isPubliclyVisible(state), false, `${state} must not be publicly visible`);
  }
  // `approved` is deliberately not public: approval permits publication, it is not publication.
  assert.equal(PUBLICLY_VISIBLE_STATES.includes('approved'), false);
});

test('a city-precision project publishes the city centre and never its stored point', () => {
  const location = publicLocation({ precision: 'city', latitude: 32.224466, longitude: 35.258899, city });
  assert.equal(location.precision, 'city');
  assert.deepEqual(location.point, { latitude: 32.2211, longitude: 35.2544 }, 'a city-level project is pinned at the city centre');
  // The stored coordinates must not survive into the projection at any precision.
  assert.notEqual(location.point?.latitude, 32.224466);
  assert.notEqual(location.point?.longitude, 35.258899);
});

test('an approximate project is rounded to about a kilometre, not to a building', () => {
  const location = publicLocation({ precision: 'approximate', latitude: 32.224466, longitude: 35.258899, city });
  assert.equal(location.precision, 'approximate');
  assert.deepEqual(location.point, { latitude: 32.22, longitude: 35.26 });
  // Two decimal places is ~1.1km of latitude: enough for a neighbourhood, not for an address.
  const latitudeError = Math.abs((location.point?.latitude ?? 0) - 32.224466);
  assert.equal(latitudeError > 0.001, true, 'the published point must differ from the stored one');
  assert.equal(latitudeError < 0.01, true, 'but must still be the right neighbourhood');
});

test('an exact point is published only when the project explicitly declared that precision', () => {
  const location = publicLocation({ precision: 'exact', latitude: 32.224466, longitude: 35.258899, city });
  assert.deepEqual(location.point, { latitude: 32.224466, longitude: 35.258899 });
  // Missing coordinates fall back to the city rather than producing a null island at 0,0.
  const missing = publicLocation({ precision: 'exact', latitude: null, longitude: null, city });
  assert.equal(missing.precision, 'city');
  assert.deepEqual(missing.point, { latitude: 32.2211, longitude: 35.2544 });
});

test('the public organisation summary omits the legal name and every internal field', () => {
  const summary = publicOrganizationSummary(organization);
  const serialised = JSON.stringify(summary);
  assert.equal(serialised.includes(organization.legalName), false, 'the legal name must never be public');
  assert.equal(serialised.includes('Internal Street'), false, 'the contact address is not part of this projection');
  assert.equal(serialised.includes('6702'), false, 'no banking detail may reach a public projection');
  assert.deepEqual(Object.keys(summary).sort(), ['city', 'country', 'displayName', 'logoUrl', 'slug', 'type', 'verified']);
});

test('verified is true only for a current verification', () => {
  for (const verification of ['not_started', 'submitted', 'in_review', 'changes_requested', 'rejected', 'expired']) {
    assert.equal(publicOrganizationSummary({ ...organization, verification }).verified, false, `${verification} must not read as verified`);
  }
  // PUB-04.A02 names the expiry case specifically: an expired badge is not a verified organisation.
  assert.equal(publicOrganizationSummary({ ...organization, verification: 'expired' }).verified, false);
  assert.equal(publicOrganizationSummary(organization).verified, true);
});

test('the project card carries no internal identifier, no manager and no financial figure', () => {
  const card = publicProjectCard(project);
  const serialised = JSON.stringify(card);
  assert.deepEqual(Object.keys(card).sort(), ['location', 'organization', 'publishedAt', 'slug', 'state', 'summary', 'title', 'type']);
  assert.equal(serialised.includes(project.id), false, 'the internal project id must not be public');
  assert.equal(serialised.includes(project.managerId), false, 'the responsible manager is not public');
  assert.equal(serialised.includes(project.createdBy), false, 'the creator is not public');
  assert.equal(serialised.includes(project.organization.legalName), false);
  // No money is published from this projection; funding arrives with its own reviewed shape.
  for (const financial of ['amount', 'minor', 'raised', 'goal', 'balance']) {
    assert.equal(serialised.toLowerCase().includes(financial), false, `"${financial}" must not appear in a project card`);
  }
});

const campaign = { goalMinor: 100000n, currency: 'ILS', policy: 'flexible', endsAt: new Date(Date.now() + 86_400_000) };

test('a project with no campaign says so, rather than reporting a fabricated zero', () => {
  const funding = publicFunding({ campaign: null, state: 'published', confirmed: [] });
  const detail = publicProjectDetail(project, funding);
  assert.equal(detail.story, project.story);
  // 15-QUALITY: a visitor must be able to tell "there is no campaign" from "this raised nothing".
  assert.equal(detail.funding.available, false);
  assert.equal(detail.funding.available === false && detail.funding.reason, 'no_campaign');
  assert.equal(Object.hasOwn(detail.funding, 'raisedMinor'), false, 'an absent figure is absent, not zero');
});

test('public funding is derived from confirmed contributions, net of refunds, in integer minor units', () => {
  const funding = publicFunding({
    campaign, state: 'published',
    confirmed: [{ amountMinor: 30000n, refundedMinor: 0n }, { amountMinor: 25000n, refundedMinor: 5000n }]
  });
  assert.equal(funding.available, true);
  if (!funding.available) return;
  // 30000 + 25000 - 5000 = 50000. A refund reduces the published figure, it does not sit beside it.
  assert.equal(funding.raisedMinor, '50000');
  assert.equal(funding.remainingMinor, '50000');
  assert.equal(funding.percentOfGoal, 50);
  assert.equal(funding.contributionCount, 2);
  assert.equal(funding.acceptsContributions, true);
  assert.equal(funding.simulated, true, 'the build must never present a simulated figure as a real one');
  // Every amount crosses the wire as a string: a JSON number is a double and cannot hold money.
  for (const key of ['goalMinor', 'raisedMinor', 'remainingMinor'] as const) {
    assert.equal(typeof funding[key], 'string', `${key} must be a string of minor units`);
  }
});

test('a goal already met stops accepting money and never renders past full', () => {
  const funding = publicFunding({ campaign, state: 'published', confirmed: [{ amountMinor: 150000n, refundedMinor: 0n }] });
  assert.equal(funding.available && funding.remainingMinor, '0', 'remaining is clamped at zero, never negative');
  assert.equal(funding.available && funding.percentOfGoal, 100, 'an over-goal campaign cannot render past 100%');
  assert.equal(funding.available && funding.acceptsContributions, false);
});

test('a closed campaign and a paused project accept nothing, whatever the bar says', () => {
  const ended = publicFunding({ campaign: { ...campaign, endsAt: new Date(Date.now() - 1000) }, state: 'published', confirmed: [] });
  assert.equal(ended.available && ended.acceptsContributions, false, 'a campaign past its end date is closed');
  const paused = publicFunding({ campaign, state: 'paused', confirmed: [] });
  assert.equal(paused.available && paused.acceptsContributions, false, 'a paused project keeps its figures but takes no money');
  // The figures stay readable while closed: closing a campaign does not erase what it raised.
  assert.equal(ended.available && ended.raisedMinor, '0');
});

test('a logo url is produced only when a logo exists, and the slug is encoded', () => {
  assert.equal(publicOrganizationSummary({ ...organization, currentLogoId: null }).logoUrl, null);
  assert.equal(publicOrganizationSummary(organization).logoUrl, '/api/v1/organizations/ufuq-demo/logo');
  const encoded = publicOrganizationSummary({ ...organization, slug: 'جمعية-الأفق' }).logoUrl;
  assert.equal(encoded?.includes(' '), false);
  assert.equal(encoded?.startsWith('/api/v1/organizations/'), true);
});
