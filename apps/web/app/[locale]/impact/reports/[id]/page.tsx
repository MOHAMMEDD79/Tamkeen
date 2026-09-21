import { notFound } from 'next/navigation';
import { AppShell, Card, DataTable, EmptyState, PageHeader, formatDate, isLocale, type Locale } from '@tamkeen/ui';
import { readPublic } from '../../../../../lib/server-api';
import { DownloadButton } from '../../../download-button';

type Report = { id: string; title: string; sourceType: string; version: number; snapshot: Record<string, unknown>; currency: string | null; periodStart: string | null; periodEnd: string | null; filterDefinition: string; publishedAt: string };
export const dynamic = 'force-dynamic';
export default async function ImpactReport({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params; if (!isLocale(raw)) notFound(); const locale = raw satisfies Locale; const ar = locale === 'ar';
  const result = await readPublic<Report>(`/public-reports/${encodeURIComponent(id)}`); if (!result.ok) notFound(); const report = result.data;
  const rows = Object.entries(report.snapshot).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join('، ') : String(value) }));
  return <AppShell locale={locale} path={`/impact/reports/${id}`}><PageHeader eyebrow="SUP-04" title={report.title} lead={report.filterDefinition} actions={<DownloadButton endpoint={`/public-reports/${id}/download`} label={ar ? 'نزّل النسخة العامة' : 'Download public copy'} />} /><Card title={ar ? 'نطاق التقرير' : 'Report scope'}><p>{report.periodStart ?? '—'} — {report.periodEnd ?? '—'} · {report.currency ?? (ar ? 'بلا عملة' : 'No currency')}</p><p className="tmk-field__hint">{ar ? 'نُشر' : 'Published'} {formatDate(report.publishedAt, locale, true)} · v{report.version}</p></Card><Card title={ar ? 'اللقطة المنشورة' : 'Published snapshot'}><DataTable caption={ar ? 'مؤشرات التقرير المنشور' : 'Published report indicators'} rows={rows} rowKey={row => row.key} emptyState={<EmptyState title={ar ? 'لا مؤشرات' : 'No indicators'} />} columns={[{ key: 'metric', header: ar ? 'المؤشر' : 'Metric', cell: row => row.key }, { key: 'value', header: ar ? 'القيمة' : 'Value', cell: row => row.value }]} /></Card></AppShell>;
}
