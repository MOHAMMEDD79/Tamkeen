'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Eye, EyeOff, ImagePlus, Inbox, Loader2, MailOpen, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react';
import { AppShell, EmptyState, Notice, PageHeader, Skeleton, StatusBadge, formatDate, localePath, type Locale } from '@tamkeen/ui';
import { SECTIONS, SECTION_BY_SLOT, SETTING_FIELDS, SITE_PAGES, resolveSection, type PageKey, type SectionDef, type SectionField } from '../../lib/site-sections';

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
  id: string; slot: string; sortOrder: number; kicker?: Text; title: Text; body: Text;
  cta: { label: Text; href: string }; imageKey: string | null; imageUrl: string; defaultImage: string;
  active: boolean; version: number; updatedAt: string;
}
interface ContactMessage { id: string; name: string; email: string; subject: string; body: string; locale: string; state: 'new' | 'read' | 'archived'; createdAt: string; readAt: string | null }

class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const messages: Record<string, string> = {
  conflict: 'تغيّر هذا العنصر من مكان آخر، أو أن العملية ستترك الصفحة الرئيسية بلا شريحة ظاهرة. حدّث الصفحة ثم أعد المحاولة.',
  invalid_input: 'راجع الحقول: الرابط يجب أن يبدأ بـ / داخل الموقع، والصورة PNG أو JPEG أو WebP حتى 8MB و6000×6000.',
  forbidden: 'هذه الصفحة لمدير المنصة فقط، ويجب تفعيل التحقق بخطوتين في حسابك.',
  not_found: 'العنصر غير موجود أو حُذف.'
};

export async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
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

type Mode = 'content' | 'pages' | 'settings' | 'covers' | 'messages';
const MODE_PATHS: Record<Mode, string> = { content: '/admin/site', pages: '/admin/site/pages', settings: '/admin/site/settings', covers: '/admin/site/covers', messages: '/admin/messages' };

export function SiteAdmin({ locale, mode }: { locale: Locale; mode: Mode }) {
  const L = (path: string) => localePath(locale, path);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useCallback(async (work: () => Promise<string | void>) => {
    setError(''); setNotice('');
    try { const done = await work(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); }
  }, []);
  return (
    <AppShell locale={locale} path={MODE_PATHS[mode]} signedIn
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>لوحتي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {mode === 'content' ? <ContentEditor run={run} locale={locale} />
        : mode === 'pages' ? <PagesEditor run={run} locale={locale} />
        : mode === 'settings' ? <SettingsEditor run={run} locale={locale} />
        : mode === 'covers' ? <ListingsEditor run={run} locale={locale} /> : <MessageInbox run={run} locale={locale} />}
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
  const fixed = sorted?.filter(item => item.slot !== 'hero' && HERO_ORDER.includes(item.slot)) ?? [];
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
      ...(hero ? {} : { kickerAr: value('kickerAr'), kickerEn: value('kickerEn') }),
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
            {!hero ? <>
              <Field label="العنوان الصغير بالعربية" name="kickerAr" value={item?.kicker?.ar ?? ''} max={80} />
              <Field label="العنوان الصغير بالإنجليزية" name="kickerEn" value={item?.kicker?.en ?? ''} max={80} ltr />
            </> : null}
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

export function Field({ label, name, value, max, required, area, ltr, hint, autoFocus, numeric }: {
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

type ListingTab = 'projects' | 'offerings' | 'programs' | 'jobs';
interface ListingRow { id: string; slug: string; title: string; state: string; type?: string; organization: { displayName: string; status: string }; coverUrl: string | null }

const LISTING_TABS: Array<{ key: ListingTab; label: string; kind: 'project' | 'offering' | 'program' | 'job'; path: string; fallback: string }> = [
  { key: 'projects', label: 'المشاريع', kind: 'project', path: '/projects', fallback: '/media/defaults/cover-charity-1.jpg' },
  { key: 'offerings', label: 'عروض الاستثمار', kind: 'offering', path: '/invest', fallback: '/media/defaults/cover-invest-1.jpg' },
  { key: 'programs', label: 'برامج التدريب', kind: 'program', path: '/programs', fallback: '/media/defaults/cover-work-1.jpg' },
  { key: 'jobs', label: 'الوظائف', kind: 'job', path: '/jobs', fallback: '/media/defaults/cover-work-2.jpg' }
];
const PROJECT_TYPES: Record<string, string> = { charity: 'خيري', venture: 'استثماري', enablement: 'تمكين' };

/**
 * Every listing on the platform — projects of all three tracks, investment offerings, training
 * programmes and jobs — with the photo the public card shows. The admin sets or removes it here;
 * a listing without one shows its track's default photo.
 */
function ListingsEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [data, setData] = useState<Record<ListingTab, ListingRow[]> | null>(null);
  const [tab, setTab] = useState<ListingTab>('projects');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => setData(await call<Record<ListingTab, ListingRow[]>>('/admin/listings')), []);
  useEffect(() => { void run(load); }, [run, load]);
  const current = LISTING_TABS.find(entry => entry.key === tab)!;
  const coverPath = (row: ListingRow) => current.kind === 'project' ? `/admin/projects/${row.id}/cover` : `/admin/listings/${current.kind}/${row.id}/cover`;

  const upload = (row: ListingRow, file: File | undefined) => {
    if (!file) return;
    setBusy(row.id);
    void run(async () => {
      const uploaded = await uploadImage(file);
      await call(coverPath(row), 'PUT', { imageKey: uploaded.imageKey });
      await load(); return `تغيّرت صورة «${row.title}».`;
    }).finally(() => setBusy(''));
  };
  const needle = query.trim().toLowerCase();
  const rows = (data?.[tab] ?? []).filter(row => !needle || `${row.title} ${row.organization.displayName}`.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="المشاريع والفرص"
        lead="كل مشروع وعرض استثمار وبرنامج تدريب ووظيفة على المنصة، بالصورة التي تظهر في بطاقته للزوار. غيّر الصورة أو أزلها لتعود صورة المسار الافتراضية. لإخفاء كل ما لجهة ما، أوقف الجهة من «الجهات»." />
      <div className="tmk-admin-toolbar">
        <label className="tmk-admin-search">
          <Search aria-hidden="true" size={18} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالعنوان أو الجهة" aria-label="بحث" />
        </label>
        <nav className="tmk-pills" aria-label="نوع القائمة">
          {LISTING_TABS.map(entry => (
            <button key={entry.key} type="button" className="tmk-pill" aria-current={entry.key === tab ? 'true' : undefined} onClick={() => setTab(entry.key)}>
              {entry.label}<span className="tmk-pill__count">{data?.[entry.key].length ?? '…'}</span>
            </button>
          ))}
        </nav>
      </div>
      {!data ? <Skeleton lines={6} label="جارٍ التحميل" /> : rows.length === 0 ? <EmptyState title="لا شيء هنا بعد" /> : (
        <div className="tmk-admin-cards">
          {rows.map(row => (
            <article className="tmk-admin-card" key={row.id} data-hidden={row.organization.status !== 'active' ? 'true' : undefined}>
              <a className="tmk-admin-card__open" href={localePath(locale, `${current.path}/${row.slug}`)} target="_blank" rel="noreferrer">
                <span className="tmk-admin-card__media">
                  <img src={row.coverUrl ?? current.fallback} alt="" loading="lazy" />
                  <span className="tmk-admin-card__status"><StatusBadge tone={row.coverUrl ? 'success' : 'neutral'}>{row.coverUrl ? 'صورة مخصصة' : 'صورة افتراضية'}</StatusBadge></span>
                  {busy === row.id ? <span className="tmk-editor__uploading" role="status"><Loader2 aria-hidden="true" size={22} className="tmk-spin" />جارٍ الرفع…</span> : null}
                </span>
                <span className="tmk-admin-card__body">
                  <span className="tmk-admin-card__slot">{row.type ? PROJECT_TYPES[row.type] ?? row.type : current.label} · {row.state}</span>
                  <strong>{row.title}</strong>
                  <span className="tmk-admin-card__text">{row.organization.displayName}{row.organization.status !== 'active' ? ' · الجهة موقوفة' : ''}</span>
                </span>
              </a>
              <div className="tmk-admin-card__actions">
                <label className="tmk-button tmk-button--secondary" aria-disabled={busy === row.id}>
                  <ImagePlus aria-hidden="true" size={16} />{row.coverUrl ? 'استبدال الصورة' : 'رفع صورة'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy === row.id} onChange={event => { upload(row, event.target.files?.[0]); event.target.value = ''; }} />
                </label>
                {row.coverUrl ? (
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy === row.id} onClick={() => void run(async () => { await call(coverPath(row), 'DELETE'); await load(); return 'أُزيلت الصورة وعادت الصورة الافتراضية.'; })}><Trash2 aria-hidden="true" size={16} />إزالة</button>
                ) : null}
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

// ---------------------------------------------------------------- page sections

interface SavedRow {
  id: string; slot: string; version: number; imageKey: string | null; imageUrl: string;
  kicker: Text; title: Text; body: Text; cta: { label: Text; href: string }; cta2: { label: Text; href: string };
}

/**
 * Every section of every public page, grouped by page. A card shows what the page shows now (the
 * admin's saved text over the default); opening it edits that section in the same kind of dialog
 * as a banner, and "reset" returns it to the default copy and photo.
 */
function PagesEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [rows, setRows] = useState<SavedRow[] | null>(null);
  const [page, setPage] = useState<PageKey>('home');
  const [editing, setEditing] = useState<SectionDef | null>(null);
  const load = useCallback(async () => {
    const content = await call<{ items: SavedRow[] }>('/admin/site-content');
    setRows(content.items.filter(item => SECTION_BY_SLOT.has(item.slot)));
  }, []);
  useEffect(() => { void run(load); }, [run, load]);
  const saved = (slot: string) => rows?.find(row => row.slot === slot);
  const sections = SECTIONS.filter(entry => entry.page === page);
  const current = SITE_PAGES.find(entry => entry.key === page)!;
  const done = async (message: string) => { setEditing(null); await run(async () => { await load(); return message; }); };

  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="صفحات الموقع"
        lead="كل نص وصورة في كل صفحة عامة. افتح أي قسم لتعديله؛ الحقل الذي تتركه فارغًا يعود لنصه الافتراضي، و«استعادة الافتراضي» تلغي كل تعديلاتك على القسم."
        actions={<a className="tmk-button tmk-button--secondary" href={localePath(locale, current.path)} target="_blank" rel="noreferrer"><Eye aria-hidden="true" size={18} />معاينة «{current.label}»</a>} />
      <nav className="tmk-pills" aria-label="الصفحات">
        {SITE_PAGES.map(entry => (
          <button key={entry.key} type="button" className="tmk-pill" aria-current={entry.key === page ? 'true' : undefined} onClick={() => setPage(entry.key)}>
            {entry.label}<span className="tmk-pill__count">{SECTIONS.filter(section => section.page === entry.key).length}</span>
          </button>
        ))}
      </nav>
      {page === 'home' || page === 'about' || page === 'contact' ? (
        <Notice tone="info">
          {page === 'home' ? 'شرائح البانر الرئيسي وبطاقات المسارات الثلاثة تُدار من ' : 'البانر العلوي لهذه الصفحة (صورته وعنوانه) يُدار من '}
          <a href={localePath(locale, '/admin/site')}>البانرات والأقسام</a>.
        </Notice>
      ) : null}
      {!rows ? <Skeleton lines={6} label="جارٍ التحميل" /> : (
        <div className="tmk-admin-cards">
          {sections.map(entry => {
            const row = saved(entry.slot);
            const shown = resolveSection(entry.slot, row ? { ...row, cta: row.cta.href ? row.cta : null, cta2: row.cta2.href ? row.cta2 : null, imageUrl: row.imageKey ? row.imageUrl : null } : undefined);
            return (
              <article className="tmk-admin-card" key={entry.slot}>
                <button type="button" className="tmk-admin-card__open" onClick={() => setEditing(entry)} aria-label={`تعديل ${entry.label}`}>
                  {entry.fields.includes('image') ? (
                    <span className="tmk-admin-card__media">
                      <img src={shown.image} alt="" loading="lazy" />
                      {row ? <span className="tmk-admin-card__status"><StatusBadge tone="success">معدّل</StatusBadge></span> : null}
                    </span>
                  ) : row ? <span className="tmk-admin-card__flag"><StatusBadge tone="success">معدّل</StatusBadge></span> : null}
                  <span className="tmk-admin-card__body">
                    <span className="tmk-admin-card__slot">{entry.label}</span>
                    <strong>{shown.title.ar || shown.kicker.ar || shown.body.ar.slice(0, 60) || entry.label}</strong>
                    {entry.fields.includes('body') && shown.body.ar && shown.title.ar ? <span className="tmk-admin-card__text">{shown.body.ar}</span> : null}
                  </span>
                </button>
                <div className="tmk-admin-card__actions">
                  <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setEditing(entry)}><Pencil aria-hidden="true" size={16} />تعديل</button>
                  {row ? (
                    <button type="button" className="tmk-button tmk-button--quiet" onClick={() => void run(async () => {
                      await call(`/admin/site-content/sections/${entry.slot}`, 'DELETE'); await load(); return `عاد «${entry.label}» إلى نصه الافتراضي.`;
                    })}><RotateCcw aria-hidden="true" size={16} />استعادة الافتراضي</button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing ? <SectionDialog key={editing.slot} def={editing} row={saved(editing.slot)} onClose={() => setEditing(null)} onDone={done} /> : null}
    </>
  );
}

function SectionDialog({ def, row, onClose, onDone }: { def: SectionDef; row: SavedRow | undefined; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = resolveSection(def.slot, row ? { ...row, cta: row.cta.href ? row.cta : null, cta2: row.cta2.href ? row.cta2 : null, imageUrl: row.imageKey ? row.imageUrl : null } : undefined);
  const [preview, setPreview] = useState(shown.image);
  const [pendingKey, setPendingKey] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const has = (field: SectionField) => def.fields.includes(field);

  useEffect(() => {
    // No cleanup: see ContentDialog.
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

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
    const pair = (prefix: string) => ({ [`${prefix}Ar`]: value(`${prefix}Ar`), [`${prefix}En`]: value(`${prefix}En`) });
    const body = {
      ...(row ? { version: row.version } : {}),
      ...(has('kicker') ? pair('kicker') : {}),
      ...(has('title') ? pair('title') : {}),
      ...(has('body') ? pair('body') : {}),
      ...(has('cta') ? { ...pair('ctaLabel'), ctaHref: value('ctaHref') } : {}),
      ...(has('cta2') ? { ...pair('cta2Label'), cta2Href: value('cta2Href') } : {}),
      ...(pendingKey !== undefined ? { imageKey: pendingKey } : {})
    };
    setBusy(true); setError('');
    call(`/admin/site-content/sections/${def.slot}`, 'PUT', body)
      .then(() => onDone(`حُفظ «${def.label}».`))
      .catch(e => { setError(e instanceof Error ? e.message : 'تعذر الحفظ.'); setBusy(false); });
  };

  const pair = (label: string, name: string, text: Text, options: { area?: boolean; max: number }) => (
    <>
      <Field label={`${label} بالعربية`} name={`${name}Ar`} value={text.ar} max={options.max} {...(options.area ? { area: true } : {})} />
      <Field label={`${label} بالإنجليزية`} name={`${name}En`} value={text.en} max={options.max} ltr {...(options.area ? { area: true } : {})} />
    </>
  );

  return (
    <dialog ref={dialog} className="tmk-dialog tmk-editor" aria-labelledby="tmk-section-title" onClose={onClose} onCancel={() => onClose()}>
      <form onSubmit={save} className="tmk-editor__form">
        <header className="tmk-editor__head">
          <div>
            <p className="tmk-editor__eyebrow">{SITE_PAGES.find(entry => entry.key === def.page)?.label}</p>
            <h2 id="tmk-section-title">{def.label}</h2>
          </div>
          <button type="button" className="tmk-button tmk-button--quiet tmk-editor__close" onClick={onClose} aria-label="إغلاق"><X aria-hidden="true" size={20} /></button>
        </header>
        <div className="tmk-editor__body" data-single={has('image') ? undefined : 'true'}>
          {has('image') ? (
            <div className="tmk-editor__media">
              <label className="tmk-editor__drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); pick(event.dataTransfer.files?.[0]); }}>
                {preview ? <img src={preview} alt="" /> : null}
                <span className="tmk-editor__drop-hint">
                  <ImagePlus aria-hidden="true" size={28} />
                  <strong>تغيير الصورة</strong>
                  <span>اسحبها هنا أو اضغط للاختيار · PNG أو JPEG أو WebP حتى 8MB</span>
                </span>
                {uploading ? <span className="tmk-editor__uploading" role="status"><Loader2 aria-hidden="true" size={22} className="tmk-spin" />جارٍ رفع الصورة…</span> : null}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="tmk-visually-hidden" onChange={event => { pick(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              {(row?.imageKey || pendingKey) && pendingKey !== null ? (
                <button type="button" className="tmk-button tmk-button--quiet" onClick={() => { setPendingKey(null); setPreview(def.defaults.image ?? ''); }}><RotateCcw aria-hidden="true" size={16} />الصورة الافتراضية</button>
              ) : null}
            </div>
          ) : null}
          <div className="tmk-editor__fields">
            {has('kicker') ? pair('العنوان الصغير', 'kicker', shown.kicker, { max: 80 }) : null}
            {has('title') ? pair('العنوان', 'title', shown.title, { max: 200 }) : null}
            {has('body') ? pair('النص', 'body', shown.body, { area: true, max: 1500 }) : null}
            {has('cta') ? <>
              {pair('نص الزر', 'ctaLabel', shown.cta?.label ?? { ar: '', en: '' }, { max: 60 })}
              <Field label="رابط الزر" name="ctaHref" value={shown.cta?.href ?? ''} max={300} ltr hint="صفحة داخل الموقع، مثل ‎/explore" />
            </> : null}
            {has('cta2') ? <>
              {pair('نص الزر الثاني', 'cta2Label', shown.cta2?.label ?? { ar: '', en: '' }, { max: 60 })}
              <Field label="رابط الزر الثاني" name="cta2Href" value={shown.cta2?.href ?? ''} max={300} ltr />
            </> : null}
          </div>
        </div>
        {error ? <div className="tmk-editor__error"><Notice tone="danger" live="assertive">{error}</Notice></div> : null}
        <footer className="tmk-editor__foot">
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || uploading}><Save aria-hidden="true" size={18} />حفظ التغييرات</button>
          <button type="button" className="tmk-button tmk-button--secondary" onClick={onClose} disabled={busy}>إلغاء</button>
        </footer>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- contact details

function SettingsEditor({ run, locale }: { run: Run; locale: Locale }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setValues((await call<{ values: Record<string, string> }>('/admin/site-settings')).values), []);
  useEffect(() => { void run(load); }, [run, load]);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(SETTING_FIELDS.map(field => [field.key, String(data.get(field.key) ?? '').trim()]));
    setBusy(true);
    void run(async () => { await call('/admin/site-settings', 'PUT', body); await load(); return 'حُفظت بيانات التواصل وظهرت في صفحة «تواصل معنا».'; }).finally(() => setBusy(false));
  };
  return (
    <>
      <PageHeader dashboard eyebrow="إدارة الموقع" title="بيانات التواصل"
        lead="البريد والهاتف والعنوان وروابط الشبكات الاجتماعية التي تظهر في صفحة «تواصل معنا». اترك الحقل فارغًا لإخفائه."
        actions={<a className="tmk-button tmk-button--secondary" href={localePath(locale, '/contact-us')} target="_blank" rel="noreferrer"><Eye aria-hidden="true" size={18} />معاينة الصفحة</a>} />
      {!values ? <Skeleton lines={6} label="جارٍ التحميل" /> : (
        <form className="tmk-card tmk-settings" onSubmit={save}>
          <h2>التواصل المباشر</h2>
          <div className="tmk-editor__fields">
            {SETTING_FIELDS.filter(field => field.key.startsWith('contact.')).map(field => <SettingField key={field.key} field={field} value={values[field.key] ?? ''} />)}
          </div>
          <h2>الشبكات الاجتماعية</h2>
          <div className="tmk-editor__fields">
            {SETTING_FIELDS.filter(field => field.key.startsWith('social.')).map(field => <SettingField key={field.key} field={field} value={values[field.key] ?? ''} />)}
          </div>
          <p className="tmk-row__actions" style={{ marginBlockEnd: 0 }}>
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}><Save aria-hidden="true" size={18} />حفظ</button>
          </p>
        </form>
      )}
    </>
  );
}

function SettingField({ field, value }: { field: typeof SETTING_FIELDS[number]; value: string }) {
  const id = `setting-${field.key.replace(/\./g, '-')}`;
  return (
    <div className="tmk-field" style={{ margin: 0 }}>
      <label className="tmk-field__label" htmlFor={id}>{field.label}</label>
      <input className="tmk-field__control" id={id} name={field.key} defaultValue={value} type={field.kind === 'url' ? 'url' : field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'} dir={field.ltr ? 'ltr' : undefined} maxLength={300} />
      {field.hint ? <p className="tmk-field__hint" style={{ margin: 0 }} dir="ltr">{field.hint}</p> : null}
    </div>
  );
}
