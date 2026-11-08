import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '../../game/i18n/index.mjs';
import { evaluateCatalogs, formatReport, loadProductionCatalogs, checkProductionCatalogs, checkExampleCatalogs } from '../../tools/i18n/check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseCatalog = JSON.parse(readFileSync(join(REPO_ROOT, 'game/validation/catalogs/en.json'), 'utf8'));

test('all eight production catalogs cover registered diagnostics and mini-game UI', () => {
  const catalogs = loadProductionCatalogs();
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, 'schema/error-registry.json'), 'utf8'));
  const report = checkProductionCatalogs();
  assert.equal(report.ok, true, formatReport(report));
  assert.deepEqual(Object.keys(catalogs).sort(), [...SUPPORTED_LOCALES].sort());
  assert.equal(report.baseKeys.length, 30);
  for (const entry of registry.codes) assert.ok(report.baseKeys.includes(`errors.${entry.code}`));
  for (const key of [
    'ui.minigame.score', 'ui.minigame.win_condition', 'ui.minigame.controls_hint',
    'ui.minigame.button.start', 'ui.minigame.button.pause', 'ui.minigame.button.restart',
  ]) assert.ok(report.baseKeys.includes(key));
  for (const locale of SUPPORTED_LOCALES) {
    const result = report.results.find((entry) => entry.locale === locale);
    assert.deepEqual([result.present, result.total, result.coverage], [30, 30, 1]);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), report.baseKeys);
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

test('production catalogs reject missing keys even when coverage would exceed 95 percent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'synapse-production-i18n-'));
  try {
    const catalogs = loadProductionCatalogs();
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = { ...catalogs[locale] };
      if (locale === 'de') delete catalog['errors.scene.entry.unknown'];
      writeFileSync(join(directory, `${locale}.json`), JSON.stringify(catalog));
    }
    const report = checkProductionCatalogs({ directory });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.includes('de: production key set must match English')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Russian and Simplified Chinese example catalogs share UI, game, and entity keys', () => {
  const report = checkExampleCatalogs();
  assert.equal(report.ok, true, JSON.stringify(report.issues));
  assert.deepEqual(report.results.map(({ locale, present, total }) => [locale, present, total]), [
    ['en', 14, 14], ['ru', 14, 14], ['zh-Hans', 14, 14],
  ]);
  for (const namespace of ['ui.', 'game.', 'entity.']) {
    assert.ok(report.baseKeys.some((key) => key.startsWith(namespace)));
  }
});

test('example catalog placeholder mismatch fails the same i18n-check coverage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'synapse-example-i18n-'));
  try {
    for (const locale of ['en', 'ru', 'zh-Hans']) {
      const source = JSON.parse(readFileSync(join(REPO_ROOT, 'examples/locales', `${locale}.json`), 'utf8'));
      if (locale === 'ru') source['ui.minigame.score'] = 'Счёт: {points}';
      writeFileSync(join(directory, `${locale}.json`), JSON.stringify(source));
    }
    const report = checkExampleCatalogs({ directory });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.includes('incompatible parameters for ui.minigame.score')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
