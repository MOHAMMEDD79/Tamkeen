import { notFound } from 'next/navigation';
import { GraduationCap, HandHeart, LayoutGrid, Map as MapIcon, TrendingUp } from 'lucide-react';
import { AppShell, isLocale, localePath, translator, type Locale } from '@tamkeen/ui';
import { readPublic, type City, type PublicProjectCard } from '../../../lib/server-api';
import { readSiteContent, withFunding } from '../../../lib/site-content';
import { PageHero, ProjectMediaCard } from '../marketing';
import { PublicList, trackLabel } from '../public-parts';

/**
 * PUB-02. Rendered on the server so the results are in the HTML, and driven entirely by the query
 * string so the back button restores the same filters and the same list (PART-04 acceptance).
 * The form uses GET for the same reason: filtering is navigation, not a mutation.
 */

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, key: string) => {
  const value = search[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Explore projects — Tamkeen', description: 'Browse published projects across charity, investment and training into work.' }
    : { title: 'استكشاف المشاريع — تمكين', description: 'تصفح المشاريع المنشورة في مسارات العمل الخيري والاستثمار والتدريب إلى العمل.' };
}

export default async function Explore({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const search = await searchParams;
  const ar = locale === 'ar';
  const t = translator(locale);

  const filters = new URLSearchParams();
  for (const key of ['type', 'cityId', 'verified', 'q'] as const) {
    const value = one(search, key);
    if (value) filters.set(key, value);
  }

  const [projects, cities, site] = await Promise.all([
    readPublic<PublicProjectCard[]>('/projects', filters),
    readPublic<City[]>('/cities'),
    readSiteContent()
  ]);
  // Funding progress for the cards; each project's detail is read in parallel.
  const cards = projects.ok ? await withFunding(projects.data.slice(0, 48)) : [];
  const typeHref = (type: string | null) => {
    const next = new URLSearchParams(filters);
    if (type) next.set('type', type); else next.delete('type');
    return `${localePath(locale, '/explore')}${next.toString() ? `?${next}` : ''}`;
  };
  const activeType = one(search, 'type') ?? null;
  const pills = [
    { type: null, label: ar ? 'كل المشاريع' : 'All projects', icon: LayoutGrid },
    { type: 'charity', label: trackLabel('charity', locale), icon: HandHeart },
    { type: 'venture', label: trackLabel('venture', locale), icon: TrendingUp },
    { type: 'enablement', label: trackLabel('enablement', locale), icon: GraduationCap }
  ] as const;

  const cityOptions = cities.ok ? cities.data : [];
  const activeCount = [...filters.keys()].length;
  const mapHref = `${localePath(locale, '/map')}${filters.toString() ? `?${filters}` : ''}`;

  return (
    <AppShell locale={locale} path="/explore"
      lead={<PageHero
        image={site.tracks.charity?.imageUrl ?? '/media/defaults/track-charity.jpg'}
        kicker={ar ? 'استكشف المشاريع' : 'Explore projects'}
        title={ar ? 'مشاريع تصنع فرقًا حقيقيًا' : 'Projects making a real difference'}
        lead={ar
          ? 'كل مشروع هنا لجهة معروفة، بميزانية ومراحل معلنة. ابحث عما يلمسك وتابع أثره حتى النهاية.'
          : 'Every project here belongs to a known organisation, with a published budget and stages. Find what moves you and follow its impact to the end.'} />}>

      <section className="tmk-searchbar" aria-labelledby="filters-title">
        <h2 id="filters-title" className="tmk-visually-hidden">{ar ? 'تصفية' : 'Filters'}</h2>
        {/* GET keeps the filters in the URL, so sharing a link and pressing back both work. */}
        <form method="get" action={localePath(locale, '/explore')} autoComplete="off">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-q">{ar ? 'ابحث عن مشروع' : 'Search projects'}</label>
            <input id="filter-q" className="tmk-field__control" type="search" name="q" defaultValue={one(search, 'q') ?? ''} maxLength={120} placeholder={ar ? 'مدرسة، زراعة، تدريب…' : 'School, farming, training…'} />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-type">{ar ? 'المسار' : 'Track'}</label>
            <select id="filter-type" className="tmk-field__control" name="type" defaultValue={one(search, 'type') ?? ''}>
              <option value="">{ar ? 'كل المسارات' : 'All tracks'}</option>
              {(['charity', 'venture', 'enablement'] as const).map(type => <option key={type} value={type}>{trackLabel(type, locale)}</option>)}
            </select>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-city">{ar ? 'المدينة' : 'City'}</label>
            <select id="filter-city" className="tmk-field__control" name="cityId" defaultValue={one(search, 'cityId') ?? ''}>
              <option value="">{ar ? 'كل المدن' : 'All cities'}</option>
              {cityOptions.map(city => <option key={city.id} value={city.id}>{ar ? city.nameAr : city.nameEn}</option>)}
            </select>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-verified">{ar ? 'التوثيق' : 'Verification'}</label>
            <select id="filter-verified" className="tmk-field__control" name="verified" defaultValue={one(search, 'verified') ?? ''}>
              <option value="">{ar ? 'كل الجهات' : 'All organisations'}</option>
              <option value="true">{ar ? 'الموثقة فقط' : 'Verified only'}</option>
            </select>
          </div>
          <button type="submit" className="tmk-button tmk-button--accent" style={{ minBlockSize: 48 }}>{ar ? 'ابحث' : 'Search'}</button>
        </form>
      </section>

      <div className="tmk-section__row" style={{ marginBlockEnd: 24 }}>
        <nav className="tmk-pills" aria-label={ar ? 'المسارات' : 'Tracks'} style={{ marginBlockEnd: 0 }}>
          {pills.map(pill => {
            const Icon = pill.icon;
            return <a key={pill.label} className="tmk-pill" href={typeHref(pill.type)} aria-current={activeType === pill.type ? 'true' : undefined}><Icon aria-hidden="true" size={18} />{pill.label}</a>;
          })}
        </nav>
        <div className="tmk-row__actions">
          <strong>
            {projects.ok
              ? (ar ? `${projects.data.length} مشروع` : `${projects.data.length} project${projects.data.length === 1 ? '' : 's'}`)
              : t('readFailedTitle')}
          </strong>
          {activeCount > 0 ? <a className="tmk-button tmk-button--quiet" href={localePath(locale, '/explore')}>{ar ? 'مسح الفلاتر' : 'Clear filters'}</a> : null}
          <a className="tmk-button tmk-button--secondary" href={mapHref}><MapIcon aria-hidden="true" size={18} />{ar ? 'على الخريطة' : 'On the map'}</a>
        </div>
      </div>

      <PublicList
        locale={locale}
        result={projects}
        empty={{
          title: ar ? 'لا مشاريع مطابقة' : 'No matching projects',
          body: activeCount > 0
            ? (ar ? 'جرّب توسيع الفلاتر أو مسحها.' : 'Try widening or clearing the filters.')
            : (ar ? 'لم تُنشر مشاريع بعد. المشروع يظهر هنا بعد أن يعتمده مراجع مستقل.' : 'No projects have been published yet. A project appears here once an independent reviewer approves it.')
        }}
        render={items => (
          <div className="tmk-projects">
            {items.map((project, index) => <ProjectMediaCard key={project.slug} project={cards.find(card => card.slug === project.slug) ?? project} locale={locale} index={index} />)}
          </div>
        )}
      />

      {projects.ok && projects.page?.hasMore ? (
        <p className="tmk-field__hint">
          {ar ? 'توجد نتائج إضافية. ضيّق الفلاتر لعرضها.' : 'More results exist. Narrow the filters to reach them.'}
        </p>
      ) : null}
    </AppShell>
  );
}
