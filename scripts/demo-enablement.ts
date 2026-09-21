/**
 * Demo data for PART-12: an agreement, an incubation, an assistance case and a volunteering
 * opportunity.
 *
 * Like every demo script here it drives the real services, so nothing on screen is a row no code
 * path produced.
 *
 * What it deliberately leaves undone, because doing it would be the lie each rule exists to stop:
 *
 *  - it does not confirm an assistance delivery. That is the applicant's own act, and a demo that
 *    pre-confirmed it would show support "received" that nobody acknowledged;
 *  - it does not approve volunteer hours. Somebody other than the volunteer has to, on screen;
 *  - it does not pay a stipend or move any money at all.
 *
 *   pnpm demo:enablement
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { AgreementsService } from '../apps/api/dist/modules/enablement/agreements.service.js';
import { IncubationService } from '../apps/api/dist/modules/enablement/incubation.service.js';
import { AssistanceService } from '../apps/api/dist/modules/enablement/assistance.service.js';
import { VolunteeringService } from '../apps/api/dist/modules/enablement/volunteering.service.js';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:enablement refuses to run in ${config.environment}.`);
}

const SEED_TAG = 'seed-demo-2026';
const day = 86_400_000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const db = createDatabase(config.databaseUrl);
const identity = new IdentityService(db);
const agreements = new AgreementsService(db);
const incubation = new IncubationService(db);
const assistance = new AssistanceService(db);
const volunteering = new VolunteeringService(db);

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

const ensureRoles = async (userId: string, organizationId: string, roles: string[]) => {
  const existing = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
  if (!existing) {
    await db.membership.create({ data: { userId, organizationId, roles: roles as never, status: 'active' } });
    return;
  }
  const merged = [...new Set([...existing.roles, ...roles])];
  if (merged.length !== existing.roles.length) {
    await db.membership.update({ where: { userId_organizationId: { userId, organizationId } }, data: { roles: merged as never } });
  }
};

try {
  const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-nabta` } });
  if (!org) throw new Error('Run pnpm db:seed first.');
  if (org.verification !== 'verified') {
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
  }
  const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-nabta-owner@example.test` } });
  await ensureRoles(owner.id, org.id, ['ProgramManager', 'CaseWorker', 'VolunteerCoordinator']);

  // --- the sponsor, and the grant that is not equity ------------------------------------------------
  const sponsorLead = await ensureUser(`${SEED_TAG}-sponsor-owner@example.test`, 'صندوق تجريبي للتمكين (حساب تجريبي)');
  let sponsorOrg = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-sanad` } });
  if (!sponsorOrg) {
    const created = await identity.createOrganization(sponsorLead.id, {
      legalName: 'صندوق سند التجريبي', displayName: 'صندوق سند التجريبي', type: 'Company', country: 'PS', city: 'رام الله'
    });
    sponsorOrg = await db.organization.update({ where: { id: created.id }, data: { slug: `${SEED_TAG}-sanad`, verification: 'verified' } });
    console.log('A demo sponsor organisation was created.');
  }
  await ensureRoles(sponsorLead.id, sponsorOrg.id, ['FinanceMaker']);

  const program = await db.program.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });

  let agreement = await db.agreement.findFirst({ where: { sponsorOrgId: sponsorOrg.id, operatorOrgId: org.id } });
  if (!agreement) {
    const created = await agreements.create(sponsorLead.id, sponsorOrg.id, {
      operatorOrgId: org.id,
      title: 'منحة تشغيل دفعة الري الذكي',
      kind: 'cash',
      amountMinor: '5000000',
      currency: 'ILS',
      purpose: 'تمويل دفعة واحدة من تدريب الري الذكي، شاملًا بدلات المتدربين وتجهيزات الموقع. كل البيانات تجريبية بالكامل.',
      obligations: 'تشغّل الجهة الدفعة وتقدم تقريرًا ربعيًا بأرقام مجمّعة، وتعيد أي فائض خلال ستين يومًا من الإغلاق.',
      reportingTerms: 'أرقام مجمّعة فقط. لا يُذكر اسم متدرب ولا صاحب طلب مساعدة في أي تقرير للممول.',
      surplusTerms: 'يعاد الفائض غير المصروف إلى الممول خلال ستين يومًا من إغلاق الدفعة.',
      ...(program ? { programId: program.id } : {})
    });
    const sent = await agreements.send(sponsorLead.id, sponsorOrg.id, created.id, {
      terms: 'يموّل الممول دفعة واحدة من تدريب الري الذكي. تشغّلها الجهة وتقدم تقريرًا ربعيًا بأرقام مجمّعة، وتعيد أي فائض خلال ستين يومًا من الإغلاق. لا تنتقل أي حصة في أي من الجهتين في أي اتجاه، ولا يتحول أي مبلغ من هذه المنحة إلى رأس مال مسجل.',
      version: created.version
    });
    await agreements.accept(sponsorLead.id, sponsorOrg.id, created.id, { checksum: sent.termsChecksum, version: sent.version });
    const midway = await db.agreement.findUniqueOrThrow({ where: { id: created.id } });
    const activated = await agreements.accept(owner.id, org.id, created.id, { checksum: sent.termsChecksum, version: midway.version });
    agreement = await db.agreement.findUniqueOrThrow({ where: { id: created.id } });
    console.log(`An agreement was accepted by both parties: ${activated.state}. createsEquity: ${activated.createsEquity}`);

    const funded = await agreements.fund(sponsorLead.id, sponsorOrg.id, agreement.id, { amountMinor: '2000000', currency: 'ILS', note: 'الشريحة الأولى.' });
    console.log(`A funding intent was recorded. moneyMoved: ${funded.moneyMoved}, createsEquity: ${funded.createsEquity}`);

    const milestone = await agreements.addMilestone(sponsorLead.id, sponsorOrg.id, agreement.id, {
      title: 'استكمال التحاق الدفعة', dueAt: dayKey(new Date(Date.now() + 30 * day)), amountMinor: '1000000'
    });
    const evidenced = await agreements.submitMilestoneEvidence(owner.id, org.id, milestone.id, { evidenceRef: 'سجل الالتحاق', version: milestone.version });
    const decided = await agreements.decideMilestone(sponsorLead.id, sponsorOrg.id, milestone.id, {
      outcome: 'approved', reason: 'السجل مطابق للعدد المتفق عليه.', version: evidenced.version
    });
    console.log(`A deliverable was approved by the other party. releasedFunds: ${decided.releasedFunds}`);
  }

  // --- incubation, with no equity and no company created by anybody but the founder ------------------
  const founder = await ensureUser(`${SEED_TAG}-founder-dina@example.test`, 'دينا (حساب تجريبي)');
  const mentor = await ensureUser(`${SEED_TAG}-mentor-samir@example.test`, 'سمير (مرشد تجريبي)');
  await ensureRoles(mentor.id, org.id, ['Mentor']);

  let proposal = await db.proposal.findFirst({ where: { ownerId: founder.id } });
  if (!proposal) {
    const draft = await incubation.saveDraft(founder.id, {
      title: 'طقم حساسات تربة محلي',
      summary: 'طقم حساسات تربة منخفض الكلفة يُجمَّع محليًا ويُباع لصغار المزارعين مع خطة صيانة. كل البيانات تجريبية بالكامل.',
      problem: 'الحساسات المستوردة تكلف أكثر من موسم كامل ولا يمكن إصلاحها محليًا.',
      stage: 'نموذج أولي', sector: 'تقنيات زراعية', city: 'طولكرم',
      supportSought: 'مساحة عمل ومرشد ومنحة تجهيزات صغيرة.'
    });
    const submitted = await incubation.submit(founder.id, draft.id, { organizationId: org.id, sharingConsent: true, version: draft.version });
    const accepted = await incubation.decide(owner.id, org.id, submitted.id, {
      outcome: 'accepted', reason: 'مشكلة واضحة ونموذج يعمل وسلسلة توريد محلية.',
      criteria: 'قُيّمت وفق معايير الاحتضان المعلنة.', version: submitted.version
    });
    await incubation.assignMentor(owner.id, org.id, submitted.id, { mentorId: mentor.id, note: 'العتاد وسلسلة التوريد.' });
    const terms = await incubation.proposeAgreement(owner.id, org.id, submitted.id, {
      title: 'شروط الاحتضان',
      terms: 'ستة أشهر من الوصول إلى ورشة العمل، ومرشد مسند، ومنحة تُصرف مقابل مراحل معتمدة.',
      ipTerms: 'تملك صاحبة الفكرة كل ما تصنعه قبل البرنامج وخلاله وبعده. لا تحصل الحاضنة على ترخيص ولا على حصة.',
      grantMinor: '1500000', currency: 'ILS',
      grantConditions: 'تُصرف على دفعات مقابل مراحل معتمدة.',
      durationMonths: 6
    });
    await incubation.offerAgreement(owner.id, org.id, terms.id, terms.version);
    await incubation.addMilestone(owner.id, org.id, submitted.id, {
      title: 'نموذج أولي يعمل', dueAt: dayKey(new Date(Date.now() + 60 * day))
    });
    proposal = await db.proposal.findUniqueOrThrow({ where: { id: submitted.id } });
    console.log(`An idea was accepted and terms offered. equityTaken: ${accepted.equityTaken}, grantsEquity: ${terms.grantsEquity}`);
    console.log('The offer is left unanswered on purpose: accepting it is the founder\'s own act.');
  }

  // --- an assistance case, left awaiting the applicant's own confirmation -----------------------------
  const applicant = await ensureUser(`${SEED_TAG}-applicant-umm-ahmad@example.test`, 'أم أحمد (حساب تجريبي)');
  let supportCase = await db.assistanceCase.findFirst({ where: { applicantId: applicant.id } });
  if (!supportCase) {
    const created = await assistance.create(applicant.id, {
      organizationId: org.id, category: 'تدفئة الشتاء',
      needSummary: 'تعطلت مدفأة المنزل وفي الأسرة ثلاثة أطفال دون السادسة في غرفة بلا تدفئة. كل البيانات تجريبية بالكامل.',
      householdSize: 5, submit: true
    });
    const claimed = await assistance.claim(owner.id, org.id, created.id, created.version);
    const approved = await assistance.decide(owner.id, org.id, created.id, {
      outcome: 'approved', reason: 'مستوفٍ لمعايير تدفئة الشتاء للأسر التي فيها أطفال صغار.',
      criteria: 'الفئة الداخلية ب.', version: claimed.version
    });
    const afterDecision = await db.assistanceCase.findUniqueOrThrow({ where: { id: created.id } });
    const delivery = await assistance.recordDelivery(owner.id, org.id, created.id, {
      description: 'مدفأة بديلة ووقود لشهر.',
      fundingSource: 'حملة الشتاء التجريبية',
      deliveredAt: dayKey(new Date()),
      version: afterDecision.version
    });
    supportCase = await db.assistanceCase.findUniqueOrThrow({ where: { id: created.id } });
    console.log(`An assistance case was approved and a delivery recorded. countsAsDelivered: ${delivery.countsAsDelivered}`);
    console.log(`The decision is private. published: ${approved.published}, sharedWithSponsor: ${approved.sharedWithSponsor}`);
  }

  // --- a volunteering opportunity, with hours left for somebody else to approve ------------------------
  const volunteer = await ensureUser(`${SEED_TAG}-volunteer-kamal@example.test`, 'كمال (حساب تجريبي)');
  let opportunity = await db.volunteerOpportunity.findFirst({ where: { organizationId: org.id } });
  if (!opportunity) {
    const created = await volunteering.createOpportunity(owner.id, org.id, {
      title: 'مساندة ميدانية في المشتل',
      summary: 'مساعدة المتدربين على تركيب الحساسات في قطع العرض صباح أيام الأسبوع. كل البيانات تجريبية بالكامل.',
      tasks: 'حمل المعدات ووضعها، وتسجيل القراءات، والمساعدة في التجهيز والإنهاء.',
      requirements: 'لا خبرة سابقة مطلوبة.',
      supervisorId: owner.id,
      city: 'طولكرم', capacity: 2, hoursPerWeek: 6,
      withdrawalPolicy: 'للمتطوع أن يتوقف في أي وقت بإبلاغ المسؤول، ولا يترتب على ذلك شيء على أي من الطرفين.'
    });
    await volunteering.publishOpportunity(owner.id, org.id, created.id, created.version);
    opportunity = await db.volunteerOpportunity.findUniqueOrThrow({ where: { id: created.id } });
    console.log('A volunteering opportunity was published.');

    const application = await volunteering.apply(volunteer.id, { opportunityId: created.id, motivation: 'أسكن قريبًا وصباحاتي فارغة.' });
    const acceptedApplication = await volunteering.decideApplication(owner.id, org.id, application.id, { outcome: 'accepted', reason: '', version: application.version });
    const task = await volunteering.assign(owner.id, org.id, {
      opportunityId: created.id, userId: volunteer.id,
      task: 'حمل المعدات ووضعها في القطعة الشمالية.',
      startsAt: dayKey(new Date(Date.now() - 3 * day))
    });
    const acceptedTask = await volunteering.respondToAssignment(volunteer.id, task.id, { accept: true, version: task.version });
    const hours = await volunteering.logHours(volunteer.id, {
      assignmentId: acceptedTask.id, workedOn: dayKey(new Date(Date.now() - day)), minutes: 180, note: 'القطعة الشمالية.'
    });
    console.log(`Hours were logged and left unapproved. counted: ${hours.counted}, assignmentCreated on acceptance: ${acceptedApplication.assignmentCreated}`);
  }

  console.log('');
  console.log('Everything above is demonstration data, and no money moved anywhere.');
  console.log('Three things are deliberately left for a person to do on screen, because doing them here');
  console.log('would be the exact lie each rule exists to prevent:');
  console.log('  · the incubation offer is unanswered — accepting terms is the founder’s own act;');
  console.log('  · the assistance delivery is unconfirmed — only the person who received it can say so;');
  console.log('  · the volunteer hours are unapproved — nobody approves their own hours.');
} finally {
  await db.$disconnect();
}
