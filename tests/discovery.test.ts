import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageCodes, languageMetadata } from '../services/taxonomy-service/src/language-seed.js';
import {
  languageCode,
  validateTranslation,
} from '../services/taxonomy-service/src/localization.js';
import { sourceHash } from '../services/scholar-service/src/discovery.js';
import { normalize, querySchema } from '../services/search-service/src/search.js';
import {
  createDictionary,
  installCatalog,
  localeDirection,
} from '../packages/ui/src/localization-runtime.js';
import { primaryCalendar } from '../packages/ui/src/calendar-dates.js';
test('147 canonical unique language seeds, script direction and calendar priority', () => {
  assert.equal(languageCodes.length, 147);
  assert.equal(new Set(languageCodes).size, 147);
  for (const code of languageCodes) assert.equal(Intl.getCanonicalLocales(code)[0], code);
  assert.equal(languageMetadata('fa').direction, 'RTL');
  assert.equal(languageMetadata('ar').direction, 'RTL');
  assert.equal(languageMetadata('fr').direction, 'LTR');
  assert.equal(languageMetadata('ku').direction, 'LTR');
  assert.equal(primaryCalendar('fa-IR'), 'persian');
  assert.equal(primaryCalendar('ar'), 'islamic-umalqura');
  assert.equal(primaryCalendar('fr'), 'gregory');
  assert.equal(languageCode.safeParse('en-a').success, false);
});
test('translation placeholders are preserved and source hashes ignore key order', () => {
  validateTranslation('Hello {name}: {count}', '{count} · سلام {name}');
  assert.throws(() => validateTranslation('{name}', '{nom}'));
  assert.equal(sourceHash({ a: 'x', b: 'y' }), sourceHash({ b: 'y', a: 'x' }));
  assert.notEqual(sourceHash({ a: 'x' }), sourceHash({ a: 'z' }));
});
test('search normalizes Persian and Arabic and rejects arbitrary DSL and unbounded pages', () => {
  assert.equal(normalize('  كودك يارِی  '), 'کودک یاری');
  assert.equal(normalize('إرشاد أُسري'), 'ارشاد اسری');
  assert.equal(normalize('Family COUNSELING'), 'family counseling');
  assert.equal(querySchema.safeParse({ q: 'test', size: 10000 }).success, false);
  assert.equal(querySchema.safeParse({ limit: 1000 }).success, false);
});
test('database catalogue edits override seeds and missing locale text uses English without leakage', () => {
  const dictionary = createDictionary('test', {
    en: { title: 'Original', body: 'English fallback' },
    fa: { title: 'قدیمی', body: 'فارسی' },
  });
  const catalog = {
    language: { code: 'fr', direction: 'LTR' as const, name_en: 'French', native_name: 'Français' },
    revision: 1,
    values: { 'test.title': 'Bonjour' },
    fallback_keys: ['test.body'],
  };
  installCatalog(catalog);
  assert.equal(dictionary.fr!.title, 'Bonjour');
  assert.equal(dictionary.fr!.body, 'English fallback');
  assert.equal(dictionary.fa.title, 'قدیمی');
  installCatalog({ ...catalog, revision: 2, values: { 'test.title': 'Modifié' } });
  assert.equal(dictionary.fr!.title, 'Modifié');
  assert.equal(localeDirection('ar'), 'rtl');
  assert.equal(localeDirection('fr'), 'ltr');
});
