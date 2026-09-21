'use client';

import { useState, type FormEvent } from 'react';
import { CircleCheck, Send } from 'lucide-react';

const text = {
  ar: {
    name: 'الاسم', email: 'البريد الإلكتروني', subject: 'الموضوع', body: 'رسالتك', send: 'أرسل الرسالة', sending: 'جارٍ الإرسال…',
    doneTitle: 'وصلت رسالتك، شكرًا لك', doneBody: 'سيقرأها فريقنا ويرد عليك على بريدك في أقرب وقت.', again: 'أرسل رسالة أخرى',
    tooMany: 'أرسلت رسائل كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.', invalid: 'راجع الحقول: الاسم والموضوع مطلوبان، والرسالة عشرة أحرف على الأقل.', failed: 'تعذر إرسال الرسالة الآن. حاول مرة أخرى بعد قليل.'
  },
  en: {
    name: 'Name', email: 'Email', subject: 'Subject', body: 'Your message', send: 'Send message', sending: 'Sending…',
    doneTitle: 'Your message arrived — thank you', doneBody: 'Our team will read it and reply to your email soon.', again: 'Send another message',
    tooMany: 'Too many messages in a short time. Please wait a little and try again.', invalid: 'Check the fields: name and subject are required, and the message needs at least ten characters.', failed: 'The message could not be sent right now. Please try again shortly.'
  }
} as const;

/** PUB contact form. Works without an account; the server rate-limits it per visitor. */
export function ContactForm({ locale }: { locale: 'ar' | 'en' }) {
  const t = text[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/contact-messages', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.get('name'), email: data.get('email'), subject: data.get('subject'), body: data.get('body'), locale })
      });
      if (response.status === 429) throw new Error(t.tooMany);
      if (response.status === 400 || response.status === 422) throw new Error(t.invalid);
      if (!response.ok) throw new Error(t.failed);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="tmk-card" role="status" style={{ textAlign: 'center', padding: 48 }}>
        <CircleCheck aria-hidden="true" size={56} style={{ color: 'var(--tmk-color-success)' }} />
        <h2 style={{ marginBlock: '16px 8px' }}>{t.doneTitle}</h2>
        <p style={{ color: 'var(--tmk-color-muted)' }}>{t.doneBody}</p>
        <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setSent(false)}>{t.again}</button>
      </div>
    );
  }

  return (
    <form className="tmk-card" onSubmit={submit} noValidate={false}>
      {error ? <div className="tmk-notice tmk-notice--danger tmk-field--wide" role="alert"><i className="tmk-notice__icon" aria-hidden="true">✕</i><div className="tmk-notice__body">{error}</div></div> : null}
      <div className="tmk-field"><label className="tmk-field__label" htmlFor="contact-name">{t.name}</label><input className="tmk-field__control" id="contact-name" name="name" required maxLength={120} autoComplete="name" /></div>
      <div className="tmk-field"><label className="tmk-field__label" htmlFor="contact-email">{t.email}</label><input className="tmk-field__control" id="contact-email" name="email" type="email" required maxLength={254} autoComplete="email" dir="ltr" /></div>
      <div className="tmk-field tmk-field--wide"><label className="tmk-field__label" htmlFor="contact-subject">{t.subject}</label><input className="tmk-field__control" id="contact-subject" name="subject" required maxLength={200} /></div>
      <div className="tmk-field tmk-field--wide"><label className="tmk-field__label" htmlFor="contact-body">{t.body}</label><textarea className="tmk-field__control" id="contact-body" name="body" required minLength={10} maxLength={4000} rows={6} /></div>
      <div className="tmk-field--wide">
        <button type="submit" className="tmk-button tmk-button--accent tmk-button--large" disabled={busy} aria-busy={busy || undefined}>{busy ? t.sending : t.send}<Send aria-hidden="true" size={18} /></button>
      </div>
    </form>
  );
}
