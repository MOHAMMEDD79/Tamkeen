import { notFound } from 'next/navigation';
import { AppShell, Card, Ltr, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type CertificateCheck } from '../../../../lib/server-api';
import { ReadError } from '../../public-parts';

/**
 * The public certificate check.
 *
 * Anyone holding the reference printed on a certificate can ask whether it is valid. Three rules
 * shape what it answers:
 *
 *  - **It attributes the certificate.** A holder name, a programme and an issuer, because a check
 *    that will not say whose certificate it is verifies nothing.
 *  - **It carries no identifier.** 07 forbids a national identifier on the public reference, and
 *    this page also withholds contact details, the attendance record and any assessment score.
 *  - **A revoked reference still resolves**, and says it is no longer valid. A reference that
 *    simply stopped working would leave whoever holds a copy unable to find out what happened —
 *    and *why* it was revoked is between the issuer and the holder, so it is not printed here.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Verify a certificate — Tamkeen', description: 'Check whether a Tamkeen certificate reference is valid.' }
    : { title: 'التحقق من شهادة — تمكين', description: 'تحقق من صلاحية مرجع شهادة صادرة عبر تمكين.' };
}

export default async function VerifyPage({ params }: { params: Promise<{ locale: string; publicId: string }> }) {
  const { locale: raw, publicId } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<CertificateCheck>(`/certificates/${pathSegment(publicId)}/verify`);

  return (
    <AppShell locale={locale} path={`/verify/${publicId}`}>
      <PageHeader
        eyebrow={ar ? 'التحقق' : 'Verification'}
        title={ar ? 'التحقق من شهادة' : 'Certificate check'}
        lead={ar ? `المرجع المطلوب: ${publicId}` : `Reference checked: ${publicId}`}
      />

      {!result.ok && result.status === 404 ? (
        <Notice tone="danger" title={ar ? 'لا شهادة بهذا المرجع' : 'No certificate with this reference'}>
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'لم تصدر عن تمكين شهادة بهذا المرجع. تحقق من نسخه حرفًا بحرف؛ وإن كان صحيحًا فالوثيقة التي بين يديك ليست صادرة عن هذه المنصة.'
              : 'No certificate with this reference was issued through Tamkeen. Check the reference character by character; if it is correct, the document you are holding was not issued here.'}
          </p>
        </Notice>
      ) : !result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const check = result.data;
        return (
          <>
            {check.valid ? (
              <Notice tone="success" title={ar ? 'شهادة سارية' : 'Valid certificate'}>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'هذا المرجع يخص شهادة صادرة وسارية. البيانات أدناه هي ما تُثبته الشهادة، ولا شيء غيره.'
                    : 'This reference belongs to a certificate that was issued and is still valid. What is below is what the certificate attests, and nothing more.'}
                </p>
              </Notice>
            ) : (
              <Notice tone="danger" title={ar ? 'شهادة مسحوبة — لم تعد سارية' : 'Revoked — no longer valid'}>
                <p>
                  {ar
                    ? 'صدرت هذه الشهادة ثم سحبتها الجهة المصدِّرة، فلم تعد سارية.'
                    : 'This certificate was issued and then revoked by the issuer, so it is no longer valid.'}
                  {check.revokedAt ? (ar ? ` تاريخ السحب: ${formatDate(check.revokedAt, locale)}.` : ` Revoked on ${formatDate(check.revokedAt, locale)}.`) : ''}
                </p>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'سبب السحب لا يُنشر هنا: هو بين الجهة المصدِّرة وحامل الشهادة. للاستفسار تواصل مع الجهة مباشرة.'
                    : 'The reason is not published here: it is between the issuer and the holder. Contact the issuer directly to ask.'}
                </p>
              </Notice>
            )}

            <Card title={ar ? 'ما تثبته الشهادة' : 'What the certificate attests'}>
              <dl className="tmk-definitions">
                <div><dt>{ar ? 'الاسم' : 'Holder'}</dt><dd>{check.holderName}</dd></div>
                <div><dt>{ar ? 'البرنامج' : 'Programme'}</dt><dd>{check.programTitle}</dd></div>
                <div><dt>{ar ? 'الجهة المصدِّرة' : 'Issued by'}</dt><dd>{check.issuerName}</dd></div>
                <div><dt>{ar ? 'تاريخ الإكمال' : 'Completed'}</dt><dd>{formatDate(check.completedAt, locale)}</dd></div>
                <div><dt>{ar ? 'تاريخ الإصدار' : 'Issued'}</dt><dd>{formatDate(check.issuedAt, locale)}</dd></div>
                <div>
                  <dt>{ar ? 'الحالة' : 'Status'}</dt>
                  <dd>
                    <StatusBadge tone={check.valid ? 'success' : 'danger'}>
                      {check.valid ? (ar ? 'سارية' : 'Valid') : (ar ? 'مسحوبة' : 'Revoked')}
                    </StatusBadge>
                  </dd>
                </div>
                <div><dt>{ar ? 'المرجع' : 'Reference'}</dt><dd><Ltr>{check.publicId}</Ltr></dd></div>
              </dl>
            </Card>

            {/* Named, so a reader knows the absence is a rule rather than a gap in the record. */}
            <Card title={ar ? 'ما لا يظهر هنا أبدًا' : 'What this check never shows'}>
              <p className="tmk-field__hint">
                {ar
                  ? 'لا رقم هوية ولا بيانات اتصال ولا سجل حضور ولا درجات تقييم ولا سبب سحب. الشهادة تثبت إكمال برنامج، ولا تفتح ملف صاحبها.'
                  : 'No national identifier, no contact details, no attendance record, no assessment scores and no revocation reason. A certificate attests that a programme was completed; it does not open the holder’s file.'}
              </p>
              <p className="tmk-field__hint">
                <Ltr>{check.withheld.join(', ')}</Ltr>
              </p>
            </Card>

            <nav className="tmk-inline-links">
              <a href={localePath(locale, '/opportunities')}>{ar ? 'التدريب والعمل' : 'Training and work'}</a>
              <a href={localePath(locale, '/about')}>{ar ? 'عن تمكين' : 'About Tamkeen'}</a>
            </nav>
          </>
        );
      })()}
    </AppShell>
  );
}
