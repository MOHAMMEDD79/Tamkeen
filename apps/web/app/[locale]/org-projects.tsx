'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader, Skeleton, StatusBadge,
  formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * ORG-06 (project list) and ORG-07 (draft editor) for PART-04.
 *
 * Kept out of the identity workspace so that file stops growing, and because these screens need
 * their own data. Permission is still decided by the server on every call: the UI only hides
 * controls the actor could not use, which is presentation rather than protection (02-IDENTITY).
 */

type Locale2 = Locale;

interface Context { organization: { id: string; displayName: string; type: string }; roles: string[]; permissions: string[] }
interface Me { user: { id: string; name: string }; contexts: Context[] }
interface City { id: string; country: string; nameAr: string; nameEn: string }
interface Member { userId: string; status: string; roles: string[]; user: { name: string } }
interface OrgProject {
  id: string; slug: string; title: string; summary: string; type: string; state: string;
  version: number; publishedAt: string | null; updatedAt: string;
}

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) => {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UnauthenticatedError('unauthenticated');
  if (!response.ok) throw new Error(errorMessage(payload?.error?.code, response.status));
  return payload.data;
};

function errorMessage(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء في هذه الجهة.',
    not_found: 'المورد غير موجود ضمن هذه الجهة.',
    conflict: 'تغيّرت البيانات أو حالة المشروع. حمّل النسخة الأحدث وأعد المحاولة.',
    invalid_input: 'تحقق من الحقول: الملخص مطلوب قبل الإرسال للمراجعة، والموقع يجب أن يطابق دقته المعلنة.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

const stateLabels: Record<string, string> = {
  draft: 'مسودة', submitted: 'قيد المراجعة', in_review: 'تحت المراجعة',
  changes_requested: 'طلب تعديلات', approved: 'معتمد', published: 'منشور',
  executing: 'قيد التنفيذ', funding_closed: 'أُغلق الجمع', impact_review: 'مراجعة الأثر',
  completed: 'مكتمل', archived: 'مؤرشف', paused: 'موقوف', cancelled: 'ملغى', rejected: 'مرفوض'
};
const typeLabels: Record<string, string> = { charity: 'خيري', venture: 'استثمار', enablement: 'تمكين' };
const stateTone = (state: string) =>
  ['published', 'completed'].includes(state) ? 'success'
  : ['changes_requested', 'rejected', 'cancelled'].includes(state) ? 'danger'
  : ['submitted', 'in_review'].includes(state) ? 'info' : 'neutral';

export function OrgProjects({ locale, orgId, mode }: { locale: Locale2; orgId: string; mode: 'list' | 'new' }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<OrgProject[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [precision, setPrecision] = useState<'city' | 'approximate' | 'exact'>('city');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await api('/me') as Me;
        if (!active) return;
        setMe(current);
        const [list, cityList] = await Promise.all([api(`/orgs/${orgId}/projects`), api('/cities')]);
        if (!active) return;
        setProjects(list as OrgProject[]);
        setCities(cityList as City[]);
        if (mode === 'new') setMembers(await api(`/orgs/${orgId}/members`) as Member[]);
      } catch (e) { if (active && !(e instanceof UnauthenticatedError)) setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [orgId, mode]);

  const context = me?.contexts.find(item => item.organization.id === orgId);
  const canCreate = context?.permissions.includes('project.create') ?? false;
  const canSubmit = context?.permissions.includes('project.submit') ?? false;

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }
  const submitHandler = (work: (data: FormData) => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(() => work(data));
  };

  const shell = (children: ReactNode) => (
    <AppShell
      locale={locale}
      path={mode === 'new' ? `/org/${orgId}/projects/new` : `/org/${orgId}/projects`}
      signedIn={Boolean(me)}
      {...(context ? { activeContextName: context.organization.displayName } : {})}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}
    >
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L('/app')}>{t('personalWorkspace')}</a></li>
          <li><a href={L(`/org/${orgId}`)}>{context?.organization.displayName ?? '—'}</a></li>
          <li><span aria-current="page">{mode === 'new' ? 'مشروع جديد' : 'المشاريع'}</span></li>
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={5} label={t('loading')} />);
  if (!me) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  if (!context) return shell(<ErrorState title={t('forbiddenTitle')}>{t('forbiddenBody')}</ErrorState>);

  if (mode === 'new') {
    const eligibleManagers = members.filter(member => member.status === 'active');
    return shell(
      <>
        <PageHeader
          eyebrow="مشروع جديد"
          title="أنشئ مسودة مشروع"
          lead="النوع يُختار مرة واحدة ويثبت عند النشر. تغيير نموذج التمويل لاحقًا يعني مشروعًا مرتبطًا جديدًا، لا تعديل هذا."
        />
        {!canCreate
          ? <ErrorState title={t('forbiddenTitle')}>صلاحياتك في هذه الجهة تسمح بالقراءة دون الإنشاء.</ErrorState>
          : <Card title="تعريف المشروع">
              <form onSubmit={submitHandler(async data => {
                const created = await api(`/orgs/${orgId}/projects`, 'POST', {
                  type: data.get('type'),
                  title: data.get('title'),
                  summary: data.get('summary'),
                  story: data.get('story'),
                  cityId: data.get('cityId'),
                  managerId: data.get('managerId'),
                  publicLocationPrecision: precision,
                  latitude: precision === 'city' ? null : Number(data.get('latitude')),
                  longitude: precision === 'city' ? null : Number(data.get('longitude'))
                }) as OrgProject;
                window.location.assign(L(`/org/${orgId}/projects`));
                setNotice(`أُنشئت مسودة «${created.title}».`);
              })}>
                <label className="field">نوع المشروع — لا يتغير بعد النشر
                  <select name="type" required defaultValue="charity">
                    <option value="charity">خيري</option>
                    <option value="venture">استثمار</option>
                    <option value="enablement">تمكين</option>
                  </select>
                </label>
                <label className="field">اسم المشروع — من 5 إلى 140 حرفًا
                  <input name="title" required minLength={5} maxLength={140} />
                </label>
                <label className="field">ملخص عام — 30 حرفًا على الأقل قبل الإرسال للمراجعة
                  <textarea name="summary" rows={3} maxLength={300} />
                </label>
                <label className="field">القصة — نص عام يظهر في صفحة المشروع
                  <textarea name="story" rows={6} maxLength={20000} />
                </label>
                <label className="field">المدينة
                  <select name="cityId" required defaultValue="">
                    <option value="" disabled>اختر مدينة</option>
                    {cities.map(city => <option key={city.id} value={city.id}>{city.nameAr}</option>)}
                  </select>
                </label>
                <label className="field">مسؤول المشروع — عضو نشط في الجهة
                  <select name="managerId" required defaultValue="">
                    <option value="" disabled>اختر مسؤولًا</option>
                    {eligibleManagers.map(member => <option key={member.userId} value={member.userId}>{member.user.name}</option>)}
                  </select>
                </label>
                <label className="field">دقة الموقع المعلن
                  <select name="publicLocationPrecision" value={precision} onChange={event => setPrecision(event.target.value as typeof precision)}>
                    <option value="city">المدينة فقط — لا تُخزَّن إحداثيات</option>
                    <option value="approximate">تقريبي — يُنشر مقرّبًا إلى نحو كيلومتر</option>
                    <option value="exact">منشأة عامة محددة</option>
                  </select>
                </label>
                {precision === 'city' ? (
                  <p className="note">لن تُخزَّن إحداثيات لهذا المشروع. ما لا يُخزَّن لا يمكن أن يتسرب.</p>
                ) : (
                  <>
                    <Notice tone="warning">
                      <p style={{ marginBlockEnd: 0 }}>لا تُدخل موقع مستفيد أو عنوان سكن. الموقع المعلن يخص مكان تنفيذ عام فقط.</p>
                    </Notice>
                    <label className="field">خط العرض<input name="latitude" type="number" step="0.000001" min={-90} max={90} required /></label>
                    <label className="field">خط الطول<input name="longitude" type="number" step="0.000001" min={-180} max={180} required /></label>
                  </>
                )}
                <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المسودة'}</button>
              </form>
            </Card>}
      </>
    );
  }

  return shell(
    <>
      <PageHeader
        dashboard
        eyebrow={context.organization.displayName}
        title="مشاريع الجهة"
        lead="تشمل هذه القائمة المسودات، وهي غير مرئية للعامة. المشروع يظهر للجمهور بعد اعتماده ونشره."
        actions={canCreate ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/projects/new`)}>أنشئ مشروعًا</a> : undefined}
      />

      <DataTable
        caption="مشاريع الجهة وحالتها"
        rows={projects}
        rowKey={row => row.id}
        emptyState={
          <EmptyState
            title="لا مشاريع بعد"
            action={canCreate ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/projects/new`)}>أنشئ أول مشروع</a> : undefined}
          >
            أنشئ مسودة مشروع ثم أرسلها للمراجعة. لا يظهر المشروع للجمهور قبل اعتماده.
          </EmptyState>
        }
        columns={[
          { key: 'title', header: 'المشروع', cell: row => <><strong><a href={L(`/org/${orgId}/projects/${row.id}`)}>{row.title}</a></strong><p className="tmk-field__hint">{row.summary || 'لا ملخص بعد'}</p></> },
          { key: 'type', header: 'المسار', cell: row => typeLabels[row.type] ?? row.type },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={stateTone(row.state)}>{stateLabels[row.state] ?? row.state}</StatusBadge> },
          { key: 'updated', header: 'آخر تحديث', cell: row => formatDate(row.updatedAt, locale) },
          {
            key: 'actions', header: 'إجراءات',
            cell: row => (
              <span className="tmk-row__actions">
                {row.publishedAt ? <a className="tmk-button tmk-button--quiet" href={L(`/projects/${row.slug}`)}>الصفحة العامة</a> : null}
                {canSubmit && ['draft', 'changes_requested'].includes(row.state) ? (
                  <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                    await api(`/orgs/${orgId}/projects/${row.id}/submit`, 'POST', { version: row.version });
                    setProjects(await api(`/orgs/${orgId}/projects`));
                    setNotice('أُرسلت نسخة المشروع للمراجعة. لا يمكن تعديل المسودة أثناء المراجعة.');
                  })}>إرسال للمراجعة</button>
                ) : null}
                {canCreate ? (
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                    await api(`/orgs/${orgId}/projects/${row.id}/duplicate`, 'POST', {});
                    setProjects(await api(`/orgs/${orgId}/projects`));
                    setNotice('أُنشئت نسخة كمسودة. لا تُنسخ الأموال ولا المساهمون ولا الموافقات.');
                  })}>نسخ كمسودة</button>
                ) : null}
              </span>
            )
          }
        ]}
      />

      <Card title="قريبًا في هذه الشاشة">
        
        <article className="tmk-row">
          <div><strong>أرشفة مشروع</strong><p className="tmk-field__hint">تتطلب إغلاقًا وتسوية مالية مكتملة، وكلاهما يعتمد على الدفتر.</p></div>
          <StatusBadge tone="neutral">قريبًا</StatusBadge>
        </article>
      </Card>
    </>
  );
}
