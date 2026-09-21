import { ArrowLeft, ArrowRight, GraduationCap, HandHeart, TrendingUp } from 'lucide-react';
import { AppShell, StatusBadge, formatDate, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOrganizationSummary, type PublicProjectCard } from '../../lib/server-api';
import { cityName, stateLabel, stateTone } from './public-parts';

export const dynamic = 'force-dynamic';

const copy = {
  ar: {
    seal: 'سجل عام لكل تمويل',
    title: 'كل مساهمة لها أثر.',
    titleMuted: 'وكل أثر له دليل.',
    lead: 'تمكين منصة تربط المتبرع والمستثمر والمتدرب بالجهة التي تنفّذ، وتُبقي كل مبلغ مرئيًا من لحظة دفعه حتى دليل التنفيذ وتقرير الإغلاق.',
    primary: 'تصفّح المشاريع',
    secondary: 'أنشئ حسابًا',
    ledgerTitle: 'السجل العام',
    ledgerLive: 'مباشر',
    ledgerEmpty: 'لا توجد مشاريع منشورة بعد.',
    ledgerAll: 'كل المشاريع',
    ledgerFoot: 'تُعرض المشاريع المنشورة فقط',
    verified: ' · موثقة',
    figures: { projects: 'مشروع منشور', organizations: 'جهة على المنصة', tracks: 'مسارات للأثر' },
    figuresNote: { projects: 'بعد مراجعة مستقلة', organizations: 'بملف عام وحالة توثيق', tracks: 'خيري، استثمار، تدريب إلى عمل' },
    tracksLabel: 'المسارات',
    tracksTitle: 'ثلاث طرق لصنع الفرق، بقاعدة واحدة.',
    tracksLead: 'لا يُحتسب شيء قبل أن يُثبت: لا مساهمة قبل تأكيد الدفع، ولا حصة قبل التخصيص، ولا وظيفة قبل بدء العمل فعلًا.',
    tracks: [
      { key: 'charity', title: 'العمل الخيري', body: 'ادعم مشروعًا لجهة موثقة بميزانية ومراحل معلنة، وتابع مساهمتك حتى دليل التنفيذ.', link: 'المشاريع الخيرية', href: '/explore' },
      { key: 'invest', title: 'الاستثمار', body: 'عروض شركات بإفصاح مرقّم وأداة واضحة. لا تُسجَّل ملكية قبل تخصيص يعتمده مراجع مستقل.', link: 'العروض الاستثمارية', href: '/invest' },
      { key: 'work', title: 'التدريب إلى العمل', body: 'برامج ممولة تنتهي بوظيفة تُحتسب من تاريخ البدء المؤكد، لا من عدد المسجلين.', link: 'البرامج والوظائف', href: '/opportunities' }
    ],
    processLabel: 'كيف تعمل',
    processTitle: 'من المبلغ إلى النتيجة، على مرأى من الجميع.',
    process: [
      { title: 'تنشر جهة موثقة مشروعًا', body: 'بميزانية مفصلة ومراحل بأوزان، بعد مراجعة مستقلة للمحتوى.' },
      { title: 'تساهم أو تستثمر أو تتقدم', body: 'يُقيَّد كل مبلغ بقيد مزدوج متوازن، ولكل طلب حالة واضحة.' },
      { title: 'يُوثَّق التنفيذ', body: 'لا صرف دون اعتماد ثانٍ، ولا مرحلة تُغلق دون دليل.' },
      { title: 'يُنشر الأثر', body: 'تقرير إغلاق بلقطة مجمدة لا تتغير بعد نشرها.' }
    ],
    principlesLabel: 'المبادئ',
    statementStart: 'الثقة لا تُطلب،',
    statementEm: 'تُبنى في النظام نفسه.',
    principles: [
      { term: 'التوثيق قبل التمويل', body: 'تمر كل جهة بمراجعة مستقلة لوثائقها قبل أن تجمع أي مبلغ.' },
      { term: 'دفتر بقيد مزدوج', body: 'كل رقم معروض له قيود متوازنة يمكن تدقيقها، لا أرقام مكتوبة باليد.' },
      { term: 'فصل الصلاحيات', body: 'من يطلب الصرف لا يعتمده، ومن يراجع جهة لا يملك فيها دورًا.' },
      { term: 'خصوصيتك محفوظة', body: 'تختار أن يظهر اسمك أو مبلغك للعامة، أو لا يظهر أي منهما.' }
    ],
    closingTitle: 'ابدأ من مشروع واحد.',
    closingBody: 'أنشئ حسابًا في دقيقة، وتابع كل ما تدعمه من مكان واحد.',
    closingButton: 'أنشئ حسابك'
  },
  en: {
    seal: 'A public record for every fund',
    title: 'Every contribution has an impact.',
    titleMuted: 'Every impact has evidence.',
    lead: 'Tamkeen connects donors, investors and trainees with the organisation doing the work, and keeps every amount visible from the moment it is paid to the delivery evidence and the closing report.',
    primary: 'Browse projects',
    secondary: 'Create an account',
    ledgerTitle: 'Public record',
    ledgerLive: 'Live',
    ledgerEmpty: 'No published projects yet.',
    ledgerAll: 'All projects',
    ledgerFoot: 'Only published projects are shown',
    verified: ' · verified',
    figures: { projects: 'published projects', organizations: 'organisations', tracks: 'tracks to impact' },
    figuresNote: { projects: 'after independent review', organizations: 'with a public profile and status', tracks: 'charity, investment, training to work' },
    tracksLabel: 'Tracks',
    tracksTitle: 'Three ways to make a difference, one rule.',
    tracksLead: 'Nothing counts until it is proven: no contribution before payment is confirmed, no stake before allocation, no job before work actually starts.',
    tracks: [
      { key: 'charity', title: 'Charity', body: 'Back a verified organisation’s project with a published budget and stages, and follow your contribution to delivery evidence.', link: 'Charity projects', href: '/explore' },
      { key: 'invest', title: 'Investment', body: 'Company offerings with numbered disclosures and a clear instrument. No ownership is recorded before an independently approved allocation.', link: 'Investment offerings', href: '/invest' },
      { key: 'work', title: 'Training into work', body: 'Funded programmes that end in a job, counted from a confirmed start date rather than from sign-ups.', link: 'Programmes and jobs', href: '/opportunities' }
    ],
    processLabel: 'How it works',
    processTitle: 'From amount to outcome, in plain view.',
    process: [
      { title: 'A verified organisation publishes', body: 'A detailed budget and weighted stages, after independent content review.' },
      { title: 'You contribute, invest or apply', body: 'Every amount is a balanced double entry, and every request has a clear state.' },
      { title: 'Delivery is documented', body: 'No payout without a second approval, no stage closed without evidence.' },
      { title: 'Impact is published', body: 'A closing report with a frozen snapshot that does not change once published.' }
    ],
    principlesLabel: 'Principles',
    statementStart: 'Trust is not asked for,',
    statementEm: 'it is built into the system.',
    principles: [
      { term: 'Verification before funding', body: 'Every organisation’s documents are independently reviewed before it raises anything.' },
      { term: 'Double-entry ledger', body: 'Every figure shown has balanced entries behind it that can be audited.' },
      { term: 'Segregation of duties', body: 'Whoever requests a payout cannot approve it, and reviewers hold no role in the organisation.' },
      { term: 'Your privacy, your choice', body: 'You choose whether your name or amount is shown publicly, or neither.' }
    ],
    closingTitle: 'Start with one project.',
    closingBody: 'Create an account in a minute and follow everything you support from one place.',
    closingButton: 'Create your account'
  }
} as const;

const trackIcons = { charity: HandHeart, invest: TrendingUp, work: GraduationCap } as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = (raw === 'en' ? 'en' : 'ar') satisfies Locale;
  const text = copy[locale];
  const Forward = locale === 'ar' ? ArrowLeft : ArrowRight;

  // The home page stays up when the API is down: the record and the figures simply show a dash.
  const [projects, organizations] = await Promise.all([
    readPublic<PublicProjectCard[]>('/projects'),
    readPublic<PublicOrganizationSummary[]>('/organizations')
  ]);
  const projectList = projects.ok ? projects.data : [];
  const figures = [
    { key: 'projects', value: projects.ok ? projectList.length : '—' },
    { key: 'organizations', value: organizations.ok ? organizations.data.length : '—' },
    { key: 'tracks', value: 3 }
  ] as const;

  return (
    <AppShell locale={locale} path="/">
      <section className="tmk-landing" aria-labelledby="home-title">
        <div>
          <p className="tmk-landing__seal">{text.seal}</p>
          <h1 id="home-title">{text.title}<br /><span>{text.titleMuted}</span></h1>
          <p className="tmk-landing__lead">{text.lead}</p>
          <div className="tmk-landing__actions">
            <a className="tmk-button tmk-button--primary tmk-button--large" href={localePath(locale, '/explore')}>{text.primary}<Forward aria-hidden="true" size={18} /></a>
            <a className="tmk-button tmk-button--secondary tmk-button--large" href={localePath(locale, '/register')}>{text.secondary}</a>
          </div>
        </div>

        {/* The record is real: the latest published projects, straight from the public API. */}
        <section className="tmk-ledger" aria-labelledby="home-ledger">
          <header className="tmk-ledger__head">
            <h2 id="home-ledger" className="tmk-ledger__live" style={{ margin: 0, fontSize: 'inherit' }}>{text.ledgerTitle}</h2>
            <span>{text.ledgerLive} · {formatDate(new Date(), locale)}</span>
          </header>
          {projectList.length
            ? <ol className="tmk-ledger__rows">
                {projectList.slice(0, 5).map(project => (
                  <li className="tmk-ledger__row" key={project.slug}>
                    <a className="tmk-ledger__title" href={localePath(locale, `/projects/${project.slug}`)}>{project.title}</a>
                    <span className="tmk-ledger__value"><StatusBadge tone={stateTone(project.state)}>{stateLabel(project.state, locale)}</StatusBadge></span>
                    <span className="tmk-ledger__meta">{project.organization.displayName} · {cityName(project.location, locale)}{project.organization.verified ? text.verified : ''}</span>
                  </li>
                ))}
              </ol>
            : <p style={{ padding: '24px 16px', margin: 0, color: 'var(--tmk-color-muted)' }}>{text.ledgerEmpty}</p>}
          <footer className="tmk-ledger__foot">
            <span>{text.ledgerFoot}</span>
            <a href={localePath(locale, '/explore')}>{text.ledgerAll}</a>
          </footer>
        </section>
      </section>

      <dl className="tmk-figures">
        {figures.map(figure => (
          <div key={figure.key}>
            <dt>{text.figures[figure.key]}</dt>
            <dd>{figure.value}<small>{text.figuresNote[figure.key]}</small></dd>
          </div>
        ))}
      </dl>

      <section className="tmk-section" aria-labelledby="home-tracks">
        <p className="tmk-kicker"><b>01</b>{text.tracksLabel}</p>
        <div className="tmk-section__head">
          <h2 id="home-tracks">{text.tracksTitle}</h2>
          <p>{text.tracksLead}</p>
        </div>
        <div className="tmk-columns">
          {text.tracks.map((track, index) => {
            const Icon = trackIcons[track.key];
            return (
              <article key={track.key}>
                <span className="tmk-columns__num">{String(index + 1).padStart(2, '0')}</span>
                <h3><Icon aria-hidden="true" size={22} />{track.title}</h3>
                <p>{track.body}</p>
                <a className="tmk-arrow-link" href={localePath(locale, track.href)}>{track.link}<Forward aria-hidden="true" size={16} /></a>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="home-process">
        <p className="tmk-kicker"><b>02</b>{text.processLabel}</p>
        <div className="tmk-section__head">
          <h2 id="home-process">{text.processTitle}</h2>
        </div>
        <ol className="tmk-process">
          {text.process.map(step => <li key={step.title}><strong>{step.title}</strong><p>{step.body}</p></li>)}
        </ol>
      </section>

      <section className="tmk-section" aria-labelledby="home-principles">
        <p className="tmk-kicker"><b>03</b>{text.principlesLabel}</p>
        <div className="tmk-principles">
          <p className="tmk-principles__statement" id="home-principles">{text.statementStart} <em>{text.statementEm}</em></p>
          <dl>
            {text.principles.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.body}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className="tmk-closing" aria-labelledby="home-closing">
        <div>
          <h2 id="home-closing">{text.closingTitle}</h2>
          <p>{text.closingBody}</p>
        </div>
        <a className="tmk-button tmk-button--primary tmk-button--large" href={localePath(locale, '/register')}>{text.closingButton}<Forward aria-hidden="true" size={18} /></a>
      </section>
    </AppShell>
  );
}
