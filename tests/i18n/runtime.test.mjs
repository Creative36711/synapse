import assert from 'node:assert/strict';
import test from 'node:test';

import { createI18n, interpolate, loadCatalogs, SUPPORTED_LOCALES } from '../../game/i18n/index.mjs';

const catalogs = loadCatalogs();

test('runtime catalogs contain every declared locale and English is the default', () => {
  assert.deepEqual(Object.keys(catalogs).sort(), [...SUPPORTED_LOCALES].sort());
  const i18n = createI18n({ catalogs });
  assert.equal(i18n.locale, 'en');
  assert.equal(i18n.t('errors.cli.usage'), catalogs.en['errors.cli.usage']);
});

test('unsupported language selection falls back to the default English catalog', () => {
  const i18n = createI18n({ locale: 'es-MX', catalogs });
  assert.equal(i18n.locale, 'en');
  assert.equal(i18n.t('errors.cli.usage'), catalogs.en['errors.cli.usage']);
  assert.equal(i18n.setLocale('ru'), 'ru');
  assert.equal(i18n.locale, 'ru');
});

test('diagnostic translation substitutes parameters without changing codes or params', () => {
  const params = Object.freeze({ path: '/game/id', actual: 'number', expected: 'string' });
  const diagnostic = Object.freeze({
    code: 'field.type',
    params,
    catalogKey: 'errors.field.type',
    message: 'Original diagnostic message',
  });
  const i18n = createI18n({ locale: 'ru', catalogs });
  const translated = i18n.formatDiagnostic(diagnostic);

  assert.equal(translated.code, 'field.type');
  assert.equal(translated.catalogKey, 'errors.field.type');
  assert.strictEqual(translated.params, params);
  assert.equal(diagnostic.message, 'Original diagnostic message');
  assert.match(translated.message, /\/game\/id/);
  assert.match(translated.message, /number/);
  assert.match(translated.message, /string/);
  assert.ok(!translated.message.includes('{path}'));
});

test('parameter interpolation serializes structured values deterministically', () => {
  assert.equal(interpolate('Expected {expected}; actual {actual}.', {
    expected: ['one', 'two'],
    actual: { value: 3 },
  }), 'Expected ["one","two"]; actual {"value":3}.');
});

test('a missing key in a supported locale is not silently replaced with English', () => {
  const i18n = createI18n({
    locale: 'fr',
    catalogs: { en: { 'errors.sample': 'English text' }, fr: {} },
  });
  assert.equal(i18n.t('errors.sample'), undefined);
  assert.equal(i18n.formatDiagnostic({ code: 'sample', catalogKey: 'errors.sample', params: {} }).message, undefined);
});
