import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN ?? 'godot';
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
  assert.doesNotMatch(
    serialized,
    /"(?:locale|lang|frame|frames|frame_count|timestamp|time|pid|hostname|host|cwd)"\s*:/i,
    'state must not contain locale or volatile run metadata',
  );
  assert.ok(!serialized.includes('"en"') && !serialized.includes('"de"'), 'state must not contain locale identifiers');
  const document = JSON.parse(serialized);
  assertCanonicalObjectKeys(document);
  assertRelativeNodePaths(document.nodes);
  return document;
}

test('run validates the GameSpec, processes 120 frames and produces deterministic PNG output', { timeout: 180_000 }, () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const args = ['run', 'examples/minimal.game.yaml', '--frames', '120', '--shot', SHOT_PATH];
  const first = runCli(args);
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

test('arena GameSpec produces a locale-independent state fingerprint with movement, collection, and victory', { timeout: 240_000 }, () => {
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
    assert.equal(document.format, 'synapse.world-state.v1');
    assert.equal(document.scene, 'scene.arena');
    return { bytes, document, png };
  };
  const playerProperties = (document) => {
    const pending = [document.nodes];
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

  for (const [locale, localeOption] of [
    ['ru', '--lang'], ['zh-Hans', '--locale'], ['ja', '--lang'], ['pt-BR', '--lang'],
    ['de', '--lang'], ['fr', '--lang'], ['ko', '--lang'],
  ]) {
    const localized = runArena(120, locale, `locale-${locale}`, localeOption);
    assert.deepEqual(localized.bytes, frame120.bytes, `${locale} must produce identical world-state bytes`);
    assert.notDeepEqual(localized.png, frame120.png, `${locale} UI must render localized catalog text`);
  }
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
  const missingEnglish = runCli([...missingArgs, '--lang', 'en']);
  assert.equal(missingEnglish.status, 1, `${missingEnglish.stdout}\n${missingEnglish.stderr}`);
  const englishDiagnostic = machineRecord(missingEnglish.stdout);
  assert.equal(englishDiagnostic.code, 'spec.file.missing');
  assert.equal(englishDiagnostic.catalogKey, 'errors.spec.file.missing');
  assert.equal(englishDiagnostic.params.file, missingPath);
  assert.ok(englishDiagnostic.message.includes(missingPath));
  assert.doesNotMatch(`${missingEnglish.stdout}\n${missingEnglish.stderr}`, /ENOENT|127/);

  const missingGerman = runCli([...missingArgs, '--lang', 'de']);
  assert.equal(missingGerman.status, 1, `${missingGerman.stdout}\n${missingGerman.stderr}`);
  const germanDiagnostic = machineRecord(missingGerman.stdout);
  assert.equal(germanDiagnostic.code, englishDiagnostic.code);
  assert.deepEqual(germanDiagnostic.params, englishDiagnostic.params);
  assert.equal(germanDiagnostic.catalogKey, englishDiagnostic.catalogKey);
  assert.notEqual(germanDiagnostic.message, englishDiagnostic.message, 'diagnostic text must use the selected locale');

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

test('missing Node.js produces cli.dependency.node_missing with localized stable params', { timeout: 60_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-no-node-'));
  try {
    for (const utility of ['bash', 'dirname']) {
      const source = process.env.PATH.split(':').map((directory) => join(directory, utility)).find((candidate) => existsSync(candidate));
      assert.ok(source, `${utility} must be available to launch the bundled Godot wrapper`);
      symlinkSync(source, join(isolatedPath, utility));
    }
    const results = {};
    for (const locale of ['en', 'ja']) {
      const result = runCli(['validate', 'examples/minimal.game.yaml', '--lang', locale], { PATH: isolatedPath });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      results[locale] = machineRecord(result.stdout);
      assert.equal(results[locale].code, 'cli.dependency.node_missing');
      assert.equal(results[locale].catalogKey, 'errors.cli.dependency.node-missing');
      assert.ok(results[locale].message.length > 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|node: not found/i);
    }
    assert.deepEqual(results.ja.params, results.en.params);
    assert.equal(results.ja.catalogKey, results.en.catalogKey);
    assert.notEqual(results.ja.message, results.en.message);
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});

test('missing Godot produces runtime.engine.missing instead of render_failed or 127', { timeout: 120_000 }, () => {
  const isolatedPath = mkdtempSync(join(tmpdir(), 'synapse-no-godot-'));
  try {
    symlinkSync(process.execPath, join(isolatedPath, 'node'));
    const path = `${isolatedPath}:/usr/bin:/bin`;
    const results = {};
    for (const locale of ['en', 'ja']) {
      const result = runCli([
        'run', 'examples/minimal.game.yaml', '--frames', '1',
        '--shot', join(isolatedPath, `${locale}.png`), '--lang', locale,
      ], { PATH: path });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      results[locale] = machineRecord(result.stdout);
      assert.equal(results[locale].code, 'runtime.engine.missing');
      assert.equal(results[locale].catalogKey, 'errors.runtime.engine.missing');
      assert.ok(results[locale].message.length > 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127|render_failed/);
    }
    assert.deepEqual(results.ja.params, results.en.params);
    assert.notEqual(results.ja.message, results.en.message);
  } finally {
    rmSync(isolatedPath, { recursive: true, force: true });
  }
});

test('cli.run.render_failed retains machine-readable renderer cause in params', { timeout: 120_000 }, () => {
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
    assert.equal(record.code, 'cli.run.render_failed');
    assert.equal(record.catalogKey, 'errors.runtime.engine.missing');
    assert.equal(record.params.actual.renderer_record.code, 'test.renderer.failure');
    assert.equal(record.params.actual.renderer_record.params.reason, 'fixture_failure');
    assert.ok(record.message.length > 0);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT|127/);
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

  const unsupportedLang = runCli([...args, '--lang', 'xx']);
  const unsupportedLocale = runCli([...args, '--locale', 'xx']);
  assert.deepEqual(
    { status: unsupportedLang.status, stdout: unsupportedLang.stdout, stderr: unsupportedLang.stderr },
    { status: unsupportedLocale.status, stdout: unsupportedLocale.stdout, stderr: unsupportedLocale.stderr },
  );
  assert.equal(unsupportedLang.status, 1);
  assert.equal(machineRecord(unsupportedLang.stdout).errors[0].code, 'field.unknown');
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
  assert.equal(machineRecord(english.stdout).code, 'cli.run.complete');
  const german = run120('de', deShot, deState);
  assert.equal(german.status, 0, `${german.stdout}\n${german.stderr}`);
  assert.equal(machineRecord(german.stdout).code, 'cli.run.complete');

  const enBytes = readFileSync(enState);
  const deBytes = readFileSync(deState);
  assert.deepEqual(enBytes, deBytes, 'locale must not affect the world-state fingerprint');
  assert.ok(readFileSync(enShot).length > 24, 'English PNG must be created');
  assert.ok(readFileSync(deShot).length > 24, 'German PNG must be created');

  const serialized = enBytes.toString('utf8');
  assert.ok(serialized.endsWith('\n'));
  const document = JSON.parse(serialized);
  assert.equal(document.format, 'synapse.world-state.v1');
  assert.equal(document.scene, 'scene.main-menu');
  assert.deepEqual(document.nodes.properties.size, [960, 540]);
  assertCanonicalObjectKeys(document);
  assertRelativeNodePaths(document.nodes);
  assert.ok(!serialized.includes(REPO_ROOT), 'state must not contain an absolute repository path');
  assert.ok(!serialized.includes(enShot) && !serialized.includes(enState));
  assert.doesNotMatch(serialized, /"(?:locale|lang|text|message|timestamp|time|pid|hostname|cwd|frames|frame_count)"/i);
  assert.doesNotMatch(serialized, /\b(?:en|de)\b/i, 'state must not include locale identifiers or localized strings');

  const shortShot = join(STATE_TEST_DIR, 'en-60.png');
  const shortState = join(STATE_TEST_DIR, 'en-60.json');
  const shortRun = runCli([
    'run', 'examples/minimal.game.yaml', '--frames', '60', '--shot', shortShot,
    '--lang', 'en', '--state', shortState,
  ]);
  assert.equal(shortRun.status, 0, `${shortRun.stdout}\n${shortRun.stderr}`);
  assert.ok(readFileSync(shortShot).length > 24, '60-frame PNG must be created');
  const shortHash = createHash('sha256').update(readFileSync(shortState)).digest('hex');
  const longHash = createHash('sha256').update(enBytes).digest('hex');
  const frameStateEqual = shortHash === longHash;
  console.log(`K-39 60/120 state comparison: 60=${shortHash} 120=${longHash} equal=${frameStateEqual}`);
  if (frameStateEqual) {
    console.log('K-39 finding: the registered minimal scene has no state changes between frames 60 and 120; acceptance decision remains pending.');
  }
});

test('run --state reports missing values, invalid paths, and write failures distinctly', () => {
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
    assert.equal(machineRecord(invalid.stdout).code, 'cli.run.state.invalid');
  }

  const writeTarget = join(STATE_TEST_DIR, 'not-a-file.json');
  mkdirSync(writeTarget, { recursive: true });
  const writeFailure = runCli([...base, '--state', writeTarget]);
  assert.equal(writeFailure.status, 1, `${writeFailure.stdout}\n${writeFailure.stderr}`);
  assert.equal(machineRecord(writeFailure.stdout).code, 'cli.run.state.write_failed');
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
  assert.equal(document.format, 'synapse.world-state.v1');
  assert.equal(document.scene, 'scene.state-motion');
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

  const shortMarker = short.document.nodes.children.find((node) => node.path === 'MotionMarker');
  const longMarker = long.document.nodes.children.find((node) => node.path === 'MotionMarker');
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

test('state-motion fingerprint is byte-identical for --lang en and --lang de at 120 frames', { timeout: 180_000 }, () => {
  rmSync(STATE_MOTION_TEST_DIR, { recursive: true, force: true });
  mkdirSync(STATE_MOTION_TEST_DIR, { recursive: true });

  const english = runStateMotion(120, 'en', 'locale-en-120');
  const german = runStateMotion(120, 'de', 'locale-de-120');
  assert.deepEqual(english.bytes, german.bytes, 'locale must not alter state-motion snapshot bytes');
  const englishHash = createHash('sha256').update(english.bytes).digest('hex');
  const germanHash = createHash('sha256').update(german.bytes).digest('hex');
  assert.equal(englishHash, germanHash);
  console.log(JSON.stringify({
    code: 'test.world_state.locale_invariant',
    params: { frames: 120, sha256_en: englishHash, sha256_de: germanHash, byte_equal: true },
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
    const entityNode = state.nodes.children.find((child) => child.properties.entity_id === 'entity.player');
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
    const unknown = runCli(['validate', specPath]);
    assert.equal(unknown.status, 1, `${unknown.stdout}\n${unknown.stderr}`);
    const diagnostic = machineRecord(unknown.stdout).errors[0];
    assert.equal(diagnostic.code, 'scene.entry.unknown');
    assert.equal(diagnostic.params.actual, 'scene.not-registered');
    assert.deepEqual(diagnostic.params.expected, [
      'scene.main-menu', 'scene.state-motion', 'scene.test-author',
    ]);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
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
  assert.equal(diagnostic.code, 'scene.entry.unknown');
  assert.equal(diagnostic.params.path, '/entry/scene');
  assert.deepEqual(diagnostic.params.expected, ['scene.main-menu', 'scene.state-motion']);
  assert.equal(diagnostic.params.actual, 'scene.not-registered');
});
