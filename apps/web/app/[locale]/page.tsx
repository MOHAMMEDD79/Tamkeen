import { ArrowLeft, ArrowRight, BookOpenCheck, Building2, ChartColumn, CircleCheck, GraduationCap, HandHeart, Landmark, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { AppShell, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicProjectCard } from '../../lib/server-api';
import { ProjectCard } from './public-parts';

export const dynamic = 'force-dynamic';

const copy = {
  ar: {
    eyebrow: 'منصة التمويل الموثّق',
    titleStart: 'تمويل يصل إلى من ينفّذ،',
    titleEm: 'وأثر يُثبت بالدليل.',
    lead: 'تمكين تربط المتبرع والمستثمر والمتدرب بالجهة المنفذة، وتتابع كل مساهمة حتى دليل التنفيذ وتقرير الإغلاق — في العمل الخيري والاستثمار والتدريب إلى العمل.',
    primary: 'استكشف المشاريع',
    secondary: 'أنشئ حسابك مجانًا',
    stats: { projects: 'مشروع منشور', organizations: 'جهة على المنصة', tracks: 'مسارات متكاملة' },
    tracksKicker: 'ثلاثة مسارات',
    tracksTitle: 'اختر الطريقة التي تصنع بها الفرق',
    tracksLead: 'كل مسار له قواعده الواضحة، وكلها تشترك في شيء واحد: لا يُحتسب شيء قبل أن يُثبت.',
    tracks: [
      { key: 'charity', title: 'العمل الخيري', body: 'ادعم مشروعًا لجهة موثقة بميزانية ومراحل معلنة، وتابع مساهمتك حتى دليل التنفيذ.', link: 'تصفّح المشاريع', href: '/explore?type=charity' },
      { key: 'invest', title: 'الاستثمار', body: 'اطّلع على عروض شركات بإفصاح مرقّم وأداة واضحة، ولا تُسجَّل حصة قبل تخصيص مثبت.', link: 'العروض الاستثمارية', href: '/invest' },
      { key: 'work', title: 'التدريب إلى العمل', body: 'برامج تدريب ممولة تقود إلى وظيفة حقيقية تُحتسب من تاريخ البدء المؤكد، لا من عدد المسجلين.', link: 'الفرص المفتوحة', href: '/opportunities' }
    ],
    featuredKicker: 'مشاريع قائمة',
    featuredTitle: 'مشاريع تبحث عن داعمين الآن',
    featuredAll: 'كل المشاريع',
    featuredEmpty: 'لا توجد مشاريع منشورة بعد. عد قريبًا.',
    howKicker: 'كيف تعمل تمكين',
    howTitle: 'من المساهمة إلى النتيجة، بخطوات واضحة',
    steps: [
      { title: 'جهة موثقة تنشر مشروعًا', body: 'بميزانية مفصلة ومراحل بأوزان، بعد مراجعة مستقلة للمحتوى.' },
      { title: 'تساهم أو تستثمر أو تتقدم', body: 'كل مبلغ يُسجَّل في دفتر بقيد مزدوج، وكل طلب له حالة واضحة.' },
      { title: 'التنفيذ يُوثَّق', body: 'الصرف يمر بفصل صلاحيات واعتماد، والمرحلة لا تُغلق دون دليل.' },
      { title: 'الأثر يُنشر', body: 'تقارير إغلاق بلقطة مجمدة، وأرقام عامة لها قيود خلفها.' }
    ],
    trustKicker: 'لماذا تثق بنا',
    trustTitle: 'الشفافية مبنية في النظام، لا مضافة إليه',
    trust: [
      { title: 'جهات موثقة', body: 'مراجعة مستقلة لوثائق كل جهة قبل أن تجمع أي تمويل.' },
      { title: 'دفتر مالي بقيد مزدوج', body: 'كل رقم معروض على المنصة له قيود متوازنة يمكن تدقيقها.' },
      { title: 'فصل الصلاحيات', body: 'من يطلب الصرف لا يعتمده، ومن يراجع لا يملك الجهة.' }
    ],
    ctaTitle: 'ابدأ أثرك اليوم',
    ctaBody: 'أنشئ حسابًا في دقيقة، وتابع كل مساهمة من مكان واحد.',
    ctaButton: 'إنشاء حساب',
    flow: [
      { title: 'مساهمة مسجلة', body: 'قيد مزدوج متوازن' },
      { title: 'مرحلة منفذة', body: 'دليل تنفيذ معتمد' },
      { title: 'أثر منشور', body: 'تقرير إغلاق مجمد' }
    ]
  },
  en: {
    eyebrow: 'The verified funding platform',
    titleStart: 'Funding that reaches those who deliver,',
    titleEm: 'and impact proven with evidence.',
    lead: 'Tamkeen connects donors, investors and trainees with the organisations delivering the work, and follows every contribution through to delivery evidence and a closing report — across charity, investment and training into work.',
    primary: 'Explore projects',
    secondary: 'Create a free account',
    stats: { projects: 'published projects', organizations: 'organisations', tracks: 'connected tracks' },
    tracksKicker: 'Three tracks',
    tracksTitle: 'Choose how you make a difference',
    tracksLead: 'Each track has clear rules, and they all share one principle: nothing counts until it is proven.',
    tracks: [
      { key: 'charity', title: 'Charity', body: 'Back a verified organisation’s project with a published budget and stages, and follow your contribution to delivery evidence.', link: 'Browse projects', href: '/explore?type=charity' },
      { key: 'invest', title: 'Investment', body: 'Review company offerings with numbered disclosures and a clear instrument; no stake is recorded before a proven allocation.', link: 'Investment offerings', href: '/invest' },
      { key: 'work', title: 'Training into work', body: 'Funded training programmes that lead to real jobs, counted from a confirmed start date rather than from sign-ups.', link: 'Open opportunities', href: '/opportunities' }
    ],
    featuredKicker: 'Live projects',
    featuredTitle: 'Projects looking for backers now',
    featuredAll: 'All projects',
    featuredEmpty: 'No published projects yet. Check back soon.',
    howKicker: 'How Tamkeen works',
    howTitle: 'From contribution to result, in clear steps',
    steps: [
      { title: 'A verified organisation publishes', body: 'With a detailed budget and weighted stages, after independent content review.' },
      { title: 'You contribute, invest or apply', body: 'Every amount is recorded in a double-entry ledger and every request has a clear state.' },
      { title: 'Delivery is documented', body: 'Payouts pass segregated approval, and a stage cannot close without evidence.' },
      { title: 'Impact is published', body: 'Closing reports with a frozen snapshot, and public figures backed by ledger entries.' }
    ],
    trustKicker: 'Why trust us',
    trustTitle: 'Transparency built into the system, not bolted on',
    trust: [
      { title: 'Verified organisations', body: 'Independent review of every organisation’s documents before it raises anything.' },
      { title: 'Double-entry ledger', body: 'Every figure shown on the platform has balanced entries that can be audited.' },
      { title: 'Segregation of duties', body: 'Whoever requests a payout cannot approve it, and reviewers do not own the organisation.' }
    ],
    ctaTitle: 'Start your impact today',
    ctaBody: 'Create an account in a minute and follow every contribution from one place.',
    ctaButton: 'Create account',
    flow: [
      { title: 'Contribution recorded', body: 'Balanced double entry' },
      { title: 'Stage delivered', body: 'Approved evidence' },
      { title: 'Impact published', body: 'Frozen closing report' }
    ]
  }
} as const;

const trackIcons = { charity: HandHeart, invest: TrendingUp, work: GraduationCap } as const;
const trustIcons = [ShieldCheck, Landmark, BookOpenCheck] as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = (raw === 'en' ? 'en' : 'ar') satisfies Locale;
  const text = copy[locale];
  const Forward = locale === 'ar' ? ArrowLeft : ArrowRight;

  // The home page stays up when the API is down: the counts and featured list simply drop out.
  const [projects, organizations] = await Promise.all([
    readPublic<PublicProjectCard[]>('/projects'),
    readPublic<unknown[]>('/organizations')
  ]);
  const projectList = projects.ok ? projects.data : [];
  const stats = [
    { value: projects.ok ? projectList.length : '—', label: text.stats.projects },
    { value: organizations.ok ? organizations.data.length : '—', label: text.stats.organizations },
    { value: 3, label: text.stats.tracks }
  ];

  return (
    <AppShell locale={locale} path="/">
      <section className="tmk-hero tmk-hero--split" aria-labelledby="home-title">
        <div>
          <p className="tmk-hero__eyebrow"><Sparkles aria-hidden="true" size={16} />{text.eyebrow}</p>
          <h1 id="home-title">{text.titleStart} <em>{text.titleEm}</em></h1>
          <p className="tmk-hero__lead">{text.lead}</p>
          <div className="tmk-hero__actions">
            <a className="tmk-button tmk-button--highlight tmk-button--large" href={localePath(locale, '/explore')}>{text.primary}<Forward aria-hidden="true" size={18} /></a>
            <a className="tmk-button tmk-button--secondary tmk-button--large" href={localePath(locale, '/register')}>{text.secondary}</a>
          </div>
          <dl className="tmk-hero__stats">
            {stats.map(stat => (
              <div className="tmk-hero__stat" key={stat.label}>
                <dt className="tmk-visually-hidden">{stat.label}</dt>
                <dd style={{ margin: 0 }}><strong>{stat.value}</strong><span>{stat.label}</span></dd>
              </div>
            ))}
          </dl>
        </div>
        {/* Decorative: the same three facts every project on the platform has to reach, in order. */}
        <ol className="tmk-hero__visual" aria-hidden="true">
          {text.flow.map((step, index) => {
            const Icon = [HandHeart, CircleCheck, ChartColumn][index] ?? CircleCheck;
            return <li key={step.title}><span className="tmk-hero__visual-icon"><Icon size={22} /></span><span><strong>{step.title}</strong><small>{step.body}</small></span></li>;
          })}
        </ol>
      </section>

      <section className="tmk-section" aria-labelledby="home-tracks">
        <div className="tmk-section__head">
          <p className="tmk-section__kicker">{text.tracksKicker}</p>
          <h2 id="home-tracks">{text.tracksTitle}</h2>
          <p>{text.tracksLead}</p>
        </div>
        <div className="tmk-grid tmk-grid--cards">
          {text.tracks.map(track => {
            const Icon = trackIcons[track.key];
            return (
              <article className="tmk-card tmk-feature" key={track.key}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={24} /></span>
                <h3>{track.title}</h3>
                <p>{track.body}</p>
                <a className="tmk-feature__link" href={localePath(locale, track.href)}>{track.link}<Forward aria-hidden="true" size={16} /></a>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="home-featured">
        <div className="tmk-section__head" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: '16px', maxInlineSize: 'none' }}>
          <div>
            <p className="tmk-section__kicker">{text.featuredKicker}</p>
            <h2 id="home-featured" style={{ marginBlockEnd: 0 }}>{text.featuredTitle}</h2>
          </div>
          <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/explore')}>{text.featuredAll}<Forward aria-hidden="true" size={16} /></a>
        </div>
        {projectList.length
          ? <div className="tmk-grid tmk-grid--cards">{projectList.slice(0, 3).map(project => <ProjectCard key={project.slug} project={project} locale={locale} />)}</div>
          : <div className="tmk-empty"><p className="tmk-empty__title">{text.featuredEmpty}</p></div>}
      </section>

      <section className="tmk-section tmk-card" style={{ padding: 'clamp(24px, 5vw, 48px)' }} aria-labelledby="home-how">
        <div className="tmk-section__head">
          <p className="tmk-section__kicker">{text.howKicker}</p>
          <h2 id="home-how">{text.howTitle}</h2>
        </div>
        <ol className="tmk-steps">
          {text.steps.map(step => <li key={step.title}><strong>{step.title}</strong><p>{step.body}</p></li>)}
        </ol>
      </section>

      <section className="tmk-section" aria-labelledby="home-trust">
        <div className="tmk-section__head">
          <p className="tmk-section__kicker">{text.trustKicker}</p>
          <h2 id="home-trust">{text.trustTitle}</h2>
        </div>
        <div className="tmk-grid tmk-grid--cards">
          {text.trust.map((item, index) => {
            const Icon = trustIcons[index] ?? Building2;
            return (
              <article className="tmk-card tmk-feature" key={item.title}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={24} /></span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tmk-cta-band" aria-labelledby="home-cta">
        <div>
          <h2 id="home-cta">{text.ctaTitle}</h2>
          <p>{text.ctaBody}</p>
        </div>
        <a className="tmk-button tmk-button--highlight tmk-button--large" href={localePath(locale, '/register')}>{text.ctaButton}<Forward aria-hidden="true" size={18} /></a>
      </section>
    </AppShell>
  );
}
