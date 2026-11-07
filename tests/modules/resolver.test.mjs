import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
    specPath,
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

function createSceneBuild(entryScene, modules) {
  const root = mkdtempSync(join(tmpdir(), 'synapse-s3-resolver-'));
  const gameDir = join(root, 'game');
  const moduleDir = join(gameDir, 'spec', 'modules');
  const localeDir = join(gameDir, 'locales');
  mkdirSync(moduleDir, { recursive: true });
  mkdirSync(localeDir, { recursive: true });
  copyFileSync(join(ROOT, 'examples/locales/en.json'), join(localeDir, 'en.json'));
  const specPath = join(gameDir, 'spec.game.yaml');
  const gameModules = modules.map(({ id }) => `  - id: ${JSON.stringify(id)}\n    version: "1.0.0"`);
  writeFileSync(specPath, [
    'specVersion: "1.0"',
    'game:',
    '  id: "example.scenetest"',
    '  version: "0.1.0"',
    '  titleKey: "game.example_minimal.title"',
    'entry:',
    `  scene: ${JSON.stringify(entryScene)}`,
    ...(gameModules.length ? ['modules:', ...gameModules] : []),
    '',
  ].join('\n'));

  for (const [index, module] of modules.entries()) {
    const lines = [
      'specVersion: "1.0"',
      'module:',
      `  id: ${JSON.stringify(module.id)}`,
      '  version: "1.0.0"',
      '  titleKey: "module.synapse_test_scene.title"',
      'requires:',
      '  spec: "1.0"',
      '  engine: "*"',
      'provides:',
      ...((module.providesScenes ?? []).length
        ? ['  scenes:', ...(module.providesScenes ?? []).map((id) => `    - ${JSON.stringify(id)}`)]
        : ['  scenes: []']),
    ];
    if (module.sceneEntries?.length) {
      lines.push('  sceneEntries:');
      for (const scene of module.sceneEntries) {
        lines.push(`    - id: ${JSON.stringify(scene.id)}`);
        lines.push(`      resource: ${JSON.stringify(scene.resource)}`);
      }
    }
    writeFileSync(join(moduleDir, `${index}.module.yaml`), `${lines.join('\n')}\n`);
  }
  return { root, specPath };
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

  test('rejects an entry scene absent from the core and resolved module registry', () => {
    const result = invoke('resolve', fixture('unresolved.game.yaml'));
    assert.notEqual(result.status, 0);
    const error = result.report.errors.find((entry) => entry.code === 'scene.entry.unknown');
    assert.ok(error, JSON.stringify(result.report.errors));
    assert.equal(error.params.path, '/entry/scene');
    assert.equal(error.params.sceneId, 'scene.not-provided');
    assert.equal(error.params.actual, 'scene.not-provided');
    assert.deepEqual(error.params.expected, ['scene.main-menu', 'scene.state-motion']);
  });

  test('combines resolved module scene entries with core scenes without core registrations', () => {
    const module = {
      id: 'synapse.test.sceneauthor',
      providesScenes: ['scene.test-author'],
      sceneEntries: [{ id: 'scene.test-author', resource: 'res://runtime/scenes/main_menu.tscn' }],
    };
    const build = createSceneBuild('scene.test-author', [module]);
    const coreBuild = createSceneBuild('scene.main-menu', [module]);
    try {
      const result = invoke('resolve', build.specPath);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(result.report.ok, true);
      assert.deepEqual(result.report.sceneEntries, [{
        id: 'scene.test-author',
        resource: 'res://runtime/scenes/main_menu.tscn',
        moduleId: 'synapse.test.sceneauthor',
      }]);

      const coreResult = invoke('resolve', coreBuild.specPath);
      assert.equal(coreResult.status, 0, `${coreResult.stdout}\n${coreResult.stderr}`);
      assert.equal(coreResult.report.entryScene, 'scene.main-menu');
    } finally {
      rmSync(build.root, { recursive: true, force: true });
      rmSync(coreBuild.root, { recursive: true, force: true });
    }
  });

  test('reports scene.entry.unknown when a scene entry is not listed in provides.scenes', () => {
    const build = createSceneBuild('scene.main-menu', [{
      id: 'synapse.test.scenemismatch',
      providesScenes: ['scene.present'],
      sceneEntries: [{ id: 'scene.orphan', resource: 'res://runtime/scenes/main_menu.tscn' }],
    }]);
    try {
      const result = invoke('resolve', build.specPath);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const error = result.report.errors[0];
      assert.equal(error.code, 'scene.entry.unknown');
      assert.deepEqual(error.params, {
        path: '/provides/sceneEntries/0/id',
        expected: ['scene.present'],
        actual: 'scene.orphan',
        sceneId: 'scene.orphan',
        moduleId: 'synapse.test.scenemismatch',
      });
    } finally {
      rmSync(build.root, { recursive: true, force: true });
    }
  });

  test('rejects duplicate scene IDs between resolved module manifests', () => {
    const build = createSceneBuild('scene.duplicate', [
      {
        id: 'synapse.test.scenealpha',
        providesScenes: ['scene.duplicate'],
        sceneEntries: [{ id: 'scene.duplicate', resource: 'res://runtime/scenes/main_menu.tscn' }],
      },
      {
        id: 'synapse.test.scenebeta',
        providesScenes: ['scene.duplicate'],
        sceneEntries: [{ id: 'scene.duplicate', resource: 'res://runtime/scenes/main_menu.tscn' }],
      },
    ]);
    try {
      const result = invoke('resolve', build.specPath);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const error = result.report.errors.find((entry) => entry.code === 'scene.duplicate');
      assert.ok(error, JSON.stringify(result.report.errors));
      assert.equal(error.params.sceneId, 'scene.duplicate');
      assert.deepEqual(error.params.modules, ['synapse.test.scenealpha', 'synapse.test.scenebeta']);
    } finally {
      rmSync(build.root, { recursive: true, force: true });
    }
  });

  test('rejects a module mapping that duplicates a core scene ID', () => {
    const build = createSceneBuild('scene.main-menu', [{
      id: 'synapse.test.sceneoverride',
      providesScenes: ['scene.main-menu'],
      sceneEntries: [{ id: 'scene.main-menu', resource: 'res://runtime/scenes/main_menu.tscn' }],
    }]);
    try {
      const result = invoke('resolve', build.specPath);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const error = result.report.errors.find((entry) => entry.code === 'scene.duplicate');
      assert.ok(error, JSON.stringify(result.report.errors));
      assert.deepEqual(error.params.modules, ['core', 'synapse.test.sceneoverride']);
    } finally {
      rmSync(build.root, { recursive: true, force: true });
    }
  });

  test('reports scene.resource.missing for a missing res:// scene file', () => {
    const build = createSceneBuild('scene.test-missing', [{
      id: 'synapse.test.scenemissing',
      providesScenes: ['scene.test-missing'],
      sceneEntries: [{ id: 'scene.test-missing', resource: 'res://modules/no-such-scene.tscn' }],
    }]);
    try {
      const result = invoke('resolve', build.specPath);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const error = result.report.errors[0];
      assert.equal(error.code, 'scene.resource.missing');
      assert.deepEqual(error.params, {
        path: '/provides/sceneEntries/0/resource',
        expected: 'an existing res://…tscn file',
        actual: 'res://modules/no-such-scene.tscn',
        sceneId: 'scene.test-missing',
        resource: 'res://modules/no-such-scene.tscn',
      });
    } finally {
      rmSync(build.root, { recursive: true, force: true });
    }
  });

  test('omits a missing optional module without converting it to an error', () => {
    const result = invoke('resolve', fixture('optional.game.yaml'));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.report.ok, true);
    assert.deepEqual(result.report.order, []);
    assert.deepEqual(result.report.errors ?? [], []);
  });
});
