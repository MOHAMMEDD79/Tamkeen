import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { OfferingsService } from '../apps/api/dist/modules/investment/offerings.service.js';
import { EligibilityService } from '../apps/api/dist/modules/investment/eligibility.service.js';
import { DataRoomService } from '../apps/api/dist/modules/investment/dataroom.service.js';

/**
 * PART-08 acceptance, all four criteria:
 *
 *  1. eligibility is never granted by choosing a capability;
 *  2. data rooms are isolated per offering;
 *  3. the version of a document an investor accepted survives the documents being replaced;
 *  4. the share arithmetic is correct — 06's worked example, end to end through the API.
 */

const config = loadConfig(process.env);
const ILS = 'ILS';

const answers = {
  investorType: 'individual' as const,
  hasPriorExperience: false,
  acknowledgesTotalLossRisk: true,
  declaration: 'Personal savings, aware that the whole amount may be lost.'
};

const disclosure = {
  summary: 'A smart agriculture venture raising to expand its production line across the north, with a staged plan.',
  risks: 'Demand may not materialise, the equipment may arrive late, and the whole investment may be lost.',
  useOfFunds: 'Production line equipment, installation, and the first six months of operating costs.'
};

test('offerings, eligibility and data room isolation on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const offerings = new OfferingsService(db);
  const eligibility = new EligibilityService(db);
  const dataRoom = new DataRoomService(db);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Invest ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  try {
    const founder = await createUser('founder');
    const reviewer = await createUser('reviewer', true);
    const investor = await createUser('investor');
    const otherInvestor = await createUser('other-investor');

    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'RiskReviewer', grantedBy: reviewer.id } });

    // Two separate companies, so data room isolation can be checked across a real boundary.
    const orgA = await identity.createOrganization(founder.id, { legalName: `Venture A ${prefix}`, displayName: `Venture A ${prefix}`, type: 'Company', country: 'PS', city: 'Tulkarm' });
    const orgB = await identity.createOrganization(founder.id, { legalName: `Venture B ${prefix}`, displayName: `Venture B ${prefix}`, type: 'Company', country: 'PS', city: 'Nablus' });
    organizations.push(orgA.id, orgB.id);
    await db.organization.updateMany({ where: { id: { in: [orgA.id, orgB.id] } }, data: { verification: 'verified' } });
    for (const org of [orgA, orgB]) {
      await db.membership.update({ where: { userId_organizationId: { userId: founder.id, organizationId: org.id } }, data: { roles: ['Owner', 'InvestmentManager'] } });
    }

    // --- ACCEPTANCE 1: eligibility is not granted by a capability -----------------------------------
    // The investor picks the Investor capability on their own profile, which anyone can do.
    const profile = await db.individualProfile.findUniqueOrThrow({ where: { userId: investor.id } });
    await db.individualProfile.update({ where: { userId: investor.id }, data: { capabilities: ['Investor'], version: profile.version + 1 } });

    const mine = await eligibility.mine(investor.id);
    assert.equal(mine.capabilityChosen, true, 'they did choose the capability');
    assert.equal(mine.eligible, false, 'and it grants them nothing');
    assert.equal((await eligibility.isEligible(investor.id)).eligible, false);
    assert.equal((await eligibility.isEligible(investor.id)).reason, 'not_started');

    // Submitting is still only a claim.
    await eligibility.submit(investor.id, answers);
    assert.equal((await eligibility.isEligible(investor.id)).eligible, false, 'submitting is not being approved');

    // A submission without the risk acknowledgement is incomplete (06).
    await assert.rejects(
      () => eligibility.submit(otherInvestor.id, { ...answers, acknowledgesTotalLossRisk: false }),
      /invalid_input/, 'the total-loss acknowledgement is not optional'
    );

    const queue = await eligibility.queue(reviewer.id);
    const application = queue.find(item => item.applicant === `Invest investor`)!;
    assert.ok(application, 'the application reaches the reviewer queue');
    // Nobody but a RiskReviewer with MFA sees it.
    await assert.rejects(() => eligibility.queue(founder.id), /forbidden/);
    await assert.rejects(() => eligibility.queue(investor.id), /forbidden/);

    // An approval must carry an expiry; the database refuses one without.
    const decided = await eligibility.decide(reviewer.id, application.id, { outcome: 'approved', reason: '', validityDays: 30, version: application.version });
    assert.equal(decided.state, 'approved');
    assert.ok(decided.expiresAt);
    assert.equal((await eligibility.isEligible(investor.id)).eligible, true, 'only a reviewed decision makes someone eligible');

    // And it stops applying the moment it runs out (06), without anyone editing anything.
    await db.investorEligibility.update({ where: { userId: investor.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await eligibility.isEligible(investor.id);
    assert.equal(expired.eligible, false);
    assert.equal(expired.reason, 'expired', 'an expired approval is expired, not approved');
    await db.investorEligibility.update({ where: { userId: investor.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });

    // --- ACCEPTANCE 4: the share maths, through the API ----------------------------------------------
    // 06's worked example: 1,000,000 shares in issue, 100,000 offered at 10.00.
    await offerings.saveVenture(founder.id, orgA.id, {
      legalName: `Venture A Ltd ${prefix}`, currentShares: '1000000', currency: ILS,
      summary: 'A smart agriculture company expanding its production line, used to verify the share arithmetic.'
    });
    const offeringInput = {
      title: `Series A ${prefix.slice(0, 8)}`, currency: ILS,
      sharesOffered: '100000', pricePerShareMinor: '1000',
      minimumRaiseMinor: '50000000', minimumTicketMinor: '10000',
      useOfFunds: 'Production line equipment and the first six months of operating costs.',
      closesAt: new Date(Date.now() + 90 * 86_400_000).toISOString()
    };
    const offeringA = await offerings.create(founder.id, orgA.id, offeringInput);
    assert.equal(offeringA.state, 'draft');
    assert.equal(offeringA.postRaiseShares, '1100000');
    // The whole offering is 9.09% of the company, not 100% of it.
    assert.equal(offeringA.offeringPercentOfPostRaise, '9.090909');

    // An offering from a company with no venture, or an unverified one, cannot exist.
    await assert.rejects(() => offerings.create(founder.id, orgB.id, offeringInput), /conflict/, 'no venture, no offering');

    // pro_rata needs a remainder rule and a tie-break that are not specified, so it is refused.
    await assert.rejects(
      () => offerings.create(founder.id, orgA.id, { ...offeringInput, oversubscriptionPolicy: 'pro_rata' }),
      /invalid_input/, 'a policy whose closing rules do not exist cannot be selected'
    );

    // --- Disclosure, review and opening --------------------------------------------------------------
    let check = await offerings.validate(founder.id, orgA.id, offeringA.id);
    assert.equal(check.ready, false);
    assert.equal(check.blockers.includes('disclosure_missing'), true, 'an offering with no disclosure is not ready');

    const published = await offerings.addDisclosure(founder.id, orgA.id, offeringA.id, { ...disclosure, version: offeringA.version });
    assert.equal(published.disclosure.sequence, 1);
    const firstChecksum = published.disclosure.checksum;

    // A disclosure is evidence of what was offered; the database refuses to let it be edited.
    await assert.rejects(
      () => db.offeringDisclosure.update({ where: { id: published.disclosure.id }, data: { risks: 'rewritten' } }),
      /append-only|23514/, 'a disclosure cannot be edited; a revision is a new version'
    );

    check = await offerings.validate(founder.id, orgA.id, offeringA.id);
    assert.equal(check.ready, true, 'with a disclosure and a deadline it is ready for review');

    let current = await offerings.getForOrganization(founder.id, orgA.id, offeringA.id);
    await offerings.submit(founder.id, orgA.id, offeringA.id, current.version);
    // Editing is refused while a reviewer holds it.
    await assert.rejects(() => offerings.update(founder.id, orgA.id, offeringA.id, { ...offeringInput, version: current.version + 1 }), /conflict/);

    await offerings.claim(reviewer.id, offeringA.id);
    // A second reviewer cannot claim the same submission.
    await assert.rejects(() => offerings.claim(reviewer.id, offeringA.id), /conflict/);

    current = await offerings.getForOrganization(founder.id, orgA.id, offeringA.id);
    // A member of the issuing organisation is not independent, whatever grant they hold.
    await db.platformGrant.create({ data: { userId: founder.id, role: 'RiskReviewer', grantedBy: reviewer.id } });
    await db.user.update({ where: { id: founder.id }, data: { twoFactorEnabled: true } });
    await assert.rejects(
      () => offerings.decide(founder.id, offeringA.id, { outcome: 'approved', publicReason: '', version: current.version }),
      /forbidden/, 'nobody reviews their own company'
    );

    await offerings.decide(reviewer.id, offeringA.id, { outcome: 'approved', publicReason: '', version: current.version });
    current = await offerings.getForOrganization(founder.id, orgA.id, offeringA.id);
    assert.equal(current.state, 'approved');
    // Approving is not publishing: it is still absent from the public index.
    assert.equal((await offerings.browse({})).items.some(item => item.slug === offeringA.slug), false);

    const opened = await offerings.open(founder.id, orgA.id, offeringA.id, current.version);
    assert.equal(opened.state, 'open');

    // The public quote: 10,000.00 buys 1,000 shares, which is 0.0909% of the company.
    const quote = await offerings.quote(offeringA.slug, '1000000');
    assert.equal(quote.units, '1000');
    assert.equal(quote.percentOfPostRaise, '0.090909');
    assert.equal(quote.percentOfOffering, '1', 'the number it must never be confused with');
    assert.equal(quote.indicative, true, '06: the percentage is indicative until final allocation');

    // 15.50 against a 10.00 share buys one share and hands back the remainder.
    const partial = await offerings.quote(offeringA.slug, '1550');
    assert.equal(partial.units, '1');
    assert.equal(partial.remainderMinor, '550');
    assert.equal(partial.belowMinimumTicket, true, 'and it is below the minimum ticket, which is stated');

    // --- Interest reserves nothing (06) ---------------------------------------------------------------
    const interest = await offerings.registerInterest(investor.id, offeringA.slug, { indicativeAmountMinor: '1000000' });
    assert.equal(interest.reservesCapacity, false);
    assert.equal(interest.isFunding, false);
    const publicView = await offerings.publicOffering(offeringA.slug);
    // PART-09 built the subscribe path, so an open offering now says it will take a commitment.
    // The flag is a fact about this offering, not about the build, and the reason is empty only
    // when the server would actually accept one.
    assert.equal(publicView.acceptsCommitments, true);
    assert.equal(publicView.commitmentsUnavailableReason, '');

    // --- ACCEPTANCE 2: data rooms are isolated ---------------------------------------------------------
    // A second offering, in a different company, to grant against.
    await offerings.saveVenture(founder.id, orgB.id, {
      legalName: `Venture B Ltd ${prefix}`, currentShares: '500000', currency: ILS,
      summary: 'A second company, used only to prove that a data room grant does not travel between offerings.'
    });
    const offeringB = await offerings.create(founder.id, orgB.id, { ...offeringInput, title: `Series B ${prefix.slice(0, 8)}` });
    await offerings.addDisclosure(founder.id, orgB.id, offeringB.id, { ...disclosure, version: offeringB.version });

    await dataRoom.addDocument(founder.id, orgA.id, offeringA.id, {
      title: 'Cap table', category: 'current_ownership', classification: 'granted',
      checksum: 'a'.repeat(64), byteSize: 2048, contentType: 'application/pdf'
    });
    await dataRoom.addDocument(founder.id, orgA.id, offeringA.id, {
      title: 'Company profile', category: 'company_profile', classification: 'public',
      checksum: 'b'.repeat(64), byteSize: 1024, contentType: 'application/pdf'
    });
    await dataRoom.addDocument(founder.id, orgB.id, offeringB.id, {
      title: 'Cap table', category: 'current_ownership', classification: 'granted',
      checksum: 'c'.repeat(64), byteSize: 4096, contentType: 'application/pdf'
    });

    // Before any grant: the public document only, and the rest counted rather than listed.
    let roomA = await dataRoom.read(investor.id, offeringA.id);
    assert.equal(roomA.documents.length, 1);
    assert.equal(roomA.documents[0]!.classification, 'public');
    assert.equal(roomA.withheld, 1, 'what is withheld is stated, not silently absent');
    assert.equal(roomA.access.hasLiveGrant, false);

    // Grant into A only.
    const grant = await dataRoom.grant(founder.id, orgA.id, offeringA.id, { userId: investor.id, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    roomA = await dataRoom.read(investor.id, offeringA.id);
    assert.equal(roomA.documents.length, 2, 'the grant opens the restricted document');
    assert.equal(roomA.withheld, 0);

    // **The isolation check**: the same person, the same company's founder, a different offering.
    const roomB = await dataRoom.read(investor.id, offeringB.id);
    assert.equal(roomB.access.hasLiveGrant, false, 'a grant on one offering is not a grant on another');
    assert.equal(roomB.documents.length, 0, 'and nothing restricted leaks across');
    assert.equal(roomB.withheld, 1);

    // A different investor sees nothing restricted in A either.
    const roomAOther = await dataRoom.read(otherInvestor.id, offeringA.id);
    assert.equal(roomAOther.access.hasLiveGrant, false);
    assert.equal(roomAOther.documents.length, 1);

    // Revoking closes the room again, and records why without erasing that the grant existed.
    await assert.rejects(() => dataRoom.revoke(founder.id, grant.id, 'short'), /invalid_input/, 'a revocation states its reason');
    await dataRoom.revoke(founder.id, grant.id, 'The engagement ended and access is no longer needed.');
    roomA = await dataRoom.read(investor.id, offeringA.id);
    assert.equal(roomA.access.hasLiveGrant, false, 'revocation takes effect immediately');
    assert.equal(roomA.documents.length, 1);
    const grantRecord = await db.dataRoomGrant.findUniqueOrThrow({ where: { id: grant.id } });
    assert.ok(grantRecord.revokedAt, 'the grant is still on the record, marked revoked');
    assert.match(grantRecord.revokeReason, /engagement ended/);

    // An expired grant is as closed as a revoked one.
    const shortGrant = await dataRoom.grant(founder.id, orgA.id, offeringA.id, { userId: otherInvestor.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    // Both dates move together: a CHECK constraint refuses a grant that expires before it starts,
    // so there is no way to fabricate one that never had a valid window.
    await db.dataRoomGrant.update({
      where: { id: shortGrant.id },
      data: { createdAt: new Date(Date.now() - 172_800_000), expiresAt: new Date(Date.now() - 1000) }
    });
    assert.equal((await dataRoom.read(otherInvestor.id, offeringA.id)).access.hasLiveGrant, false, 'an expired grant grants nothing');

    // --- ACCEPTANCE 3: the accepted version survives the documents being replaced ----------------------
    const offeringRecord = await db.offering.findUniqueOrThrow({ where: { id: offeringA.id } });
    const acceptance = await dataRoom.acceptNda(investor.id, offeringA.id, {
      disclosureId: offeringRecord.currentDisclosureId!, checksum: firstChecksum
    });
    assert.equal(acceptance.checksum, firstChecksum);

    // Accepting a version that is not the one on screen is refused.
    await assert.rejects(
      () => dataRoom.acceptNda(otherInvestor.id, offeringA.id, { disclosureId: offeringRecord.currentDisclosureId!, checksum: 'f'.repeat(64) }),
      /conflict/, 'the checksum must match the text that was shown'
    );

    // The company publishes a material revision. 06: that suspends the offering.
    current = await offerings.getForOrganization(founder.id, orgA.id, offeringA.id);
    const revised = await offerings.addDisclosure(founder.id, orgA.id, offeringA.id, {
      summary: `${disclosure.summary} The equipment supplier has changed since the first version was published.`,
      risks: `${disclosure.risks} The new supplier has no delivery history with this company.`,
      useOfFunds: disclosure.useOfFunds,
      material: true, reason: 'The equipment supplier changed, which alters the delivery risk.',
      version: current.version
    });
    assert.equal(revised.disclosure.sequence, 2);
    assert.notEqual(revised.disclosure.checksum, firstChecksum);
    assert.equal(revised.offering.state, 'suspended', 'a material revision halts the offering (06)');

    // **The preservation check**: the old acceptance is untouched and still names the old text.
    const kept = await dataRoom.myAcceptances(investor.id, offeringA.id);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.checksum, firstChecksum, 'the accepted version survives the revision');
    assert.equal(kept[0]!.sequence, 1, 'and still points at the version that was actually agreed');

    // The person is told a newer version now needs acknowledging, rather than being treated as
    // having agreed to text they never saw.
    const afterRevision = await dataRoom.accessFor(investor.id, offeringA.id);
    assert.equal(afterRevision.hasCurrentNda, false, 'the old acceptance does not cover the new version');
    assert.equal(afterRevision.ndaOutOfDate, true, 'and that is reported rather than left ambiguous');

    // Nothing can rewrite an acceptance, not even directly.
    await assert.rejects(
      () => db.ndaAcceptance.update({ where: { id: acceptance.id }, data: { checksum: 'd'.repeat(64) } }),
      /append-only|23514/, 'consent is append-only'
    );

    // Accepting the new version adds a record; it does not replace the old one.
    const revisedRecord = await db.offering.findUniqueOrThrow({ where: { id: offeringA.id } });
    await dataRoom.acceptNda(investor.id, offeringA.id, { disclosureId: revisedRecord.currentDisclosureId!, checksum: revised.disclosure.checksum });
    const both = await dataRoom.myAcceptances(investor.id, offeringA.id);
    assert.equal(both.length, 2, 'both agreements are on the record');
    assert.deepEqual(both.map(row => row.sequence).sort(), [1, 2]);

    // --- Questions are private to their asker -----------------------------------------------------------
    await dataRoom.grant(founder.id, orgA.id, offeringA.id, { userId: investor.id, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    const question = await dataRoom.ask(investor.id, offeringA.id, 'How is the new supplier being assessed before any order is placed?');
    // Without access there is nothing to ask about privately.
    await assert.rejects(() => dataRoom.ask(otherInvestor.id, offeringA.id, 'What is the current cap table?'), /forbidden/);

    await dataRoom.reply(founder.id, question.id, 'A site visit is scheduled and the order is conditional on it.');
    const asIssuer = await dataRoom.questions(founder.id, offeringA.id);
    assert.equal(asIssuer.length, 1);
    assert.equal(asIssuer[0]!.replies.length, 1);
    // Another investor sees none of it: 06 forbids a reply revealing other investors.
    assert.equal((await dataRoom.questions(otherInvestor.id, offeringA.id)).length, 0);

    // --- Nothing private leaks into the public projection ------------------------------------------------
    const publicAgain = await offerings.publicOffering(offeringA.slug);
    const serialised = JSON.stringify(publicAgain);
    assert.equal(serialised.includes('Cap table'), false, 'a restricted document is not named publicly');
    assert.equal(serialised.includes(investor.id), false, 'no investor identity is in a public payload');
    assert.equal(publicAgain.publicDocuments.length, 1);
  } finally {
    await db.$transaction(async tx => {
      const offeringIds = (await tx.offering.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      const eligibilityIds = (await tx.investorEligibility.findMany({ where: { userId: { in: users } }, select: { id: true } })).map(row => row.id);
      for (const table of ['offering_disclosures', 'offering_review_decisions', 'eligibility_decisions', 'nda_acceptances', 'investor_eligibility_submissions', 'data_room_downloads', 'identity_audit_events']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.investorQuestionReply.deleteMany({ where: { question: { offeringId: { in: offeringIds } } } });
      await tx.investorQuestion.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.dataRoomDownload.deleteMany({ where: { document: { offeringId: { in: offeringIds } } } });
      await tx.ndaAcceptance.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.dataRoomGrant.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.dataRoomAccessRequest.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.dataRoomDocument.updateMany({ where: { offeringId: { in: offeringIds } }, data: { supersededById: null } });
      await tx.dataRoomDocument.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offeringInterest.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offeringReviewDecision.deleteMany({ where: { offeringId: { in: offeringIds } } });
      // The state has to come back to draft first: a CHECK constraint refuses to leave a live
      // offering without the disclosure it is published against, which is the point of it.
      await tx.offering.updateMany({ where: { id: { in: offeringIds } }, data: { state: 'draft', currentDisclosureId: null } });
      await tx.offeringDisclosure.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offering.deleteMany({ where: { id: { in: offeringIds } } });
      await tx.venture.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.eligibilityDecision.deleteMany({ where: { eligibilityId: { in: eligibilityIds } } });
      await tx.investorEligibilitySubmission.deleteMany({ where: { eligibilityId: { in: eligibilityIds } } });
      await tx.investorEligibility.deleteMany({ where: { id: { in: eligibilityIds } } });
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      for (const table of ['identity_audit_events', 'data_room_downloads', 'investor_eligibility_submissions', 'nda_acceptances', 'eligibility_decisions', 'offering_review_decisions', 'offering_disclosures']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { OR: [{ userId: { in: users } }, { grantedBy: { in: users } }] } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
