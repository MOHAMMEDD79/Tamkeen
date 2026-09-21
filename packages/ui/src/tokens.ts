/**
 * Design tokens for Tamkeen, per 03-DESIGN-SYSTEM.
 *
 * TypeScript is the single source of truth; `tokensCss()` renders the custom properties the
 * stylesheet consumes, so a token can never exist in one place and not the other. Contrast for
 * every pair that actually ships is asserted in tests/design-tokens.test.ts rather than eyeballed.
 *
 * Colour never carries meaning alone (03): every status pairs a colour with a label and an icon.
 */

export const color = {
  /** Working background behind cards and forms. A faint green-grey that sits with the brand teal. */
  canvas: '#F4F7F6',
  /** Cards, forms, table surfaces. */
  surface: '#FFFFFF',
  /** A surface raised above another surface, e.g. a table header. */
  surfaceSunken: '#EDF2F1',
  /** Primary text. */
  ink: '#102A43',
  /** Secondary text. Still AA against canvas and surface. */
  muted: '#526577',
  /** Primary action and links. */
  primary: '#086F68',
  primaryHover: '#05544F',
  /** Tint behind a primary-flavoured block. */
  primaryTint: '#E6F2F0',
  /** Deep brand ground for the hero, auth panel and footer. White text on it is 11:1. */
  brandDeep: '#063B38',
  /** Text on the deep brand ground that should read as secondary. */
  onBrandMuted: '#B9D7D3',
  /** Warm highlight for decoration on the deep ground (icons, rules). Never carries text on light surfaces. */
  highlight: '#E3B04B',
  /** Quiet separator. Decorative only; never the sole boundary of a control. */
  border: '#DDE5E3',
  /**
   * Boundary of an interactive control. WCAG 2.2 1.4.11 requires 3:1 against the adjacent
   * background, which the earlier #879aab did not reach (2.90:1 on surface).
   */
  fieldBorder: '#6B7F92',
  success: '#176548',
  successTint: '#EEF8F1',
  warning: '#8A4B08',
  warningTint: '#FFF7ED',
  danger: '#B42318',
  dangerTint: '#FFF0EF',
  info: '#0B4F9E',
  infoTint: '#EFF6FF',
  /** Focus indicator. Deliberately distinct from primary so focus reads on primary surfaces. */
  focus: '#2563EB',
  /** Text on a filled primary or danger button. */
  onAccent: '#FFFFFF'
} as const;

/** 4-based spacing scale (03). Keys are the pixel value so call sites stay readable. */
export const space = { 4: '4px', 8: '8px', 12: '12px', 16: '16px', 24: '24px', 32: '32px', 48: '48px', 64: '64px' } as const;

export const radius = { field: '10px', card: '16px', dialog: '20px', pill: '999px' } as const;

/** Soft, layered elevation. Cards float slightly; interactive cards lift on hover. */
export const shadow = {
  sm: '0 1px 2px rgb(16 42 67 / 0.06), 0 1px 3px rgb(16 42 67 / 0.05)',
  md: '0 4px 12px rgb(16 42 67 / 0.07), 0 2px 4px rgb(16 42 67 / 0.05)',
  lg: '0 18px 40px rgb(6 59 56 / 0.14), 0 6px 12px rgb(16 42 67 / 0.06)',
  focus: '0 0 0 4px rgb(8 111 104 / 0.18)'
} as const;

export const typography = {
  /**
   * IBM Plex Sans Arabic (SIL OFL 1.1), self-hosted by next/font at build time: no request reaches a
   * font CDN from the browser. It carries Latin glyphs too, so both locales share one voice.
   * `--tmk-font-brand` is set by the root layout; the system faces are the fallback.
   */
  familyArabic: "var(--tmk-font-brand), 'Segoe UI', Tahoma, Arial, sans-serif",
  familyLatin: "var(--tmk-font-brand), 'Segoe UI', Arial, sans-serif",
  /** Tabular figures keep money columns aligned; required wherever an amount is shown. */
  familyNumeric: "var(--tmk-font-brand), 'Segoe UI', Tahoma, Arial, sans-serif",
  bodySize: '16px',
  bodyLine: '1.7',
  captionSize: '13.5px',
  captionLine: '1.6',
  h1Size: 'clamp(28px, 4.2vw, 42px)',
  /** The home page hero only. */
  displaySize: 'clamp(34px, 6vw, 60px)',
  /** Dashboards use a calmer h1 so data, not the heading, leads the page (03). */
  h1DashboardSize: 'clamp(24px, 3vw, 28px)',
  h2Size: '22px',
  h3Size: '18px',
  headingLine: '1.35'
} as const;

export const layout = {
  /** Public content column (03). */
  contentMax: '1280px',
  /** Reading column for prose and forms. */
  proseMax: '680px',
  sidebarWidth: '256px',
  headerHeight: '72px',
  /** Side gutter that keeps content clear of the viewport edge at 360px. */
  gutter: '16px'
} as const;

export const motion = { fast: '120ms', base: '200ms', easing: 'cubic-bezier(0.2, 0, 0.2, 1)' } as const;

/** Breakpoints the acceptance gate names explicitly (PART-03). */
export const breakpoint = { phone: 360, tablet: 768, desktop: 1440 } as const;

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * Renders the token layer as CSS custom properties under `:root`. The app injects this in the
 * document head so the stylesheet and the TypeScript values can never drift apart.
 */
export function tokensCss(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(color)) lines.push(`--tmk-color-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(space)) lines.push(`--tmk-space-${name}:${value}`);
  for (const [name, value] of Object.entries(radius)) lines.push(`--tmk-radius-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(shadow)) lines.push(`--tmk-shadow-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(typography)) lines.push(`--tmk-type-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(layout)) lines.push(`--tmk-layout-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(motion)) lines.push(`--tmk-motion-${kebab(name)}:${value}`);
  return `:root{${lines.join(';')}}`;
}

/** Every custom property name this layer defines, used by the stylesheet integrity test. */
export function tokenNames(): string[] {
  // Only names being defined (`--x:`), not ones a value merely refers to, such as the font variable
  // the root layout provides.
  return [...tokensCss().matchAll(/(--[a-z0-9-]+):/g)].map(match => match[1] as string);
}

/** Relative luminance per WCAG 2.x, for the contrast assertions in the token tests. */
export function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (raw: number) => {
    const scaled = raw / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
