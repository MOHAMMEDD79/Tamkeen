import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, Briefcase, Building2, ChartColumn, ClipboardList, Compass, Globe, GraduationCap, HandCoins, HandHeart, LayoutDashboard, LifeBuoy, Lightbulb, Mail, Menu, Settings, TrendingUp, Users } from 'lucide-react';
import { localePath, translator, type Locale, type StringKey } from './locale.js';
import { ThemeToggle } from './theme-toggle.js';
import { RevealOnScroll } from './motion.js';
import { AccountPanel, HeaderAccount } from './account-panel.js';

/**
 * The application shell: header, optional context sidebar, the main region and the footer.
 *
 * The active context name is always visible (02-IDENTITY requires it above any page carrying a
 * financial action), and the language control preserves the current path so switching locale is
 * navigation, not a reset.
 *
 * The header carries the public navigation on every page, and any page under `/app` gets the
 * personal navigation automatically, so the 50-odd screens that render this shell stay consistent
 * without each one assembling its own menu.
 */

export interface ShellContext {
  id: string;
  name: string;
  /** Shown beside the name so two organisations with similar names stay distinguishable. */
  kind: string;
  href: string;
  current: boolean;
}

export interface ShellNavItem { href: string; text: string; current?: boolean; icon?: LucideIcon }
export interface ShellNavGroup { title?: string; items: ShellNavItem[] }

/**
 * The brand mark: three rising bars â€” funding, delivery, result â€” on a teal square. The colours come
 * from the theme, so the mark stays legible in dark mode; the tallest bar is amber in both.
 */
/**
 * The official Tamkeen mark (the files live in the web app's public/brand folder). It ships in two
 * inks: the original navy and teal for light surfaces, and a white and pale-teal version for dark
 * ones. `onDark` forces the light ink (the sidebar and footer are always dark); otherwise the ink
 * follows the theme, with the swap done in CSS so it is right on first paint.
 */
export function Logo({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className={onDark ? 'tmk-logo tmk-logo--on-dark' : 'tmk-logo'} style={{ inlineSize: size, blockSize: size }} aria-hidden="true">
      <img className="tmk-logo__ink" src="/brand/tamkeen-mark.png" alt="" width={size} height={size} />
      <img className="tmk-logo__light" src="/brand/tamkeen-mark-light.png" alt="" width={size} height={size} />
    </span>
  );
}

const PUBLIC_NAV: Array<{ path: string; key: StringKey }> = [
  { path: '/explore', key: 'navExplore' },
  { path: '/invest', key: 'navInvest' },
  { path: '/opportunities', key: 'navOpportunities' },
  { path: '/organizations', key: 'navOrganizations' },
  { path: '/about', key: 'navAbout' },
  { path: '/contact-us', key: 'navContact' }
];

const PERSONAL_NAV: Array<{ titleKey: StringKey; items: Array<{ path: string; key: StringKey; icon: LucideIcon }> }> = [
  { titleKey: 'navGroupActivity', items: [
    { path: '/app', key: 'navDashboard', icon: LayoutDashboard },
    { path: '/app/contributions', key: 'navContributions', icon: HandHeart },
    { path: '/app/investments', key: 'navInvestments', icon: TrendingUp },
    { path: '/app/applications', key: 'navApplications', icon: GraduationCap }
  ] },
  { titleKey: 'navGroupWork', items: [
    { path: '/app/jobs', key: 'navJobs', icon: Briefcase },
    { path: '/app/assistance', key: 'navAssistance', icon: HandCoins },
    { path: '/app/proposals', key: 'navProposals', icon: Lightbulb },
    { path: '/app/volunteering', key: 'navVolunteering', icon: Users }
  ] },
  { titleKey: 'navGroupAccount', items: [
    { path: '/app/notifications', key: 'notifications', icon: Bell },
    { path: '/app/tickets', key: 'navSupport', icon: LifeBuoy },
    { path: '/app/settings', key: 'navSettings', icon: Settings }
  ] }
];

const isCurrent = (path: string, target: string) => target === '/app' ? path === '/app' : path === target || path.startsWith(`${target}/`);

function personalNavigation(locale: Locale, path: string): ShellNavGroup[] {
  const t = translator(locale);
  return PERSONAL_NAV.map(group => ({
    title: t(group.titleKey),
    items: group.items.map(item => ({ href: localePath(locale, item.path), text: t(item.key), icon: item.icon, current: isCurrent(path, item.path) }))
  }));
}

export function AppShell({ locale, path, children, lead, navigation, contexts, activeContextName, signedIn = false, demoBanner = false, userActions }: {
  locale: Locale;
  /** Locale-free path, used so the language switch lands on the same page. */
  path: string;
  children: ReactNode;
  /** Full-width content between the header and the page column: a banner or carousel. */
  lead?: ReactNode;
  navigation?: ShellNavGroup[];
  contexts?: ShellContext[];
  activeContextName?: string;
  signedIn?: boolean;
  demoBanner?: boolean;
  /** Signing out is a mutation, so the shell takes the caller's control rather than a link. */
  userActions?: ReactNode;
}) {
  const t = translator(locale);
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  // Personal pages and staff pages share one sidebar: the account panel adds the staff sections.
  const personal = path === '/app' || path.startsWith('/app/') || path === '/onboarding' || path.startsWith('/admin/');
  const sidebar = navigation?.length ? navigation : personal ? personalNavigation(locale, path) : undefined;
  const publicLinks = PUBLIC_NAV.map(item => (
    <a key={item.path} className="tmk-nav__link" href={localePath(locale, item.path)} aria-current={isCurrent(path, item.path) ? 'page' : undefined}>{t(item.key)}</a>
  ));
  // Public pages do not know the visitor at render time; HeaderAccount checks the session in the browser.
  const accountControls = signedIn
    ? userActions
    : <HeaderAccount locale={locale} signedOut={<>
        <a className="tmk-button tmk-button--quiet" href={localePath(locale, '/login')}>{t('signIn')}</a>
        <a className="tmk-button tmk-button--primary" href={localePath(locale, '/register')}>{t('register')}</a>
      </>} />;
  const appMode = Boolean(sidebar?.length || contexts?.length);
  const sidebarNav = (
    <>
      {personal ? <AccountPanel locale={locale} path={path} /> : null}
      {contexts?.length ? (
        <div className="tmk-sidebar__group">
          <p className="tmk-sidebar__title" id="tmk-contexts-title">{t('navGroupOrganizations')}</p>
          <div className="tmk-sidebar__nav">
            {contexts.map(context => (
              <a key={context.id} className="tmk-sidebar__link" href={context.href} aria-current={context.current ? 'page' : undefined}>
                <Building2 aria-hidden="true" size={18} className="tmk-sidebar__icon" />
                <span className="tmk-sidebar__text">{context.name}<span className="tmk-sidebar__kind">{context.kind}</span></span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {sidebar?.map((group, index) => (
        <div className="tmk-sidebar__group" key={group.title ?? index}>
          {group.title ? <p className="tmk-sidebar__title">{group.title}</p> : null}
          <div className="tmk-sidebar__nav">
            {group.items.map(item => {
              const Icon = item.icon;
              return (
                <a key={item.href} className="tmk-sidebar__link" href={item.href} aria-current={item.current ? 'page' : undefined}>
                  {Icon ? <Icon aria-hidden="true" size={18} className="tmk-sidebar__icon" /> : null}
                  <span className="tmk-sidebar__text">{item.text}</span>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );

  /*
   * Signed-in and staff pages: a dashboard layout. The sidebar is docked full-height to the start
   * edge (the right in Arabic) and carries the brand; a slim top bar holds the page-level controls.
   * No marketing header or footer competes with the work.
   */
  if (appMode) {
    return (
      <div className="tmk-app">
        <RevealOnScroll />
        <a className="tmk-skip-link" href="#tmk-main">{t('skipToContent')}</a>
        <aside className="tmk-app__sidebar">
          <a className="tmk-header__brand tmk-app__brand" href={localePath(locale, '/')}><Logo size={42} onDark /><span>{t('brand')}</span></a>
          <nav className="tmk-sidebar" aria-label={personal ? t('personalWorkspace') : t('workspace')}>{sidebarNav}</nav>
          <a className="tmk-app__site" href={localePath(locale, '/')}><Globe aria-hidden="true" size={18} />{t('viewSite')}</a>
        </aside>
        <div className="tmk-app__body">
          <header className="tmk-app__topbar">
            {/* The sidebar as a drawer on narrow screens; a disclosure, so it works without JavaScript. */}
            <details className="tmk-app__drawer">
              <summary className="tmk-button tmk-button--secondary" aria-label={t('openMenu')}><Menu aria-hidden="true" size={20} /></summary>
              <div className="tmk-app__drawer-panel"><nav className="tmk-sidebar" aria-label={t('mainNavigation')}>{sidebarNav}</nav></div>
            </details>
            <a className="tmk-header__brand tmk-app__topbrand" href={localePath(locale, '/')}><Logo size={34} /><span>{t('brand')}</span></a>
            {activeContextName ? <span className="tmk-header__context"><Building2 aria-hidden="true" size={16} />{activeContextName}</span> : null}
            <span className="tmk-header__spacer" />
            <div className="tmk-app__actions">
              <ThemeToggle label={t('toggleTheme')} />
              <a className="tmk-button tmk-button--quiet" href={localePath(other, path)} lang={other} hrefLang={other} aria-label={t('changeLanguageLabel')}>{t('changeLanguage')}</a>
              {accountControls}
            </div>
          </header>
          {demoBanner ? (
            <p className="tmk-demo-banner" role="note">
              <i aria-hidden="true">!</i>
              <span><strong>{t('demoDataTitle')}</strong> â€” {t('demoDataBody')}</span>
            </p>
          ) : null}
          {lead}
          <main className="tmk-main tmk-app__main" id="tmk-main" tabIndex={-1}>
            <div className="tmk-main__inner">{children}</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="tmk-shell">
      <RevealOnScroll />
      <a className="tmk-skip-link" href="#tmk-main">{t('skipToContent')}</a>
      {demoBanner ? (
        <p className="tmk-demo-banner" role="note">
          <i aria-hidden="true">!</i>
          <span><strong>{t('demoDataTitle')}</strong> â€” {t('demoDataBody')}</span>
        </p>
      ) : null}
      <header className="tmk-header">
        <div className="tmk-header__inner">
          <a className="tmk-header__brand" href={localePath(locale, '/')}>
            <Logo />
            <span>{t('brand')}</span>
          </a>
          <nav className="tmk-nav" aria-label={t('mainNavigation')}>{publicLinks}</nav>
          <span className="tmk-header__spacer" />
          <div className="tmk-header__actions">
            <ThemeToggle label={t('toggleTheme')} />
            <a className="tmk-button tmk-button--quiet tmk-header__lang" href={localePath(other, path)} lang={other} hrefLang={other} aria-label={t('changeLanguageLabel')}>{t('changeLanguage')}</a>
            {accountControls}
          </div>
          <span className="tmk-header__compact"><ThemeToggle label={t('toggleTheme')} /></span>
          {/* A disclosure, not a script: the menu works before hydration and without JavaScript. */}
          <details className="tmk-mobile-menu">
            <summary className="tmk-button tmk-button--secondary" aria-label={t('openMenu')}><Menu aria-hidden="true" size={20} /></summary>
            <div className="tmk-mobile-menu__panel">
              <nav aria-label={t('mainNavigation')}>{publicLinks}</nav>
              <div className="tmk-mobile-menu__actions">
                <a className="tmk-button tmk-button--quiet" href={localePath(other, path)} lang={other} hrefLang={other}>{t('changeLanguage')}</a>
                {accountControls}
              </div>
            </div>
          </details>
        </div>
      </header>
      {lead}
      <div className="tmk-shell__body">
        <main className="tmk-main" id="tmk-main" tabIndex={-1}>
          <div className="tmk-main__inner">{children}</div>
        </main>
      </div>
      <footer className="tmk-footer">
        <div className="tmk-footer__inner">
          <div className="tmk-footer__brand">
            <a className="tmk-header__brand tmk-footer__logo" href={localePath(locale, '/')}><Logo size={48} onDark /><span>{t('brand')}</span></a>
            <p>{t('footerAbout')}</p>
          </div>
          <div>
            <p className="tmk-footer__title">{t('footerExplore')}</p>
            <ul>
              <li><a href={localePath(locale, '/explore')}><Compass aria-hidden="true" size={16} />{t('navExplore')}</a></li>
              <li><a href={localePath(locale, '/organizations')}><Building2 aria-hidden="true" size={16} />{t('navOrganizations')}</a></li>
              <li><a href={localePath(locale, '/invest')}><TrendingUp aria-hidden="true" size={16} />{t('navInvest')}</a></li>
              <li><a href={localePath(locale, '/opportunities')}><Briefcase aria-hidden="true" size={16} />{t('navOpportunities')}</a></li>
              <li><a href={localePath(locale, '/impact')}><ChartColumn aria-hidden="true" size={16} />{t('navImpact')}</a></li>
            </ul>
          </div>
          <div>
            <p className="tmk-footer__title">{t('footerAccount')}</p>
            <ul>
              <li><a href={localePath(locale, '/app')}><LayoutDashboard aria-hidden="true" size={16} />{t('navDashboard')}</a></li>
              <li><a href={localePath(locale, '/app/contributions')}><HandHeart aria-hidden="true" size={16} />{t('navContributions')}</a></li>
              <li><a href={localePath(locale, '/app/tickets')}><LifeBuoy aria-hidden="true" size={16} />{t('navSupport')}</a></li>
              <li><a href={localePath(locale, '/about')}><ClipboardList aria-hidden="true" size={16} />{t('navAbout')}</a></li>
              <li><a href={localePath(locale, '/contact-us')}><Mail aria-hidden="true" size={16} />{t('navContact')}</a></li>
            </ul>
          </div>
        </div>
        <div className="tmk-footer__bottom">
          <span>Â© {new Date().getUTCFullYear()} {t('brand')} Â· {t('footerRights')}</span>
          <a href={localePath(locale, '/policies/terms')}>{t('footerTerms')}</a>
        </div>
      </footer>
    </div>
  );
}
