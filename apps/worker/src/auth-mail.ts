import type { RuntimeConfig } from '@tamkeen/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { DatabaseClient } from '@tamkeen/database';

export interface AuthMailMessage { to: string; subject: string; text: string; html: string }
/** Sends one message. `idempotencyKey` must be stable per outbox row so a retry never mails twice. */
export type AuthMailSender = (message: AuthMailMessage, idempotencyKey: string) => Promise<void>;

// Mail older than this is not worth sending: invitation links expire, and codes last 10 minutes.
const MAX_AGE_MS = 60 * 60_000;
const CODE_MAX_AGE_MS = 10 * 60_000;
const backoffMs = (attempt: number) => Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));

const CODE_TEMPLATES: Record<string, { subject: string; intro: string }> = {
  'verify-code': { subject: 'رمز تأكيد بريدك في تمكين', intro: 'أدخل هذا الرمز في صفحة التحقق لتأكيد بريدك الإلكتروني:' },
  'reset-code': { subject: 'رمز إعادة تعيين كلمة المرور في تمكين', intro: 'أدخل هذا الرمز في صفحة استعادة الوصول لتعيين كلمة مرور جديدة. إن لم تطلب ذلك فتجاهل هذه الرسالة.' }
};

const TEMPLATES: Record<string, { subject: string; intro: string; action: string }> = {
  invitation: { subject: 'دعوة للانضمام إلى جهة في تمكين', intro: 'دُعيت للانضمام إلى فريق جهة في تمكين. سجّل الدخول بهذا البريد لمراجعة الدعوة.', action: 'مراجعة الدعوة' },
  'platform-invitation': { subject: 'دعوة للانضمام إلى فريق تشغيل تمكين', intro: 'دُعيت للانضمام إلى فريق تشغيل المنصة. يتطلب القبول تفعيل التحقق بخطوتين.', action: 'مراجعة الدعوة' },
  'ownership-transfer': { subject: 'طلب نقل ملكية جهة إليك في تمكين', intro: 'طلب مالك جهة نقل ملكيتها إليك. يتطلب القبول تفعيل التحقق بخطوتين.', action: 'مراجعة الطلب' }
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const FOOTER = 'هذه رسالة من نسخة تمكين المحلية التجريبية. لا تستخدم فيها بيانات حقيقية.';

export function buildAuthMail(row: { recipient: string; purpose: string; url: string; code?: string | null }): AuthMailMessage {
  const codeTemplate = CODE_TEMPLATES[row.purpose];
  if (codeTemplate) {
    if (!row.code || !/^[0-9]{6}$/.test(row.code)) throw new Error('missing_mail_code');
    const expiry = 'ينتهي الرمز بعد 10 دقائق ولا يُستخدم إلا مرة واحدة. لا تشاركه مع أحد.';
    return {
      to: row.recipient,
      subject: codeTemplate.subject,
      text: `${codeTemplate.intro}\n\n${row.code}\n\n${expiry}\n\n${FOOTER}`,
      html: `<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.7;color:#1f2933">`
        + `<p>${escapeHtml(codeTemplate.intro)}</p>`
        + `<p dir="ltr" style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#086F68;margin:16px 0">${row.code}</p>`
        + `<p style="font-size:13px;color:#52606d">${escapeHtml(expiry)}</p>`
        + `<p style="font-size:12px;color:#7b8794">${escapeHtml(FOOTER)}</p></body></html>`
    };
  }
  const template = TEMPLATES[row.purpose];
  if (!template) throw new Error(`unknown_mail_purpose`);
  if (!/^https?:\/\//.test(row.url)) throw new Error('unsafe_mail_url');
  const url = escapeHtml(row.url);
  return {
    to: row.recipient,
    subject: template.subject,
    text: `${template.intro}\n\n${template.action}: ${row.url}\n\n${FOOTER}`,
    html: `<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.7;color:#1f2933">`
      + `<p>${escapeHtml(template.intro)}</p>`
      + `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#086F68;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(template.action)}</a></p>`
      + `<p style="font-size:13px;color:#52606d">إن لم يعمل الزر فانسخ هذا الرابط:<br><span dir="ltr">${url}</span></p>`
      + `<p style="font-size:12px;color:#7b8794">${escapeHtml(FOOTER)}</p></body></html>`
  };
}

export function resendSender(resend: NonNullable<RuntimeConfig['resend']>, fetchImpl: typeof fetch = fetch): AuthMailSender {
  return async (message, idempotencyKey) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resend.apiKey}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ from: resend.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      // Keep only the HTTP status: the body can echo the recipient address.
      const error = new Error(`resend_http_${response.status}`);
      error.name = `ResendHttp${response.status}`;
      throw error;
    }
  };
}

export function smtpSender(smtp: NonNullable<RuntimeConfig['smtp']>, transport: Pick<Transporter, 'sendMail'> = createTransport({
  host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: true,
  auth: { user: smtp.user, pass: smtp.password },
  connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000
})): AuthMailSender {
  return async (message, idempotencyKey) => {
    try {
      // SMTP has no idempotency key; a stable Message-ID lets the receiving server spot a duplicate.
      await transport.sendMail({ from: smtp.from, to: message.to, subject: message.subject, text: message.text, html: message.html, messageId: `<${idempotencyKey}@tamkeen.local>` });
    } catch (cause) {
      // Keep only the SMTP code: server responses can echo the recipient or the account name.
      const code = cause && typeof cause === 'object' && 'responseCode' in cause ? String(cause.responseCode) : cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'unknown';
      const error = new Error(`smtp_${code}`);
      error.name = `Smtp${code.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 80);
      throw error;
    }
  };
}

/** The sender for the configured mode, or undefined when mail must stay on this machine. */
export function configuredSender(config: RuntimeConfig): AuthMailSender | undefined {
  if (config.resend) return resendSender(config.resend);
  if (config.smtp) return smtpSender(config.smtp);
  return undefined;
}

/**
 * Relays pending auth mail. With no sender (local-outbox) pending rows are marked
 * local_only, so they stay readable through `pnpm mail:local` and are never sent later.
 */
export async function processAuthMailBatch(db: DatabaseClient, send: AuthMailSender | undefined, now = new Date(), limit = 25) {
  if (!send) {
    const { count } = await db.localAuthMail.updateMany({ where: { state: 'pending' }, data: { state: 'local_only' } });
    return count;
  }
  await db.localAuthMail.updateMany({ where: { state: { in: ['pending', 'failed'] }, createdAt: { lt: new Date(now.getTime() - MAX_AGE_MS) } }, data: { state: 'expired', code: null } });
  await db.localAuthMail.updateMany({ where: { state: { in: ['pending', 'failed'] }, code: { not: null }, createdAt: { lt: new Date(now.getTime() - CODE_MAX_AGE_MS) } }, data: { state: 'expired', code: null } });
  let processed = 0;
  while (processed < limit) {
    const row = await db.localAuthMail.findFirst({ where: { state: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' } });
    if (!row) break;
    const claimed = await db.localAuthMail.updateMany({ where: { id: row.id, state: row.state, attempts: row.attempts }, data: { state: 'processing', attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      await send(buildAuthMail(row), `tamkeen-auth-mail-${row.id}`);
      await db.localAuthMail.update({ where: { id: row.id }, data: { state: 'delivered', deliveredAt: new Date(), lastErrorCode: '', code: null } });
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.localAuthMail.update({ where: { id: row.id }, data: { ...(attempts >= 5 ? { code: null } : {}), state: attempts >= 5 ? 'dead_letter' : 'failed', lastErrorCode: error instanceof Error ? error.name.slice(0, 80) : 'delivery_error', nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) } });
    }
    processed += 1;
  }
  return processed;
}
