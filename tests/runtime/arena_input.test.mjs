import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN ?? 'godot';
const TEST_DIR = '/tmp/synapse-b3-arena-input';
const SPEC = 'examples/arena.game.yaml';
const FIXTURE = join(ROOT, 'tests/fixtures/input/ui-script.json');

function runArena(label, frames, inputPath) {
  const shot = join(TEST_DIR, `${label}.png`);
  const state = join(TEST_DIR, `${label}.json`);
  const result = spawnSync(GODOT, [
    '--headless', '--path', 'game', '--script', 'res://cli/main.gd', '--',
    'run', SPEC, '--frames', String(frames), '--shot', shot, '--state', state,
    '--lang', 'en', '--input', inputPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      PATH: `${dirname(GODOT)}:${process.env.PATH ?? ''}`,
      SYNAPSE_GODOT_MODE: 'offscreen',
    },
  });
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${label}:\n${result.stdout}\n${result.stderr}`);
  const recordLine = result.stdout.split(/\r?\n/).find((line) => line.trim().startsWith('{'));
  assert.ok(recordLine, `${label}: missing CLI result record\n${result.stdout}`);
  assert.equal(JSON.parse(recordLine).code, 'cli.run.complete');
  const bytes = readFileSync(state);
  const document = JSON.parse(bytes.toString('utf8'));
  assert.equal(document.format, 'synapse.world-state.v2');
  assert.equal(document.scene, 'scene.arena');
  assert.ok(readFileSync(shot).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  return { document, bytes, png: readFileSync(shot), shot, state };
}

function findNode(root, predicate) {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (predicate(node)) return node;
    pending.push(...node.children);
  }
  assert.fail('required arena node was absent from the rules snapshot');
}

function playerProperties(document) {
  const player = findNode(document.rules.nodes, (node) => (
    node.properties.entity_id === 'entity.arena.player'
  ));
  return player.properties.entity_properties;
}

function pauseIndicator(document) {
  return findNode(document.rules.nodes, (node) => node.path.endsWith('/PauseIndicator'));
}

function writeActions(name, actions) {
  const path = join(TEST_DIR, name);
  writeFileSync(path, `${JSON.stringify({ actions }, null, 2)}\n`);
  return path;
}

test('InputEvent UI fixture is deterministic and matches legacy --input actions in world-state v2', { timeout: 600_000 }, () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const first = runArena('ui-script-first', 120, FIXTURE);
  const repeated = runArena('ui-script-repeat', 120, FIXTURE);
  assert.equal(JSON.stringify(first.document.rules), JSON.stringify(repeated.document.rules), 'repeat run must preserve rules bytes');
  assert.equal(JSON.stringify(first.document.presentation), JSON.stringify(repeated.document.presentation), 'repeat run must preserve presentation bytes');
  assert.deepEqual(first.bytes, repeated.bytes, 'repeat run must preserve complete world-state v2 bytes');
  assert.deepEqual(first.png, repeated.png, 'repeat run must preserve screenshot bytes');
  assert.deepEqual(first.document.rules, JSON.parse(repeated.bytes.toString('utf8')).rules);
  assert.deepEqual(
    [playerProperties(first.document).x, playerProperties(first.document).y, playerProperties(first.document).score],
    [360, 430, 3],
  );

  const legacyActions = fixture.actions.map(({ frame, action }) => ({ frame, action }));
  const legacyInput = writeActions('legacy-actions.json', legacyActions);
  const legacy = runArena('legacy-input', 120, legacyInput);
  assert.deepEqual(first.document.rules, legacy.document.rules, 'key InputEvents and legacy actions must have identical rules');
  assert.deepEqual(first.document.presentation, legacy.document.presentation, 'equivalent input must preserve presentation');
});

test('StartButton, PauseButton and RestartButton process clicks and affect the rules slice', { timeout: 600_000 }, () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const inputPath = writeActions('ui-buttons.json', [
    ...[0, 1, 2].map((frame) => ({
      frame, action: 'move_right',
      event: { type: 'key', key: 'move_right', pressed: true },
    })),
    { frame: 3, action: 'move_left', event: { type: 'mouse_button', button: 'PauseButton', pressed: true } },
    { frame: 4, action: 'move_left', event: { type: 'mouse_button', button: 'PauseButton', pressed: false } },
    { frame: 7, action: 'move_left', event: { type: 'mouse_button', button: 'StartButton', pressed: true } },
    { frame: 8, action: 'move_left', event: { type: 'mouse_button', button: 'StartButton', pressed: false } },
    { frame: 12, action: 'move_left', event: { type: 'mouse_button', button: 'RestartButton', pressed: true } },
    { frame: 13, action: 'move_left', event: { type: 'mouse_button', button: 'RestartButton', pressed: false } },
  ]);
  const emptyInput = writeActions('empty-actions.json', []);

  const beforePause = runArena('before-pause', 3, inputPath);
  const pausedShort = runArena('paused-short', 7, inputPath);
  const pausedLong = runArena('paused-long', 9, inputPath);
  const pausedRepeat = runArena('paused-repeat', 9, inputPath);
  const resumed = runArena('resumed', 11, inputPath);
  const restarted = runArena('restarted', 15, inputPath);
  const initial = runArena('initial', 1, emptyInput);

  assert.equal(pauseIndicator(beforePause.document).properties.visible, false);
  assert.deepEqual([playerProperties(beforePause.document).x, playerProperties(beforePause.document).simulation_frame], [128, 2]);
  assert.equal(pauseIndicator(pausedShort.document).properties.visible, true, 'PauseButton must activate the pause indicator');
  assert.equal(pauseIndicator(pausedLong.document).properties.visible, true);
  assert.equal(playerProperties(pausedShort.document).simulation_frame, 5);
  assert.equal(playerProperties(pausedLong.document).simulation_frame, 5, 'paused simulation frames must remain frozen');
  assert.deepEqual(pausedShort.document.rules.nodes, pausedLong.document.rules.nodes, 'the rules node tree must stay frozen while paused');
  assert.deepEqual(pausedShort.document.presentation, pausedLong.document.presentation);
  assert.deepEqual(pausedLong.document.rules, pausedRepeat.document.rules, 'repeated button scenario must preserve rules');
  assert.deepEqual(pausedLong.document.presentation, pausedRepeat.document.presentation, 'repeated button scenario must preserve presentation');
  assert.deepEqual(pausedLong.png, pausedRepeat.png, 'repeated button scenario must preserve screenshot bytes');

  assert.equal(pauseIndicator(resumed.document).properties.visible, false, 'StartButton must resume the simulation');
  assert.ok(playerProperties(resumed.document).simulation_frame > playerProperties(pausedLong.document).simulation_frame);
  assert.equal(pauseIndicator(restarted.document).properties.visible, false, 'RestartButton must resume from a clean state');
  assert.deepEqual(
    [playerProperties(restarted.document).x, playerProperties(restarted.document).y,
      playerProperties(restarted.document).score, playerProperties(restarted.document).simulation_frame],
    [120, 270, 0, 0],
  );
  assert.notDeepEqual(restarted.document.rules.nodes, pausedLong.document.rules.nodes, 'restart state must record the reset simulation counter in rules');
  assert.deepEqual(
    [playerProperties(restarted.document).x, playerProperties(restarted.document).y,
      playerProperties(restarted.document).score, playerProperties(restarted.document).simulation_frame],
    [playerProperties(initial.document).x, playerProperties(initial.document).y,
      playerProperties(initial.document).score, playerProperties(initial.document).simulation_frame],
    'restart must restore the initial rules properties',
  );
  assert.ok(restarted.png.length > 0, 'restart must still produce a rendered screenshot');
});
