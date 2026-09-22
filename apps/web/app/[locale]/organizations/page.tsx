import { notFound } from 'next/navigation';
import { AppShell, Card, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOrganizationSummary } from '../../../lib/server-api';
import { readSiteContent, section } from '../../../lib/site-content';
import { OrganizationCard, PublicList } from '../public-parts';
import { PageHero } from '../marketing';

/** PUB-04. An expired verification is not "verified", which the filter and the badge both respect. */

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, key: string) => {
  const value = search[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Organisations — Tamkeen', description: 'Organisations delivering projects on Tamkeen, with their verification status.' }
    : { title: 'دليل الجهات — تمكين', description: 'الجهات المنفذة على منصة تمكين وحالة توثيق كل منها.' };
}

export default async function Organizations({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const search = await searchParams;
  const ar = locale === 'ar';

  const filters = new URLSearchParams();
  for (const key of ['verified', 'q', 'country'] as const) {
    const value = one(search, key);
    if (value) filters.set(key, value);
  }
  const [organizations, site] = await Promise.all([readPublic<PublicOrganizationSummary[]>('/organizations', filters), readSiteContent()]);
  const header = section(site, 'organizations.header');
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;

  return (
    <AppShell locale={locale} path="/organizations"
      lead={<PageHero image={header.image} kicker={pick(header.kicker)} title={pick(header.title)} lead={pick(header.body)} />}>

      <Card title={ar ? 'تصفية' : 'Filters'}>
        <form method="get" action={localePath(locale, '/organizations')} autoComplete="off" className="tmk-toolbar">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="org-q">{ar ? 'بحث بالاسم' : 'Search by name'}</label>
            <input id="org-q" className="tmk-field__control" type="search" name="q" defaultValue={one(search, 'q') ?? ''} maxLength={120} />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="org-verified">{ar ? 'التوثيق' : 'Verification'}</label>
            <select id="org-verified" className="tmk-field__control" name="verified" defaultValue={one(search, 'verified') ?? ''}>
              <option value="">{ar ? 'كل الجهات' : 'All organisations'}</option>
              <option value="true">{ar ? 'الموثقة فقط' : 'Verified only'}</option>
            </select>
          </div>
          <button type="submit" className="tmk-button tmk-button--primary">{ar ? 'طبّق' : 'Apply'}</button>
          {[...filters.keys()].length ? <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/organizations')}>{ar ? 'مسح التصفية' : 'Clear filters'}</a> : null}
        </form>
      </Card>

      <PublicList
        locale={locale}
        result={organizations}
        empty={{
          title: ar ? 'لا جهات مطابقة' : 'No matching organisations',
          body: ar ? 'جرّب مسح التصفية، أو أنشئ جهة لتكون أول من ينضم.' : 'Try clearing the filters, or create an organisation to be the first to join.'
        }}
        render={items => (
          <div className="tmk-org-grid">
            {items.map(organization => <OrganizationCard key={organization.slug} organization={organization} locale={locale} />)}
          </div>
        )}
      />
    </AppShell>
  );
}
