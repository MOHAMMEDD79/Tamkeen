'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, ExternalLink, HandHeart, LayoutGrid, Pencil, Plus, RotateCcw, Save, Search, Sprout, Trash2, TrendingUp, X } from 'lucide-react';
import { AppShell, EmptyState, Notice, PageHeader, Skeleton, StatusBadge, formatDate, formatMinorUnits, localePath, type Locale } from '@tamkeen/ui';
import { Field } from './site-admin-screens';

/**
 * ADM projects: every project in all three tracks, with everything the admin can change — text,
 * track, city, state and visibility; funding goal and dates; budget; stages; published updates —
 * and deleting it. The platform's money rules still apply and the API enforces them: a project
 * that ever touched money cannot be deleted, only removed from the site.
 */

const ERRORS: Record<string, string> = {
  conflict: 'لا يمكن تنفيذ هذا: إما أن المشروع تغيّر من مكان آخر (حدّث الصفحة)، أو أنه مرتبط بأموال أو أدلة إنجاز تمنع هذا التعديل.',
  invalid_input: 'راجع الحقول: المبالغ أرقام موجبة، وأوزان المراحل مجموعها 100، وسبب تعديل ميزانية مشروع منشور 10 أحرف على الأقل.',
  forbidden: 'هذه الصفحة لمدير المنصة فقط، ويجب تفعيل التحقق بخطوتين.',
  not_found: 'المشروع غير موجود أو حُذف.'
};

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(ERRORS[result.error?.code] ?? (response.status === 401 ? 'سجّل الدخول بحساب مدير المنصة.' : 'تعذر تنفيذ العملية.'));
  return result.data as T;
}

/** "1,250.50" typed by the admin → integer minor units as a string; null when it is not an amount. */
function toMinor(value: string): string | null {
  const clean = value.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+/, '');
  return minor && minor !== '0' ? minor : null;
}
const toMajor = (minor: string) => formatMinorUnits(minor).replace(/,/g, '');

type Kind = 'charity' | 'venture' | 'enablement';
const TYPES: Record<Kind, { label: string; icon: typeof HandHeart }> = {
  charity: { label: 'خيري', icon: HandHeart },
  venture: { label: 'استثماري', icon: TrendingUp },
  enablement: { label: 'تمكين', icon: Sprout }
};
const STATES: Record<string, string> = {
  draft: 'مسودة', submitted: 'مُرسل للمراجعة', in_review: 'قيد المراجعة', changes_requested: 'مطلوب تعديل', approved: 'معتمد', published: 'منشور',
  funding_closed: 'أُغلق التمويل', executing: 'قيد التنفيذ', impact_review: 'مراجعة الأثر', completed: 'مكتمل', archived: 'مؤرشف', paused: 'موقوف مؤقتًا', cancelled: 'ملغى', rejected: 'مرفوض'
};
const VISIBILITY: Record<string, { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  visible: { label: 'ظاهر للزوار', tone: 'success' }, hidden: { label: 'مخفي', tone: 'neutral' }, removed: { label: 'محذوف من الموقع', tone: 'danger' }
};

interface Row {
  id: string; slug: string; title: string; summary: string; type: Kind; state: string; adminVisibility: string; version: number; createdAt: string;
  organization: { id: string; displayName: string; status: string }; city: string; coverUrl: string | null;
  campaign: { goalMinor: string; currency: string; endsAt: string } | null; raisedMinor: string;
  counts: { contributions: number; milestones: number; updates: number };
}
interface Detail {
  id: string; slug: string; title: string; summary: string; story: string; type: Kind; state: string; stateReason: string; adminVisibility: string; version: number;
  cityId: string; publicLocationPrecision: 'exact' | 'approximate' | 'city'; createdAt: string; publishedAt: string | null;
  organization: { id: string; slug: string; displayName: string; status: string }; manager: { name: string; email: string };
  campaign: { goalMinor: string; currency: string; policy: 'flexible' | 'all_or_nothing'; endsAt: string } | null;
  budgetLines: Array<{ id: string; label: string; amountMinor: string }>;
  milestones: Array<{ id: string; sequence: number; title: string; budgetMinor: string; weight: number; state: string }>;
  updates: Array<{ id: string; title: string; body: string; publishedAt: string }>;
  coverUrl: string | null; raisedMinor: string;
  ties: { contributions: number; payouts: number; pools: number; agreements: number; programs: number; reviewVersions: number; budgetRevisions: number; publishedReports: number };
  deletable: boolean; allowedStates: string[];
}
interface City { id: string; country: string; nameAr: string }

type Run = (work: () => Promise<string | void>) => Promise<void>;

export function ProjectsAdmin({ locale }: { locale: Locale }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useCallback<Run>(async work => {
    setError(''); setNotice('');
    try { const done = await work(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
  }, []);
  return (
    <AppShell locale={locale} path="/admin/projects" signedIn userActions={<a className="tmk-button tmk-button--quiet" href={localePath(locale, '/app')}>لوحتي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <ProjectList run={run} locale={locale} />
    </AppShell>
  );
}

function ProjectList({ run, locale }: { run: Run; locale: Locale }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [type, setType] = useState<Kind | 'all'>('all');
  const [view, setView] = useState<'active' | 'hidden' | 'removed'>('active');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<{ id: string; tab: Tab } | null>(null);
  const load = useCallback(async () => setRows(await call<Row[]>('/admin/projects')), []);
  useEffect(() => { void run(load); }, [run, load]);

  const needle = query.trim().toLowerCase();
  const inView = (row: Row) => view === 'active' ? row.adminVisibility === 'visible' : row.adminVisibility === view;
  const shown = (rows ?? []).filter(row => (type === 'all' || row.type === type) && inView(row)
    && (!needle || `${row.title} ${row.organization.displayName} ${row.city}`.toLowerCase().includes(needle)));
  const count = (test: (row: Row) => boolean) => (rows ?? []).filter(test).length;
  const setVisibility = (row: Row, visibility: string, message: string) => run(async () => {
    await call(`/admin/projects/${row.id}`, 'PATCH', { version: row.version, visibility }); await load(); return message;
  });

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة المنصة" title="إدارة المشاريع"
        lead="كل مشروع في المسارات الثلاثة: عدّل نصوصه وحالته وتمويله وميزانيته ومراحله وتحديثاته، أو أخفه، أو احذفه. المشروع المرتبط بمساهمات لا يُحذف نهائيًا حفاظًا على السجلات المالية، بل يُحذف من الموقع ويبقى قابلًا للاستعادة." />
      <div className="tmk-admin-toolbar">
        <label className="tmk-admin-search">
          <Search aria-hidden="true" size={18} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالعنوان أو الجهة أو المدينة" aria-label="بحث في المشاريع" />
        </label>
        <nav className="tmk-pills" aria-label="المسار">
          <button type="button" className="tmk-pill" aria-current={type === 'all' ? 'true' : undefined} onClick={() => setType('all')}><LayoutGrid aria-hidden="true" size={16} />الكل<span className="tmk-pill__count">{count(inView)}</span></button>
          {(Object.keys(TYPES) as Kind[]).map(key => {
            const Icon = TYPES[key].icon;
            return <button key={key} type="button" className="tmk-pill" aria-current={type === key ? 'true' : undefined} onClick={() => setType(key)}><Icon aria-hidden="true" size={16} />{TYPES[key].label}<span className="tmk-pill__count">{count(row => row.type === key && inView(row))}</span></button>;
          })}
        </nav>
      </div>
      <nav className="tmk-pills" aria-label="الظهور" style={{ marginBlockStart: 0 }}>
        {([['active', 'الظاهرة'], ['hidden', 'المخفية'], ['removed', 'المحذوفة من الموقع']] as const).map(([key, label]) => (
          <button key={key} type="button" className="tmk-pill" aria-current={view === key ? 'true' : undefined} onClick={() => setView(key)}>{label}<span className="tmk-pill__count">{count(row => key === 'active' ? row.adminVisibility === 'visible' : row.adminVisibility === key)}</span></button>
        ))}
      </nav>

      {!rows ? <Skeleton lines={8} label="جارٍ التحميل" /> : shown.length === 0 ? <EmptyState title="لا مشاريع هنا" /> : (
        <div className="tmk-admin-projects">
          {shown.map(row => {
            const Icon = TYPES[row.type].icon;
            const goal = row.campaign ? BigInt(row.campaign.goalMinor) : BigInt(0);
            const percent = goal > BigInt(0) ? Math.min(100, Number((BigInt(row.raisedMinor) * BigInt(100)) / goal)) : 0;
            return (
              <article className="tmk-admin-project" key={row.id} data-visibility={row.adminVisibility}>
                <button type="button" className="tmk-admin-project__media" onClick={() => setOpen({ id: row.id, tab: 'details' })} aria-label={`تعديل ${row.title}`}>
                  <img src={row.coverUrl ?? `/media/defaults/cover-${row.type === 'charity' ? 'charity' : row.type === 'venture' ? 'invest' : 'work'}-1.jpg`} alt="" loading="lazy" />
                  <span className="tmk-opp__tag tmk-opp__tag--warm"><Icon aria-hidden="true" size={14} /> {TYPES[row.type].label}</span>
                </button>
                <div className="tmk-admin-project__body">
                  <p className="tmk-admin-project__badges">
                    <StatusBadge tone="info">{STATES[row.state] ?? row.state}</StatusBadge>
                    <StatusBadge tone={VISIBILITY[row.adminVisibility]?.tone ?? 'neutral'}>{VISIBILITY[row.adminVisibility]?.label ?? row.adminVisibility}</StatusBadge>
                    {row.organization.status !== 'active' ? <StatusBadge tone="danger">الجهة موقوفة</StatusBadge> : null}
                  </p>
                  <h3><button type="button" onClick={() => setOpen({ id: row.id, tab: 'details' })}>{row.title}</button></h3>
                  <p className="tmk-admin-project__meta">{row.organization.displayName} · {row.city} · أُنشئ {formatDate(row.createdAt, locale)}</p>
                  {row.campaign ? (
                    <div className="tmk-admin-project__money">
                      <span><strong>{formatMinorUnits(row.raisedMinor)}</strong> من {formatMinorUnits(row.campaign.goalMinor)} {row.campaign.currency}</span>
                      <span className="tmk-admin-project__bar"><span style={{ inlineSize: `${percent}%` }} /></span>
                      <span>{row.counts.contributions} مساهمة · {row.counts.milestones} مرحلة · {row.counts.updates} تحديث</span>
                    </div>
                  ) : <p className="tmk-field__hint" style={{ margin: 0 }}>لا حملة تمويل بعد · {row.counts.milestones} مرحلة</p>}
                </div>
                <div className="tmk-admin-project__actions">
                  <button type="button" className="tmk-button tmk-button--primary" onClick={() => setOpen({ id: row.id, tab: 'details' })}><Pencil aria-hidden="true" size={16} />تعديل</button>
                  {row.adminVisibility === 'visible'
                    ? <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void setVisibility(row, 'hidden', `أُخفي «${row.title}» عن الزوار.`)}><EyeOff aria-hidden="true" size={16} />إخفاء</button>
                    : <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void setVisibility(row, 'visible', `عاد «${row.title}» للظهور.`)}>{row.adminVisibility === 'removed' ? <><RotateCcw aria-hidden="true" size={16} />استعادة</> : <><Eye aria-hidden="true" size={16} />إظهار</>}</button>}
                  <button type="button" className="tmk-button tmk-button--quiet tmk-admin-card__delete" onClick={() => setOpen({ id: row.id, tab: 'status' })}><Trash2 aria-hidden="true" size={16} />حذف</button>
                  <a className="tmk-button tmk-button--quiet" href={localePath(locale, `/projects/${row.slug}`)} target="_blank" rel="noreferrer" aria-label="الصفحة العامة"><ExternalLink aria-hidden="true" size={16} /></a>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {open ? <ProjectEditor key={open.id} projectId={open.id} initialTab={open.tab} locale={locale} onClose={() => setOpen(null)} onChanged={message => { void run(async () => { await load(); return message; }); }} onDeleted={message => { setOpen(null); void run(async () => { await load(); return message; }); }} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- editor

type Tab = 'details' | 'funding' | 'stages' | 'updates' | 'status';

function ProjectEditor({ projectId, initialTab, locale, onClose, onChanged, onDeleted }: { projectId: string; initialTab: Tab; locale: Locale; onClose: () => void; onChanged: (message: string) => void; onDeleted: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [project, setProject] = useState<Detail | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    // No cleanup: closing here fires a close event that would read as the admin cancelling.
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    call<Detail>(`/admin/projects/${projectId}`).then(setProject).catch(e => setError(e instanceof Error ? e.message : 'تعذر التحميل.'));
    fetch('/api/v1/cities').then(response => response.json()).then((body: { data?: City[] }) => setCities(body.data ?? [])).catch(() => undefined);
  }, [projectId]);

  const send = (path: string, method: string, body: unknown, message: string) => {
    setBusy(true); setError(''); setSaved('');
    call<Detail>(path, method, body)
      .then(next => { setProject(next); setSaved(message); onChanged(message); })
      .catch(e => setError(e instanceof Error ? e.message : 'تعذر الحفظ.'))
      .finally(() => setBusy(false));
  };

  return (
    <dialog ref={dialog} className="tmk-dialog tmk-editor tmk-editor--wide" aria-labelledby="tmk-project-title" onClose={onClose} onCancel={() => onClose()}>
      <div className="tmk-editor__form">
        <header className="tmk-editor__head">
          <div>
            <p className="tmk-editor__eyebrow">{project ? `${TYPES[project.type].label} · ${project.organization.displayName}` : 'مشروع'}</p>
            <h2 id="tmk-project-title">{project?.title ?? '…'}</h2>
          </div>
          {project ? <StatusBadge tone="info">{STATES[project.state] ?? project.state}</StatusBadge> : null}
          <button type="button" className="tmk-button tmk-button--quiet tmk-editor__close" onClick={onClose} aria-label="إغلاق"><X aria-hidden="true" size={20} /></button>
        </header>
        <nav className="tmk-pills tmk-editor__tabs" aria-label="أقسام المشروع">
          {([['details', 'البيانات'], ['funding', 'التمويل والميزانية'], ['stages', 'المراحل'], ['updates', 'التحديثات'], ['status', 'الحالة والحذف']] as const).map(([key, label]) => (
            <button key={key} type="button" className="tmk-pill" aria-current={tab === key ? 'true' : undefined} onClick={() => { setTab(key); setError(''); setSaved(''); }}>{label}</button>
          ))}
        </nav>
        <div className="tmk-editor__body" data-single="true">
          {!project ? (error ? null : <Skeleton lines={6} label="جارٍ التحميل" />)
            : tab === 'details' ? <DetailsTab project={project} cities={cities} busy={busy} send={send} />
            : tab === 'funding' ? <FundingTab project={project} busy={busy} send={send} />
            : tab === 'stages' ? <StagesTab project={project} busy={busy} send={send} />
            : tab === 'updates' ? <UpdatesTab project={project} busy={busy} send={send} locale={locale} />
            : <StatusTab project={project} busy={busy} send={send} locale={locale} onDeleted={onDeleted} setError={setError} />}
        </div>
        {error ? <div className="tmk-editor__error"><Notice tone="danger" live="assertive">{error}</Notice></div> : null}
        {saved ? <div className="tmk-editor__error"><Notice tone="success">{saved}</Notice></div> : null}
      </div>
    </dialog>
  );
}

type Send = (path: string, method: string, body: unknown, message: string) => void;

function DetailsTab({ project, cities, busy, send }: { project: Detail; cities: City[]; busy: boolean; send: Send }) {
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '');
    send(`/admin/projects/${project.id}`, 'PATCH', {
      version: project.version, title: value('title').trim(), summary: value('summary').trim(), story: value('story'),
      type: value('type'), cityId: value('cityId'), publicLocationPrecision: value('precision')
    }, 'حُفظت بيانات المشروع.');
  };
  const ties = project.ties;
  const trackFixed = Boolean(project.publishedAt) || [ties.contributions, ties.payouts, ties.pools, ties.agreements, ties.programs].some(count => count > 0);
  return (
    <form className="tmk-editor__fields" onSubmit={save}>
      <Field label="عنوان المشروع" name="title" value={project.title} required max={140} />
      <div className="tmk-field" style={{ margin: 0 }}>
        <label className="tmk-field__label" htmlFor="p-type">المسار</label>
        <select className="tmk-field__control" id="p-type" name="type" defaultValue={project.type} disabled={trackFixed}>
          {(Object.keys(TYPES) as Kind[]).map(key => <option key={key} value={key}>{TYPES[key].label}</option>)}
        </select>
        {trackFixed ? <><input type="hidden" name="type" value={project.type} /><p className="tmk-field__hint" style={{ margin: 0 }}>لا يتغير المسار بعد نشر المشروع أو وصول أموال إليه. أعده إلى «مسودة» من «الحالة والحذف» لتغييره.</p></> : null}
      </div>
      <Field label="الملخص (يظهر في البطاقة، حتى 300 حرف)" name="summary" value={project.summary} max={300} area />
      <Field label="القصة الكاملة (تظهر في صفحة المشروع)" name="story" value={project.story} max={20000} area />
      <div className="tmk-field" style={{ margin: 0 }}>
        <label className="tmk-field__label" htmlFor="p-city">المدينة</label>
        <select className="tmk-field__control" id="p-city" name="cityId" defaultValue={project.cityId}>
          {cities.length ? cities.map(city => <option key={city.id} value={city.id}>{city.nameAr} ({city.country})</option>) : <option value={project.cityId}>…</option>}
        </select>
      </div>
      <div className="tmk-field" style={{ margin: 0 }}>
        <label className="tmk-field__label" htmlFor="p-precision">دقة الموقع المعروض للزوار</label>
        <select className="tmk-field__control" id="p-precision" name="precision" defaultValue={project.publicLocationPrecision}>
          <option value="city">المدينة فقط</option><option value="approximate">تقريبي</option><option value="exact">دقيق</option>
        </select>
      </div>
      <p className="tmk-editor__wide tmk-field__hint" style={{ margin: 0 }}>مدير المشروع: {project.manager.name} ({project.manager.email}) · لتغيير الصورة استخدم «المشاريع والفرص».</p>
      <p className="tmk-editor__wide" style={{ margin: 0 }}><button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={18} />حفظ البيانات</button></p>
    </form>
  );
}

function FundingTab({ project, busy, send }: { project: Detail; busy: boolean; send: Send }) {
  const [lines, setLines] = useState(project.budgetLines.map(line => ({ label: line.label, amount: toMajor(line.amountMinor) })));
  const [reason, setReason] = useState('');
  useEffect(() => { setLines(project.budgetLines.map(line => ({ label: line.label, amount: toMajor(line.amountMinor) }))); }, [project.budgetLines]);
  const currency = project.campaign?.currency ?? 'ILS';
  const total = useMemo(() => lines.reduce((sum, line) => sum + BigInt(toMinor(line.amount) ?? '0'), BigInt(0)), [lines]);
  const published = Boolean(project.publishedAt);

  const saveCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const goal = toMinor(String(data.get('goal') ?? ''));
    const ends = String(data.get('endsAt') ?? '');
    if (!goal || !ends) return;
    send(`/admin/projects/${project.id}/campaign`, 'PUT', {
      version: project.version, goalMinor: goal, endsAt: new Date(`${ends}T23:59:00`).toISOString(),
      ...(!published ? { policy: String(data.get('policy')), currency: String(data.get('currency') || 'ILS').toUpperCase() } : {})
    }, 'حُفظت حملة التمويل.');
  };
  const saveBudget = () => {
    const parsed = lines.map(line => ({ label: line.label.trim(), amountMinor: toMinor(line.amount) }));
    if (parsed.some(line => !line.amountMinor || line.label.length < 2)) return;
    send(`/admin/projects/${project.id}/budget`, 'PUT', { version: project.version, reason: reason.trim() || 'تعديل من إدارة المنصة', lines: parsed }, 'حُفظت الميزانية، وحُفظت النسخة السابقة في سجل المراجعات.');
  };

  return (
    <div className="tmk-project-editor">
      <form className="tmk-card tmk-project-editor__block" onSubmit={saveCampaign}>
        <h3>حملة التمويل</h3>
        <p className="tmk-field__hint" style={{ margin: 0 }}>المجموع الواصل الآن: <strong>{formatMinorUnits(project.raisedMinor)} {currency}</strong></p>
        <div className="tmk-editor__fields">
          <Field label={`الهدف (${currency})`} name="goal" value={project.campaign ? toMajor(project.campaign.goalMinor) : ''} max={20} ltr numeric />
          <div className="tmk-field" style={{ margin: 0 }}>
            <label className="tmk-field__label" htmlFor="c-ends">ينتهي التمويل في</label>
            <input className="tmk-field__control" id="c-ends" name="endsAt" type="date" defaultValue={project.campaign ? project.campaign.endsAt.slice(0, 10) : ''} required />
          </div>
          {!published ? <>
            <div className="tmk-field" style={{ margin: 0 }}>
              <label className="tmk-field__label" htmlFor="c-policy">سياسة التمويل</label>
              <select className="tmk-field__control" id="c-policy" name="policy" defaultValue={project.campaign?.policy ?? 'flexible'}>
                <option value="flexible">مرنة (يُصرف ما جُمع)</option><option value="all_or_nothing">الكل أو لا شيء</option>
              </select>
            </div>
            <Field label="العملة" name="currency" value={currency} max={3} ltr />
          </> : <p className="tmk-editor__wide tmk-field__hint" style={{ margin: 0 }}>السياسة ({project.campaign?.policy === 'all_or_nothing' ? 'الكل أو لا شيء' : 'مرنة'}) والعملة لا تتغيران بعد النشر: المساهمون اعتمدوا عليهما.</p>}
        </div>
        <p style={{ margin: 0 }}><button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={18} />حفظ الحملة</button></p>
      </form>

      <div className="tmk-card tmk-project-editor__block">
        <h3>الميزانية <span className="tmk-field__hint">المجموع {formatMinorUnits(total.toString())} {currency}{project.campaign && total.toString() !== project.campaign.goalMinor ? ' · لا يساوي هدف الحملة' : ''}</span></h3>
        <div className="tmk-rows-editor">
          {lines.map((line, index) => (
            <div className="tmk-rows-editor__row" key={index}>
              <input className="tmk-field__control" aria-label={`بند ${index + 1}`} value={line.label} maxLength={140} placeholder="البند" onChange={event => setLines(lines.map((entry, at) => at === index ? { ...entry, label: event.target.value } : entry))} />
              <input className="tmk-field__control" aria-label={`مبلغ البند ${index + 1}`} value={line.amount} dir="ltr" inputMode="decimal" placeholder="0.00" onChange={event => setLines(lines.map((entry, at) => at === index ? { ...entry, amount: event.target.value } : entry))} data-invalid={line.amount && !toMinor(line.amount) ? 'true' : undefined} />
              <button type="button" className="tmk-button tmk-button--quiet" aria-label="حذف البند" onClick={() => setLines(lines.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={16} /></button>
            </div>
          ))}
          <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setLines([...lines, { label: '', amount: '' }])}><Plus aria-hidden="true" size={16} />إضافة بند</button>
        </div>
        {published ? (
          <div className="tmk-field" style={{ margin: 0 }}>
            <label className="tmk-field__label" htmlFor="b-reason">سبب التعديل (يُحفظ في سجل المراجعات، 10 أحرف على الأقل)</label>
            <input className="tmk-field__control" id="b-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
          </div>
        ) : null}
        <p style={{ margin: 0 }}><button type="button" className="tmk-button tmk-button--primary" disabled={busy || !lines.length} onClick={saveBudget}><Save aria-hidden="true" size={18} />حفظ الميزانية</button></p>
      </div>
    </div>
  );
}

function StagesTab({ project, busy, send }: { project: Detail; busy: boolean; send: Send }) {
  const [stages, setStages] = useState(project.milestones.map(stage => ({ title: stage.title, budget: toMajor(stage.budgetMinor), weight: String(stage.weight) })));
  useEffect(() => { setStages(project.milestones.map(stage => ({ title: stage.title, budget: toMajor(stage.budgetMinor), weight: String(stage.weight) }))); }, [project.milestones]);
  const locked = project.milestones.some(stage => ['evidence_submitted', 'verified'].includes(stage.state)) || project.ties.payouts > 0;
  const weights = stages.reduce((sum, stage) => sum + (Number.parseInt(stage.weight, 10) || 0), 0);
  const currency = project.campaign?.currency ?? 'ILS';
  const save = () => {
    const parsed = stages.map(stage => ({ title: stage.title.trim(), budgetMinor: toMinor(stage.budget), weight: Number.parseInt(stage.weight, 10) }));
    if (parsed.some(stage => !stage.budgetMinor || stage.title.length < 2 || !stage.weight)) return;
    send(`/admin/projects/${project.id}/milestones`, 'PUT', { version: project.version, milestones: parsed }, 'حُفظت المراحل.');
  };
  return (
    <div className="tmk-card tmk-project-editor__block">
      <h3>المراحل <span className="tmk-field__hint" data-invalid={weights !== 100 ? 'true' : undefined}>مجموع الأوزان {weights} من 100</span></h3>
      {locked ? <Notice tone="warning">بعض المراحل عليها أدلة إنجاز أو صرف، لذلك لا يمكن استبدالها. الحالة الحالية معروضة أدناه.</Notice> : null}
      <div className="tmk-rows-editor">
        {stages.map((stage, index) => (
          <div className="tmk-rows-editor__row tmk-rows-editor__row--stage" key={index}>
            <span className="tmk-rows-editor__number">{index + 1}</span>
            <input className="tmk-field__control" aria-label={`عنوان المرحلة ${index + 1}`} value={stage.title} maxLength={140} disabled={locked} placeholder="عنوان المرحلة" onChange={event => setStages(stages.map((entry, at) => at === index ? { ...entry, title: event.target.value } : entry))} />
            <input className="tmk-field__control" aria-label={`ميزانية المرحلة ${index + 1}`} value={stage.budget} dir="ltr" inputMode="decimal" disabled={locked} placeholder={`0.00 ${currency}`} onChange={event => setStages(stages.map((entry, at) => at === index ? { ...entry, budget: event.target.value } : entry))} />
            <input className="tmk-field__control" aria-label={`وزن المرحلة ${index + 1}`} value={stage.weight} dir="ltr" inputMode="numeric" disabled={locked} placeholder="%" onChange={event => setStages(stages.map((entry, at) => at === index ? { ...entry, weight: event.target.value } : entry))} />
            {project.milestones[index] ? <StatusBadge tone="neutral">{project.milestones[index]!.state}</StatusBadge> : <StatusBadge tone="info">جديدة</StatusBadge>}
            {!locked ? <button type="button" className="tmk-button tmk-button--quiet" aria-label="حذف المرحلة" onClick={() => setStages(stages.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={16} /></button> : null}
          </div>
        ))}
        {!locked ? <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setStages([...stages, { title: '', budget: '', weight: '' }])}><Plus aria-hidden="true" size={16} />إضافة مرحلة</button> : null}
      </div>
      {!locked ? <p style={{ margin: 0 }}><button type="button" className="tmk-button tmk-button--primary" disabled={busy || !stages.length || weights !== 100} onClick={save}><Save aria-hidden="true" size={18} />حفظ المراحل</button></p> : null}
    </div>
  );
}

function UpdatesTab({ project, busy, send, locale }: { project: Detail; busy: boolean; send: Send; locale: Locale }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!project.updates.length) return <EmptyState title="لا تحديثات منشورة لهذا المشروع" />;
  return (
    <div className="tmk-project-editor">
      {project.updates.map(update => editing === update.id ? (
        <form key={update.id} className="tmk-card tmk-project-editor__block" onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          send(`/admin/projects/${project.id}/updates/${update.id}`, 'PATCH', { title: String(data.get('title') ?? '').trim(), body: String(data.get('body') ?? '').trim() }, 'حُفظ التحديث.');
          setEditing(null);
        }}>
          <Field label="العنوان" name="title" value={update.title} max={140} required />
          <Field label="النص" name="body" value={update.body} max={20000} area />
          <p className="tmk-row__actions" style={{ margin: 0 }}>
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={16} />حفظ</button>
            <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setEditing(null)}>إلغاء</button>
          </p>
        </form>
      ) : (
        <article key={update.id} className="tmk-card tmk-project-editor__block">
          <h3>{update.title} <span className="tmk-field__hint">{formatDate(update.publishedAt, locale, true)}</span></h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{update.body}</p>
          <p className="tmk-row__actions" style={{ margin: 0 }}>
            <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setEditing(update.id)}><Pencil aria-hidden="true" size={16} />تعديل</button>
            {confirm === update.id
              ? <><button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => send(`/admin/projects/${project.id}/updates/${update.id}`, 'DELETE', undefined, 'حُذف التحديث.')}><Trash2 aria-hidden="true" size={16} />تأكيد الحذف</button><button type="button" className="tmk-button tmk-button--quiet" onClick={() => setConfirm(null)}>تراجع</button></>
              : <button type="button" className="tmk-button tmk-button--quiet tmk-admin-card__delete" onClick={() => setConfirm(update.id)}><Trash2 aria-hidden="true" size={16} />حذف</button>}
          </p>
        </article>
      ))}
    </div>
  );
}

function StatusTab({ project, busy, send, locale, onDeleted, setError }: { project: Detail; busy: boolean; send: Send; locale: Locale; onDeleted: (message: string) => void; setError: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const saveState = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    send(`/admin/projects/${project.id}`, 'PATCH', { version: project.version, state: String(data.get('state')), stateReason: String(data.get('reason') ?? '').trim() }, 'تغيّرت حالة المشروع.');
  };
  const destroy = () => {
    call(`/admin/projects/${project.id}`, 'DELETE').then(() => onDeleted(`حُذف «${project.title}» نهائيًا.`)).catch(e => setError(e instanceof Error ? e.message : 'تعذر الحذف.'));
  };
  const ties = project.ties;
  return (
    <div className="tmk-project-editor">
      <form className="tmk-card tmk-project-editor__block" onSubmit={saveState}>
        <h3>حالة المشروع</h3>
        <div className="tmk-editor__fields">
          <div className="tmk-field" style={{ margin: 0 }}>
            <label className="tmk-field__label" htmlFor="s-state">الحالة</label>
            <select className="tmk-field__control" id="s-state" name="state" defaultValue={project.allowedStates.includes(project.state) ? project.state : ''}>
              {!project.allowedStates.includes(project.state) ? <option value="" disabled>{STATES[project.state] ?? project.state} (الحالية)</option> : null}
              {project.allowedStates.map(state => <option key={state} value={state}>{STATES[state] ?? state}</option>)}
            </select>
          </div>
          <Field label="سبب يظهر مع الحالة (اختياري)" name="reason" value={project.stateReason} max={1000} />
        </div>
        <p style={{ margin: 0 }}><button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={18} />حفظ الحالة</button></p>
      </form>

      <div className="tmk-card tmk-project-editor__block">
        <h3>الظهور للزوار</h3>
        <p className="tmk-row__actions" style={{ margin: 0 }}>
          {(['visible', 'hidden', 'removed'] as const).map(visibility => (
            <button key={visibility} type="button" className={project.adminVisibility === visibility ? 'tmk-button tmk-button--primary' : 'tmk-button tmk-button--secondary'} disabled={busy || project.adminVisibility === visibility}
              onClick={() => send(`/admin/projects/${project.id}`, 'PATCH', { version: project.version, visibility }, visibility === 'visible' ? 'المشروع ظاهر للزوار.' : visibility === 'hidden' ? 'أُخفي المشروع عن الزوار.' : 'حُذف المشروع من الموقع، ويمكن استعادته.')}>
              {VISIBILITY[visibility]!.label}
            </button>
          ))}
        </p>
        <p className="tmk-field__hint" style={{ margin: 0 }}>المخفي والمحذوف من الموقع لا يظهران للزوار ولا يقبلان مساهمات جديدة، وتبقى كل سجلاتهما.</p>
      </div>

      <div className="tmk-card tmk-project-editor__block tmk-project-editor__danger">
        <h3>الحذف</h3>
        {project.deletable ? (
          confirm
            ? <p className="tmk-row__actions" style={{ margin: 0 }}><button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={destroy}><Trash2 aria-hidden="true" size={18} />نعم، احذف المشروع وكل مسوداته ومراحله نهائيًا</button><button type="button" className="tmk-button tmk-button--quiet" onClick={() => setConfirm(false)}>تراجع</button></p>
            : <><p style={{ margin: 0 }}>المشروع غير مرتبط بأي أموال، ويمكن حذفه نهائيًا مع مسوداته وميزانيته ومراحله وتحديثاته.</p><p style={{ margin: 0 }}><button type="button" className="tmk-button tmk-button--danger" onClick={() => setConfirm(true)}><Trash2 aria-hidden="true" size={18} />حذف نهائي</button></p></>
        ) : (
          <p style={{ margin: 0 }}>
            لا يمكن حذفه نهائيًا لأنه مرتبط بـ {[ties.contributions && `${ties.contributions} مساهمة`, ties.payouts && `${ties.payouts} صرف`, ties.pools && `${ties.pools} صندوق تمويل`, ties.agreements && `${ties.agreements} اتفاقية`, ties.programs && `${ties.programs} برنامج`, ties.reviewVersions && `سجل مراجعة (${ties.reviewVersions} نسخة)`, ties.budgetRevisions && `سجل تعديلات الميزانية (${ties.budgetRevisions})`, ties.publishedReports && `${ties.publishedReports} تقرير منشور`].filter(Boolean).join('، ')}.
            هذه السجلات تبقى دائمًا بحكم النظام المالي والتدقيق. زر «حذف من الموقع» يخفيه تمامًا عن الزوار ويوقف المساهمات فيه.
          </p>
        )}
        {!project.deletable && project.adminVisibility !== 'removed' ? (
          <p style={{ margin: 0 }}><button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => send(`/admin/projects/${project.id}`, 'PATCH', { version: project.version, visibility: 'removed' }, 'حُذف المشروع من الموقع. تجده في «المحذوفة من الموقع» إن أردت استعادته.')}><Trash2 aria-hidden="true" size={18} />حذف من الموقع</button></p>
        ) : null}
        <p className="tmk-field__hint" style={{ margin: 0 }}><a href={localePath(locale, `/projects/${project.slug}`)} target="_blank" rel="noreferrer">الصفحة العامة للمشروع</a> · الجهة: {project.organization.displayName}</p>
      </div>
    </div>
  );
}
