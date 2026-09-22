import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppShell, Card, EmptyState, Ltr, MoneyAmount, Notice, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicJobCard, type PublicProgramCard } from '../../../lib/server-api';
import { readSiteContent } from '../../../lib/site-content';
import { ReadError, jobClaimLabel } from '../public-parts';
import { PageHero } from '../marketing';

/**
 * PUB-09. Training programmes.
 *
 * A programme and a job are separate things (07), and this page never blurs them: every programme
 * card states whether the work it mentions is a target or an obligation, and says plainly that
 * finishing the training entitles nobody to a post. PART-11 added the jobs themselves, in their own
 * section, with their own pay line — never folded into a programme's claim about work.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Training and work — Tamkeen', description: 'Training programmes from verified operators, with the seats, the schedule and the selection method each one publishes.' }
    : { title: 'التدريب والعمل — تمكين', description: 'برامج تدريب من جهات موثقة، ولكل برنامج مقاعده وجدوله وطريقة مفاضلته المعلنة.' };
}

/** The contract in words, with a fixed term always carrying its length. */
function jobContractLabel(type: string, months: number | null, ar: boolean): string {
  const labels: Record<string, { ar: string; en: string }> = {
    full_time: { ar: 'دوام كامل', en: 'Full time' },
    part_time: { ar: 'دوام جزئي', en: 'Part time' },
    fixed_term: { ar: 'عقد محدد المدة', en: 'Fixed term' },
    apprenticeship: { ar: 'تدرّج مهني', en: 'Apprenticeship' },
    temporary: { ar: 'مؤقت', en: 'Temporary' }
  };
  const label = labels[type];
  const base = label ? (ar ? label.ar : label.en) : type;
  if (type !== 'fixed_term' || !months) return base;
  return ar ? `${base} — ${months} شهرًا` : `${base} — ${months} months`;
}

const MODE_LABELS: Record<string, { ar: string; en: string }> = {
  in_person: { ar: 'حضوري', en: 'In person' },
  remote: { ar: 'عن بُعد', en: 'Remote' },
  hybrid: { ar: 'مدمج', en: 'Hybrid' }
};

/*
 * A photo that matches what the listing is about, picked from its title and skills. Listings carry
 * no photo of their own yet, and a topic photo reads better than the same image on every card.
 */
const TOPIC_PHOTOS: Array<[RegExp, string]> = [
  [/شمس|طاقة|كهرب|solar/i, 'work-solar'],
  [/ويب|برمج|مطو|واجهات|react|javascript|html|web/i, 'work-coding'],
  [/تصميم|جرافيك|هوية|design/i, 'work-design'],
  [/محاسب|مالي|موازن|account/i, 'work-accounting'],
  [/زراع|ري |الري|بيوت|مياه|مشتل|farm|irrigat/i, 'work-greenhouse'],
  [/حاسوب|رقمي|تدريب|مدرّب|مدرب|comput/i, 'work-classroom']
];
function topicPhoto(title: string, skills: string[]): string {
  const text = `${title} ${skills.join(' ')}`;
  const match = TOPIC_PHOTOS.find(([pattern]) => pattern.test(text));
  return `/media/defaults/${match ? match[1] : 'cover-work-1'}.jpg`;
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return <div className="tmk-opp__stat"><strong>{value}</strong><span>{label}</span></div>;
}

function OrgLine({ organization, city, ar }: { organization: PublicProgramCard['organization']; city: string; ar: boolean }) {
  return (
    <p className="tmk-opp__org">
      <span>{organization.displayName} · {city || organization.city}</span>
      {organization.verified ? <StatusBadge tone="success">{ar ? 'موثقة' : 'Verified'}</StatusBadge> : null}
    </p>
  );
}

export default async function Opportunities({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const [result, jobs, site] = await Promise.all([readPublic<PublicProgramCard[]>('/programs'), readPublic<PublicJobCard[]>('/jobs'), readSiteContent()]);

  return (
    <AppShell locale={locale} path="/opportunities"
      lead={<PageHero
        image={site.tracks.work?.imageUrl ?? '/media/defaults/track-work.jpg'}
        kicker={ar ? 'فرص تشغيل' : 'Jobs & training'}
        title={ar ? 'تدرّب، ثم اعمل' : 'Train, then work'}
        lead={ar
          ? 'برامج تدريب مجانية من جهات موثقة، ووظائف معلنة بأجرها وعقدها. البرنامج والوظيفة شيئان منفصلان: قبول التدريب ليس قبول وظيفة.'
          : 'Free training from verified organisations, and jobs published with their pay and contract. A programme and a job are separate: being accepted onto training is not being hired.'}>
        <p className="tmk-page-hero__links">
          <a className="tmk-button tmk-button--primary" href="#programs">{ar ? 'برامج التدريب' : 'Training programmes'}</a>
          <a className="tmk-button tmk-button--secondary" href="#jobs">{ar ? 'الوظائف' : 'Jobs'}</a>
        </p>
      </PageHero>}>

      <div className="tmk-section-row" id="programs">
        <div>
          <p className="tmk-kicker">{ar ? 'التدريب' : 'Training'}</p>
          <h2>{ar ? 'برامج التدريب' : 'Training programmes'}</h2>
        </div>
        {result.ok ? <span className="tmk-opp__count">{result.data.length} {ar ? 'برنامج مفتوح' : 'open'}</span> : null}
      </div>

      {!result.ok ? <ReadError locale={locale} result={result} /> : result.data.length === 0 ? (
        <EmptyState title={ar ? 'لا برامج مفتوحة الآن' : 'No programmes are open right now'}>
          {ar
            ? 'البرنامج لا يظهر هنا قبل أن يعتمده مراجع مستقل وتفتح الجهة المشغّلة التقديم.'
            : 'A programme does not appear here until an independent reviewer has approved it and the operator has opened applications.'}
        </EmptyState>
      ) : (
        <div className="tmk-opps">
          {result.data.map(program => {
            const href = localePath(locale, `/programs/${program.slug}`);
            return (
              <article className="tmk-opp tmk-reveal" key={program.slug}>
                <a className="tmk-opp__media" href={href} tabIndex={-1} aria-hidden="true">
                  <img src={topicPhoto(program.title, program.skills)} alt="" loading="lazy" />
                  <span className="tmk-opp__tags">
                    <span className="tmk-opp__tag">{MODE_LABELS[program.deliveryMode]?.[locale] ?? program.deliveryMode}</span>
                    {program.level ? <span className="tmk-opp__tag">{program.level}</span> : null}
                    {program.stipendOffered ? <span className="tmk-opp__tag tmk-opp__tag--warm">{ar ? 'بمكافأة' : 'Stipend'}</span> : null}
                  </span>
                </a>
                <div className="tmk-opp__body">
                  <OrgLine organization={program.organization} city={program.city} ar={ar} />
                  <h3 className="tmk-opp__title"><a href={href}>{program.title}</a></h3>
                  <div className="tmk-opp__stats">
                    <Stat value={<Ltr>{String(program.durationWeeks)}</Ltr>} label={ar ? 'أسبوعًا' : 'weeks'} />
                    <Stat value={<Ltr>{String(program.hoursPerWeek)}</Ltr>} label={ar ? 'ساعة أسبوعيًا' : 'hrs / week'} />
                    <Stat value={<Ltr>{String(program.capacity)}</Ltr>} label={ar ? 'مقعدًا' : 'seats'} />
                  </div>
                  {/* 07: the job figure always says which kind of claim it is. */}
                  <p className="tmk-opp__note">{jobClaimLabel(program, ar)}</p>
                  {program.skills.length ? <p className="tmk-opp__skills">{program.skills.map(skill => <span key={skill}>{skill}</span>)}</p> : null}
                </div>
                <div className="tmk-opp__foot">
                  <span>{ar ? 'يغلق التقديم ' : 'Closes '}<strong>{program.applyClosesAt ? formatDate(program.applyClosesAt, locale) : '—'}</strong></span>
                  <a className="tmk-button tmk-button--primary" href={href}>{ar ? 'التفاصيل والتقديم' : 'Details & apply'}</a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* PUB-11. Jobs, in their own section. A job's pay is stated on its own card, never inferred
          from whatever a programme claimed about work. */}
      <div className="tmk-section-row" id="jobs">
        <div>
          <p className="tmk-kicker">{ar ? 'الوظائف' : 'Jobs'}</p>
          <h2>{ar ? 'وظائف معلنة' : 'Published jobs'}</h2>
          <p className="tmk-field__hint" style={{ margin: 0 }}>{ar ? 'لكل إعلان نوع عقده ومكانه وأجره — أو سبب عدم إعلان الأجر مكتوبًا بنصه.' : 'Each listing states its contract, location and pay — or the written reason the pay is not published.'}</p>
        </div>
        {jobs.ok ? <span className="tmk-opp__count">{jobs.data.length} {ar ? 'وظيفة' : 'jobs'}</span> : null}
      </div>

      {!jobs.ok ? <ReadError locale={locale} result={jobs} /> : jobs.data.length === 0 ? (
        <EmptyState title={ar ? 'لا وظائف معلنة الآن' : 'No jobs are published right now'}>
          {ar
            ? 'الوظيفة لا تظهر هنا قبل أن تنشرها جهة موثقة باكتمال ما يقرره المتقدم.'
            : 'A job does not appear here until a verified employer publishes it with everything an applicant decides from.'}
        </EmptyState>
      ) : (
        <div className="tmk-opps">
          {jobs.data.map(job => {
            const href = localePath(locale, `/jobs/${job.slug}`);
            const paid = job.salaryDisclosed && job.salaryMinMinor && job.salaryCurrency;
            return (
              <article className="tmk-opp tmk-reveal" key={job.slug}>
                <a className="tmk-opp__media tmk-opp__media--short" href={href} tabIndex={-1} aria-hidden="true">
                  <img src={topicPhoto(job.title, job.skills)} alt="" loading="lazy" />
                  <span className="tmk-opp__tags">
                    <span className="tmk-opp__tag tmk-opp__tag--warm">{jobContractLabel(job.contractType, job.contractMonths, ar)}</span>
                    <span className="tmk-opp__tag">{MODE_LABELS[job.deliveryMode]?.[locale] ?? job.deliveryMode}</span>
                  </span>
                </a>
                <div className="tmk-opp__body">
                  <OrgLine organization={job.organization} city={job.city} ar={ar} />
                  <h3 className="tmk-opp__title"><a href={href}>{job.title}</a></h3>
                  {/* Never a blank: either the figures, or the stated reason they are absent. */}
                  <div className="tmk-opp__pay">
                    {paid ? (
                      <>
                        <strong>
                          <MoneyAmount minor={job.salaryMinMinor!} currency={job.salaryCurrency!} locale={locale} />
                          {job.salaryMaxMinor && job.salaryMaxMinor !== job.salaryMinMinor ? <> – <MoneyAmount minor={job.salaryMaxMinor} currency={job.salaryCurrency!} locale={locale} /></> : null}
                        </strong>
                        <span>{job.salaryPeriod || (ar ? 'الأجر' : 'pay')}</span>
                      </>
                    ) : (
                      <>
                        <strong>{ar ? 'الأجر غير معلن' : 'Pay not published'}</strong>
                        <span>{job.salaryUndisclosedReason}</span>
                      </>
                    )}
                  </div>
                  <div className="tmk-opp__stats">
                    <Stat value={<Ltr>{String(job.openings)}</Ltr>} label={ar ? (job.openings === 1 ? 'شاغر' : 'شواغر') : 'openings'} />
                  </div>
                  {job.skills.length ? <p className="tmk-opp__skills">{job.skills.map(skill => <span key={skill}>{skill}</span>)}</p> : null}
                </div>
                <div className="tmk-opp__foot">
                  <span>{ar ? 'آخر موعد ' : 'Closes '}<strong>{job.closesAt ? formatDate(job.closesAt, locale) : '—'}</strong></span>
                  <a className="tmk-button tmk-button--primary" href={href}>{ar ? 'التفاصيل والتقديم' : 'Details & apply'}</a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 00-MASTER-PROMPT: the reason stands where the missing section would be. */}
      <Card title={ar ? 'التطوع' : 'Volunteering'}>
        <Notice tone="info" title={ar ? 'غير متاح في هذه النسخة' : 'Not available in this build'}>
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'فرص التطوع لم تُبنَ بعد. لا تبويب فارغ يوحي بأنها موجودة ولا نتائج فيها.'
              : 'Volunteering opportunities have not been built. There is no empty tab implying they exist but returned nothing.'}
          </p>
        </Notice>
      </Card>

      <nav className="tmk-inline-links">
        <a href={localePath(locale, '/app/career/profile')}>{ar ? 'ملف المهارات' : 'Your skills profile'}</a>
        <a href={localePath(locale, '/app/jobs')}>{ar ? 'طلباتي على الوظائف' : 'Your job applications'}</a>
        <a href={localePath(locale, '/explore')}>{ar ? 'استكشف المشاريع المنشورة' : 'Explore published projects'}</a>
        <a href={localePath(locale, '/about')}>{ar ? 'عن تمكين وحدود النسخة' : 'About Tamkeen and this build’s limits'}</a>
      </nav>
    </AppShell>
  );
}
