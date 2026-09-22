'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BadgeCheck, Ban, Building2, Eye, EyeOff, ImagePlus, Loader2, Mail, Pencil, Search, ShieldCheck, UserCheck, UserRound, X } from 'lucide-react';
import { AppShell, EmptyState, Notice, PageHeader, Skeleton, StatusBadge, formatDate, localePath, type Locale } from '@tamkeen/ui';
import { Field } from './site-admin-screens';

/**
 * ADM directory: every organisation and every account on the platform, for the platform admin.
 *
 * Organisations can be corrected, given a new logo, approved or have approval withdrawn, hidden
 * from or shown in the public directory, and suspended. Accounts can be looked up and suspended or
 * reactivated. The API re-checks the admin grant on every call; nothing here is trusted.
 */

const ERRORS: Record<string, string> = {
  conflict: 'تغيّر هذا السجل من مكان آخر، أو أن العملية ستترك المنصة بلا مدير نشط. حدّث الصفحة ثم أعد المحاولة.',
  invalid_input: 'راجع الحقول. الموقع يبدأ بـ https://، والشعار PNG أو JPEG حتى 2MB.',
  forbidden: 'لا يمكن تنفيذ هذا: الصفحة لمدير المنصة فقط، ولا يمكنك إيقاف حسابك أنت.',
  not_found: 'السجل غير موجود.'
};

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(ERRORS[result.error?.code] ?? (response.status === 401 ? 'سجّل الدخول بحساب مدير المنصة.' : 'تعذر تنفيذ العملية.'));
  return result.data as T;
}

type Run = (work: () => Promise<string | void>) => Promise<void>;

function useRunner() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useCallback<Run>(async work => {
    setError(''); setNotice('');
    try { const done = await work(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
  }, []);
  const banner = <>{error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}{notice ? <Notice tone="success">{notice}</Notice> : null}</>;
  return { run, banner };
}

export function DirectoryAdmin({ locale, mode }: { locale: Locale; mode: 'organizations' | 'users' }) {
  const { run, banner } = useRunner();
  return (
    <AppShell locale={locale} path={mode === 'users' ? '/admin/users' : '/admin/organizations'} signedIn
      userActions={<a className="tmk-button tmk-button--quiet" href={localePath(locale, '/app')}>لوحتي</a>}>
      {banner}
      {mode === 'organizations' ? <Organizations run={run} locale={locale} /> : <Users run={run} locale={locale} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------- organisations

interface Org {
  id: string; slug: string; displayName: string; legalName: string; type: string; city: string; country: string;
  publicDescription: string; sectors: string[]; websiteUrl: string | null; contactEmail: string | null; contactAddress: string | null;
  verification: string; publiclyListed: boolean; status: 'active' | 'suspended' | 'closed'; version: number; logoUrl: string | null; createdAt: string;
  counts: { members: number; projects: number; offerings: number; programs: number; jobs: number };
}

const TYPES: Record<string, string> = { NGO: 'جمعية أهلية', Company: 'شركة', Startup: 'شركة ناشئة', Foundation: 'مؤسسة', Institution: 'مؤسسة رسمية' };

function Organizations({ run, locale }: { run: Run; locale: Locale }) {
  const [rows, setRows] = useState<Org[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'listed' | 'hidden' | 'verified' | 'suspended'>('all');
  const [editing, setEditing] = useState<Org | null>(null);
  const load = useCallback(async () => setRows(await call<Org[]>('/admin/organizations')), []);
  useEffect(() => { void run(load); }, [run, load]);

  const patch = (org: Org, changes: Record<string, unknown>, message: string) => run(async () => {
    await call(`/admin/organizations/${org.id}`, 'PATCH', { version: org.version, ...changes }); await load(); return message;
  });
  const needle = query.trim().toLowerCase();
  const shown = (rows ?? []).filter(org =>
    (!needle || `${org.displayName} ${org.legalName} ${org.slug} ${org.city}`.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'listed' && org.publiclyListed) || (filter === 'hidden' && !org.publiclyListed)
      || (filter === 'verified' && org.verification === 'verified') || (filter === 'suspended' && org.status !== 'active')));
  const count = (test: (org: Org) => boolean) => (rows ?? []).filter(test).length;

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة المنصة" title="الجهات"
        lead="كل جهة على المنصة. عدّل بياناتها العامة وشعارها، واعتمدها أو اسحب اعتمادها، وأظهرها في دليل الجهات العام أو أخفها، أو أوقفها." />
      <div className="tmk-admin-toolbar">
        <label className="tmk-admin-search">
          <Search aria-hidden="true" size={18} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو المدينة" aria-label="بحث في الجهات" />
        </label>
        <nav className="tmk-pills" aria-label="تصفية الجهات">
          {([['all', 'الكل', () => true], ['listed', 'ظاهرة للزوار', (org: Org) => org.publiclyListed], ['hidden', 'مخفية', (org: Org) => !org.publiclyListed], ['verified', 'موثقة', (org: Org) => org.verification === 'verified'], ['suspended', 'موقوفة', (org: Org) => org.status !== 'active']] as const).map(([key, label, test]) => (
            <button key={key} type="button" className="tmk-pill" aria-current={filter === key ? 'true' : undefined} onClick={() => setFilter(key)}>{label}<span className="tmk-pill__count">{count(test)}</span></button>
          ))}
        </nav>
      </div>
      {!rows ? <Skeleton lines={6} label="جارٍ التحميل" /> : shown.length === 0 ? <EmptyState title="لا جهات مطابقة" /> : (
        <div className="tmk-org-grid">
          {shown.map(org => (
            <article className="tmk-org-card tmk-admin-org" key={org.id} data-hidden={org.publiclyListed ? undefined : 'true'}>
              <div className="tmk-org-card__link">
                <span className="tmk-org-logo" style={{ inlineSize: 72, blockSize: 72 }} aria-hidden="true">
                  {org.logoUrl ? <img src={org.logoUrl} alt="" loading="lazy" /> : <span>{org.displayName.trim()[0] ?? '?'}</span>}
                </span>
                <span className="tmk-org-card__body">
                  <span className="tmk-org-card__type">{TYPES[org.type] ?? org.type} · {org.city}</span>
                  <strong className="tmk-org-card__name">{org.displayName}</strong>
                  <span className="tmk-admin-org__badges">
                    {org.verification === 'verified' ? <StatusBadge tone="success">موثقة</StatusBadge> : <StatusBadge tone="neutral">غير موثقة</StatusBadge>}
                    {org.publiclyListed ? <StatusBadge tone="info">ظاهرة</StatusBadge> : <StatusBadge tone="neutral">مخفية</StatusBadge>}
                    {org.status !== 'active' ? <StatusBadge tone="danger">موقوفة</StatusBadge> : null}
                  </span>
                </span>
              </div>
              <p className="tmk-admin-org__counts">
                <span><strong>{org.counts.members}</strong> عضو</span>
                <span><strong>{org.counts.projects}</strong> مشروع</span>
                <span><strong>{org.counts.offerings}</strong> عرض</span>
                <span><strong>{org.counts.programs + org.counts.jobs}</strong> فرصة</span>
              </p>
              <div className="tmk-admin-card__actions">
                <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setEditing(org)}><Pencil aria-hidden="true" size={16} />تعديل</button>
                {org.verification === 'verified'
                  ? <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void patch(org, { approved: false }, `سُحب اعتماد «${org.displayName}».`)}><ShieldCheck aria-hidden="true" size={16} />سحب الاعتماد</button>
                  : <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void patch(org, { approved: true }, `اعتُمدت «${org.displayName}» وظهرت بشارة «موثقة».`)}><BadgeCheck aria-hidden="true" size={16} />اعتماد</button>}
                <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void patch(org, { publiclyListed: !org.publiclyListed }, org.publiclyListed ? `أُخفيت «${org.displayName}» من دليل الجهات.` : `ظهرت «${org.displayName}» في دليل الجهات.`)}>
                  {org.publiclyListed ? <><EyeOff aria-hidden="true" size={16} />إخفاء</> : <><Eye aria-hidden="true" size={16} />إظهار</>}
                </button>
                {org.status === 'active'
                  ? <button type="button" className="tmk-button tmk-button--quiet tmk-admin-card__delete" onClick={() => void patch(org, { status: 'suspended' }, `أُوقفت «${org.displayName}»؛ لن تظهر مشاريعها وفرصها للزوار.`)}><Ban aria-hidden="true" size={16} />إيقاف</button>
                  : org.status === 'suspended' ? <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void patch(org, { status: 'active' }, `أُعيد تفعيل «${org.displayName}».`)}><UserCheck aria-hidden="true" size={16} />تفعيل</button> : null}
                <a className="tmk-button tmk-button--quiet" href={localePath(locale, `/organizations/${org.slug}`)} target="_blank" rel="noreferrer" aria-label={`صفحة ${org.displayName} العامة`}><Building2 aria-hidden="true" size={16} /></a>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing ? <OrgDialog key={`${editing.id}-${editing.version}`} org={editing} onClose={() => setEditing(null)} onDone={async message => { setEditing(null); await run(async () => { await load(); return message; }); }} /> : null}
    </>
  );
}

function OrgDialog({ org, onClose, onDone }: { org: Org; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState(org);
  const [logo, setLogo] = useState(org.logoUrl);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    // No cleanup: closing here would fire a close event that reads as the admin cancelling.
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('الشعار يجب أن يكون PNG أو JPEG.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('الشعار أكبر من 2MB.'); return; }
    setError('');
    const local = URL.createObjectURL(file);
    const before = logo;
    setLogo(local); setUploading(true);
    fetch(`/api/v1/admin/organizations/${org.id}/logo`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type }, body: file })
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(ERRORS[result.error?.code] ?? 'تعذر رفع الشعار.');
        const updated = result.data as Org;
        setCurrent(updated); setLogo(`${updated.logoUrl}?v=${updated.version}`);
      })
      .catch(e => { setLogo(before); setError(e instanceof Error ? e.message : 'تعذر رفع الشعار.'); })
      .finally(() => { setUploading(false); URL.revokeObjectURL(local); });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    setBusy(true); setError('');
    call(`/admin/organizations/${org.id}`, 'PATCH', {
      version: current.version,
      displayName: value('displayName'), publicDescription: value('publicDescription'), type: value('type'),
      city: value('city'), country: value('country').toUpperCase(),
      sectors: value('sectors').split(/[،,]/).map(entry => entry.trim()).filter(Boolean).slice(0, 8),
      websiteUrl: value('websiteUrl'), contactEmail: value('contactEmail'), contactAddress: value('contactAddress')
    }).then(() => onDone(`حُفظت بيانات «${value('displayName')}».`))
      .catch(e => { setError(e instanceof Error ? e.message : 'تعذر الحفظ.'); setBusy(false); });
  };

  return (
    <dialog ref={dialog} className="tmk-dialog tmk-editor" aria-labelledby="tmk-org-title" onClose={onClose} onCancel={() => onClose()}>
      <form onSubmit={save} className="tmk-editor__form">
        <header className="tmk-editor__head">
          <div>
            <p className="tmk-editor__eyebrow">{TYPES[org.type] ?? org.type}</p>
            <h2 id="tmk-org-title">{org.displayName}</h2>
          </div>
          <button type="button" className="tmk-button tmk-button--quiet tmk-editor__close" onClick={onClose} aria-label="إغلاق"><X aria-hidden="true" size={20} /></button>
        </header>
        <div className="tmk-editor__body">
          <div className="tmk-editor__media">
            <label className="tmk-editor__drop tmk-editor__drop--logo" data-empty={logo ? undefined : 'true'} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); pick(event.dataTransfer.files?.[0]); }}>
              {logo ? <img src={logo} alt="" /> : null}
              <span className="tmk-editor__drop-hint">
                <ImagePlus aria-hidden="true" size={28} />
                <strong>{logo ? 'تغيير الشعار' : 'أضف شعارًا'}</strong>
                <span>PNG أو JPEG حتى 2MB · يُحفظ فور الرفع</span>
              </span>
              {uploading ? <span className="tmk-editor__uploading" role="status"><Loader2 aria-hidden="true" size={22} className="tmk-spin" />جارٍ رفع الشعار…</span> : null}
              <input type="file" accept="image/png,image/jpeg" className="tmk-visually-hidden" onChange={event => { pick(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            <p className="tmk-field__hint">الاسم القانوني: {org.legalName}</p>
          </div>
          <div className="tmk-editor__fields">
            <Field label="الاسم الظاهر" name="displayName" value={current.displayName} required max={140} />
            <div className="tmk-field" style={{ margin: 0 }}>
              <label className="tmk-field__label" htmlFor="org-type">النوع</label>
              <select className="tmk-field__control" id="org-type" name="type" defaultValue={current.type}>
                {Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <Field label="الوصف العام" name="publicDescription" value={current.publicDescription} max={1200} area />
            <Field label="المدينة" name="city" value={current.city} required max={100} />
            <Field label="رمز الدولة (حرفان)" name="country" value={current.country} max={2} ltr hint="مثل PS أو JO أو MA" />
            <Field label="المجالات (افصل بفاصلة)" name="sectors" value={current.sectors.join('، ')} max={400} />
            <Field label="الموقع الإلكتروني" name="websiteUrl" value={current.websiteUrl ?? ''} max={500} ltr />
            <Field label="بريد التواصل" name="contactEmail" value={current.contactEmail ?? ''} max={254} ltr />
            <Field label="العنوان" name="contactAddress" value={current.contactAddress ?? ''} max={300} />
          </div>
        </div>
        {error ? <div className="tmk-editor__error"><Notice tone="danger" live="assertive">{error}</Notice></div> : null}
        <footer className="tmk-editor__foot">
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || uploading}>حفظ التغييرات</button>
          <button type="button" className="tmk-button tmk-button--secondary" onClick={onClose} disabled={busy}>إغلاق</button>
        </footer>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- accounts

interface UserRow {
  id: string; email: string; name: string; displayName: string; city: string | null; status: 'active' | 'suspended' | 'closed';
  emailVerified: boolean; twoFactorEnabled: boolean; platformRoles: string[]; organizations: number; createdAt: string;
}
interface UserDetail {
  id: string; email: string; name: string; status: string; emailVerified: boolean; twoFactorEnabled: boolean; createdAt: string; termsVersion: string; lastSignInAt: string | null;
  profile: { displayName: string; city: string | null; locale: string; capabilities: string[] } | null;
  platformGrants: Array<{ role: string; expiresAt: string | null; createdAt: string }>;
  memberships: Array<{ roles: string[]; status: string; organization: { id: string; slug: string; displayName: string } }>;
}

const ROLE_LABELS: Record<string, string> = {
  PlatformAdmin: 'مدير المنصة', VerificationReviewer: 'مراجع توثيق', ContentReviewer: 'مراجع محتوى', FinanceOperator: 'مشغّل مالي',
  RiskReviewer: 'مراجع مخاطر', Support: 'الدعم', Auditor: 'مدقق', Operations: 'التشغيل'
};
const MEMBER_ROLES: Record<string, string> = {
  Owner: 'مالك', OrgAdmin: 'مدير', ProjectManager: 'مدير مشاريع', FinanceMaker: 'مالية (طلب)', FinanceApprover: 'مالية (اعتماد)',
  ProgramManager: 'مدير برامج', Trainer: 'مدرب', Recruiter: 'توظيف', InvestmentManager: 'مدير استثمار', Analyst: 'محلل', Viewer: 'مشاهد', Mentor: 'مرشد', VolunteerCoordinator: 'منسق تطوع', CaseWorker: 'باحث حالة'
};

function Users({ run, locale }: { run: Run; locale: Locale }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    setRows(await call<UserRow[]>(`/admin/users${params.toString() ? `?${params}` : ''}`));
  }, [query, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void run(load); }, 250);
    return () => window.clearTimeout(timer);
  }, [run, load]);

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة المنصة" title="المستخدمون"
        lead="كل حساب على المنصة: من صاحبه، وأدواره، والجهات التي ينتمي إليها. الحساب الموقوف لا يستطيع الدخول، وتتوقف جلساته فورًا." />
      <div className="tmk-admin-toolbar">
        <label className="tmk-admin-search">
          <Search aria-hidden="true" size={18} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو البريد" aria-label="بحث في المستخدمين" />
        </label>
        <nav className="tmk-pills" aria-label="حالة الحساب">
          {([['', 'الكل'], ['active', 'نشطة'], ['suspended', 'موقوفة']] as const).map(([key, label]) => (
            <button key={key || 'all'} type="button" className="tmk-pill" aria-current={status === key ? 'true' : undefined} onClick={() => setStatus(key)}>{label}</button>
          ))}
        </nav>
      </div>
      {!rows ? <Skeleton lines={8} label="جارٍ التحميل" /> : rows.length === 0 ? <EmptyState title="لا حسابات مطابقة" /> : (
        <div className="tmk-user-list">
          {rows.map(user => (
            <button type="button" className="tmk-user-row" key={user.id} onClick={() => setOpen(user.id)} data-suspended={user.status !== 'active' ? 'true' : undefined}>
              <span className="tmk-account__avatar" aria-hidden="true">{(user.displayName.trim()[0] ?? '?').toUpperCase()}</span>
              <span className="tmk-user-row__who">
                <strong>{user.displayName}</strong>
                <span dir="ltr">{user.email}</span>
              </span>
              <span className="tmk-user-row__tags">
                {user.platformRoles.map(role => <StatusBadge key={role} tone="info">{ROLE_LABELS[role] ?? role}</StatusBadge>)}
                {user.organizations ? <StatusBadge tone="neutral">{user.organizations} جهة</StatusBadge> : null}
                {user.status !== 'active' ? <StatusBadge tone="danger">{user.status === 'suspended' ? 'موقوف' : 'مغلق'}</StatusBadge> : null}
                {!user.emailVerified ? <StatusBadge tone="warning">البريد غير مؤكد</StatusBadge> : null}
              </span>
              <span className="tmk-user-row__date">{formatDate(user.createdAt, locale)}</span>
            </button>
          ))}
        </div>
      )}
      {open ? <UserDialog key={open} userId={open} locale={locale} onClose={() => setOpen(null)} onChanged={async message => { setOpen(null); await run(async () => { await load(); return message; }); }} /> : null}
    </>
  );
}

function UserDialog({ userId, locale, onClose, onChanged }: { userId: string; locale: Locale; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    call<UserDetail>(`/admin/users/${userId}`).then(setUser).catch(e => setError(e instanceof Error ? e.message : 'تعذر التحميل.'));
  }, [userId]);

  const setStatus = (status: 'active' | 'suspended') => {
    setBusy(true); setError('');
    call(`/admin/users/${userId}/status`, 'POST', { status })
      .then(() => onChanged(status === 'suspended' ? `أُوقف حساب ${user?.email}.` : `أُعيد تفعيل حساب ${user?.email}.`))
      .catch(e => { setError(e instanceof Error ? e.message : 'تعذر التنفيذ.'); setBusy(false); });
  };

  return (
    <dialog ref={dialog} className="tmk-dialog tmk-editor" aria-labelledby="tmk-user-title" onClose={onClose} onCancel={() => onClose()}>
      <div className="tmk-editor__form">
        <header className="tmk-editor__head">
          <div>
            <p className="tmk-editor__eyebrow">حساب</p>
            <h2 id="tmk-user-title">{user?.profile?.displayName ?? user?.name ?? '…'}</h2>
          </div>
          {user ? <StatusBadge tone={user.status === 'active' ? 'success' : 'danger'}>{user.status === 'active' ? 'نشط' : user.status === 'suspended' ? 'موقوف' : 'مغلق'}</StatusBadge> : null}
          <button type="button" className="tmk-button tmk-button--quiet tmk-editor__close" onClick={onClose} aria-label="إغلاق"><X aria-hidden="true" size={20} /></button>
        </header>
        <div className="tmk-editor__body" data-single="true">
          {!user ? (error ? null : <Skeleton lines={5} label="جارٍ التحميل" />) : (
            <div className="tmk-user-detail">
              <dl className="tmk-user-detail__facts">
                <div><dt><Mail aria-hidden="true" size={16} />البريد</dt><dd dir="ltr">{user.email} {user.emailVerified ? '✓' : ''}</dd></div>
                <div><dt><UserRound aria-hidden="true" size={16} />الاسم</dt><dd>{user.name}</dd></div>
                <div><dt>المدينة</dt><dd>{user.profile?.city || '—'}</dd></div>
                <div><dt>اللغة</dt><dd>{user.profile?.locale === 'en' ? 'الإنجليزية' : 'العربية'}</dd></div>
                <div><dt>التحقق بخطوتين</dt><dd>{user.twoFactorEnabled ? 'مفعّل' : 'غير مفعّل'}</dd></div>
                <div><dt>تاريخ التسجيل</dt><dd>{formatDate(user.createdAt, locale, true)}</dd></div>
                <div><dt>آخر دخول</dt><dd>{user.lastSignInAt ? formatDate(user.lastSignInAt, locale, true) : '—'}</dd></div>
                <div><dt>نسخة الشروط</dt><dd dir="ltr">{user.termsVersion}</dd></div>
              </dl>
              <h3>أدوار إدارة المنصة</h3>
              {user.platformGrants.length ? <p className="tmk-admin-org__badges">{user.platformGrants.map(grant => <StatusBadge key={grant.role} tone="info">{ROLE_LABELS[grant.role] ?? grant.role}</StatusBadge>)}</p> : <p className="tmk-field__hint">لا أدوار إدارية. تُمنح من «فريق التشغيل».</p>}
              <h3>الجهات</h3>
              {user.memberships.length ? (
                <ul className="tmk-user-detail__orgs">
                  {user.memberships.map(membership => (
                    <li key={membership.organization.id}>
                      <a href={localePath(locale, `/organizations/${membership.organization.slug}`)} target="_blank" rel="noreferrer">{membership.organization.displayName}</a>
                      <span>{membership.roles.map(role => MEMBER_ROLES[role] ?? role).join('، ')}{membership.status !== 'active' ? ` · ${membership.status}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="tmk-field__hint">لا ينتمي إلى أي جهة.</p>}
            </div>
          )}
        </div>
        {error ? <div className="tmk-editor__error"><Notice tone="danger" live="assertive">{error}</Notice></div> : null}
        <footer className="tmk-editor__foot">
          {user && user.status === 'active' ? (
            confirming
              ? <><button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => setStatus('suspended')}><Ban aria-hidden="true" size={18} />تأكيد إيقاف الحساب</button><button type="button" className="tmk-button tmk-button--quiet" onClick={() => setConfirming(false)}>تراجع</button></>
              : <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setConfirming(true)}><Ban aria-hidden="true" size={18} />إيقاف الحساب</button>
          ) : user && user.status === 'suspended' ? (
            <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => setStatus('active')}><UserCheck aria-hidden="true" size={18} />إعادة التفعيل</button>
          ) : null}
          <span className="tmk-editor__spacer" />
          <button type="button" className="tmk-button tmk-button--secondary" onClick={onClose}>إغلاق</button>
        </footer>
      </div>
    </dialog>
  );
}
