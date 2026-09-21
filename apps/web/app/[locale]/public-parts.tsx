import { EmptyState, ErrorState, ProgressWithLabel, StatusBadge, formatDate, localePath, translator, type Locale } from '@tamkeen/ui';
import type { PublicOrganizationSummary, PublicProjectCard, ReadResult } from '../../lib/server-api';

/**
 * Shared pieces of the public surface. Kept here so every public list renders the same empty and
 * error states, which 20-UI-CONTRACT requires and which are easy to forget page by page.
 */

export const trackLabel = (type: string, locale: Locale) => {
  const labels: Record<string, { ar: string; en: string }> = {
    charity: { ar: 'خيري', en: 'Charity' },
    venture: { ar: 'استثمار', en: 'Investment' },
    enablement: { ar: 'تمكين', en: 'Enablement' }
  };
  return labels[type]?.[locale] ?? type;
};

export const stateLabel = (state: string, locale: Locale) => {
  const labels: Record<string, { ar: string; en: string }> = {
    published: { ar: 'يقبل التمويل', en: 'Accepting funding' },
    funding_closed: { ar: 'أُغلق الجمع', en: 'Fundraising closed' },
    executing: { ar: 'قيد التنفيذ', en: 'Executing' },
    impact_review: { ar: 'مراجعة الأثر', en: 'Impact review' },
    completed: { ar: 'مكتمل', en: 'Completed' },
    paused: { ar: 'موقوف مؤقتًا', en: 'Paused' }
  };
  return labels[state]?.[locale] ?? state;
};

export const stateTone = (state: string): 'success' | 'warning' | 'info' | 'neutral' =>
  state === 'completed' ? 'success' : state === 'paused' ? 'warning' : state === 'published' ? 'info' : 'neutral';

export function cityName(location: { city: { nameAr: string; nameEn: string } }, locale: Locale) {
  return locale === 'ar' ? location.city.nameAr : location.city.nameEn;
}

/** A failed read, shown as a failure rather than as an empty page. */
export function ReadError({ locale, result }: { locale: Locale; result: { status: number; requestId: string } }) {
  const t = translator(locale);
  const ar = locale === 'ar';
  return (
    <ErrorState
      title={result.status === 503 ? (ar ? 'الخادم غير متاح الآن' : 'The service is unavailable right now') : t('readFailedTitle')}
      requestId={result.requestId}
      retryLabel={t('referenceLabel')}
    >
      {result.status === 503
        ? (ar ? 'لم يستجب الخادم. هذه ليست نتيجة فارغة، بل تعذر قراءة.' : 'The API did not answer. This is a failed read, not an empty result.')
        : t('readFailedBody')}
    </ErrorState>
  );
}

export function ProjectCard({ project, locale }: { project: PublicProjectCard; locale: Locale }) {
  const ar = locale === 'ar';
  return (
    <article className="tmk-card">
      <p className="tmk-page-header__eyebrow">{trackLabel(project.type, locale)}</p>
      <h3 style={{ marginBlockStart: 0 }}>
        <a href={localePath(locale, `/projects/${project.slug}`)}>{project.title}</a>
      </h3>
      <p style={{ color: 'var(--tmk-color-muted)' }}>
        {project.organization.displayName} · {cityName(project.location, locale)}{' '}
        {project.organization.verified
          ? <StatusBadge tone="success" label={ar ? 'حالة التوثيق' : 'Verification status'}>{ar ? 'موثقة' : 'Verified'}</StatusBadge>
          : <StatusBadge tone="neutral" label={ar ? 'حالة التوثيق' : 'Verification status'}>{ar ? 'غير موثقة' : 'Not verified'}</StatusBadge>}
      </p>
      <p>{project.summary}</p>
      <p style={{ marginBlockEnd: 0 }}>
        <StatusBadge tone={stateTone(project.state)}>{stateLabel(project.state, locale)}</StatusBadge>
        {project.publishedAt ? <span className="tmk-field__hint"> · {ar ? 'نُشر' : 'Published'} {formatDate(project.publishedAt, locale)}</span> : null}
      </p>
    </article>
  );
}

export function OrganizationCard({ organization, locale }: { organization: PublicOrganizationSummary; locale: Locale }) {
  const ar = locale === 'ar';
  return (
    <article className="tmk-card">
      <h3 style={{ marginBlockStart: 0 }}>
        <a href={localePath(locale, `/organizations/${organization.slug}`)}>{organization.displayName}</a>
      </h3>
      <p style={{ color: 'var(--tmk-color-muted)' }}>{organization.type} · {organization.city}</p>
      <p style={{ marginBlockEnd: 0 }}>
        {organization.verified
          ? <StatusBadge tone="success">{ar ? 'موثقة' : 'Verified'}</StatusBadge>
          : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Not verified'}</StatusBadge>}
      </p>
    </article>
  );
}

/**
 * A track the product has not built yet. PART-04 forbids a false CTA for an unimplemented offering
 * or programme, so this says plainly that nothing is there and does not offer a button.
 */
export function TrackUnavailable({ locale, title, body, part }: { locale: Locale; title: string; body: string; part: string }) {
  const ar = locale === 'ar';
  return (
    <EmptyState title={title}>
      {body}
      <br />
      <span className="tmk-field__hint">{ar ? `يُبنى هذا المسار في ${part}.` : `This track is built in ${part}.`}</span>
    </EmptyState>
  );
}

/** Renders a list with its three mandatory outcomes: failure, emptiness, or results. */
export function PublicList<T>({ locale, result, empty, render }: {
  locale: Locale;
  result: ReadResult<T[]>;
  empty: { title: string; body: string };
  render: (items: T[]) => React.ReactNode;
}) {
  if (!result.ok) return <ReadError locale={locale} result={result} />;
  if (!result.data.length) return <EmptyState title={empty.title}>{empty.body}</EmptyState>;
  return <>{render(result.data)}</>;
}

export { ProgressWithLabel };

/**
 * PART-09. Why an offering will not take a commitment right now.
 *
 * The server sends a machine code rather than a sentence, so the reason is written in the reader's
 * language here. An unrecognised code is shown whole rather than dropped, because a blank space
 * where a reason should be is worse than an unfamiliar word.
 */
export function subscribeClosedReason(code: string, ar: boolean): string {
  const reasons: Record<string, { ar: string; en: string }> = {
    disclosure_revised: {
      ar: 'صدر إفصاح جديد وأُوقف العرض حتى يُتعامل مع الالتزامات القائمة على النسخة السابقة. الاكتتاب على نص تغيّر ليس اكتتابًا على ما قرأته.',
      en: 'A new disclosure was issued and the offering is suspended until commitments made against the previous version are dealt with. Subscribing against text that has changed is not subscribing to what you read.'
    },
    closing: { ar: 'أُغلق باب الاكتتاب وبدأت مرحلة التخصيص.', en: 'Subscription has closed and allocation has begun.' },
    round_ended: { ar: 'انتهت هذه الجولة.', en: 'This round has ended.' },
    not_open: { ar: 'لم يُفتح هذا العرض للاكتتاب بعد.', en: 'This offering has not opened for subscription yet.' },
    no_disclosure: { ar: 'لا يوجد إفصاح منشور، ولا التزام دون نص يُلتزم به.', en: 'There is no published disclosure, and there is no commitment without text to commit to.' },
    closing_date_passed: { ar: 'مضى تاريخ الإغلاق المعلن.', en: 'The published closing date has passed.' }
  };
  const reason = reasons[code];
  if (reason) return ar ? reason.ar : reason.en;
  return ar ? `الاكتتاب غير متاح (${code}).` : `Subscribing is unavailable (${code}).`;
}

/**
 * PART-10. How a programme's claim about work is written out.
 *
 * 07 forbids "10 jobs" standing on its own: the reader has to be told whether those are a target
 * the operator hopes for or an obligation it signed up to. The count never appears without its
 * kind, and "none" is written as a sentence rather than left blank.
 */
export function jobClaimLabel(program: { jobCommitmentKind: string; jobCount: number }, ar: boolean): string {
  if (program.jobCommitmentKind === 'committed') {
    return ar ? `${program.jobCount} وظيفة ملتزم بها بوثيقة` : `${program.jobCount} contractually committed`;
  }
  if (program.jobCommitmentKind === 'expected') {
    return ar ? `${program.jobCount} وظيفة مستهدفة، غير ملزمة` : `${program.jobCount} targeted, not committed`;
  }
  return ar ? 'لا وظائف معلنة' : 'No jobs advertised';
}
