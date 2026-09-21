'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Eye, EyeOff, ImagePlus, Inbox, Loader2, MailOpen, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { AppShell, EmptyState, Notice, PageHeader, Skeleton, StatusBadge, formatDate, localePath, type Locale } from '@tamkeen/ui';

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
  const run = useCallback(async (work: () => Promise<string | void>) => {
    setError(''); setNotice('');
    try { const done = await work(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
  }, []);
  return (
    <AppShell locale={locale} path={mode === 'messages' ? '/admin/messages' : mode === 'covers' ? '/admin/site/covers' : '/admin/site'} signedIn
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>لوحتي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {mode === 'content' ? <ContentEditor run={run} locale={locale} /> : mode === 'covers' ? <CoverEditor run={run} locale={locale} /> : <MessageInbox run={run} locale={locale} />}
    </AppShell>
  );
}

type Run = (work: () => Promise<string | void>) => Promise<void>;

const HERO_ORDER = ['hero', 'track.charity', 'track.invest', 'track.work', 'about', 'contact'];

type Editing = { kind: 'new' } | { kind: 'item'; item: AdminItem } | null;

/**
 * The content overview: every slide and fixed section as a photo card, so the whole site is visible
 * on one screen. A card opens its editor in a dialog; "new slide" opens the same dialog empty, so a
 * slide is written, given its photo and published in one step rather than created blank and fixed up.
 */
function ContentEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const load = useCallback(async () => setItems((await call<{ items: AdminItem[] }>('/admin/site-content')).items), []);
  useEffect(() => { void run(load); }, [run, load]);
  const sorted = items ? [...items].sort((a, b) => HERO_ORDER.indexOf(a.slot) - HERO_ORDER.indexOf(b.slot) || a.sortOrder - b.sortOrder) : null;
  const heroes = sorted?.filter(item => item.slot === 'hero') ?? [];
  const fixed = sorted?.filter(item => item.slot !== 'hero') ?? [];
  const nextOrder = heroes.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;

  const done = async (message: string) => { setEditing(null); await run(async () => { await load(); return message; }); };

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="البانرات والأقسام"
        lead="كل صورة ونص يظهر في الصفحات العامة. اضغط على أي بطاقة لتعديلها؛ التغيير يظهر للزوار فور الحفظ."
        actions={<>
          <button type="button" className="tmk-button tmk-button--primary" onClick={() => setEditing({ kind: 'new' })}><Plus aria-hidden="true" size={18} />شريحة جديدة</button>
          <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/')} target="_blank" rel="noreferrer"><Eye aria-hidden="true" size={18} />معاينة الموقع</a>
        </>} />
      {!sorted ? <Skeleton lines={6} label="جارٍ التحميل" /> : <>
        <h2 className="tmk-admin-heading">شرائح الصفحة الرئيسية <span>{heroes.filter(item => item.active).length} ظاهرة من {heroes.length}</span></h2>
        <div className="tmk-admin-cards">
          {heroes.map((item, index) => <ContentCard key={`${item.id}-${item.version}`} item={item} number={index + 1} onOpen={() => setEditing({ kind: 'item', item })} run={run} reload={load} canDelete={heroes.length > 1} />)}
          <button type="button" className="tmk-admin-card tmk-admin-card--add" onClick={() => setEditing({ kind: 'new' })}>
            <Plus aria-hidden="true" size={32} />
            <strong>شريحة جديدة</strong>
            <span>العنوان والنص والصورة في خطوة واحدة</span>
          </button>
        </div>
        <h2 className="tmk-admin-heading">الأقسام الثابتة <span>بطاقات المسارات وبانرات الصفحات</span></h2>
        <div className="tmk-admin-cards">
          {fixed.map(item => <ContentCard key={`${item.id}-${item.version}`} item={item} onOpen={() => setEditing({ kind: 'item', item })} run={run} reload={load} canDelete={false} />)}
        </div>
      </>}
      {editing ? (
        <ContentDialog key={editing.kind === 'item' ? `${editing.item.id}-${editing.item.version}` : 'new'}
          item={editing.kind === 'item' ? editing.item : null} nextOrder={nextOrder}
          canDelete={editing.kind === 'item' && editing.item.slot === 'hero' && heroes.length > 1}
          onClose={() => setEditing(null)} onDone={done} />
      ) : null}
    </>
  );
}

function ContentCard({ item, number, onOpen, run, reload, canDelete }: {
  item: AdminItem; number?: number; onOpen: () => void; run: Run; reload: () => Promise<void>; canDelete: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const hero = item.slot === 'hero';
  const act = (work: () => Promise<string>) => { setBusy(true); void run(async () => { const message = await work(); await reload(); return message; }).finally(() => setBusy(false)); };
  return (
    <article className="tmk-admin-card" data-hidden={item.active ? undefined : 'true'}>
      <button type="button" className="tmk-admin-card__open" onClick={onOpen} aria-label={`تعديل ${item.title.ar || SLOT_LABELS[item.slot]}`}>
        <span className="tmk-admin-card__media">
          <img src={item.imageUrl} alt="" loading="lazy" />
          {number ? <span className="tmk-admin-card__number">{number}</span> : null}
          <span className="tmk-admin-card__status"><StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'ظاهر' : 'مخفي'}</StatusBadge></span>
        </span>
        <span className="tmk-admin-card__body">
          <span className="tmk-admin-card__slot">{SLOT_LABELS[item.slot] ?? item.slot}</span>
          <strong>{item.title.ar || 'بلا عنوان'}</strong>
          {item.body.ar ? <span className="tmk-admin-card__text">{item.body.ar}</span> : null}
        </span>
      </button>
      <div className="tmk-admin-card__actions">
        {confirming ? <>
          <span className="tmk-admin-card__ask">حذف نهائي؟</span>
          <button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => act(async () => { await call(`/admin/site-content/items/${item.id}`, 'DELETE'); return 'حُذفت الشريحة.'; })}><Trash2 aria-hidden="true" size={16} />نعم، احذف</button>
          <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => setConfirming(false)}>تراجع</button>
        </> : <>
          <button type="button" className="tmk-button tmk-button--secondary" onClick={onOpen}><Pencil aria-hidden="true" size={16} />تعديل</button>
          {hero ? (
            <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => act(async () => {
              await call(`/admin/site-content/items/${item.id}`, 'PATCH', { version: item.version, active: !item.active });
              return item.active ? 'أُخفيت الشريحة.' : 'أصبحت الشريحة ظاهرة.';
            })}>{item.active ? <><EyeOff aria-hidden="true" size={16} />إخفاء</> : <><Eye aria-hidden="true" size={16} />إظهار</>}</button>
          ) : null}
          {hero ? (
            <button type="button" className="tmk-button tmk-button--quiet tmk-admin-card__delete" disabled={busy || !canDelete} onClick={() => setConfirming(true)}
              title={canDelete ? undefined : 'لا يمكن حذف آخر شريحة'}><Trash2 aria-hidden="true" size={16} />حذف</button>
          ) : null}
        </>}
      </div>
    </article>
  );
}

/**
 * One editor for both creating and editing. The chosen photo shows at once from the local file
 * while it uploads; the upload only becomes visible to visitors when the form is saved.
 * Errors are shown inside the dialog, since the page behind it is inert while it is open.
 */
function ContentDialog({ item, nextOrder, canDelete, onClose, onDone }: {
  item: AdminItem | null; nextOrder: number; canDelete: boolean;
  onClose: () => void; onDone: (message: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const creating = item === null;
  const hero = creating || item.slot === 'hero';
  const [preview, setPreview] = useState(item?.imageUrl ?? '');
  const [pendingKey, setPendingKey] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    // No cleanup: removing the element ends the modal state, and closing it here would fire a
    // close event that reads as the admin cancelling (React's development double-mount runs the
    // cleanup straight after opening).
    if (node && !node.open) node.showModal();
  }, []);

  const attempt = async (work: () => Promise<string>) => {
    setBusy(true); setError('');
    try { await onDone(await work()); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); setBusy(false); }
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError('');
    const local = URL.createObjectURL(file);
    const before = preview;
    setPreview(local); setUploading(true);
    uploadImage(file)
      .then(uploaded => { setPendingKey(uploaded.imageKey); setPreview(uploaded.imageUrl); })
      .catch(e => { setPreview(before); setError(e instanceof Error ? e.message : 'تعذر رفع الصورة.'); })
      .finally(() => { setUploading(false); URL.revokeObjectURL(local); });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploading) { setError('انتظر حتى يكتمل رفع الصورة.'); return; }
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const titleAr = value('titleAr');
    const common = {
      titleAr, titleEn: value('titleEn') || (creating ? titleAr : ''), bodyAr: value('bodyAr'), bodyEn: value('bodyEn'),
      ctaLabelAr: value('ctaLabelAr'), ctaLabelEn: value('ctaLabelEn'),
      ...(value('ctaHref') ? { ctaHref: value('ctaHref') } : {}),
      ...(hero && value('sortOrder') ? { sortOrder: Number(value('sortOrder')) } : {})
    };
    void attempt(async () => {
      if (creating) {
        await call('/admin/site-content/items', 'POST', { ...common, active: data.get('active') === 'on', ...(pendingKey ? { imageKey: pendingKey } : {}) });
        return data.get('active') === 'on' ? `أُضيفت الشريحة «${titleAr}» وظهرت في الصفحة الرئيسية.` : `أُضيفت الشريحة «${titleAr}» مخفية.`;
      }
      await call(`/admin/site-content/items/${item.id}`, 'PATCH', { version: item.version, ...common, ...(pendingKey !== undefined ? { imageKey: pendingKey } : {}) });
      return `حُفظ «${titleAr || SLOT_LABELS[item.slot]}».`;
    });
  };

  const text = (field: 'title' | 'body', lang: 'ar' | 'en') => item ? item[field][lang] : '';
  return (
    <dialog ref={dialog} className="tmk-dialog tmk-editor" aria-labelledby="tmk-editor-title" onClose={onClose} onCancel={() => onClose()}>
      <form onSubmit={save} className="tmk-editor__form">
        <header className="tmk-editor__head">
          <div>
            <p className="tmk-editor__eyebrow">{creating ? 'شريحة في الصفحة الرئيسية' : SLOT_LABELS[item.slot] ?? item.slot}</p>
            <h2 id="tmk-editor-title">{creating ? 'شريحة جديدة' : item.title.ar || 'تعديل'}</h2>
          </div>
          {!creating ? <StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'ظاهر للزوار' : 'مخفي'}</StatusBadge> : null}
          <button type="button" className="tmk-button tmk-button--quiet tmk-editor__close" onClick={onClose} aria-label="إغلاق"><X aria-hidden="true" size={20} /></button>
        </header>

        <div className="tmk-editor__body">
          <div className="tmk-editor__media">
            <label className="tmk-editor__drop" data-dragging={dragging ? 'true' : undefined} data-empty={preview ? undefined : 'true'}
              onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files?.[0]); }}>
              {preview ? <img src={preview} alt="" /> : null}
              <span className="tmk-editor__drop-hint">
                <ImagePlus aria-hidden="true" size={28} />
                <strong>{preview ? 'تغيير الصورة' : 'أضف صورة'}</strong>
                <span>اسحبها هنا أو اضغط للاختيار · PNG أو JPEG أو WebP حتى 8MB</span>
              </span>
              {uploading ? <span className="tmk-editor__uploading" role="status"><Loader2 aria-hidden="true" size={22} className="tmk-spin" />جارٍ رفع الصورة…</span> : null}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="tmk-visually-hidden" onChange={event => { pick(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            {creating && !preview ? <p className="tmk-field__hint">بلا صورة تُستخدم صورة افتراضية.</p> : null}
            {!creating && (item.imageKey || pendingKey) && pendingKey !== null ? (
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => { setPendingKey(null); setPreview(item.defaultImage); }}><RotateCcw aria-hidden="true" size={16} />العودة للصورة الافتراضية</button>
            ) : null}
            {pendingKey !== undefined && !creating ? <p className="tmk-field__hint">الصورة الجديدة تظهر للزوار بعد الحفظ.</p> : null}
          </div>

          <div className="tmk-editor__fields">
            <Field label="العنوان بالعربية" name="titleAr" value={text('title', 'ar')} required max={200} autoFocus={creating} />
            <Field label="العنوان بالإنجليزية" name="titleEn" value={text('title', 'en')} max={200} ltr hint={creating ? 'اتركه فارغًا ليُستخدم العنوان العربي.' : undefined} />
            <Field label="النص بالعربية" name="bodyAr" value={text('body', 'ar')} max={600} area />
            <Field label="النص بالإنجليزية" name="bodyEn" value={text('body', 'en')} max={600} area ltr />
            <Field label="نص الزر بالعربية" name="ctaLabelAr" value={item ? item.cta.label.ar : 'تصفّح المشاريع'} max={60} />
            <Field label="نص الزر بالإنجليزية" name="ctaLabelEn" value={item ? item.cta.label.en : 'Browse projects'} max={60} ltr />
            <Field label="رابط الزر" name="ctaHref" value={item ? item.cta.href : '/explore'} max={300} ltr hint="صفحة داخل الموقع، مثل ‎/explore‎ أو ‎/invest" />
            {hero ? <Field label="الترتيب في العرض" name="sortOrder" value={String(item ? item.sortOrder : nextOrder)} max={4} ltr numeric /> : null}
            {creating ? (
              <label className="check tmk-editor__publish"><input type="checkbox" name="active" defaultChecked /> إظهارها للزوار فور الإضافة</label>
            ) : null}
          </div>
        </div>

        {error ? <div className="tmk-editor__error"><Notice tone="danger" live="assertive">{error}</Notice></div> : null}

        <footer className="tmk-editor__foot">
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || uploading}>
            {creating ? <><Plus aria-hidden="true" size={18} />إضافة الشريحة</> : <><Save aria-hidden="true" size={18} />حفظ التغييرات</>}
          </button>
          <button type="button" className="tmk-button tmk-button--secondary" onClick={onClose} disabled={busy}>إلغاء</button>
          <span className="tmk-editor__spacer" />
          {!creating && hero ? (
            <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void attempt(async () => {
              await call(`/admin/site-content/items/${item.id}`, 'PATCH', { version: item.version, active: !item.active });
              return item.active ? 'أُخفيت الشريحة.' : 'أصبحت الشريحة ظاهرة.';
            })}>{item.active ? <><EyeOff aria-hidden="true" size={18} />إخفاء</> : <><Eye aria-hidden="true" size={18} />إظهار</>}</button>
          ) : null}
          {!creating && canDelete ? (
            confirmDelete ? (
              <button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => void attempt(async () => {
                await call(`/admin/site-content/items/${item.id}`, 'DELETE');
                return 'حُذفت الشريحة.';
              })}><Trash2 aria-hidden="true" size={18} />تأكيد الحذف نهائيًا</button>
            ) : (
              <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" size={18} />حذف</button>
            )
          ) : null}
        </footer>
      </form>
    </dialog>
  );
}

function Field({ label, name, value, max, required, area, ltr, hint, autoFocus, numeric }: {
  label: string; name: string; value: string; max: number; required?: boolean; area?: boolean; ltr?: boolean; hint?: string | undefined; autoFocus?: boolean; numeric?: boolean;
}) {
  const id = `field-${name}-${useId()}`;
  return (
    <div className={area ? 'tmk-field tmk-editor__wide' : 'tmk-field'} style={{ margin: 0 }}>
      <label className="tmk-field__label" htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {area
        ? <textarea className="tmk-field__control" id={id} name={name} defaultValue={value} maxLength={max} rows={3} dir={ltr ? 'ltr' : undefined} />
        : <input className="tmk-field__control" id={id} name={name} defaultValue={value} maxLength={max} required={required} dir={ltr ? 'ltr' : undefined} autoFocus={autoFocus} inputMode={numeric ? 'numeric' : undefined} />}
      {hint ? <p className="tmk-field__hint" style={{ margin: 0 }}>{hint}</p> : null}
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
