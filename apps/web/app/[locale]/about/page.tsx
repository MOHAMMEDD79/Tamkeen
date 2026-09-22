import { notFound } from 'next/navigation';
import { BadgeCheck, Building2, CircleCheck, Eye, FolderKanban, HandHeart, Handshake, Layers, Rocket, Scale, ShieldCheck, Sprout, Target } from 'lucide-react';
import { AppShell, CountUp, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { DownloadButton } from '../download-button';
import { readPublic, type PublicOrganizationSummary, type PublicProjectCard } from '../../../lib/server-api';
import { readSiteContent, section, type SiteItem } from '../../../lib/site-content';
import { paragraphs } from '../../../lib/site-sections';
import { PageHero, forwardIcon } from '../marketing';

/** PUB-13. The story, mission and principles, with the banner and photos the admin controls. */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'About us — Tamkeen', description: 'Who we are, why we built Tamkeen, and the principles behind every contribution.' }
    : { title: 'من نحن — تمكين', description: 'من نحن، ولماذا بنينا تمكين، والمبادئ التي تحكم كل مساهمة.' };
}

const copy = {
  ar: {
    kicker: 'من نحن',
    numbers: { projects: 'مشروع منشور', organizations: 'جهة على المنصة', verified: 'جهة موثقة', tracks: 'مسارات للأثر' },
    terms: 'الشروط'
  },
  en: {
    kicker: 'About us',
    numbers: { projects: 'published projects', organizations: 'organisations', verified: 'verified organisations', tracks: 'tracks to impact' },
    terms: 'Terms'
  }
} as const;

const TRACKS = [
  { key: 'charity', icon: HandHeart },
  { key: 'invest', icon: Rocket },
  { key: 'work', icon: Sprout }
] as const;

export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const text = copy[locale];
  const L = (path: string) => localePath(locale, path);
  const Forward = forwardIcon(locale);
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;

  const [site, projects, organizations] = await Promise.all([
    readSiteContent(),
    readPublic<PublicProjectCard[]>('/projects'),
    readPublic<PublicOrganizationSummary[]>('/organizations')
  ]);
  const about = site.about!;
  const orgList = organizations.ok ? organizations.data : [];
  const S = (slot: string) => section(site, slot);
  const mission = S('about.mission'), vision = S('about.vision'), story = S('about.story'), tracksHead = S('about.tracks');
  const valuesHead = S('about.values'), verify = S('about.verify'), cta = S('about.cta');
  const tracks = TRACKS.map(track => ({ ...track, item: site.tracks[track.key] })).filter((entry): entry is typeof entry & { item: SiteItem } => Boolean(entry.item));

  return (
    <AppShell locale={locale} path="/about"
      lead={<PageHero image={about.imageUrl} kicker={(about.kicker && pick(about.kicker)) || text.kicker} title={pick(about.title)} lead={pick(about.body)} />}>

      <section className="tmk-section tmk-features" style={{ marginBlockStart: 0 }} aria-label={pick(mission.title)}>
        {[{ icon: Target, title: pick(mission.title), body: pick(mission.body) }, { icon: Eye, title: pick(vision.title), body: pick(vision.body) }].map((entry, index) => {
          const Icon = entry.icon;
          return (
            <article className="tmk-feature tmk-reveal" key={entry.title} style={{ ['--reveal-delay' as string]: index }}>
              <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
              <h2 style={{ margin: 0, fontSize: 24 }}>{entry.title}</h2>
              <p style={{ fontSize: 17 }}>{entry.body}</p>
            </article>
          );
        })}
      </section>

      <section className="tmk-section tmk-split" aria-labelledby="about-story">
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 16 }}>
            <p className="tmk-kicker">{pick(story.kicker)}</p>
            <h2 id="about-story">{pick(story.title)}</h2>
          </div>
          {paragraphs(pick(story.body)).map(paragraph => <p key={paragraph} style={{ fontSize: 17, color: 'var(--tmk-color-muted)' }}>{paragraph}</p>)}
        </div>
        <div className="tmk-split__media tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <img src={story.image} alt="" loading="lazy" />
          {orgList.length ? <div className="tmk-split__badge"><strong><CountUp value={orgList.length} /></strong><span>{text.numbers.organizations}</span></div> : null}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="about-tracks">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{pick(tracksHead.kicker)}</p>
          <h2 id="about-tracks">{pick(tracksHead.title)}</h2>
        </div>
        <div className="tmk-tracks">
          {tracks.map(({ key, icon: Icon, item }, index) => (
            <a className="tmk-track tmk-reveal" key={key} href={L(item.cta?.href ?? '/explore')} style={{ ['--reveal-delay' as string]: index, minBlockSize: 380 }}>
              <img src={item.imageUrl} alt="" loading="lazy" />
              <span className="tmk-track__icon"><Icon aria-hidden="true" size={28} /></span>
              <h3>{pick(item.title)}</h3>
              <p>{pick(item.body)}</p>
              <span className="tmk-track__cta">{item.cta ? pick(item.cta.label) : ''}<Forward aria-hidden="true" size={18} /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="about-values">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{pick(valuesHead.kicker)}</p>
          <h2 id="about-values">{pick(valuesHead.title)}</h2>
        </div>
        <div className="tmk-features">
          {[1, 2, 3, 4].map(number => S(`about.value.${number}`)).map((value, index) => {
            const Icon = [Eye, ShieldCheck, Scale, Handshake][index] ?? Eye;
            return (
              <article className="tmk-feature tmk-reveal" key={index} style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
                <h3>{pick(value.title)}</h3>
                <p>{pick(value.body)}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tmk-impact tmk-reveal" aria-label={text.kicker}>
        <div className="tmk-impact__inner">
          {[
            { value: projects.ok ? projects.data.length : 0, label: text.numbers.projects, icon: FolderKanban },
            { value: orgList.length, label: text.numbers.organizations, icon: Building2 },
            { value: orgList.filter(org => org.verified).length, label: text.numbers.verified, icon: BadgeCheck },
            { value: 3, label: text.numbers.tracks, icon: Layers }
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

      <section className="tmk-section tmk-split" aria-labelledby="about-verify">
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 0 }}>
            <p className="tmk-kicker">{pick(verify.kicker)}</p>
            <h2 id="about-verify">{pick(verify.title)}</h2>
          </div>
          <ul className="tmk-checks">
            {[1, 2, 3].map(number => S(`about.point.${number}`)).map((point, index) => <li key={index}><CircleCheck aria-hidden="true" /><span><strong>{pick(point.title)}</strong><span>{pick(point.body)}</span></span></li>)}
          </ul>
        </div>
        <div className="tmk-split__media tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <img src={verify.image} alt="" loading="lazy" />
          <div className="tmk-split__badge"><strong><BadgeCheck aria-hidden="true" size={30} /></strong><span>{pick(verify.kicker)}</span></div>
        </div>
      </section>

      <section className="tmk-cta tmk-reveal" aria-labelledby="about-cta">
        <img src={cta.image} alt="" loading="lazy" />
        <h2 id="about-cta">{pick(cta.title)}</h2>
        <p>{pick(cta.body)}</p>
        <div className="tmk-carousel__actions">
          {cta.cta ? <a className="tmk-button tmk-button--accent tmk-button--large" href={L(cta.cta.href)}>{pick(cta.cta.label)}<Forward aria-hidden="true" size={20} /></a> : null}
          {cta.cta2 ? <a className="tmk-button tmk-button--glass tmk-button--large" href={L(cta.cta2.href)}>{pick(cta.cta2.label)}</a> : null}
        </div>
      </section>

      <p className="tmk-field__hint" style={{ textAlign: 'center', marginBlockStart: 32 }}>
        {pick(S('about.note').body)} <a href={L('/policies/terms')}>{text.terms}</a>
      </p>
      <p style={{ textAlign: 'center' }}>
        <DownloadButton endpoint={`/policies/terms/versions/${CURRENT_TERMS_VERSION}`} label={locale === 'ar' ? 'نزّل نسخة الشروط المؤرخة' : 'Download dated terms'} />
      </p>
    </AppShell>
  );
}
