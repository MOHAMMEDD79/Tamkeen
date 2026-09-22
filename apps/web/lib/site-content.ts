import 'server-only';
import { readPublic, type PublicProjectCard, type PublicProjectDetail } from './server-api';
import { resolveSection, type ResolvedSection, type SavedSection } from './site-sections';

/**
 * The marketing content the platform admin controls: homepage banners, the three track panels, and
 * the About and Contact banners. Read from the API on every request so an admin edit shows at once.
 *
 * The defaults below mirror what the migration seeds, so a page still renders fully if the API is
 * down or not yet migrated — a marketing page with an empty hero is worse than one with defaults.
 */

export interface SiteText { ar: string; en: string }
export interface SiteItem {
  id: string;
  slot: string;
  sortOrder: number;
  kicker?: SiteText;
  title: SiteText;
  body: SiteText;
  cta: { label: SiteText; href: string } | null;
  imageUrl: string;
}
export interface SiteContent {
  hero: SiteItem[];
  tracks: { charity: SiteItem | null; invest: SiteItem | null; work: SiteItem | null };
  about: SiteItem | null;
  contact: SiteItem | null;
  /** Page sections the admin saved; see site-sections.ts for the rest. */
  sections: Record<string, SavedSection>;
  /** Contact details and social links that are set. */
  settings: Record<string, string>;
}

const item = (id: string, slot: string, sortOrder: number, imageUrl: string, title: SiteText, body: SiteText, cta: SiteItem['cta']): SiteItem => ({ id, slot, sortOrder, imageUrl, title, body, cta });

export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero: [
    item('default-hero-0', 'hero', 0, '/media/defaults/hero-charity.jpg',
      { ar: 'عطاؤك يصل إلى من يحتاجه، ونريك الدليل', en: 'Your giving reaches those who need it, and we show you the proof' },
      { ar: 'ادعم مشاريع خيرية لجهات موثقة، وتابع كل مبلغ حتى صورة التنفيذ وتقرير الإغلاق.', en: 'Back charitable projects by verified organisations and follow every amount to delivery and the closing report.' },
      { label: { ar: 'تصفّح المشاريع الخيرية', en: 'Browse charity projects' }, href: '/explore' }),
    item('default-hero-1', 'hero', 1, '/media/defaults/hero-education.jpg',
      { ar: 'نبني المستقبل، فصلًا دراسيًا بعد فصل', en: 'Building the future, one classroom at a time' },
      { ar: 'مدارس تُرمَّم ومراكز تُجهَّز بتمويل مجتمعي شفاف، لكل مشروع ميزانية ومراحل معلنة.', en: 'Schools restored and centres equipped through transparent community funding, each with a published budget and stages.' },
      { label: { ar: 'ساهم في التعليم', en: 'Support education' }, href: '/explore' }),
    item('default-hero-2', 'hero', 2, '/media/defaults/hero-agriculture.jpg',
      { ar: 'تدريب يقود إلى عمل حقيقي', en: 'Training that leads to real work' },
      { ar: 'برامج تدريب ممولة تنتهي بوظيفة تُحتسب من يوم البدء الفعلي، لا من عدد المسجلين.', en: 'Funded training programmes that end in a job counted from the actual start date, not from sign-ups.' },
      { label: { ar: 'اكتشف فرص التشغيل', en: 'Explore jobs & training' }, href: '/opportunities' }),
    item('default-hero-3', 'hero', 3, '/media/defaults/hero-business.jpg',
      { ar: 'استثمر في شركات تنمو بمجتمعها', en: 'Invest in companies that grow with their community' },
      { ar: 'عروض استثمار بإفصاح واضح وأداة محددة، ولا تُسجَّل ملكية قبل تخصيص معتمد.', en: 'Investment offerings with clear disclosure and a defined instrument; no ownership before an approved allocation.' },
      { label: { ar: 'ابدأ الاستثمار', en: 'Start investing' }, href: '/invest' })
  ],
  tracks: {
    charity: item('default-track-charity', 'track.charity', 0, '/media/defaults/track-charity.jpg',
      { ar: 'مشاريع خيرية', en: 'Charity projects' },
      { ar: 'تبرّع لمشاريع جهات موثقة، وتابع أثر كل مبلغ حتى دليل التنفيذ.', en: 'Give to projects by verified organisations and follow every amount to delivery evidence.' },
      { label: { ar: 'تبرّع الآن', en: 'Give now' }, href: '/explore?type=charity' }),
    invest: item('default-track-invest', 'track.invest', 0, '/media/defaults/track-invest.jpg',
      { ar: 'استثمار ربحي', en: 'Profit investment' },
      { ar: 'شارك في نمو شركات محلية بعروض واضحة وإفصاح موثّق وعائد مرتبط بالأداء.', en: 'Take part in the growth of local companies through clear offerings and documented disclosure.' },
      { label: { ar: 'استكشف العروض', en: 'View offerings' }, href: '/invest' }),
    work: item('default-track-work', 'track.work', 0, '/media/defaults/track-work.jpg',
      { ar: 'فرص تشغيل', en: 'Jobs & training' },
      { ar: 'برامج تدريب ووظائف حقيقية تفتح أبواب العمل للشباب والنساء في مجتمعاتهم.', en: 'Training programmes and real jobs that open doors to work for young people and women.' },
      { label: { ar: 'اكتشف الفرص', en: 'Find opportunities' }, href: '/opportunities' })
  },
  about: item('default-about', 'about', 0, '/media/defaults/about-village.jpg',
    { ar: 'نؤمن أن الثقة تُبنى بالدليل', en: 'We believe trust is built on evidence' },
    { ar: 'تمكين منصة تجمع المتبرع والمستثمر والباحث عن عمل مع الجهات التي تصنع الأثر في مجتمعاتنا، بشفافية كاملة من أول مبلغ إلى آخر نتيجة.', en: 'Tamkeen brings donors, investors and job seekers together with the organisations making an impact in our communities, with full transparency from the first amount to the final result.' },
    null),
  contact: item('default-contact', 'contact', 0, '/media/defaults/contact-team.jpg',
    { ar: 'يسعدنا أن نسمع منك', en: 'We would love to hear from you' },
    { ar: 'سؤال، شراكة، أو فكرة مشروع؟ اكتب لنا وسيعود إليك فريقنا في أقرب وقت.', en: 'A question, a partnership or a project idea? Write to us and our team will get back to you soon.' },
    null),
  sections: {},
  settings: {}
};

/** Admin content with the seeded defaults filling any gap, so no slot is ever empty. */
export async function readSiteContent(): Promise<SiteContent> {
  const result = await readPublic<SiteContent>('/site-content');
  if (!result.ok) return DEFAULT_SITE_CONTENT;
  const content = result.data;
  return {
    hero: content.hero?.length ? content.hero : DEFAULT_SITE_CONTENT.hero,
    tracks: {
      charity: content.tracks?.charity ?? DEFAULT_SITE_CONTENT.tracks.charity,
      invest: content.tracks?.invest ?? DEFAULT_SITE_CONTENT.tracks.invest,
      work: content.tracks?.work ?? DEFAULT_SITE_CONTENT.tracks.work
    },
    about: content.about ?? DEFAULT_SITE_CONTENT.about,
    contact: content.contact ?? DEFAULT_SITE_CONTENT.contact,
    sections: content.sections ?? {},
    settings: content.settings ?? {}
  };
}

/** One page section: what the admin saved, over its default copy and photo. */
export function section(site: SiteContent, slot: string): ResolvedSection {
  return resolveSection(slot, site.sections[slot]);
}

const COVERS: Record<string, string[]> = {
  charity: ['/media/defaults/cover-charity-1.jpg', '/media/defaults/cover-charity-2.jpg'],
  venture: ['/media/defaults/cover-invest-1.jpg', '/media/defaults/cover-invest-2.jpg'],
  enablement: ['/media/defaults/cover-work-1.jpg', '/media/defaults/cover-work-2.jpg']
};

export interface ListingCovers { offering: Record<string, string>; program: Record<string, string>; job: Record<string, string> }

/** Admin-set photos of offerings, programmes and jobs by slug; empty maps if the API is unreachable. */
export async function readListingCovers(): Promise<ListingCovers> {
  const result = await readPublic<ListingCovers>('/listing-covers');
  return result.ok ? result.data : { offering: {}, program: {}, job: {} };
}

/** The admin-set cover, or a stable default photo for the project's track. */
export function coverFor(project: { slug: string; type: string; coverUrl?: string | null }): string {
  if (project.coverUrl) return project.coverUrl;
  const set = COVERS[project.type] ?? COVERS.charity!;
  let hash = 0;
  for (const character of project.slug) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return set[hash % set.length]!;
}

/** Card data plus live funding, read in parallel. A project whose detail fails keeps its card. */
export async function withFunding(projects: PublicProjectCard[]): Promise<Array<PublicProjectCard & { funding: PublicProjectDetail['funding'] | null }>> {
  const details = await Promise.all(projects.map(project => readPublic<PublicProjectDetail>(`/projects/${encodeURIComponent(project.slug)}`)));
  return projects.map((project, index) => {
    const detail = details[index];
    return { ...project, funding: detail?.ok ? detail.data.funding : null };
  });
}
