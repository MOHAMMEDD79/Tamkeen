'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { AppShell, Card, EmptyState, ErrorState, Ltr, Notice, PageHeader, Skeleton, StatusBadge, localePath, translator, type Locale } from '@tamkeen/ui';
import { actionById } from '@tamkeen/contracts';
import { safeReturnTo } from '../../lib/return-to';
import './workspace.css';

type Profile = { displayName: string; city: string | null; locale: string; capabilities: string[]; version: number };
type Me = { user: { id: string; name: string; email: string; twoFactorEnabled: boolean }; profile: Profile; contexts: Array<{ organization: { id: string; displayName: string; type: string }; roles: string[]; permissions: string[] }>; platformRoles: string[] };
type Org = { id: string; displayName: string; legalName: string; slug: string; logoUrl: string | null; currentLogoId: string | null; publicDescription: string; sectors: string[]; contactEmail: string | null; websiteUrl: string | null; contactAddress: string | null; country: string; city: string; type: string; verification: string; version: number };
type PublicOrganization = Pick<Org, 'id' | 'displayName' | 'slug' | 'logoUrl' | 'publicDescription' | 'sectors' | 'contactEmail' | 'websiteUrl' | 'contactAddress' | 'country' | 'city' | 'type' | 'verification'>;
type Member = { id: string; userId: string; roles: string[]; status: string; version: number; user: { name: string; email: string } };
type Invitation = { id: string; email: string; roles: string[]; expiresAt: string; consumedAt: string | null; revokedAt: string | null; declinedAt: string | null };
type InvitationPreview = { organization: { displayName: string; type: string; country: string; city: string }; inviter: { name: string }; roles: string[]; expiresAt: string; status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired' };
type OrganizationDraft = { legalName?: string; displayName?: string; city?: string; country?: string; type?: string };
type VerificationCase = { id: string | null; state: string; version: number; registrationNumber: string; issuingAuthority: string; registeredAddress: string; documentExpiresAt: string | null; documents: Array<{ id: string; fileName: string; scanState: string; scanReason: string | null }>; submissions: Array<{ id: string; sequence: number; submittedAt: string }> };
type VerificationDecision = { id: string; outcome: string; publicReason: string; decidedAt: string; submission: { sequence: number } };
type VerificationUploadIntent = { id: string; token: string; uploadPath: string; finalizePath: string };
type VerificationReviewListItem = { id: string; sequence: number; submittedAt: string; case: { state: string; version: number; assignedReviewerId: string | null; organization: { id: string; displayName: string; type: string; country: string; city: string } } };
type VerificationReview = { id: string; sequence: number; submittedAt: string; snapshot: { registrationNumber?: string; issuingAuthority?: string; registeredAddress?: string; documentExpiresAt?: string | null }; decision: { outcome: string; publicReason: string; decidedAt: string } | null; case: { state: string; version: number; assignedReviewerId: string | null; organization: { id: string; displayName: string; legalName: string; type: string; country: string; city: string }; documents: Array<{ id: string; fileName: string; contentType: string; actualSize: number | null; checksum: string | null; scanState: string; finalizedAt: string | null }> } };
type PendingMfa = { kind: 'verification-decision'; challengeId: string; submissionId: string; version: number; outcome: 'changes_requested' | 'verified' | 'rejected'; publicReason: string; returnTo: string } | { kind: 'ownership-transfer'; challengeId: string; organizationId: string; targetUserId: string; version: number; returnTo: string } | { kind: 'data-export'; challengeId: string; returnTo: string };
type MfaSetup = { totpURI: string; backupCodes: string[] };
type AccountSession = { id: string; createdAt: string; updatedAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; activeOrganizationId: string | null; current: boolean };
type PlatformTeam = { members: Array<{ user: { id: string; name: string; email: string; twoFactorEnabled: boolean; platformAccessVersion: number }; grants: Array<{ id: string; role: string; expiresAt: string | null }> }>; invitations: Array<{ id: string; email: string; roles: string[]; grantExpiresAt: string; expiresAt: string; createdAt: string }> };
type PlatformInvitationPreview = { roles: string[]; grantExpiresAt: string; expiresAt: string; inviter: { name: string }; requiresMfaSetup: boolean; status: 'pending' | 'accepted' | 'revoked' | 'expired' };
type OwnershipTransferPreview = { organization: { id: string; displayName: string; type: string; city: string; country: string }; currentOwner: { name: string }; expiresAt: string; requiresMfaSetup: boolean; status: 'pending' | 'accepted' | 'expired' };
type BankSettings = { activeAccount: { id: string; bankName: string; accountHolder: string; accountLast4: string; country: string; currency: string; updatedAt: string } | null; requests: Array<{ id: string; bankName: string; accountHolder: string; accountLast4: string; country: string; currency: string; state: 'pending' | 'approved' | 'rejected'; version: number; reviewReason: string; createdAt: string; reviewedAt: string | null }> };
type BankChangeReview = { id: string; bankName: string; accountHolder: string; accountLast4: string; country: string; currency: string; state: string; version: number; organizationVersion: number; stale: boolean; createdAt: string; organization: { id: string; displayName: string; verification: string; country: string; version: number }; requester: { id: string; name: string } };
const capabilityLabels = { Donor: 'متبرع', Beneficiary: 'مستفيد', JobSeeker: 'باحث عن عمل', Investor: 'مستثمر', Volunteer: 'متطوع' };
const roleLabels: Record<string, string> = { Owner: 'مالك الجهة', OrgAdmin: 'إدارة الجهة', ProjectManager: 'إدارة المشاريع', Viewer: 'قراءة', Analyst: 'تحليل', FinanceMaker: 'طلب صرف', FinanceApprover: 'اعتماد صرف' };
const platformRoleLabels: Record<string, string> = { Support: 'دعم', VerificationReviewer: 'مراجع توثيق', ContentReviewer: 'مراجع محتوى', FinanceOperator: 'مشغل مالي', RiskReviewer: 'مراجع مخاطر', PlatformAdmin: 'مدير منصة', Auditor: 'مدقق' };
const errors: Record<string, string> = { unauthorized: 'سجّل الدخول للمتابعة.', request_rejected: 'تعذر تنفيذ الطلب. تحقق من تسجيل الدخول وصلاحيتك.', forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء.', invalid_input: 'راجع البيانات المطلوبة ثم أعد المحاولة.', conflict: 'تغير السجل أو يوجد طلب سابق. حدّث الصفحة قبل إعادة المحاولة.', not_found: 'المورد المطلوب غير موجود أو غير متاح لك.', mfa_unavailable: 'انتهى تحقق العملية أو أُلغي. ابدأ العملية من جديد.', transfer_unavailable: 'طلب نقل الملكية منتهٍ أو مستخدم أو غير متاح.', INVALID_CODE: 'رمز المصادقة غير صحيح.', INVALID_BACKUP_CODE: 'رمز الاسترداد غير صحيح أو مستخدم.', upload_unavailable: 'انتهت صلاحية الرفع أو استُخدمت من قبل. ابدأ رفعًا جديدًا.', upload_incomplete: 'لم يصل الملف كاملًا. ابدأ رفعًا جديدًا.', invitation_unavailable: 'الدعوة منتهية أو مستخدمة أو غير متاحة.', EMAIL_NOT_VERIFIED: 'تحقق من بريدك قبل تسجيل الدخول.', INVALID_EMAIL_OR_PASSWORD: 'البريد أو كلمة المرور غير صحيحة.' };

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw new Error('محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.');
    throw new Error(errors[result.error?.code ?? result.code] ?? (response.status === 401 ? 'سجّل الدخول للمتابعة.' : 'تعذر تنفيذ الطلب. تحقق من البيانات وحاول مجددًا.'));
  }
  return result.data ?? result;
}

async function verificationFileRequest(path: string, method: 'PUT' | 'POST', token: string, file?: File) {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', cache: 'no-store', headers: { 'x-upload-token': token, ...(file ? { 'Content-Type': file.type } : {}) }, ...(file ? { body: file } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errors[result.error?.code] ?? 'تعذر رفع الوثيقة أو فحصها. ابدأ رفعًا جديدًا.');
  return result.data ?? result;
}

const CAPABILITY_LABELS = [
  { value: 'Donor', label: 'متبرع' },
  { value: 'Beneficiary', label: 'مستفيد' },
  { value: 'JobSeeker', label: 'باحث عن عمل' },
  { value: 'Investor', label: 'مستثمر — لا يمنح أهلية مالية بذاته' },
  { value: 'Volunteer', label: 'متطوع' }
];

/**
 * Sections the screen catalogue promises but the product cannot yet do. The status and the owning
 * part come from the shared action manifest, so a section cannot quietly stay listed here after it
 * is implemented, and the wording below is the user-facing explanation of that recorded gap.
 */
const PENDING_PERSONAL_SECTIONS = [
  { id: 'PER-01.A01', label: 'مساهماتي', note: 'تظهر بعد بناء وحدة المساهمات والدفتر المالي؛ لا توجد مساهمات في النظام بعد.' },
  { id: 'PER-01.A02', label: 'استثماراتي', note: 'تظهر بعد بناء العروض والالتزامات والتخصيص؛ لا تُشتق ملكية من قدرة «مستثمر».' },
  { id: 'PER-01.A03', label: 'طلباتي', note: 'تظهر بعد بناء البرامج والطلبات.' }
];

const PENDING_ACCOUNT_REQUESTS = [
  { id: 'PER-18.A05', label: 'طلب إغلاق الحساب', note: 'يجب أن يعرض التزاماتك القائمة أولًا، وهي تعتمد على وحدات لم تُبنَ بعد.' }
];

/**
 * Renders a catalogued action that is not built, as a declared state rather than a dead control.
 * 00-MASTER-PROMPT forbids a button that does nothing; the manifest is the source of truth for the
 * status and for which part owns the work.
 */
function UnavailableAction({ id, label, note }: { id: string; label: string; note: string }) {
  const entry = actionById(id);
  return (
    <article className="tmk-row">
      <div>
        <strong>{label}</strong>
        <p className="tmk-field__hint">{note}</p>
      </div>
      <div className="tmk-row__actions">
        <StatusBadge tone="neutral" label="حالة التنفيذ">غير منفذ بعد{entry ? ` · ${entry.part}` : ''}</StatusBadge>
      </div>
    </article>
  );
}

function Field({ label, name, type = 'text', value, minLength }: { label: string; name: string; type?: string; value?: string; minLength?: number }) {
  return <label className="field">{label}<input required name={name} type={type} defaultValue={value} minLength={minLength} maxLength={type === 'password' ? 128 : 254} autoComplete={type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'} dir={type === 'email' ? 'ltr' : undefined} /></label>;
}

export function IdentityWorkspace({ route, locale }: { route: string; locale: Locale }) {
  // Every internal destination is locale-prefixed; returnTo values stay locale-free so the
  // allowlist in safeReturnTo keeps matching a single known set of paths.
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationPreview, setInvitationPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [returnTo, setReturnTo] = useState('/app');
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>({});
  const [publicPreview, setPublicPreview] = useState<PublicOrganization | null>(null);
  const [verificationCase, setVerificationCase] = useState<VerificationCase | null>(null);
  const [verificationDecisions, setVerificationDecisions] = useState<VerificationDecision[]>([]);
  const [reviewQueue, setReviewQueue] = useState<VerificationReviewListItem[]>([]);
  const [verificationReview, setVerificationReview] = useState<VerificationReview | null>(null);
  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [platformTeam, setPlatformTeam] = useState<PlatformTeam | null>(null);
  const [platformInvitation, setPlatformInvitation] = useState<PlatformInvitationPreview | null>(null);
  const [ownershipTransfer, setOwnershipTransfer] = useState<OwnershipTransferPreview | null>(null);
  const [bankSettings, setBankSettings] = useState<BankSettings | null>(null);
  const [bankChangeQueue, setBankChangeQueue] = useState<BankChangeReview[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  const orgId = route.startsWith('/org/') ? route.split('/')[2] : undefined;
  const publicPage = ['/login', '/register', '/recover', '/reset', '/verify', '/mfa/login', '/policies/terms'].includes(route);

  useEffect(() => {
    let active = true;
    if (publicPage) {
      const search = new URLSearchParams(window.location.search);
      setReturnTo(safeReturnTo(search.get('returnTo')));
      if (route === '/verify') setVerificationResult(search.get('success') === '1' ? 'success' : search.has('error') ? 'error' : null);
      setLoading(false); return;
    }
    (async () => {
      try {
        const current = await api('/me') as Me;
        if (!active) return;
        setMe(current);
        if (route === '/app/security' || route === '/app/settings') {
          const sessions = await api('/sessions') as AccountSession[];
          if (active) setAccountSessions(sessions);
        }
        if (route.startsWith('/invitations/')) {
          const preview = await api(`/invitations/${route.split('/')[2]}`) as InvitationPreview;
          if (active) setInvitationPreview(preview);
        }
        if (orgId) {
          const currentOrg = await api(`/orgs/${orgId}`) as Org;
          if (!active) return;
          setOrg(currentOrg);
          if (route.endsWith('/settings') && current.contexts.find(context => context.organization.id === orgId)?.permissions.includes('bank.manage')) {
            const bank = await api(`/orgs/${orgId}/bank-settings`) as BankSettings;
            if (active) setBankSettings(bank);
          }
          if (route.endsWith('/settings') && current.contexts.find(context => context.organization.id === orgId)?.roles.includes('Owner')) {
            const list = await api(`/orgs/${orgId}/members`) as Member[];
            if (active) setMembers(list);
          }
          if (route.endsWith('/team')) {
            const list = await api(`/orgs/${orgId}/members`) as Member[];
            if (active) setMembers(list);
            if (current.contexts.find(context => context.organization.id === orgId)?.permissions.includes('member.invite')) {
              const invitationList = await api(`/orgs/${orgId}/invitations`) as Invitation[];
              if (active) setInvitations(invitationList);
            }
          }
          if (route.endsWith('/verification')) {
            const currentCase = await api(`/orgs/${orgId}/verification`) as VerificationCase;
            const decisions = await api(`/orgs/${orgId}/verification/decisions`) as VerificationDecision[];
            if (active) { setVerificationCase(currentCase); setVerificationDecisions(decisions); }
          }
        }
        if (route === '/admin/bank-change-requests' && current.platformRoles.includes('FinanceOperator')) {
          const queue = await api('/admin/bank-change-requests') as BankChangeReview[];
          if (active) setBankChangeQueue(queue);
        } else if (route === '/admin/team' && current.platformRoles.includes('PlatformAdmin')) {
          const team = await api('/admin/team') as PlatformTeam;
          if (active) setPlatformTeam(team);
        } else if (route.startsWith('/ownership-transfers/')) {
          const transfer = await api(`/ownership-transfers/${route.split('/')[2]}`) as OwnershipTransferPreview;
          if (active) setOwnershipTransfer(transfer);
        } else if (route.startsWith('/platform-invitations/')) {
          const invitation = await api(`/platform-invitations/${route.split('/')[2]}`) as PlatformInvitationPreview;
          if (active) setPlatformInvitation(invitation);
        } else if (route === '/admin/verifications' && current.platformRoles.includes('VerificationReviewer')) {
          const queue = await api('/admin/verifications') as VerificationReviewListItem[];
          if (active) setReviewQueue(queue);
        } else if (route.startsWith('/admin/verifications/') && current.platformRoles.includes('VerificationReviewer')) {
          const review = await api(`/admin/verifications/${route.split('/')[3]}`) as VerificationReview;
          if (active) setVerificationReview(review);
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [route, orgId, publicPage]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (route !== '/app/organizations/new') return;
    try { setOrganizationDraft(JSON.parse(window.localStorage.getItem('tamkeen.organization-draft') ?? '{}') as OrganizationDraft); } catch { window.localStorage.removeItem('tamkeen.organization-draft'); }
  }, [route]);
  useEffect(() => {
    if (route !== '/mfa/challenge') return;
    try { setPendingMfa(JSON.parse(window.sessionStorage.getItem('tamkeen.mfa-operation') ?? 'null') as PendingMfa | null); } catch { window.sessionStorage.removeItem('tamkeen.mfa-operation'); }
  }, [route]);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }
  function form(work: (data: FormData) => Promise<void>) {
    return (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); void action(() => work(data)); };
  }
  const submit = (label: string) => <button type="submit" disabled={busy}>{busy ? 'جارٍ التنفيذ…' : label}</button>;
  let content: ReactNode = null;

  if (route === '/login' || route === '/register') {
    const register = route === '/register';
    content = <><h1>{register ? 'حساب واحد، فرص متعددة' : 'مرحبًا بعودتك'}</h1><p>استخدم حسابك الشخصي للمساهمة والعمل وإدارة الجهات التي تنتمي إليها.</p><form onSubmit={form(async data => {
      if (register) {
        await api('/auth/sign-up/email', 'POST', { name: data.get('name'), email: data.get('email'), password: data.get('password'), termsVersion: data.get('acceptTerms') ? CURRENT_TERMS_VERSION : '', callbackURL: `${window.location.origin}${L('/verify')}?success=1&returnTo=${encodeURIComponent(returnTo)}` });
        setNotice('تم استلام طلب التسجيل. راجع بريدك الإلكتروني وافتح رابط التحقق ثم سجّل الدخول. قد تصل الرسالة إلى مجلد الرسائل غير المرغوب فيها.');
      } else { const login = await api('/auth/sign-in/email', 'POST', { email: data.get('email'), password: data.get('password') }) as { twoFactorRedirect?: boolean }; window.location.assign(L(login.twoFactorRedirect ? `/mfa/login?returnTo=${encodeURIComponent(returnTo)}` : returnTo)); }
    })}>{register && <Field label="اسمك" name="name" minLength={2} />}<Field label="البريد الإلكتروني" name="email" type="email" /><Field label="كلمة المرور — 12 حرفًا على الأقل" name="password" type="password" minLength={12} />
      {register && <><p className="note">هذه بيئة تجربة محلية. لا تستخدم بيانات أو كلمة مرور تخص حسابًا حقيقيًا.</p><label className="check terms-consent"><input required type="checkbox" name="acceptTerms" />أوافق على <a href={L('/policies/terms')} target="_blank" rel="noreferrer">حدود وشروط النسخة التجريبية</a> (الإصدار {CURRENT_TERMS_VERSION}).</label></>}{submit(register ? 'إنشاء حساب' : 'تسجيل الدخول')}</form><nav className="inline-links"><a href={L(`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(returnTo)}`)}>{register ? 'لدي حساب' : 'أنشئ حسابًا'}</a><a href={L('/recover')}>استعادة كلمة المرور</a><a href={L('/verify')}>إعادة إرسال التحقق</a></nav></>;
  } else if (route === '/mfa/login') {
    content = <><h1>التحقق بخطوتين</h1><p>أدخل رمز تطبيق المصادقة لإكمال تسجيل الدخول.</p><form onSubmit={form(async data => { await api('/auth/two-factor/verify-totp', 'POST', { code: data.get('code'), trustDevice: false }); window.location.assign(L(returnTo)); })}><Field label="رمز المصادقة" name="code" /><button type="submit" disabled={busy}>تحقق وتابع</button></form><details><summary>استخدام رمز استرداد</summary><form onSubmit={form(async data => { await api('/auth/two-factor/verify-backup-code', 'POST', { code: data.get('code'), disableSession: false, trustDevice: false }); window.location.assign(L(returnTo)); })}><Field label="رمز الاسترداد" name="code" /><button type="submit" disabled={busy}>استخدام الرمز</button></form></details></>;
  } else if (route === '/verify' && verificationResult) {
    content = verificationResult === 'success'
      ? <><h1>تم التحقق من بريدك</h1><p>أصبح حسابك جاهزًا لتسجيل الدخول. رابط التحقق أحادي الاستخدام.</p><a href={L(`/login?returnTo=${encodeURIComponent(returnTo)}`)}>تسجيل الدخول</a></>
      : <><h1>تعذر استخدام رابط التحقق</h1><p>قد يكون الرابط منتهيًا أو مستخدمًا من قبل. اطلب رابط تحقق جديدًا.</p><a href={L('/verify')}>إرسال رابط جديد</a></>;
  } else if (route === '/recover' || route === '/verify') {
    content = <><h1>{route === '/recover' ? 'استعادة الوصول' : 'تحقق من بريدك'}</h1><form onSubmit={form(async data => {
      await api(route === '/recover' ? '/auth/request-password-reset' : '/auth/send-verification-email', 'POST', { email: data.get('email'), redirectTo: `${window.location.origin}${L('/reset')}`, callbackURL: `${window.location.origin}${L('/login')}` });
      setNotice('إذا كان البريد مسجّلًا ومؤهلًا لهذا الإجراء، ستصلك رسالة على بريدك الإلكتروني خلال دقائق.');
    })}><Field label="البريد الإلكتروني" name="email" type="email" />{submit('إرسال رابط')}</form><a href={L('/login')}>العودة إلى الدخول</a></>;
  } else if (route === '/reset') {
    content = <><h1>كلمة مرور جديدة</h1><form onSubmit={form(async data => {
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) throw new Error('رابط الاسترداد غير صالح. اطلب رابطًا جديدًا.');
      await api('/auth/reset-password', 'POST', { token, newPassword: data.get('password') });
      setNotice('تغيرت كلمة المرور وأُلغيت الجلسات السابقة. يمكنك تسجيل الدخول الآن.');
    })}><Field label="كلمة المرور الجديدة" name="password" type="password" minLength={12} />{submit('حفظ كلمة المرور')}</form><a href={L('/login')}>تسجيل الدخول</a></>;
  } else if (route === '/policies/terms') {
    content = <><p className="eyebrow">الإصدار {CURRENT_TERMS_VERSION}</p><h1>شروط وحدود بيئة تمكين المحلية</h1><p>هذه النسخة مخصصة لاختبار الوظائف ببيانات تجريبية. لا تستقبل أموالًا ولا تنشئ ملكية أو التزامات استثمارية. تُسجل موافقة إنشاء الحساب على هذا الإصدار وتاريخه. الشروط والسياسات التشغيلية النهائية لم تعتمد بعد.</p><a href={L('/register')}>العودة إلى إنشاء الحساب</a></>;
  } else if (me && (route === '/app/security' || route === '/app/settings')) {
    const deviceLabel = (userAgent: string | null) => !userAgent ? 'جهاز غير معروف' : /Mobile|Android|iPhone/i.test(userAgent) ? 'هاتف أو جهاز لوحي' : /Firefox/i.test(userAgent) ? 'Firefox على حاسوب' : /Edg/i.test(userAgent) ? 'Edge على حاسوب' : /Chrome/i.test(userAgent) ? 'Chrome على حاسوب' : /Safari/i.test(userAgent) ? 'Safari على حاسوب' : 'متصفح على حاسوب';
    content = <>
      <PageHeader dashboard eyebrow="الحساب" title="الإعدادات والأمان" lead="ملفك ولغتك وجلساتك وتحققك بخطوتين. التحقق بخطوتين مطلوب لأدوار مراجعة المنصة وللعمليات الحساسة." />
      <Card title="الملف واللغة" id="per18-profile">
        <p className="tmk-field__hint">تفعيل قدرة لا يمنح أهلية مالية. أهلية الاستثمار حالة منفصلة تُراجع على حدة.</p>
        <form key={me.profile.version} onSubmit={form(async data => {
          await api('/me/profile', 'PATCH', { displayName: data.get('displayName'), city: data.get('city'), locale: data.get('locale'), capabilities: data.getAll('capabilities'), version: me.profile.version });
          setMe(await api('/me'));
          setNotice('حُفظ الملف. إذا غيّرت اللغة فبدّلها من أعلى الصفحة لترى الواجهة بها.');
        })}>
          <Field label="الاسم المعروض" name="displayName" value={me.profile.displayName} />
          <Field label="المدينة" name="city" value={me.profile.city ?? ''} />
          <label className="field">لغة الواجهة<select name="locale" defaultValue={me.profile.locale}><option value="ar">العربية</option><option value="en">English</option></select></label>
          <fieldset><legend>قدراتي</legend>{CAPABILITY_LABELS.map(capability => <label className="check" key={capability.value}><input type="checkbox" name="capabilities" value={capability.value} defaultChecked={me.profile.capabilities.includes(capability.value)} />{capability.label}</label>)}</fieldset>
          {submit('حفظ الملف')}
        </form>
      </Card>
      <Card title="التحقق بخطوتين" id="per18-mfa">
        {me.user.twoFactorEnabled
          ? <><p className="status ready">التحقق بخطوتين مفعّل على هذا الحساب.</p><form onSubmit={form(async data => { await api('/auth/two-factor/disable', 'POST', { password: data.get('password') }); setMe(await api('/me')); setMfaSetup(null); setNotice('أُلغي التحقق بخطوتين.'); })}><Field label="كلمة المرور لتأكيد الإلغاء" name="password" type="password" minLength={12} />{submit('إلغاء التحقق بخطوتين')}</form></>
          : !mfaSetup
            ? <form onSubmit={form(async data => { const setup = await api('/auth/two-factor/enable', 'POST', { password: data.get('password'), method: 'totp', issuer: 'Tamkeen' }) as MfaSetup; setMfaSetup(setup); setNotice('أضف المفتاح إلى تطبيق المصادقة ثم أكد الرمز الأول.'); })}><Field label="كلمة المرور" name="password" type="password" minLength={12} />{submit('بدء إعداد تطبيق المصادقة')}</form>
            : <><p className="note">انسخ الرابط التالي إلى تطبيق المصادقة واحفظ رموز الاسترداد في مكان آمن. لن تظهر الرموز مرة أخرى بعد مغادرة الصفحة.</p><textarea readOnly rows={4} value={mfaSetup.totpURI} aria-label="رابط إعداد تطبيق المصادقة" /><ul>{mfaSetup.backupCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul><form onSubmit={form(async data => { await api('/auth/two-factor/verify-totp', 'POST', { code: data.get('code'), trustDevice: false }); setMe(await api('/me')); setMfaSetup(null); setNotice('فُعّل التحقق بخطوتين.'); const next = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo')); if (next !== '/app') window.location.assign(L(next)); })}><Field label="الرمز الأول من التطبيق" name="code" />{submit('تأكيد التفعيل')}</form></>}
      </Card>
      <Card title="الجلسات والأجهزة" id="per18-sessions">
        <p className="tmk-field__hint">راجع الأجهزة التي ما زالت تملك وصولًا إلى حسابك وألغِ أي جلسة لا تعرفها. لا يُعرض رمز أي جلسة.</p>
        {!accountSessions.length
          ? <EmptyState title="لا توجد جلسات نشطة">قد تكون كل جلساتك انتهت أو أُلغيت.</EmptyState>
          : accountSessions.map(session => <article className="tmk-row" key={session.id}>
              <div>
                <strong>{deviceLabel(session.userAgent)}{session.current ? ' · هذه الجلسة' : ''}</strong>
                <p className="tmk-field__hint">آخر نشاط: {new Date(session.updatedAt).toLocaleString('ar')} · تنتهي: {new Date(session.expiresAt).toLocaleString('ar')}{session.ipAddress ? <> · <Ltr>{session.ipAddress}</Ltr></> : null}</p>
              </div>
              <div className="tmk-row__actions">
                <button type="button" className={session.current ? 'tmk-button tmk-button--danger' : 'tmk-button tmk-button--secondary'} disabled={busy} onClick={() => { if (window.confirm(session.current ? 'إنهاء جلستك الحالية وتسجيل الخروج؟' : 'إنهاء وصول هذا الجهاز؟')) void action(async () => { const result = await api(`/sessions/${session.id}/revoke`, 'POST', {}) as { current: boolean }; if (result.current) { window.location.assign(L('/login')); return; } setAccountSessions(await api('/sessions')); setNotice('أُلغيت الجلسة المحددة.'); }); }}>{session.current ? 'تسجيل الخروج من هذه الجلسة' : 'إلغاء الجلسة'}</button>
              </div>
            </article>)}
      </Card>
      <Card title="نسخة بيانات الحساب" id="per18-export">
        <p className="tmk-field__hint">تنشئ لقطة JSON خاصة تشمل ملفك وسجلاتك الشخصية، وتنتهي بعد 24 ساعة. يتطلب الطلب تحققًا إضافيًا ولا يمكن إعادة إنشاء نسخة منتهية دون تحقق جديد.</p>
        {me.user.twoFactorEnabled ? <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => { const challenge = await api('/me/data-exports/challenge', 'POST', {}) as { id: string }; const pending: PendingMfa = { kind: 'data-export', challengeId: challenge.id, returnTo: '/app/settings' }; window.sessionStorage.setItem('tamkeen.mfa-operation', JSON.stringify(pending)); window.location.assign(L(`/mfa/challenge?returnTo=${encodeURIComponent(pending.returnTo)}`)); })}>تحقق وأنشئ النسخة</button> : <p><a href={L('/app/settings#per18-mfa')}>فعّل التحقق بخطوتين أولًا</a></p>}
      </Card>
      <Card title="طلبات لم تُبنَ بعد" id="per18-pending">
        <p className="tmk-field__hint">هذه الطلبات محددة في المواصفة ولم تُنفذ. لا تُعرض كأزرار حتى لا يبدو أن الطلب أُرسل.</p>
        {PENDING_ACCOUNT_REQUESTS.map(request => <UnavailableAction key={request.id} id={request.id} label={request.label} note={request.note} />)}
      </Card>
    </>;
  } else if (me && route === '/mfa/challenge') {
    const finishChallenge = async (code: FormDataEntryValue | null, recovery: boolean) => { if (!pendingMfa) throw new Error('لا توجد عملية حساسة بانتظار التحقق.'); await api(`/auth/mfa/challenges/${pendingMfa.challengeId}/${recovery ? 'recovery-verify' : 'verify'}`, 'POST', { code }); let destination = pendingMfa.returnTo; if (pendingMfa.kind === 'verification-decision') await api(`/admin/verifications/${pendingMfa.submissionId}/decision`, 'POST', { outcome: pendingMfa.outcome, publicReason: pendingMfa.publicReason, version: pendingMfa.version, mfaChallengeId: pendingMfa.challengeId }); else if (pendingMfa.kind === 'ownership-transfer') await api(`/orgs/${pendingMfa.organizationId}/ownership-transfers`, 'POST', { targetUserId: pendingMfa.targetUserId, version: pendingMfa.version, mfaChallengeId: pendingMfa.challengeId }); else { const job = await api('/me/data-exports', 'POST', { mfaChallengeId: pendingMfa.challengeId }) as { id: string }; destination = `/app/exports/${job.id}`; } window.sessionStorage.removeItem('tamkeen.mfa-operation'); window.location.assign(L(destination)); };
    content = <><h1>تحقق إضافي للعملية</h1>{pendingMfa ? <><p>العملية: {pendingMfa.kind === 'verification-decision' ? 'تسجيل قرار توثيق' : pendingMfa.kind === 'ownership-transfer' ? 'إرسال طلب نقل ملكية' : 'إنشاء نسخة خاصة من بيانات الحساب'}. صلاحية التحقق خمس دقائق ولا تنفذ العملية إذا تغيرت نسختها.</p><form onSubmit={form(data => finishChallenge(data.get('code'), false))}><Field label="رمز تطبيق المصادقة" name="code" />{submit('تحقق وتابع')}</form><details><summary>استخدام رمز استرداد</summary><form onSubmit={form(data => finishChallenge(data.get('code'), true))}><Field label="رمز الاسترداد" name="code" />{submit('استخدام الرمز')}</form></details><button className="secondary" disabled={busy} onClick={() => void action(async () => { await api(`/auth/mfa/challenges/${pendingMfa.challengeId}/cancel`, 'POST', {}); window.sessionStorage.removeItem('tamkeen.mfa-operation'); window.location.assign(L(pendingMfa.returnTo)); })}>إلغاء العملية</button></> : <p className="status failure">لا توجد عملية حساسة صالحة بانتظار التحقق.</p>}</>;
  } else if (me && route === '/admin/bank-change-requests') {
    content = me.platformRoles.includes('FinanceOperator') ? <><p className="eyebrow">تشغيل مالي</p><h1>مراجعة تغييرات الحساب البنكي</h1><p>لا يصبح الحساب الجديد فعالًا إلا بعد قرار مراجع مستقل وتحقق إضافي. لا تُعرض قيمة IBAN الكاملة في هذه القائمة.</p>{!bankChangeQueue.length && <p>لا توجد طلبات معلقة.</p>}{bankChangeQueue.map(request => <article className="row" key={request.id}><div><strong>{request.organization.displayName}</strong><p>{request.bankName} · {request.accountHolder} · ينتهي بـ{request.accountLast4}</p><p>{request.country} · {request.currency} · مقدم الطلب: {request.requester.name}</p></div>{request.stale ? <p className="status pending">تغيرت بيانات الجهة بعد تقديم الطلب. لا يمكن اتخاذ قرار قبل أن تعيد الجهة تقديم الطلب على النسخة الحالية.</p> : <form onSubmit={form(async data => { const outcome = String(data.get('outcome')) as 'approved' | 'rejected'; const reason = String(data.get('reason') ?? ''); if (outcome === 'rejected' && reason.trim().length < 10) throw new Error('اكتب سبب رفض واضحًا من 10 أحرف على الأقل.'); const challenge = await api(`/admin/bank-change-requests/${request.id}/challenge`, 'POST', { version: request.version }) as { id: string }; await api(`/auth/mfa/challenges/${challenge.id}/verify`, 'POST', { code: data.get('code') }); await api(`/admin/bank-change-requests/${request.id}/decision`, 'POST', { outcome, reason, version: request.version, mfaChallengeId: challenge.id }); setBankChangeQueue(await api('/admin/bank-change-requests')); setNotice(outcome === 'approved' ? 'اعتمد الحساب البنكي وأصبح الحساب الفعال.' : 'رُفض الطلب وبقي الحساب الحالي دون تغيير.'); })}><label className="field">القرار<select name="outcome"><option value="approved">اعتماد</option><option value="rejected">رفض</option></select></label><label className="field">السبب<textarea name="reason" maxLength={1000} rows={3} /></label><Field label="رمز تطبيق المصادقة" name="code" />{submit('تسجيل القرار')}</form>}</article>)}</> : <p className="status failure">تحتاج دور مشغل مالي وMFA مفعّلًا لمراجعة هذه الطلبات.</p>;
  } else if (me && route === '/admin/team') {
    const defaultExpiry = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 16);
    const roleChecks = (selected: string[]) => Object.entries(platformRoleLabels).map(([value, label]) => <label className="check" key={value}><input type="checkbox" name="roles" value={value} defaultChecked={selected.includes(value)} />{label}</label>);
    content = me.platformRoles.includes('PlatformAdmin') && platformTeam ? <><p className="eyebrow">إدارة المنصة</p><h1>فريق التشغيل والمنح</h1><p>كل منحة مؤقتة وصريحة. المدقق لا يجمع دورًا تشغيليًا، والمشغل المالي لا يجمع إدارة المنصة أو مراجعة المخاطر.</p><h2>دعوة موظف</h2><form onSubmit={form(async data => { await api('/admin/team/invitations', 'POST', { email: data.get('email'), roles: data.getAll('roles'), grantExpiresAt: new Date(String(data.get('grantExpiresAt'))).toISOString() }); setPlatformTeam(await api('/admin/team')); setNotice('أُرسلت دعوة وصول مؤقتة إلى البريد المحلي. يجب على المستلم تفعيل MFA قبل القبول.'); })}><Field label="البريد الإلكتروني" name="email" type="email" /><fieldset><legend>منح المنصة</legend>{roleChecks([])}</fieldset><label className="field">انتهاء المنح<input required type="datetime-local" name="grantExpiresAt" defaultValue={defaultExpiry} /></label>{submit('إرسال دعوة الموظف')}</form><h2>الدعوات المعلقة</h2>{!platformTeam.invitations.length && <p>لا توجد دعوات معلقة.</p>}{platformTeam.invitations.map(invitation => <article className="row" key={invitation.id}><div><strong><bdi>{invitation.email}</bdi></strong><p>{invitation.roles.map(role => platformRoleLabels[role] ?? role).join('، ')}</p><p>تنتهي الدعوة {new Date(invitation.expiresAt).toLocaleString('ar')} · المنح {new Date(invitation.grantExpiresAt).toLocaleString('ar')}</p></div></article>)}<h2>الموظفون النشطون</h2>{platformTeam.members.map(member => <article className="row" key={member.user.id}><div><strong>{member.user.name}{member.user.id === me.user.id ? ' · أنت' : ''}</strong><p><bdi>{member.user.email}</bdi></p><p>{member.grants.map(grant => platformRoleLabels[grant.role] ?? grant.role).join('، ')} · {member.user.twoFactorEnabled ? 'MFA مفعّل' : 'MFA غير مفعّل'}</p></div>{member.user.id !== me.user.id && <div className="member-actions"><form key={`${member.user.platformAccessVersion}-${member.grants.map(grant => grant.role).join('-')}`} onSubmit={form(async data => { await api(`/admin/team/${member.user.id}/grants`, 'POST', { roles: data.getAll('roles'), expiresAt: new Date(String(data.get('expiresAt'))).toISOString(), version: member.user.platformAccessVersion }); setPlatformTeam(await api('/admin/team')); setNotice('استُبدلت المنح وأُلغيت جلسات الموظف لإعادة التحقق.'); })}><fieldset><legend>المنح الجديدة</legend>{roleChecks(member.grants.map(grant => grant.role))}</fieldset><label className="field">انتهاء المنح<input required type="datetime-local" name="expiresAt" defaultValue={(member.grants.find(grant => grant.expiresAt)?.expiresAt ?? new Date(Date.now() + 30 * 24 * 3600_000).toISOString()).slice(0, 16)} /></label>{submit('استبدال المنح')}</form><button className="secondary" disabled={busy} onClick={() => { if (window.confirm('إلغاء كل وصول المنصة لهذا الموظف وإنهاء جلساته؟')) void action(async () => { await api(`/admin/team/${member.user.id}/revoke`, 'POST', { version: member.user.platformAccessVersion }); setPlatformTeam(await api('/admin/team')); setNotice('أُلغي وصول الموظف وجلساته.'); }); }}>إلغاء الوصول</button></div>}</article>)}</> : <p className="status failure">تحتاج دور مدير منصة وMFA مفعّلًا لإدارة فريق التشغيل.</p>;
  } else if (me && route.startsWith('/platform-invitations/') && platformInvitation) {
    const token = route.split('/')[2];
    const terminalLabels = { accepted: 'قُبلت الدعوة', revoked: 'أُلغيت الدعوة', expired: 'انتهت الدعوة' } as const;
    content = <><p className="eyebrow">دعوة فريق المنصة</p><h1>وصول تشغيلي مؤقت</h1><p>أرسل الدعوة: {platformInvitation.inviter.name}</p><p>المنح: {platformInvitation.roles.map(role => platformRoleLabels[role] ?? role).join('، ')}</p><p>ينتهي الوصول في {new Date(platformInvitation.grantExpiresAt).toLocaleString('ar')}</p>{platformInvitation.status === 'pending' ? platformInvitation.requiresMfaSetup ? <><p className="status pending">يجب تفعيل التحقق بخطوتين قبل قبول وصول موظف المنصة.</p><a href={L(`/app/settings?returnTo=${encodeURIComponent(route)}`)}>تفعيل التحقق بخطوتين</a></> : <button disabled={busy} onClick={() => void action(async () => { await api(`/platform-invitations/${token}/accept`, 'POST', {}); window.location.assign(L('/app')); })}>قبول الوصول المؤقت</button> : <><p className="status pending">{terminalLabels[platformInvitation.status]}</p><a href={L('/app')}>العودة إلى مساحتي</a></>}</>;
  } else if (me && route === '/admin/verifications') {
    content = me.platformRoles.includes('VerificationReviewer') ? <><h1>قائمة مراجعة التوثيق</h1><p>تظهر الطلبات غير المحسومة المتاحة لك أو المسندة إليك.</p>{!reviewQueue.length && <p>لا توجد طلبات بانتظار المراجعة.</p>}{reviewQueue.map(item => <article className="row" key={item.id}><div><strong>{item.case.organization.displayName}</strong><p>{item.case.organization.type} · {item.case.organization.city} · النسخة {item.sequence}</p><p>{item.case.assignedReviewerId ? 'مسندة إليك' : 'غير مسندة'}</p></div><a href={L(`/admin/verifications/${item.id}`)}>فتح المراجعة</a></article>)}</> : <p className="status failure">لا تملك صلاحية مراجعة التوثيق أو لم تفعّل التحقق بخطوتين.</p>;
  } else if (me && route.startsWith('/admin/verifications/')) {
    content = verificationReview ? <><h1>مراجعة توثيق {verificationReview.case.organization.displayName}</h1><p>{verificationReview.case.organization.legalName} · {verificationReview.case.organization.type} · {verificationReview.case.organization.city}</p><dl><div><dt>رقم التسجيل</dt><dd>{verificationReview.snapshot.registrationNumber ?? '—'}</dd></div><div><dt>جهة الإصدار</dt><dd>{verificationReview.snapshot.issuingAuthority ?? '—'}</dd></div><div><dt>العنوان</dt><dd>{verificationReview.snapshot.registeredAddress ?? '—'}</dd></div></dl><h2>وثائق النسخة</h2>{verificationReview.case.documents.map(document => <article className="row" key={document.id}><div><strong>{document.fileName}</strong><p>{document.contentType} · {document.actualSize ?? 0} bytes</p></div><span>{document.scanState === 'clean' ? 'نظيفة' : document.scanState}</span></article>)}{!verificationReview.case.assignedReviewerId && <button disabled={busy} onClick={() => void action(async () => { await api(`/admin/verifications/${verificationReview.id}/claim`, 'POST', {}); setVerificationReview(await api(`/admin/verifications/${verificationReview.id}`)); setNotice('أُسندت المراجعة إليك.'); })}>استلام المراجعة</button>}{verificationReview.case.assignedReviewerId === me.user.id && !verificationReview.decision && <form onSubmit={form(async data => { const outcome = String(data.get('outcome')) as Extract<PendingMfa, { kind: 'verification-decision' }>['outcome']; const challenge = await api('/auth/mfa/challenges', 'POST', { submissionId: verificationReview.id, version: verificationReview.case.version }) as { id: string }; const pending: PendingMfa = { kind: 'verification-decision', challengeId: challenge.id, submissionId: verificationReview.id, version: verificationReview.case.version, outcome, publicReason: String(data.get('publicReason') ?? ''), returnTo: `/admin/verifications/${verificationReview.id}` }; window.sessionStorage.setItem('tamkeen.mfa-operation', JSON.stringify(pending)); window.location.assign(L(`/mfa/challenge?returnTo=${encodeURIComponent(pending.returnTo)}`)); })}><label className="field">القرار<select name="outcome"><option value="verified">اعتماد</option><option value="changes_requested">طلب تعديل</option><option value="rejected">رفض</option></select></label><label className="field">السبب العام<textarea name="publicReason" maxLength={1000} rows={4} /></label>{submit('متابعة إلى التحقق الإضافي')}</form>}</> : <p>جارٍ تحميل المراجعة…</p>;
  } else if (me && route === '/onboarding') {
    content = <><h1>ملفك الشخصي</h1><p>يمكنك اختيار أكثر من دور. اختيار «مستثمر» لا يمنح أهلية استثمار تلقائية.</p><form onSubmit={form(async data => {
      const profile = await api('/me/profile', 'PATCH', { displayName: data.get('displayName'), city: data.get('city') ?? '', locale: data.get('locale'), capabilities: data.getAll('capabilities'), version: me.profile.version });
      setMe({ ...me, profile }); window.location.assign(L('/app'));
    })}><Field label="اسم العرض" name="displayName" value={me.profile.displayName} /><label className="field">المدينة<input name="city" defaultValue={me.profile.city ?? ''} maxLength={100} /></label><label className="field">لغة الواجهة<select name="locale" defaultValue={me.profile.locale}><option value="ar">العربية</option><option value="en">English</option></select></label><fieldset><legend>كيف ترغب في استخدام تمكين؟</legend>{Object.entries(capabilityLabels).map(([value, label]) => <label className="check" key={value}><input type="checkbox" name="capabilities" value={value} defaultChecked={me.profile.capabilities.includes(value)} />{label}</label>)}</fieldset>{submit('حفظ وابدأ')}</form><a href={L('/app')}>تخطي الاختياري والعودة إلى مساحتي</a></>;
  } else if (me && route === '/app') {
    content = <>
      <PageHeader dashboard eyebrow={t('personalWorkspace')} title={`مرحبًا، ${me.profile.displayName}`} lead="هذه مساحتك الشخصية. جهاتك مستقلة عنها، ولكل جهة صلاحياتها الخاصة، ولا تصبح أموالها أموالك." />
      <Card title="ما التالي؟" id="per01-next">
        <nav className="tmk-inline-links" aria-label="إجراءات سريعة">
          <a href={L('/onboarding')}>إكمال ملفي وأدواري</a>
          {/* PER-01.A01 and A02. Both records are personal and always reachable: neither depends on
              belonging to a jiha, and a screen that exists but cannot be reached is not built. */}
          <a href={L('/app/contributions')}>مساهماتي</a>
          <a href={L('/app/investments')}>محفظة الاستثمار</a>
          <a href={L('/app/settings')}>إعدادات الحساب والأمان</a>
          <a href={L('/app/organizations/new')}>إنشاء جهة</a>
          {me.platformRoles.includes('VerificationReviewer') && <a href={L('/admin/verifications')}>مراجعات التوثيق</a>}
          {me.platformRoles.includes('ContentReviewer') && <a href={L('/admin/reviews/project')}>مراجعة المشاريع</a>}{me.platformRoles.includes('FinanceOperator') && <a href={L('/admin/bank-change-requests')}>مراجعة الحسابات البنكية</a>}
          {me.platformRoles.includes('PlatformAdmin') && <a href={L('/admin/team')}>فريق تشغيل المنصة</a>}
        </nav>
      </Card>
      <Card title="الجهات التي أنتمي إليها" id="per01-contexts">
        {!me.contexts.length
          ? <EmptyState title="لم تنضم إلى جهة بعد" action={<a className="tmk-button tmk-button--primary" href={L('/app/organizations/new')}>أنشئ جهة</a>}>أنشئ جهة لتصبح مالكها، أو اقبل دعوة وصلت إلى بريدك من جهة قائمة.</EmptyState>
          : me.contexts.map(context => <article className="tmk-row" key={context.organization.id}>
              <div>
                <strong>{context.organization.displayName}</strong>
                <p className="tmk-field__hint">{context.roles.map(r => roleLabels[r] ?? r).join('، ')}</p>
              </div>
              <div className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => { await api('/me/context', 'POST', { organizationId: context.organization.id }); window.location.assign(L(`/org/${context.organization.id}`)); })}>فتح مساحة الجهة</button>
              </div>
            </article>)}
      </Card>
      <Card title="أقسام لم تُبنَ بعد" id="per01-pending">
        <p className="tmk-field__hint">تُذكر هنا بأسمائها حتى لا تبحث عنها في مكان آخر. لا يوجد خلفها تنفيذ، فلا تُعرض كأزرار عاملة.</p>
        {PENDING_PERSONAL_SECTIONS.map(section => <UnavailableAction key={section.id} id={section.id} label={section.label} note={section.note} />)}
      </Card>
    </>;
  } else if (me && route === '/app/organizations/new') {
    content = <><h1>أنشئ جهة</h1><p>ستصبح المالك والمفوض الأول. تبقى الجهة غير موثقة حتى إكمال مسار التوثيق.</p><form id="organization-create" key={JSON.stringify(organizationDraft)} onSubmit={form(async data => {
      const created = await api('/orgs', 'POST', { legalName: data.get('legalName'), displayName: data.get('displayName'), city: data.get('city'), country: data.get('country'), type: data.get('type') }); window.localStorage.removeItem('tamkeen.organization-draft'); window.location.assign(L(`/org/${created.id}`));
    })}><Field label="الاسم القانوني" name="legalName" value={organizationDraft.legalName ?? ''} /><Field label="اسم العرض" name="displayName" value={organizationDraft.displayName ?? ''} /><Field label="المدينة" name="city" value={organizationDraft.city ?? ''} /><label className="field">البلد<select name="country" defaultValue={organizationDraft.country ?? 'PS'}><option value="PS">فلسطين</option><option value="JO">الأردن</option></select></label><label className="field">نوع الجهة<select name="type" defaultValue={organizationDraft.type ?? 'NGO'}><option value="NGO">جمعية / منظمة أهلية</option><option value="Company">شركة</option><option value="Startup">شركة ناشئة</option><option value="Foundation">مؤسسة مانحة</option><option value="Institution">جهة حكومية / مؤسسية</option></select></label>{submit('إنشاء الجهة')}<button type="button" className="secondary" disabled={busy} onClick={() => { const element = document.getElementById('organization-create'); if (!(element instanceof HTMLFormElement)) return; const data = new FormData(element); const draft = Object.fromEntries(['legalName', 'displayName', 'city', 'country', 'type'].map(name => [name, String(data.get(name) ?? '')])); window.localStorage.setItem('tamkeen.organization-draft', JSON.stringify(draft)); setNotice('حُفظت المسودة على هذا الجهاز فقط، ولم تُنشأ الجهة بعد.'); }}>حفظ بيانات أولية</button></form></>;
  } else if (me && org) {
    const context = me.contexts.find(c => c.organization.id === org.id);
    const canInvite = context?.permissions.includes('member.invite');
    const canManageMembers = context?.permissions.includes('member.role.update');
    const canManageOrganization = context?.permissions.includes('organization.manage');
    const canTransferOwnership = context?.roles.includes('Owner') ?? false;
    const canManageBank = context?.permissions.includes('bank.manage') ?? false;
    const settingsContent = route.endsWith('/settings') && canManageOrganization ? <><h2>ملف الجهة</h2>{org.logoUrl && <img className="organization-logo" src={org.logoUrl} alt={`شعار ${org.displayName}`} />}<form onSubmit={form(async data => { const candidate = data.get('logo'); if (!(candidate instanceof File) || candidate.size === 0) throw new Error('اختر شعارًا بصيغة PNG أو JPEG.'); const intent = await api(`/orgs/${org.id}/logo/upload-intents`, 'POST', { fileName: candidate.name, contentType: candidate.type, size: candidate.size, version: org.version }) as VerificationUploadIntent; await verificationFileRequest(intent.uploadPath, 'PUT', intent.token, candidate); const finalized = await verificationFileRequest(intent.finalizePath, 'POST', intent.token) as { scanState: string }; if (finalized.scanState !== 'clean') throw new Error('رُفض الشعار بسبب نوع الملف أو أبعاده أو محتواه.'); setOrg(await api(`/orgs/${org.id}`)); setPublicPreview(null); setNotice('رُفع الشعار وأصبح ظاهرًا في الملف العام.'); })}><label className="field">شعار الجهة — PNG أو JPEG حتى 10MB<input required type="file" name="logo" accept="image/png,image/jpeg" /></label>{submit(org.logoUrl ? 'استبدال الشعار' : 'رفع الشعار')}</form><form onSubmit={form(async data => {
      const updated = await api(`/orgs/${org.id}`, 'PATCH', { displayName: data.get('displayName'), legalName: data.get('legalName'), slug: data.get('slug'), publicDescription: data.get('publicDescription'), sectors: String(data.get('sectors') ?? '').split('،').map(value => value.trim()).filter(Boolean), contactEmail: data.get('contactEmail'), websiteUrl: data.get('websiteUrl'), contactAddress: data.get('contactAddress'), city: data.get('city'), country: data.get('country'), version: org.version });
      setOrg(updated); setPublicPreview(null); setNotice('حُفظت إعدادات الجهة. تغيير الاسم القانوني لجهة موثقة يطلب إعادة التوثيق.');
    })}><Field label="اسم العرض" name="displayName" value={org.displayName} /><Field label="الاسم القانوني" name="legalName" value={org.legalName} /><Field label="الرابط العام" name="slug" value={org.slug} /><label className="field">الوصف العام<textarea name="publicDescription" defaultValue={org.publicDescription} maxLength={1200} rows={5} /></label><Field label="القطاعات — افصل بينها بالفاصلة العربية (،)" name="sectors" value={org.sectors.join('، ')} /><Field label="بريد التواصل" name="contactEmail" type="email" value={org.contactEmail ?? ''} /><Field label="الموقع الإلكتروني" name="websiteUrl" type="url" value={org.websiteUrl ?? ''} /><label className="field">عنوان التواصل<textarea name="contactAddress" defaultValue={org.contactAddress ?? ''} maxLength={300} rows={3} /></label><Field label="المدينة" name="city" value={org.city} /><label className="field">البلد<select name="country" defaultValue={org.country}><option value="PS">فلسطين</option><option value="JO">الأردن</option></select></label>{submit('حفظ الإعدادات')}</form><button type="button" className="secondary" disabled={busy} onClick={() => void action(async () => setPublicPreview(await api(`/orgs/${org.id}/public-preview`)))}>معاينة الملف العام</button>{publicPreview && <article className="public-preview"><p className="eyebrow">معاينة عامة · /organizations/{publicPreview.slug}</p>{publicPreview.logoUrl && <img className="organization-logo" src={publicPreview.logoUrl} alt={`شعار ${publicPreview.displayName}`} />}<h2>{publicPreview.displayName}</h2><p>{publicPreview.publicDescription || 'لم يضف وصف عام بعد.'}</p><p>{publicPreview.sectors.join('، ') || 'لا توجد قطاعات معلنة'} · {publicPreview.city} · {publicPreview.country} · {publicPreview.type}</p>{publicPreview.websiteUrl && <p><a href={publicPreview.websiteUrl} target="_blank" rel="noreferrer">الموقع الإلكتروني</a></p>}<p>حالة التوثيق: {publicPreview.verification === 'verified' ? 'موثقة' : 'غير موثقة'}</p></article>}</> : null;
    const ownershipContent = route.endsWith('/settings') && canTransferOwnership ? <><h2>نقل ملكية الجهة</h2><p className="note">يتطلب النقل تحققًا إضافيًا وقبول العضو الجديد خلال 48 ساعة. تبقى أنت المالك حتى القبول، وبعده تصبح مدير جهة وتُنهى جلسات الطرفين لإعادة تحميل الصلاحيات.</p>{me.user.twoFactorEnabled ? <form onSubmit={form(async data => { const targetUserId = String(data.get('targetUserId') ?? ''); const target = members.find(member => member.userId === targetUserId); if (!target || !window.confirm(`إرسال طلب نقل ملكية ${org.displayName} إلى ${target.user.name}؟`)) return; const challenge = await api(`/orgs/${org.id}/ownership-transfers/challenge`, 'POST', { version: org.version }) as { id: string }; const pending: PendingMfa = { kind: 'ownership-transfer', challengeId: challenge.id, organizationId: org.id, targetUserId, version: org.version, returnTo: `/org/${org.id}/settings` }; window.sessionStorage.setItem('tamkeen.mfa-operation', JSON.stringify(pending)); window.location.assign(L(`/mfa/challenge?returnTo=${encodeURIComponent(pending.returnTo)}`)); })}><label className="field">المالك الجديد<select required name="targetUserId" defaultValue=""><option value="" disabled>اختر عضوًا نشطًا</option>{members.filter(member => member.userId !== me.user.id && member.status === 'active' && !member.roles.includes('Owner')).map(member => <option key={member.userId} value={member.userId}>{member.user.name} · {member.user.email}</option>)}</select></label>{submit('بدء نقل الملكية')}</form> : <p><a href={`/app/settings?returnTo=${encodeURIComponent(`/org/${org.id}/settings`)}`}>فعّل التحقق بخطوتين أولًا</a></p>}</> : null;
    const bankStateLabel = { pending: 'بانتظار مراجعة مستقلة', approved: 'معتمد', rejected: 'مرفوض' };
    const pendingBankRequest = bankSettings?.requests.find(request => request.state === 'pending') ?? null;
    // The second factor is collected in this same form: the IBAN never reaches browser storage.
    const bankContent = route.endsWith('/settings') && canManageBank && bankSettings ? <><h2>الحساب البنكي</h2><p className="note">طلب التغيير لا يبدّل الحساب الفعال. يلزم تحقق إضافي الآن، ثم اعتماد مشغل مالي مستقل عن مقدم الطلب. بعد الحفظ تُعرض آخر أربعة أرقام فقط.</p>{bankSettings.activeAccount ? <article className="row"><div><strong>{bankSettings.activeAccount.bankName}</strong><p>{bankSettings.activeAccount.accountHolder} · ينتهي بـ<bdi>{bankSettings.activeAccount.accountLast4}</bdi></p><p>{bankSettings.activeAccount.country} · {bankSettings.activeAccount.currency}</p></div><span>الحساب الفعال منذ {new Date(bankSettings.activeAccount.updatedAt).toLocaleDateString('ar')}</span></article> : <p className="status pending">لا يوجد حساب بنكي معتمد بعد. لا يمكن طلب صرف قبل اعتماد حساب.</p>}{pendingBankRequest && <p className="status pending">يوجد طلب معلق ينتهي بـ<bdi>{pendingBankRequest.accountLast4}</bdi>. لا يمكن إرسال طلب جديد قبل صدور قراره.</p>}{!me.user.twoFactorEnabled ? <p><a href={`/app/settings?returnTo=${encodeURIComponent(`/org/${org.id}/settings`)}`}>فعّل التحقق بخطوتين أولًا</a></p> : pendingBankRequest ? null : <form onSubmit={form(async data => {
      const challenge = await api(`/orgs/${org.id}/bank-change-requests/challenge`, 'POST', { version: org.version }) as { id: string };
      await api(`/auth/mfa/challenges/${challenge.id}/verify`, 'POST', { code: data.get('code') });
      await api(`/orgs/${org.id}/bank-change-requests`, 'POST', { bankName: data.get('bankName'), accountHolder: data.get('accountHolder'), iban: data.get('iban'), country: data.get('country'), currency: data.get('currency'), version: org.version, mfaChallengeId: challenge.id });
      setBankSettings(await api(`/orgs/${org.id}/bank-settings`)); setNotice('أُرسل طلب تغيير الحساب البنكي. يبقى الحساب الحالي فعالًا حتى يعتمد مشغل مالي مستقل الطلب.');
    })}><Field label="اسم البنك" name="bankName" /><Field label="اسم صاحب الحساب" name="accountHolder" /><Field label="رقم الحساب الدولي IBAN" name="iban" /><label className="field">البلد<select name="country" defaultValue={org.country}><option value="PS">فلسطين</option><option value="JO">الأردن</option></select></label><label className="field">العملة<select name="currency" defaultValue="ILS"><option value="ILS">شيكل ILS</option><option value="JOD">دينار JOD</option><option value="USD">دولار USD</option></select></label><Field label="رمز تطبيق المصادقة" name="code" />{submit('إرسال طلب التغيير للمراجعة')}</form>}{bankSettings.requests.length > 0 && <><h3>سجل الطلبات</h3>{bankSettings.requests.map(request => <article className="row" key={request.id}><div><strong>{request.bankName} · ينتهي بـ<bdi>{request.accountLast4}</bdi></strong><p>{new Date(request.createdAt).toLocaleDateString('ar')} · {bankStateLabel[request.state]}</p>{request.reviewReason && <p>{request.reviewReason}</p>}</div></article>)}</>}</> : null;
    const cleanDocuments = verificationCase?.documents.filter(document => document.scanState === 'clean') ?? [];
    const verificationContent = verificationCase && canManageOrganization ? <><h2>بيانات توثيق الجهة</h2><p>احفظ المسودة أولًا. لا يمكن الإرسال حتى توجد وثيقة واحدة على الأقل اجتازت فحص الملفات.</p><form key={verificationCase.version} onSubmit={form(async data => {
      await api(`/orgs/${org.id}/verification`, 'PATCH', { registrationNumber: data.get('registrationNumber'), issuingAuthority: data.get('issuingAuthority'), registeredAddress: data.get('registeredAddress'), documentExpiresAt: data.get('documentExpiresAt'), version: verificationCase.version });
      setVerificationCase(await api(`/orgs/${org.id}/verification`)); setNotice('حُفظت مسودة التوثيق.');
    })}><Field label="رقم التسجيل" name="registrationNumber" value={verificationCase.registrationNumber} /><Field label="جهة الإصدار" name="issuingAuthority" value={verificationCase.issuingAuthority} /><label className="field">العنوان المسجل<textarea name="registeredAddress" defaultValue={verificationCase.registeredAddress} maxLength={300} rows={3} /></label><Field label="صلاحية الوثيقة" name="documentExpiresAt" type="date" value={verificationCase.documentExpiresAt?.slice(0, 10) ?? ''} />{submit('حفظ المسودة')}</form><h2>الوثائق</h2>{verificationCase.version > 0 && ['not_started', 'changes_requested'].includes(verificationCase.state) && <form onSubmit={form(async data => { const candidate = data.get('document'); if (!(candidate instanceof File) || candidate.size === 0) throw new Error('اختر ملف PDF أو PNG أو JPEG.'); const intent = await api(`/orgs/${org.id}/verification/documents/upload-intents`, 'POST', { fileName: candidate.name, contentType: candidate.type, size: candidate.size, version: verificationCase.version }) as VerificationUploadIntent; await verificationFileRequest(intent.uploadPath, 'PUT', intent.token, candidate); const finalized = await verificationFileRequest(intent.finalizePath, 'POST', intent.token) as { scanState: string }; setVerificationCase(await api(`/orgs/${org.id}/verification`)); setNotice(finalized.scanState === 'clean' ? 'رُفعت الوثيقة واجتازت الفحص المحلي.' : 'رُفعت الوثيقة لكنها رُفضت بسبب نوعها أو محتواها.'); })}><label className="field">وثيقة التسجيل — PDF حتى 20MB أو PNG/JPEG حتى 10MB<input required type="file" name="document" accept="application/pdf,image/png,image/jpeg" /></label>{submit('رفع الوثيقة وفحصها')}</form>}{!verificationCase.documents.length && <p className="status pending">لم تُرفع وثائق بعد.</p>}{verificationCase.documents.map(document => <article className="row" key={document.id}><strong>{document.fileName}</strong><span>{document.scanState === 'clean' ? 'اجتازت الفحص' : document.scanState === 'rejected' ? `مرفوضة${document.scanReason ? ` · ${document.scanReason}` : ''}` : 'بانتظار اكتمال الرفع والفحص'}</span></article>)}<button type="button" disabled={busy || cleanDocuments.length === 0 || !['not_started', 'changes_requested'].includes(verificationCase.state)} onClick={() => void action(async () => { await api(`/orgs/${org.id}/verification/submissions`, 'POST', { version: verificationCase.version }); setVerificationCase(await api(`/orgs/${org.id}/verification`)); setNotice('أُرسلت نسخة التوثيق للمراجعة.'); })}>إرسال للمراجعة</button><h2>سجل الإرسال والقرارات</h2>{!verificationCase.submissions.length && <p>لم ترسل نسخة للمراجعة بعد.</p>}{verificationCase.submissions.map(submission => <p key={submission.id}>النسخة {submission.sequence} · {new Date(submission.submittedAt).toLocaleDateString('ar')}</p>)}{verificationDecisions.map(decision => <article className="status pending" key={decision.id}><strong>قرار النسخة {decision.submission.sequence}: {decision.outcome}</strong><p>{decision.publicReason || 'لا توجد ملاحظة عامة.'}</p></article>)}</> : null;
    const verificationLabel = org.verification === 'verified' ? 'موثقة' : org.verification === 'changes_requested' ? 'تحتاج إعادة توثيق' : 'لم يتم التوثيق بعد';
    if (route.endsWith('/settings')) content = <><p className="eyebrow">مساحة الجهة · {org.city}</p><h1>{org.displayName}</h1><p>حالة التوثيق: {verificationLabel}.</p><nav className="inline-links"><a href={L(`/org/${org.id}`)}>العودة إلى لوحة الجهة</a></nav>{settingsContent}{bankContent}{ownershipContent}</>;
    else if (route.endsWith('/verification')) content = <><p className="eyebrow">مساحة الجهة · {org.city}</p><h1>{org.displayName}</h1><p>حالة التوثيق: {verificationLabel}.</p><nav className="inline-links"><a href={L(`/org/${org.id}`)}>العودة إلى لوحة الجهة</a></nav>{verificationContent}</>;
    else content = <><p className="eyebrow">مساحة الجهة · {org.city}</p><h1>{org.displayName}</h1><p>حالة التوثيق: {verificationLabel}. لا توجد صلاحيات مالية ضمنية في حساب المالك.</p><nav className="inline-links"><a href={L('/app')}>العودة لمساحتي</a>{canManageOrganization && <a href={L(`/org/${org.id}/settings`)}>إعدادات الجهة</a>}{context?.permissions.includes('member.read') && <a href={L(`/org/${org.id}/team`)}>الفريق والصلاحيات</a>}</nav>{route.endsWith('/team') && <><h2>أعضاء الفريق</h2>{members.map(member => <article className="row" key={member.id}><div><strong>{member.user.name}</strong><p><bdi>{member.user.email}</bdi></p><p>{member.roles.map(r => roleLabels[r] ?? r).join('، ')} · {member.status === 'active' ? 'نشط' : 'موقوف'}</p></div>{canManageMembers && !member.roles.includes('Owner') && member.userId !== me.user.id && member.status === 'active' && <div className="member-actions"><form onSubmit={form(async data => { await api(`/orgs/${org.id}/members/${member.userId}`, 'PATCH', { roles: [data.get('role')], status: 'active', version: member.version }); setMembers(await api(`/orgs/${org.id}/members`)); setNotice('حُدّث دور العضو.'); })}><label className="field">الدور<select name="role" defaultValue={member.roles[0]}><option value="Viewer">قراءة</option><option value="ProjectManager">إدارة المشاريع</option><option value="OrgAdmin">إدارة الجهة</option></select></label>{submit('تحديث الدور')}</form><button disabled={busy} className="secondary" onClick={() => { if (window.confirm('إيقاف العضوية وسحب وصول هذا العضو؟')) void action(async () => { await api(`/orgs/${org.id}/members/${member.userId}`, 'PATCH', { roles: member.roles, status: 'suspended', version: member.version }); setMembers(await api(`/orgs/${org.id}/members`)); setNotice('أُوقفت العضوية وأُلغيت جلسات العضو.'); }); }}>إيقاف العضوية</button></div>}</article>)}{canInvite && <><h2>دعوة عضو</h2><form onSubmit={form(async data => { await api(`/orgs/${org.id}/invitations`, 'POST', { email: data.get('email'), roles: [data.get('role')] }); setInvitations(await api(`/orgs/${org.id}/invitations`)); setNotice('أُنشئت الدعوة ووُضعت في البريد المحلي للمستلم.'); })}><Field label="بريد العضو" name="email" type="email" /><label className="field">الدور<select name="role"><option value="Viewer">قراءة</option><option value="ProjectManager">إدارة المشاريع</option><option value="OrgAdmin">إدارة الجهة</option></select></label>{submit('إرسال دعوة')}</form><h2>الدعوات</h2>{!invitations.length && <p>لا توجد دعوات بعد.</p>}{invitations.map(invitation => { const pending = !invitation.consumedAt && !invitation.revokedAt && !invitation.declinedAt && new Date(invitation.expiresAt) > new Date(); return <article className="row" key={invitation.id}><div><strong><bdi>{invitation.email}</bdi></strong><p>{invitation.roles.map(r => roleLabels[r] ?? r).join('، ')} · {invitation.consumedAt ? 'مقبولة' : invitation.revokedAt ? 'ملغاة' : invitation.declinedAt ? 'مرفوضة من المدعو' : pending ? 'بانتظار القبول' : 'منتهية'}</p></div>{pending && <button type="button" className="secondary" disabled={busy} onClick={() => void action(async () => { await api(`/orgs/${org.id}/invitations/${invitation.id}/revoke`, 'POST', {}); setInvitations(await api(`/orgs/${org.id}/invitations`)); setNotice('أُلغيت الدعوة.'); })}>إلغاء الدعوة</button>}</article>; })}</>}</>}</>;
    if (route === `/org/${org.id}` && canManageOrganization) content = <>{content}<nav className="inline-links"><a href={L(`/org/${org.id}/verification`)}>متابعة توثيق الجهة</a></nav></>;
  } else if (me && route.startsWith('/ownership-transfers/') && ownershipTransfer) {
    const token = route.split('/')[2];
    content = <><p className="eyebrow">نقل ملكية جهة</p><h1>{ownershipTransfer.organization.displayName}</h1><p>{ownershipTransfer.organization.type} · {ownershipTransfer.organization.city} · {ownershipTransfer.organization.country}</p><p>المالك الحالي: {ownershipTransfer.currentOwner.name}</p><p>ينتهي الطلب في {new Date(ownershipTransfer.expiresAt).toLocaleString('ar')}</p>{ownershipTransfer.status === 'pending' ? ownershipTransfer.requiresMfaSetup ? <><p className="status pending">فعّل التحقق بخطوتين قبل قبول مسؤولية الملكية.</p><a href={L(`/app/settings?returnTo=${encodeURIComponent(route)}`)}>تفعيل التحقق بخطوتين</a></> : <><p className="note">بالقبول تصبح مالك الجهة وتنتقل للمالك السابق صلاحية مدير جهة. ستنتهي جلساتكما لإعادة تحميل الصلاحيات.</p><button disabled={busy} onClick={() => { if (window.confirm(`قبول ملكية ${ownershipTransfer.organization.displayName}؟`)) void action(async () => { await api(`/ownership-transfers/${token}/accept`, 'POST', {}); window.location.assign(L('/login')); }); }}>قبول نقل الملكية</button></> : <><p className="status pending">{ownershipTransfer.status === 'accepted' ? 'اكتمل نقل الملكية.' : 'انتهت صلاحية طلب النقل.'}</p><a href={L('/app')}>العودة إلى مساحتي</a></>}</>;
  } else if (me && route.startsWith('/invitations/') && invitationPreview) {
    const token = route.split('/')[2];
    const statusLabels = { accepted: 'قُبلت الدعوة', declined: 'رفضت الدعوة', revoked: 'ألغت الجهة الدعوة', expired: 'انتهت صلاحية الدعوة' } as const;
    content = <><p className="eyebrow">دعوة عضوية</p><h1>{invitationPreview.organization.displayName}</h1><p>{invitationPreview.organization.type} · {invitationPreview.organization.city} · {invitationPreview.organization.country}</p><p>أرسل الدعوة: {invitationPreview.inviter.name}</p><p>الدور المطلوب: {invitationPreview.roles.map(role => roleLabels[role] ?? role).join('، ')}</p><p>صالحة حتى {new Date(invitationPreview.expiresAt).toLocaleString('ar')}</p>{invitationPreview.status === 'pending' ? <><p>سيظهر وصول الجهة في مساحتك بعد القبول. يمكنك رفض الدعوة دون إنشاء أي عضوية.</p><div className="member-actions"><button disabled={busy} onClick={() => void action(async () => { await api(`/invitations/${token}/accept`, 'POST', {}); window.location.assign(L('/app')); })}>قبول الدعوة</button><button className="secondary" disabled={busy} onClick={() => { if (window.confirm('رفض الدعوة؟ لن تُنشأ عضوية في الجهة.')) void action(async () => { await api(`/invitations/${token}/decline`, 'POST', {}); setInvitationPreview({ ...invitationPreview, status: 'declined' }); setNotice('رُفضت الدعوة ولم تُنشأ عضوية.'); }); }}>رفض الدعوة</button></div></> : <><p className="status pending">{statusLabels[invitationPreview.status]}</p><a href={L('/app')}>العودة إلى مساحتي</a></>}</>;
  }

  const contexts = me?.contexts.map(context => ({
    id: context.organization.id,
    name: context.organization.displayName,
    kind: roleLabels[context.roles[0] ?? ''] ?? context.roles[0] ?? '',
    href: L(`/org/${context.organization.id}`),
    current: route.startsWith(`/org/${context.organization.id}`)
  })) ?? [];
  const activeContext = contexts.find(context => context.current);

  return <AppShell
    locale={locale}
    path={route}
    signedIn={Boolean(me)}
    {...(activeContext ? { activeContextName: activeContext.name } : {})}
    {...(contexts.length ? { contexts } : {})}
    userActions={<>
      <a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>
      <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => { await api('/auth/sign-out', 'POST', {}); window.location.assign(L('/login')); })}>{t('signOut')}</button>
    </>}
  >
    <div aria-busy={busy || loading}>
      {/* A failure takes focus so a keyboard or screen-reader user is not left on a stale form. */}
      {error && <div ref={errorRef} tabIndex={-1}><Notice tone="danger" live="assertive">{error}</Notice></div>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {loading ? <Skeleton lines={4} label={t('loading')} /> : content}
      {!loading && !publicPage && !me && <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L(`/login?returnTo=${encodeURIComponent(safeReturnTo(route))}`)}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>}
    </div>
  </AppShell>;
}
