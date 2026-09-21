/**
 * A demo job, offer and placement for PART-11.
 *
 * Like every demo script here it drives the real services, so nothing on screen is a row no code
 * path produced: the job is published by the employer, the offer is accepted by the candidate, and
 * the placement that results stays at `start_pending` until both sides confirm a date.
 *
 * What it deliberately does **not** do:
 *
 *  - it does not confirm a start. JOB-01 is that accepting an offer is not beginning work, and a
 *    demo that quietly marked somebody as employed would be the exact lie this part exists to
 *    prevent. The confirmation is left for a person to do on the screen;
 *  - it does not answer a follow-up. A checkpoint that nobody has answered is `unknown`, and that
 *    is what the screens should show.
 *
 * It refuses to run outside demo/test/development, and it is idempotent: a second run adds nothing.
 *
 *   pnpm demo:employment
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { ApplicationsService } from '../apps/api/dist/modules/programs/applications.service.js';
import { JobsService } from '../apps/api/dist/modules/employment/jobs.service.js';
import { OffersService } from '../apps/api/dist/modules/employment/offers.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:employment refuses to run in ${config.environment}.`);
}

const SEED_TAG = 'seed-demo-2026';
const day = 86_400_000;
const db = createDatabase(config.databaseUrl);
const applications = new ApplicationsService(db);
const jobs = new JobsService(db);
const offers = new OffersService(db);

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

try {
  const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-nabta` } });
  if (!org) throw new Error('Run pnpm db:seed first.');
  if (org.verification !== 'verified') {
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
  }

  const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-nabta-owner@example.test` } });
  const membership = await db.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } } });
  if (!membership.roles.includes('Recruiter')) {
    await db.membership.update({
      where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
      data: { roles: [...new Set([...membership.roles, 'Recruiter'])] }
    });
  }

  // The programme this job came out of, where PART-10's demo left one. The link is shown on the
  // public page and immediately qualified: that programme promised this job to nobody.
  const program = await db.program.findFirst({ where: { organizationId: org.id, state: { in: ['recruiting', 'selection', 'active', 'completed', 'follow_up'] } }, orderBy: { createdAt: 'asc' } });

  // --- The job, created once -----------------------------------------------------------------------
  let job = await db.job.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  if (!job) {
    const created = await jobs.create(owner.id, org.id, {
      title: 'فني ري ميداني',
      summary: 'تركيب وصيانة أنظمة الري وحساسات التربة في ثلاثة مواقع قرب طولكرم، مع تسجيل قراءات أسبوعية. كل البيانات تجريبية بالكامل ولا تصف وظيفة حقيقية.',
      responsibilities: 'تركيب الحساسات، متابعة القراءات أسبوعيًا، وصيانة وحدات الضخ.',
      requirements: 'قراءة سجل الحساسات، ومسك سجل صيانة منظم، ورخصة قيادة.',
      skills: ['الري', 'حساسات التربة'],
      contractType: 'fixed_term',
      contractMonths: 12,
      deliveryMode: 'in_person',
      city: 'طولكرم',
      hoursPerWeek: 40,
      // 07: the pay is stated. The alternative — stating why it is not — is what the other demo
      // listing below shows, because a blank is the one thing neither of them may be.
      salaryDisclosed: true,
      salaryMinMinor: '380000',
      salaryMaxMinor: '450000',
      salaryCurrency: 'ILS',
      salaryPeriod: 'شهريًا',
      closesAt: new Date(Date.now() + 21 * day).toISOString(),
      openings: 1,
      ...(program ? { programId: program.id } : {})
    });
    await jobs.publish(owner.id, org.id, created.id, created.version);
    job = await db.job.findUniqueOrThrow({ where: { id: created.id } });
    console.log(`Demo job published: ${created.title}`);
  }

  // A second listing that does not publish its pay, so the screens show the explained silence next
  // to the stated figure rather than only the flattering case.
  const quiet = await db.job.findFirst({ where: { organizationId: org.id, salaryDisclosed: false } });
  if (!quiet) {
    const created = await jobs.create(owner.id, org.id, {
      title: 'منسق تدريب ميداني',
      summary: 'تنسيق جلسات التدريب الميداني بين المشتل والمزارع الشريكة، ومتابعة حضور المتدربين. كل البيانات تجريبية بالكامل.',
      requirements: 'خبرة في التنسيق الميداني، والقدرة على التنقل بين المواقع.',
      skills: ['التنسيق'],
      contractType: 'part_time',
      deliveryMode: 'hybrid',
      city: 'طولكرم',
      hoursPerWeek: 20,
      salaryDisclosed: false,
      salaryUndisclosedReason: 'النطاق محكوم بعقد المانح ولم يُعتمد بعد؛ يُعلن قبل إرسال أي عرض.',
      closesAt: new Date(Date.now() + 30 * day).toISOString(),
      openings: 2
    });
    await jobs.publish(owner.id, org.id, created.id, created.version);
    console.log('A second listing, with its pay not disclosed and the reason stated.');
  }

  // --- A candidate, applying with an explicit consent ------------------------------------------------
  const candidate = await ensureUser(`${SEED_TAG}-jobseeker-rami@example.test`, 'رامي (حساب تجريبي)');
  if (!await db.candidateProfile.findUnique({ where: { userId: candidate.id } })) {
    await applications.saveProfile(candidate.id, {
      headline: 'فني صيانة', summary: 'سنتان في صيانة معدات الري في الشمال.',
      city: 'طولكرم', availability: 'فورًا', education: 'دبلوم تقني',
      experience: 'صيانة ميدانية لمدة سنتين.', skills: ['الري', 'حساسات التربة'],
      shareWithOperators: true, shareContact: false
    });
  }

  let application = await db.jobApplication.findUnique({ where: { jobId_userId: { jobId: job.id, userId: candidate.id } } });
  if (!application) {
    const draft = await jobs.saveDraft(candidate.id, { jobId: job.id, coverNote: 'صنت الحساسات نفسها موسمين، وأعرف مواقع المشتل.' });
    await jobs.submit(candidate.id, draft.id, { sharingConsent: true, version: draft.version });
    application = await db.jobApplication.findUniqueOrThrow({ where: { id: draft.id } });
    console.log('A demo application submitted, with the profile shared by explicit consent.');
  }

  if (application.state === 'submitted') {
    await jobs.decide(owner.id, org.id, application.id, { outcome: 'shortlisted', reason: '', version: application.version });
    application = await db.jobApplication.findUniqueOrThrow({ where: { id: application.id } });
    console.log('Shortlisted. Nothing here is a hire: the reply states a hired count of zero.');
  }

  // --- An offer, sent and accepted ---------------------------------------------------------------------
  let offer = await db.jobOffer.findFirst({ where: { jobApplicationId: application.id }, orderBy: { sequence: 'desc' } });
  if (!offer) {
    const created = await offers.createOffer(owner.id, org.id, {
      jobApplicationId: application.id,
      title: 'فني ري ميداني',
      terms: 'دوام كامل لمدة اثني عشر شهرًا، ثلاثة أشهر تجربة، مواصلات بين المواقع على الجهة، ومعدات السلامة مؤمّنة.',
      contractType: 'fixed_term',
      contractMonths: 12,
      salaryMinor: '400000',
      salaryCurrency: 'ILS',
      salaryPeriod: 'شهريًا',
      proposedStartDate: new Date(Date.now() + 7 * day).toISOString().slice(0, 10),
      respondByAt: new Date(Date.now() + 5 * day).toISOString()
    });
    await offers.sendOffer(owner.id, org.id, created.id, created.version);
    offer = await db.jobOffer.findUniqueOrThrow({ where: { id: created.id } });
    console.log('An offer was sent. From here its text is frozen by a database trigger.');
  }

  if (offer.state === 'sent') {
    const asCandidate = await offers.offerForCandidate(candidate.id, offer.id);
    const accepted = await offers.acceptOffer(candidate.id, offer.id, { termsChecksum: asCandidate.termsChecksum, version: asCandidate.version });
    console.log(`The candidate accepted. Placement state: ${accepted.placement.state}.`);
    console.log('employmentStarted:', accepted.employmentStarted, '— countedAsEmployment:', accepted.countedAsEmployment);
  }

  // A second candidate left mid-queue, so the employer's screens have something still to decide.
  const waiting = await ensureUser(`${SEED_TAG}-jobseeker-lina@example.test`, 'لينا (حساب تجريبي)');
  if (!await db.candidateProfile.findUnique({ where: { userId: waiting.id } })) {
    await applications.saveProfile(waiting.id, {
      headline: 'منسقة ميدانية', summary: 'ثلاث سنوات في تنسيق برامج تدريب زراعية.',
      city: 'طولكرم', availability: 'خلال شهر', skills: ['التنسيق'],
      shareWithOperators: true, shareContact: false
    });
  }
  const other = await db.job.findFirstOrThrow({ where: { organizationId: org.id, salaryDisclosed: false } });
  if (!await db.jobApplication.findUnique({ where: { jobId_userId: { jobId: other.id, userId: waiting.id } } })) {
    const draft = await jobs.saveDraft(waiting.id, { jobId: other.id, coverNote: 'نسّقت برامج مشابهة مع ثلاث مزارع شريكة.' });
    await jobs.submit(waiting.id, draft.id, { sharingConsent: true, version: draft.version });
    console.log('A second application left waiting on a human decision.');
  }

  const placement = await db.placement.findFirst({ where: { jobId: job.id } });
  console.log('');
  console.log('Everything above is demonstration data.');
  if (placement) {
    console.log(`The placement is at "${placement.state}" with no actual start date, and that is deliberate:`);
    console.log('accepting an offer is not starting work (JOB-01). Confirm the start from both sides on');
    console.log('the screens to see it become "started" — one side alone will not do it.');
  }
  console.log('No follow-up has been answered, so every checkpoint reads "unknown" rather than success.');
} finally {
  await db.$disconnect();
}
