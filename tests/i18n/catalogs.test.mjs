import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '../../game/i18n/index.mjs';
import { evaluateCatalogs, formatReport, loadProductionCatalogs, checkProductionCatalogs } from '../../tools/i18n/check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseCatalog = JSON.parse(readFileSync(join(REPO_ROOT, 'game/validation/catalogs/en.json'), 'utf8'));

test('all eight production catalogs cover the complete diagnostic baseline', () => {
  const catalogs = loadProductionCatalogs();
  const report = checkProductionCatalogs();
  assert.equal(report.ok, true, formatReport(report));
  assert.deepEqual(Object.keys(catalogs).sort(), [...SUPPORTED_LOCALES].sort());
  assert.equal(report.baseKeys.length, 17);
  for (const locale of SUPPORTED_LOCALES) {
    const result = report.results.find((entry) => entry.locale === locale);
    assert.deepEqual([result.present, result.total, result.coverage], [17, 17, 1]);
    assert.deepEqual(result.missing, []);
  }
});

test('missing keys remain visible in reports even when coverage passes the threshold', () => {
  const base = Object.fromEntries(Array.from({ length: 40 }, (_unused, index) => [`fixture.key_${index}`, `Value {name} ${index}`]));
  const complete = Object.fromEntries(Object.keys(base).map((key) => [key, base[key]]));
  const german = { ...complete };
  delete german['fixture.key_39'];
  const report = evaluateCatalogs({
    baseCatalog: base,
    catalogs: { en: complete, de: german },
    locales: ['en', 'de'],
  });
  const output = formatReport(report);
  assert.equal(report.ok, true, output);
  assert.match(output, /de 39\/40 97\.5% missing=\[fixture\.key_39\]/);
});

test('coverage below 95 percent fails without suppressing the missing-key list', () => {
  const base = Object.fromEntries(Array.from({ length: 40 }, (_unused, index) => [`fixture.key_${index}`, `Value ${index}`]));
  const complete = Object.fromEntries(Object.keys(base).map((key) => [key, base[key]]));
  const french = { ...complete };
  delete french['fixture.key_37'];
  delete french['fixture.key_38'];
  delete french['fixture.key_39'];
  const report = evaluateCatalogs({ baseCatalog: base, catalogs: { en: complete, fr: french }, locales: ['en', 'fr'] });
  const output = formatReport(report);
  assert.equal(report.ok, false);
  assert.match(output, /fr 37\/40 92\.5% missing=\[fixture\.key_37, fixture\.key_38, fixture\.key_39\]/);
  assert.match(output, /coverage 92\.5% is below 95\.0%/);
});

test('incompatible translation parameters fail validation', () => {
  const base = { 'fixture.greeting': 'Hello {name}; count {count}.' };
  const report = evaluateCatalogs({
    baseCatalog: base,
    catalogs: {
      en: { ...base },
      fr: { 'fixture.greeting': 'Bonjour {person}; total {count}.' },
    },
    locales: ['en', 'fr'],
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.includes('fr: incompatible parameters for fixture.greeting')));
});
