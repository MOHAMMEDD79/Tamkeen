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
  /** Working background behind cards and forms. */
  canvas: '#F6F8FA',
  /** Cards, forms, table surfaces. */
  surface: '#FFFFFF',
  /** A surface raised above another surface, e.g. a table header. */
  surfaceSunken: '#EEF2F6',
  /** Primary text. */
  ink: '#102A43',
  /** Secondary text. Still AA against canvas and surface. */
  muted: '#526577',
  /** Primary action and links. */
  primary: '#086F68',
  primaryHover: '#05544F',
  /** Tint behind a primary-flavoured block. */
  primaryTint: '#E8F3F2',
  /** Quiet separator. Decorative only; never the sole boundary of a control. */
  border: '#D9E2EC',
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

export const radius = { field: '8px', card: '12px', dialog: '16px', pill: '999px' } as const;

export const typography = {
  /** Arabic face first; both are self-hosted at deployment time after a licence check (03). */
  familyArabic: "'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif",
  familyLatin: "'Inter', 'Segoe UI', Arial, sans-serif",
  /** Tabular figures keep money columns aligned; required wherever an amount is shown. */
  familyNumeric: "'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif",
  bodySize: '16px',
  bodyLine: '1.7',
  captionSize: '13.5px',
  captionLine: '1.6',
  h1Size: 'clamp(28px, 4.5vw, 40px)',
  /** Dashboards use a calmer h1 so data, not the heading, leads the page (03). */
  h1DashboardSize: 'clamp(24px, 3vw, 28px)',
  h2Size: '20px',
  h3Size: '17px',
  headingLine: '1.4'
} as const;

export const layout = {
  /** Public content column (03). */
  contentMax: '1280px',
  /** Reading column for prose and forms. */
  proseMax: '680px',
  sidebarWidth: '256px',
  headerHeight: '64px',
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
  for (const [name, value] of Object.entries(typography)) lines.push(`--tmk-type-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(layout)) lines.push(`--tmk-layout-${kebab(name)}:${value}`);
  for (const [name, value] of Object.entries(motion)) lines.push(`--tmk-motion-${kebab(name)}:${value}`);
  return `:root{${lines.join(';')}}`;
}

/** Every custom property name this layer defines, used by the stylesheet integrity test. */
export function tokenNames(): string[] {
  return [...tokensCss().matchAll(/--[a-z0-9-]+/g)].map(match => match[0]);
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
