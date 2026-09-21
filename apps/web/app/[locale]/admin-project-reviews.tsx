'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader, Skeleton, StatusBadge,
  formatDate, formatMinorUnits, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * ADM-03 for project content review.
 *
 * A reviewer sees the submitted plan and decides. The screen never offers a decision control to
 * someone who cannot decide: the queue itself is refused without a current ContentReviewer grant
 * and MFA, and the server refuses a decision from anyone who belongs to the owning organisation.
 */

interface Me { user: { id: string }; platformRoles: string[] }
interface QueueItem {
  id: string; sequence: number; submittedAt: string;
  project: { id: string; title: string; type: string; state: string; version: number; assignedReviewerId: string | null; organization: { displayName: string; verification: string } };
}
interface Review {
  id: string; sequence: number; submittedAt: string;
  decision: { outcome: string; publicReason: string; decidedAt: string } | null;
  project: {
    id: string; title: string; summary: string; story: string; type: string; state: string; version: number;
    assignedReviewerId: string | null; publicLocationPrecision: string;
    organization: { displayName: string; verification: string; type: string };
    city: { nameAr: string; nameEn: string };
    campaign: { goalMinor: string; currency: string; policy: string; endsAt: string } | null;
    budgetLines: Array<{ id: string; label: string; amountMinor: string }>;
    milestones: Array<{ id: string; title: string; budgetMinor: string; weight: number }>;
    budgetTotalMinor: string; milestoneTotalMinor: string; weightTotal: number; planConsistent: boolean;
  };
}

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UnauthenticatedError('unauthenticated');
  if (!response.ok) throw new Error(message(payload?.error?.code, response.status));
  return payload.data;
};

function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء. مراجعة المحتوى تتطلب منحة سارية وتحققًا بخطوتين، ولا يراجع عضو الجهة مشروع جهته.',
    not_found: 'المراجعة غير متاحة لك، أو استلمها مراجع آخر.',
    conflict: 'تغيّرت حالة المشروع أو نسخته، أو صدر قرار بالفعل. حمّل الصفحة من جديد.',
    invalid_input: 'طلب التعديل أو الرفض يحتاج سببًا عامًا من 10 أحرف على الأقل.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

export function AdminProjectReviews({ locale, versionId }: { locale: Locale; versionId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await api('/me') as Me;
        if (!active) return;
        setMe(current);
        if (!current.platformRoles.includes('ContentReviewer')) return;
        if (versionId) setReview(await api(`/admin/reviews/project/${versionId}`) as Review);
        else setQueue(await api('/admin/reviews/project') as QueueItem[]);
      } catch (e) { if (active && !(e instanceof UnauthenticatedError)) setError(e instanceof Error ? e.message : 'تعذر تحميل المراجعات.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [versionId]);

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }
  const onSubmit = (work: (data: FormData) => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(() => work(data));
  };

  const shell = (children: ReactNode) => (
    <AppShell
      locale={locale} path={versionId ? `/admin/reviews/project/${versionId}` : '/admin/reviews/project'}
      signedIn={Boolean(me)}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}
    >
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L('/app')}>{t('personalWorkspace')}</a></li>
          <li><a href={L('/admin/reviews/project')}>مراجعة المشاريع</a></li>
          {versionId ? <li><span aria-current="page">نسخة مُرسلة</span></li> : null}
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={5} label={t('loading')} />);
  if (!me) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  if (!me.platformRoles.includes('ContentReviewer')) {
    return shell(<ErrorState title={t('forbiddenTitle')}>مراجعة المحتوى منحة منصة مستقلة عن عضوية الجهات، وتتطلب تحققًا بخطوتين مفعّلًا.</ErrorState>);
  }

  if (!versionId) {
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow="مراجعة المحتوى"
          title="مشاريع بانتظار المراجعة"
          lead="استلام المراجعة يمنعك ويمنع غيرك من قرارين متعارضين. لا تراجع مشروع جهة أنت عضو فيها."
        />
        <DataTable
          caption="نسخ مُرسلة للمراجعة"
          rows={queue}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا مراجعات معلقة">لا توجد نسخ مشاريع بانتظار قرار الآن.</EmptyState>}
          columns={[
            { key: 'title', header: 'المشروع', cell: row => <a href={L(`/admin/reviews/project/${row.id}`)}>{row.project.title}</a> },
            { key: 'org', header: 'الجهة', cell: row => <>{row.project.organization.displayName}{' '}<StatusBadge tone={row.project.organization.verification === 'verified' ? 'success' : 'warning'}>{row.project.organization.verification === 'verified' ? 'موثقة' : 'غير موثقة'}</StatusBadge></> },
            { key: 'sequence', header: 'النسخة', numeric: true, cell: row => String(row.sequence) },
            { key: 'submitted', header: 'أُرسلت', cell: row => formatDate(row.submittedAt, locale, true) },
            { key: 'assigned', header: 'الإسناد', cell: row => row.project.assignedReviewerId ? <StatusBadge tone="info">مستلمة</StatusBadge> : <StatusBadge tone="neutral">غير مستلمة</StatusBadge> }
          ]}
        />
      </>
    );
  }

  if (!review) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);

  const project = review.project;
  const currency = project.campaign?.currency ?? 'ILS';
  const mine = project.assignedReviewerId === me.user.id;
  // Totals come from the server; the browser never does money arithmetic (08-FINANCIAL-SYSTEM).
  const { budgetTotalMinor, milestoneTotalMinor, weightTotal, planConsistent } = project;

  return shell(
    <>
      <PageHeader
        eyebrow={`${project.organization.displayName} · النسخة ${review.sequence}`}
        title={project.title}
        lead={project.summary}
      />

      {project.organization.verification !== 'verified' ? (
        <Notice tone="warning" title="الجهة غير موثقة حاليًا">
          <p style={{ marginBlockEnd: 0 }}>لا يمكن نشر مشروع لجهة بلا توثيق سارٍ، حتى لو اعتُمد. يُعاد فحص التوثيق عند النشر.</p>
        </Notice>
      ) : null}

      {review.decision ? (
        <Notice tone={review.decision.outcome === 'approved' ? 'success' : review.decision.outcome === 'rejected' ? 'danger' : 'warning'} title="صدر قرار لهذه النسخة">
          <p style={{ marginBlockEnd: 0 }}>{review.decision.publicReason || 'لا ملاحظة عامة.'} · {formatDate(review.decision.decidedAt, locale, true)}</p>
        </Notice>
      ) : null}

      <Card title="الخطة المُرسلة">
        <dl>
          <div><dt>المسار</dt><dd>{project.type === 'charity' ? 'خيري' : project.type === 'venture' ? 'استثمار' : 'تمكين'}</dd></div>
          <div><dt>المدينة</dt><dd>{locale === 'ar' ? project.city.nameAr : project.city.nameEn}</dd></div>
          <div><dt>دقة الموقع المعلن</dt><dd>{project.publicLocationPrecision === 'city' ? 'المدينة فقط' : project.publicLocationPrecision === 'approximate' ? 'تقريبي' : 'منشأة عامة'}</dd></div>
          {project.campaign ? (
            <>
              <div><dt>هدف التمويل</dt><dd><span className="tmk-money">{formatMinorUnits(project.campaign.goalMinor)} {currency}</span></dd></div>
              <div><dt>سياسة التمويل</dt><dd>{project.campaign.policy === 'flexible' ? 'مرنة' : 'الكل أو لا شيء'}</dd></div>
              <div><dt>ينتهي الجمع</dt><dd>{formatDate(project.campaign.endsAt, locale)}</dd></div>
            </>
          ) : null}
          <div><dt>مجموع الميزانية</dt><dd><span className="tmk-money">{formatMinorUnits(budgetTotalMinor)} {currency}</span></dd></div>
          <div><dt>مجموع ميزانيات المراحل</dt><dd><span className="tmk-money">{formatMinorUnits(milestoneTotalMinor)} {currency}</span></dd></div>
          <div><dt>مجموع الأوزان</dt><dd>{weightTotal}%</dd></div>
        </dl>
        {!planConsistent ? (
          <Notice tone="warning">
            <p style={{ marginBlockEnd: 0 }}>الخطة غير متسقة: تحقق من تطابق ميزانيات المراحل مع بنود الميزانية ومن أن مجموع الأوزان 100.</p>
          </Notice>
        ) : null}
        {project.story ? <><h3>القصة العامة</h3><div className="tmk-prose">{project.story.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></> : null}
      </Card>

      <Card title="بنود الميزانية">
        <DataTable
          caption="بنود الميزانية المُرسلة"
          rows={project.budgetLines}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا بنود" />}
          columns={[
            { key: 'label', header: 'البند', cell: row => row.label },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <span className="tmk-money">{formatMinorUnits(row.amountMinor)} {currency}</span> }
          ]}
        />
      </Card>

      <Card title="المراحل">
        <DataTable
          caption="المراحل المُرسلة"
          rows={project.milestones}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا مراحل" />}
          columns={[
            { key: 'title', header: 'المرحلة', cell: row => row.title },
            { key: 'budget', header: 'الميزانية', numeric: true, cell: row => <span className="tmk-money">{formatMinorUnits(row.budgetMinor)} {currency}</span> },
            { key: 'weight', header: 'الوزن', numeric: true, cell: row => `${row.weight}%` }
          ]}
        />
      </Card>

      {!review.decision ? (
        <Card title="القرار">
          {!mine ? (
            <>
              <p>استلم المراجعة أولًا. الاستلام ذري، فلا يتخذ مراجعان قرارين متعارضين على النسخة نفسها.</p>
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                await api(`/admin/reviews/project/${review.id}/claim`, 'POST', {});
                setReview(await api(`/admin/reviews/project/${review.id}`));
                setNotice('استلمت المراجعة.');
              })}>استلام المراجعة</button>
            </>
          ) : (
            <form onSubmit={onSubmit(async data => {
              const outcome = String(data.get('outcome'));
              const publicReason = String(data.get('publicReason') ?? '');
              if (outcome !== 'approved' && publicReason.trim().length < 10) throw new Error('اكتب سببًا عامًا واضحًا من 10 أحرف على الأقل.');
              await api(`/admin/reviews/project/${review.id}/decision`, 'POST', { outcome, publicReason, version: project.version });
              setReview(await api(`/admin/reviews/project/${review.id}`));
              setNotice(outcome === 'approved'
                ? 'اعتُمد المشروع. الاعتماد يسمح بالنشر ولا ينشر بذاته؛ انشره من الزر أدناه بعد إعادة فحص التوثيق.'
                : 'سُجّل القرار وأُعيدت الخطة إلى الجهة.');
            })}>
              <label className="field">القرار
                <select name="outcome" defaultValue="approved">
                  <option value="approved">اعتماد</option>
                  <option value="changes_requested">طلب تعديلات</option>
                  <option value="rejected">رفض</option>
                </select>
              </label>
              <label className="field">السبب العام — يظهر للجهة، ومطلوب عند طلب التعديل أو الرفض
                <textarea name="publicReason" rows={3} maxLength={1000} />
              </label>
              <button type="submit" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'تسجيل القرار'}</button>
            </form>
          )}
          <p className="note">القرار سجل غير قابل للتعديل أو الحذف. الاختلاف لاحقًا ينتج قرارًا جديدًا على نسخة جديدة.</p>
        </Card>
      ) : null}

      {review.decision?.outcome === 'approved' && project.state === 'approved' ? (
        <Card title="النشر">
          <p>
            الاعتماد لا ينشر. عند النشر يُعاد فحص توثيق الجهة واكتمال الخطة، لأن التوثيق قد ينتهي بين الاعتماد والنشر.
          </p>
          <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
            const published = await api(`/admin/projects/${project.id}/publish`, 'POST', { version: project.version }) as { slug: string };
            setNotice('نُشر المشروع وصار ظاهرًا للجمهور.');
            window.location.assign(L(`/projects/${published.slug}`));
          })}>نشر المشروع</button>
        </Card>
      ) : null}
    </>
  );
}
