import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LOCALE, LOCALES, directionOf, formatDate, formatMinorUnits, isLocale, localePath, splitLocale, strings, translator } from '@tamkeen/ui';

/**
 * Locale is part of the path (04-INFORMATION-ARCHITECTURE). These are the pure helpers behind that
 * rule; the redirect itself lives in apps/web/proxy.ts and is exercised against the running server.
 */

test('only the supported locales are accepted, and Arabic is the default', () => {
  assert.deepEqual([...LOCALES], ['ar', 'en']);
  assert.equal(DEFAULT_LOCALE, 'ar');
  assert.equal(isLocale('ar'), true);
  assert.equal(isLocale('en'), true);
  for (const value of ['fr', 'AR', 'en-GB', '', undefined, 'app', '../ar']) {
    assert.equal(isLocale(value as string | undefined), false, `${String(value)} must not be treated as a locale`);
  }
});

test('direction follows the locale rather than being set per page', () => {
  assert.equal(directionOf('ar'), 'rtl');
  assert.equal(directionOf('en'), 'ltr');
});

test('localePath builds prefixed routes without doubling or dropping separators', () => {
  assert.equal(localePath('ar', '/app'), '/ar/app');
  assert.equal(localePath('en', '/app/settings'), '/en/app/settings');
  assert.equal(localePath('ar', '/'), '/ar');
  // Callers sometimes pass a bare segment; it must not silently produce a relative path.
  assert.equal(localePath('ar', 'app'), '/ar/app');
  assert.equal(localePath('en', '/login?returnTo=%2Fapp'), '/en/login?returnTo=%2Fapp');
});

test('splitLocale recovers the locale and the locale-free path, so a language switch stays on the page', () => {
  assert.deepEqual(splitLocale('/ar/app/settings'), { locale: 'ar', path: '/app/settings' });
  assert.deepEqual(splitLocale('/en/design/explore'), { locale: 'en', path: '/design/explore' });
  assert.deepEqual(splitLocale('/ar'), { locale: 'ar', path: '/' });
  // A path with no locale falls back rather than mistaking its first segment for one.
  assert.deepEqual(splitLocale('/app'), { locale: 'ar', path: '/app' });
  assert.deepEqual(splitLocale('/'), { locale: 'ar', path: '/' });
});

test('round-tripping a path through localePath and splitLocale is stable', () => {
  for (const locale of LOCALES) {
    for (const path of ['/app', '/app/settings', '/design/explore', '/org/abc/team', '/']) {
      assert.deepEqual(splitLocale(localePath(locale, path)), { locale, path }, `${locale} ${path} did not round-trip`);
    }
  }
});

test('every interface string exists in both locales and neither is left as a copy of the other', () => {
  const entries = Object.entries(strings);
  assert.equal(entries.length > 20, true, 'the shared dictionary should cover the chrome and the states');
  for (const [key, value] of entries) {
    assert.equal(typeof value.ar === 'string' && value.ar.trim().length > 0, true, `${key} is missing Arabic`);
    assert.equal(typeof value.en === 'string' && value.en.trim().length > 0, true, `${key} is missing English`);
    // An untranslated placeholder is the common i18n failure; Arabic text must contain Arabic script.
    if (key !== 'brand' && key !== 'changeLanguage') {
      assert.match(value.ar, /[؀-ۿ]/, `${key} has no Arabic script in its Arabic string`);
    }
  }
});

test('the translator returns the requested locale', () => {
  assert.equal(translator('ar')('save'), strings.save.ar);
  assert.equal(translator('en')('save'), strings.save.en);
  // The language control shows the language it switches to, so the two are deliberately crossed.
  assert.equal(translator('ar')('changeLanguage'), 'English');
  assert.equal(translator('en')('changeLanguage'), 'العربية');
});

test('dates render per locale from a stored UTC instant, using Gregorian Latin digits in Arabic', () => {
  const instant = '2026-10-04T09:30:00.000Z';
  const arabic = formatDate(instant, 'ar');
  const english = formatDate(instant, 'en');
  assert.equal(arabic.length > 0, true);
  assert.equal(english.length > 0, true);
  assert.notEqual(arabic, english, 'the two locales should not render identically');
  // Financial records are reconciled against bank statements, so the calendar stays Gregorian
  // and the digits stay Latin for copy-paste into those systems.
  assert.match(arabic, /2026/);
  assert.match(english, /2026/);
  assert.equal(formatDate('not-a-date', 'ar'), '', 'an unparseable value must render as empty, not as Invalid Date');
});

test('money renders unambiguously, with a decimal point that cannot be mistaken for a grouping mark', () => {
  // Regression: the Arabic separators U+066B and U+066C render as near-identical comma glyphs in
  // the fallback Arabic fonts, so 1,000,000.00 appeared as "1,000,000,00" and could be misread by
  // a factor of a hundred. Latin separators are used in both locales for exactly this reason.
  assert.equal(formatMinorUnits('10000000'), '100,000.00');
  assert.equal(formatMinorUnits('6420000'), '64,200.00');
  assert.equal(formatMinorUnits('100000000'), '1,000,000.00');
  assert.equal(formatMinorUnits('0'), '0.00');
  assert.equal(formatMinorUnits('5'), '0.05');
  assert.equal(formatMinorUnits('50'), '0.50');
  assert.equal(formatMinorUnits('100'), '1.00');

  for (const rendered of [formatMinorUnits('100000000'), formatMinorUnits('1234567890')]) {
    assert.equal(rendered.includes('\u066B'), false, 'the Arabic decimal separator must not be used');
    assert.equal(rendered.includes('\u066C'), false, 'the Arabic thousands separator must not be used');
    // Exactly one decimal point, and it is a full stop rather than a second comma.
    assert.equal(rendered.split('.').length, 2, 'there must be exactly one decimal separator');
  }
});

test('a negative amount uses a real minus sign and zero never renders as negative zero', () => {
  assert.equal(formatMinorUnits('-150000'), '\u22121,500.00');
  assert.equal(formatMinorUnits('-0'), '0.00');
  assert.equal(formatMinorUnits('-5'), '\u22120.05');
});

test('formatting never parses the amount into a JavaScript number', () => {
  // 08-FINANCIAL-SYSTEM: minor units travel as strings so precision is never lost. A value beyond
  // Number.MAX_SAFE_INTEGER must still render digit for digit.
  const huge = '90071992547409910';
  assert.equal(formatMinorUnits(huge), '900,719,925,474,099.10');
  assert.equal(formatMinorUnits(huge).replace(/\D/g, ''), huge);
});

test('a zero-exponent currency renders without a decimal part', () => {
  assert.equal(formatMinorUnits('12345', 0), '12,345');
  assert.equal(formatMinorUnits('1234567', 3), '1,234.567');
});
