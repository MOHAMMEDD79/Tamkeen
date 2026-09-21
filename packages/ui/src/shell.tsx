import type { ReactNode } from 'react';
import { localePath, translator, type Locale } from './locale.js';

/**
 * The application shell: header, optional context sidebar, and the main region.
 *
 * The active context name is always visible (02-IDENTITY requires it above any page carrying a
 * financial action), and the language control preserves the current path so switching locale is
 * navigation, not a reset.
 */

export interface ShellContext {
  id: string;
  name: string;
  /** Shown beside the name so two organisations with similar names stay distinguishable. */
  kind: string;
  href: string;
  current: boolean;
}

export interface ShellNavItem { href: string; text: string; current?: boolean }
export interface ShellNavGroup { title?: string; items: ShellNavItem[] }

export function AppShell({ locale, path, children, navigation, contexts, activeContextName, signedIn = false, demoBanner = false, userActions }: {
  locale: Locale;
  /** Locale-free path, used so the language switch lands on the same page. */
  path: string;
  children: ReactNode;
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
  return (
    <div className="tmk-shell">
      <a className="tmk-skip-link" href="#tmk-main">{t('skipToContent')}</a>
      {demoBanner ? (
        <p className="tmk-demo-banner" role="note">
          <i aria-hidden="true">!</i>
          <span><strong>{t('demoDataTitle')}</strong> — {t('demoDataBody')}</span>
        </p>
      ) : null}
      <header className="tmk-header">
        <a className="tmk-header__brand" href={localePath(locale, '/')}>{t('brand')}</a>
        {activeContextName ? <span className="tmk-badge tmk-badge--neutral"><i className="tmk-badge__icon" aria-hidden="true">•</i>{activeContextName}</span> : null}
        <span className="tmk-header__spacer" />
        <a className="tmk-button tmk-button--quiet" href={localePath(other, path)} lang={other} hrefLang={other} aria-label={t('changeLanguageLabel')}>{t('changeLanguage')}</a>
        {signedIn
          ? userActions
          : <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/login')}>{t('signIn')}</a>}
      </header>
      <div className="tmk-shell__body">
        {navigation?.length || contexts?.length ? (
          <nav className="tmk-sidebar" aria-label={t('mainNavigation')}>
            {contexts?.length ? (
              <div className="tmk-sidebar__group">
                <p className="tmk-sidebar__title" id="tmk-contexts-title">{t('workspace')}</p>
                <div className="tmk-sidebar__nav">
                  {contexts.map(context => (
                    <a key={context.id} className="tmk-sidebar__link" href={context.href} aria-current={context.current ? 'page' : undefined}>
                      {context.name}
                      <span className="tmk-field__hint"> · {context.kind}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {navigation?.map((group, index) => (
              <div className="tmk-sidebar__group" key={group.title ?? index}>
                {group.title ? <p className="tmk-sidebar__title">{group.title}</p> : null}
                <div className="tmk-sidebar__nav">
                  {group.items.map(item => (
                    <a key={item.href} className="tmk-sidebar__link" href={item.href} aria-current={item.current ? 'page' : undefined}>{item.text}</a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        ) : null}
        <main className="tmk-main" id="tmk-main" tabIndex={-1}>
          <div className="tmk-main__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
