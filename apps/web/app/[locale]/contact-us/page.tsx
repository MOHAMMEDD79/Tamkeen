import { notFound } from 'next/navigation';
import { Building2, Clock, Handshake, LifeBuoy, Link2, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { AppShell, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readSiteContent, section } from '../../../lib/site-content';
import { PageHero } from '../marketing';
import { ContactForm } from './contact-form';

/**
 * Public contact page. Messages land in the platform admin's inbox; no account is needed. Every
 * line of copy, the photo and the contact details are set by the admin.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Contact us — Tamkeen', description: 'Questions, partnerships or a project idea: write to the Tamkeen team.' }
    : { title: 'تواصل معنا — تمكين', description: 'سؤال أو شراكة أو فكرة مشروع: اكتب إلى فريق تمكين.' };
}

const SOCIAL: Array<{ key: string; ar: string; en: string }> = [
  { key: 'social.facebook', ar: 'فيسبوك', en: 'Facebook' },
  { key: 'social.instagram', ar: 'إنستغرام', en: 'Instagram' },
  { key: 'social.x', ar: 'إكس', en: 'X' },
  { key: 'social.linkedin', ar: 'لينكدإن', en: 'LinkedIn' },
  { key: 'social.youtube', ar: 'يوتيوب', en: 'YouTube' }
];

export default async function ContactUs({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const site = await readSiteContent();
  const contact = site.contact!;
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;
  const S = (slot: string) => section(site, slot);
  const form = S('contact.form');
  const settings = site.settings;
  const setting = (key: string) => settings[`${key}.${locale}`] || settings[`${key}.ar`] || '';
  const digits = (value: string) => value.replace(/[^0-9+]/g, '');

  const details = [
    settings['contact.email'] ? { icon: Mail, label: ar ? 'البريد' : 'Email', value: settings['contact.email'], href: `mailto:${settings['contact.email']}`, ltr: true } : null,
    settings['contact.phone'] ? { icon: Phone, label: ar ? 'الهاتف' : 'Phone', value: settings['contact.phone'], href: `tel:${digits(settings['contact.phone'])}`, ltr: true } : null,
    settings['contact.whatsapp'] ? { icon: MessageCircle, label: ar ? 'واتساب' : 'WhatsApp', value: settings['contact.whatsapp'], href: `https://wa.me/${digits(settings['contact.whatsapp']).replace('+', '')}`, ltr: true } : null,
    setting('contact.address') ? { icon: MapPin, label: ar ? 'العنوان' : 'Address', value: setting('contact.address'), href: null, ltr: false } : null,
    setting('contact.hours') ? { icon: Clock, label: ar ? 'ساعات العمل' : 'Working hours', value: setting('contact.hours'), href: null, ltr: false } : null
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const socials = SOCIAL.filter(entry => settings[entry.key]);

  return (
    <AppShell locale={locale} path="/contact-us"
      lead={<PageHero image={contact.imageUrl} kicker={(contact.kicker && pick(contact.kicker)) || (ar ? 'تواصل معنا' : 'Contact us')} title={pick(contact.title)} lead={pick(contact.body)} />}>

      {details.length || socials.length ? (
        <section className="tmk-contact-details tmk-reveal" aria-label={ar ? 'بيانات التواصل' : 'Contact details'}>
          {details.map(entry => {
            const Icon = entry.icon;
            const value = <span dir={entry.ltr ? 'ltr' : undefined}>{entry.value}</span>;
            return (
              <div className="tmk-contact-details__item" key={entry.label}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={22} /></span>
                <span><small>{entry.label}</small>{entry.href ? <a href={entry.href} rel={entry.href.startsWith('https') ? 'noreferrer' : undefined} target={entry.href.startsWith('https') ? '_blank' : undefined}>{value}</a> : <strong>{value}</strong>}</span>
              </div>
            );
          })}
          {socials.length ? (
            <div className="tmk-contact-details__social">
              {socials.map(entry => <a key={entry.key} className="tmk-pill" href={settings[entry.key]} target="_blank" rel="noreferrer"><Link2 aria-hidden="true" size={16} />{ar ? entry.ar : entry.en}</a>)}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="tmk-contact" aria-labelledby="contact-form-title">
        <div className="tmk-contact__cards">
          {[1, 2, 3].map(number => S(`contact.card.${number}`)).map((card, index) => {
            const Icon = [LifeBuoy, Building2, Handshake][index] ?? LifeBuoy;
            const body = <><span className="tmk-feature__icon"><Icon aria-hidden="true" size={24} /></span><span><strong>{pick(card.title)}</strong><span>{pick(card.body)}</span></span></>;
            return card.cta
              ? <a className="tmk-contact__card tmk-reveal" key={index} href={localePath(locale, card.cta.href)} style={{ ['--reveal-delay' as string]: index }}>{body}</a>
              : <div className="tmk-contact__card tmk-reveal" key={index} style={{ ['--reveal-delay' as string]: index }}>{body}</div>;
          })}
        </div>
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 24 }}>
            <h2 id="contact-form-title" style={{ fontSize: 30 }}>{pick(form.title)}</h2>
            <p>{pick(form.body)}</p>
          </div>
          <ContactForm locale={locale} />
        </div>
      </section>
    </AppShell>
  );
}
