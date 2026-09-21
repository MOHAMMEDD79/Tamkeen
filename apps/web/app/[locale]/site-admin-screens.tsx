'use client';

import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Eye, EyeOff, ImagePlus, Inbox, LayoutTemplate, MailOpen, Plus, RotateCcw, Save, Trash2, Images } from 'lucide-react';
import { AppShell, EmptyState, Notice, PageHeader, Skeleton, StatusBadge, formatDate, localePath, type Locale, type ShellNavGroup } from '@tamkeen/ui';

/**
 * ADM site content: the platform admin controls every photo and line of marketing copy the public
 * pages show — homepage slides, the three track panels, the About and Contact banners, each
 * project's cover — and reads what visitors send through Contact us.
 *
 * Uploads go straight to the API as raw bytes; the server checks the type from the bytes, the size
 * and the dimensions before anything can reference the file. Every save carries the item's version,
 * so two admins editing the same slide cannot silently overwrite each other.
 */

type Text = { ar: string; en: string };
interface AdminItem {
  id: string; slot: string; sortOrder: number; title: Text; body: Text;
  cta: { label: Text; href: string }; imageKey: string | null; imageUrl: string; defaultImage: string;
  active: boolean; version: number; updatedAt: string;
}
interface CoverRow { id: string; slug: string; title: string; type: string; state: string; organization: { displayName: string }; coverUrl: string | null }
interface ContactMessage { id: string; name: string; email: string; subject: string; body: string; locale: string; state: 'new' | 'read' | 'archived'; createdAt: string; readAt: string | null }

class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const messages: Record<string, string> = {
  conflict: 'تغيّر هذا العنصر من مكان آخر، أو أن العملية ستترك الصفحة الرئيسية بلا شريحة ظاهرة. حدّث الصفحة ثم أعد المحاولة.',
  invalid_input: 'راجع الحقول: الرابط يجب أن يبدأ بـ / داخل الموقع، والصورة PNG أو JPEG أو WebP حتى 8MB و6000×6000.',
  forbidden: 'هذه الصفحة لمدير المنصة فقط، ويجب تفعيل التحقق بخطوتين في حسابك.',
  not_found: 'العنصر غير موجود أو حُذف.'
};

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'include', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(messages[result.error?.code] ?? (response.status === 401 ? 'سجّل الدخول بحساب مدير المنصة.' : 'تعذر تنفيذ العملية.'), response.status);
  return result.data as T;
}

/** Sends the file's bytes as-is; the server decides the real type from them, not from the name. */
async function uploadImage(file: File): Promise<{ imageKey: string; imageUrl: string }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('اختر صورة PNG أو JPEG أو WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('الصورة أكبر من 8MB. صغّرها ثم أعد المحاولة.');
  const response = await fetch('/api/v1/admin/site-media/images', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type }, body: file });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messages[result.error?.code] ?? 'تعذر رفع الصورة.');
  return result.data;
}

const SLOT_LABELS: Record<string, string> = {
  hero: 'شريحة في الصفحة الرئيسية',
  'track.charity': 'بطاقة المسار: خيري',
  'track.invest': 'بطاقة المسار: استثماري ربحي',
  'track.work': 'بطاقة المسار: فرص تشغيل',
  about: 'بانر صفحة «من نحن»',
  contact: 'بانر صفحة «تواصل معنا»'
};

export function SiteAdmin({ locale, mode }: { locale: Locale; mode: 'content' | 'covers' | 'messages' }) {
  const L = (path: string) => localePath(locale, path);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const navigation: ShellNavGroup[] = [{
    title: 'إدارة الموقع',
    items: [
      { href: L('/admin/site'), text: 'البانرات والأقسام', icon: LayoutTemplate, current: mode === 'content' },
      { href: L('/admin/site/covers'), text: 'صور المشاريع', icon: Images, current: mode === 'covers' },
      { href: L('/admin/messages'), text: 'رسائل التواصل', icon: Inbox, current: mode === 'messages' }
    ]
  }];
  const run = useCallback(async (work: () => Promise<string | void>) => {
    setError(''); setNotice('');
    try { const done = await work(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
  }, []);
  return (
    <AppShell locale={locale} path={mode === 'messages' ? '/admin/messages' : mode === 'covers' ? '/admin/site/covers' : '/admin/site'} signedIn navigation={navigation}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>لوحتي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {mode === 'content' ? <ContentEditor run={run} locale={locale} /> : mode === 'covers' ? <CoverEditor run={run} locale={locale} /> : <MessageInbox run={run} locale={locale} />}
    </AppShell>
  );
}

type Run = (work: () => Promise<string | void>) => Promise<void>;

function ContentEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const load = useCallback(async () => setItems((await call<{ items: AdminItem[] }>('/admin/site-content')).items), []);
  useEffect(() => { void run(load); }, [run, load]);
  const order = ['hero', 'track.charity', 'track.invest', 'track.work', 'about', 'contact'];
  const sorted = items ? [...items].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || a.sortOrder - b.sortOrder) : null;
  const heroes = sorted?.filter(item => item.slot === 'hero') ?? [];
  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="البانرات والأقسام"
        lead="كل صورة ونص يظهر في الصفحات العامة. التغيير يظهر للزوار فور الحفظ. اترك الحقل الإنجليزي فارغًا ليُعرض النص العربي."
        actions={<a className="tmk-button tmk-button--secondary" href={localePath(locale, '/')} target="_blank" rel="noreferrer"><Eye aria-hidden="true" size={18} />معاينة الموقع</a>} />
      {!sorted ? <Skeleton lines={6} label="جارٍ التحميل" /> : <>
        <div className="tmk-section-row" style={{ marginBlockStart: 0 }}>
          <h2>شرائح الصفحة الرئيسية ({heroes.length})</h2>
          <button type="button" className="tmk-button tmk-button--primary" onClick={() => void run(async () => {
            await call('/admin/site-content/items', 'POST', { titleAr: 'شريحة جديدة', titleEn: 'New slide', bodyAr: '', ctaHref: '/explore', ctaLabelAr: 'تصفّح المشاريع', ctaLabelEn: 'Browse projects', active: false });
            await load(); return 'أُضيفت شريحة جديدة مخفية. عدّلها وأظهرها عندما تكون جاهزة.';
          })}><Plus aria-hidden="true" size={18} />شريحة جديدة</button>
        </div>
        <div className="tmk-stack" style={{ gap: 24 }}>
          {heroes.map(item => <ItemEditor key={`${item.id}-${item.version}`} item={item} run={run} reload={load} canDelete={heroes.length > 1} locale={locale} />)}
        </div>
        <h2>الأقسام الثابتة</h2>
        <div className="tmk-stack" style={{ gap: 24 }}>
          {sorted.filter(item => item.slot !== 'hero').map(item => <ItemEditor key={`${item.id}-${item.version}`} item={item} run={run} reload={load} canDelete={false} locale={locale} />)}
        </div>
      </>}
    </>
  );
}

function ItemEditor({ item, run, reload, canDelete, locale }: { item: AdminItem; run: Run; reload: () => Promise<void>; canDelete: boolean; locale: Locale }) {
  const [preview, setPreview] = useState(item.imageUrl);
  const [pendingKey, setPendingKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const hero = item.slot === 'hero';

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    setBusy(true);
    void run(async () => {
      await call(`/admin/site-content/items/${item.id}`, 'PATCH', {
        version: item.version, titleAr: value('titleAr'), titleEn: value('titleEn'), bodyAr: value('bodyAr'), bodyEn: value('bodyEn'),
        ctaLabelAr: value('ctaLabelAr'), ctaLabelEn: value('ctaLabelEn'), ctaHref: value('ctaHref'),
        ...(hero ? { sortOrder: Number(value('sortOrder') || item.sortOrder) } : {}),
        ...(pendingKey !== undefined ? { imageKey: pendingKey } : {})
      });
      await reload(); return `حُفظ «${value('titleAr') || SLOT_LABELS[item.slot]}».`;
    }).finally(() => setBusy(false));
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    void run(async () => {
      const uploaded = await uploadImage(file);
      setPreview(uploaded.imageUrl); setPendingKey(uploaded.imageKey);
      return 'رُفعت الصورة. اضغط «حفظ» لتظهر للزوار.';
    }).finally(() => setBusy(false));
  };

  return (
    <form className="tmk-card tmk-admin-item" onSubmit={save}>
      <div className="tmk-admin-item__media">
        <img src={preview} alt="" />
        <div className="tmk-row__actions">
          <label className="tmk-button tmk-button--secondary">
            <ImagePlus aria-hidden="true" size={18} />تغيير الصورة
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => pick(event.target.files?.[0])} />
          </label>
          {(item.imageKey || pendingKey) && pendingKey !== null ? (
            <button type="button" className="tmk-button tmk-button--quiet" onClick={() => { setPendingKey(null); setPreview(item.defaultImage); }}><RotateCcw aria-hidden="true" size={16} />الصورة الافتراضية</button>
          ) : null}
        </div>
        {pendingKey !== undefined ? <p className="tmk-field__hint">تغيير لم يُحفظ بعد.</p> : null}
      </div>
      <div>
        <div className="tmk-row" style={{ paddingBlockStart: 0 }}>
          <div className="tmk-row__lead">
            <strong>{SLOT_LABELS[item.slot] ?? item.slot}</strong>
            <StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'ظاهر' : 'مخفي'}</StatusBadge>
          </div>
          <span className="tmk-field__hint">آخر تعديل {formatDate(item.updatedAt, locale, true)}</span>
        </div>
        <div className="tmk-admin-item__grid">
          <Field label="العنوان بالعربية" name="titleAr" value={item.title.ar} required max={200} />
          <Field label="العنوان بالإنجليزية" name="titleEn" value={item.title.en} max={200} ltr />
          <Field label="النص بالعربية" name="bodyAr" value={item.body.ar} max={600} area />
          <Field label="النص بالإنجليزية" name="bodyEn" value={item.body.en} max={600} area ltr />
          <Field label="نص الزر بالعربية" name="ctaLabelAr" value={item.cta.label.ar} max={60} />
          <Field label="نص الزر بالإنجليزية" name="ctaLabelEn" value={item.cta.label.en} max={60} ltr />
          <Field label="رابط الزر (داخل الموقع، مثل /explore)" name="ctaHref" value={item.cta.href} max={300} ltr />
          {hero ? <Field label="الترتيب" name="sortOrder" value={String(item.sortOrder)} max={4} ltr /> : null}
        </div>
        <div className="tmk-row__actions" style={{ marginBlockStart: 16 }}>
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={18} />حفظ</button>
          {hero ? (
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void run(async () => {
              await call(`/admin/site-content/items/${item.id}`, 'PATCH', { version: item.version, active: !item.active });
              await reload(); return item.active ? 'أُخفيت الشريحة.' : 'أصبحت الشريحة ظاهرة.';
            })}>{item.active ? <><EyeOff aria-hidden="true" size={18} />إخفاء</> : <><Eye aria-hidden="true" size={18} />إظهار</>}</button>
          ) : null}
          {hero && canDelete ? (
            <button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => {
              if (!window.confirm('حذف هذه الشريحة نهائيًا؟')) return;
              void run(async () => { await call(`/admin/site-content/items/${item.id}`, 'DELETE'); await reload(); return 'حُذفت الشريحة.'; });
            }}><Trash2 aria-hidden="true" size={18} />حذف</button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function Field({ label, name, value, max, required, area, ltr }: { label: string; name: string; value: string; max: number; required?: boolean; area?: boolean; ltr?: boolean }) {
  const id = `field-${name}-${useId()}`;
  return (
    <div className="tmk-field" style={{ margin: 0 }}>
      <label className="tmk-field__label" htmlFor={id}>{label}</label>
      {area
        ? <textarea className="tmk-field__control" id={id} name={name} defaultValue={value} maxLength={max} rows={3} dir={ltr ? 'ltr' : undefined} />
        : <input className="tmk-field__control" id={id} name={name} defaultValue={value} maxLength={max} required={required} dir={ltr ? 'ltr' : undefined} />}
    </div>
  );
}

function CoverEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [rows, setRows] = useState<CoverRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => setRows(await call<CoverRow[]>('/admin/projects/covers')), []);
  useEffect(() => { void run(load); }, [run, load]);
  const upload = (row: CoverRow, file: File | undefined) => {
    if (!file) return;
    setBusy(row.id);
    void run(async () => {
      const uploaded = await uploadImage(file);
      await call(`/admin/projects/${row.id}/cover`, 'PUT', { imageKey: uploaded.imageKey });
      await load(); return `تغيّرت صورة «${row.title}».`;
    }).finally(() => setBusy(''));
  };
  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="صور المشاريع" lead="صورة الغلاف تظهر في بطاقة المشروع وصفحته. المشروع بلا صورة يعرض صورة افتراضية لمساره." />
      {!rows ? <Skeleton lines={6} label="جارٍ التحميل" /> : rows.length === 0 ? <EmptyState title="لا مشاريع بعد" /> : (
        <div className="tmk-projects">
          {rows.map(row => (
            <article className="tmk-project" key={row.id}>
              <div className="tmk-project__media">
                {row.coverUrl ? <img src={row.coverUrl} alt="" /> : <div className="tmk-admin-empty-cover"><ImagePlus aria-hidden="true" size={36} /><span>صورة افتراضية</span></div>}
                <span className="tmk-project__state"><StatusBadge tone="neutral">{row.state}</StatusBadge></span>
              </div>
              <div className="tmk-project__body">
                <p className="tmk-project__org" style={{ margin: 0 }}>{row.organization.displayName}</p>
                <h3 className="tmk-project__title" style={{ position: 'static' }}><a href={localePath(locale, `/projects/${row.slug}`)} target="_blank" rel="noreferrer">{row.title}</a></h3>
              </div>
              <div className="tmk-project__foot">
                <label className="tmk-button tmk-button--primary" aria-disabled={busy === row.id}>
                  <ImagePlus aria-hidden="true" size={16} />{row.coverUrl ? 'استبدال' : 'رفع صورة'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy === row.id} onChange={event => upload(row, event.target.files?.[0])} />
                </label>
                {row.coverUrl ? <button type="button" className="tmk-button tmk-button--quiet" disabled={busy === row.id} onClick={() => void run(async () => { await call(`/admin/projects/${row.id}/cover`, 'DELETE'); await load(); return 'أُزيلت الصورة وعادت الصورة الافتراضية.'; })}><Trash2 aria-hidden="true" size={16} />إزالة</button> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function MessageInbox({ run, locale }: { run: Run; locale: Locale }) {
  const [state, setState] = useState<'new' | 'read' | 'archived'>('new');
  const [rows, setRows] = useState<ContactMessage[] | null>(null);
  const load = useCallback(async () => setRows(await call<ContactMessage[]>(`/admin/contact-messages?state=${state}`)), [state]);
  useEffect(() => { setRows(null); void run(load); }, [run, load]);
  const tabs: Array<{ key: typeof state; label: string; icon: ReactNode }> = [
    { key: 'new', label: 'جديدة', icon: <Inbox aria-hidden="true" size={18} /> },
    { key: 'read', label: 'مقروءة', icon: <MailOpen aria-hidden="true" size={18} /> },
    { key: 'archived', label: 'مؤرشفة', icon: <Archive aria-hidden="true" size={18} /> }
  ];
  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="رسائل التواصل" lead="ما يرسله الزوار من صفحة «تواصل معنا». الرد يكون عبر البريد المذكور في الرسالة." />
      <nav className="tmk-pills" aria-label="حالة الرسائل">
        {tabs.map(tab => <button key={tab.key} type="button" className="tmk-pill" aria-current={state === tab.key ? 'true' : undefined} onClick={() => setState(tab.key)}>{tab.icon}{tab.label}</button>)}
      </nav>
      {!rows ? <Skeleton lines={5} label="جارٍ التحميل" /> : rows.length === 0 ? <EmptyState title="لا رسائل هنا" /> : (
        <div className="tmk-stack" style={{ gap: 16 }}>
          {rows.map(message => (
            <article className="tmk-card" key={message.id}>
              <div className="tmk-row" style={{ paddingBlockStart: 0 }}>
                <div>
                  <strong style={{ fontSize: 18 }}>{message.subject}</strong>
                  <p className="tmk-field__hint" style={{ margin: 0 }}>{message.name} · <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`} dir="ltr">{message.email}</a> · {formatDate(message.createdAt, locale, true)}</p>
                </div>
                <div className="tmk-row__actions">
                  {message.state === 'new' ? <button type="button" className="tmk-button tmk-button--secondary" onClick={() => void run(async () => { await call(`/admin/contact-messages/${message.id}/state`, 'POST', { state: 'read' }); await load(); return 'عُلّمت الرسالة مقروءة.'; })}><MailOpen aria-hidden="true" size={16} />مقروءة</button> : null}
                  {message.state !== 'archived' ? <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void run(async () => { await call(`/admin/contact-messages/${message.id}/state`, 'POST', { state: 'archived' }); await load(); return 'أُرشفت الرسالة.'; })}><Archive aria-hidden="true" size={16} />أرشفة</button> : null}
                </div>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{message.body}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
