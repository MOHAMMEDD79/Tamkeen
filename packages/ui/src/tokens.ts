/**
 * Design tokens for Tamkeen, per 03-DESIGN-SYSTEM.
 *
 * TypeScript is the single source of truth; `tokensCss()` renders the custom properties the
 * stylesheet consumes, so a token can never exist in one place and not the other. Contrast for
 * every pair that actually ships is asserted in tests/design-tokens.test.ts, for both themes,
 * rather than eyeballed.
 *
 * Colour never carries meaning alone (03): every status pairs a colour with a label and an icon.
 *
 * The visual idea: warm, photo-led and alive. Real photography carries the emotion, the deep teal
 * carries trust, and amber marks the moments that matter (contribute, invest, apply). Motion is
 * used to reveal and to count, and always stops for people who prefer reduced motion.
 */

export type Palette = Record<keyof typeof color, string>;

export const color = {
  /** Page ground: a clean, very light mint-white. */
  canvas: '#F6F9F8',
  /** Cards, forms, table surfaces. */
  surface: '#FFFFFF',
  /** A surface set into another: a table header, a quiet band, a chip. */
  surfaceSunken: '#ECF3F1',
  /** Primary text. */
  ink: '#0F1F1C',
  /** Secondary text. Still AA against canvas, surface and the sunken surface. */
  muted: '#52615D',
  /** Brand teal: links, primary buttons, progress. */
  primary: '#0A7A68',
  primaryHover: '#07604F',
  /** Tint behind a primary-flavoured block. */
  primaryTint: '#E1F3EE',
  /** The deep brand ground: hero overlays, bands, footer. */
  brandDeep: '#062925',
  /** Text on the deep ground. */
  onBrand: '#FFFFFF',
  /** Secondary text on the deep ground. */
  onBrandMuted: '#B7D6CF',
  /** Warm amber for the actions that move money or change a life: contribute, invest, apply. */
  accent: '#F5A524',
  accentHover: '#E08E0B',
  /** Label on an amber button: dark, because white on amber fails contrast. */
  onWarm: '#1C1405',
  /** Amber for small marks on the deep ground (a number, a rule). */
  highlight: '#F5A524',
  /** Hairline separator. Decorative only; never the sole boundary of a control. */
  border: '#DDE7E4',
  /** Boundary of an interactive control: 3:1 against every background it sits on (WCAG 1.4.11). */
  fieldBorder: '#7A8A86',
  success: '#12703F',
  successTint: '#E4F5EA',
  warning: '#8A4B08',
  warningTint: '#FDF1DE',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  info: '#1D4F91',
  infoTint: '#E8F0FC',
  /** Focus indicator. Distinct from primary so focus reads on primary surfaces. */
  focus: '#2F62D8',
  /** Label on a filled primary or danger button. */
  onAccent: '#FFFFFF'
} as const;

/**
 * The dark theme is designed, not inverted: a deep green-black ground, surfaces that step up in
 * lightness instead of casting shadows, and a lighter teal so links and filled buttons keep their
 * contrast. A filled primary button carries dark text here; amber keeps its dark label in both.
 */
export const darkColor: Palette = {
  canvas: '#0B1211',
  surface: '#111A18',
  surfaceSunken: '#172321',
  ink: '#EAF1EF',
  muted: '#9FB0AB',
  primary: '#3FC7AE',
  primaryHover: '#6BD8C3',
  primaryTint: '#12302B',
  brandDeep: '#051513',
  onBrand: '#EAF1EF',
  onBrandMuted: '#A6BDB7',
  accent: '#F7B447',
  accentHover: '#FAC56E',
  onWarm: '#1C1405',
  highlight: '#F7B447',
  border: '#22302D',
  fieldBorder: '#667C77',
  success: '#5FD39A',
  successTint: '#10271C',
  warning: '#F0B660',
  warningTint: '#2C2112',
  danger: '#F28B80',
  dangerTint: '#301816',
  info: '#8DB6F7',
  infoTint: '#132338',
  focus: '#8DB0FF',
  onAccent: '#06201B'
};

/** 4-based spacing scale (03). Keys are the pixel value so call sites stay readable. */
export const space = { 4: '4px', 8: '8px', 12: '12px', 16: '16px', 24: '24px', 32: '32px', 48: '48px', 64: '64px' } as const;

export const radius = { field: '12px', card: '20px', dialog: '28px', pill: '999px' } as const;

/** Soft elevation: cards rest on `sm`, lift to `md` on hover; menus and dialogs float on `lg`. */
export const shadow = {
  sm: '0 1px 2px rgb(15 31 28 / 0.05), 0 2px 6px rgb(15 31 28 / 0.04)',
  md: '0 10px 30px rgb(15 31 28 / 0.08), 0 2px 6px rgb(15 31 28 / 0.05)',
  lg: '0 30px 70px rgb(6 41 37 / 0.20), 0 8px 20px rgb(15 31 28 / 0.08)',
  focus: '0 0 0 4px rgb(47 98 216 / 0.22)'
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
  h1Size: 'clamp(30px, 4vw, 46px)',
  /** The home page headline only. */
  displaySize: 'clamp(38px, 6vw, 76px)',
  /** Dashboards use a calmer h1 so data, not the heading, leads the page (03). */
  h1DashboardSize: 'clamp(24px, 2.6vw, 30px)',
  h2Size: '22px',
  h3Size: '17px',
  headingLine: '1.3'
} as const;

export const layout = {
  /** Public content column (03). */
  contentMax: '1280px',
  /** Reading column for prose and forms. */
  proseMax: '680px',
  sidebarWidth: '280px',
  headerHeight: '76px',
  /** Side gutter that keeps content clear of the viewport edge at 360px. */
  gutter: '20px'
} as const;

/** `slow` is for scroll reveals and image zooms; `easing-out` settles movement gently at its end. */
export const motion = { fast: '120ms', base: '200ms', slow: '700ms', easing: 'cubic-bezier(0.2, 0, 0.2, 1)', easingOut: 'cubic-bezier(0.16, 1, 0.3, 1)' } as const;

/** Breakpoints the acceptance gate names explicitly (PART-03). */
export const breakpoint = { phone: 360, tablet: 768, desktop: 1440 } as const;

/** Where the chosen theme is remembered. Absent means "follow the system". */
export const THEME_STORAGE_KEY = 'tamkeen.theme';

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const colorLines = (palette: Palette) => Object.entries(palette).map(([name, value]) => `--tmk-color-${kebab(name)}:${value}`).join(';');

/**
 * Renders the token layer as CSS custom properties. The app injects this in the document head so
 * the stylesheet and the TypeScript values can never drift apart.
 *
 * The dark palette applies when the person chose it (`data-theme="dark"` on the root) or when their
 * system prefers dark and they have not chosen light.
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
  const dark = `${colorLines(darkColor)};color-scheme:dark`;
  return `:root{${lines.join(';')};color-scheme:light}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`
    + `:root[data-theme="dark"]{${dark}}`;
}

/**
 * Runs before first paint (inlined in the head) so a stored choice never flashes the other theme.
 * Storage can throw in a private window; the page then simply follows the system.
 */
export function themeBootScript(): string {
  return `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
}

/** Every custom property name this layer defines, used by the stylesheet integrity test. */
export function tokenNames(): string[] {
  // Only names being defined (`--x:`), not ones a value merely refers to, such as the font variable
  // the root layout provides. Each name appears once even though the dark theme redefines it.
  return [...new Set([...tokensCss().matchAll(/(--[a-z0-9-]+):/g)].map(match => match[1] as string))];
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
