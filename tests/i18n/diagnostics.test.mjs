import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createI18n, SUPPORTED_LOCALES } from '../../game/i18n/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATOR = join(ROOT, 'game/validation/validator.mjs');
const INVALID_SPEC = join(ROOT, 'tests/validation/fixtures/invalid/wrong-type.game.yaml');
const GRAPH_SPEC = join(ROOT, 'tests/modules/fixtures/graph.game.yaml');

function invoke(args) {
  const result = spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.error, undefined, `could not start validator: ${result.error?.message ?? ''}`);
  return {
    ...result,
    report: result.stdout.trim() ? JSON.parse(result.stdout.trim()) : undefined,
  };
}

function diagnosticIdentity(report) {
  return {
    ok: report.ok,
    errors: report.errors.map(({ code, params }) => ({
      code,
      path: params.path,
      actual: params.actual,
      expected: params.expected,
    })),
  };
}

test('ja and de diagnostics preserve English code/params/order and localize only message', () => {
  const results = Object.fromEntries(['en', 'ja', 'de'].map((locale) => [
    locale,
    invoke(['validate', INVALID_SPEC, '--locale', locale]),
  ]));
  for (const [locale, result] of Object.entries(results)) {
    assert.notEqual(result.status, 0, `${locale} unexpectedly accepted invalid fixture`);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.errors.length, 1);
    const [error] = result.report.errors;
    assert.equal(error.code, 'field.type');
    assert.equal(error.params.path, '/game/version');
    assert.equal(error.params.actual, 1);
    assert.equal(error.params.expected, 'string');
    assert.equal(error.catalogKey, 'errors.field.type');
    assert.equal(error.message, createI18n({ locale }).formatDiagnostic(error).message);
    assert.doesNotMatch(error.message, /\{[A-Za-z][A-Za-z0-9_]*\}/, `${locale} has an unresolved placeholder`);
  }

  assert.deepEqual(diagnosticIdentity(results.ja.report), diagnosticIdentity(results.en.report));
  assert.deepEqual(diagnosticIdentity(results.de.report), diagnosticIdentity(results.en.report));
  assert.notEqual(results.ja.report.errors[0].message, results.en.report.errors[0].message);
  assert.notEqual(results.de.report.errors[0].message, results.en.report.errors[0].message);
});

test('usage diagnostics use the selected locale and unsupported locale falls back to en', () => {
  for (const locale of ['ja', 'de']) {
    const result = invoke(['--locale', locale]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr.trim(), createI18n({ locale }).t('errors.cli.usage'));
  }

  const fallback = invoke(['validate', INVALID_SPEC, '--locale', 'not-a-supported-locale']);
  const english = invoke(['validate', INVALID_SPEC, '--locale', 'en']);
  assert.notEqual(fallback.status, 0);
  assert.equal(fallback.report.errors[0].message, english.report.errors[0].message);
});

test('valid module graph validation output is byte-identical in en and de', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'synapse-i18n-graph-'));
  try {
    const gameSpec = join(fixtureDir, 'graph.game.yaml');
    copyFileSync(GRAPH_SPEC, gameSpec);
    cpSync(join(ROOT, 'tests/modules/fixtures/graph/modules'), join(fixtureDir, 'modules'), { recursive: true });
    const localesDir = join(fixtureDir, 'locales');
    mkdirSync(localesDir);
    const gameCatalog = JSON.stringify({ 'game.synapse_test_graph.title': 'Graph test' });
    for (const locale of ['en', 'de']) writeFileSync(join(localesDir, `${locale}.json`), gameCatalog);

    const english = invoke(['validate', gameSpec, '--locale', 'en']);
    const german = invoke(['validate', gameSpec, '--locale', 'de']);
    assert.equal(english.status, 0, english.stderr);
    assert.equal(german.status, 0, german.stderr);
    assert.deepEqual(german.report, english.report);
    assert.equal(german.stdout, english.stdout);
    assert.equal(english.report.ok, true);
    assert.deepEqual(Object.keys(english.report).sort(), [
      'entities', 'entryScene', 'gameId', 'locales', 'moduleOrder', 'modules', 'ok', 'sceneEntries', 'version',
    ]);
    assert.deepEqual(english.report.moduleOrder, ['synapse.test.base', 'synapse.test.core', 'synapse.test.data', 'synapse.test.app', 'synapse.test.extra']);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('all S-2 registered diagnostics localize messages without changing code or params', () => {
  const registry = JSON.parse(readFileSync(join(ROOT, 'schema/error-registry.json'), 'utf8'));
  const diagnostics = [
    { code: 'scene.entry.unknown', params: { path: '/entry/scene', expected: ['scene.main-menu'], actual: 'scene.unknown' } },
    { code: 'scene.duplicate', params: { path: '/provides/sceneEntries/1/id', expected: 'unique scene ID', actual: 'scene.main-menu' } },
    { code: 'scene.resource.missing', params: { path: '/provides/sceneEntries/0/resource', expected: 'existing resource', actual: 'res://missing.tscn' } },
    { code: 'spec.file.missing', params: { path: '/spec', expected: 'readable file', actual: 'ENOENT', file: 'game.yaml' } },
    { code: 'runtime.engine.missing', params: { path: '/--run', expected: 'Godot executable', actual: 'not found', engine: 'godot' } },
    { code: 'cli.dependency.node-missing', params: { path: '/cli', expected: 'Node.js', actual: 'not found', dependency: 'node', requiredVersion: '>=20' } },
  ].map((entry) => ({ ...entry, catalogKey: `errors.${entry.code}` }));

  for (const diagnostic of diagnostics) {
    assert.ok(registry.codes.some((entry) => entry.code === diagnostic.code && entry.catalogKey === diagnostic.catalogKey));
  }

  const baselineIdentity = diagnostics.map(({ code, params, catalogKey }) => ({ code, params, catalogKey }));
  for (const locale of SUPPORTED_LOCALES) {
    const i18n = createI18n({ locale });
    const localized = diagnostics.map((diagnostic) => i18n.formatDiagnostic(diagnostic));
    assert.deepEqual(localized.map(({ code, params, catalogKey }) => ({ code, params, catalogKey })), baselineIdentity);
    for (const result of localized) {
      assert.equal(typeof result.message, 'string', `${locale} ${result.code}`);
      assert.ok(result.message.length > 0, `${locale} ${result.code}`);
      assert.doesNotMatch(result.message, /\{[A-Za-z][A-Za-z0-9_]*\}/, `${locale} ${result.code} has unresolved placeholders`);
    }
  }
});
