'use client';

import { Moon, Sun } from 'lucide-react';
import { THEME_STORAGE_KEY } from './tokens.js';

/**
 * Switches between the light and dark themes and remembers the choice.
 *
 * It holds no React state: which icon shows is decided by CSS from the root `data-theme` attribute
 * (or the system preference when none is set), so the server-rendered button already matches what
 * the boot script painted and nothing flickers on hydration.
 */
export function ThemeToggle({ label }: { label: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private window: the choice lasts for this page only */ }
  };
  return (
    <button type="button" className="tmk-button tmk-button--quiet tmk-theme-toggle" onClick={toggle} aria-label={label} title={label}>
      <Moon aria-hidden="true" size={18} className="tmk-theme-toggle__moon" />
      <Sun aria-hidden="true" size={18} className="tmk-theme-toggle__sun" />
    </button>
  );
}
