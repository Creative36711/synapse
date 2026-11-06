import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN ?? 'godot';
const GODOT_PATH = `${dirname(GODOT)}:${process.env.PATH ?? ''}`;
const TEST_DIR = '/tmp/synapse-k33-cli-test';
const SHOT_PATH = join(TEST_DIR, 'minimal.png');

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
