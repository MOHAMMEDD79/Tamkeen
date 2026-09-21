/**
 * A demo training programme for PART-10.
 *
 * Like every demo script here it drives the real services, so nothing on screen is a row that no
 * code path produced: the programme goes through its own independent review, the operator opens
 * applications itself, and the seats are held by real enrolments under the real capacity rule.
 *
 * It refuses to run outside demo/test/development, and it is idempotent: a second run adds nothing.
 *
 *   pnpm demo:program
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { ProgramsService } from '../apps/api/dist/modules/programs/programs.service.js';
import { ApplicationsService } from '../apps/api/dist/modules/programs/applications.service.js';
import { TrainingService } from '../apps/api/dist/modules/programs/training.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:program refuses to run in ${config.environment}.`);
}

const SEED_TAG = 'seed-demo-2026';
const day = 86_400_000;
const db = createDatabase(config.databaseUrl);
const programs = new ProgramsService(db);
const applications = new ApplicationsService(db);
const training = new TrainingService(db);

/** Obviously demo candidates. Two of them, for a cohort with two seats and a waitlist behind it. */
const candidates = [
  { email: `${SEED_TAG}-trainee-huda@example.test`, name: 'هدى (حساب تجريبي)', motivation: 'أزرع مع عائلتي وأريد تعلم الري الحديث لأطبقه على أرضنا.' },
  { email: `${SEED_TAG}-trainee-bilal@example.test`, name: 'بلال (حساب تجريبي)', motivation: 'عملت في البيوت البلاستيكية وأريد التدريب النظامي على أنظمة الري.' },
  { email: `${SEED_TAG}-trainee-sara@example.test`, name: 'سارة (حساب تجريبي)', motivation: 'أبدأ حيازة صغيرة وأحتاج وحدة الري تحديدًا.' }
];

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

const ensureReviewer = async (email: string, name: string) => {
  const user = await ensureUser(email, name);
  if (!user.twoFactorEnabled) await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  const held = await db.platformGrant.findFirst({ where: { userId: user.id, role: 'ContentReviewer', revokedAt: null } });
  if (!held) await db.platformGrant.create({ data: { userId: user.id, role: 'ContentReviewer', grantedBy: user.id } });
  return user;
};

try {
  const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-nabta` } });
  if (!org) throw new Error('Run pnpm db:seed first.');
  if (org.verification !== 'verified') {
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
  }

  const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-nabta-owner@example.test` } });
  const membership = await db.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } } });
  if (!membership.roles.includes('ProgramManager')) {
    await db.membership.update({
      where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
      data: { roles: [...new Set([...membership.roles, 'ProgramManager'])] }
    });
  }

  const reviewer = await ensureReviewer(`${SEED_TAG}-content-reviewer@example.test`, 'مراجع محتوى (حساب تجريبي)');
  const trainer = await ensureUser(`${SEED_TAG}-trainer-yousef@example.test`, 'يوسف (مدرب تجريبي)');
  const trainerMembership = await db.membership.findUnique({ where: { userId_organizationId: { userId: trainer.id, organizationId: org.id } } });
  if (!trainerMembership) {
    await db.membership.create({ data: { userId: trainer.id, organizationId: org.id, roles: ['Trainer'], status: 'active' } });
  }

  // --- The programme, created once ------------------------------------------------------------------
  let program = await db.program.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  if (!program) {
    const created = await programs.create(owner.id, org.id, {
      title: 'تدريب الري الذكي',
      summary: 'تدريب عملي على أنظمة الري الحديثة وحساسات التربة، بجلسات ميدانية في مشتل الجهة. كل البيانات تجريبية بالكامل ولا تصف برنامجًا حقيقيًا.',
      skills: ['الري', 'حساسات التربة'],
      level: 'مبتدئ',
      city: 'طولكرم',
      capacity: 2,
      applyClosesAt: new Date(Date.now() + 10 * day).toISOString(),
      durationWeeks: 8,
      hoursPerWeek: 12,
      schedule: 'ثلاث جلسات أسبوعيًا، صباحًا، في موقع المشتل.',
      attendancePolicy: 'الحضور دون 80% من الجلسات ينهي أهلية الإكمال. الغياب بعذر يحتاج سببًا مكتوبًا يُسجَّل مع الغياب.',
      assessmentPolicy: 'تقييم عملي بمعايير معلنة في نهاية كل وحدة، وحد الاجتياز يُعلن قبل بدء الوحدة.',
      selectionMethod: 'تُقيَّم الطلبات بمعايير معلنة، ويُفصل التعادل بترتيب وصول الطلبات.',
      withdrawalPolicy: 'للمتدرب أن يطلب الانسحاب في أي وقت، وتقيّمه الجهة وفق هذه السياسة خلال خمسة أيام عمل.',
      accessibilityNote: 'الموقع متاح لمستخدمي الكراسي المتحركة، ويمكن ترتيب مواصلات بطلب مسبق.',
      privacyNote: 'لا تُشارك بيانات المتدربين مع أي جهة أخرى دون موافقة منفصلة.',
      complaintsContact: 'complaints@nabta.example.test',
      // 07: the claim is qualified, and it says which kind of claim it is.
      jobCommitmentKind: 'expected',
      jobCount: 3,
      jobCommitmentTerms: 'ثلاث وظائف مستهدفة لدى مزارع شريكة، غير ملزمة، ومعاييرها تُعلن عند فتح التوظيف.'
    });
    await programs.addCohort(owner.id, org.id, created.id, {
      name: 'الدفعة الأولى',
      capacity: 2,
      startAt: new Date(Date.now() + 20 * day).toISOString(),
      endAt: new Date(Date.now() + 76 * day).toISOString(),
      acceptanceWindowHours: 72
    });
    program = await db.program.findUniqueOrThrow({ where: { id: created.id } });
    console.log(`Demo programme created at draft: ${created.title}`);
  }

  // --- Review and opening, each by the person who is supposed to do it --------------------------------
  if (['draft', 'changes_requested'].includes(program.state)) {
    const current = await programs.getForOrganization(owner.id, org.id, program.id);
    if (current.readiness.ready) {
      await programs.submit(owner.id, org.id, program.id, current.version);
      console.log('Submitted to an independent content reviewer.');
    } else {
      console.log(`Not ready to submit: ${current.readiness.blockers.join(', ')}`);
    }
  }
  program = await db.program.findUniqueOrThrow({ where: { id: program.id } });
  if (program.state === 'review') {
    await programs.claim(reviewer.id, program.id);
    const current = await programs.getForOrganization(owner.id, org.id, program.id);
    await programs.decide(reviewer.id, program.id, { outcome: 'approved', publicReason: '', version: current.version });
    console.log('Approved by an independent reviewer. Approving is not publishing.');
  }
  program = await db.program.findUniqueOrThrow({ where: { id: program.id } });
  if (program.state === 'approved') {
    const current = await programs.getForOrganization(owner.id, org.id, program.id);
    await programs.publish(owner.id, org.id, program.id, current.version);
    console.log('The operator opened applications. The programme is now public.');
  }

  const cohort = await db.cohort.findFirstOrThrow({ where: { programId: program.id }, orderBy: { startAt: 'asc' } });

  // --- Three candidates for two seats, so the waitlist is a real queue ---------------------------------
  let applied = 0;
  for (const candidate of candidates) {
    const user = await ensureUser(candidate.email, candidate.name);
    const profile = await db.candidateProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      await applications.saveProfile(user.id, {
        headline: 'خريج زراعة', summary: 'أبحث عن تدريب عملي على الري الحديث.',
        city: 'طولكرم', skills: ['الري'], shareWithOperators: true, shareContact: false
      });
    }
    const existing = await db.application.findUnique({ where: { cohortId_userId: { cohortId: cohort.id, userId: user.id } } });
    if (existing) continue;
    const draft = await applications.saveDraft(user.id, { cohortId: cohort.id, motivation: candidate.motivation });
    await applications.submit(user.id, draft.id, { sharingConsent: true, version: draft.version });
    applied += 1;
  }
  if (applied > 0) console.log(`${applied} demo application(s) submitted.`);

  // --- Decisions, left where a person would make them ---------------------------------------------------
  //
  // The first two are accepted and the third waitlisted, so the screens show a full cohort with a
  // real queue behind it. The invitations are deliberately left unaccepted: accepting a seat is the
  // candidate's own action, and doing it here would show a confirmed seat nobody agreed to.
  const pending = await db.application.findMany({ where: { cohortId: cohort.id, state: { in: ['submitted', 'screening'] } }, orderBy: { submittedAt: 'asc' } });
  const capacity = await applications.cohortCapacity(owner.id, org.id, cohort.id);
  let seats = capacity.seatsRemaining;
  for (const application of pending) {
    if (seats > 0) {
      await applications.decide(owner.id, org.id, application.id, { outcome: 'accepted', reason: '', version: application.version });
      seats -= 1;
    } else {
      await applications.decide(owner.id, org.id, application.id, {
        outcome: 'waitlisted',
        reason: 'الدفعة ممتلئة حاليًا، وأنت في الدور الأول إن تحرر مقعد.',
        version: application.version
      });
    }
  }
  if (pending.length > 0) console.log(`${pending.length} decision(s) taken; invitations left for the candidates to accept themselves.`);

  // --- A trainer and a session, so the register exists to be taken ---------------------------------------
  const assigned = await db.cohortTrainer.findUnique({ where: { cohortId_userId: { cohortId: cohort.id, userId: trainer.id } } });
  if (!assigned) {
    await training.assignTrainer(owner.id, cohort.id, trainer.id);
    console.log('A trainer was assigned to this cohort — and only to this cohort.');
  }
  const sessions = await db.trainingSession.count({ where: { cohortId: cohort.id } });
  if (sessions === 0) {
    await training.createSession(owner.id, cohort.id, {
      title: 'مقدمة في أنظمة الري',
      startsAt: new Date(cohort.startAt.getTime() + 3_600_000).toISOString(),
      endsAt: new Date(cohort.startAt.getTime() + 4 * 3_600_000).toISOString(),
      location: 'مشتل نبتة التجريبي — طولكرم'
    });
    console.log('One session scheduled inside the cohort dates.');
  }

  console.log('');
  console.log('Everything above is demonstration data. No stipend is paid, no certificate is issued,');
  console.log('and no job exists: being accepted onto training is not being hired.');
} finally {
  await db.$disconnect();
}
