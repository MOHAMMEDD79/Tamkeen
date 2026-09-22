'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Banknote, Building2, ClipboardCheck, Contact, FileSearch, FileText, FolderKanban, Gauge, Images, Inbox, Landmark, LayoutTemplate, LifeBuoy, LogOut, ScrollText, ShieldCheck, TrendingUp, Users, UsersRound } from 'lucide-react';
import { localePath, type Locale } from './locale.js';

/**
 * The top of the signed-in sidebar: who is signed in, and the staff sections their platform roles
 * open. Reading the roles here, once, means every one of the fifty-odd screens gets the right admin
 * links without each passing them down — and a staff page is never a URL someone has to remember.
 *
 * Showing a link is presentation only: every admin endpoint re-checks the role (02-IDENTITY).
 */

interface Me { name: string; email: string; roles: string[] }
const CACHE_KEY = 'tamkeen.account-panel';
const CACHE_MS = 5 * 60_000;

const ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  PlatformAdmin: { ar: 'مدير المنصة', en: 'Platform admin' },
  VerificationReviewer: { ar: 'مراجع توثيق', en: 'Verification reviewer' },
  ContentReviewer: { ar: 'مراجع محتوى', en: 'Content reviewer' },
  FinanceOperator: { ar: 'مشغّل مالي', en: 'Finance operator' },
  RiskReviewer: { ar: 'مراجع مخاطر', en: 'Risk reviewer' },
  Support: { ar: 'الدعم', en: 'Support' },
  Auditor: { ar: 'مدقق', en: 'Auditor' },
  Operations: { ar: 'التشغيل', en: 'Operations' }
};

const STAFF_LINKS: Array<{ role: string; path: string; ar: string; en: string; icon: LucideIcon }> = [
  { role: 'PlatformAdmin', path: '/admin/projects', ar: 'إدارة المشاريع', en: 'Projects', icon: FolderKanban },
  { role: 'PlatformAdmin', path: '/admin/site', ar: 'البانرات والأقسام', en: 'Banners & sections', icon: LayoutTemplate },
  { role: 'PlatformAdmin', path: '/admin/site/pages', ar: 'صفحات الموقع', en: 'Site pages', icon: FileText },
  { role: 'PlatformAdmin', path: '/admin/site/covers', ar: 'المشاريع والفرص', en: 'Listings & photos', icon: Images },
  { role: 'PlatformAdmin', path: '/admin/site/settings', ar: 'بيانات التواصل', en: 'Contact details', icon: Contact },
  { role: 'PlatformAdmin', path: '/admin/messages', ar: 'رسائل التواصل', en: 'Contact messages', icon: Inbox },
  { role: 'PlatformAdmin', path: '/admin/organizations', ar: 'الجهات', en: 'Organisations', icon: Building2 },
  { role: 'PlatformAdmin', path: '/admin/users', ar: 'المستخدمون', en: 'Users', icon: Users },
  { role: 'PlatformAdmin', path: '/admin/team', ar: 'فريق التشغيل', en: 'Staff team', icon: UsersRound },
  { role: 'VerificationReviewer', path: '/admin/verifications', ar: 'توثيق الجهات', en: 'Verifications', icon: ShieldCheck },
  { role: 'ContentReviewer', path: '/admin/reviews/project', ar: 'مراجعة المشاريع', en: 'Project reviews', icon: ClipboardCheck },
  { role: 'ContentReviewer', path: '/admin/program-reviews', ar: 'مراجعة البرامج', en: 'Programme reviews', icon: FileSearch },
  { role: 'FinanceOperator', path: '/admin/finance', ar: 'العمليات المالية', en: 'Finance', icon: Banknote },
  { role: 'FinanceOperator', path: '/admin/bank-change-requests', ar: 'الحسابات البنكية', en: 'Bank changes', icon: Landmark },
  { role: 'RiskReviewer', path: '/admin/investment-reviews', ar: 'مراجعة الاستثمار', en: 'Investment reviews', icon: TrendingUp },
  { role: 'Support', path: '/admin/tickets', ar: 'تذاكر الدعم', en: 'Support tickets', icon: LifeBuoy },
  { role: 'Auditor', path: '/admin/audit', ar: 'سجل التدقيق', en: 'Audit log', icon: ScrollText },
  { role: 'Operations', path: '/admin/operations', ar: 'لوحة التشغيل', en: 'Operations', icon: Gauge }
];

function readCache(): Me | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; me: Me };
    return Date.now() - cached.at < CACHE_MS ? cached.me : null;
  } catch { return null; }
}

/**
 * Who is signed in, from `/api/v1/me`, shown from a five-minute session cache first so a page does
 * not flash signed-out while the request is in flight. `null` means signed out (or not known yet).
 */
function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const cached = readCache();
    if (cached) setMe(cached);
    let active = true;
    fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((body: { data?: { user: { name: string; email: string }; profile?: { displayName?: string }; platformRoles?: string[] } } | null) => {
        if (!active) return;
        if (!body?.data) { setMe(null); try { window.sessionStorage.removeItem(CACHE_KEY); } catch { /* nothing cached */ } return; }
        const next: Me = { name: body.data.profile?.displayName || body.data.user.name, email: body.data.user.email, roles: body.data.platformRoles ?? [] };
        setMe(next);
        try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), me: next })); } catch { /* private window */ }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return me;
}

/**
 * The account corner of the public header. Public pages are rendered without knowing the visitor,
 * so they start with "sign in / create account"; once the browser confirms a session, this swaps
 * them for the visitor's name, a way back to their dashboard, and sign-out.
 */
export function HeaderAccount({ locale, signedOut }: { locale: Locale; signedOut: ReactNode }) {
  const me = useMe();
  if (!me) return <>{signedOut}</>;
  const ar = locale === 'ar';
  const signOut = () => {
    try { window.sessionStorage.removeItem(CACHE_KEY); } catch { /* nothing cached */ }
    void fetch('/api/v1/auth/sign-out', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .finally(() => window.location.assign(localePath(locale, '/login')));
  };
  return (
    <>
      <a className="tmk-button tmk-button--primary tmk-header-account" href={localePath(locale, '/app')}>
        <span className="tmk-header-account__avatar" aria-hidden="true">{(me.name.trim()[0] ?? '?').toUpperCase()}</span>
        <span className="tmk-header-account__name">{ar ? 'لوحتي' : 'My dashboard'}</span>
      </a>
      <button type="button" className="tmk-button tmk-button--quiet" onClick={signOut} aria-label={ar ? `تسجيل الخروج من حساب ${me.name}` : `Sign out of ${me.name}`}>
        <LogOut aria-hidden="true" size={18} />
      </button>
    </>
  );
}

export function AccountPanel({ locale, path }: { locale: Locale; path: string }) {
  const me = useMe();
  if (!me) return null;
  const ar = locale === 'ar';
  const links = STAFF_LINKS.filter(link => me.roles.includes(link.role));
  const roleText = me.roles.length ? me.roles.map(role => (ROLE_LABELS[role] ? ROLE_LABELS[role][locale] : role)).join(' · ') : (ar ? 'حساب شخصي' : 'Personal account');
  return (
    <>
      <div className="tmk-account">
        <span className="tmk-account__avatar" aria-hidden="true">{(me.name.trim()[0] ?? '?').toUpperCase()}</span>
        <span className="tmk-account__who">
          <strong>{me.name}</strong>
          <span>{roleText}</span>
        </span>
      </div>
      {links.length ? (
        <div className="tmk-sidebar__group">
          <p className="tmk-sidebar__title">{ar ? 'إدارة المنصة' : 'Platform'}</p>
          <div className="tmk-sidebar__nav">
            {links.map(link => {
              const Icon = link.icon;
              const current = path === link.path;
              return (
                <a key={link.path} className="tmk-sidebar__link" href={localePath(locale, link.path)} aria-current={current ? 'page' : undefined}>
                  <Icon aria-hidden="true" size={18} className="tmk-sidebar__icon" />
                  <span className="tmk-sidebar__text">{ar ? link.ar : link.en}</span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
