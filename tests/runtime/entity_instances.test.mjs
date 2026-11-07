import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GODOT = process.env.GODOT_BIN
  ?? join(process.env.GODOT_HOME ?? '/tmp/synapse-godot', 'bin/godot');
const TEST_SCRIPT = join(ROOT, 'tests/runtime/entity_instances.gd');

test('two runtime entities created from one definition own independent property copies', () => {
  const result = spawnSync(GODOT, [
    '--headless',
    '--path',
    join(ROOT, 'game'),
    '--script',
    TEST_SCRIPT,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, SYNAPSE_GODOT_MODE: 'offscreen' },
  });
  assert.equal(result.error, undefined, `could not start Godot: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const record = result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('{'));
  assert.ok(record, `missing machine result:\n${result.stdout}`);
  assert.deepEqual(JSON.parse(record), {
    code: 'test.runtime.entity_instances.independent',
    params: { instances: 2, independent: true },
  });
});
