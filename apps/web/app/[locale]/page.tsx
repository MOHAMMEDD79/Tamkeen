import { BadgeCheck, Building2, CircleCheck, Eye, FileCheck2, FolderKanban, HandCoins, HandHeart, Landmark, MapPin, Rocket, Scale, ShieldCheck, Sprout } from 'lucide-react';
import { AppShell, CountUp, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOrganizationSummary, type PublicProjectCard } from '../../lib/server-api';
import { readSiteContent, section, withFunding, type SiteItem } from '../../lib/site-content';
import { paragraphs } from '../../lib/site-sections';
import { HeroCarousel } from './hero-carousel';
import { ProjectMediaCard, forwardIcon } from './marketing';

export const dynamic = 'force-dynamic';

const copy = {
  ar: {
    browseAll: 'تصفّح كل المشاريع',
    carousel: { previous: 'الشريحة السابقة', next: 'الشريحة التالية', slide: 'شريحة', region: 'أبرز ما في تمكين' },
    tags: { '/explore': 'مشاريع خيرية', '/invest': 'استثمار ربحي', '/opportunities': 'فرص تشغيل' } as Record<string, string>,
    defaultTag: 'تمكين',
    impact: { projects: 'مشروع منشور', verified: 'جهة موثقة', contributions: 'مساهمة مسجلة', cities: 'مدينة وبلدة' },
    featuredEmpty: 'لا توجد مشاريع منشورة بعد. عد قريبًا.',
    badge: 'من الجهات على المنصة موثقة',
    ctaSecondary: 'تعرّف علينا'
  },
  en: {
    browseAll: 'Browse all projects',
    carousel: { previous: 'Previous slide', next: 'Next slide', slide: 'Slide', region: 'Tamkeen highlights' },
    tags: { '/explore': 'Charity projects', '/invest': 'Profit investment', '/opportunities': 'Jobs & training' } as Record<string, string>,
    defaultTag: 'Tamkeen',
    impact: { projects: 'published projects', verified: 'verified organisations', contributions: 'recorded contributions', cities: 'towns and cities' },
    featuredEmpty: 'No published projects yet. Check back soon.',
    badge: 'of organisations on the platform are verified',
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
  const S = (slot: string) => section(site, slot);
  const tracksHead = S('home.tracks'), featuredHead = S('home.featured'), how = S('home.how'), why = S('home.why'), cta = S('home.cta');
  const tracks = TRACK_SLOTS.map(slot => ({ ...slot, item: site.tracks[slot.key] })).filter((entry): entry is typeof entry & { item: SiteItem } => Boolean(entry.item));

  return (
    <AppShell locale={locale} path="/"
      lead={<HeroCarousel slides={slides} locale={locale} secondary={{ label: text.browseAll, href: L('/explore') }} labels={text.carousel} />}>

      <section className="tmk-section" aria-labelledby="home-tracks" style={{ marginBlockStart: 0 }}>
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{pick(tracksHead.kicker)}</p>
          <h2 id="home-tracks">{pick(tracksHead.title)}</h2>
          <p>{pick(tracksHead.body)}</p>
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

      <section className="tmk-impact tmk-reveal" aria-label={pick(S('home.impact').kicker)}>
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
            <p className="tmk-kicker">{pick(featuredHead.kicker)}</p>
            <h2 id="home-featured">{pick(featuredHead.title)}</h2>
            <p>{pick(featuredHead.body)}</p>
          </div>
          {featuredHead.cta ? <a className="tmk-button tmk-button--secondary tmk-reveal" href={L(featuredHead.cta.href)}>{pick(featuredHead.cta.label)}<Forward aria-hidden="true" size={18} /></a> : null}
        </div>
        {featured.length
          ? <div className="tmk-projects">{featured.map((project, index) => <ProjectMediaCard key={project.slug} project={project} locale={locale} index={index} />)}</div>
          : <div className="tmk-empty"><p className="tmk-empty__title">{text.featuredEmpty}</p></div>}
      </section>

      <section className="tmk-section" aria-labelledby="home-how">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{pick(how.kicker)}</p>
          <h2 id="home-how">{pick(how.title)}</h2>
        </div>
        <ol className="tmk-steps">
          {[1, 2, 3, 4].map(number => S(`home.step.${number}`)).map((step, index) => {
            const Icon = [Eye, HandCoins, CircleCheck, BadgeCheck][index] ?? CircleCheck;
            return (
              <li key={index} className="tmk-reveal" style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-steps__icon"><Icon aria-hidden="true" size={30} /></span>
                <strong>{pick(step.title)}</strong>
                <p>{pick(step.body)}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="tmk-section tmk-split" aria-labelledby="home-why">
        <div className="tmk-split__media tmk-reveal">
          <img src={why.image} alt="" loading="lazy" />
          {orgList.length ? <div className="tmk-split__badge"><strong><CountUp value={verifiedShare} />%</strong><span>{text.badge}</span></div> : null}
        </div>
        <div className="tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <div className="tmk-section__head" style={{ marginBlockEnd: 0 }}>
            <p className="tmk-kicker">{pick(why.kicker)}</p>
            <h2 id="home-why">{pick(why.title)}</h2>
            {paragraphs(pick(why.body)).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <ul className="tmk-checks">
            {[1, 2, 3].map(number => S(`home.check.${number}`)).map((check, index) => <li key={index}><CircleCheck aria-hidden="true" /><span><strong>{pick(check.title)}</strong><span>{pick(check.body)}</span></span></li>)}
          </ul>
          <a className="tmk-button tmk-button--primary tmk-button--large" href={L('/about')}>{text.ctaSecondary}<Forward aria-hidden="true" size={18} /></a>
        </div>
      </section>

      <section className="tmk-section" aria-label={pick(why.kicker)}>
        <div className="tmk-features">
          {[1, 2, 3, 4].map(number => S(`home.feature.${number}`)).map((feature, index) => {
            const Icon = [ShieldCheck, Landmark, Scale, FileCheck2][index] ?? ShieldCheck;
            return (
              <article className="tmk-feature tmk-reveal" key={index} style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
                <h3>{pick(feature.title)}</h3>
                <p>{pick(feature.body)}</p>
              </article>
            );
          })}
        </div>
      </section>

      {orgList.length ? (
        <section className="tmk-section" aria-labelledby="home-partners">
          <div className="tmk-section__head tmk-section__head--center tmk-reveal" style={{ marginBlockEnd: 24 }}>
            <p className="tmk-kicker" id="home-partners">{pick(S('home.partners').kicker)}</p>
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
        <img src={cta.image} alt="" loading="lazy" />
        <h2 id="home-cta">{pick(cta.title)}</h2>
        <p>{pick(cta.body)}</p>
        <div className="tmk-carousel__actions">
          {cta.cta ? <a className="tmk-button tmk-button--accent tmk-button--large" href={L(cta.cta.href)}>{pick(cta.cta.label)}<Forward aria-hidden="true" size={20} /></a> : null}
          {cta.cta2 ? <a className="tmk-button tmk-button--glass tmk-button--large" href={L(cta.cta2.href)}>{pick(cta.cta2.label)}</a> : null}
        </div>
      </section>
    </AppShell>
  );
}

