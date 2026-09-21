import { BadgeCheck, Building2, CircleCheck, Eye, FileCheck2, FolderKanban, HandCoins, HandHeart, Landmark, MapPin, Rocket, Scale, ShieldCheck, Sprout } from 'lucide-react';
import { AppShell, CountUp, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOrganizationSummary, type PublicProjectCard } from '../../lib/server-api';
import { readSiteContent, withFunding, type SiteItem } from '../../lib/site-content';
import { HeroCarousel } from './hero-carousel';
import { ProjectMediaCard, forwardIcon } from './marketing';

export const dynamic = 'force-dynamic';

const copy = {
  ar: {
    browseAll: 'تصفّح كل المشاريع',
    carousel: { previous: 'الشريحة السابقة', next: 'الشريحة التالية', slide: 'شريحة', region: 'أبرز ما في تمكين' },
    tags: { '/explore': 'مشاريع خيرية', '/invest': 'استثمار ربحي', '/opportunities': 'فرص تشغيل' } as Record<string, string>,
    defaultTag: 'تمكين',
    tracksKicker: 'ثلاثة مسارات للأثر',
    tracksTitle: 'اختر طريقتك في صنع الفرق',
    tracksLead: 'تبرّع، أو استثمر، أو ابدأ طريقك المهني — كل ذلك بشفافية كاملة ومع جهات موثقة.',
    impactKicker: 'أرقام حقيقية من المنصة',
    impact: { projects: 'مشروع منشور', verified: 'جهة موثقة', contributions: 'مساهمة مسجلة', cities: 'مدينة وبلدة' },
    featuredKicker: 'مشاريع تنتظر دعمك',
    featuredTitle: 'كن جزءًا من قصة نجاح اليوم',
    featuredLead: 'مشاريع حقيقية بميزانيات معلنة ومراحل واضحة. اختر ما يلمس قلبك.',
    featuredEmpty: 'لا توجد مشاريع منشورة بعد. عد قريبًا.',
    howKicker: 'كيف تعمل تمكين',
    howTitle: 'من المساهمة إلى الأثر في أربع خطوات',
    steps: [
      { title: 'اختر مشروعك', body: 'تصفّح مشاريع جهات موثقة، واقرأ ميزانيتها ومراحلها قبل أن تقرر.' },
      { title: 'ساهم بأمان', body: 'كل مبلغ يُسجَّل في دفتر بقيد مزدوج، ويصلك إيصال رسمي.' },
      { title: 'تابع التنفيذ', body: 'تُصرف الأموال على مراحل، ولا تُغلق مرحلة دون دليل تنفيذ.' },
      { title: 'شاهد الأثر', body: 'تقرير إغلاق منشور يوضح ما تحقق بفضل مساهمتك.' }
    ],
    whyKicker: 'لماذا تمكين؟',
    whyTitle: 'الثقة لا تُطلب، بل تُبنى في كل خطوة',
    whyLead: 'صممنا المنصة بحيث لا يُصرف مبلغ دون اعتماد، ولا يُنشر رقم دون قيد يثبته.',
    checks: [
      { title: 'جهات موثقة فقط', body: 'مراجعة مستقلة لوثائق كل جهة قبل أن تجمع أي تمويل.' },
      { title: 'شفافية كاملة', body: 'ميزانية ومراحل وتقارير منشورة لكل مشروع.' },
      { title: 'خصوصيتك بيدك', body: 'اختر إظهار اسمك أو مبلغك، أو المساهمة دون أن يُعرف أحدهما.' }
    ],
    badge: 'من الجهات على المنصة موثقة',
    features: [
      { icon: ShieldCheck, title: 'توثيق مستقل', body: 'فريق مراجعة منفصل عن الجهات يفحص كل وثيقة.' },
      { icon: Landmark, title: 'دفتر مالي دقيق', body: 'قيود متوازنة لكل مبلغ يدخل أو يخرج، قابلة للتدقيق.' },
      { icon: Scale, title: 'فصل الصلاحيات', body: 'من يطلب الصرف لا يعتمده، ومن يراجع لا يملك الجهة.' },
      { icon: FileCheck2, title: 'تقارير أثر', body: 'لقطات مجمدة لما تحقق لا تتغير بعد نشرها.' }
    ],
    partnersKicker: 'جهات تثق بتمكين',
    ctaTitle: 'ابدأ رحلتك في صنع الأثر اليوم',
    ctaBody: 'أنشئ حسابك في دقيقة واحدة، وتابع كل مساهمة واستثمار وفرصة من مكان واحد.',
    ctaPrimary: 'أنشئ حسابك مجانًا',
    ctaSecondary: 'تعرّف علينا'
  },
  en: {
    browseAll: 'Browse all projects',
    carousel: { previous: 'Previous slide', next: 'Next slide', slide: 'Slide', region: 'Tamkeen highlights' },
    tags: { '/explore': 'Charity projects', '/invest': 'Profit investment', '/opportunities': 'Jobs & training' } as Record<string, string>,
    defaultTag: 'Tamkeen',
    tracksKicker: 'Three tracks to impact',
    tracksTitle: 'Choose how you make a difference',
    tracksLead: 'Give, invest or start your career — all with full transparency and verified organisations.',
    impactKicker: 'Real numbers from the platform',
    impact: { projects: 'published projects', verified: 'verified organisations', contributions: 'recorded contributions', cities: 'towns and cities' },
    featuredKicker: 'Projects waiting for you',
    featuredTitle: 'Be part of a success story today',
    featuredLead: 'Real projects with published budgets and clear stages. Choose what moves you.',
    featuredEmpty: 'No published projects yet. Check back soon.',
    howKicker: 'How Tamkeen works',
    howTitle: 'From contribution to impact in four steps',
    steps: [
      { title: 'Choose a project', body: 'Browse projects by verified organisations and read their budget and stages first.' },
      { title: 'Contribute safely', body: 'Every amount is recorded in a double-entry ledger, and you get an official receipt.' },
      { title: 'Follow delivery', body: 'Money is released in stages, and no stage closes without evidence.' },
      { title: 'See the impact', body: 'A published closing report shows what your contribution achieved.' }
    ],
    whyKicker: 'Why Tamkeen?',
    whyTitle: 'Trust is not asked for, it is built into every step',
    whyLead: 'We designed the platform so no amount is released without approval, and no figure is shown without an entry behind it.',
    checks: [
      { title: 'Verified organisations only', body: 'Independent review of every organisation’s documents before it raises anything.' },
      { title: 'Full transparency', body: 'A published budget, stages and reports for every project.' },
      { title: 'Your privacy, your choice', body: 'Show your name or amount, or contribute without either being known.' }
    ],
    badge: 'of organisations on the platform are verified',
    features: [
      { icon: ShieldCheck, title: 'Independent verification', body: 'A review team separate from organisations checks every document.' },
      { icon: Landmark, title: 'Accurate ledger', body: 'Balanced entries for every amount in or out, open to audit.' },
      { icon: Scale, title: 'Segregation of duties', body: 'Whoever requests a payout cannot approve it.' },
      { icon: FileCheck2, title: 'Impact reports', body: 'Frozen snapshots of what was achieved, unchanged once published.' }
    ],
    partnersKicker: 'Organisations that trust Tamkeen',
    ctaTitle: 'Start your impact journey today',
    ctaBody: 'Create your account in a minute and follow every contribution, investment and opportunity from one place.',
    ctaPrimary: 'Create your free account',
    ctaSecondary: 'Get to know us'
  }
} as const;

const TRACK_SLOTS = [
  { key: 'charity', icon: HandHeart },
  { key: 'invest', icon: Rocket },
  { key: 'work', icon: Sprout }
] as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = (raw === 'en' ? 'en' : 'ar') satisfies Locale;
  const text = copy[locale];
  const L = (path: string) => localePath(locale, path);
  const Forward = forwardIcon(locale);
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;

  const [site, projects, organizations] = await Promise.all([
    readSiteContent(),
    readPublic<PublicProjectCard[]>('/projects'),
    readPublic<PublicOrganizationSummary[]>('/organizations')
  ]);
  const projectList = projects.ok ? projects.data : [];
  const orgList = organizations.ok ? organizations.data : [];
  // Funding comes from each project's detail; the public list is small, so every project is counted.
  const funded = await withFunding(projectList.slice(0, 60));
  const featured = funded.slice(0, 6);
  const contributions = funded.reduce((sum, project) => sum + (project.funding?.available ? project.funding.contributionCount : 0), 0);
  const verified = orgList.filter(org => org.verified).length;
  const cities = new Set(projectList.map(project => project.location.city.nameAr)).size;
  const verifiedShare = orgList.length ? Math.round((verified / orgList.length) * 100) : 0;

  const slides = site.hero.map(item => ({
    id: item.id,
    imageUrl: item.imageUrl,
    tag: (item.cta && text.tags[item.cta.href.split('?')[0] ?? '']) || text.defaultTag,
    title: pick(item.title),
    body: pick(item.body),
    cta: item.cta ? { label: pick(item.cta.label), href: L(item.cta.href) } : null
  }));
  const tracks = TRACK_SLOTS.map(slot => ({ ...slot, item: site.tracks[slot.key] })).filter((entry): entry is typeof entry & { item: SiteItem } => Boolean(entry.item));

  return (
    <AppShell locale={locale} path="/"
      lead={<HeroCarousel slides={slides} locale={locale} secondary={{ label: text.browseAll, href: L('/explore') }} labels={text.carousel} />}>

      <section className="tmk-section" aria-labelledby="home-tracks" style={{ marginBlockStart: 0 }}>
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{text.tracksKicker}</p>
          <h2 id="home-tracks">{text.tracksTitle}</h2>
          <p>{text.tracksLead}</p>
        </div>
        <div className="tmk-tracks">
          {tracks.map(({ key, icon: Icon, item }, index) => (
            <a className="tmk-track tmk-reveal" key={key} href={L(item.cta?.href ?? '/explore')} style={{ ['--reveal-delay' as string]: index }}>
              <img src={item.imageUrl} alt="" loading="lazy" />
              <span className="tmk-track__icon"><Icon aria-hidden="true" size={28} /></span>
              <h3>{pick(item.title)}</h3>
              <p>{pick(item.body)}</p>
              <span className="tmk-track__cta">{item.cta ? pick(item.cta.label) : text.browseAll}<Forward aria-hidden="true" size={18} /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="tmk-impact tmk-reveal" aria-label={text.impactKicker}>
        <div className="tmk-impact__inner">
          {[
            { value: projectList.length, label: text.impact.projects, icon: FolderKanban },
            { value: verified, label: text.impact.verified, icon: BadgeCheck },
            { value: contributions, label: text.impact.contributions, icon: HandCoins },
            { value: cities, label: text.impact.cities, icon: MapPin }
          ].map(entry => {
            const Icon = entry.icon;
            return (
              <div className="tmk-impact__item" key={entry.label}>
                <span className="tmk-impact__icon"><Icon aria-hidden="true" size={28} /></span>
                <strong><CountUp value={entry.value} /></strong>
                <span>{entry.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="home-featured">
        <div className="tmk-section__row">
          <div className="tmk-section__head tmk-reveal">
            <p className="tmk-kicker">{text.featuredKicker}</p>
            <h2 id="home-featured">{text.featuredTitle}</h2>
            <p>{text.featuredLead}</p>
          </div>
          <a className="tmk-button tmk-button--secondary tmk-reveal" href={L('/explore')}>{text.browseAll}<Forward aria-hidden="true" size={18} /></a>
        </div>
        {featured.length
          ? <div className="tmk-projects">{featured.map((project, index) => <ProjectMediaCard key={project.slug} project={project} locale={locale} index={index} />)}</div>
          : <div className="tmk-empty"><p className="tmk-empty__title">{text.featuredEmpty}</p></div>}
      </section>

      <section className="tmk-section" aria-labelledby="home-how">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{text.howKicker}</p>
          <h2 id="home-how">{text.howTitle}</h2>
        </div>
        <ol className="tmk-steps">
          {text.steps.map((step, index) => {
            const Icon = [Eye, HandCoins, CircleCheck, BadgeCheck][index] ?? CircleCheck;
            return (
              <li key={step.title} className="tmk-reveal" style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-steps__icon"><Icon aria-hidden="true" size={30} /></span>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="tmk-section tmk-split" aria-labelledby="home-why">
        <div className="tmk-split__media tmk-reveal">
          <img src={site.about?.imageUrl ?? '/media/defaults/about-village.jpg'} alt="" loading="lazy" />
          {orgList.length ? <div className="tmk-split__badge"><strong><CountUp value={verifiedShare} />%</strong><span>{text.badge}</span></div> : null}
        </div>
        <div className="tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <div className="tmk-section__head" style={{ marginBlockEnd: 0 }}>
            <p className="tmk-kicker">{text.whyKicker}</p>
            <h2 id="home-why">{text.whyTitle}</h2>
            <p>{text.whyLead}</p>
          </div>
          <ul className="tmk-checks">
            {text.checks.map(check => <li key={check.title}><CircleCheck aria-hidden="true" /><span><strong>{check.title}</strong><span>{check.body}</span></span></li>)}
          </ul>
          <a className="tmk-button tmk-button--primary tmk-button--large" href={L('/about')}>{text.ctaSecondary}<Forward aria-hidden="true" size={18} /></a>
        </div>
      </section>

      <section className="tmk-section" aria-label={text.whyKicker}>
        <div className="tmk-features">
          {text.features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <article className="tmk-feature tmk-reveal" key={feature.title} style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {orgList.length ? (
        <section className="tmk-section" aria-labelledby="home-partners">
          <div className="tmk-section__head tmk-section__head--center tmk-reveal" style={{ marginBlockEnd: 24 }}>
            <p className="tmk-kicker" id="home-partners">{text.partnersKicker}</p>
          </div>
          <div className="tmk-marquee">
            {/* Doubled so the strip loops seamlessly; the copy is hidden from assistive technology. */}
            <div className="tmk-marquee__track">
              {[...orgList, ...orgList].map((org, index) => (
                <a className="tmk-marquee__item" key={`${org.slug}-${index}`} href={L(`/organizations/${org.slug}`)} aria-hidden={index >= orgList.length} tabIndex={index >= orgList.length ? -1 : 0}>
                  {org.verified ? <BadgeCheck aria-hidden="true" size={18} /> : <Building2 aria-hidden="true" size={18} />}{org.displayName}
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="tmk-cta tmk-reveal" aria-labelledby="home-cta">
        <img src={site.contact?.imageUrl ?? '/media/defaults/contact-team.jpg'} alt="" loading="lazy" />
        <h2 id="home-cta">{text.ctaTitle}</h2>
        <p>{text.ctaBody}</p>
        <div className="tmk-carousel__actions">
          <a className="tmk-button tmk-button--accent tmk-button--large" href={L('/register')}>{text.ctaPrimary}<Forward aria-hidden="true" size={20} /></a>
          <a className="tmk-button tmk-button--glass tmk-button--large" href={L('/contact-us')}>{locale === 'ar' ? 'تواصل معنا' : 'Contact us'}</a>
        </div>
      </section>
    </AppShell>
  );
}

