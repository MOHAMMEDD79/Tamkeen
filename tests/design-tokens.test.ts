import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { color, contrastRatio, tokenNames, tokensCss } from '@tamkeen/ui';

const stylesheet = readFileSync(fileURLToPath(new URL('../packages/ui/src/styles.css', import.meta.url)), 'utf8');

/**
 * 03-DESIGN-SYSTEM calls the palette a starting point and requires every combination that actually
 * ships to be tested before it is adopted. These are those combinations, not a sample.
 */
const textPairs: Array<[string, string, string]> = [
  ['primary text on canvas', color.ink, color.canvas],
  ['primary text on surface', color.ink, color.surface],
  ['primary text on sunken surface', color.ink, color.surfaceSunken],
  ['secondary text on canvas', color.muted, color.canvas],
  ['secondary text on surface', color.muted, color.surface],
  ['secondary text on sunken surface', color.muted, color.surfaceSunken],
  ['link on surface', color.primary, color.surface],
  ['link on canvas', color.primary, color.canvas],
  ['link on primary tint', color.primary, color.primaryTint],
  ['label on primary button', color.onAccent, color.primary],
  ['label on hovered primary button', color.onAccent, color.primaryHover],
  ['success text on its tint', color.success, color.successTint],
  ['warning text on its tint', color.warning, color.warningTint],
  ['danger text on its tint', color.danger, color.dangerTint],
  ['info text on its tint', color.info, color.infoTint],
  ['danger outline button on surface', color.danger, color.surface],
  ['white text on the deep brand ground', color.onAccent, color.brandDeep],
  ['secondary text on the deep brand ground', color.onBrandMuted, color.brandDeep],
  ['highlight text on the deep brand ground', color.highlight, color.brandDeep],
  ['label on a highlight button', color.brandDeep, color.highlight]
];

/** 1.4.11 applies to control boundaries and to the focus indicator, at 3:1. */
const uiPairs: Array<[string, string, string]> = [
  ['field border on surface', color.fieldBorder, color.surface],
  ['field border on canvas', color.fieldBorder, color.canvas],
  ['field border on sunken surface', color.fieldBorder, color.surfaceSunken],
  ['focus ring on surface', color.focus, color.surface],
  ['focus ring on canvas', color.focus, color.canvas],
  ['focus ring on primary tint', color.focus, color.primaryTint],
  ['meter fill on its track', color.primary, color.surfaceSunken]
];

test('every text colour pair that ships meets WCAG 2.2 AA at 4.5:1', () => {
  const failures = textPairs
    .map(([name, foreground, background]) => ({ name, ratio: contrastRatio(foreground, background) }))
    .filter(result => result.ratio < 4.5)
    .map(result => `${result.name} = ${result.ratio.toFixed(2)}:1`);
  assert.deepEqual(failures, [], 'text contrast below AA');
});

test('control boundaries and the focus indicator meet WCAG 2.2 at 3:1', () => {
  const failures = uiPairs
    .map(([name, foreground, background]) => ({ name, ratio: contrastRatio(foreground, background) }))
    .filter(result => result.ratio < 3)
    .map(result => `${result.name} = ${result.ratio.toFixed(2)}:1`);
  assert.deepEqual(failures, [], 'non-text contrast below 3:1');
});

test('the focus ring is separated from the control it outlines rather than abutting its fill', () => {
  // The ring and the teal primary have almost the same luminance (1.17:1), so a ring drawn flush
  // against a primary button would be hard to see. outline-offset keeps a background-coloured gap
  // between them, which is why the ring only ever needs contrast against a page background.
  assert.equal(/:focus-visible\s*\{[^}]*outline-offset:\s*[1-9]/.test(stylesheet), true, 'the focus ring needs an offset so it never sits directly on a filled control');
  assert.equal(contrastRatio(color.focus, color.surface) >= 3, true);
  assert.equal(contrastRatio(color.focus, color.canvas) >= 3, true);
});

test('the stylesheet only reads custom properties the token layer defines', () => {
  const defined = new Set(tokenNames());
  const used = new Set([...stylesheet.matchAll(/var\((--tmk-[a-z0-9-]+)/g)].map(match => match[1] as string));
  const undefinedNames = [...used].filter(name => !defined.has(name)).sort();
  assert.deepEqual(undefinedNames, [], 'stylesheet references undefined tokens');
});

test('the token layer has no property the stylesheet never uses', () => {
  // Tokens are a contract, not a dumping ground: an unused one is either dead or a missed rule.
  const used = new Set([...stylesheet.matchAll(/var\((--tmk-[a-z0-9-]+)/g)].map(match => match[1] as string));
  // Breakpoints are consumed by media queries, not var(); they are not emitted as properties.
  const unused = tokenNames().filter(name => !used.has(name)).sort();
  assert.deepEqual(unused, [], 'tokens defined but never used');
});

test('direction is handled with logical properties, not mirrored physical rules', () => {
  const body = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  // A physical margin or padding in a bidirectional layout is the classic RTL defect.
  const physical = [...body.matchAll(/(?:^|[\s;{])((?:margin|padding|border)-(?:left|right)\s*:)/g)].map(match => match[1] as string);
  assert.deepEqual([...new Set(physical)].sort(), [], 'use inline-start/inline-end instead');
  assert.equal(/\btext-align\s*:\s*(?:left|right)\b/.test(body), false, 'use text-align: start/end');
  assert.equal(body.includes('inset-inline-start') || body.includes('inline-start'), true, 'logical properties should be present');
});

test('the token stylesheet declares a visible focus indicator and never removes one', () => {
  assert.equal(/:focus-visible\s*\{[^}]*outline:\s*3px solid/.test(stylesheet), true, 'a 3px focus ring must be defined');
  assert.equal(/outline\s*:\s*(?:none|0)\b/.test(stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'focus outlines must never be removed');
});

test('tokensCss emits a single root block with every family represented', () => {
  const css = tokensCss();
  assert.equal(css.startsWith(':root{'), true);
  assert.equal(css.endsWith('}'), true);
  for (const family of ['--tmk-color-', '--tmk-space-', '--tmk-radius-', '--tmk-type-', '--tmk-layout-', '--tmk-motion-']) {
    assert.equal(css.includes(family), true, `${family} missing from the token layer`);
  }
  // Injected into a document, so it must not be able to close its own style element.
  assert.equal(/<\/?script|<\/style/i.test(css), false);
});

test('touch targets and the phone gutter satisfy the stated responsive floor', () => {
  // 03 targets 360px with no horizontal page scroll; a 44px minimum keeps controls reachable.
  assert.equal(/min-block-size:\s*44px/.test(stylesheet), true, 'interactive controls need a 44px minimum');
  assert.equal(/@media \(max-width: 599px\)/.test(stylesheet), true, 'a phone breakpoint must exist');
  assert.equal(stylesheet.includes('overflow-x: auto'), true, 'wide tables need a scroll region rather than a clipped page');
});

test('a link styled as a button keeps its own label colour on hover', () => {
  /*
   * A real failure this catches: `a:hover` has specificity (0,1,1) and beats `.tmk-button--primary`
   * at (0,1,0), so hovering a link-button painted the label in the link colour over the button's
   * own background — a primary button became dark green on dark green and the label disappeared.
   * Every variant that sets a colour must restate it for the anchor hover state.
   */
  const variants = [...stylesheet.matchAll(/^\.tmk-button--([a-z]+)\s*\{[^}]*\bcolor:/gm)].map(match => match[1]);
  assert.equal(variants.length > 0, true, 'the stylesheet must define button variants');
  for (const variant of variants) {
    const guard = `a.tmk-button--${variant}:hover`;
    assert.equal(stylesheet.includes(guard), true, `a.tmk-button--${variant}:hover must restate the label colour`);
  }
});

test('an opaque identifier is allowed to break instead of clipping or widening the page', () => {
  /*
   * Two failures from one screen in the PART-07 visual pass, both from the same cause: an identifier
   * has no spaces, so a browser will not break it. Inside a stat card it overflowed and the start of
   * the string was clipped with no ellipsis — the screen read `po_0716…` for a value that was
   * actually `simpo_0716…`, so anyone quoting it to support would read out an id that does not
   * exist. Inside a hint paragraph the same string pushed the page past a 360px viewport.
   *
   * The rule is global because every identifier in this product is marked up as `code`.
   */
  const start = stylesheet.indexOf('\ncode {');
  assert.notEqual(start, -1, 'the stylesheet must style `code` globally');
  const declaration = stylesheet.slice(start, stylesheet.indexOf('}', start));
  assert.equal(declaration.includes('overflow-wrap: anywhere'), true,
    'an opaque identifier must be allowed to break, or it clips in a card and widens the page on a phone');
});
