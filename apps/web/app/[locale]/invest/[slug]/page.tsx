import { notFound } from 'next/navigation';
import { AppShell, Card, Ltr, MoneyAmount, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicOfferingDetail } from '../../../../lib/server-api';
import { ReadError, subscribeClosedReason } from '../../public-parts';

/**
 * PUB-08. One offering, with the disclosure it is published against.
 *
 * The page refuses to do three things that would mislead a reader about money:
 *  - it shows no projected return and no valuation, because neither is a fact;
 *  - it states the offering as a share of the *company*, not only of the offering;
 *  - it offers a subscribe button only where the server would actually accept a commitment, and
 *    writes out the reason where it would not — 00-MASTER-PROMPT's rule against a control that
 *    would fail, applied to a condition rather than to the state of the build.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicOfferingDetail>(`/offerings/${pathSegment(slug)}`);
  if (!result.ok) return { title: locale === 'en' ? 'Offering — Tamkeen' : 'عرض — تمكين' };
  return {
    title: `${result.data.title} — ${result.data.organization.displayName}`,
    description: result.data.disclosure?.summary.slice(0, 160) ?? undefined
  };
}

export default async function OfferingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicOfferingDetail>(`/offerings/${pathSegment(slug)}`);
  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/invest/${slug}`}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const offering = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/invest')}>{ar ? 'الاستثمار' : 'Investment'}</a></li>
                <li><a href={localePath(locale, `/organizations/${offering.organization.slug}`)}>{offering.organization.displayName}</a></li>
                <li><span aria-current="page">{offering.title}</span></li>
              </ol>
            </nav>

            <PageHeader
              eyebrow={`${offering.organization.displayName} · ${offering.organization.city}`}
              title={offering.title}
              lead={ar
                ? 'أسهم عادية. النِسَب أدناه تقديرية حتى التخصيص النهائي.'
                : 'Common shares. The percentages below are indicative until a final allocation.'}
            />

            <p className="tmk-row__actions">
              <StatusBadge tone={offering.state === 'open' ? 'success' : offering.state === 'suspended' ? 'warning' : 'neutral'}>
                {offering.state === 'open' ? (ar ? 'مفتوح للاكتتاب' : 'Open') : offering.state === 'suspended' ? (ar ? 'موقوف' : 'Suspended') : (ar ? 'أُغلق الاكتتاب' : 'Closed')}
              </StatusBadge>
              {offering.organization.verified
                ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified issuer'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'جهة غير موثقة' : 'Unverified issuer'}</StatusBadge>}
            </p>

            {offering.state === 'suspended' ? (
              <Notice tone="warning" title={ar ? 'العرض موقوف' : 'This offering is suspended'}>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'نُشر تعديل جوهري على الإفصاح، فتوقف العرض حتى تُعالَج الالتزامات القائمة وفق السياسة المعتمدة.'
                    : 'A material change to the disclosure was published, so the offering is halted until existing commitments have been dealt with under the agreed policy.'}
                </p>
              </Notice>
            ) : null}

            <Card title={ar ? 'الشروط' : 'Terms'}>
              <dl className="tmk-definitions">
                <div>
                  <dt>{ar ? 'سعر السهم' : 'Price per share'}</dt>
                  <dd><MoneyAmount minor={offering.pricePerShareMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  <dt>{ar ? 'الأسهم المعروضة' : 'Shares offered'}</dt>
                  <dd><Ltr>{Number(offering.sharesOffered).toLocaleString('en')}</Ltr></dd>
                </div>
                <div>
                  <dt>{ar ? 'أقصى ما يمكن جمعه' : 'Maximum raise'}</dt>
                  <dd><MoneyAmount minor={offering.maximumRaiseMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  <dt>{ar ? 'الحد الأدنى للجمع' : 'Minimum raise'}</dt>
                  <dd><MoneyAmount minor={offering.minimumRaiseMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  <dt>{ar ? 'الحد الأدنى للاكتتاب' : 'Minimum ticket'}</dt>
                  <dd><MoneyAmount minor={offering.minimumTicketMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  <dt>{ar ? 'يغلق في' : 'Closes'}</dt>
                  <dd>{offering.closesAt ? formatDate(offering.closesAt, locale) : '—'}</dd>
                </div>
              </dl>
            </Card>

            {/* The distinction 06 exists to protect: of the offering, versus of the company. */}
            <Card title={ar ? 'ما الذي يمثله هذا العرض من الشركة' : 'What this offering represents of the company'}>
              <p>
                {ar
                  ? <>لو بيعت كل الأسهم المعروضة، فإنها تمثل <strong><Ltr>{offering.offeringPercentOfPostRaise}%</Ltr></strong> من أسهم الشركة بعد الإصدار، وعددها <Ltr>{Number(offering.postRaiseShares).toLocaleString('en')}</Ltr> سهمًا.</>
                  : <>If every offered share sells, they amount to <strong><Ltr>{offering.offeringPercentOfPostRaise}%</Ltr></strong> of the company&rsquo;s <Ltr>{Number(offering.postRaiseShares).toLocaleString('en')}</Ltr> shares after issue.</>}
              </p>
              <p className="tmk-field__hint">
                {ar
                  ? 'اكتتابك يمثل نسبة من العرض، ونسبة أصغر بكثير من الشركة. الرقمان مختلفان دائمًا، ويُعرضان منفصلين عند حساب أي مبلغ.'
                  : 'A subscription is a share of the offering, and a much smaller share of the company. The two are always different, and both are shown when any amount is priced.'}
              </p>
            </Card>

            {offering.disclosure ? (
              <Card title={ar ? `الإفصاح — النسخة ${offering.disclosure.sequence}` : `Disclosure — version ${offering.disclosure.sequence}`}>
                <p className="tmk-field__hint">
                  {ar ? 'نُشرت في ' : 'Published '}{formatDate(offering.disclosure.publishedAt, locale)} ·{' '}
                  {ar ? 'بصمتها ' : 'checksum '}<Ltr><code>{offering.disclosure.checksum.slice(0, 16)}…</code></Ltr>
                </p>
                <div className="tmk-prose">
                  <p>{offering.disclosure.summary}</p>
                  <h3>{ar ? 'المخاطر' : 'Risks'}</h3>
                  <p>{offering.disclosure.risks}</p>
                  <h3>{ar ? 'أوجه استخدام التمويل' : 'Use of funds'}</h3>
                  <p>{offering.disclosure.useOfFunds}</p>
                </div>
              </Card>
            ) : null}

            {/* PART-09 built this path. The button appears only where the server would accept it,
                and where it would not, the reason stands in its place. */}
            <Card title={ar ? 'الاكتتاب' : 'Subscribing'}>
              {offering.acceptsCommitments ? (
                <>
                  <p>
                    {ar
                      ? 'الاكتتاب ثلاث خطوات منفصلة: حجز سعة لمدة محدودة، ثم تأكيد العقد على نسخة الإفصاح هذه بعينها، ثم الدفع. لا تملك حصة إلا بعد تخصيص مثبت.'
                      : 'Subscribing is three separate steps: a time-limited reservation, then a contract against this exact disclosure version, then payment. You own no share until an allocation is proven.'}
                  </p>
                  <p className="tmk-row__actions">
                    <a className="tmk-button tmk-button--primary" href={localePath(locale, `/invest/${slug}/subscribe`)}>
                      {ar ? 'ابدأ الاكتتاب' : 'Start subscribing'}
                    </a>
                    <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/app/investor/eligibility')}>
                      {ar ? 'ملف الأهلية' : 'Your eligibility'}
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <Notice tone="info" title={ar ? 'الاكتتاب مغلق الآن' : 'Subscribing is closed right now'}>
                    <p style={{ marginBlockEnd: 0 }}>{subscribeClosedReason(offering.commitmentsUnavailableReason, ar)}</p>
                  </Notice>
                  <p className="tmk-row__actions">
                    <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/app/investor/eligibility')}>
                      {ar ? 'ابدأ ملف الأهلية' : 'Start your eligibility'}
                    </a>
                  </p>
                </>
              )}
              <p className="tmk-field__hint">
                {ar
                  ? 'الأهلية قرار مراجعة مستقل بمدة صلاحية، ولا يمنحها اختيارك لقدرة «مستثمر» في ملفك.'
                  : 'Eligibility is an independent, time-limited review decision. Choosing the Investor capability on your profile does not grant it.'}
              </p>
            </Card>

            {offering.publicDocuments.length > 0 ? (
              <Card title={ar ? 'مستندات عامة' : 'Public documents'}>
                <ul>
                  {offering.publicDocuments.map(document => <li key={document.id}>{document.title}</li>)}
                </ul>
                <p className="tmk-field__hint">
                  {ar
                    ? 'بقية مستندات غرفة البيانات تحتاج طلب وصول وقبول الإفصاح. التنزيل لم يُبنَ بعد.'
                    : 'The rest of the data room needs an access request and an accepted disclosure. Downloading has not been built yet.'}
                </p>
              </Card>
            ) : null}
          </>
        );
      })()}
    </AppShell>
  );
}
