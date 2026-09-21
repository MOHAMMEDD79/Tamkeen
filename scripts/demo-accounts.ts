/**
 * One ready-to-use test account per role, on a local build.
 *
 * Creates (or resets) a verified account for every platform role, every organisation membership
 * role and every personal profile type, puts each one where its role applies, and turns on
 * two-step verification for the platform staff (their pages require it). All accounts share one
 * simple password and all staff share one authenticator key, so testing a role takes seconds. Both
 * are written to `.local/demo-accounts.md` (gitignored), not printed to the terminal.
 *
 * Refuses to run outside demo/test. Re-running it resets the password and re-applies the roles.
 *
 *   pnpm demo:accounts
 */

import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createAuth } from '../apps/api/dist/modules/identity/auth.js';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment)) throw new Error(`demo:accounts refuses to run in ${config.environment}.`);

const SEED_TAG = 'seed-demo-2026';
type PlatformRole = 'Support' | 'VerificationReviewer' | 'ContentReviewer' | 'FinanceOperator' | 'RiskReviewer' | 'PlatformAdmin' | 'Auditor' | 'Operations';
type MembershipRole = 'Owner' | 'OrgAdmin' | 'ProjectManager' | 'FinanceMaker' | 'FinanceApprover' | 'Recruiter' | 'ProgramManager' | 'Trainer' | 'InvestmentManager' | 'Analyst' | 'Viewer' | 'Mentor' | 'VolunteerCoordinator' | 'CaseWorker';

const platform: Array<{ role: PlatformRole; name: string; test: string }> = [
  { role: 'PlatformAdmin', name: 'مدير المنصة', test: '/ar/admin/site (إدارة الموقع)، /ar/admin/team (فريق التشغيل)، /ar/admin/messages' },
  { role: 'VerificationReviewer', name: 'مراجع التوثيق', test: '/ar/admin/verifications — قرارات توثيق الجهات' },
  { role: 'ContentReviewer', name: 'مراجع المحتوى', test: '/ar/admin/reviews/project و /ar/admin/program-reviews — اعتماد المشاريع والبرامج قبل النشر' },
  { role: 'FinanceOperator', name: 'المشغّل المالي', test: '/ar/admin/finance و /ar/admin/bank-change-requests — الصرف والاسترداد وتغيير الحسابات البنكية' },
  { role: 'RiskReviewer', name: 'مراجع المخاطر', test: '/ar/admin/investment-reviews — العروض والأهلية والتخصيص' },
  { role: 'Support', name: 'الدعم', test: '/ar/admin/tickets — تذاكر الدعم' },
  { role: 'Auditor', name: 'المدقق', test: '/ar/admin/audit — سجل التدقيق (قراءة فقط)' },
  { role: 'Operations', name: 'التشغيل', test: '/ar/admin/operations — لوحة التشغيل' }
];

const membership: Array<{ role: MembershipRole; name: string; org: 'own' | 'ufuq' | 'nabta'; test: string }> = [
  { role: 'Owner', name: 'مالك جهة', org: 'own', test: 'جهة جديدة خاصة به: الإعدادات والفريق والتوثيق ونقل الملكية وتغيير البنك' },
  { role: 'OrgAdmin', name: 'مدير جهة', org: 'ufuq', test: 'إدارة فريق جمعية الأفق وإعداداتها' },
  { role: 'ProjectManager', name: 'مدير مشاريع', org: 'ufuq', test: 'إنشاء المشاريع والحملات والمراحل وتقديمها للمراجعة' },
  { role: 'FinanceMaker', name: 'طالب الصرف', org: 'ufuq', test: 'طلب صرف من صفحة الصرف في مساحة الجهة' },
  { role: 'FinanceApprover', name: 'معتمد الصرف', org: 'ufuq', test: 'اعتماد طلبات الصرف (لا يعتمد ما طلبه بنفسه)' },
  { role: 'ProgramManager', name: 'مدير برامج', org: 'ufuq', test: 'البرامج والدفعات والطلبات والبدلات والشهادات' },
  { role: 'Trainer', name: 'مدرب', org: 'ufuq', test: 'تسجيل الحضور في الجلسات المسندة إليه' },
  { role: 'Mentor', name: 'مرشد', org: 'ufuq', test: 'التعليق على أفكار الاحتضان (لا يقرر)' },
  { role: 'VolunteerCoordinator', name: 'منسق تطوع', org: 'ufuq', test: 'فرص التطوع واعتماد الساعات' },
  { role: 'CaseWorker', name: 'باحث حالة', org: 'ufuq', test: 'طلبات المساعدة: الاستلام والقرار والتسليم' },
  { role: 'Analyst', name: 'محلل', org: 'ufuq', test: 'التقارير والتصدير دون تعديل' },
  { role: 'Viewer', name: 'مطّلع', org: 'ufuq', test: 'قراءة فقط داخل الجهة' },
  { role: 'InvestmentManager', name: 'مدير استثمار', org: 'nabta', test: 'عروض الاستثمار وغرفة البيانات والتخصيص لشركة نبتة' },
  { role: 'Recruiter', name: 'مسؤول توظيف', org: 'nabta', test: 'الوظائف والترشيحات والعروض والتوظيف لشركة نبتة' }
];

const personal: Array<{ key: string; capability: string; name: string; test: string }> = [
  { key: 'donor', capability: 'Donor', name: 'متبرع', test: 'تصفّح المشاريع والمساهمة وطلب الاسترداد — /ar/app/contributions' },
  { key: 'investor', capability: 'Investor', name: 'مستثمر', test: 'ملف المستثمر والاكتتاب والمحفظة — /ar/app/investor/eligibility' },
  { key: 'jobseeker', capability: 'JobSeeker', name: 'باحث عن عمل', test: 'الملف المهني والتقديم على البرامج والوظائف — /ar/app/applications' },
  { key: 'beneficiary', capability: 'Beneficiary', name: 'مستفيد', test: 'طلب مساعدة ومتابعته — /ar/app/assistance' },
  { key: 'volunteer', capability: 'Volunteer', name: 'متطوع', test: 'فرص التطوع والساعات — /ar/app/volunteering' }
];

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const emailFor = (key: string) => `${kebab(key)}@tamkeen.test`;

/** RFC 6238 code from an otpauth URI, so two-step setup completes without a phone. */
function totpNow(uri: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  let bits = '';
  for (const character of secret.replace(/=+$/g, '').toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

const db = createDatabase(config.databaseUrl);
const auth = createAuth(config, db);
const identity = new IdentityService(db);
// One memorable password for every test account, so testing a role is not a lookup exercise. It is
// only ever set on a local build (the environment check above), and DEMO_ACCOUNTS_PASSWORD overrides it.
const password = process.env.DEMO_ACCOUNTS_PASSWORD || 'Tamkeen@2026';
if (password.length < 12) throw new Error('DEMO_ACCOUNTS_PASSWORD must be at least 12 characters.');

/** Creates the account or replaces its password, then marks the email verified. */
async function account(email: string, name: string) {
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    await auth.api.signUpEmail({ body: { email, password, name, termsVersion: CURRENT_TERMS_VERSION } as never });
    user = await db.user.findUniqueOrThrow({ where: { email } });
  } else {
    await db.account.deleteMany({ where: { userId: user.id, providerId: 'credential' } });
    const ctx = await auth.$context;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: 'credential', password: await ctx.password.hash(password) } });
  }
  return db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
}

/**
 * Turns on TOTP the way a person would: sign in, enable, confirm the first code. The first staff
 * account does this for real; the others then receive a copy of its stored (encrypted) secret, so a
 * single authenticator entry produces the code for every staff test account.
 */
let sharedTwoStep: { secret: string; backupCodes: string } | null = null;
async function enableTwoStep(email: string, userId: string): Promise<string> {
  if (sharedTwoStep) {
    await db.twoFactor.deleteMany({ where: { userId } });
    await db.twoFactor.create({ data: { userId, secret: sharedTwoStep.secret, backupCodes: sharedTwoStep.backupCodes, verified: true } });
    await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    return '';
  }
  await db.twoFactor.deleteMany({ where: { userId } });
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = signIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const headers = new Headers({ cookie, origin: config.appBaseUrl });
  const setup = await auth.api.enableTwoFactor({ body: { password }, headers }) as { totpURI: string };
  await auth.api.verifyTOTP({ body: { code: totpNow(setup.totpURI), trustDevice: false }, headers });
  const stored = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
  sharedTwoStep = { secret: stored.secret, backupCodes: stored.backupCodes };
  return new URL(setup.totpURI).searchParams.get('secret') ?? '';
}

const rows: string[] = [];
try {
  const orgs = {
    ufuq: await db.organization.findFirstOrThrow({ where: { slug: `${SEED_TAG}-ufuq` } }),
    nabta: await db.organization.findFirstOrThrow({ where: { slug: `${SEED_TAG}-nabta` } })
  };

  const staffRows: string[] = [];
  let staffKey = '';
  for (const entry of platform) {
    const email = emailFor(entry.role);
    const user = await account(email, `${entry.name} (تجريبي)`);
    const held = await db.platformGrant.findFirst({ where: { userId: user.id, role: entry.role, revokedAt: null } });
    if (!held) await db.platformGrant.create({ data: { userId: user.id, role: entry.role, grantedBy: user.id } });
    staffKey = (await enableTwoStep(email, user.id)) || staffKey;
    staffRows.push(`| ${entry.name} | ${email} | ${entry.test} |`);
  }
  rows.push('## فريق المنصة (بعد كلمة المرور يُطلب رمز من 6 أرقام)', '',
    `مفتاح واحد لكل حسابات فريق المنصة، أضفه مرة واحدة في تطبيق المصادقة: \`${staffKey}\``,
    'عند إدخال الرمز فعّل «تذكّر هذا الجهاز» فلا يُطلب منك مرة أخرى من هذا المتصفح لمدة 30 يومًا.', '',
    '| الدور | البريد | ماذا تختبر |', '|---|---|---|', ...staffRows);

  rows.push('', '## أدوار داخل الجهات', '', '| الدور | البريد | الجهة | ماذا تختبر |', '|---|---|---|---|');
  for (const entry of membership) {
    const email = emailFor(entry.role);
    const user = await account(email, `${entry.name} (تجريبي)`);
    let orgName: string;
    if (entry.org === 'own') {
      const owned = await db.membership.findFirst({ where: { userId: user.id, roles: { has: 'Owner' } }, include: { organization: true } });
      orgName = owned?.organization.displayName ?? (await identity.createOrganization(user.id, { legalName: 'جهة المالك التجريبية', displayName: 'جهة المالك التجريبية', type: 'NGO', country: 'PS', city: 'رام الله' })).displayName;
    } else {
      const org = orgs[entry.org];
      await db.party.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, kind: 'individual' } }).catch(() => undefined);
      await db.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
        update: { roles: [entry.role], status: 'active' },
        create: { userId: user.id, organizationId: org.id, roles: [entry.role], status: 'active' }
      });
      orgName = org.displayName;
    }
    rows.push(`| ${entry.name} | ${email} | ${orgName} | ${entry.test} |`);
  }

  rows.push('', '## أنواع الحسابات الشخصية', '', '| النوع | البريد | ماذا تختبر |', '|---|---|---|');
  for (const entry of personal) {
    const email = emailFor(entry.key);
    const user = await account(email, `${entry.name} (تجريبي)`);
    await db.individualProfile.updateMany({ where: { userId: user.id }, data: { capabilities: [entry.capability] } });
    rows.push(`| ${entry.name} | ${email} | ${entry.test} |`);
  }

  const file = [
    '# حسابات الاختبار — تمكين (محلي فقط)',
    '',
    `كلمة المرور لكل الحسابات: \`${password}\``,
    '',
    'سجّل الدخول من http://127.0.0.1:3000/ar/login. حسابات فريق المنصة تطلب بعد كلمة المرور رمزًا من 6 أرقام: أضف «مفتاح تطبيق المصادقة» يدويًا في Google Authenticator أو Microsoft Authenticator (إدخال مفتاح الإعداد، نوع: حسب الوقت).',
    'إعادة تشغيل `pnpm demo:accounts` تغيّر كلمة المرور والمفاتيح. هذا الملف لا يدخل Git.',
    '',
    ...rows,
    ''
  ].join('\n');
  await mkdir('.local', { recursive: true });
  await writeFile('.local/demo-accounts.md', file, 'utf8');
  console.log(`Ready: ${platform.length + membership.length + personal.length} accounts. Open .local/demo-accounts.md for the password and details.`);
} finally {
  await db.$disconnect();
}
