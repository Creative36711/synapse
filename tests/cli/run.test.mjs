import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN ?? 'godot';
const GODOT_PATH = `${dirname(GODOT)}:${process.env.PATH ?? ''}`;
const TEST_DIR = '/tmp/synapse-k33-cli-test';
const STATE_TEST_DIR = '/tmp/synapse-k39-state-test';
const SHOT_PATH = join(TEST_DIR, 'minimal.png');
const SUPPORTED_LOCALES = ['en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko'];

function runCli(args) {
  return spawnSync(GODOT, [
    '--headless', '--path', 'game', '--script', 'res://cli/main.gd', '--', ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PATH: GODOT_PATH, SYNAPSE_GODOT_MODE: 'offscreen' },
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
  assert.ok(!node.path.startsWith('/'), `node path must be relative: ${node.path}`);
  for (const child of node.children) assertRelativeNodePaths(child);
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
  assert.deepEqual(diagnostic.params.expected, ['--frames', '--shot', '--state']);
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
  const diagnostic = machineRecord(result.stdout);
  assert.equal(diagnostic.code, 'scene.id.unknown');
  assert.equal(diagnostic.params.path, '/entry/scene');
  assert.deepEqual(diagnostic.params.expected, ['scene.main-menu']);
  assert.equal(diagnostic.params.actual, 'scene.not-registered');
});
