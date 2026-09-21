import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, GraduationCap, HandHeart, MapPin, TrendingUp } from 'lucide-react';
import { MoneyAmount, StatusBadge, localePath, type Locale } from '@tamkeen/ui';
import type { PublicProjectCard, PublicProjectDetail } from '../../lib/server-api';
import { coverFor } from '../../lib/site-content';
import { cityName, stateLabel, stateTone } from './public-parts';

/**
 * The public, marketing-grade pieces shared by the home, explore, about and contact pages. All
 * server-rendered: the only client code on these pages is the carousel and the scroll reveal.
 */

export const TRACK_META = {
  charity: { icon: HandHeart, ar: 'خيري', en: 'Charity' },
  venture: { icon: TrendingUp, ar: 'استثماري', en: 'Investment' },
  enablement: { icon: GraduationCap, ar: 'تشغيل وتمكين', en: 'Jobs & training' }
} as const;

export const forwardIcon = (locale: Locale) => (locale === 'ar' ? ArrowLeft : ArrowRight);

/** A project as a photo card with its funding progress and the action that moves it forward. */
export function ProjectMediaCard({ project, locale, index = 0 }: {
  project: PublicProjectCard & { funding?: PublicProjectDetail['funding'] | null };
  locale: Locale;
  index?: number;
}) {
  const ar = locale === 'ar';
  const meta = TRACK_META[project.type as keyof typeof TRACK_META] ?? TRACK_META.charity;
  const Icon = meta.icon;
  const Forward = forwardIcon(locale);
  const funding = project.funding && project.funding.available ? project.funding : null;
  const percent = funding ? Math.max(0, Math.min(100, Math.round(funding.percentOfGoal))) : null;
  const href = localePath(locale, `/projects/${project.slug}`);
  return (
    <article className="tmk-project tmk-reveal" style={{ ['--reveal-delay' as string]: index % 3 }}>
      <div className="tmk-project__media">
        <img src={coverFor(project)} alt="" loading="lazy" />
        <span className="tmk-project__chip"><Icon aria-hidden="true" size={15} />{ar ? meta.ar : meta.en}</span>
        <span className="tmk-project__state"><StatusBadge tone={stateTone(project.state)}>{stateLabel(project.state, locale)}</StatusBadge></span>
      </div>
      <div className="tmk-project__body">
        <p className="tmk-project__org" style={{ margin: 0 }}>
          {project.organization.verified ? <BadgeCheck aria-label={ar ? 'جهة موثقة' : 'Verified organisation'} size={16} /> : null}
          <span>{project.organization.displayName}</span>
          <span aria-hidden="true">·</span>
          <MapPin aria-hidden="true" size={14} />
          <span>{cityName(project.location, locale)}</span>
        </p>
        <h3 className="tmk-project__title"><a href={href}>{project.title}</a></h3>
        <p className="tmk-project__summary">{project.summary}</p>
        {funding && percent !== null ? (
          <div className="tmk-project__funding">
            <div className="tmk-meter__track" role="progressbar" aria-label={ar ? 'نسبة التمويل' : 'Funded'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="tmk-meter__fill" style={{ inlineSize: `${percent}%` }} />
            </div>
            <div className="tmk-project__numbers">
              <span><strong><MoneyAmount minor={funding.raisedMinor} currency={funding.currency} locale={locale} /></strong> {ar ? 'من' : 'of'} <MoneyAmount minor={funding.goalMinor} currency={funding.currency} locale={locale} /></span>
              <span className="tmk-project__percent">{percent}%</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="tmk-project__foot">
        <span>{funding ? (ar ? `${funding.contributionCount} مساهمة` : `${funding.contributionCount} contributions`) : (ar ? 'مشروع منشور' : 'Published project')}</span>
        <a className="tmk-button tmk-button--accent" href={href}>{project.type === 'venture' ? (ar ? 'اعرف أكثر' : 'Learn more') : (ar ? 'ساهم الآن' : 'Contribute')}<Forward aria-hidden="true" size={16} /></a>
      </div>
    </article>
  );
}

/** The photo banner at the top of an inner page. Rendered in the shell's full-width lead slot. */
export function PageHero({ image, kicker, title, lead, children }: { image: string; kicker: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <section className="tmk-page-hero">
      <img src={image} alt="" />
      <div className="tmk-page-hero__inner">
        <p className="tmk-kicker">{kicker}</p>
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
