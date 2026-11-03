import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = join(ROOT, 'tests/modules/fixtures');
const INSTALLED_GODOT = join(process.env.GODOT_HOME ?? '/tmp/synapse-godot', 'bin/godot');
const GODOT = process.env.GODOT_BIN
  ?? (existsSync(INSTALLED_GODOT) ? INSTALLED_GODOT : 'godot');
const CLI = 'res://cli/main.gd';

function invoke(command, specPath) {
  const result = spawnSync(GODOT, [
    '--headless',
    '--path',
    join(ROOT, 'game'),
    '--script',
    CLI,
    '--',
    command,
    relative(ROOT, specPath),
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.error, undefined, `could not start Godot: ${result.error?.message ?? ''}`);
  const jsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith('{'));
  assert.ok(jsonLine, `CLI did not return JSON. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { ...result, report: JSON.parse(jsonLine) };
}

function fixture(name) {
  return join(FIXTURES, name);
}

describe('Synapse module dependency resolver public Godot CLI', () => {
  test('validate rejects the real cycle and reports the closed alpha -> beta -> alpha path', () => {
    const result = invoke('validate', join(ROOT, 'examples/cycle.game.yaml'));
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, false);
    const error = result.report.errors.find((entry) => entry.code === 'module.dependency.cycle');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.deepEqual(error.params.cycle, [
      'synapse.demo.alpha',
      'synapse.demo.beta',
      'synapse.demo.alpha',
    ]);
    assert.match(error.message, /synapse\.demo\.alpha -> synapse\.demo\.beta -> synapse\.demo\.alpha/);
  });

  test('resolve accepts the minimal empty graph and repeats the same full order', () => {
    const spec = join(ROOT, 'examples/minimal.game.yaml');
    const first = invoke('resolve', spec);
    const second = invoke('resolve', spec);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(first.report.ok, true);
    assert.deepEqual(first.report.order, []);
    assert.deepEqual(second.report.order, first.report.order);
  });

  test('orders a nontrivial dependency DAG dependency-first with lexical tie breaking', () => {
    const spec = fixture('graph.game.yaml');
    const first = invoke('resolve', spec);
    const second = invoke('resolve', spec);
    const expected = [
      'synapse.test.base',
      'synapse.test.core',
      'synapse.test.data',
      'synapse.test.app',
      'synapse.test.extra',
    ];
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(first.report.ok, true);
    assert.deepEqual(first.report.order, expected);
    assert.deepEqual(second.report.order, expected);
    assert.deepEqual(first.report.modules.map(({ id }) => id), expected);
  });

  test('chooses the highest version satisfying the intersection of all constraints', () => {
    const result = invoke('resolve', fixture('version-select.game.yaml'));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, true);
    assert.deepEqual(result.report.modules.find(({ id }) => id === 'synapse.test.shared'), {
      id: 'synapse.test.shared',
      version: '1.7.0',
    });
  });

  test('reports a missing required root module with the registered diagnostic', () => {
    const result = invoke('resolve', fixture('missing.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.dependency.missing');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.requiredBy, 'synapse.test.missing');
    assert.equal(error.params.constraint, '^1.0.0');
    assert.equal(error.params.actual, 'synapse.test.absent');
    assert.equal(error.catalogKey, 'errors.module.dependency.missing');
    assert.ok(error.message.length > 0);
  });

  test('reports a missing transitive dependency and names its requiring module', () => {
    const result = invoke('resolve', fixture('missing-transitive.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.dependency.missing');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.requiredBy, 'synapse.test.parent');
    assert.equal(error.params.constraint, '^2.0.0');
  });

  test('rejects duplicate selected module references', () => {
    const result = invoke('resolve', fixture('duplicate.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.duplicate');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.moduleId, 'synapse.test.repeat');
  });

  test('rejects duplicate dependency declarations instead of silently deduplicating', () => {
    const result = invoke('resolve', fixture('duplicate-dependency.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.duplicate');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.path, '/dependencies/1/id');
    assert.equal(error.params.moduleId, 'synapse.test.child');
  });

  test('reports available versions when no candidate satisfies the requested range', () => {
    const result = invoke('resolve', fixture('version.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.version.unsatisfied');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.constraint, '^3.0.0');
    assert.deepEqual(error.params.available, ['2.4.1', '1.2.0']);
    assert.deepEqual(Object.keys(error.params), ['path', 'expected', 'actual', 'constraint', 'available']);
  });

  test('rejects a declared conflict only when a selected version matches its range', () => {
    const result = invoke('resolve', fixture('conflict.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'module.conflict');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.conflictId, 'synapse.test.beta');
    assert.equal(error.params.constraint, '^1.0.0');
    assert.equal(error.catalogKey, 'errors.module.conflict');
  });

  test('rejects an entry scene not provided by any selected module', () => {
    const result = invoke('resolve', fixture('unresolved.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'ref.unresolved');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.refKind, 'scene');
    assert.equal(error.params.actual, 'scene.not-provided');
    assert.deepEqual(error.params.providedBy, []);
  });

  test('omits a missing optional module without converting it to an error', () => {
    const result = invoke('resolve', fixture('optional.game.yaml'));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, true);
    assert.deepEqual(result.report.order, []);
    assert.deepEqual(result.report.errors ?? [], []);
  });
});
