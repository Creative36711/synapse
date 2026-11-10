import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function findGodotExecutable() {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN;
  for (const directory of (process.env.PATH ?? '').split(':')) {
    if (!directory) continue;
    const candidate = join(directory, 'godot');
    if (existsSync(candidate)) return candidate;
  }
  return 'godot';
}

const GODOT = findGodotExecutable();
const GODOT_PATH = `${dirname(GODOT)}:${process.env.PATH ?? ''}`;
const TEST_DIR = '/tmp/synapse-k33-cli-test';
const STATE_TEST_DIR = '/tmp/synapse-k39-state-test';
const STATE_MOTION_TEST_DIR = '/tmp/synapse-k42-state-motion-test';
const ARENA_TEST_DIR = '/tmp/synapse-k44-arena-test';
const SHOT_PATH = join(TEST_DIR, 'minimal.png');
const SUPPORTED_LOCALES = ['en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko'];

function runCli(args, envOverrides = {}) {
  return spawnSync(GODOT, [
    '--headless', '--path', 'game', '--script', 'res://cli/main.gd', '--', ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: envOverrides.PATH ?? GODOT_PATH,
      SYNAPSE_GODOT_MODE: 'offscreen',
      ...envOverrides,
    },
  });
}

function assertGodotProcessStarted(result) {
  if (result.error?.code !== 'ENOENT') return;
  const record = {
    catalogKey: 'errors.runtime.engine.missing',
    code: 'runtime.engine.missing',
    params: {
      actual: 'not_found',
      engine: 'Godot',
      expected: 'Godot executable on PATH',
      path: '/run',
    },
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
  assert.fail(`runtime.engine.missing: ${JSON.stringify(record.params)}`);
}

function machineRecord(stdout) {
  const line = stdout.split(/\r?\n/).find((item) => item.trim().startsWith('{'));
  assert.ok(line, `expected a machine-readable JSON record in stdout:\n${stdout}`);
  return JSON.parse(line);
}

function assertCanonicalObjectKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalObjectKeys(item);
    return;
  }
  if (value && typeof value === 'object') {
    assert.deepEqual(Object.keys(value), Object.keys(value).sort(), 'object keys must be sorted canonically');
    for (const item of Object.values(value)) assertCanonicalObjectKeys(item);
  }
}

function assertRelativeNodePaths(node) {
  assert.ok(!node.path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(node.path), `node path must be relative: ${node.path}`);
  for (const child of node.children) assertRelativeNodePaths(child);
}

function assertFingerprintOmitsRunMetadata(bytes, outputPaths) {
  const serialized = bytes.toString('utf8');
  assert.ok(serialized.endsWith('\n'));
  assert.ok(!serialized.includes(REPO_ROOT), 'state must not contain an absolute repository path');
  for (const outputPath of outputPaths) {
    assert.ok(!serialized.includes(outputPath), `state must not contain output path ${outputPath}`);
  }
  // v2 deliberately records locale and simulated frame in separate declared slices.
  assert.doesNotMatch(
    serialized,
    /"(?:lang|frames|frame_count|timestamp|time|pid|hostname|host|cwd)"\s*:/i,
    'state must not contain volatile machine or invocation metadata',
  );
  const document = JSON.parse(serialized);
  assertCanonicalObjectKeys(document);
  if (document.format === 'synapse.world-state.v2') {
    assertRelativeNodePaths(document.rules.nodes);
    assert.ok(SUPPORTED_LOCALES.includes(document.presentation.locale));
    for (const node of document.presentation.nodes) {
      assert.ok(!node.path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(node.path), `presentation path must be relative: ${node.path}`);
    }
  } else {
    assertRelativeNodePaths(document.nodes);
  }
  return document;
}

test('run validates the GameSpec, processes 120 frames and produces deterministic PNG output', { timeout: 180_000 }, () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const args = ['run', 'examples/minimal.game.yaml', '--frames', '120', '--shot', SHOT_PATH];
  const first = runCli(args);
  assertGodotProcessStarted(first);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(first.stderr, '');
  const firstRecord = machineRecord(first.stdout);
  assert.equal(firstRecord.code, 'cli.run.complete');
  assert.equal(firstRecord.marker, 'frames=120');
  assert.equal(firstRecord.params.frames, 120);
  assert.equal(firstRecord.params.scene, 'scene.main-menu');
  assert.equal(firstRecord.params.shot, SHOT_PATH);
  const firstPng = readFileSync(SHOT_PATH);
  assert.deepEqual(firstPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(firstPng.readUInt32BE(16) > 0);
  assert.ok(firstPng.readUInt32BE(20) > 0);

  const second = runCli(args);
  assertGodotProcessStarted(second);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(second.stderr, '');
  const secondRecord = machineRecord(second.stdout);
  assert.equal(secondRecord.marker, 'frames=120');
  assert.deepEqual(second.stdout, first.stdout);
  const secondPng = readFileSync(SHOT_PATH);
  assert.deepEqual(secondPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(secondPng.readUInt32BE(16) > 0);
  assert.ok(secondPng.readUInt32BE(20) > 0);
});

test('arena GameSpec produces a locale-independent state fingerprint with movement, collection, and victory', { timeout: 600_000 }, () => {
  rmSync(ARENA_TEST_DIR, { recursive: true, force: true });
  mkdirSync(ARENA_TEST_DIR, { recursive: true });
  const inputPath = join(ARENA_TEST_DIR, 'frame-indexed-actions.json');
  const actions = [];
  for (let frame = 1; frame <= 60; frame += 1) actions.push({ frame, action: 'move_right' });
  for (let frame = 61; frame <= 100; frame += 1) actions.push({ frame, action: 'move_down' });
  writeFileSync(inputPath, JSON.stringify({ actions }));

  const runArena = (frames, locale, suffix, localeOption = '--lang') => {
    const shotPath = join(ARENA_TEST_DIR, `${suffix}.png`);
    const statePath = join(ARENA_TEST_DIR, `${suffix}.json`);
    const result = runCli([
      'run', 'examples/arena.game.yaml', '--frames', String(frames), '--shot', shotPath,
      localeOption, locale, '--state', statePath, '--input', inputPath,
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const record = machineRecord(result.stdout);
    assert.equal(record.code, 'cli.run.complete');
    assert.equal(record.params.scene, 'scene.arena');
    assert.equal(record.params.frames, frames);
    const png = readFileSync(shotPath);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 960);
    assert.equal(png.readUInt32BE(20), 540);
    const bytes = readFileSync(statePath);
    const document = assertFingerprintOmitsRunMetadata(bytes, [shotPath, statePath]);
    assert.equal(document.format, 'synapse.world-state.v2');
    assert.equal(document.scene, 'scene.arena');
    return { bytes, document, png };
  };
  const playerProperties = (document) => {
    const pending = [document.rules.nodes];
    while (pending.length > 0) {
      const node = pending.pop();
      const properties = node.properties.entity_properties;
      if (node.properties.entity_id === 'entity.arena.player') return properties;
      pending.push(...node.children);
    }
    assert.fail('arena snapshot must contain the player entity');
  };

  const frame0 = runArena(1, 'en', 'frame-0');
  const frame60 = runArena(60, 'en', 'frame-60');
  const frame120 = runArena(120, 'en', 'frame-120');
  const initialPlayer = playerProperties(frame0.document);
  const middlePlayer = playerProperties(frame60.document);
  const winningPlayer = playerProperties(frame120.document);
  assert.deepEqual([initialPlayer.x, initialPlayer.y, initialPlayer.score], [120, 270, 0]);
  assert.deepEqual([middlePlayer.x, middlePlayer.y, middlePlayer.score], [352, 270, 3]);
  assert.deepEqual([winningPlayer.x, winningPlayer.y, winningPlayer.score, winningPlayer.won], [360, 430, 3, true]);
  assert.notDeepEqual(frame0.bytes, frame60.bytes);
  assert.notDeepEqual(frame60.bytes, frame120.bytes);

  const frames = [1, 60, 120];
  const englishByFrame = new Map([[1, frame0], [60, frame60], [120, frame120]]);
  for (const frame of frames) {
    assert.equal(englishByFrame.get(frame).document.rules.frame, frame, `rules.frame must equal processed frame count ${frame}`);
  }
  assert.notDeepEqual(frame0.document.rules, frame60.document.rules, 'rules must differ between frames 1 and 60');
  assert.notDeepEqual(frame60.document.rules, frame120.document.rules, 'rules must differ between frames 60 and 120');

  for (const locale of SUPPORTED_LOCALES) {
    const localizedByFrame = [];
    for (const frame of frames) {
      const baseline = englishByFrame.get(frame);
      const localeOption = locale === 'zh-Hans' ? '--locale' : '--lang';
      const localized = locale === 'en'
        ? baseline
        : runArena(frame, locale, `locale-${locale}-${frame}`, localeOption);
      assert.equal(localized.document.presentation.locale, locale);
      assert.equal(localized.document.rules.frame, frame);
      assert.deepEqual(localized.document.rules, baseline.document.rules, `${locale} rules must match en at frame ${frame}`);
      if (locale !== 'en') {
        assert.notDeepEqual(localized.document.presentation, baseline.document.presentation, `${locale} presentation slice must differ from en at frame ${frame}`);
        assert.notDeepEqual(
          localized.document.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
          baseline.document.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
          `${locale} must translate text, tooltip_text, or title, not only presentation.locale`,
        );
        assert.notDeepEqual(localized.png, baseline.png, `${locale} UI must render localized catalog text at frame ${frame}`);
      }
      localizedByFrame.push(localized);
    }
    assert.notDeepEqual(localizedByFrame[0].document.rules, localizedByFrame[1].document.rules, `${locale} rules must differ between frames 1 and 60`);
    assert.notDeepEqual(localizedByFrame[1].document.rules, localizedByFrame[2].document.rules, `${locale} rules must differ between frames 60 and 120`);
  }

  const runWorldStateFixture = (specPath, locale, suffix) => {
    const shotPath = join(ARENA_TEST_DIR, `${suffix}.png`);
    const statePath = join(ARENA_TEST_DIR, `${suffix}.json`);
    const result = runCli([
      'run', specPath, '--frames', '120', '--shot', shotPath, '--lang', locale, '--state', statePath,
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const document = assertFingerprintOmitsRunMetadata(readFileSync(statePath), [shotPath, statePath]);
    assert.equal(document.format, 'synapse.world-state.v2');
    assert.equal(document.rules.frame, 120);
    assert.equal(document.presentation.locale, locale);
    return document;
  };
  const geometryEn = runWorldStateFixture('tests/fixtures/world-state/locale-geometry.game.yaml', 'en', 'geometry-en');
  const geometryDe = runWorldStateFixture('tests/fixtures/world-state/locale-geometry.game.yaml', 'de', 'geometry-de');
  assert.notDeepEqual(geometryEn.rules, geometryDe.rules, 'translated measured text width must affect rules geometry');
  const geometryPanel = (document) => {
    const pending = [document.rules.nodes];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node.path === 'LayoutPanel') return node;
      pending.push(...node.children);
    }
    assert.fail('locale-geometry fixture must contain LayoutPanel');
  };
  assert.notEqual(geometryPanel(geometryEn).properties.size[0], geometryPanel(geometryDe).properties.size[0]);

  const translationEn = runWorldStateFixture('tests/fixtures/world-state/plain-translation.game.yaml', 'en', 'translation-en');
  const translationDe = runWorldStateFixture('tests/fixtures/world-state/plain-translation.game.yaml', 'de', 'translation-de');
  assert.deepEqual(translationEn.rules, translationDe.rules, 'plain translation must not affect rules');
  assert.notDeepEqual(translationEn.presentation, translationDe.presentation);
  assert.notDeepEqual(
    translationEn.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    translationDe.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    'plain translation must change text, tooltip_text, or title, not only locale',
  );
  const repeat = runArena(120, 'en', 'repeat-120');
  assert.deepEqual(repeat.bytes, frame120.bytes, 'repeating the same run must preserve state bytes');
  assert.deepEqual(repeat.png, frame120.png, 'repeating the same run must preserve PNG bytes');
});

test('public run --input applies deterministic actions and localizes a missing input file', { timeout: 180_000 }, () => {
  rmSync(ARENA_TEST_DIR, { recursive: true, force: true });
  mkdirSync(ARENA_TEST_DIR, { recursive: true });
  const inputPath = join(ARENA_TEST_DIR, 'actions.json');
  const emptyInputPath = join(ARENA_TEST_DIR, 'empty-actions.json');
  writeFileSync(inputPath, JSON.stringify({ actions: [
    { frame: 0, action: 'move_right' },
    { frame: 1, action: 'move_right' },
    { frame: 2, action: 'move_down' },
  ] }));
  writeFileSync(emptyInputPath, JSON.stringify({ actions: [] }));

  const inputShot = join(ARENA_TEST_DIR, 'input.png');
  const inputState = join(ARENA_TEST_DIR, 'input.json');
  const repeatShot = join(ARENA_TEST_DIR, 'input-repeat.png');
  const repeatState = join(ARENA_TEST_DIR, 'input-repeat.json');
  const emptyShot = join(ARENA_TEST_DIR, 'empty-input.png');
  const emptyState = join(ARENA_TEST_DIR, 'empty-input.json');
  const base = ['run', 'examples/arena.game.yaml', '--frames', '4'];
  const inputRun = runCli([...base, '--shot', inputShot, '--state', inputState, '--input', inputPath]);
  assert.equal(inputRun.status, 0, `${inputRun.stdout}\n${inputRun.stderr}`);
  assert.equal(machineRecord(inputRun.stdout).code, 'cli.run.complete');
  const repeatRun = runCli([...base, '--shot', repeatShot, '--state', repeatState, '--input', inputPath]);
  assert.equal(repeatRun.status, 0, `${repeatRun.stdout}\n${repeatRun.stderr}`);
  assert.deepEqual(readFileSync(repeatShot), readFileSync(inputShot));
  assert.deepEqual(readFileSync(repeatState), readFileSync(inputState));

  const emptyRun = runCli([...base, '--shot', emptyShot, '--state', emptyState, '--input', emptyInputPath]);
  assert.equal(emptyRun.status, 0, `${emptyRun.stdout}\n${emptyRun.stderr}`);
  assert.notDeepEqual(readFileSync(emptyShot), readFileSync(inputShot), 'JSON actions must affect the rendered output');
  assert.notDeepEqual(readFileSync(emptyState), readFileSync(inputState), 'JSON actions must affect the world-state fingerprint');

  const missingPath = join(ARENA_TEST_DIR, 'absent.json');
  const missingArgs = [...base, '--shot', join(ARENA_TEST_DIR, 'missing.png'), '--input', missingPath];
  const missingDiagnostics = {};
  let missingEnglish;
  let missingGerman;
  for (const locale of SUPPORTED_LOCALES) {
    const result = runCli([...missingArgs, '--lang', locale]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const diagnostic = machineRecord(result.stdout);
    missingDiagnostics[locale] = diagnostic;
    assert.equal(diagnostic.code, 'actions.file.missing');
    assert.equal(diagnostic.catalogKey, 'errors.actions.file.missing');
    assert.equal(diagnostic.params.path, missingPath);
    assert.equal(diagnostic.params.file, missingPath);
    assert.ok(diagnostic.params.expected && Object.keys(diagnostic.params.expected).length > 0);
    assert.ok(diagnostic.params.actual);
    assert.equal(diagnostic.params.actual, missingPath);
    assert.ok(diagnostic.message.length > 0);
    assert.ok(diagnostic.message.includes(missingPath));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|SCRIPT ERROR|Stack Trace/i);

    if (locale === 'en') {
      missingEnglish = diagnostic;
    } else {
      assert.equal(diagnostic.code, missingEnglish.code);
      assert.equal(diagnostic.catalogKey, missingEnglish.catalogKey);
      assert.equal(result.status, 1);
      assert.deepEqual(diagnostic.params, missingEnglish.params);
    }
    if (locale === 'de') missingGerman = diagnostic;
  }
  assert.notEqual(missingGerman.message, missingEnglish.message, 'diagnostic text must use the selected locale');
  assert.equal(Object.keys(missingDiagnostics).length, SUPPORTED_LOCALES.length);

  const unreadablePath = join(ARENA_TEST_DIR, 'unreadable.json');
  writeFileSync(unreadablePath, JSON.stringify({ actions: [] }));
  chmodSync(unreadablePath, 0);
  try {
    let unreadableEnglish;
    for (const locale of SUPPORTED_LOCALES) {
      const result = runCli([
        ...base, '--shot', join(ARENA_TEST_DIR, `unreadable-${locale}.png`),
        '--input', unreadablePath, '--lang', locale,
      ]);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const diagnostic = machineRecord(result.stdout);
      assert.equal(diagnostic.code, 'actions.file.missing');
      assert.equal(diagnostic.catalogKey, 'errors.actions.file.missing');
      assert.equal(diagnostic.params.path, unreadablePath);
      assert.equal(diagnostic.params.file, unreadablePath);
      assert.ok(diagnostic.params.expected && Object.keys(diagnostic.params.expected).length > 0);
      assert.ok(diagnostic.params.actual);
      assert.equal(diagnostic.params.actual, unreadablePath);
      assert.ok(diagnostic.message.length > 0);
      assert.ok(diagnostic.message.includes(unreadablePath));
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|SCRIPT ERROR|Stack Trace/i);
      if (locale === 'en') {
        unreadableEnglish = diagnostic;
      } else {
        assert.equal(diagnostic.code, unreadableEnglish.code);
        assert.equal(diagnostic.catalogKey, unreadableEnglish.catalogKey);
        assert.equal(result.status, 1);
        assert.deepEqual(diagnostic.params, unreadableEnglish.params);
      }
    }
  } finally {
    chmodSync(unreadablePath, 0o600);
  }

  const missingSpec = join(ARENA_TEST_DIR, 'missing.game.yaml');
  const missingSpecRun = runCli([
    'run', missingSpec, '--frames', '4', '--shot', join(ARENA_TEST_DIR, 'missing-spec.png'),
    '--input', missingPath, '--lang', 'en',
  ]);
  assert.equal(missingSpecRun.status, 1, `${missingSpecRun.stdout}\n${missingSpecRun.stderr}`);
  const specDiagnostic = machineRecord(missingSpecRun.stdout);
  assert.equal(specDiagnostic.code, 'spec.file.missing');
  assert.equal(specDiagnostic.catalogKey, 'errors.spec.file.missing');
  assert.equal(specDiagnostic.params.path, '/spec');
  assert.equal(specDiagnostic.params.file, missingSpec);
  assert.equal(specDiagnostic.params.expected, 'readable file');
  assert.equal(specDiagnostic.params.actual, 'not_found');
  assert.doesNotMatch(`${missingSpecRun.stdout}\n${missingSpecRun.stderr}`, /ENOENT|127|SCRIPT ERROR|Stack Trace/i);

  const invalidPath = runCli([...base, '--shot', join(ARENA_TEST_DIR, 'invalid.png'), '--input', 'relative.json']);
  assert.equal(invalidPath.status, 2);
  assert.equal(machineRecord(invalidPath.stdout).code, 'field.pattern');

  const malformedPath = join(ARENA_TEST_DIR, 'malformed.json');
  writeFileSync(malformedPath, '{"actions": [');
  const malformedRun = runCli([...base, '--shot', join(ARENA_TEST_DIR, 'malformed.png'), '--input', malformedPath, '--lang', 'ru']);
  assert.equal(malformedRun.status, 2);
  const malformedDiagnostic = machineRecord(malformedRun.stdout);
  assert.equal(malformedDiagnostic.code, 'field.type');
  assert.equal(malformedDiagnostic.catalogKey, 'errors.field.type');
  assert.ok(malformedDiagnostic.message.length > 0);
  assert.doesNotMatch(`${malformedRun.stdout}\n${malformedRun.stderr}`, /ENOENT|127/);
});

test('missing GameSpec files produce localized spec.file.missing records without leaking ENOENT', { timeout: 120_000 }, () => {
  rmSync(ARENA_TEST_DIR, { recursive: true, force: true });
  mkdirSync(ARENA_TEST_DIR, { recursive: true });
  const missingSpec = join(ARENA_TEST_DIR, 'missing.game.yaml');
  const results = {};
  for (const locale of ['en', 'ja']) {
    const validate = runCli(['validate', missingSpec, '--lang', locale]);
    assert.equal(validate.status, 1, `${validate.stdout}\n${validate.stderr}`);
    results[locale] = machineRecord(validate.stdout);
    assert.equal(results[locale].code, 'spec.file.missing');
    assert.equal(results[locale].catalogKey, 'errors.spec.file.missing');
    assert.equal(results[locale].params.file, missingSpec);
    assert.doesNotMatch(`${validate.stdout}\n${validate.stderr}`, /ENOENT|127/);

    const run = runCli([
      'run', missingSpec, '--frames', '1', '--shot', join(ARENA_TEST_DIR, `${locale}.png`), '--lang', locale,
    ]);
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
    const runRecord = machineRecord(run.stdout);
    assert.equal(runRecord.code, results[locale].code);
    assert.deepEqual(runRecord.params, results[locale].params);
    assert.notEqual(runRecord.message, '');
    assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /ENOENT|127/);
  }
  assert.deepEqual(results.ja.params, results.en.params);
  assert.notEqual(results.ja.message, results.en.message);
});

test('missing Node.js produces cli.dependency.node-missing with localized stable params', { timeout: 90_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-no-node-'));
  try {
    for (const utility of ['bash', 'dirname']) {
      const source = process.env.PATH.split(':').map((directory) => join(directory, utility)).find((candidate) => existsSync(candidate));
      assert.ok(source, `${utility} must be available to launch the bundled Godot wrapper`);
      symlinkSync(source, join(isolatedPath, utility));
    }
    const results = {};
    for (const locale of SUPPORTED_LOCALES) {
      const result = runCli(['validate', 'examples/minimal.game.yaml', '--lang', locale], { PATH: isolatedPath });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).length, 1);
      results[locale] = machineRecord(result.stdout);
      assert.equal(results[locale].code, 'cli.dependency.node-missing');
      assert.equal(results[locale].catalogKey, 'errors.cli.dependency.node-missing');
      assert.ok(results[locale].message.length > 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|node: not found/i);
    }
    for (const locale of SUPPORTED_LOCALES) {
      assert.deepEqual(results[locale].params, results.en.params);
      assert.equal(results[locale].catalogKey, results.en.catalogKey);
      if (locale !== 'en') assert.notEqual(results[locale].message, results.en.message);
    }

    const unsupported = runCli(['validate', 'examples/minimal.game.yaml', '--lang', 'zh_CN'], { PATH: isolatedPath });
    assert.equal(unsupported.status, 2, `${unsupported.stdout}\n${unsupported.stderr}`);
    const diagnostic = machineRecord(unsupported.stdout);
    assert.equal(diagnostic.code, 'field.enum');
    assert.equal(diagnostic.catalogKey, 'errors.field.enum');
    assert.deepEqual(diagnostic.params, {
      path: '/--locale',
      expected: SUPPORTED_LOCALES,
      actual: 'zh_CN',
    });
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});

test('missing Godot produces localized runtime.engine.missing and invalid locale wins first', { timeout: 180_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-no-godot-'));
  try {
    symlinkSync(process.execPath, join(isolatedPath, 'node'));
    const path = `${isolatedPath}:/usr/bin:/bin`;
    const results = {};
    for (const locale of SUPPORTED_LOCALES) {
      const result = runCli([
        'run', 'examples/minimal.game.yaml', '--frames', '1',
        '--shot', join(isolatedPath, `${locale}.png`), '--lang', locale,
      ], { PATH: path });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      results[locale] = machineRecord(result.stdout);
      assert.equal(results[locale].code, 'runtime.engine.missing');
      assert.equal(results[locale].catalogKey, 'errors.runtime.engine.missing');
      assert.equal(results[locale].params.path, '/run');
      assert.deepEqual(results[locale].params.expected, 'Godot executable on PATH');
      assert.equal(results[locale].params.actual, 'not_found');
      assert.ok(results[locale].message.length > 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|render_failed/);
    }
    for (const locale of SUPPORTED_LOCALES) {
      assert.deepEqual(results[locale].params, results.en.params);
      assert.equal(results[locale].catalogKey, results.en.catalogKey);
      if (locale !== 'en') assert.notEqual(results[locale].message, results.en.message);
    }

    const invalidLocale = runCli([
      'run', 'examples/minimal.game.yaml', '--frames', '1',
      '--shot', join(isolatedPath, 'invalid-locale.png'), '--lang', 'zh_CN',
    ], { PATH: path });
    assert.equal(invalidLocale.status, 2, `${invalidLocale.stdout}\n${invalidLocale.stderr}`);
    const invalidDiagnostic = machineRecord(invalidLocale.stdout);
    assert.equal(invalidDiagnostic.code, 'field.enum');
    assert.deepEqual(invalidDiagnostic.params, {
      path: '/--locale',
      expected: SUPPORTED_LOCALES,
      actual: 'zh_CN',
    });
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});

test('renderer failure uses runtime.engine.missing and retains machine-readable cause in params', { timeout: 120_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-failing-godot-'));
  try {
    symlinkSync(process.execPath, join(isolatedPath, 'node'));
    const fakeGodot = join(isolatedPath, 'godot');
    writeFileSync(fakeGodot, `#!/bin/sh
printf '%s\\n' '{"code":"test.renderer.failure","params":{"reason":"fixture_failure"}}'
exit 42
`);
    chmodSync(fakeGodot, 0o755);
    const result = runCli([
      'run', 'examples/minimal.game.yaml', '--frames', '1', '--shot', join(isolatedPath, 'failed.png'), '--lang', 'en',
    ], { PATH: `${isolatedPath}:/usr/bin:/bin` });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const record = machineRecord(result.stdout);
    assert.equal(record.code, 'runtime.engine.missing');
    assert.equal(record.catalogKey, 'errors.runtime.engine.missing');
    assert.equal(record.params.path, join(isolatedPath, 'failed.png'));
    assert.deepEqual(record.params.expected, { exit_code: 0, frames_marker: 'frames=1' });
    assert.equal(record.params.actual.exit_code, 42);
    assert.equal(record.params.actual.renderer_record.code, 'test.renderer.failure');
    assert.equal(record.params.actual.renderer_record.params.reason, 'fixture_failure');
    assert.ok(record.message.length > 0);
    assert.doesNotMatch(record.message, /\{[A-Za-z][A-Za-z0-9_]*\}/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127/);
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});


test('state capture failure propagates cli.run.state.write_failed with the supplied state path', { timeout: 180_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-state-capture-failure-'));
  try {
    const shotPath = join(isolatedPath, 'rendered.png');
    const statePath = join(isolatedPath, 'blocked.json');
    mkdirSync(statePath, { recursive: true });
    const result = runCli([
      'run', 'examples/minimal.game.yaml', '--frames', '1', '--shot', shotPath,
      '--state', statePath, '--lang', 'ja',
    ]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const record = machineRecord(result.stdout);
    assert.equal(record.code, 'cli.run.state.write_failed');
    assert.equal(Object.hasOwn(record, 'catalogKey'), false);
    assert.equal(record.params.path, statePath);
    assert.deepEqual(record.params.expected, { file_writable: true });
    assert.equal(typeof record.params.actual, 'number');
    assert.equal(Object.hasOwn(record.params, 'renderer_record'), false);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127/);
    assert.ok(existsSync(shotPath), 'render must complete before the state-capture failure');
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});

test('validate and resolve remain machine-readable through the public Godot CLI', { timeout: 60_000 }, () => {
  const validation = runCli(['validate', 'examples/minimal.game.yaml']);
  assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
  const validationRecord = machineRecord(validation.stdout);
  assert.equal(validationRecord.ok, true);
  assert.equal(validationRecord.entryScene, 'scene.main-menu');

  const resolution = runCli(['resolve', 'examples/minimal.game.yaml']);
  assert.equal(resolution.status, 0, `${resolution.stdout}\n${resolution.stderr}`);
  const resolutionRecord = machineRecord(resolution.stdout);
  assert.equal(resolutionRecord.ok, true);
  assert.deepEqual(resolutionRecord.order, []);
});

test('validate treats --lang as an exact --locale alias for every supported locale', { timeout: 120_000 }, () => {
  const simplifiedChinese = runCli(['validate', 'examples/minimal.game.yaml', '--locale', 'zh-Hans']);
  assert.equal(simplifiedChinese.status, 0, `${simplifiedChinese.stdout}\n${simplifiedChinese.stderr}`);
  assert.equal(machineRecord(simplifiedChinese.stdout).ok, true);

  const args = ['validate', 'examples/broken.game.yaml'];
  const english = runCli([...args, '--locale', 'en']);
  assert.equal(english.status, 1, `${english.stdout}\n${english.stderr}`);
  const englishError = machineRecord(english.stdout).errors[0];

  for (const locale of SUPPORTED_LOCALES) {
    const lang = runCli([...args, '--lang', locale]);
    const localeOption = runCli([...args, '--locale', locale]);
    assert.equal(lang.status, localeOption.status, `${locale}: status differs`);
    assert.equal(lang.stdout, localeOption.stdout, `${locale}: stdout differs`);
    assert.equal(lang.stderr, localeOption.stderr, `${locale}: stderr differs`);
    assert.equal(lang.status, english.status, `${locale}: return code differs from en`);

    const diagnostic = machineRecord(lang.stdout).errors[0];
    assert.equal(diagnostic.code, englishError.code, `${locale}: error code differs from en`);
    assert.equal(diagnostic.params.path, englishError.params.path, `${locale}: path differs from en`);
    assert.equal(diagnostic.params.actual, englishError.params.actual, `${locale}: actual differs from en`);
    assert.ok(diagnostic.message.trim(), `${locale}: localized message is empty`);
    if (locale === 'ja') {
      assert.notEqual(diagnostic.message, englishError.message, 'ja message must use the Japanese catalog');
      assert.match(diagnostic.message, /[ぁ-んァ-ン一-龯]/u, 'ja message must contain Japanese text');
    }
  }

  assert.equal(machineRecord(runCli([...args, '--lang', 'ja']).stdout).errors[0].code, 'field.unknown');
  assert.equal(machineRecord(runCli([...args, '--lang', 'de']).stdout).errors[0].code, 'field.unknown');
});

test('run applies --lang with the same global locale selection as --locale', () => {
  const args = ['run', 'examples/broken.game.yaml', '--frames', '1', '--shot', SHOT_PATH];
  const lang = runCli([...args, '--lang', 'ja']);
  const locale = runCli([...args, '--locale', 'ja']);
  assert.equal(lang.status, locale.status);
  assert.equal(lang.stdout, locale.stdout);
  assert.equal(lang.stderr, locale.stderr);
  assert.equal(lang.status, 1);
  assert.equal(machineRecord(lang.stdout).errors[0].code, 'field.unknown');
});

test('missing and unsupported --lang values preserve --locale diagnostics and return codes', () => {
  const args = ['validate', 'examples/broken.game.yaml'];
  const missingLang = runCli([...args, '--lang']);
  const missingLocale = runCli([...args, '--locale']);
  assert.deepEqual(
    { status: missingLang.status, stdout: missingLang.stdout, stderr: missingLang.stderr },
    { status: missingLocale.status, stdout: missingLocale.stdout, stderr: missingLocale.stderr },
  );
  assert.equal(missingLang.status, 2);
  assert.match(missingLang.stdout, /Usage:/);

  const unsupportedLang = runCli([...args, '--lang', 'zh_CN']);
  const unsupportedLocale = runCli([...args, '--locale', 'zh_CN']);
  assert.deepEqual(
    { status: unsupportedLang.status, stdout: unsupportedLang.stdout, stderr: unsupportedLang.stderr },
    { status: unsupportedLocale.status, stdout: unsupportedLocale.stdout, stderr: unsupportedLocale.stderr },
  );
  assert.equal(unsupportedLang.status, 2);
  const unsupportedRecord = machineRecord(unsupportedLang.stdout);
  assert.equal(unsupportedRecord.code, 'field.enum');
  assert.equal(unsupportedRecord.catalogKey, 'errors.field.enum');
  assert.deepEqual(unsupportedRecord.params, {
    path: '/--locale',
    expected: SUPPORTED_LOCALES,
    actual: 'zh_CN',
  });
});

test('run still rejects an unknown option with cli.run.option.unknown and rc 2', () => {
  const result = runCli([
    'run', 'examples/minimal.game.yaml', '--frames', '1', '--shot', SHOT_PATH, '--nope', 'value',
  ]);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  const diagnostic = machineRecord(result.stdout);
  assert.equal(diagnostic.code, 'cli.run.option.unknown');
  assert.deepEqual(diagnostic.params.expected, ['--frames', '--input', '--shot', '--state']);
  assert.equal(diagnostic.params.actual, '--nope');
});

test('run --state writes canonical locale-independent fingerprints and records the 60/120-frame comparison', { timeout: 180_000 }, () => {
  rmSync(STATE_TEST_DIR, { recursive: true, force: true });
  mkdirSync(STATE_TEST_DIR, { recursive: true });

  const enShot = join(STATE_TEST_DIR, 'en-120.png');
  const enState = join(STATE_TEST_DIR, 'en-120.json');
  const deShot = join(STATE_TEST_DIR, 'de-120.png');
  const deState = join(STATE_TEST_DIR, 'de-120.json');
  const run120 = (locale, shot, state) => runCli([
    'run', 'examples/minimal.game.yaml', '--frames', '120', '--shot', shot,
    '--lang', locale, '--state', state,
  ]);

  const english = run120('en', enShot, enState);
  assert.equal(english.status, 0, `${english.stdout}\n${english.stderr}`);
  const englishRecord = machineRecord(english.stdout);
  assert.equal(englishRecord.code, 'cli.run.complete');
  const german = run120('de', deShot, deState);
  assert.equal(german.status, 0, `${german.stdout}\n${german.stderr}`);
  assert.equal(machineRecord(german.stdout).code, 'cli.run.complete');

  const enBytes = readFileSync(enState);
  const deBytes = readFileSync(deState);
  const enDocument = assertFingerprintOmitsRunMetadata(enBytes, [enShot, enState]);
  const deDocument = assertFingerprintOmitsRunMetadata(deBytes, [deShot, deState]);
  assert.equal(enDocument.rules.frame, englishRecord.params.frames);
  assert.equal(deDocument.rules.frame, machineRecord(german.stdout).params.frames);
  assert.deepEqual(enDocument.rules, deDocument.rules, 'locale must not affect the declared rules slice');
  assert.notDeepEqual(enDocument.presentation, deDocument.presentation, 'presentation slice must record localized content');
  assert.notDeepEqual(
    enDocument.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    deDocument.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    'presentation must differ in text, tooltip_text, or title, not only locale',
  );
  assert.ok(readFileSync(enShot).length > 24, 'English PNG must be created');
  assert.ok(readFileSync(deShot).length > 24, 'German PNG must be created');

  const serialized = enBytes.toString('utf8');
  assert.ok(serialized.endsWith('\n'));
  const document = JSON.parse(serialized);
  assert.equal(document.format, 'synapse.world-state.v2');
  assert.equal(document.scene, 'scene.main-menu');
  assert.equal(document.rules.frame, 120);
  assert.deepEqual(document.rules.nodes.properties.size, [960, 540]);
  assertCanonicalObjectKeys(document);
  assertRelativeNodePaths(document.rules.nodes);
  assert.ok(!serialized.includes(REPO_ROOT), 'state must not contain an absolute repository path');
  assert.ok(!serialized.includes(enShot) && !serialized.includes(enState));
  assert.doesNotMatch(serialized, /"(?:lang|frames|frame_count|timestamp|time|pid|hostname|cwd)"/i);

  const shortShot = join(STATE_TEST_DIR, 'en-60.png');
  const shortState = join(STATE_TEST_DIR, 'en-60.json');
  const shortRun = runCli([
    'run', 'examples/minimal.game.yaml', '--frames', '60', '--shot', shortShot,
    '--lang', 'en', '--state', shortState,
  ]);
  assert.equal(shortRun.status, 0, `${shortRun.stdout}\n${shortRun.stderr}`);
  assert.ok(readFileSync(shortShot).length > 24, '60-frame PNG must be created');
  const shortDocument = assertFingerprintOmitsRunMetadata(readFileSync(shortState), [shortShot, shortState]);
  assert.equal(shortDocument.rules.frame, machineRecord(shortRun.stdout).params.frames);
  assert.notDeepEqual(shortDocument.rules, enDocument.rules, 'rules slice must distinguish frames 60 and 120');
  const shortHash = createHash('sha256').update(readFileSync(shortState)).digest('hex');
  const longHash = createHash('sha256').update(enBytes).digest('hex');
  const frameStateEqual = shortHash === longHash;
  console.log(`K-39 60/120 state comparison: 60=${shortHash} 120=${longHash} equal=${frameStateEqual}`);
  if (frameStateEqual) {
    console.log('K-39 finding: the registered minimal scene has no state changes between frames 60 and 120; acceptance decision remains pending.');
  }
});

test('run --state reports missing values, invalid paths, and write failures distinctly', { timeout: 180_000 }, () => {
  rmSync(STATE_TEST_DIR, { recursive: true, force: true });
  mkdirSync(STATE_TEST_DIR, { recursive: true });
  const shot = join(STATE_TEST_DIR, 'validation.png');
  const base = ['run', 'examples/minimal.game.yaml', '--frames', '1', '--shot', shot];

  const missing = runCli([...base, '--state']);
  assert.equal(missing.status, 2);
  assert.equal(machineRecord(missing.stdout).code, 'cli.run.option.value_missing');

  for (const path of [
    '',
    'relative-state.json',
    join(REPO_ROOT, 'inside-state.json'),
    join(STATE_TEST_DIR, 'wrong-extension.txt'),
  ]) {
    const invalid = runCli([...base, '--state', path]);
    assert.equal(invalid.status, 2, `${path}: ${invalid.stdout}\n${invalid.stderr}`);
    const record = machineRecord(invalid.stdout);
    assert.equal(record.code, 'cli.run.state.invalid');
    assert.equal(record.params.path, path);
    assert.ok(record.params.expected && Object.keys(record.params.expected).length > 0);
    assert.ok(record.params.actual);
  }

  const writeTarget = join(STATE_TEST_DIR, 'not-a-file.json');
  mkdirSync(writeTarget, { recursive: true });
  const writeFailure = runCli([...base, '--state', writeTarget]);
  assert.equal(writeFailure.status, 1, `${writeFailure.stdout}\n${writeFailure.stderr}`);
  const writeFailureRecord = machineRecord(writeFailure.stdout);
  assert.equal(writeFailureRecord.code, 'cli.run.state.write_failed');
  assert.equal(writeFailureRecord.params.path, writeTarget);
  assert.ok(writeFailureRecord.params.expected && Object.keys(writeFailureRecord.params.expected).length > 0);
  assert.equal(typeof writeFailureRecord.params.actual, 'number');
  assert.equal(Object.hasOwn(writeFailureRecord.params, 'renderer_record'), false);
  assert.doesNotMatch(`${writeFailure.stdout}\n${writeFailure.stderr}`, /ENOENT|127/);

  const procStatePath = '/proc/nope/state.json';
  const procFailure = runCli([...base, '--state', procStatePath]);
  assert.equal(procFailure.status, 1, `${procFailure.stdout}\n${procFailure.stderr}`);
  const procRecord = machineRecord(procFailure.stdout);
  assert.equal(procRecord.code, 'cli.run.state.write_failed');
  assert.equal(procRecord.params.path, procStatePath);
  assert.ok(procRecord.params.expected && Object.keys(procRecord.params.expected).length > 0);
  assert.ok(procRecord.params.actual !== undefined && procRecord.params.actual !== null);
  assert.equal(Object.hasOwn(procRecord.params, 'renderer_record'), false);
  assert.doesNotMatch(`${procFailure.stdout}\n${procFailure.stderr}`, /ENOENT|127/);

  const spacedDirectory = join(STATE_TEST_DIR, 'syn b4');
  mkdirSync(spacedDirectory, { recursive: true });
  const spacedShot = join(spacedDirectory, 'shot --x.png');
  const spacedState = join(spacedDirectory, 'state --x.json');
  const spacedRun = runCli([
    'run', 'examples/minimal.game.yaml', '--frames', '1', '--shot', spacedShot,
    '--state', spacedState, '--lang', 'en',
  ]);
  assert.equal(spacedRun.status, 0, `${spacedRun.stdout}\n${spacedRun.stderr}`);
  const spacedRecord = machineRecord(spacedRun.stdout);
  assert.equal(spacedRecord.code, 'cli.run.complete');
  assert.equal(spacedRecord.params.shot, spacedShot);
  assert.equal(existsSync(spacedShot), true, 'shot must be created at the exact path containing spaces and a flag-like suffix');
  assert.equal(existsSync(spacedState), true, 'state must be created at the exact path containing spaces and a flag-like suffix');
  const spacedPng = readFileSync(spacedShot);
  assert.deepEqual(spacedPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const spacedStateDocument = JSON.parse(readFileSync(spacedState, 'utf8'));
  assert.equal(spacedStateDocument.format, 'synapse.world-state.v2');
  assert.doesNotMatch(`${spacedRun.stdout}\n${spacedRun.stderr}`, /ENOENT|127/);
});

function runStateMotion(frameCount, locale, suffix) {
  const shotPath = join(STATE_MOTION_TEST_DIR, `${suffix}.png`);
  const statePath = join(STATE_MOTION_TEST_DIR, `${suffix}.json`);
  const result = runCli([
    'run', 'examples/state-motion.game.yaml', '--frames', String(frameCount), '--shot', shotPath,
    '--lang', locale, '--state', statePath,
  ]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const record = machineRecord(result.stdout);
  assert.equal(record.code, 'cli.run.complete');
  assert.equal(record.params.frames, frameCount);
  assert.equal(record.params.scene, 'scene.state-motion');

  const png = readFileSync(shotPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 960);
  assert.equal(png.readUInt32BE(20), 540);

  const bytes = readFileSync(statePath);
  const document = assertFingerprintOmitsRunMetadata(bytes, [shotPath, statePath]);
  assert.equal(document.format, 'synapse.world-state.v2');
  assert.equal(document.scene, 'scene.state-motion');
  assert.equal(document.rules.frame, frameCount);
  return { bytes, document, shotPath, statePath };
}

test('state-motion example changes captured node transform between 60 and 120 frames', { timeout: 180_000 }, () => {
  rmSync(STATE_MOTION_TEST_DIR, { recursive: true, force: true });
  mkdirSync(STATE_MOTION_TEST_DIR, { recursive: true });

  const short = runStateMotion(60, 'en', 'en-60');
  const long = runStateMotion(120, 'en', 'en-120');
  const shortHash = createHash('sha256').update(short.bytes).digest('hex');
  const longHash = createHash('sha256').update(long.bytes).digest('hex');
  assert.notEqual(shortHash, longHash, '60 and 120 frame world states must differ');

  const shortMarker = short.document.rules.nodes.children.find((node) => node.path === 'MotionMarker');
  const longMarker = long.document.rules.nodes.children.find((node) => node.path === 'MotionMarker');
  assert.ok(shortMarker, 'snapshot must contain MotionMarker');
  assert.ok(longMarker, 'snapshot must contain MotionMarker');
  assert.notDeepEqual(shortMarker.properties.position, longMarker.properties.position);
  assert.ok(longMarker.properties.position[0] > shortMarker.properties.position[0]);
  console.log(JSON.stringify({
    code: 'test.world_state.frame_difference',
    params: {
      node: 'MotionMarker',
      property: 'position',
      at60: shortMarker.properties.position,
      at120: longMarker.properties.position,
      sha256_60: shortHash,
      sha256_120: longHash,
    },
  }));
});

test('state-motion rules are locale-invariant while presentation is translated at 120 frames', { timeout: 180_000 }, () => {
  rmSync(STATE_MOTION_TEST_DIR, { recursive: true, force: true });
  mkdirSync(STATE_MOTION_TEST_DIR, { recursive: true });

  const english = runStateMotion(120, 'en', 'locale-en-120');
  const german = runStateMotion(120, 'de', 'locale-de-120');
  assert.deepEqual(english.document.rules, german.document.rules, 'locale must not alter state-motion rules');
  assert.notDeepEqual(english.document.presentation, german.document.presentation, 'presentation slice must carry the selected locale');
  assert.notDeepEqual(
    english.document.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    german.document.presentation.nodes.map(({ path, properties }) => ({ path, properties })),
    'state-motion presentation must differ in text, tooltip_text, or title, not only locale',
  );
  const englishHash = createHash('sha256').update(english.bytes).digest('hex');
  const germanHash = createHash('sha256').update(german.bytes).digest('hex');
  assert.notEqual(englishHash, germanHash, 'artifact bytes include the intentionally different presentation slice');
  console.log(JSON.stringify({
    code: 'test.world_state.locale_invariant',
    params: { frames: 120, rules_equal: true, artifact_hash_en: english.document.artifact.hash, artifact_hash_de: german.document.artifact.hash },
  }));
});

test('run resolves a module scene entry and instantiates GameSpec entities from copied properties', { timeout: 120_000 }, () => {
  const buildDir = mkdtempSync(join(tmpdir(), 'synapse-s3-module-run-'));
  try {
    const gameDir = join(buildDir, 'module-scene');
    const modulesDir = join(gameDir, 'modules');
    const localesDir = join(gameDir, 'locales');
    mkdirSync(modulesDir, { recursive: true });
    mkdirSync(localesDir, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'examples/locales/en.json'), join(localesDir, 'en.json'));

    const specPath = join(gameDir, 'module-scene.game.yaml');
    const moduleManifestPath = join(modulesDir, 'scene.module.yaml');
    const writeSpec = (entryScene) => writeFileSync(specPath, [
      'specVersion: "1.0"',
      'game:',
      '  id: "example.modulescene"',
      '  version: "0.1.0"',
      '  titleKey: "game.example_minimal.title"',
      'entry:',
      `  scene: "${entryScene}"`,
      'modules:',
      '  - id: "synapse.test.runtimescene"',
      '    version: "1.0.0"',
      'entities:',
      '  - id: "entity.player"',
      '    properties:',
      '      health: 100',
      '      enabled: true',
      '',
    ].join('\n'));
    writeFileSync(moduleManifestPath, [
      'specVersion: "1.0"',
      'module:',
      '  id: "synapse.test.runtimescene"',
      '  version: "1.0.0"',
      '  titleKey: "module.synapse_test_runtime_scene.title"',
      'requires:',
      '  spec: "1.0"',
      '  engine: "*"',
      'provides:',
      '  scenes: ["scene.test-author"]',
      '  sceneEntries:',
      '    - id: "scene.test-author"',
      '      resource: "res://runtime/scenes/main_menu.tscn"',
      '',
    ].join('\n'));

    writeSpec('scene.test-author');
    const shotPath = join(buildDir, 'module-scene.png');
    const statePath = join(buildDir, 'module-scene.state.json');
    const result = runCli([
      'run', specPath, '--frames', '1', '--shot', shotPath, '--state', statePath,
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const record = machineRecord(result.stdout);
    assert.equal(record.code, 'cli.run.complete');
    assert.equal(record.params.scene, 'scene.test-author');

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const entityNode = state.rules.nodes.children.find((child) => child.properties.entity_id === 'entity.player');
    assert.ok(entityNode, 'runtime snapshot must contain the entity instance');
    assert.deepEqual(entityNode.properties.entity_properties, { health: 100, enabled: true });

    const mutableDefinition = readFileSync(specPath, 'utf8').replace('      health: 100', '      state: "mutable"');
    writeFileSync(specPath, mutableDefinition);
    const mutable = runCli(['validate', specPath]);
    assert.equal(mutable.status, 1, `${mutable.stdout}\n${mutable.stderr}`);
    const stateError = machineRecord(mutable.stdout).errors[0];
    assert.equal(stateError.code, 'definition.state.forbidden');
    assert.equal(stateError.params.path, '/entities/0/properties/state');

    writeSpec('scene.not-registered');
    const unknown = runCli(['validate', specPath, '--lang', 'en']);
    assert.equal(unknown.status, 1, `${unknown.stdout}\n${unknown.stderr}`);
    const diagnostic = machineRecord(unknown.stdout).errors[0];
    assert.equal(diagnostic.code, 'ref.unresolved');
    assert.equal(diagnostic.params.actual, 'scene.not-registered');
    assert.equal(diagnostic.params.refKind, 'scene');
    assert.deepEqual(diagnostic.params.providedBy, []);
    assert.deepEqual(diagnostic.params.expected, [
      'scene.main-menu', 'scene.state-motion', 'scene.test-author',
    ]);
    assert.equal(machineRecord(unknown.stdout).errors.length, 1);

    const japanese = runCli(['validate', specPath, '--lang', 'ja']);
    assert.equal(japanese.status, 1, `${japanese.stdout}\n${japanese.stderr}`);
    const japaneseDiagnostic = machineRecord(japanese.stdout).errors[0];
    assert.equal(japaneseDiagnostic.code, diagnostic.code);
    assert.deepEqual(japaneseDiagnostic.params, diagnostic.params);
    assert.equal(japaneseDiagnostic.catalogKey, diagnostic.catalogKey);
    assert.ok(japaneseDiagnostic.message.length > 0);
    assert.match(japaneseDiagnostic.message, /[\u3040-\u30ff\u4e00-\u9fff]/u);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test('module-scene example validates, resolves its declared owner and renders the module scene', { timeout: 180_000 }, () => {
  const specPath = 'examples/module-scene.game.yaml';
  const moduleId = 'synapse.example.modulescene';
  const sceneId = 'scene.example.module-workshop';
  const shotPath = join(TEST_DIR, 'module-scene-example.png');
  mkdirSync(TEST_DIR, { recursive: true });

  const validation = runCli(['validate', specPath, '--lang', 'en']);
  assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
  const validationRecord = machineRecord(validation.stdout);
  assert.equal(validationRecord.ok, true);
  assert.equal(validationRecord.entryScene, sceneId);

  const resolution = runCli(['resolve', specPath, '--lang', 'en']);
  assert.equal(resolution.status, 0, `${resolution.stdout}\n${resolution.stderr}`);
  const resolutionRecord = machineRecord(resolution.stdout);
  assert.deepEqual(resolutionRecord.order, [moduleId]);
  assert.deepEqual(resolutionRecord.sceneEntries, [{
    id: sceneId,
    resource: 'res://runtime/scenes/module_scene_example.tscn',
    moduleId,
  }]);

  const execution = runCli(['run', specPath, '--frames', '60', '--shot', shotPath, '--lang', 'en']);
  assert.equal(execution.status, 0, `${execution.stdout}\n${execution.stderr}`);
  const executionRecord = machineRecord(execution.stdout);
  assert.equal(executionRecord.code, 'cli.run.complete');
  assert.equal(executionRecord.marker, 'frames=60');
  assert.equal(executionRecord.params.scene, sceneId);
  assert.equal(executionRecord.params.shot, shotPath);
  const png = readFileSync(shotPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [960, 540]);
});

test('unknown semantic scene returns a machine-readable path/expected/actual error', { timeout: 60_000 }, () => {
  const fixtureDir = join(TEST_DIR, 'unknown-scene');
  mkdirSync(join(fixtureDir, 'locales'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'examples/locales/en.json'), join(fixtureDir, 'locales/en.json'));
  const specPath = join(fixtureDir, 'unknown.game.yaml');
  writeFileSync(specPath, [
    'specVersion: "1.0"',
    'game:',
    '  id: "example.unknownscene"',
    '  version: "0.1.0"',
    '  titleKey: "game.example_minimal.title"',
    'entry:',
    '  scene: "scene.not-registered"',
    '',
  ].join('\n'));
  const result = runCli(['run', specPath, '--frames', '1', '--shot', join(TEST_DIR, 'unknown.png')]);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const diagnostic = machineRecord(result.stdout).errors[0];
  assert.equal(diagnostic.code, 'ref.unresolved');
  assert.equal(diagnostic.params.path, '/entry/scene');
  assert.equal(diagnostic.params.refKind, 'scene');
  assert.deepEqual(diagnostic.params.providedBy, []);
  assert.deepEqual(diagnostic.params.expected, ['scene.main-menu', 'scene.state-motion']);
  assert.equal(diagnostic.params.actual, 'scene.not-registered');
});
