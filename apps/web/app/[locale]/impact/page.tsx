import { notFound } from 'next/navigation';
import { AppShell, Card, DataTable, EmptyState, Notice, PageHeader, Stat, StatusBadge, formatDate, isLocale, type Locale } from '@tamkeen/ui';
import { readPublic, type ImpactSummary, type PublicReportSummary } from '../../../lib/server-api';
import { ReadError } from '../public-parts';

/**
 * PUB-12. 14-ANALYTICS requires every figure to carry its definition and its source, and 15-QUALITY
 * forbids inventing one. So this page prints the figures that have a source, and prints the others
 * as explicitly unavailable — a reader must be able to tell "not built" from "zero".
 */

export const dynamic = 'force-dynamic';

const figureLabels: Record<string, { ar: string; en: string }> = {
  published_projects: { ar: 'مشاريع منشورة', en: 'Published projects' },
  verified_organizations: { ar: 'جهات موثقة', en: 'Verified organisations' },
  total_contributions: { ar: 'إجمالي المساهمات', en: 'Total contributions' },
  net_funding: { ar: 'صافي التمويل', en: 'Net funding' },
  contributions_confirmed: { ar: 'مساهمات مؤكدة', en: 'Confirmed contributions' },
  verified_beneficiaries: { ar: 'مستفيدون موثقون', en: 'Verified beneficiaries' },
  placements_started: { ar: 'توظيف مؤكد البدء', en: 'Placements started' }
};

const definitionsAr: Record<string, string> = {
  published_projects: 'مشاريع اعتمدها مراجع مستقل ونُشرت، في أي مسار.',
  verified_organizations: 'جهات تحمل قرار توثيق ساريًا.',
  contributions_confirmed: 'مساهمات مؤكدة في جميع المشاريع. الدفع محاكى في هذه النسخة، ولم تنتقل أموال حقيقية.'
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Impact — Tamkeen', description: 'Platform figures, each with the definition it is counted by.' }
    : { title: 'الأثر والشفافية — تمكين', description: 'أرقام المنصة، ولكل رقم تعريفه الذي يُحتسب به.' };
}

export default async function Impact({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const [result, reports] = await Promise.all([readPublic<ImpactSummary>('/impact'), readPublic<PublicReportSummary[]>('/public-reports')]);
  const label = (key: string) => figureLabels[key]?.[locale] ?? key;

  return (
    <AppShell locale={locale} path="/impact">
      <PageHeader
        eyebrow={ar ? 'الأثر والشفافية' : 'Impact and transparency'}
        title={ar ? 'ما يمكن إثباته اليوم' : 'What can be evidenced today'}
        lead={ar
          ? 'كل رقم هنا يذكر تعريفه ومصدره. الرقم الذي لا مصدر له لا يُعرض كصفر، بل يُعلن أنه غير متاح.'
          : 'Every figure here states its definition and its source. A figure with no source is not shown as zero — it is declared unavailable.'}
      />

      {!result.ok ? <ReadError locale={locale} result={result} /> : (
        <>
          <Card title={ar ? 'أرقام لها مصدر' : 'Figures with a source'}>
            <div className="tmk-grid tmk-grid--stats">
              {result.data.counted.map(entry => (
                <Stat
                  key={entry.key}
                  label={label(entry.key)}
                  value={entry.value.toLocaleString(ar ? 'ar-u-nu-latn' : 'en')}
                  note={ar ? (definitionsAr[entry.key] ?? entry.definition) : entry.definition}
                />
              ))}
            </div>
            <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
              {ar ? 'آخر تحديث' : 'As of'} {formatDate(result.data.asOf, locale, true)}
            </p>
          </Card>

          <Card title={ar ? 'أرقام غير متاحة بعد' : 'Figures not available yet'}>
            <p>
              {ar
                ? 'هذه الأرقام محددة في المواصفة، ولا توجد وحدة تنتجها بعد. عرضها كصفر سيكون ادعاءً غير صحيح.'
                : 'These figures are specified, and no module produces them yet. Showing them as zero would be a false claim.'}
            </p>
            <DataTable
              caption={ar ? 'أرقام معلنة غير متاحة، والجزء المسؤول عن كل منها' : 'Declared figures that are unavailable, and the part that owns each'}
              rows={result.data.unavailable}
              rowKey={row => row.key}
              emptyState={<EmptyState title={ar ? 'لا شيء معلق' : 'Nothing outstanding'} />}
              columns={[
                { key: 'figure', header: ar ? 'الرقم' : 'Figure', cell: row => label(row.key) },
                { key: 'status', header: ar ? 'الحالة' : 'Status', cell: () => <StatusBadge tone="neutral">{ar ? 'غير منفذ بعد' : 'Not implemented yet'}</StatusBadge> },
                { key: 'part', header: ar ? 'الجزء المسؤول' : 'Owning part', cell: row => row.part }
              ]}
            />
          </Card>

          <Notice tone="info" title={ar ? 'كيف تُقرأ هذه الصفحة' : 'How to read this page'}>
            <p style={{ marginBlockEnd: 0 }}>
              {ar
                ? 'عدد المشاريع المنشورة يقيس ما اجتاز المراجعة، لا ما اكتمل تنفيذه ولا ما جُمع له تمويل. مؤشرات المال والمستفيدين والتوظيف تحتاج دفترًا وأدلة تسليم وتواريخ بدء مؤكدة، وكلها تأتي مع أجزائها.'
                : 'The published project count measures what passed review — not what was delivered, and not what was funded. Money, beneficiary and employment indicators require a ledger, delivery evidence and confirmed start dates, all of which arrive with their own parts.'}
            </p>
          </Notice>
          {reports.ok && reports.data.length ? <Card title={ar ? 'تقارير أثر منشورة' : 'Published impact reports'}><div className="tmk-stack">{reports.data.map(report => <a className="tmk-row" key={report.id} href={`/${locale}/impact/reports/${report.id}`}><strong>{report.title}</strong><span className="tmk-field__hint">{formatDate(report.publishedAt, locale)} · {report.currency ?? (ar ? 'بلا عملة' : 'No currency')}</span></a>)}</div></Card> : null}
        </>
      )}
    </AppShell>
  );
}
