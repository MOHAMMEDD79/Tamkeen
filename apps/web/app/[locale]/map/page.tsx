import { notFound } from 'next/navigation';
import { AppShell, Card, DataTable, EmptyState, Ltr, Notice, PageHeader, StatusBadge, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type City, type PublicProjectCard } from '../../../lib/server-api';
import { ReadError, cityName, stateLabel, trackLabel } from '../public-parts';
import { ProjectMap } from '../maps';

/**
 * PUB-03. An interactive map on OpenStreetMap tiles (the default, `MAP_PROVIDER=osm`), with the
 * same results as a list below it. Setting `MAP_PROVIDER=disabled` removes the map and says so, and
 * the list then carries the whole feature. OpenStreetMap's tile policy allows light use with
 * attribution; a busy production site should move to a paid or self-hosted tile provider.
 *
 * Coordinates come from the public projection, which never carries a beneficiary's position.
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
    ? { title: 'Project map — Tamkeen', description: 'Where published projects are delivered, at the precision each project allows.' }
    : { title: 'خريطة المشاريع — تمكين', description: 'أماكن تنفيذ المشاريع المنشورة، بالدقة التي يسمح بها كل مشروع.' };
}

export default async function MapPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const search = await searchParams;
  const ar = locale === 'ar';
  const mapProvider = process.env.MAP_PROVIDER ?? 'osm';

  const filters = new URLSearchParams();
  for (const key of ['type', 'cityId', 'verified', 'q'] as const) {
    const value = one(search, key);
    if (value) filters.set(key, value);
  }

  const [projects, cities] = await Promise.all([
    readPublic<PublicProjectCard[]>('/map/projects', filters),
    readPublic<City[]>('/cities')
  ]);
  const cityOptions = cities.ok ? cities.data : [];
  const exploreHref = `${localePath(locale, '/explore')}${filters.toString() ? `?${filters}` : ''}`;

  return (
    <AppShell locale={locale} path="/map">
      <PageHeader
        eyebrow={ar ? 'الخريطة' : 'Map'}
        title={ar ? 'أين تُنفَّذ المشاريع' : 'Where projects are delivered'}
        lead={ar
          ? 'يعرض كل مشروع موقعه بالدقة التي أعلنها: على مستوى المدينة، أو تقريبيًا، أو كمنشأة عامة محددة.'
          : 'Each project shows its location at the precision it declared: city level, approximate, or a specific public facility.'}
        actions={<a className="tmk-button tmk-button--secondary" href={exploreHref}>{ar ? 'عرض كقائمة بطاقات' : 'View as cards'}</a>}
      />

      {mapProvider !== 'disabled' && projects.ok && projects.data.some(row => row.location.point) ? (
        <ProjectMap height={480} label={ar ? 'خريطة المشاريع' : 'Project map'}
          points={projects.data.filter(row => row.location.point).map(row => ({
            latitude: row.location.point!.latitude, longitude: row.location.point!.longitude, precision: row.location.precision,
            title: row.title, href: localePath(locale, `/projects/${row.slug}`)
          }))} />
      ) : null}

      {mapProvider === 'disabled' ? (
        <Notice tone="warning" title={ar ? 'الخريطة التفاعلية غير مفعّلة' : 'The interactive map is not enabled'}>
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'لم يُختر مزود خرائط ولم تُحسم رخصة البلاطات بعد، فلا تُعرض خريطة تفاعلية. القائمة أدناه تحمل النتائج نفسها وإحداثياتها المعلنة، وليست نسخة منقوصة.'
              : 'No map provider has been chosen and the tile licence is still an open decision, so no interactive map is shown. The list below carries exactly the same results and their published coordinates — it is not a reduced version.'}
          </p>
        </Notice>
      ) : null}

      <Card title={ar ? 'تصفية' : 'Filters'}>
        <form method="get" action={localePath(locale, '/map')} autoComplete="off" className="tmk-toolbar">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="map-q">{ar ? 'بحث' : 'Search'}</label>
            <input id="map-q" className="tmk-field__control" type="search" name="q" defaultValue={one(search, 'q') ?? ''} maxLength={120} />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="map-city">{ar ? 'المدينة' : 'City'}</label>
            <select id="map-city" className="tmk-field__control" name="cityId" defaultValue={one(search, 'cityId') ?? ''}>
              <option value="">{ar ? 'كل المدن' : 'All cities'}</option>
              {cityOptions.map(city => <option key={city.id} value={city.id}>{ar ? city.nameAr : city.nameEn}</option>)}
            </select>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="map-type">{ar ? 'المسار' : 'Track'}</label>
            <select id="map-type" className="tmk-field__control" name="type" defaultValue={one(search, 'type') ?? ''}>
              <option value="">{ar ? 'كل المسارات' : 'All tracks'}</option>
              {(['charity', 'venture', 'enablement'] as const).map(type => <option key={type} value={type}>{trackLabel(type, locale)}</option>)}
            </select>
          </div>
          <button type="submit" className="tmk-button tmk-button--primary">{ar ? 'طبّق' : 'Apply'}</button>
          {[...filters.keys()].length ? <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/map')}>{ar ? 'مسح الفلاتر' : 'Clear filters'}</a> : null}
        </form>
      </Card>

      {!projects.ok ? <ReadError locale={locale} result={projects} /> : projects.data.length === 0 ? (
        <EmptyState title={ar ? 'لا مواقع مطابقة' : 'No matching locations'}>
          {ar ? 'لا مشاريع منشورة ضمن هذه الفلاتر.' : 'No published projects match these filters.'}
        </EmptyState>
      ) : (
        <DataTable
          caption={ar ? `${projects.data.length} موقعًا منشورًا` : `${projects.data.length} published location${projects.data.length === 1 ? '' : 's'}`}
          rows={projects.data}
          rowKey={row => row.slug}
          emptyState={<EmptyState title={ar ? 'لا مواقع' : 'No locations'} />}
          columns={[
            { key: 'title', header: ar ? 'المشروع' : 'Project', cell: row => <a href={localePath(locale, `/projects/${row.slug}`)}>{row.title}</a> },
            { key: 'organization', header: ar ? 'الجهة' : 'Organisation', cell: row => row.organization.displayName },
            { key: 'city', header: ar ? 'المدينة' : 'City', cell: row => cityName(row.location, locale) },
            {
              key: 'precision', header: ar ? 'دقة الموقع' : 'Location precision',
              cell: row => <StatusBadge tone={row.location.precision === 'exact' ? 'info' : 'neutral'}>
                {row.location.precision === 'city' ? (ar ? 'مدينة' : 'City')
                  : row.location.precision === 'approximate' ? (ar ? 'تقريبي' : 'Approximate')
                  : (ar ? 'منشأة عامة' : 'Public facility')}
              </StatusBadge>
            },
            {
              key: 'point', header: ar ? 'الإحداثيات المعلنة (عرض، طول)' : 'Published coordinates (lat, lon)', numeric: true,
              // A latitude/longitude pair must not be reordered by the surrounding RTL text: read in
              // the wrong order it is simply a different place. Ltr forces the pair to stay as written.
              cell: row => row.location.point
                ? <Ltr>{row.location.point.latitude.toFixed(4)}, {row.location.point.longitude.toFixed(4)}</Ltr>
                : <span className="tmk-field__hint">{ar ? 'غير معلنة' : 'Not published'}</span>
            },
            { key: 'state', header: ar ? 'الحالة' : 'Status', cell: row => stateLabel(row.state, locale) }
          ]}
        />
      )}

      <p className="tmk-field__hint">
        {ar
          ? 'الإحداثيات المعروضة هي ما أعلنه المشروع للعرض العام. لا تُنشر مواقع المستفيدين ولا عناوينهم.'
          : 'The coordinates shown are what each project published for public display. Beneficiary locations and addresses are never published.'}
      </p>
    </AppShell>
  );
}
