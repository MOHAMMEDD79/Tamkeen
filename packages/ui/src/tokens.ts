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
 * The visual idea is a ledger: warm paper, ink, hairline rules and tabular figures. Depth comes from
 * rules and spacing, not from gradients or heavy shadows, because what this product sells is a
 * record that can be checked.
 */

export type Palette = Record<keyof typeof color, string>;

export const color = {
  /** Page ground: warm paper rather than a cold grey. */
  canvas: '#F7F6F2',
  /** Cards, forms, table surfaces. */
  surface: '#FFFFFF',
  /** A surface set into another, e.g. a table header or a quiet panel. */
  surfaceSunken: '#F0EEE8',
  /** Primary text: near-black ink. */
  ink: '#17191C',
  /** Secondary text. Still AA against canvas, surface and the sunken surface. */
  muted: '#5B6068',
  /** Brand teal: links, the active marker, meters. */
  primary: '#0B6B5D',
  primaryHover: '#08574C',
  /** Tint behind a primary-flavoured block. */
  primaryTint: '#E4F0EC',
  /** The inverse ground: footer and the ledger panel's header band. */
  brandDeep: '#101816',
  /** Text on the inverse ground. */
  onBrand: '#FFFFFF',
  /** Secondary text on the inverse ground. */
  onBrandMuted: '#A7B3AF',
  /** Ochre used for small marks only: a seal, a rule, a numeral. Never body text on a light ground. */
  highlight: '#B7852A',
  /** Hairline separator. Decorative only; never the sole boundary of a control. */
  border: '#E4E1D9',
  /** Boundary of an interactive control: 3:1 against every background it sits on (WCAG 1.4.11). */
  fieldBorder: '#7A7F86',
  success: '#17663F',
  successTint: '#E8F4EC',
  warning: '#8A4B08',
  warningTint: '#FBF1E3',
  danger: '#B42318',
  dangerTint: '#FCEDEB',
  info: '#1D4F91',
  infoTint: '#EAF1FB',
  /** Focus indicator. Distinct from primary so focus reads on primary surfaces. */
  focus: '#2F62D8',
  /** Label on a filled primary or danger button. */
  onAccent: '#FFFFFF'
} as const;

/**
 * The dark theme is designed, not inverted: a charcoal ground with a faint green cast, surfaces that
 * step up in lightness instead of casting shadows, and a lighter teal so links and filled buttons
 * keep their contrast. A filled primary button carries dark text here.
 */
export const darkColor: Palette = {
  canvas: '#0E1110',
  surface: '#151918',
  surfaceSunken: '#1B201F',
  ink: '#ECEEEC',
  muted: '#A2A9A6',
  primary: '#5CC9B3',
  primaryHover: '#7DD8C5',
  primaryTint: '#15302B',
  brandDeep: '#090B0A',
  onBrand: '#ECEEEC',
  onBrandMuted: '#A2A9A6',
  highlight: '#DDB15C',
  border: '#272D2B',
  fieldBorder: '#6C7471',
  success: '#5FD39A',
  successTint: '#12281D',
  warning: '#F0B660',
  warningTint: '#2C2112',
  danger: '#F28B80',
  dangerTint: '#301816',
  info: '#8DB6F7',
  infoTint: '#132338',
  focus: '#8DB0FF',
  onAccent: '#08201B'
};

/** 4-based spacing scale (03). Keys are the pixel value so call sites stay readable. */
export const space = { 4: '4px', 8: '8px', 12: '12px', 16: '16px', 24: '24px', 32: '32px', 48: '48px', 64: '64px' } as const;

export const radius = { field: '8px', card: '12px', dialog: '16px', pill: '999px' } as const;

/** Elevation is reserved for things that float: menus, dialogs, the ledger panel. */
export const shadow = {
  sm: '0 1px 2px rgb(0 0 0 / 0.04)',
  md: '0 6px 20px rgb(0 0 0 / 0.08)',
  lg: '0 24px 60px rgb(0 0 0 / 0.14)',
  focus: '0 0 0 3px rgb(47 98 216 / 0.25)'
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
  h1Size: 'clamp(28px, 3.6vw, 40px)',
  /** The home page headline only. */
  displaySize: 'clamp(36px, 5.4vw, 64px)',
  /** Dashboards use a calmer h1 so data, not the heading, leads the page (03). */
  h1DashboardSize: 'clamp(24px, 2.6vw, 30px)',
  h2Size: '22px',
  h3Size: '17px',
  headingLine: '1.3'
} as const;

export const layout = {
  /** Public content column (03). */
  contentMax: '1240px',
  /** Reading column for prose and forms. */
  proseMax: '680px',
  sidebarWidth: '240px',
  headerHeight: '64px',
  /** Side gutter that keeps content clear of the viewport edge at 360px. */
  gutter: '20px'
} as const;

export const motion = { fast: '120ms', base: '200ms', easing: 'cubic-bezier(0.2, 0, 0.2, 1)' } as const;

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
