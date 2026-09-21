import { notFound } from 'next/navigation';
import { AppShell, Card, PageHeader, isLocale, localePath, translator, type Locale } from '@tamkeen/ui';
import { readPublic, type City, type PublicProjectCard } from '../../../lib/server-api';
import { PublicList, ProjectCard, trackLabel } from '../public-parts';

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

  const [projects, cities] = await Promise.all([
    readPublic<PublicProjectCard[]>('/projects', filters),
    readPublic<City[]>('/cities')
  ]);

  const cityOptions = cities.ok ? cities.data : [];
  const activeCount = [...filters.keys()].length;
  const mapHref = `${localePath(locale, '/map')}${filters.toString() ? `?${filters}` : ''}`;

  return (
    <AppShell locale={locale} path="/explore">
      <PageHeader
        eyebrow={ar ? 'استكشف' : 'Explore'}
        title={ar ? 'مشاريع وفرص مفتوحة' : 'Open projects and opportunities'}
        lead={ar
          ? 'تظهر هنا المشاريع المنشورة فقط. كل بطاقة تذكر الجهة المنفذة وحالة توثيقها ومكانها.'
          : 'Only published projects appear here. Every card names the delivering organisation, its verification status and its location.'}
      />

      <Card title={ar ? 'تصفية' : 'Filters'} id="filters">
        {/* GET keeps the filters in the URL, so sharing a link and pressing back both work. */}
        <form method="get" action={localePath(locale, '/explore')} autoComplete="off" className="tmk-toolbar">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-q">{ar ? 'بحث' : 'Search'}</label>
            <input id="filter-q" className="tmk-field__control" type="search" name="q" defaultValue={one(search, 'q') ?? ''} maxLength={120} />
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
              <option value="true">{ar ? 'الجهات الموثقة فقط' : 'Verified organisations only'}</option>
            </select>
          </div>
          <button type="submit" className="tmk-button tmk-button--primary">{ar ? 'طبّق' : 'Apply'}</button>
          {activeCount > 0 ? <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/explore')}>{ar ? 'مسح الفلاتر' : 'Clear filters'}</a> : null}
          <a className="tmk-button tmk-button--secondary" href={mapHref}>{ar ? 'عرض على الخريطة' : 'Show on map'}</a>
        </form>
        <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'الفلاتر في الرابط، فيعيد زر الرجوع النتائج نفسها، ويمكن مشاركة الرابط كما هو.'
            : 'Filters live in the URL, so the back button restores the same results and the link can be shared as is.'}
        </p>
      </Card>

      <h2>
        {projects.ok
          ? (ar ? `${projects.data.length} نتيجة` : `${projects.data.length} result${projects.data.length === 1 ? '' : 's'}`)
          : t('readFailedTitle')}
      </h2>

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
          <div className="tmk-grid tmk-grid--cards">
            {items.map(project => <ProjectCard key={project.slug} project={project} locale={locale} />)}
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
