import { notFound } from 'next/navigation';
import { BadgeCheck, CircleCheck, Eye, HandHeart, Handshake, Rocket, Scale, ShieldCheck, Sprout, Target } from 'lucide-react';
import { AppShell, CountUp, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { DownloadButton } from '../download-button';
import { readPublic, type PublicOrganizationSummary, type PublicProjectCard } from '../../../lib/server-api';
import { readSiteContent, type SiteItem } from '../../../lib/site-content';
import { PageHero, forwardIcon } from '../marketing';

/** PUB-13. The story, mission and principles, with the banner and photos the admin controls. */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'About us — Tamkeen', description: 'Who we are, why we built Tamkeen, and the principles behind every contribution.' }
    : { title: 'من نحن — تمكين', description: 'من نحن، ولماذا بنينا تمكين، والمبادئ التي تحكم كل مساهمة.' };
}

const copy = {
  ar: {
    kicker: 'من نحن',
    missionTitle: 'رسالتنا',
    mission: 'أن يصل كل مبلغ إلى حيث وُعد، وأن يرى صاحبه ما تحقق به، بلا وسطاء غامضين ولا أرقام بلا مصدر.',
    visionTitle: 'رؤيتنا',
    vision: 'مجتمعات تموّل تنميتها بنفسها: متبرع يثق، ومستثمر يعرف، وشاب يجد عملًا حقيقيًا قرب بيته.',
    storyKicker: 'قصتنا',
    storyTitle: 'بدأنا بسؤال بسيط: أين ذهب المال؟',
    storyBody: [
      'كثيرون يرغبون في المساعدة أو الاستثمار في مجتمعهم، لكنهم يتوقفون لأنهم لا يعرفون من ينفّذ ولا ما الذي تحقق فعلًا.',
      'بنينا تمكين لتجيب عن هذا السؤال في كل مرة: جهة موثقة، ميزانية معلنة، صرف على مراحل بدليل، وتقرير إغلاق لا يتغير بعد نشره.'
    ],
    tracksKicker: 'ما نقدمه',
    tracksTitle: 'ثلاثة مسارات، هدف واحد',
    valuesKicker: 'قيمنا',
    valuesTitle: 'المبادئ التي لا نتنازل عنها',
    values: [
      { icon: Eye, title: 'الشفافية', body: 'كل رقم معروض له قيد مالي خلفه، وكل مشروع له ميزانية ومراحل منشورة.' },
      { icon: ShieldCheck, title: 'التوثيق', body: 'لا تجمع جهة أي مبلغ قبل مراجعة مستقلة لوثائقها.' },
      { icon: Scale, title: 'العدالة', body: 'فصل الصلاحيات: من يطلب الصرف لا يعتمده، ومن يراجع لا يملك الجهة.' },
      { icon: Handshake, title: 'الشراكة', body: 'نعمل مع الجهات المحلية لا بدلًا عنها، ونقيس النجاح بأثرها.' }
    ],
    verifyKicker: 'ماذا تعني شارة «موثقة»؟',
    verifyTitle: 'ثقة مبنية على فحص، لا على وعد',
    verifyPoints: [
      { title: 'مراجعة مستقلة', body: 'فحص مراجع مستقل مستندات تسجيل الجهة في تاريخ محدد.' },
      { title: 'صلاحية محدودة', body: 'التوثيق المنتهي لا يُحتسب، وتتوقف العمليات التي تتطلبه حتى يُجدَّد.' },
      { title: 'لا ضمان مبالغ فيه', body: 'التوثيق يثبت هوية الجهة، ولا يضمن نجاح كل مشروع؛ لذلك نتابع التنفيذ بالدليل.' }
    ],
    numbers: { projects: 'مشروع منشور', organizations: 'جهة على المنصة', verified: 'جهة موثقة', tracks: 'مسارات للأثر' },
    ctaTitle: 'انضم إلينا في بناء الثقة',
    ctaBody: 'سواء كنت متبرعًا أو مستثمرًا أو جهة تنفّذ أو باحثًا عن فرصة، مكانك هنا.',
    ctaPrimary: 'أنشئ حسابك',
    ctaSecondary: 'تواصل معنا',
    note: 'المدفوعات على المنصة تعمل حاليًا بنظام تجريبي ولا تُحوَّل أموال حقيقية حتى ربط مزود الدفع.',
    terms: 'الشروط'
  },
  en: {
    kicker: 'About us',
    missionTitle: 'Our mission',
    mission: 'That every amount reaches where it was promised, and its owner sees what it achieved — no opaque middlemen, no figures without a source.',
    visionTitle: 'Our vision',
    vision: 'Communities that fund their own development: a donor who trusts, an investor who knows, and a young person who finds real work close to home.',
    storyKicker: 'Our story',
    storyTitle: 'We started with a simple question: where did the money go?',
    storyBody: [
      'Many people want to help or invest in their community, but stop because they cannot tell who delivers or what was actually achieved.',
      'We built Tamkeen to answer that question every time: a verified organisation, a published budget, staged payouts backed by evidence, and a closing report that never changes once published.'
    ],
    tracksKicker: 'What we offer',
    tracksTitle: 'Three tracks, one goal',
    valuesKicker: 'Our values',
    valuesTitle: 'The principles we do not compromise on',
    values: [
      { icon: Eye, title: 'Transparency', body: 'Every figure shown has a ledger entry behind it, and every project a published budget and stages.' },
      { icon: ShieldCheck, title: 'Verification', body: 'No organisation raises anything before an independent review of its documents.' },
      { icon: Scale, title: 'Fairness', body: 'Segregated duties: whoever requests a payout cannot approve it.' },
      { icon: Handshake, title: 'Partnership', body: 'We work with local organisations, not instead of them, and measure success by their impact.' }
    ],
    verifyKicker: 'What does “verified” mean?',
    verifyTitle: 'Trust built on checks, not promises',
    verifyPoints: [
      { title: 'Independent review', body: 'An independent reviewer checked the organisation’s registration documents on a given date.' },
      { title: 'Limited validity', body: 'An expired verification does not count, and operations that need it stop until it is renewed.' },
      { title: 'No overpromising', body: 'Verification proves who the organisation is, not that every project succeeds — so we follow delivery with evidence.' }
    ],
    numbers: { projects: 'published projects', organizations: 'organisations', verified: 'verified organisations', tracks: 'tracks to impact' },
    ctaTitle: 'Join us in building trust',
    ctaBody: 'Whether you give, invest, deliver projects or look for an opportunity, there is a place for you here.',
    ctaPrimary: 'Create your account',
    ctaSecondary: 'Contact us',
    note: 'Payments on the platform currently run in a test mode; no real money moves until a payment provider is connected.',
    terms: 'Terms'
  }
} as const;

const TRACKS = [
  { key: 'charity', icon: HandHeart },
  { key: 'invest', icon: Rocket },
  { key: 'work', icon: Sprout }
] as const;

export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const text = copy[locale];
  const L = (path: string) => localePath(locale, path);
  const Forward = forwardIcon(locale);
  const pick = (value: { ar: string; en: string }) => value[locale] || value.ar;

  const [site, projects, organizations] = await Promise.all([
    readSiteContent(),
    readPublic<PublicProjectCard[]>('/projects'),
    readPublic<PublicOrganizationSummary[]>('/organizations')
  ]);
  const about = site.about!;
  const orgList = organizations.ok ? organizations.data : [];
  const tracks = TRACKS.map(track => ({ ...track, item: site.tracks[track.key] })).filter((entry): entry is typeof entry & { item: SiteItem } => Boolean(entry.item));

  return (
    <AppShell locale={locale} path="/about"
      lead={<PageHero image={about.imageUrl} kicker={text.kicker} title={pick(about.title)} lead={pick(about.body)} />}>

      <section className="tmk-section tmk-features" style={{ marginBlockStart: 0 }} aria-label={text.missionTitle}>
        {[{ icon: Target, title: text.missionTitle, body: text.mission }, { icon: Eye, title: text.visionTitle, body: text.vision }].map((entry, index) => {
          const Icon = entry.icon;
          return (
            <article className="tmk-feature tmk-reveal" key={entry.title} style={{ ['--reveal-delay' as string]: index }}>
              <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
              <h2 style={{ margin: 0, fontSize: 24 }}>{entry.title}</h2>
              <p style={{ fontSize: 17 }}>{entry.body}</p>
            </article>
          );
        })}
      </section>

      <section className="tmk-section tmk-split" aria-labelledby="about-story">
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 16 }}>
            <p className="tmk-kicker">{text.storyKicker}</p>
            <h2 id="about-story">{text.storyTitle}</h2>
          </div>
          {text.storyBody.map(paragraph => <p key={paragraph} style={{ fontSize: 17, color: 'var(--tmk-color-muted)' }}>{paragraph}</p>)}
        </div>
        <div className="tmk-split__media tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <img src="/media/defaults/about-city.jpg" alt="" loading="lazy" />
          {orgList.length ? <div className="tmk-split__badge"><strong><CountUp value={orgList.length} /></strong><span>{text.numbers.organizations}</span></div> : null}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="about-tracks">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{text.tracksKicker}</p>
          <h2 id="about-tracks">{text.tracksTitle}</h2>
        </div>
        <div className="tmk-tracks">
          {tracks.map(({ key, icon: Icon, item }, index) => (
            <a className="tmk-track tmk-reveal" key={key} href={L(item.cta?.href ?? '/explore')} style={{ ['--reveal-delay' as string]: index, minBlockSize: 380 }}>
              <img src={item.imageUrl} alt="" loading="lazy" />
              <span className="tmk-track__icon"><Icon aria-hidden="true" size={28} /></span>
              <h3>{pick(item.title)}</h3>
              <p>{pick(item.body)}</p>
              <span className="tmk-track__cta">{item.cta ? pick(item.cta.label) : ''}<Forward aria-hidden="true" size={18} /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="tmk-section" aria-labelledby="about-values">
        <div className="tmk-section__head tmk-section__head--center tmk-reveal">
          <p className="tmk-kicker">{text.valuesKicker}</p>
          <h2 id="about-values">{text.valuesTitle}</h2>
        </div>
        <div className="tmk-features">
          {text.values.map((value, index) => {
            const Icon = value.icon;
            return (
              <article className="tmk-feature tmk-reveal" key={value.title} style={{ ['--reveal-delay' as string]: index }}>
                <span className="tmk-feature__icon"><Icon aria-hidden="true" size={26} /></span>
                <h3>{value.title}</h3>
                <p>{value.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tmk-impact tmk-reveal" aria-label={text.kicker}>
        <div className="tmk-impact__inner">
          {[
            { value: projects.ok ? projects.data.length : 0, label: text.numbers.projects },
            { value: orgList.length, label: text.numbers.organizations },
            { value: orgList.filter(org => org.verified).length, label: text.numbers.verified },
            { value: 3, label: text.numbers.tracks }
          ].map(entry => (
            <div className="tmk-impact__item" key={entry.label}><strong><CountUp value={entry.value} /></strong><span>{entry.label}</span></div>
          ))}
        </div>
      </section>

      <section className="tmk-section tmk-split" aria-labelledby="about-verify">
        <div className="tmk-reveal">
          <div className="tmk-section__head" style={{ marginBlockEnd: 0 }}>
            <p className="tmk-kicker">{text.verifyKicker}</p>
            <h2 id="about-verify">{text.verifyTitle}</h2>
          </div>
          <ul className="tmk-checks">
            {text.verifyPoints.map(point => <li key={point.title}><CircleCheck aria-hidden="true" /><span><strong>{point.title}</strong><span>{point.body}</span></span></li>)}
          </ul>
        </div>
        <div className="tmk-split__media tmk-reveal" style={{ ['--reveal-delay' as string]: 1 }}>
          <img src="/media/defaults/cover-charity-2.jpg" alt="" loading="lazy" />
          <div className="tmk-split__badge"><strong><BadgeCheck aria-hidden="true" size={30} /></strong><span>{text.verifyKicker}</span></div>
        </div>
      </section>

      <section className="tmk-cta tmk-reveal" aria-labelledby="about-cta">
        <img src={site.contact?.imageUrl ?? '/media/defaults/contact-team.jpg'} alt="" loading="lazy" />
        <h2 id="about-cta">{text.ctaTitle}</h2>
        <p>{text.ctaBody}</p>
        <div className="tmk-carousel__actions">
          <a className="tmk-button tmk-button--accent tmk-button--large" href={L('/register')}>{text.ctaPrimary}<Forward aria-hidden="true" size={20} /></a>
          <a className="tmk-button tmk-button--glass tmk-button--large" href={L('/contact-us')}>{text.ctaSecondary}</a>
        </div>
      </section>

      <p className="tmk-field__hint" style={{ textAlign: 'center', marginBlockStart: 32 }}>
        {text.note} <a href={L('/policies/terms')}>{text.terms}</a>
      </p>
      <p style={{ textAlign: 'center' }}>
        <DownloadButton endpoint={`/policies/terms/versions/${CURRENT_TERMS_VERSION}`} label={locale === 'ar' ? 'نزّل نسخة الشروط المؤرخة' : 'Download dated terms'} />
      </p>
    </AppShell>
  );
}
