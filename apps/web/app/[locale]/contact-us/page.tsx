import { notFound } from 'next/navigation';
import { Building2, Handshake, LifeBuoy } from 'lucide-react';
import { AppShell, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readSiteContent } from '../../../lib/site-content';
import { PageHero } from '../marketing';
import { ContactForm } from './contact-form';

/** Public contact page. Messages land in the platform admin's inbox; no account is needed. */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Contact us — Tamkeen', description: 'Questions, partnerships or a project idea: write to the Tamkeen team.' }
    : { title: 'تواصل معنا — تمكين', description: 'سؤال أو شراكة أو فكرة مشروع: اكتب إلى فريق تمكين.' };
}

const copy = {
  ar: {
    kicker: 'تواصل معنا',
    formTitle: 'أرسل لنا رسالة',
    formLead: 'املأ النموذج وسيصل مباشرة إلى فريق تمكين.',
    cards: [
      { icon: LifeBuoy, title: 'دعم أصحاب الحسابات', body: 'مشكلة في مساهمة أو طلب؟ افتح تذكرة دعم خاصة من حسابك.', href: '/contact' },
      { icon: Building2, title: 'سجّل جهتك', body: 'جمعية أو شركة أو مؤسسة؟ أنشئ حساب جهتك وابدأ مسار التوثيق.', href: '/app/organizations/new' },
      { icon: Handshake, title: 'الشراكات', body: 'للشراكات والتمويل المؤسسي اكتب لنا في النموذج واختر موضوعًا واضحًا.', href: null }
    ]
  },
  en: {
    kicker: 'Contact us',
    formTitle: 'Send us a message',
    formLead: 'Fill in the form and it goes straight to the Tamkeen team.',
    cards: [
      { icon: LifeBuoy, title: 'Support for account holders', body: 'A problem with a contribution or request? Open a private support ticket from your account.', href: '/contact' },
      { icon: Building2, title: 'Register your organisation', body: 'A charity, company or foundation? Create your organisation and start verification.', href: '/app/organizations/new' },
      { icon: Handshake, title: 'Partnerships', body: 'For partnerships and institutional funding, write to us using the form with a clear subject.', href: null }
    ]
  }
} as const;

export default async function ContactUs({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const text = copy[locale];
  const site = await readSiteContent();
  const contact = site.contact!;
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;

  return (
    <AppShell locale={locale} path="/contact-us"
      lead={<PageHero image={contact.imageUrl} kicker={text.kicker} title={pick(contact.title)} lead={pick(contact.body)} />}>
      <section className="tmk-contact" aria-labelledby="contact-form-title">
        <div className="tmk-contact__cards">
          {text.cards.map((card, index) => {
            const Icon = card.icon;
            const body = <><span className="tmk-feature__icon"><Icon aria-hidden="true" size={24} /></span><span><strong>{card.title}</strong><span>{card.body}</span></span></>;
            return card.href
              ? <a className="tmk-contact__card tmk-reveal" key={card.title} href={localePath(locale, card.href)} style={{ ['--reveal-delay' as string]: index }}>{body}</a>
              : <div className="tmk-contact__card tmk-reveal" key={card.title} style={{ ['--reveal-delay' as string]: index }}>{body}</div>;
          })}
        </div>
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 24 }}>
            <h2 id="contact-form-title" style={{ fontSize: 30 }}>{text.formTitle}</h2>
            <p>{text.formLead}</p>
          </div>
          <ContactForm locale={locale} />
        </div>
      </section>
    </AppShell>
  );
}
