import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseDocument } from 'yaml';
import { describe, test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN ?? 'godot';
const CLI = 'res://cli/main.gd';
const INVALID_DIR = join(ROOT, 'tests/validation/fixtures/invalid');

function invoke(specPath) {
  const relativePath = relative(ROOT, specPath);
  const result = spawnSync(GODOT, [
    '--headless',
    '--path',
    join(ROOT, 'game'),
    '--script',
    CLI,
    '--',
    'validate',
    relativePath,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.error, undefined, `could not start Godot: ${result.error?.message ?? ''}`);
  const jsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith('{'));
  assert.ok(jsonLine, `CLI did not return JSON. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { ...result, report: JSON.parse(jsonLine) };
}

const cases = [
  ['wrong-type.game.yaml', 'field.type', '/game/version'],
  ['missing-field.game.yaml', 'field.required', '/specVersion'],
  ['unknown-field.game.yaml', 'field.unknown', '/game/genre'],
  ['mutable-state.game.yaml', 'definition.state.forbidden', '/game/state'],
  ['bad-game-id.game.yaml', 'field.pattern', '/game/id'],
  ['bad-scene-id.game.yaml', 'field.pattern', '/entry/scene'],
  ['bad-locale.game.yaml', 'field.enum', '/locales/supported/1'],
  ['duplicate-locale.game.yaml', 'field.unique', '/locales/supported'],
  ['default-not-supported.game.yaml', 'field.enum', '/locales/default'],
  ['missing-locale-key.game.yaml', 'locale.key.missing', '/game/titleKey'],
  ['duplicate-module.game.yaml', 'module.duplicate', '/modules/1/id'],
  ['duplicate-key.game.yaml', 'yaml.duplicate-key', '/'],
  ['yaml-syntax.game.yaml', 'yaml.syntax', '/'],
];

describe('GameSpec local validator public CLI', () => {
  test('minimal valid GameSpec returns machine-readable ok and documented defaults', () => {
    const result = invoke(join(ROOT, 'examples/minimal.game.yaml'));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.gameId, 'example.minimal');
    assert.equal(result.report.entryScene, 'scene.main-menu');
    assert.deepEqual(result.report.modules, []);
    assert.deepEqual(result.report.locales, { default: 'en', supported: ['en'] });
  });

  test('the standalone broken example reports a useful structural diagnostic', () => {
    const result = invoke(join(ROOT, 'examples/broken.game.yaml'));
    assert.notEqual(result.status, 0);
    assert.equal(result.report.ok, false);
    const error = result.report.errors.find((entry) => entry.code === 'field.unknown');
    assert.ok(error);
    assert.equal(error.params.path, '/game/genre');
    assert.equal(error.params.actual, 'genre');
    assert.ok(error.params.expected.includes('id'));
    assert.equal(error.catalogKey, 'errors.field.unknown');
    assert.match(error.message, /genre/);
  });

  for (const [file, code, path] of cases) {
    test(`${file} is rejected through validate with ${code} at ${path}`, () => {
      const result = invoke(join(INVALID_DIR, file));
      assert.notEqual(result.status, 0, `${file} unexpectedly passed`);
      assert.equal(result.report.ok, false);
      const error = result.report.errors.find((entry) => entry.code === code && entry.params.path === path);
      assert.ok(error, `${file}: expected ${code} at ${path}; got ${JSON.stringify(result.report.errors)}`);
      assert.ok(Object.hasOwn(error.params, 'expected'), `${file}: expected parameter missing`);
      assert.ok(Object.hasOwn(error.params, 'actual'), `${file}: actual parameter missing`);
      assert.equal(error.catalogKey, `errors.${code}`);
      assert.equal(typeof error.message, 'string');
      assert.ok(error.message.length > 0);

      if (file === 'missing-locale-key.game.yaml') {
        assert.equal(error.params.locale, 'de');
        assert.equal(error.params.catalog, 'game');
        assert.equal(error.params.expected, 'game.example_translation.title');
        assert.equal(error.params.actual, 'missing');
      }
      if (file === 'mutable-state.game.yaml') {
        assert.equal(error.params.field, 'state');
        assert.equal(error.params.actual, 'state');
      }
      if (file === 'duplicate-module.game.yaml') {
        assert.equal(error.params.moduleId, 'synapse.demo.shared');
      }
      if (file === 'duplicate-key.game.yaml') {
        assert.equal(error.params.key, 'id');
        assert.ok(error.params.line > 0);
      }
      if (file === 'yaml-syntax.game.yaml') {
        assert.ok(error.params.line > 0);
        assert.ok(error.params.column > 0);
      }
    });
  }

  test('validate rejects the real cycle and reports the closed path per O-5', () => {
    const readYaml = (path) => parseDocument(readFileSync(path, 'utf8'), {
      version: '1.2', schema: 'core', uniqueKeys: true, merge: false, customTags: [],
    }).toJS();
    const game = readYaml(join(ROOT, 'examples/cycle.game.yaml'));
    const alpha = readYaml(join(ROOT, 'examples/cycle/modules/alpha.module.yaml'));
    const beta = readYaml(join(ROOT, 'examples/cycle/modules/beta.module.yaml'));
    const alphaId = alpha.module.id;
    const betaId = beta.module.id;

    assert.deepEqual(game.modules.map((entry) => entry.id), [alphaId, betaId]);
    assert.equal(alpha.dependencies[0].id, betaId);
    assert.equal(beta.dependencies[0].id, alphaId);

    const result = invoke(join(ROOT, 'examples/cycle.game.yaml'));
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.errors.length, 1);
    const [error] = result.report.errors;
    assert.equal(error.code, 'module.dependency.cycle');
    assert.match(error.params.actual, /synapse\.demo\.alpha -> synapse\.demo\.beta -> synapse\.demo\.alpha/);
  });
});
